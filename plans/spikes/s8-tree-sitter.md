# S8: tree-sitter inference accuracy

**Gate G5 (Fri 19 Feb) · run Sun 25 Oct 2026 · FE-08 §1 · result: 99.9% of traced steps correct, but only 77.6% of subscript lines in contest-style code; the 95% target is not shown for CP solutions, so BE-11 §5 is triggered**

## Question

D23 infers index markers and read accesses in the browser by parsing the executed line with web-tree-sitter (§19.4.1, §19.9.2). Are the markers and inferred reads right on at least 95% of steps over 50 real CP solutions (§18.7)? If not, BE-11 §5 adds exact access hints to the tracers.

This is a 45-minute, time-boxed run. It scores the parser that ships in the player (FE-08 §3, `source-facts.ts` at commit `7e14d11`) once, as it stood. Nothing was tuned after the run.

## Setup

- **Parser:** web-tree-sitter 0.27.1, tree-sitter-cpp 0.23.4, tree-sitter-python 0.25.0. The harness calls the player's own `collectFacts`, so it scores exactly what the state pane draws from.
- **Corpus:** 50 programs under [`s8/corpus/`](s8/corpus/), 40 C++ and 10 Python. They are not 50 real CP solutions:
  - 30 are the backend's golden fixtures that contain a subscript (23 C++ from `backend/fixtures/cpp`, 7 Python from `backend/fixtures/python`), and 3 are the web fixtures `cpp-dp-grid`, `cpp-fib-memo` and `cpp-binary-search`. Each has a recorded trace, so their steps can be weighted. They are test programs, short and simple: most subscripts are `a[i]` or `a[3]`.
  - 17 (`34`–`50`) were written for this spike in contest style: prefix sums, a `rep` macro, grid BFS with `dx`/`dy`, knapsack, LCS, a linear sieve, two pointers, Fenwick and segment trees, LIS, DSU, pointer arithmetic, matrix power, a struct sort, a sparse table, and Python prefix sums and grid DP. They have no traces, so they are scored per line.
- **Labels:** [`s8/labels.txt`](s8/labels.txt), by hand, from what each line does: every element access with its mode (read, write, both) and its index as written. The same person wrote the parser, the 17 programs and the labels, so the labels aren't independent; a second labeller would make the numbers firmer.
- **Scoring** (`measure.ts`): from the labels and from the parser alike, a line's *markers* are the identifier ± constant indices per array and axis (one per variable, the plain form preferred), and its *reads* are the read accesses whose every index can be evaluated. A labelled read with any other index (`a[l++]`, `dp[c - w[i]]`, `d["k"]`) can never be drawn, so it counts as a miss. A step is correct when the markers of its current and previous line and the reads of its previous line (the line that ran) all match.

## Results

| Measure | Correct |
|---|---|
| **Steps, traced programs (33 programs, 1,717 steps)** | **99.9%** (1,715) |
| Steps whose current or previous line has a subscript | 99.8% (1,314 of 1,316) |
| Lines with a subscript, traced programs | 97.3% (72 of 74) |
| **Lines with a subscript, contest-style programs (17)** | **77.6%** (45 of 58) |
| All source lines, blank ones included | 98.2% (825 of 840) |

Markers were wrong on 2 lines and reads on 14. The misses, all 15 lines:

| Cause | Lines | Example |
|---|---|---|
| Index isn't identifier ± constant (by design, §19.9.2) | 9 | `t[p ^ 1]`, `t[l++]`, `lg[i / 2]`, `lg[r - l + 1]`, `dp[c - w[i]]`, `st[k - 1][i + (1 << (k - 1))]`, `d["k"]` |
| Write through a field read as a read | 1 | `cin >> v[i].s >> v[i].e` |
| `&arr[1]` taken as a read | 1 | `int *p = &arr[1];` |
| Pointer arithmetic is not a subscript | 2 | `cin >> *(a + i)`, `s += p[i] * *(a + i)` |
| Macro loop confuses the parse | 1 | `rep(i, 0, n) cnt[a[i]]++;` reads `rep(i, 0, n) cnt` as the array; markers still right by luck |
| Segment tree compound index | 1 | `for (t[p += N] = v; …)` |

- **The traced corpus passes, but it is not CP code.** Its 1,717 steps come from test programs whose subscripts are almost all `a[i]` or constants, and two lines account for both wrong steps.
- **Contest code misses on the lines that matter.** In the 17 contest-style programs, 13 of 58 subscript lines are wrong, and they sit in the hot loops: the segment tree's update and query, the sparse table's build and query, the knapsack's inner loop. Weighted by steps, those programs would score near or below their 77.6% per line, because a loop body runs far more often than the input lines that the parser gets right.
- **Most misses are the rule, not a parser bug.** 9 of 15 lines read an index the spec never evaluates. Only exact hints from the tracer (BE-11 §5) can mark those.
- **Two parser fixes are cheap:** a write through a field (`v[i].s = …`, `cin >> v[i].s`) and `&a[i]` outside `scanf`. They would move 2 lines; they don't change the conclusion. They weren't fixed or re-scored here.

### Size and speed

| What | Raw | gzip |
|---|---|---|
| `web-tree-sitter.wasm` | 210 kB | 84 kB |
| `tree-sitter-cpp.wasm` | 3,435 kB | 286 kB |
| `tree-sitter-python.wasm` | 458 kB | 69 kB |
| `parse` chunk (web-tree-sitter JS and the fact walk) | 85 kB | 21 kB |

- Nothing loads until the worker parses a trace's source: the worker is an ES module worker and imports the `parse` chunk on demand; one grammar is fetched per trace. A C++ trace costs about 390 kB gzip once, then the browser cache.
- Parse plus fact walk: median 0.3 ms per program, 5.9 ms for the first (warm-up), in Node 24 on an Apple M5. Loading the runtime and both grammars from disk took 10 ms. Not measured in a browser, where the grammar's download dominates.

## Recommendation for G5

**Treat S8 as missed for CP solutions and do BE-11 §5 (exact access hints).** The steps that pass are from test programs; on contest-style code, a quarter of the lines with subscripts get wrong or missing read marks, mostly because their indices aren't identifier ± constant. Keep tree-sitter for what it does well (markers from plain subscripts, branch outcomes, input tokens): the player already prefers a step's `access[]` when the trace has it (§19.9.2), so hints from the tracer replace inference without a frontend change.

## Not covered

- **Real solutions.** No contest submissions were collected; the 17 contest-style programs were written for the spike. A firmer number needs real accepted solutions (Codeforces, VNOI) with traces, and a second labeller.
- **Step weights for the contest-style programs.** They weren't traced; tracing them with `make dev` is the next step if the gate needs a number rather than a direction.
- **Multi-line statements.** Facts sit on the line where a subscript starts; whether GDB and `sys.settrace` report the same line for a statement over several lines wasn't checked.
- **Python beyond simple programs:** comprehensions, `numpy`-style `a[i, j]`, negative indices (scored as not evaluable).
- **Parse time in a browser** and on a slow phone.

## How to rerun

```sh
cd web && pnpm install && cd ..
node plans/spikes/s8/measure.ts            # scores; add --verbose to list every miss
```

Needs Node 24 (it runs the TypeScript directly). The harness imports `web/packages/player/src/source-facts.ts`, so it scores whatever the player ships; numbers above are from `7e14d11`.
