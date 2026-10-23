# Backend overview

The backend is one Go module, `backend/`. It holds two binaries and a shim, the tracers that run inside the sandbox, and the contracts both halves of the product are generated from. Spec §7 is the architecture; this page maps it onto the code as it stands on Sat 24 Oct 2026 and says what is built. The rules for changing it are in [AGENTS.md](../../../AGENTS.md).

## Binaries

| Binary | Where | Job | Built so far |
|---|---|---|---|
| `vizd` | `cmd/vizd` | The service, with roles `api`, `worker` or `all` (D3) | Config, the sandbox choice check, the MySQL pool, `vizd migrate`, `/healthz` and `/readyz`. The API is BE-06 and the worker BE-05 |
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
| `internal/domain` | Sentinel errors (`ErrInfra`), the language `Manifest` and `ChunkKey`; later the job states, limits and IDs | Started |
| `internal/tracecore` | Wire stream in, trace out: stable IDs, keyframes and deltas, limits, chunks | Done (BE-04 §2). See [tracing](tracing.md) |
| `internal/app` | Use cases: create, get and wait, run a trace job | Empty (BE-05, BE-06) |
| `internal/ports` | `Sandbox` and its shared test suite `sandboxtest`, `BlobStore` and `Adapters`. Later `MetaStore`, `JobQueue`, `Events` | `Sandbox` and `Adapters` done; `BlobStore` puts only. See [sandbox](sandbox.md) |
| `internal/adapters/nsjail` | The production sandbox (D10, G1) | Done |
| `internal/adapters/dockersandbox` | The dev sandbox for laptops; not a security boundary | Done |
| `internal/adapters/mysql` | The connection pool and goose migrations | Open and migrate only; no tables yet (BE-06) |
| `internal/adapters/blobstore` | `BlobStore` on any S3 API (aws-sdk-go-v2); SeaweedFS in dev | Put with 3 retries; presign and copy come with BE-06 |
| `internal/adapters/manifest` | `Adapters`: every `*/manifest.yaml` in a directory, checked once at load | Done; `vizctl` uses it, the worker and `GET /languages` will |
| `internal/shim` | The `viz-shim` frame codec, shared by both sandboxes | Done |
| `internal/transport/http` | HTTP handlers | Health probes only (BE-06) |
| `internal/gen/{api,trace,wire}` | Types generated from the contracts by `make gen`. Never edited | Generated |
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

Built today: the sandbox, the Python tracer and `tracecore`, which `vizctl trace` runs in that order. The API (BE-06), the MySQL queue and the worker (BE-05), and object storage are the next tasks. The lifecycle is spec §7.6, the job states §7.7 and the queue §7.13.2.

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
