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

- [ ] `std::string`, readable `const char*` → `str`
- [ ] `T[N]`, `std::array<T,N>` → `sequence` with `fixed`
- [ ] `std::vector` (+ `meta.capacity`), `std::deque`, `std::list` → `sequence`
- [ ] `std::set`, `std::multiset` (`ordered: true`), `std::unordered_set` (`ordered: false`) → `set`
- [ ] `std::map`, `std::multimap`, `std::unordered_map` → `mapping`
- [ ] `std::pair` (`first`/`second`), `std::tuple` (`0..n`) → `record`
- [ ] `std::stack`, `std::queue`, `std::priority_queue` → `sequence` of the underlying container + `meta.adapter`
- [ ] `std::bitset<N>` → `sequence` of `bool`
- [ ] User `struct`/`class` → `record`
- [ ] Anything else → `opaque` with the pretty-printer summary
- [ ] Items-per-container limit (1,000 / 10,000) with `truncated` + real `length`
- [ ] Works with `_GLIBCXX_DEBUG` containers (debug-mode wrappers)

## 2. Sparse sequences & dirty cells (M2-B07 · 3 d)

- [ ] Read each array with one `gdb.Inferior.read_memory` per step
- [ ] Budget: ≤ 4 MB per array, ≤ 16 MB per step; over budget → window only
- [ ] Diff against the previous step → exact dirty cells
- [ ] Emit sparse form (default value + non-default cells) and patches on the wire
- [ ] Coordinate with BE-04 §3 to store them in keyframes/deltas
- [ ] **Done:** 200k-array DFS stays within the S4 size target

## 3. Spike S6 — whole-array read cost (M2-B09 · 2 d)

- [ ] Benchmark read + diff for a 200,005-int array (target ≤ 2 ms per step)
- [ ] 1,000 steps in ≤ 3 s total
- [ ] Report for **G5**; fallback is window-only

## 4. Conformance fixtures (M2-B11 · 1.5 d)

- [ ] Port the shared Python cases to C++ under `fixtures/cpp/`
- [ ] Check kinds line up (Python `list` ↔ C++ `vector` both `sequence`, recursion depth, exception/error steps)
- [ ] Conformance suite runs in CI and blocks merges

## Done when

Each STL type has a test, and a 200k-array DFS stays within the size and time targets.
