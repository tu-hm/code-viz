# Backend overview

The backend is one Go module, `backend/`. It holds two binaries and a shim, the tracers that run inside the sandbox, and the contracts both halves of the product are generated from. Spec §7 is the architecture; this page maps it onto the code as it stands on Sat 24 Oct 2026 and says what is built. The rules for changing it are in [AGENTS.md](../../../AGENTS.md).

## Binaries

| Binary | Where | Job | Built so far |
|---|---|---|---|
| `vizd` | `cmd/vizd` | The service, with roles `api`, `worker` or `all` (D3) | Config, the sandbox choice check, the MySQL pool, `vizd migrate`, `/healthz` and `/readyz`, and the job worker under `worker` and `all`. The API is BE-06 |
| `vizctl` | `cmd/vizctl` | The developer CLI (§7.10) | `trace` runs one program end to end in the Docker dev sandbox; `validate` checks a trace file. `diff` isn't built |
| `viz-shim` | `cmd/viz-shim` | Runs inside every runner image and carries fd 1, 2 and 3 out of the sandbox as one framed stream | Done |

## Packages

```mermaid
flowchart TB
  cmd["cmd/vizd · cmd/vizctl<br/>wire everything together"]
  transport["internal/transport/http"]
  app["internal/app"]
  ports["internal/ports<br/>the only interfaces"]
  pure["internal/domain · internal/tracecore<br/>standard library only"]
  impl["internal/adapters<br/>dockersandbox · nsjail · mysql · blobstore · manifest"]
  cmd --> transport --> app
  app --> ports
  app --> pure
  impl -. implements .-> ports
  cmd --> impl
```

Dependencies point one way: `transport → app → domain`. `domain` and `tracecore` import only the standard library, plus the generated types. Adapters implement ports, and only the binaries wire them in (§7.4).

| Package | What it holds | Status |
|---|---|---|
| `internal/domain` | Sentinel errors (`ErrInfra`, `ErrNoJob`, `ErrLeaseLost`), the language `Manifest` and `ChunkKey`; later the job states, limits and IDs | Started |
| `internal/tracecore` | Wire stream in, trace out: stable IDs, keyframes and deltas, limits, chunks | Done (BE-04 §2). See [tracing](tracing.md) |
| `internal/app` | Use cases: create, get and wait, run a trace job | `Worker` runs trace jobs (BE-05); `Build`, the build step, is shared with `vizctl`. Create, get and wait are BE-06. See [the worker](#the-worker) |
| `internal/ports` | `Sandbox` and its shared test suite `sandboxtest`, `JobQueue`, `BlobStore` and `Adapters`. Later `MetaStore`, `Events` | `Sandbox`, `JobQueue` and `Adapters` done; `BlobStore` puts only. See [sandbox](sandbox.md) |
| `internal/adapters/nsjail` | The production sandbox (D10, G1) | Done |
| `internal/adapters/dockersandbox` | The dev sandbox for laptops; not a security boundary | Done |
| `internal/adapters/mysql` | The connection pool, goose migrations, sqlc query files, the transaction retry helper `InTx`, and the `JobQueue` adapter on the `jobs` table | Tables and queue done (BE-06 §2, BE-05 §1); the worker runs the queue |
| `internal/adapters/blobstore` | `BlobStore` on any S3 API (aws-sdk-go-v2); SeaweedFS in dev | Put with 3 retries; presign and copy come with BE-06 |
| `internal/adapters/manifest` | `Adapters`: every `*/manifest.yaml` in a directory, checked once at load | Done; `vizctl` and the worker use it, `GET /languages` will |
| `internal/shim` | The `viz-shim` frame codec, shared by both sandboxes | Done |
| `internal/transport/http` | HTTP handlers | Health probes only (BE-06) |
| `internal/gen/{api,trace,wire,sqlc}` | Types generated from the contracts, and query code generated from the SQL, by `make gen`. Never edited | Generated |
| `schema/` | `trace.v1` and `wire.v1` JSON Schemas, and the Go package that validates against them | Done |
| `api/` | `openapi.yaml`, the HTTP contract | Done (BE-01) |
| `adapters/<language>/` | Each language's manifest, runner image and tracer | Python done (BE-03); C++ is a GDB prototype (BE-08 §1) |
| `fixtures/<language>/<case>/` | Programs and the traces they must produce | 8 Python fixtures with goldens; 3 C++ programs without |

## One visualization, end to end

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as vizd api
  participant D as MySQL
  participant W as vizd worker
  participant S as Sandbox box
  participant O as Object storage
  B->>A: POST /visualizations
  A->>D: insert trace + job (single-flight on cache_key)
  W->>D: lease the job (SKIP LOCKED)
  W->>S: build, then trace
  S-->>W: fd 1/2/3 through viz-shim
  W->>W: tracecore: validate, IDs, deltas, limits, chunks
  W->>O: put chunks
  W->>D: header, status completed
  B->>A: GET /visualizations/{id}?wait=20
  A-->>B: manifest with signed chunk URLs
  B->>O: fetch chunks
```

Built today: everything from "lease the job" on. The worker claims jobs from MySQL, runs them through the sandbox and `tracecore`, puts the chunks in object storage and completes the trace. The API (BE-06) is next. The lifecycle is spec §7.6, the job states §7.7 and the queue §7.13.2.

## The worker

`app.Worker` runs one job at a time per process (one slot, §7.9), under `vizd --role=worker` or `all`.

- **Loop** (`Run`, owned by `vizd`): rescue expired leases at most every 10 s, sweep sandbox leftovers every minute and old jobs every hour, then claim. An empty queue is polled every 200 ms (±20%), every 1 s after 10 empty claims; after a job it claims again at once.
- **Job:** `queued → building → tracing → completed`, or `failed` when the build fails. `building` is skipped when the manifest has no build. Upload and `Complete` happen last.
- **Watcher** (one goroutine per job, owned by the job): every second it writes `progress_steps` if the step count moved, else checks the lease. A lost lease cancels the job's context, which kills the sandbox, and nothing more is written.
- **Deadlines:** sandbox start, build and trace within 30 s of the claim (§7.7); build and trace also within the 15 s wall time (§11), the build within its manifest timeout; upload and `Complete` within the 45 s lease.
- **Outcomes:** the program's own end, timeouts and limits included, completes the trace and is never retried. `domain.ErrInfra` (sandbox, storage, a status write, a language this worker can't run) requeues, and the queue fails the second attempt with `internal_error`. Malformed tracer output fails with `internal_error` and logs the core's redacted error.
- **Drain:** on SIGTERM `/readyz` fails, the loop stops claiming, and the running job gets 25 s. Then its context is canceled and it is requeued with a context that outlives it. HTTP shuts down after the worker returns.
- **Name:** `leased_by` is the hostname plus a random suffix, so a restarted process never writes under its predecessor's lease.

## Shape of the code

- **Languages are data.** A language is a manifest and a runner image (§7.2 #5). `vizctl`, `tracecore` and the fixture test never branch on a language name.
- **Contracts are generated.** `api/openapi.yaml` and `schema/*.json` are the source of truth for the Go and TypeScript types, and CI fails on drift (D14).
- **Everything out of the sandbox is hostile.** The core validates every wire message and enforces every §11 limit outside the sandbox (§12).
- **Two stateful systems only:** MySQL and S3-compatible object storage (D4). No Redis, no message broker.

## Read next

| Doc | For |
|---|---|
| [Sandbox](sandbox.md) | The `Sandbox` port, `viz-shim`, nsjail and the Docker dev sandbox |
| [Tracing](tracing.md) | Manifest to trace: the Python tracer, the wire contract, `tracecore`, `vizctl` |
| [Guides](../guides/) | Tasks: adding a language, running the tests, writing migrations |
| [Conventions](../conventions/) | How to write comments and tests here |
