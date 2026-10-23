# Running the backend tests

What each test package covers, what it needs, and how to update goldens. How to write a test is in the [testing cheat sheet](../conventions/testing-cheat-sheet.md). Run every command from `backend/`.

## Before you start

- **Docker must be running.** The MySQL tests use testcontainers, and the sandbox and fixture tests start containers.
- **On OrbStack or Colima, export `DOCKER_HOST` first.** For OrbStack it's `export DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock` (backend README, Common problems).
- **`make test` builds the runner images first** (`make runner-images`), because the fixture test traces real programs in them. Plain `go test ./...` fails the fixture test with "run make images" if they're missing.
- **Packages run in parallel against one Docker daemon.** That works because a sandbox's janitor removes only boxes older than 2 minutes ([sandbox](../architecture/sandbox.md#architecture-check-and-janitor)).

## What each run covers

| Run | What it covers | Needs |
|---|---|---|
| `make test` | `go test ./...` after building the runner images | Docker |
| `make check` | lint, govulncheck, `make test`, `make test-nsjail`, then fails on `go mod tidy` or `make gen` drift. Run it before pushing; CI runs the same | Docker that can run privileged containers |
| `go test ./api` | `openapi.yaml` is valid OpenAPI 3.1, its examples match their schemas, each visualization status has its fields | — |
| `go test ./schema` | Both JSON Schemas accept the examples in `testdata/` and reject each broken field. The generated types round-trip. Validator errors never quote their input | — |
| `go test ./internal/tracecore` | Unit tests at the seam: ID order, deltas, internals, each limit on both sides of its boundary, the step-limit marker and tail, output attribution, malformed and out-of-order input, lines split across writes, chunks. `TestGolden` turns the wire inputs in `testdata/wire/` and `schema/testdata/wire/` into `testdata/golden/*.trace.json`. `TestDeltasReplayToFullSteps` rebuilds every step from its keyframe and deltas | — |
| `go test ./internal/shim` | The frame codec round-trips and rejects bad frames | — |
| `go test ./internal/adapters/blobstore` | `Put` against the SeaweedFS from `compose.yaml` (testcontainers): the object lands under `domain.ChunkKey` with its bytes, `Content-Encoding: gzip`, the JSON content type and `Cache-Control`. Storage answering 503 gets 4 attempts (§7.8), then `ErrInfra`; an unreachable endpoint gives `ErrInfra` too. About 20 s, most of it the SDK's retry backoff | Docker |
| `go test ./internal/adapters/manifest` | Loading a directory of manifests into `domain.Manifest`: the build timeout, env order, no build, lookup by id, and the manifests it refuses | — |
| `go test ./internal/adapters/dockersandbox/` | The shared sandbox suite against the Docker adapter, plus adapter-only cases: missing image, emulated image, unreachable daemon, the janitor (old leftovers go, running boxes stay), `Close`. About 10 s once images are cached | Docker |
| `make test-nsjail` | The shared suite against the nsjail adapter, plus adapter-only cases: missing image, failed jail setup, a cgroup without controllers, the janitor, `Close`. It builds `viz-nsjail-test:dev` and runs it privileged with `scripts/nsjail-cgroups.sh`. `go test ./...` skips these tests outside that container | Docker that can run privileged containers, cgroup v2 |
| `go test ./cmd/vizctl` | `TestGoldenTraces` runs every `fixtures/<language>/<case>/` through `vizctl trace` in the Docker dev sandbox and compares it with `expected.trace.json`. `TestTraceNamesBuildFailure` covers `compile_error` and `unsupported_module` | Docker, the runner images |
| `go test ./cmd/vizd` | The `VIZ_ENV` and `VIZ_SANDBOX` rules | — |
| `go test ./internal/transport/http` | `/readyz` fails while stopping and when MySQL is down | Docker (testcontainers MySQL) |
| `go test ./internal/adapters/mysql` | Migrations go up, down and up again. Sessions are READ COMMITTED and UTC whatever the DSN says. `InTx` retries the victim of a real deadlock and stops after 3 tries. The `JobQueue` adapter: claim order, `run_after`, SKIP LOCKED, concurrent claimers, every write under a lost lease, the rescuer on both sides of the lease expiry, requeue, cancel and the cleanup batches. `TestNoJobIsLostOrCompletedTwiceWhenWorkersDieAtRandom` kills workers at random and logs its seed. One MySQL container per run and a fresh database per test; about 15 s | Docker (testcontainers MySQL) |

## The shared sandbox suite

`sandboxtest.Run(t, sandbox, image)` in `internal/ports/sandboxtest` is the contract every sandbox adapter passes. It covers:

- exit codes and signals;
- the three streams, including a 50 MB single-line write;
- files and `/work` surviving between runs;
- the deadline (on a busy loop) and cancel;
- a failing writer;
- the memory limit and deep recursion;
- the PID limit and a fork bomb;
- TCP, UDP and DNS;
- host processes out of reach;
- new namespaces refused by seccomp;
- read-only paths and the size of `/work`;
- non-root without capabilities;
- the stack rlimit;
- turning ASLR off.

To add a case, add a table entry whose `name` states the behavior and give it one or more steps. Each case gets its own box and runs in parallel.

The dockersandbox tests build their image, `viz-sandboxtest:dev`, themselves: busybox (pinned by digest) plus a `viz-shim` compiled for the daemon's architecture.

## Golden traces

Two sets of goldens pin trace output (test 8):

- **`internal/tracecore/testdata/golden/`:** wire inputs turned into traces by the core alone. No sandbox is involved.
- **`fixtures/<language>/<case>/expected.trace.json`:** real programs traced end to end by `vizctl trace`. The language list comes from `adapters/*/manifest.yaml` and the cases from the directories, so a new fixture directory is picked up with no code change. The trace ID and `0x…` addresses inside opaque summaries are masked.

`make golden-update` rewrites both from real runs. Read the diff before you commit it: a golden that changed is a behavior that changed.

Both sets must pass on amd64 and arm64. CI runs them on amd64 inside `make check` and on arm64 in the `golden-arm64` job (`ubuntu-24.04-arm`). The core's goldens mask `0x…` addresses and `long double` values; nothing else needs a mask, because heap ids become `o1, o2…` and the Python fixtures and C++ wire sessions come out the same on both architectures. A new fixture must stay away from what really differs between them: an address printed by the program, a C++ local shown before it's assigned (stack garbage), a `char` above 127 (signed on amd64, unsigned on arm64) and `long double` arithmetic (80-bit on amd64, 128-bit on arm64).

`go test` caches the `vizctl` result and can't see changes to `tracer.py`, which lives in the runner image. After editing a tracer, run `make runner-images` and then `go test -count=1 ./cmd/vizctl`.

| Python fixture | What it pins |
|---|---|
| `aliasing` | The §5.3 program: `a` and `b` share one object, `c` is a copy, a call with its return value |
| `binary-search` | Loops, a function returning found and not-found |
| `fib` | Recursion: 15 calls with the right `parentCallId` |
| `exception` | A caught `IndexError`, then an uncaught one: two exception steps and `exit.kind = exception` |
| `input` | Several `input()` calls: no step outside `main.py`, `stdinPos` advancing |
| `long` | Over 1,000 steps: `step_limit`, the untraced tail with the full output, `lineHits` for the whole run |
| `recursion-limit` | A `RecursionError` step, then the program catches it and finishes |
| `thread-main` | The CP thread trick: the thread's frames on top of the module frame |

## Fuzzing

Every byte parser has a fuzz target (test 9). Run one for a while after you change its parser, and commit any failing input it finds under the package's `testdata/fuzz/`:

```sh
go test ./internal/shim -fuzz=FuzzReader -fuzztime=30s       # the viz-shim frame stream
go test ./internal/tracecore -fuzz=FuzzWire -fuzztime=30s    # the tracer's fd-3 NDJSON
```
