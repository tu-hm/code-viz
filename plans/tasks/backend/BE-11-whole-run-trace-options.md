# BE-11 · Whole-run data & trace options

| | |
|---|---|
| **Milestone** | M3 (by week 2); optional M5 work |
| **Estimate** | 6.5 days (+3 d if S8 fails) |
| **Depends on** | BE-07 (`--coverage`), BE-08, BE-09 §2, BE-03 |
| **Blocks** | FE hit-count gutter, step-limit banner, start-at-line dialog |
| **Covers** | M3-B02, M3-B03, M3-B04, M3-B05, (M5-B01) |
| **Spec** | §5.6, §19.8, §19.9.2, §19.9.3, §19.9.5, FR-11 |

🔁 **Handoff to FE:** `lineHits` and untraced tail by **M3 week 2**.

## 1. Line hit counts (M3-B02 · 2 d)

- [x] C++: read gcov counts after a normal exit → `summary.lineHits`, `lineHitsSource: "gcov"`
- [x] C++ after a crash: count from recorded steps → `lineHitsSource: "trace"`
- [x] Python: use the tracer's line counter (BE-03) for the whole run
- [x] **Done:** binary-search counts match the §19.3 mock

**Result** (spec v1.13, §19.9.3):

- **The tracer reads gcov's files itself.** After a normal exit `trace.py` reads `main-main.gcno` and `main-main.gcda`, solves the arc counts off GCC's spanning tree by flow conservation, as gcov does, and gives each line its busiest basic block's count. gcov's own line count adds up the blocks a line is split into, and inlined library code splits lines that ran once: `vector<int> a(n);` came out as 2. The `line-hits` fixture is the §19.3 mock's program and gets the mock's counts on every line.
- **Which lines.** Only lines a step can stop at, closing braces excepted (GCC puts an epilogue's block on the `}` in some functions only); not a function's header line, not compiler-generated functions. Lines that never ran are left out, as in Python. Across the C++ fixtures traced whole, these counts equal the golden's line and call steps on every line but three: a one-line loop counts its last check too (the range-for in `line-hits` ran 9 times in 8 steps, as the mock says), and two lines with an `initializer_list` of strings count its cleanup loop.
- **The wire `exit` names its source** (`counter` or `gcov`). An `exit` without `lineHits` gets the core's count of the recorded `line` and `call` steps, `lineHitsSource: "trace"`: a signal, a sanitizer's report (it exits without writing `.gcda`), a kill at a limit. The core rejects `lineHits` whose source a differently-cased key cleared.
- Every C++ golden now has `lineHits`: 35 from gcov, 11 from the trace (the `check-*` fixtures, `exception`, `segfault`, `stack-overflow`).

## 2. Untraced tail for C++ (M3-B03 · 2 d)

- [x] After the step limit: delete all breakpoints and `continue` at full speed
- [x] Respect the wall-time limit while untraced
- [x] Capture output after the last traced step → store as `tail.txt.gz`
- [x] Fill `summary.untracedTail` (`completed`, `exit`, `stdoutBytes`)
- [x] List `tail.txt.gz` in the trace manifest / API response
- [x] Python side (hook → counter only) already in BE-03; verify it fills the same fields
- [x] **Done:** a 2,000-iteration loop gives complete output

The first two are done in BE-08. After the marker step, `trace.py` deletes every breakpoint and continues to the real exit; the `long` fixture shows the tail's exit and output. The untraced run stays inside the trace's wall-time deadline, so the sandbox kills it at the limit, and the core records `untracedTail.completed: false` with exit `timeout` (`TestUntracedTailAfterATimeLimit`).

**Result** (spec v1.13, §7.5, §8.3, §19.9.5):

- The worker gzips `Result.Tail` and stores it at `{t7|t90}/{traceId}/tail.txt.gz` as `text/plain; charset=utf-8`; `BlobStore.Put` takes the content type now. Its gzipped size and the SHA-256 of the text go in a new `traces.tail` JSON column (migration `00008`, `ALGORITHM=INSTANT`). `GET /visualizations/{id}` lists it as `trace.tail {sizeBytes, sha256, url}` (OpenAPI `Tail`), signed like the chunks, and the nightly cleanup deletes it with them.
- There's a tail object only when there is output to put in it. A trace without steps (a start line that never ran, a crash before `main`) keeps all its output there too, with no `untracedTail`; before, that output was lost.
- `untracedTail` was already filled by the core for both languages. The 2,000-iteration `long` fixtures, C++ and Python, record 1,000 steps, `untracedTail {completed: true, exit normal, stdoutBytes: 8}`, and hits 2,001 and 2,000 on the loop. `TestRunStoresTheOutputAfterTheStepLimitAsTheTail` stores a tail through the worker and reads it back from SeaweedFS.
- Not done: sharing copies traces to `t90/` (BE-12), and that copy must take `tail.txt.gz` along.

## 3. Start tracing from line N (M3-B04 · 1.5 d)

- [x] Accept `options.startAtLines`
- [x] C++: run untraced to the first hit of a listed line, then start stepping
- [x] Python: hook ignores events until the line is reached
- [x] Include in the cache key
- [x] **Done:** §5.6 dialog works end to end — FE-05's Start tracing from line… re-ran a step-limited Python loop from its `print` line against `make dev` (25 Oct): one `line` step there with the loop's totals

**Result** (spec v1.13, §5.6, §10.2):

- Both manifests say `startAtLines: true`; the worker and `vizctl` pass the lines as `VIZ_START_AT_LINES` through `app.TraceEnv`. The cache key had them already (BE-06, `NormalizeOptions`).
- Python waits with hooks that only count lines; C++ breaks only on the listed lines' rows. At the first one to run, the tracer gives every user frame on the stack a call record, outermost first, and traces from there. The first step is a `line` step at that line with the whole stack and `prevLine: null`; output printed before it lands on it, and hit counts cover the whole run. A line that never runs gives no steps (`start-never`).
- On aarch64, a C++ frame already running at the start that returns a struct in memory shows its return value as `unavailable`: `x8` no longer holds the address.
- The dialog is FE-05's (`rerun-dialogs.tsx`). The backend half runs end to end from `options` to steps in the `start-at-line` fixtures.

## 4. Show range (M3-B05 · 1 d)

- [x] Accept `options.captureRanges` (e.g. `{"depth": [[0, 50]]}`)
- [x] Record the requested window for the named arrays on a re-run
- [x] Determinism (seeded RNG, ASLR off) so step counts match the original
- [x] **Done:** window moves beyond the originally recorded range

**Result** (spec v1.13, FR-11, §11):

- Both manifests say `captureRanges: true`; the tracers get the map as `VIZ_CAPTURE_RANGES` (JSON). A range is `[first, last]`, inclusive; the request is rejected if one ends before it starts or if the map is over 4 KB as JSON (it's one environment variable).
- A variable's ranges become one window, from the lowest first to the highest last, applied only when the sequence is too long to record whole: Python `list`, `tuple`, `deque` over 1,000 items; C++ arrays, `std::array` and `vector`s of scalars past one whole read or 10,000 non-default cells (up to 1,000 cells, one memory read of the window); `vector`s and arrays of non-scalars over 100 items. The name matches a local, a parameter or a C++ global. The core keeps an adapter's window as it is.
- The `capture-ranges` fixtures record `dist[15000..15009]` and `names[245..254]` in C++, `dist[2495..2504]` and `names[1195..1204]` in Python, where the default would be the first items. Python truncated sequences now carry `window {start: 0, count: 1000}` too, like C++'s.
- `TestCaptureRangesKeepTheSteps` re-traces each such fixture without its ranges and compares every step's event, line and output with the golden: same steps, including a list shuffled by the seeded `random` and an array filled by `rand()`.
- Not covered: containers read through the printers (`map`, `set`, `deque`, `list`) keep their first 100 items.

## 5. (Conditional) Exact access hints (M5-B01 · 3 d)

Only if FE spike S8 (tree-sitter accuracy) misses 95%.

- [ ] Emit `access[]` (`obj`, `path`, `mode`) from the tracer
- [ ] Writes from the diff; reads from instrumentation

Not started: spike S8 hasn't run (FE, M1-F01), so it isn't known whether this is needed.

## Done when

A 2,000-iteration loop gives complete output, and binary-search hit counts match the §19.3 mock.
