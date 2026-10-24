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
| `make check` | lint, govulncheck, `make typecheck`, `make test`, `make test-nsjail`, then fails on `go mod tidy` or `make gen` drift. Run it before pushing; CI runs the same | Docker that can run privileged containers, Node 24 |
| `make typecheck` | pyright 1.1.414 in strict mode on `adapters/python/tracer.py` and `adapters/wire.py` (`adapters/pyrightconfig.json`): every wire message the tracer builds matches the schema's TypedDicts | Node 24 |
| `go test ./api` | `openapi.yaml` is valid OpenAPI 3.1, its examples match their schemas, each visualization status has its fields | — |
| `go test ./schema` | Both JSON Schemas accept the examples in `testdata/` and reject each broken field. The generated types round-trip. Validator errors never quote their input | — |
| `go test ./internal/tracecore` | Unit tests at the seam: ID order, deltas, internals, each limit on both sides of its boundary, the step-limit marker and tail, output attribution, malformed and out-of-order input, lines split across writes, chunks. `TestGolden` turns the wire inputs in `testdata/wire/` and `schema/testdata/wire/` into `testdata/golden/*.trace.json`. `TestDeltasReplayToFullSteps` rebuilds every step from its keyframe and deltas, sparse arrays sent as random full forms and patches included. `sparse_test.go` covers patches, keyframes rebuilt from patches, each wire patch the core rejects, both cell limits, and a 1,000-step DFS over two `int[200005]` that must stay within 2 MiB gzipped with one-cell patches | — |
| `go test ./internal/shim` | The frame codec round-trips and rejects bad frames | — |
| `go test ./internal/adapters/blobstore` | Against the SeaweedFS from `compose.yaml` (testcontainers). `Put`: the object lands under `domain.ChunkKey` with its bytes, `Content-Encoding: gzip`, the content type it was given and `Cache-Control`; storage answering 503 gets 4 attempts (§7.8), then `ErrInfra`. `Sign`: the URL downloads through a proxy standing in for the public endpoint and lasts 15 minutes. `Delete` removes the keys and skips missing ones, takes more than the 1,000 keys one S3 call allows, and fails with `ErrInfra` when the store refuses a key. An unreachable endpoint gives `ErrInfra` for `Put` and `Delete`. About 30 s, most of it the SDK's retry backoff | Docker |
| `go test ./internal/adapters/manifest` | Loading a directory of manifests into `domain.Manifest`: the build timeout, env order, no build, lookup by id, and the manifests it refuses | — |
| `go test ./internal/adapters/dockersandbox/` | The shared sandbox suite against the Docker adapter, plus adapter-only cases: missing image, emulated image, unreachable daemon, the janitor (old leftovers go, running boxes stay), `Close`. About 10 s once images are cached | Docker |
| `make test-nsjail` | The shared suite against the nsjail adapter, plus adapter-only cases: missing image, failed jail setup, a cgroup without controllers, the janitor, `Close`. It builds `viz-nsjail-test:dev` and runs it privileged with `scripts/nsjail-cgroups.sh`. `go test ./...` skips these tests outside that container | Docker that can run privileged containers, cgroup v2 |
| `go test ./cmd/vizctl` | `TestGoldenTraces` runs every `fixtures/<language>/<case>/` through `vizctl trace` in the Docker dev sandbox and compares it with `expected.trace.json`. A fixture with an `options.json` is traced with those options (`vizctl trace --options`). `TestTypeMapRowsHaveFixtures` fails when a row of `adapters/cpp/typemap.json` shows up in no `fixtures/cpp/type-*` golden, and `TestErrorKindsHaveFixtures` when an `errorKind` of `trace.v1.schema.json` is on no golden's error step. `TestPortsAgreeAcrossLanguages` compares the goldens of every case name that has more than one language: exit kind, the untraced tail's exit, call depths, return count, the error step's depth, aliases, and the kinds of the variables both programs name (a Python `list` and a C++ `vector` are both `sequence`). It reads only the committed goldens. `TestCaptureRangesKeepTheSteps` traces each fixture whose `options.json` has `captureRanges` again without them and compares every step's event, line and output with the golden, so a re-run for a range lands on the same steps. `TestTraceNamesBuildFailure` covers Python's `compile_error` and `unsupported_module`, and the §8.3 C++ program failing with GCC's exact message | Docker, the runner images |
| `go test ./cmd/vizd` | The `VIZ_ENV` and `VIZ_SANDBOX` rules | — |
| `go test ./internal/transport/http` | `/readyz` fails while stopping and when MySQL is down. The API's HTTP mapping against real MySQL and SeaweedFS: every error code from `openapi.yaml` with its status and envelope, each visualization state checked against the contract, `201` with `Location`, the 5-minute languages cache, the caller hash (IPv4, IPv6 /64, `X-Forwarded-For` from loopback only), request IDs, CORS, non-JSON bodies, a parked `GET` released when the poller stops, and only 5xx logged. About 45 s | Docker (testcontainers MySQL, SeaweedFS) |
| `go test ./internal/adapters/mysql` | Migrations go up, down and up again. Sessions are READ COMMITTED and UTC whatever the DSN says. The pool holds at most 32 connections and keeps them all idle once released. `InTx` retries the victim of a real deadlock and stops after 3 tries. The `JobQueue` adapter: claim order, `run_after`, SKIP LOCKED, concurrent claimers, every write under a lost lease, the rescuer on both sides of the lease expiry, requeue, cancel and the cleanup batches. `TestNoJobIsLostOrCompletedTwiceWhenWorkersDieAtRandom` kills workers at random and logs its seed. `Store` wraps only connection errors in `ErrInfra`. The change poller: a wait returns only when a poll sees its trace above `since`, polls run every 250 ms only while a request is parked (`synctest`), the 5,001st request is refused, a failed query keeps requests parked, full batches don't stall it, a stopped poller wakes everyone, and a version bump wakes a wait within 400 ms. One MySQL container per run and a fresh database per test; about 25 s | Docker (testcontainers MySQL) |
| `go test ./internal/app` | `Build` with a scripted box: GCC 13 output captured in `testdata/gcc/` becomes the right diagnostics (system-header errors on the user's line, fatal errors, notes dropped, an undefined reference), `FuzzBuildDiagnostics` never yields one outside the API's range, and the safety flags go on unless `safetyChecks` is false, with `build.env`. The worker against real MySQL and SeaweedFS. End to end with the Docker sandbox and the Python runner image: a completed program, an uncaught exception (completed, not retried), `compile_error` and `unsupported_module` with their diagnostics. With a scripted fake sandbox: skipping `building`, a sandbox that fails to start, a language the worker can't run, malformed tracer output (and no user data in the logs), the wall-time deadline, the output after the step limit stored as `tail.txt.gz` and none within it, a lost lease, storage down, a crashed worker's job rescued on the 10 s schedule, both drain outcomes, progress throttling and the idle backoff. Every wait goes through a scripted clock, so nothing sleeps. `Visualizations` against real MySQL and SeaweedFS: concurrent identical creates make one trace and one job, bad requests take no quota, the quota resets at the next UTC day, idempotency keys, the 2-active rule, the queue cap, which traces are reset, each state `Get` shows (a tail's signed URL included), expiry, waiting, a refused `wait` or `since`, owner-only delete, and the cleanup batches, the chunks and tails it deletes and the chunks it leaves behind. About 60 s, mostly containers and the SDK's retry backoff | Docker, the Python runner image |

## Benchmarks

`go test -run '^$' -bench . ./internal/app` runs the job pipeline against the testcontainers MySQL and SeaweedFS, with a scripted sandbox that replays a 40- or 1,000-step Python wire stream (`load_bench_test.go`). It reports jobs/s and the CPU that Go, MySQL and SeaweedFS each spend per job, plus the cost of a create and of an idle claim. The results and the HTTP load harness are in `plans/spikes/load-capacity.md`.

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
- **`fixtures/<language>/<case>/expected.trace.json`:** real programs traced end to end by `vizctl trace`. The language list comes from `adapters/*/manifest.yaml` and the cases from the directories, so a new fixture directory is picked up with no code change. The trace ID, `0x…` addresses inside opaque summaries and stderr (libstdc++'s debug reports print the container's address), and every pointer's `addr` except `0x0` are masked. A pointer's `addr` becomes `0xdeadbeef` wherever it appears: in locals, return values, sequence items, record fields and map entries.

Every golden's summary has `lineHits`: `counter` for Python, `gcov` for a C++ program that exits normally, and `trace` (the recorded steps) for one that dies by a signal or a sanitizer.

`make golden-update` rewrites both from real runs. Read the diff before you commit it: a golden that changed is a behavior that changed.

Both sets must pass on amd64 and arm64. CI runs them on amd64 inside `make check` and on arm64 in the `golden-arm64` job (`ubuntu-24.04-arm`). The core's goldens mask `0x…` addresses and `long double` values. In the fixture goldens, a pointer's `addr` is a real address (a stack one is `0xffff…` on arm64 and `0x7fff…` on amd64), so it's masked. Nothing else needs a mask, because heap ids become `o1, o2…`, and the Python fixtures and C++ wire sessions come out the same on both architectures. The C++ fixtures have only been traced on arm64 so far (GDB can't run under emulation). What the C++ tracer stops on is each `main.cpp` row of the line table, so every C++ fixture's table was compared instead: built with the manifest's flags (`build.cmd` plus `build.safetyFlags`) on both architectures, the `main.cpp` rows in pc order have the same lines and `is_stmt` flags. Only the column order inside one line differs, in `sort(v.begin(), v.end())` for example, whose arguments GCC evaluates in the other order on amd64; stops that move forward on one line make no step. Check a new C++ fixture the same way: build it in `gcc:13.5.0` with `--platform linux/amd64` and natively, and compare the `main.cpp` rows of `objdump --dwarf=decodedline`. A fixture must also stay away from what really differs between them: an address printed by the program, a C++ local shown before it's assigned (stack garbage, a VLA's included), a `char` above 127 (signed on amd64, unsigned on arm64) and `long double` arithmetic (80-bit on amd64, 128-bit on arm64).

`go test` caches the `vizctl` result and can't see changes to `tracer.py` or `trace.py`, which live in the runner images. After editing a tracer, run `make runner-images` and then `go test -count=1 ./cmd/vizctl`.

| Python fixture | What it pins |
|---|---|
| `aliasing` | The §5.3 program: `a` and `b` share one object, `c` is a copy, a call with its return value |
| `binary-search` | Loops, a function returning found and not-found |
| `capture-ranges` | `options.json` asks for `dist[2495..2499]`, `dist[2502..2504]` and `names[1195..1204]`: lists of 3,000 (shuffled by the seeded `random`) and 1,500 record those windows instead of their first 1,000 items |
| `fib` | Recursion: 15 calls with the right `parentCallId` |
| `exception` | A caught `IndexError`, then an uncaught one: two exception steps with `index_out_of_range` (`name` `a`, `index`, `size` 3, `type` `list`) and `exit.kind = exception` |
| `error-divide` | `total // count` with `count` 0 in a function: `division_by_zero` with `expr` and `divisor` |
| `error-index-grid` | `grid[r][c]` one column too far: `name` is `grid[r]`, the inner list's size |
| `error-index-object` | `row[slot]` with an `__index__` that prints: the program's own call is the only one, so reading the values never runs the program's code, and there is no `index` |
| `error-other` | `int("ten")`: a `ValueError` step with no `kind` |
| `input` | Several `input()` calls: no step outside `main.py`, `stdinPos` advancing |
| `long` | Over 1,000 steps: `step_limit`, the untraced tail with the full output, `lineHits` for the whole run |
| `recursion-limit` | A `RecursionError` step with `recursion_too_deep` and the user's `limit` 100, then the program catches it and finishes |
| `start-at-line` | `startAtLines` 6 and 12: the first step is the `print` inside `sum_to` at `i == 5`, with the module frame under it and the earlier output; line hits cover the whole run |
| `start-never` | `startAtLines` on a branch that never runs: no steps, the program's normal exit, line hits |
| `thread-main` | The CP thread trick: the thread's frames on top of the module frame |
| `annotations` | The program's annotations stay evaluated: the tracer's own `from __future__ import annotations` doesn't reach the user's code |

| C++ fixture | What it pins |
|---|---|
| `aliasing` | The Python `aliasing` port: `vector<int> &b = a` is one object under two names, `c` a copy, a `map<string, int>` filled from a call's return value |
| `array-pointer` | A global `int*` walking a local `int[5]`: `target` and `index` into an array that comes later in the step than the pointer, and no `target` once the pointer is one past the end |
| `binary-search` | The Python `binary-search` port: loops and a function returning found and not-found |
| `capture-ranges` | `options.json` asks for `dist[15000..15004]`, `dist[15007..15009]` and `names[245..254]`: a global `int[20005]` filled by `rand()` (over 10,000 non-default cells) keeps the window 15000–15009, and a `vector<string>` of 300 the items 245–254 |
| `check-divide` | `total / count` with `count` 0 in a function: UBSan's `division_by_zero` on the function's line, then exit code 1 |
| `check-empty-queue` | `q.front()` after the only element is popped: `empty_container` from libstdc++'s assertion, `call` `front`, `name` `q`, then `SIGABRT` |
| `check-empty-set` | `*s.begin()` on an emptied set: libstdc++'s past-the-end check becomes `empty_container` with `call` `operator*` |
| `check-index-array` | `cnt[i]` with `i` 5 on a global `int[5]`: UBSan's `index_out_of_range` with `size` 5 from the type and no `name` |
| `check-index-string` | `s[5]` on a 4-character `string`: `index_out_of_range` from its assertion |
| `check-index-vector` | `i <= 5` over a 5-element `vector`: `index_out_of_range` from `_GLIBCXX_DEBUG` on the sixth pass, with `name` `a` |
| `check-overflow` | `sum += x` past `INT_MAX` in a range-for: `signed_overflow` with both operands, `type` `int` and `max` |
| `check-shift` | `1 << 40`: a UBSan step with no `kind`, message `shift out of bounds`, and UBSan's own text on stderr |
| `cin-getline` | `cin >>` in a loop, then `getline`, reading `/work/stdin`. The loop-body local `x` is `uninit` again on each iteration's declaration line |
| `exception` | The Python `exception` port: `a.at(i)` throws `out_of_range`, caught the first time; the second is uncaught and ends in `SIGABRT` inside `get`. A caught C++ exception makes no `exception` step (FR-8), so only the last error lines up with Python's |
| `fib` | The Python `fib` port: `fib(5)` inside a `cout` line, 15 calls with the right `parentCallId`, and each return step with its value |
| `implicit` | A `struct` with a `std::string` member, pushed as `{"pen", 2}`, copied, and captured by value in a lambda: its implicit constructors and destructors and the closure's make no steps, and the aggregate temporaries make no step on `main`'s closing brace |
| `input` | The Python `input` port: `n` names read into a `vector<string>`, then two numbers on one line, all from `/work/stdin` |
| `line-hits` | The §19.3 mock's binary search, two lines lower for the includes: gcov's counts are the mock's (`×9` on the range-for, `×1` on `vector<int> a(n);`, which gcov's own line count makes 2) |
| `long` | The Python `long` port, 2,000 iterations: 1,000 steps, `step_limit`, no step after the marker, and the untraced tail with the program's normal exit and all 8 bytes of its output |
| `loop` | A `for` loop: `sum` and `i` `uninit` on their declaration lines until they run, `i` gone after the loop, and `main`'s return step with `0` |
| `methods` | A constructor, a method and a destructor as `method` frames, with `this` followed to the `Counter` record and `returnValue: null`. The one-line constructor's return step shows `n` after its initializer ran. A lambda as a `<lambda>` frame of kind `lambda`, with its return value |
| `one-line` | One-line functions: `chmax` (a template) and `add` return showing their reference parameters after the body ran, with `chmax`'s `true` and `false`. `sort` calls a one-line lambda comparator from library code: a call and a return step per comparison |
| `pointer` | The §5.4 program: `MAXN` and the global `int[200005]` (sparse, default `0`, then a one-cell `patch`) in the globals frame, a `vector`, a `map<string, int>`, and two `Node` records linked through `head->next`. `sort` makes no steps |
| `range-for` | A range-for over a vector: `__for_range`, `__for_begin` and `__for_end` hidden by default, `x` taking each element, one step per iteration on the `for` line |
| `read-loop` | A VLA sized from stdin, then `for (...) cin >> a[i];` on one line over 1,200 numbers: the call step on `main`'s first statement, not its closing brace, one step per iteration, `step_limit` at 1,000 steps, and the untraced tail with the full output and the normal exit. The VLA is sparse: each iteration's delta is a one-cell `patch`, and each keyframe carries every number read so far |
| `recursion` | `fib(4)`: 9 calls, each with its own frame and the right `parentCallId`, two of them from one line, and each return step with its value |
| `start-at-line` | The Python `start-at-line` port: `startAtLines` 9 and 18 start inside `sum_to`, with `main`'s frame joined under it, and `sum_to` returns `36` |
| `start-never` | The Python `start-never` port: no breakpoint is ever hit, so the program runs to its exit with no steps; gcov still counts the lines |
| `segfault` | `arr` pointing into the global `cnt` (`index` 0), then a write about 2 GB past it: the output printed before it, an `exception` step on the innermost call's line with `SIGSEGV` and "Segmentation fault", and `exit.kind = signal` |
| `sparse-default` | `memset(dist, 0x3f, ...)` on a global `int[100005]` picks a new default, then one-cell patches; a `vector<int>` of 100 grows past its capacity and is sent whole; `bool[80]` and `double[70]` are sparse too |
| `sparse-dfs` | A DFS writing two global `int[200005]`: full sparse forms on the first step, one-cell patches after, keyframes with every cell written so far |
| `sparse-window` | A `long long[1000000]` (8 MB, over the 4 MB budget) keeps the first 1,000 cells and no patch for a write outside them; an `int[20000]` filled by `iota` passes 10,000 non-default cells and keeps a window too |
| `stack-overflow` | Recursion with 32 MiB frames: the eighth call overflows the stack before its first line, so the `SIGSEGV` step is on the seventh call's line, not a `memory_limit`, with `recursion_too_deep` and `depth` 8. Each `pad` is 32 MiB, over the 4 MB read budget, so it is sparse with only its first 1,000 cells read (`truncated`, `window`) |
| `stl` | The checked build, whose types read like the unchecked one (`std::vector<int>`, `std::map<std::string, int>`): a vector sorted in place, a `map<string, int>` growing, a `std::string`, a struct as a record with a pointer to it, a global `int[3][4]` in the globals frame. The first stop is line 12; the S1a wire session from GCC 15 stops at 11 first |
| `sync-stdio` | `ios::sync_with_stdio(false)` and `cin.tie(nullptr)` with no `endl`: each `cout` shows up on the step after the line that printed it |
| `thread-main` | The Python `thread-main` port without the thread: a DFS over `vector<vector<int>>` with a `vector<bool>`, through `solve()` called from `main` |
| `throw-caught` | A `runtime_error` thrown two calls deep and caught in `main`: the throwing call and its caller, which holds a `std::string`, end with no return step, and the next steps are `main`'s `catch` lines |
| `type-adapter` | `stack`, `stack<int, vector<int>>`, `queue` and `priority_queue` as their container's `sequence` with `meta.adapter` |
| `type-bitset` | `bitset<10>` and `bitset<70>` (across a word) as `fixed` sequences of `bool` |
| `type-fixed-array` | `int[5]`, `int[2][3]`, `std::array<int, 3>` with a pointer into it, `std::array<int, 0>` and nested `std::array`, all `fixed` |
| `type-limit` | A `set`, `deque`, `multimap`, `vector<string>` and `vector<pair<int, int>>` of 150, built without a loop: 100 items, `truncated`, the real `length`, `window` on the sequences |
| `type-mapping` | `map<string, int>`, `multimap`, `unordered_map` and `unordered_multimap`, with `ordered` |
| `type-opaque` | `optional`, `unique_ptr`, a set iterator, `complex` and `mt19937` as `opaque`, the last cut at 200 characters |
| `type-pair-tuple` | `pair` as a record with `first` and `second`, `tuple` with `0`, `1`, `2`, and a vector of pairs |
| `type-record` | A base class flattened into its derived class with the repeated name as `Shape::sides`, a static member left out (it's a global), an anonymous union's fields, and a library base class as one field |
| `type-sequence` | `vector<int>` with `meta.capacity`, `vector<bool>`, `vector<string>`, `deque` and `list` |
| `type-set` | `set`, `multiset`, `unordered_set` and `unordered_multiset`, with `ordered` |
| `type-string` | `std::string`, `string_view` and `const char*` (a literal, into a `char[8]`) as `str`; a null and an unreadable `const char*` and a `char*` as `ptr`; a 1,500-byte `std::string` and `const char*`, cut at 1,000 |
| `type-unchecked` | `options.json` turns the safety checks off: each container family maps the same as in the checked build |
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
