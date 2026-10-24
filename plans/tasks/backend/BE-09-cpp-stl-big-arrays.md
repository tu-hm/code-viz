# BE-09 · C++ STL & big arrays

| | |
|---|---|
| **Milestone** | M2 |
| **Estimate** | 10.5 days |
| **Depends on** | BE-08 §3 (variables) |
| **Blocks** | BE-04 §3 (sparse in `tracecore`), BE-11 show range, BE-14 |
| **Covers** | M2-B06, M2-B07, M2-B09, M2-B11 |
| **Spec** | §10.3, §15, §19.9.1, §18.7 S6 |
| **Gate** | **G5 · Fri 19 Feb** — big-array tracking (input: S6) |

🔁 **Handoff to FE:** sparse sequences + dirty cells by **end of M2**.

## 1. Type map with pretty printers (M2-B06 · 4 d)

`adapters/cpp/typemap.yaml` + code in `trace.py`. One unit test per row:

- [x] `std::string`, readable `const char*` → `str`
- [x] `T[N]`, `std::array<T,N>` → `sequence` with `fixed`
- [x] `std::vector` (+ `meta.capacity`), `std::deque`, `std::list` → `sequence`
- [x] `std::set`, `std::multiset` (`ordered: true`), `std::unordered_set` (`ordered: false`) → `set`
- [x] `std::map`, `std::multimap`, `std::unordered_map` → `mapping`
- [x] `std::pair` (`first`/`second`), `std::tuple` (`0..n`) → `record`
- [x] `std::stack`, `std::queue`, `std::priority_queue` → `sequence` of the underlying container + `meta.adapter`
- [x] `std::bitset<N>` → `sequence` of `bool`
- [x] User `struct`/`class` → `record`
- [x] Anything else → `opaque` with the pretty-printer summary
- [x] Items-per-container limit (1,000 / 10,000) with `truncated` + real `length`
- [x] Works with `_GLIBCXX_DEBUG` containers (debug-mode wrappers)

**Result:** where it differs from the list:

- The file is `adapters/cpp/typemap.json`, not `.yaml`: GDB's Python has no YAML parser and the tracer uses the standard library only. It maps a template name (with `std::__debug::`, `std::__cxx11::` and `std::__cxx1998::` taken out) to a kind and a reader, and also covers `string_view`, `unordered_multiset` and `unordered_multimap`. The manifest has no `typeMap` key (spec v1.10).
- Type names go through libstdc++'s type printers (`whatis`), so a checked and an unchecked build both show `std::vector<int>` and `std::map<std::string, int>`.
- **The limit is 100 items** for containers read through the printers (`deque`, `list`, sets, maps) and arrays of non-scalars, with the real `length`, `truncated` and a `window` on sequences. At 1,000 items a 1,000-entry `map` took 13.5 s per 1,000 steps, about 10 µs per tree node inside the printers. Arrays of scalars longer than 64 are sparse (§2) and keep up to 10,000 non-default cells. A garbage length (outside `[0, 2^32)`) makes the object `opaque` `unreadable`.
- `const char*` to readable memory is a `str`; `char*` stays a `ptr`. Records flatten user base classes and skip static members, a name that repeats becomes `Base::x`, and a library base class is one field. Anything else is `opaque` with GDB's text cut to 200 characters.
- "One unit test per row" is one golden fixture per row, `fixtures/cpp/type-*`, since `trace.py` only runs inside GDB. `TestTypeMapRowsHaveFixtures` fails when a `typemap.json` row shows up in no `type-*` golden. `type-unchecked` runs with `safetyChecks: false` through the new `vizctl trace --options`.

## 2. Sparse sequences & dirty cells (M2-B07 · 3 d)

- [x] Read each array with one `gdb.Inferior.read_memory` per step
- [x] Budget: ≤ 4 MB per array, ≤ 16 MB per step; over budget → window only
- [x] Diff against the previous step → exact dirty cells
- [x] Emit sparse form (default value + non-default cells) and patches on the wire
- [x] Coordinate with BE-04 §3 to store them in keyframes/deltas
- [x] **Done:** 200k-array DFS stays within the S4 size target

**Result:**

- Sparse: `T[N]`, `std::array` and `std::vector` of integers, `char`, `bool`, `float` or `double`, longer than 64. Read whole up to 4 MB per array and 16 MB per step; past that, the first 1,000 cells. Default: the most common value at first sight, picked again once when the non-default cells pass min(10,000, length/2). More than 10,000 non-default cells keep the first 1,000 (`truncated`, `window`).
- The tracer diffs when it sends a step, not when it takes the snapshot: a closing-brace snapshot can be dropped and a return step reuses an older one, so only the last sent step is a safe base. The diff compares 4 KB blocks, then 64-byte chunks, then cells; when most blocks changed it unpacks both arrays instead (S6: 6 ms against 22 ms at 200,005 ints).
- BE-04 §3: the core keeps every sparse sequence's cells, rejects a patch it can't apply, builds keyframes from its own copy and computes delta patches itself. Two new §11 limits: 10,000 cells per sequence, 100,000 per step (`size_limit`).
- A real 1,000-step DFS over two global `int[200005]` stores 885 KB raw, 32 KB gzipped, every array change in a delta a one-cell patch. `TestBigArrayDFSFitsTheSizeTarget` pins the same on generated wire (54 KB gzipped). Through `vizctl` the DFS takes 1.6–2.4 s, about 0.9–1.5 s of it tracing, at load average 14–19.
- Fixtures: `sparse-dfs`, `sparse-default` (`memset` to INF, a growing `vector`, `bool` and `double` arrays) and `sparse-window` (an 8 MB array and one over 10,000 cells); `pointer`, `read-loop` and `stack-overflow` changed to sparse.

## 3. Spike S6 — whole-array read cost (M2-B09 · 2 d)

- [x] Benchmark read + diff for a 200,005-int array (target ≤ 2 ms per step)
- [x] 1,000 steps in ≤ 3 s total
- [x] Report for **G5**; fallback is window-only

**Result:** [S6 report](../../spikes/s6-whole-array-read.md), a short run. Read and diff of 200,005 ints take about 0.1 ms per step (`read_memory` 60–77 µs, block diff 21–23 µs), and 1,000 steps 0.79–0.95 s against the 3 s target. The window-only fallback stays for arrays over the 4 MB and 16 MB budgets. Not measured there: p99, the 4 MB and 16 MB cases, amd64.

## 4. Conformance fixtures (M2-B11 · 1.5 d)

- [x] Port the shared Python cases to C++ under `fixtures/cpp/`
- [x] Check kinds line up (Python `list` ↔ C++ `vector` both `sequence`, recursion depth, exception/error steps)
- [ ] Conformance suite runs in CI and blocks merges

**Result:**

- New ports: `aliasing`, `binary-search`, `exception`, `input` and `thread-main` (`fib` and `long` were ports already). The C++ fixtures that held other programs under the names `exception` and `input` are now `throw-caught` and `cin-getline`. `recursion-limit` isn't ported: C++ has no recursion limit a program can catch, and `stack-overflow` covers deep recursion. `thread-main` keeps the DFS and leaves the thread out.
- `TestPortsAgreeAcrossLanguages` pairs every case name that has goldens in more than one language and compares exit kind, the untraced tail's exit, call depths, return count, the error step's depth, aliases, and the kinds of the variables both programs name. A caught C++ exception makes no step (FR-8), so only the last error is compared.
- **Open: "blocks merges".** The test runs in CI's `backend-test` job with the other goldens, but nothing blocks a merge until the CI checks are required on `main`, which is a decision waiting on you (STATUS).

## Done when

Each STL type has a test, and a 200k-array DFS stays within the size and time targets.
