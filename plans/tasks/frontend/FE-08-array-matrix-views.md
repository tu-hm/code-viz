# FE-08 · Array & matrix views

| | |
|---|---|
| **Milestone** | M1 (weeks 7–9) → M2 |
| **Estimate** | 14.5 days |
| **Depends on** | FE-03 (source), FE-06 §2 (cards); M1-21 designs by **Fri 4 Dec** (DS); BE-09 §2 (sparse + dirty cells, end of M2) |
| **Blocks** | FE-09 §2–3 (reads, branches, input tokens use tree-sitter), FE-11 §1 (auto-watch), FE-14 |
| **Covers** | M1-F01, M1-F02, M2-F05, M2-F06, M2-F07, M2-F08 |
| **Spec** | §5.5, §18.7 S8, §19.4.1–§19.4.3, §19.9.1, §19.9.2, D23 |
| **Gate** | S8 result feeds **G5 · Fri 19 Feb** and decides BE-11 §5 (exact access hints) |

The CP-focused data views. Fixtures first; real sparse data lands at the end of M2.

## 1. Spike S8 — tree-sitter accuracy (M1-F01 · 2 d · M1 week 7)

- [x] web-tree-sitter with C++ and Python grammars, lazy-loaded (WASM) — web-tree-sitter 0.27.1, tree-sitter-cpp 0.23.4, tree-sitter-python 0.25.0; the worker imports the `parse` chunk and one grammar only when a trace opens
- [x] Detect subscripts `a[i]`, `a[i±c]`, `dp[i][j]` and the identifiers used, per line — `source-facts.ts`, with read/write modes
- [ ] Collect 50 real CP solutions (C++ heavy) + hand-labelled expected markers / reads — 50 labelled programs (40 C++), but not real submissions: 33 are the repo's goldens and fixtures, 17 were written for the spike ([S8 report](../../spikes/s8-tree-sitter.md))
- [x] Measure: % of steps with correct markers and inferred reads (target ≥ 95%) — 99.9% of 1,717 traced steps, but 77.6% of subscript lines in the 17 contest-style programs
- [x] Note bundle size and parse time — C++ grammar 286 kB gzip, runtime 84 kB, JS 21 kB; parse 0.3 ms median (Node)
- [x] Report to Lead; if < 95% → BE-11 §5 is triggered (+3 d BE) — [S8 report](../../spikes/s8-tree-sitter.md) recommends triggering it
- [x] **Done:** accuracy measured and reported

## 2. Matrix view (M1-F02 · 3 d · M1 weeks 7–8)

- [x] Auto-switch for a sequence of equal-length sequences of primitives (`vector<vector<int>>`, `list[list[int]]`)
- [x] Rows folded into the grid ("rows #8 #9 #10 folded")
- [x] `[x]` written this step (exact, from the diff); `·` never set (default value) — `·` is a cell equal to its type's zero, so a cell set back to 0 also reads `·`
- [x] Row/column markers `i=2 ▶`, `j=3 ▼` from the current line's subscripts
- [ ] Frozen headers, up to 30 × 30 visible with scroll; optional heat tint by value — built (sticky headers, a 30-row box, Heat tint); not checked on a matrix over 30 × 30, since no fixture has one
- [x] Toggle Matrix ↔ Cards per variable, remembered for the session; "Matrix view" setting — labelled Matrix | Cells, as the §19.4 table and the record toggle
- [x] **Done:** matches the §19.4.3 mock on the DP fixture (writes only; reads in §6) — checked in Chrome, light and dark; design sign-off waits on M1-21

## 3. tree-sitter in the player (M2-F05 · 2 d · pulled into M1 week 9 under option A)

- [x] Parse the source once per trace in the worker; cache per-line facts (subscripts, identifiers, `cin >>` operands, `scanf` conversions, `if`/`while`/`for` headers)
- [x] API: `lineFacts(line)` used by markers, matrix reads, narration, input cursor, auto-watch — markers, reads and the matrix narration use it; FE-09 and FE-11 read the same facts from the store
- [x] Prefer `access[]` from the trace when present (§19.9.2) and skip inference
- [x] Never blocks a step change (async, falls back to "no markers" until ready)
- [x] **Done:** parsing never blocks a step change

## 4. Index markers & ranges (M2-F06 · 3 d)

- [x] Markers from integer variables used as subscripts of that array on the **current or previous** line; `i+1` labels
- [x] Up to 4 markers; more collapse into "+2"
- [x] Pin markers ("Mark `l`, `r` on `a`") — stay on every step
- [x] Range bracket for known pairs (`l`/`r`, `lo`/`hi`, `L`/`R`, `left`/`right`, `i`/`j`); "empty range" when `l > r` — on an array the line already marks ([memory](../../../memory/frontend/array-markers.md))
- [x] Out-of-range marker at the edge in red: "i = 8 ▶ out of range, size 8"
- [x] Strings: inline text with markers when indexed
- [x] **Done:** matches the §19.3 mock on the binary-search fixture — checked in Chrome

## 5. Big arrays (M2-F07 · 3 d)

- [x] Arrays > 64 elements: 16-cell window following the active marker
- [x] `[` / `]` move the window; **Go to index…**
- [x] Minimap: whole array, ticks for non-default cells and cells changed this step, window position
- [x] **Non-zero only** list (default = most common value: `0`, `-1`, `INF`)
- [x] Read sparse sequences + `patch` (§19.9.1); `truncated: true` → window only, with "Show range…" (FE-05 §4)
- [x] 200,005-element sparse fixture — `cpp-sparse-dfs`, the backend's `sparse-dfs` golden
- [x] **Done:** smooth on the 200,005-element sparse fixture — keydown to DOM 2.5 ms p50, 4.2 ms p95, 5.5 ms max over 402 steps, production build, headless Chrome

## 6. Matrix inferred reads (M2-F08 · 1.5 d)

- [x] Evaluate RHS subscripts with values from **before** the line ran
- [x] `(x)` read marks, labelled "read (inferred)" on hover — a `title`, plus the legend and screen-reader text, since a title doesn't show on focus or tap
- [x] Narration line in the matrix header: `dp[2][3] = 10 (was ·) from dp[1][3] = 4 and dp[2][2] = 6` (shares FE-09 templates) — built in `marks.ts`; FE-09 can move it into its templates
- [x] **Done:** matches the §19.4.3 mock

## Done when

Binary search, a 200k-element array and the DP grid match the §19.4 mocks.
