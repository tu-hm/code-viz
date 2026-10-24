# S7: safety-check overhead and build memory

**Gate G5 (Fri 19 Feb) · run Sat 24 Oct 2026 · BE-07 §3 · recommendation: keep checks on by default, but with `_GLIBCXX_ASSERTIONS` and a narrower UBSan instead of `_GLIBCXX_DEBUG`; add `--param ggc-min-heapsize=32768 --param ggc-min-expand=30` to `build.cmd`; not decided**

## Question

Do the D21 safety checks keep a C++ build within 3 s with the precompiled header, and a run within 3× of an unchecked build, on 10 real CP solutions (§18.7)? D21 turns on `_GLIBCXX_DEBUG`, UBSan and `--coverage` by default, to be revisited "if the overhead breaks time limits".

A second question came up while building the runner image: does a checked build fit in the box's 256 MiB (§11)? With the PCH, a checked build of a ~70-line program peaked at about 236 MiB, and under load some builds thrashed past the 10 s build timeout. Without the PCH it was OOM-killed. The candidate fix was GCC garbage-collector params in `build.cmd`.

## Setup

- **Host:** Apple M5 (10 cores, 32 GB), Docker 29.8.2 on OrbStack: a Linux 7.2 arm64 VM with 10 vCPUs, 15.7 GiB, 4 KiB pages, cgroup v2. Everything ran natively on arm64.
- **Image:** `viz-runner-cpp:13.5-gdb14-1` (`sha256:582635c1…`, built from `backend/adapters/cpp/Dockerfile` at 14:05): GCC 13.5.0, binutils 2.40, `checks-off.gch` (127 MiB) and `checks-on.gch` (146 MiB). `plans/spikes/s7/Dockerfile` adds `checks-assert.gch` for build E. GDB isn't used: every run is native.
- **Box:** the dev sandbox's settings (`dockersandbox.go`): uid 65534, read-only root, 64 MiB `/work` tmpfs, `--init`, no capabilities, `no-new-privileges`, its seccomp profile, no network, 1 CPU, 32 PIDs, 256 MiB memory and swap for the whole box (`worker.go`), 256 MiB stack. GCC writes its temporary files to `/work`, as the manifest's `TMPDIR` asks. No `viz.*` labels.
- **Memory:** `memory.peak` of the box's cgroup, which is exact. A sampler outside the box reads the cgroup's `memory.stat` every 5 ms and keeps the largest `anon` and `file`. **Warm** means another container read GCC and the PCHs just before, so their pages are in the page cache and charged to someone else. **Cold** means they were dropped from the page cache first (`dd iflag=nocache`), so this box reads them and is charged for them. The harness kills a build after 30 s; the product kills it at 10 s.

| | Build | Flags (`build.cmd` is the manifest's, with `main.cpp /opt/viz/flush_init.cpp -o main`) |
|---|---|---|
| A | Default today (D21) | `build.cmd` + `-D_GLIBCXX_DEBUG -fsanitize=undefined -fno-sanitize-recover=all` |
| B | Checks off | `build.cmd`: `-std=gnu++17 -O0 -g3 -fno-omit-frame-pointer --coverage -Wall -Wextra -Wshadow` |
| C | Judge-like | `g++ -std=gnu++17 -O2 main.cpp` |
| D | Unchecked | `build.cmd` without `--coverage` |
| **E** | **Candidate** | `build.cmd` + `-D_GLIBCXX_ASSERTIONS -fsanitize=undefined -fno-sanitize=null,alignment,pointer-overflow -fno-sanitize-recover=all` |
| F, G | Attribution | `build.cmd` + `-D_GLIBCXX_DEBUG` only; `build.cmd` + full UBSan only |
| H | Attribution | `build.cmd` + `-D_GLIBCXX_ASSERTIONS -fsanitize=undefined -fno-sanitize-recover=all` |

The programs are written like contest submissions. Inputs come from seeded generators at the problems' limits. "PCH" says whether GCC used `bits/stdc++.h.gch` (`-Winvalid-pch -H`).

| Program | Problem and technique | Input | PCH |
|---|---|---|---|
| `tree-dp` | CSES Tree Distances II: rerooting DP, recursive lambdas, `#define int long long` | n = 2·10^5 | ✓ |
| `dijkstra` | CSES Shortest Routes I: `priority_queue` | n = 10^5, m = 2·10^5 | ✓ |
| `bfs-grid` | CSES Labyrinth: grid BFS and path, individual `#include`s | 2000 × 2000 | — |
| `knapsack` | CSES Book Shop: 0/1 knapsack on a `vector<int>` | n = 1000, x = 10^5 (8 KB) | ✓ |
| `segtree` | CSES Dynamic Range Minimum: recursive segment tree, `#pragma GCC optimize("O3,unroll-loops")` first | n = q = 2·10^5 | — |
| `inversions` | Inversions: `sort`, `unique`, `lower_bound`, Fenwick tree | n = 2·10^5 | ✓ |
| `repeat-hash` | CSES Repeating Substring: binary search, double hashing, `sort` | n = 10^5 | ✓ |
| `kruskal` | MST: `sort` with a lambda, DSU | n = 2·10^5, m = 4·10^5 | ✓ |
| `tickets` | CSES Concert Tickets: `multiset` | n = m = 2·10^5 | ✓ |
| `josephus` | CSES Josephus II: `__gnu_pbds` order-statistics tree, pb_ds includes before `<bits/stdc++.h>` | n = 2·10^5 (17 bytes) | — |
| `josephus-pch` | The same code with `<bits/stdc++.h>` first; builds only | — | ✓ |

**Conditions.** The machine was loaded. It was shared with another agent's `make test` (MySQL and SeaweedFS testcontainers, image builds, Go builds on the host) and with desktop and endpoint-security processes. The host load average was mostly 6–16, typically 9–12, against 10 cores. Two full runs were stopped part way, and no single pass covers everything. The numbers come from five passes:

| Pass | When | What | Host load average |
|---|---|---|---|
| R1 | 13:36–13:38 | A and D, one run each, on the 10 programs of the time: `kmp` (string matching, since replaced by `repeat-hash`) instead of `repeat-hash`, `bfs-grid` at 1000 × 1000 and `kruskal` at 10^5 / 2·10^5 | 10–60 |
| R2 | 14:12–14:45 | Every build in the table: 11 programs × {B, A, H} × 3 GC settings, warm × 5 and cold × 3, plus a probe of each in a 1 GiB box | warm: 6–9 (VM 4–7, VM 62% idle); cold reps 1–2: up to 58 |
| R3 | 14:45–14:54 | Five runs in a row per build: A–D, F, G and H on `tree-dp` (twice), A–D and H on `dijkstra`. `knapsack` round-robin, two rounds, A–D, F, G, H | 6–16 |
| R4 | 14:56–14:58 | D, E and E-like builds (E2, H) round-robin, three rounds, on 7 programs | 6–9 |
| R5 | 15:07 | The final E flags in a 1 GiB box (memory only), 8 programs; then stopped | 5–8 |

Run times on this host are noisy: the VM's vCPUs land on performance or efficiency cores as macOS decides. `tree-dp` D took 0.13–0.54 s across R3. Ratios below therefore use the fastest run of each build. Build memory doesn't depend on load; build times in the cold columns do.

## Results

### Run time

Fastest run in seconds; ratios of those. A "—" was not measured.

| Program | D s | A/D | A/B | A/C | E/D | Source |
|---|---|---|---|---|---|---|
| `tree-dp` | 0.13 | 2.5× | 2.3× | 8.0× | 1.1× | R3; E: R4 |
| `dijkstra` | 0.13 | **>460×** (>60 s) | >390× | >1,800× | ≤1.7× (H) | R3 |
| `bfs-grid` | 0.17 | 4.6× (R1, 1000²); ≥4.0× (H) | — | — | 2.0× | R1, R4 |
| `knapsack` | 0.44 | **15×** (6.6 s) | 9.8× | 175× | **3.0×** (1.35 s) | R3; E: R4 |
| `segtree` | 0.10 | 1.4× | — | — | 1.1× | R1, R4 |
| `inversions` | 0.09 | **>690×** (>60 s) | — | — | — | R1 |
| `repeat-hash` | 0.29 | ≥2.6× (H) | — | — | 1.3× (E2) | R4 |
| `kruskal` | 0.11 | 19× (R1, smaller); ≥2.0× (H) | — | — | 1.2× (E2) | R1, R4 |
| `tickets` | 0.19 | 1.6× | — | — | 1.05× | R1, R4 |
| `josephus` | 0.42 | **>140×** (>60 s) | — | — | — | R1 |

H (assertions with full UBSan) checks less than A and more than E, so it bounds both. E2 is E with UBSan limited to `signed-integer-overflow,shift,integer-divide-by-zero,bounds`: E, E2 and E without `vptr` ran within 5% of each other on the five programs where all three ran (R4).

Attribution, on `knapsack` (R3, fastest of two; E from R4): D 0.45 s; B (coverage) 0.67 s, 1.5×; G (full UBSan) 1.57 s, 3.5×; F (debug mode) 2.98 s, 6.7×; H 3.04 s, 6.8×; E 1.35 s, 3.0×; A 6.63 s, 15×. On `tree-dp`: B 1.1×, G 1.3×, F 1.7×, A 2.5×.

- **Debug mode changes the complexity of the STL's algorithms.** With `_GLIBCXX_DEBUG`, `push_heap` and `pop_heap` check the whole heap (`__glibcxx_requires_heap`), `lower_bound` checks that the whole range is partitioned (`__check_partitioned_lower`), and every pb_ds operation validates the whole tree (`PB_DS_ASSERT_VALID`, `debug_map_base`). So Dijkstra with a `priority_queue`, coordinate compression with `lower_bound`, and an `ordered_set` become O(n²): A didn't finish in 60 s where D takes 0.1–0.4 s. These are the standard tools of the problems S7 is about.
- **Where the complexity doesn't change, A is still over 3× on half the programs:** 15× on `knapsack`, 19× on `kruskal` (R1), 4.6× on `bfs-grid` (R1). Two costs add up. Debug-mode containers wrap every iterator in a safe iterator that registers itself with its container, which `sort` pays for constantly. Full UBSan at `-O0` checks `null`, `alignment` and `pointer-overflow` on every pointer access, including inside each `operator[]` call.
- **E stays within 3× on every program where it ran**, at most 2.0× except `knapsack`. `knapsack` is the worst case for any per-access check: three `vector` subscripts in a 10^8-iteration loop, each a function call at `-O0`. It is at the limit: 3.0× by fastest runs, 2.7× by medians. E over B (checks on top of coverage) is 2.0×. Dropping UBSan's three per-access checks halves E's cost on `knapsack` (H 6.8× → E 3.0×) and on `bfs-grid` (4.0× → 2.0×).
- **E wasn't run on `inversions` or `josephus`.** Their blow-up comes from code paths that only `_GLIBCXX_DEBUG` turns on: the three checks above are inside `#ifdef _GLIBCXX_DEBUG` (`debug/debug.h`, `_GLIBCXX_DEBUG_ONLY`). `_GLIBCXX_ASSERTIONS` adds O(1) checks only (`debug/assertions.h`). On `dijkstra`, H took 1.7× of D. That is read from the headers, not measured.
- **No program was stopped by the checks.** Every build that finished exited 0, and the outputs matched D's where compared (md5).
- **C is not comparable in absolute terms.** D vs C is 3–12× (`-O0` against `-O2`, plus `flush_init.cpp`'s unbuffered output, which costs a `write` per `<<` in output-heavy programs). A/C is reported because the brief asked; the S7 criterion is against D.

### Build time and memory (R2)

Warm page cache, 256 MiB box: the slowest program's median and the largest anon per variant. A row's "failed" counts builds out of 55 (11 programs × 5).

| Checks | GC params | Worst median s | Max s | Max anon MiB | Failed |
|---|---|---|---|---|---|
| B (off) | none | 0.87 | 0.91 | 237 | 0 |
| B (off) | 32768/30 | 0.96 | 1.11 | 194 | 0 |
| B (off) | 16384/10 | 1.21 | 1.49 | 192 | 0 |
| A (debug) | none | 0.77 | 0.87 | 256 | **10: `segtree`, `josephus` OOM** |
| A (debug) | 32768/30 | 1.10 | 1.13 | 255 | **5: `josephus` OOM** |
| A (debug) | 16384/10 | 1.99 | 8.63 | 244 | 0 |
| H (≥ E) | none | 0.92 | 1.00 | 254 | **5: `josephus` OOM** |
| H (≥ E) | 32768/30 | 1.03 | 1.07 | 215 | 0 |
| H (≥ E) | 16384/10 | 1.41 | 1.48 | 198 | 0 |

Cold page cache, 3 runs each (reps 1–2 ran under host load up to 58, so times are rough; the failures repeat in rep 3):

| Checks | GC params | Worst median s | Max s | Failed |
|---|---|---|---|---|
| A (debug) | none | 1.34 | 30 (killed) | 6 of 33: `segtree`, `josephus` thrash until killed |
| A (debug) | 32768/30 | 7.28 | 30 (killed) | 3: `josephus`; `josephus-pch` 6.9–8.9 s |
| A (debug) | 16384/10 | 15.48 | 16.23 | 0, but `josephus` 13.7–16.2 s and `josephus-pch` 4.0–7.9 s |
| H (≥ E) | none | 0.89 | 30 (killed) | 3: `josephus` |
| H (≥ E) | 32768/30 | 1.12 | 2.88 | 0 |
| B (off) | 32768/30 | 0.99 | 3.58 | 0 |

Build time with the GC params against without, median over programs (warm): 32768/30 costs 1.05–1.10× (at most 1.19×); 16384/10 costs 1.42–1.49× (at most 1.61×). GCC's output doesn't change: `objdump -d` of `tree-dp` and `segtree` is identical with all three settings.

What a build needs with no limit (1 GiB box, sampled anon, MiB):

| | B none | A none | A 32768/30 | H none | H 32768/30 | E 32768/30 (R5) |
|---|---|---|---|---|---|---|
| PCH programs (7; E: 6) | 70–81 | 96–141 | 97–126 | 78–95 | 77–93 | 75–87 |
| `bfs-grid` (no `stdc++.h`) | 81 | 136 | 102 | 97 | 79 | 74 |
| `segtree` (pragma first) | 221 | **256** | 214 | 228 | 188 | 188 |
| `josephus` (pb_ds first) | 236 | **306** | **270** | **256** | 214 | — |
| `josephus-pch` | 106 | 195 | 162 | 126 | 118 | — |

- **Builds with the PCH are fast.** Warm, every PCH build takes 0.3–0.8 s with any checks, up to 1.2 s with 16384/10. Loading the PCH alone costs 66 MiB of anon with checks off and 74 MiB with A (an empty `main`), because GCC writes into the mapped PCH and every page it writes is copied. It's the same with ASLR off (`setarch -R`). `flush_init.cpp` adds about 0.1 s to every build: it is compiled from source each time.
- **The "236 MiB with the PCH" is page cache.** `memory.peak` counts the PCH's 146 MiB of file pages only when this box is the one that reads them in. On a cold cache every PCH build reaches 256 MiB and the kernel reclaims clean file pages. That is cheap while anon is small (`tree-dp` A: 0.42 s cold and warm).
- **A thrashes when anon is high.** When a build's anon nears the limit, reclaim takes pages GCC still needs, the build spends its time in the kernel (`josephus-pch` A at 32768/30: 6.2 s of 7.3 s in sys, 13k major faults), and the 10 s build timeout reports "Build timed out". Warm, the same build is OOM-killed in under a second. So with A, the failure a user sees depends on the page cache. More GC can make it worse: `josephus-pch` A takes 1.2–1.7 s cold with no params and 6.9–8.9 s with 32768/30, because each collection touches PCH pages that reclaim had just dropped.
- **Without the PCH, the build parses the STL itself.** That happens with a pragma or another `#include` before `<bits/stdc++.h>`, or with individual includes. Anon then reaches 180–306 MiB. With A, `josephus` needs 306 MiB, and no GC setting makes it safe: 16384/10 squeezes it into 244 MiB, then it thrashes for 14–16 s on a cold cache. pb_ds in debug mode is heavy even with the PCH (`josephus-pch`: 195 MiB).
- **With E-level checks and 32768/30, every program builds**, at most 215 MiB anon (`josephus`, measured with H; where R5 measured both, E needed 0–12 MiB less than H). The worst warm build is 1.07 s and the worst cold build 2.88 s. That leaves about 40 MiB of headroom for the worst no-PCH program, and roughly 160 MiB for PCH programs.
- **GCC picks a `.gch` by macros only.** A build with `-D_GLIBCXX_DEBUG` and no `-fsanitize` loads `checks-on.gch`, which was built with UBSan, and GCC crashes (`internal compiler error: in expand_UBSAN_NULL`). A build with different `-fsanitize` options but the same macros would use the other PCH without a word. The adapter guide's warning ("used without a word") understates it. Whatever flags the manifest ends up with, the PCH must be rebuilt with exactly those.

## Recommendation for G5

**Keep safety checks on by default (D21), but change what "checks" means.** `_GLIBCXX_DEBUG` fails S7 badly: three of ten real solutions don't finish in 60 s, and six of the nine measured run more than 3× slower. With D25 the untraced tail runs to the end within the time limit, so a correct O(n log n) solution such as `josephus`, with 17 bytes of input, would show `time_limit` in the visualizer. Proposed `build.safetyFlags`:

```text
-D_GLIBCXX_ASSERTIONS -fsanitize=undefined -fno-sanitize=null,alignment,pointer-overflow -fno-sanitize-recover=all
```

- It keeps what §19.6 promises: bounds checks on `operator[]` of `vector`, `string`, `deque` and `array`, `front`, `back`, `top` and `pop` on an empty container, and UBSan's signed overflow, shift, division by zero and `bounds` checks. It also keeps `return`, `builtin`, `vla-bound`, `bool`, `enum`, `unreachable` and `vptr`.
- It loses the debug-mode checks: iterator invalidation, `*s.begin()` on an empty set, comparing iterators from two containers, and debug mode's messages with the index and size. A null dereference still stops the program, as `SIGSEGV`. The friendly message reads the index and size from the frame at the breakpoint.
- It passes S7 on everything measured, with `knapsack` at the limit (3.0×). Its builds are smaller than A's, and E's PCH is 129 MiB against 146 MiB.

**GC params: add `--param ggc-min-heapsize=32768 --param ggc-min-expand=30` to `build.cmd`.** They are what lets a no-PCH build with checks fit: `josephus` drops from 256 MiB (OOM) to 214 MiB, `segtree` from 228 to 188 (measured with H; E is the same or lower). They cost a median 5–10% in build time (at most 19%), and they don't change the code. 16384/10 saves at most 16 MiB more (`josephus`) for 42–49% more build time. With A's flags no setting is safe, so the params alone don't fix the problem as first described.

If G5 adopts this, the change also touches:

- `adapters/cpp/Dockerfile`: `checks-on.gch` is built with the new flags. The macro that tells the two PCHs apart becomes `_GLIBCXX_ASSERTIONS`.
- The `stl` golden trace and `docs/backend/architecture/tracing.md`: containers stay `std::vector`, not `std::__debug::vector`. BE-09 no longer needs to handle the debug-mode wrappers (S4 noted they change the pretty printers' output).
- BE-10: break on `std::__glibcxx_assert_fail` instead of `__gnu_debug::_Error_formatter::_M_error`.
- The spec text of D21, FR-25, §7.11.2 and §19.6.

**Open, for the spec owner (user-visible, the spec is silent):** a build gets the program's 256 MiB because build and trace share one box. With E and the params, the worst no-PCH build has about 40 MiB of headroom. A heavier template user, say pb_ds with a pragma first, could still thrash into "Build timed out" on a cold cache, where a warm cache would OOM in a second. Two options: give the build step its own limit (the §11 ceiling of 512 MiB), which is a BE-02/BE-05 change; or report an OOM-killed or thrashing build as a memory problem rather than a timeout. Forcing the PCH with `-include bits/stdc++.h` fixes `segtree` (79 MiB) but not `josephus` (210 MiB with A). It also changes which names user code sees when it uses individual includes, so it isn't proposed.

### Proposed §0.3 row

| Version | Date | Change |
|---|---|---|
| v1.8 | 2026-10-24 | **G5 input, spike S7: C++ checks stay on by default with lighter flags** (D21). `build.safetyFlags` becomes `-D_GLIBCXX_ASSERTIONS -fsanitize=undefined -fno-sanitize=null,alignment,pointer-overflow -fno-sanitize-recover=all`. `_GLIBCXX_DEBUG` makes `priority_queue`, `lower_bound` and pb_ds trees check the whole container on every call: 3 of 10 CP solutions didn't finish in 60 s (0.1–0.4 s unchecked), and 6 of 9 measured ran over 3×. The new flags stay within 3× on every program measured (`knapsack` 3.0×), keep the §19.6 bounds, empty-container and UBSan checks, and drop iterator checks. `build.cmd` adds `--param ggc-min-heapsize=32768 --param ggc-min-expand=30`, so builds that skip the PCH fit in 256 MiB (5–10% slower builds). Report: `plans/spikes/s7-safety-checks.md`. |

## Not covered

- **One clean, complete run.** The run-time table comes from four passes on a shared, partly loaded machine. A/B and A/C exist only for `tree-dp`, `dijkstra` and `knapsack`. E wasn't run on `inversions` or `josephus`, and A wasn't run at the final sizes of `bfs-grid`, `repeat-hash` and `kruskal`. `run.sh` measures all of it in one pass (about 70 minutes): run it on a quiet machine before G5 closes.
- **amd64 and the production sandbox.** Everything ran on arm64 in the Docker dev box, not nsjail on a runner node. Server cores are slower per thread than an M5, so the absolute build times will be higher there. Memory should be close: both use 4 KiB pages.
- **Inputs within the product's limits.** Most inputs here are 1–9 MB, against a stdin limit of 64 KB (256 KB at most), so a user can't feed them. With the default limit, the O(n²) debug checks cost far less. `knapsack` (8 KB) and `josephus` (17 bytes) fit as they are, and they are where A hurts most. The harness has a `run64` step for 64 KB inputs; it didn't run.
- **Tracing.** Runs are native. GDB's per-step cost with checks on (S1, S6), and how often the checks stop real buggy programs, are not measured: none of these 10 has a bug.

## How to rerun

```sh
plans/spikes/s7/run.sh [dir]   # about 70 min on a quiet machine; S7_STEPS="probe build run run64" picks steps
```

`run.sh` builds `viz-s7-assert:spike` from `Dockerfile` (the runner image plus E's PCH) and builds `sampler.go` for the Docker VM's architecture. It then runs four steps:

- **probe:** each build in a 1 GiB box, for the PCH used and the memory needed.
- **build:** timed builds in the 256 MiB box, warm × 5 and cold × 3.
- **run:** builds A–H once, then one box runs them round-robin for 7 rounds on the contest-size input.
- **run64:** A, D and E on inputs that fit 64 KB of stdin.

`box.sh` is what runs inside each box, and `summarize.py` prints the tables from the TSV files. Each program's `gen.py` takes an optional size.
