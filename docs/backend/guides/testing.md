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
| `go test ./internal/adapters/blobstore` | Against the SeaweedFS from `compose.yaml` (testcontainers). `Put`: the object lands under `domain.ChunkKey` with its bytes, `Content-Encoding: gzip`, the JSON content type and `Cache-Control`; storage answering 503 gets 4 attempts (§7.8), then `ErrInfra`. `Sign`: the URL downloads through a proxy standing in for the public endpoint and lasts 15 minutes. `Delete` removes the keys and skips missing ones, takes more than the 1,000 keys one S3 call allows, and fails with `ErrInfra` when the store refuses a key. An unreachable endpoint gives `ErrInfra` for `Put` and `Delete`. About 30 s, most of it the SDK's retry backoff | Docker |
| `go test ./internal/adapters/manifest` | Loading a directory of manifests into `domain.Manifest`: the build timeout, env order, no build, lookup by id, and the manifests it refuses | — |
| `go test ./internal/adapters/dockersandbox/` | The shared sandbox suite against the Docker adapter, plus adapter-only cases: missing image, emulated image, unreachable daemon, the janitor (old leftovers go, running boxes stay), `Close`. About 10 s once images are cached | Docker |
| `make test-nsjail` | The shared suite against the nsjail adapter, plus adapter-only cases: missing image, failed jail setup, a cgroup without controllers, the janitor, `Close`. It builds `viz-nsjail-test:dev` and runs it privileged with `scripts/nsjail-cgroups.sh`. `go test ./...` skips these tests outside that container | Docker that can run privileged containers, cgroup v2 |
| `go test ./cmd/vizctl` | `TestGoldenTraces` runs every `fixtures/<language>/<case>/` through `vizctl trace` in the Docker dev sandbox and compares it with `expected.trace.json`. `TestTraceNamesBuildFailure` covers Python's `compile_error` and `unsupported_module`, and the §8.3 C++ program failing with GCC's exact message | Docker, the runner images |
| `go test ./cmd/vizd` | The `VIZ_ENV` and `VIZ_SANDBOX` rules | — |
| `go test ./internal/transport/http` | `/readyz` fails while stopping and when MySQL is down. The API's HTTP mapping against real MySQL and SeaweedFS: every error code from `openapi.yaml` with its status and envelope, each visualization state checked against the contract, `201` with `Location`, the 5-minute languages cache, the caller hash (IPv4, IPv6 /64, `X-Forwarded-For` from loopback only), request IDs, CORS, non-JSON bodies, a parked `GET` released when the poller stops, and only 5xx logged. About 45 s | Docker (testcontainers MySQL, SeaweedFS) |
| `go test ./internal/adapters/mysql` | Migrations go up, down and up again. Sessions are READ COMMITTED and UTC whatever the DSN says. `InTx` retries the victim of a real deadlock and stops after 3 tries. The `JobQueue` adapter: claim order, `run_after`, SKIP LOCKED, concurrent claimers, every write under a lost lease, the rescuer on both sides of the lease expiry, requeue, cancel and the cleanup batches. `TestNoJobIsLostOrCompletedTwiceWhenWorkersDieAtRandom` kills workers at random and logs its seed. `Store` wraps only connection errors in `ErrInfra`. The change poller: a wait returns only when a poll sees its trace above `since`, polls run every 250 ms only while a request is parked (`synctest`), the 5,001st request is refused, a failed query keeps requests parked, full batches don't stall it, a stopped poller wakes everyone, and a version bump wakes a wait within 400 ms. One MySQL container per run and a fresh database per test; about 25 s | Docker (testcontainers MySQL) |
| `go test ./internal/app` | `Build` with a scripted box: GCC 13 output captured in `testdata/gcc/` becomes the right diagnostics (system-header errors on the user's line, fatal errors, notes dropped, an undefined reference), `FuzzBuildDiagnostics` never yields one outside the API's range, and the safety flags go on unless `safetyChecks` is false, with `build.env`. The worker against real MySQL and SeaweedFS. End to end with the Docker sandbox and the Python runner image: a completed program, an uncaught exception (completed, not retried), `compile_error` and `unsupported_module` with their diagnostics. With a scripted fake sandbox: skipping `building`, a sandbox that fails to start, a language the worker can't run, malformed tracer output (and no user data in the logs), the wall-time deadline, a lost lease, storage down, a crashed worker's job rescued on the 10 s schedule, both drain outcomes, progress throttling and the idle backoff. Every wait goes through a scripted clock, so nothing sleeps. `Visualizations` against real MySQL and SeaweedFS: concurrent identical creates make one trace and one job, bad requests take no quota, the quota resets at the next UTC day, idempotency keys, the 2-active rule, the queue cap, which traces are reset, each state `Get` shows, expiry, waiting, a refused `wait` or `since`, owner-only delete, and the cleanup batches and the chunks it leaves behind. About 60 s, mostly containers and the SDK's retry backoff | Docker, the Python runner image |

## The shared sandbox suite

`sandboxtest.Run(t, sandbox, image)` in `internal/ports/sandboxtest` is the contract every sandbox adapter passes. It covers:

- exit codes and signals;
- the three streams, including a 50 MB single-line write and output that goes out ahead of the wire line written after it;
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
- **`fixtures/<language>/<case>/expected.trace.json`:** real programs traced end to end by `vizctl trace`. The language list comes from `adapters/*/manifest.yaml` and the cases from the directories, so a new fixture directory is picked up with no code change. The trace ID, `0x…` addresses inside opaque summaries, and every pointer's `addr` except `0x0` are masked. A pointer's `addr` becomes `0xdeadbeef` wherever it appears: in locals, return values, sequence items, record fields and map entries.

`make golden-update` rewrites both from real runs. Read the diff before you commit it: a golden that changed is a behavior that changed.

Both sets must pass on amd64 and arm64. CI runs them on amd64 inside `make check` and on arm64 in the `golden-arm64` job (`ubuntu-24.04-arm`). The core's goldens mask `0x…` addresses and `long double` values. In the fixture goldens, a pointer's `addr` is a real address (a stack one is `0xffff…` on arm64 and `0x7fff…` on amd64), so it's masked. Nothing else needs a mask, because heap ids become `o1, o2…`, and the Python fixtures and C++ wire sessions come out the same on both architectures. The C++ fixtures have only been traced on arm64 so far (GDB can't run under emulation). What the C++ tracer stops on is each `main.cpp` row of the line table, so every C++ fixture's table was compared instead: built with the manifest's flags (`build.cmd` plus `build.safetyFlags`) on both architectures, the `main.cpp` rows in pc order have the same lines and `is_stmt` flags. Only the column order inside one line differs, in `sort(v.begin(), v.end())` for example, whose arguments GCC evaluates in the other order on amd64; stops that move forward on one line make no step. Check a new C++ fixture the same way: build it in `gcc:13.5.0` with `--platform linux/amd64` and natively, and compare the `main.cpp` rows of `objdump --dwarf=decodedline`. A fixture must also stay away from what really differs between them: an address printed by the program, a C++ local shown before it's assigned (stack garbage, a VLA's included), a `char` above 127 (signed on amd64, unsigned on arm64) and `long double` arithmetic (80-bit on amd64, 128-bit on arm64).

`go test` caches the `vizctl` result and can't see changes to `tracer.py` or `trace.py`, which live in the runner images. After editing a tracer, run `make runner-images` and then `go test -count=1 ./cmd/vizctl`.

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

| C++ fixture | What it pins |
|---|---|
| `array-pointer` | A global `int*` walking a local `int[5]`: `target` and `index` into an array that comes later in the step than the pointer, and no `target` once the pointer is one past the end |
| `exception` | A `runtime_error` thrown two calls deep and caught in `main`: the throwing call and its caller, which holds a `std::string`, end with no return step, and the next steps are `main`'s `catch` lines |
| `fib` | The Python `fib` port: `fib(5)` inside a `cout` line, 15 calls with the right `parentCallId`, and each return step with its value |
| `implicit` | A `struct` with a `std::string` member, pushed as `{"pen", 2}`, copied, and captured by value in a lambda: its implicit constructors and destructors and the closure's make no steps, and the aggregate temporaries make no step on `main`'s closing brace |
| `input` | `cin >>` in a loop, then `getline`, reading `/work/stdin`. The loop-body local `x` is `uninit` again on each iteration's declaration line |
| `long` | The Python `long` port, 2,000 iterations: 1,000 steps, `step_limit`, no step after the marker, and the untraced tail with the program's normal exit and all 8 bytes of its output |
| `loop` | A `for` loop: `sum` and `i` `uninit` on their declaration lines until they run, `i` gone after the loop, and `main`'s return step with `0` |
| `methods` | A constructor, a method and a destructor as `method` frames, with `this` followed to the `Counter` record and `returnValue: null`. The one-line constructor's return step shows `n` after its initializer ran. A lambda as a `<lambda>` frame of kind `lambda`, with its return value |
| `one-line` | One-line functions: `chmax` (a template) and `add` return showing their reference parameters after the body ran, with `chmax`'s `true` and `false`. `sort` calls a one-line lambda comparator from library code: a call and a return step per comparison |
| `pointer` | The §5.4 program: `MAXN` and the global `int[200005]` (100 items, `truncated`, `window`, the real `length`) in the globals frame, a `vector`, a `map<string, int>`, and two `Node` records linked through `head->next`. `sort` makes no steps |
| `range-for` | A range-for over a vector: `__for_range`, `__for_begin` and `__for_end` hidden by default, `x` taking each element, one step per iteration on the `for` line |
| `read-loop` | A VLA sized from stdin, then `for (...) cin >> a[i];` on one line over 1,200 numbers: the call step on `main`'s first statement, not its closing brace, one step per iteration, `step_limit` at 1,000 steps, and the untraced tail with the full output and the normal exit. It reads back to front, so the VLA's 100-item window stays zero and the golden stays small |
| `recursion` | `fib(4)`: 9 calls, each with its own frame and the right `parentCallId`, two of them from one line, and each return step with its value |
| `segfault` | `arr` pointing into the global `cnt` (`index` 0), then a write about 2 GB past it: the output printed before it, an `exception` step on the innermost call's line with `SIGSEGV` and "Segmentation fault", and `exit.kind = signal` |
| `stack-overflow` | Recursion with 32 MiB frames: the eighth call overflows the stack before its first line, so the `SIGSEGV` step is on the seventh call's line, not a `memory_limit`. Each `pad` is a 100-item window of 8,388,608 |
| `stl` | The checked build (`std::__debug::vector`, `std::__debug::map`): a vector sorted in place, a `map<string, int>` growing, a `std::string`, a struct as a record with a pointer to it, a global `int[3][4]` in the globals frame. The first stop is line 12; the S1a wire session from GCC 15 stops at 11 first |
| `sync-stdio` | `ios::sync_with_stdio(false)` and `cin.tie(nullptr)` with no `endl`: each `cout` shows up on the step after the line that printed it |
| `values` | `float`, `double`, `char`, an `enum`, `bool`, `__int128`, a UTF-8 `std::string`, a 1,500-byte one cut to 1,000 with `len` and `truncated`, a `const string&` parameter, and a 24-byte struct returned by value (on arm64 through the `x8` address) |

## Captured GCC output

`internal/app/testdata/gcc/<case>/` holds a `main.cpp` and the `build.txt` the C++ runner image printed for it. After changing the image or the manifest's build flags, recapture each case from its directory:

```sh
docker run --rm --network none -i -w /work --tmpfs /work -e TMPDIR=/work viz-runner-cpp:13.5-gdb14-1 \
  sh -c 'cat > main.cpp && g++ -std=gnu++17 -O0 -g3 -fno-omit-frame-pointer --coverage -Wall -Wextra -Wshadow -fdiagnostics-plain-output --param ggc-min-heapsize=32768 --param ggc-min-expand=30 main.cpp /opt/viz/flush_init.cpp -o main -D_GLIBCXX_DEBUG -fsanitize=undefined -fno-sanitize-recover=all 2>&1' \
  < main.cpp > build.txt
```

- The flags are `build.cmd` then `build.safetyFlags` from `adapters/cpp/manifest.yaml`, run in `/work` as in the sandbox.
- Leave `LANG` unset, as the image and the sandbox do. Under a UTF-8 locale GCC prints curly quotes, and the messages no longer match the tests.
- The captures come from arm64, so their header paths say `aarch64-linux-gnu`. The parser doesn't care.
- `undefined-reference` names a random temp object (`/work/ccXXXXXX.o`) that changes on every capture.

## Fuzzing

Every byte parser has a fuzz target (test 9). Run one for a while after you change its parser, and commit any failing input it finds under the package's `testdata/fuzz/`:

```sh
go test ./internal/shim -fuzz=FuzzReader -fuzztime=30s       # the viz-shim frame stream
go test ./internal/tracecore -fuzz=FuzzWire -fuzztime=30s    # the tracer's fd-3 NDJSON
```
