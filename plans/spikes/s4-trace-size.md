# S4: trace size with keyframes, deltas and chunks

**Gate G3 (Fri 13 Nov) · run Sat 24 Oct 2026 · BE-04 §1 · recommendation: keep keyframe 50 and chunk 250, and add cell patches for every sequence; not decided**

## Question

Does a real competitive-programming program, a DFS on a 200k-element global array, stay within 2 MB gzipped for 1,000 steps, with a keyframe every 50 steps and chunks of 250 (§18.7, D2, §9.6)? Three §11 limits decide what a 200k array costs: items recorded per container (1,000 by default, 10,000 at most), heap objects per step (500), and the 20 MB uncompressed trace budget. §19.9.1 proposes a sparse form for big arrays: the default value plus the other cells in keyframes, and only the changed cells (`patch`) in deltas.

## Setup

- **Host:** Apple M5, Docker 29.8 on OrbStack: a Linux arm64 VM with 10 vCPUs. Everything ran natively on arm64.
- **Toolchain:** `ubuntu:26.04` pinned by digest, with GCC 15.2.0 and GDB 17.1: the versions BE-08 recorded the prototype sessions with. Programs are built with the §7.11.2 flags, without the D21 checks.
- **Tracers:**
  - **Prototype:** `backend/adapters/cpp/trace.py`, unchanged. It sends every array as dense `items`, the first 100 of them (`MAX_ITEMS`).
  - **Variant:** `trace_variant.py` is the prototype with three changes. The item cap comes from `S4_ITEMS`. A one-dimensional `int`, `long long` or `bool` array is read with one `read_memory` per step, as BE-09 plans. With `S4_SPARSE=1` such an array goes out in the §19.9.1 form: the most common value as `default`, every other cell in `sparse.items` (up to 10,000) and a 16-cell window. Sparse cells carry no `type`, as in the §19.9.1 example; dense items keep the prototype's `type` on every item. At 100 items the variant's dense output is byte-identical to the prototype's apart from addresses (`run.sh` checks it on `dfs-heap`).
  - Neither tracer stops at the step limit yet, so `trace.sh` keeps `hello` and the first 1,001 steps. The core drops the 1,001st as the step-limit marker (§10.1).
- **Core:** `main.go` feeds each session to the real `tracecore.Recorder`, with schema validation, `maxSteps` 1,000 and `tracecore.DefaultLimits` (1,000 items, 500 heap objects, 20 MB) unless a row says otherwise. "Gzip" is the total of `Result.Chunks()`. "Raw" is the uncompressed steps, which is what the 20 MB budget counts. MB and KB are 2^20 and 2^10 bytes.
- **Other encodings:** the tool replays the recorder's steps into full states and encodes them again. With keyframe 50 it reproduces the recorder's output byte for byte, on every session. It then varies the keyframe interval (K) and the chunk size (C), and tries two kinds of patch. Every patched encoding is replayed and checked against the full state at every step.
  - **Sparse patch** (§19.9.1, BE-04 §3): a delta carries only the changed cells of a sparse sequence.
  - **Any patch:** the same for dense `items`, by index, whenever a sequence's type, length and other fields are unchanged.
- **ASLR stays on.** Docker's default seccomp profile blocks GDB's `personality(ADDR_NO_RANDOMIZE)`. Addresses only appear in native ids, which the core maps to `o1, o2…`, so the sizes don't change.

| Program | What it does | Big arrays |
|---|---|---|
| `dfs-adj` | The usual CP template: reads a 100-node random tree into `adj`, then a recursive DFS fills `depth`, `sz` and `vis`. The 1,000 steps cover the input loop and 51 of the 100 nodes | `vector<int> adj[200005]`, `int depth[200005]`, `int sz[200005]`, `bool vis[200005]` |
| `dfs-heap` | A DFS over the implicit binary tree `u → 2u, 2u+1` with n = 200,000, shaped like a segment-tree build. Writes land anywhere up to index 131,178 | `int depth[200005]`, `int tin[200005]` |
| `prefix` | Not a DFS: a loop that fills two arrays with distinct values, one cell per step. The worst case for re-sending a whole array on every change | `long long a[200005]`, `long long pre[200005]` |

## Results

### Keyframe 50, chunk 250, today's core

"Session" is what the tracer writes on fd 3 for 1,001 steps. A run that hits the 20 MB budget stops early: the core kills the sandbox and keeps the steps so far (`truncation.reason = size_limit`).

| Program | Tracer sends | Session | Steps kept | Raw | Gzip | Largest chunk |
|---|---|---|---|---|---|---|
| `dfs-adj` | prototype, 100 items | 50 MB | 1,000 | 2.37 MB | 67 KB | 20 KB |
| | 1,000 items | 419 MB | 1,000 | 13.09 MB | **246 KB** | 84 KB |
| | sparse, `adj` at 1,000 items | 320 MB | 1,000 | 4.77 MB | 124 KB | 36 KB |
| `dfs-heap` | prototype, 100 items | 10 MB | 1,000 | 1.07 MB | 29 KB | 7 KB |
| | 1,000 items | 67 MB | 1,000 | 2.76 MB | 53 KB | 20 KB |
| | sparse | 10 MB | 1,000 | 2.49 MB | 51 KB | 17 KB |
| | 10,000 items (§11 ceiling) | 634 MB | **608, size limit** | 19.75 MB | 104 KB | 62 KB |
| `prefix` | prototype, 100 items | 9 MB | 1,000 | 1.57 MB | 29 KB | 9 KB |
| | 1,000 items | 77 MB | **747, size limit** | 19.98 MB | 486 KB | 218 KB |
| | sparse | 10 MB | 1,000 | 3.97 MB | 52 KB | 20 KB |
| | 10,000 items (§11 ceiling) | 747 MB | **76, size limit** | 19.77 MB | 83 KB | 83 KB |

- **Gzip isn't the constraint.** Every DFS session is at most 246 KB, an eighth of the 2 MB target. That's at most 0.25 KB per step, against the 4.7 KB per step CodeChef's format used (§9.6). Gzip shrinks these traces 36–244×: a delta re-sends an object that is mostly the same as its last copy, and a big array is mostly zeros.
- **The 20 MB uncompressed budget binds first.** A delta re-sends a changed object whole, so two 1,000-item arrays that change on most steps cost about 27 KB a step, and `prefix` stops at step 747. At the 10,000-item ceiling `prefix` stops at step 76. `dfs-heap` stops at step 608 although few of its writes are visible: each keyframe carries 2 × 10,000 zero cells, about 0.66 MB.
- **Dense items hide most of a 200k array.** Only the first N cells are recorded. Of the 225 cells `dfs-heap` writes in `depth`, 9 are in the first 1,000 (4%) and 23 in the first 10,000 (10%); the rest of the DFS never shows. The sparse form sends all of them, for less than 1,000 dense items: 2.49 MB raw against 2.76.
- **Today's core re-sends a sparse sequence whole.** Every write re-sends every non-default cell, so a loop that writes a new cell each step pays again for all the earlier ones. `prefix` sparse is 3.97 MB raw this way, and 0.91 MB with sparse patches.
- **Arrays of containers use up the heap-object budget.** At 1,000 items, `adj` alone refers to 1,000 vectors, nearly all empty, and the core keeps 500 objects per step: `depth`, `sz`, `vis`, `adj` and 496 of its vectors. The core numbers the objects a frame refers to directly first, which is why the three arrays survive. From the breadth-first order in `step.go` (not measured here): anything further away, such as the rows of a local `vector<vector<int>>`, would come out `unavailable` with reason `object_limit`. The prototype's 100 items give 104 objects per step.
- **Full snapshots make fd 3 big.** `dfs-adj` at 1,000 items sends 419 MB for 1,000 steps; the sparse form drops the scalar arrays but not `adj` (320 MB). Recording that session took 22 s here, with other runs sharing the machine. A profile of the 50 MB prototype session puts 0.7 s of CPU in validating and decoding, and more than that in garbage collection. That's a tracer and worker cost, not a trace-size one; S6 (BE-09 §3) and BE-05 own it.

### Keyframe interval and chunk size

Two sessions: `dfs-adj` at 1,000 items as today's core encodes it, and `dfs-heap` sparse with sparse patches, as BE-04 §3 will.

| K | C | `dfs-adj`, 1,000 items: raw | gzip | largest chunk | `dfs-heap`, sparse patch: raw | gzip | largest chunk |
|---|---|---|---|---|---|---|---|
| 25 | 250 | 18.60 MB | 354 KB | 112 KB | 1.28 MB | 61 KB | 23 KB |
| 50 | 100 | 13.09 MB | 247 KB | 34 KB | 1.09 MB | 51 KB | 7 KB |
| **50** | **250** | **13.09 MB** | **246 KB** | **84 KB** | **1.09 MB** | **48 KB** | **15 KB** |
| 50 | 500 | 13.09 MB | 245 KB | 165 KB | 1.09 MB | 47 KB | 28 KB |
| 100 | 100 | 10.34 MB | 193 KB | 28 KB | 0.99 MB | 40 KB | 5 KB |
| 100 | 500 | 10.34 MB | 190 KB | 136 KB | 0.99 MB | 36 KB | 20 KB |

- **K = 100** saves 21% raw and 22% gzip on `dfs-adj`, where each keyframe holds 500 objects, and about 10% raw on `dfs-heap`, where sparse keyframes are small. The cost: a seek replays up to 99 deltas instead of 49 (§9.6). **K = 25** costs 42% more.
- **Chunk size** moves the total by under 10%. It mostly sets the largest download before a step can show: 34, 84 or 165 KB for chunks of 100, 250 or 500 on `dfs-adj`.

### With the 20 MB budget lifted

What 1,000 steps would cost if the budget didn't stop the run. The real core never keeps these.

| Session | Deltas | Raw | Gzip |
|---|---|---|---|
| `prefix`, 1,000 items | whole object | 26.91 MB | 770 KB |
| | any patch | 2.24 MB | 57 KB |
| `prefix`, 10,000 items | whole object | 258.89 MB | 1,532 KB |
| | any patch | 15.63 MB | 100 KB |
| `dfs-heap`, 10,000 items | whole object | 27.97 MB | 151 KB |
| | any patch | 13.50 MB | 84 KB |

- The only session that comes near 2 MB gzipped is `prefix` at the 10,000-item ceiling with whole-object deltas: 1.5 MB, from 259 MB raw that the core stops at 20 MB.
- Patches on dense items bring the same session to 15.6 MB, within the budget. `dfs-heap` at 10,000 items is still 13.5 MB with patches, because 20 keyframes of 2 × 10,000 zero cells are 13 MB on their own. Sparse keyframes fix that: 1.09 MB.

## Recommendation for G3

**Keep D2: a keyframe every 50 steps and chunks of 250.** The gzipped size passes with room to spare. The biggest DFS session is 246 KB, an eighth of the target, and no session the core kept went past 486 KB. K = 100 would save about a fifth, but doubles the deltas a seek replays, for a budget that isn't tight. Chunk size hardly changes the total.

The format question for G3 isn't the intervals; it's what a delta carries for a big array. Today a delta re-sends a changed object whole. That runs into the 20 MB uncompressed budget long before the gzip target: a fill loop over a 1,000-item array ends at step 747, and at the 10,000-item ceiling a trace ends by step 76. Dense items also hide most of a 200k array. §19.9.1 already plans the fix. S4's advice is to freeze that fix with the format, widen it in one place, and settle one gap it leaves:

1. **Sparse sequences for big scalar arrays** (§19.9.1, BE-09 §2), as planned. `dfs-heap`'s arrays become fully visible for 1.09 MB raw with patches (2.49 MB without), less than the 2.76 MB that 1,000 dense items cost.
2. **Cell patches in deltas, for dense `items` too** (BE-04 §3 plans them for sparse sequences only). A delta for a sequence whose type, length and other fields didn't change carries `patch: {"<index>": value}`. At 1,000 items this keeps `prefix` within the budget, all 1,000 steps in 2.24 MB raw where whole objects stop at step 747, and halves `dfs-adj` (13.09 → 6.61 MB). The same rule covers Python lists, which the Python tracer sends with up to 1,000 items and which have the same whole-object problem. It widens one sentence of the schema (`patch` is "changed cells of a sparse sequence" today) and the player's replay. Both are v1.1 additions (D24), and they're cheapest before the format freezes.
3. **Decide what an array of containers sends** (BE-09). `vector<int> adj[200005]` at 1,000 items is 1,000 heap objects, almost all empty vectors, and they take the whole 500-object budget. Two options: a smaller cap for arrays whose elements are containers, or a sparse sequence whose default is an empty container, so only non-empty elements become objects. The second needs an inline value for "empty container", which v1.1 doesn't have.

Found on the way, outside the size question: the variant tracer spends about 10 ms per 200k-element array per step finding the most common value with `collections.Counter`, so the sparse sessions took 14–39 s of GDB time against S1's 3 s. Every step is a full snapshot, so `dfs-adj` sends 320–419 MB through fd 3. S6 owns both.

## Not covered

- **amd64.** Trace size doesn't depend on the architecture. The prototype's `loop` and `recursion` sessions are byte-identical on arm64 and on the x86_64 machine BE-08 used, and `stl` differs only in addresses.
- **The D21 build.** `_GLIBCXX_DEBUG` changes container type names and the pretty printers' output.
- **What the prototype doesn't produce yet:** return values, pointers into arrays, `stdinPos`, the step limit.
- **2-D arrays.** `int grid[1000][1000]` is one heap object per row, so it meets the same 500-object budget as `adj`.
- **Python traces**, and the browser's cost to decompress and replay a chunk (S3).

## How to rerun

```sh
plans/spikes/s4/run.sh [dir]   # about 10 min; writes 2.4 GB of sessions to dir, a new temp dir by default
```

`run.sh` builds `viz-s4-gdb:spike` from `Dockerfile` for the machine's own architecture, since GDB's `ptrace` fails under emulation. For each program and tracer, `trace.sh` builds `main.cpp` inside the container with the §7.11.2 flags and runs GDB. `go run .` then measures every session and prints one table per session: the core's own numbers first, then each encoding and patch mode for K of 25, 50 and 100 and C of 100, 250 and 500.

The measuring tool is a separate Go module whose path sits under the backend's (`github.com/tu-hm/code-viz/backend/spikes4`), with a `replace` to `../../../backend`. Go's `internal` rule checks import paths, so it can import `internal/tracecore` without any code in `backend/`.
