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

- [ ] web-tree-sitter with C++ and Python grammars, lazy-loaded (WASM)
- [ ] Detect subscripts `a[i]`, `a[i±c]`, `dp[i][j]` and the identifiers used, per line
- [ ] Collect 50 real CP solutions (C++ heavy) + hand-labelled expected markers / reads
- [ ] Measure: % of steps with correct markers and inferred reads (target ≥ 95%)
- [ ] Note bundle size and parse time
- [ ] Report to Lead; if < 95% → BE-11 §5 is triggered (+3 d BE)
- [ ] **Done:** accuracy measured and reported

## 2. Matrix view (M1-F02 · 3 d · M1 weeks 7–8)

- [ ] Auto-switch for a sequence of equal-length sequences of primitives (`vector<vector<int>>`, `list[list[int]]`)
- [ ] Rows folded into the grid ("rows #8 #9 #10 folded")
- [ ] `[x]` written this step (exact, from the diff); `·` never set (default value)
- [ ] Row/column markers `i=2 ▶`, `j=3 ▼` from the current line's subscripts
- [ ] Frozen headers, up to 30 × 30 visible with scroll; optional heat tint by value
- [ ] Toggle Matrix ↔ Cards per variable, remembered for the session; "Matrix view" setting
- [ ] **Done:** matches the §19.4.3 mock on the DP fixture (writes only; reads in §6)

## 3. tree-sitter in the player (M2-F05 · 2 d · pulled into M1 week 9 under option A)

- [ ] Parse the source once per trace in the worker; cache per-line facts (subscripts, identifiers, `cin >>` operands, `scanf` conversions, `if`/`while`/`for` headers)
- [ ] API: `lineFacts(line)` used by markers, matrix reads, narration, input cursor, auto-watch
- [ ] Prefer `access[]` from the trace when present (§19.9.2) and skip inference
- [ ] Never blocks a step change (async, falls back to "no markers" until ready)
- [ ] **Done:** parsing never blocks a step change

## 4. Index markers & ranges (M2-F06 · 3 d)

- [ ] Markers from integer variables used as subscripts of that array on the **current or previous** line; `i+1` labels
- [ ] Up to 4 markers; more collapse into "+2"
- [ ] Pin markers ("Mark `l`, `r` on `a`") — stay on every step
- [ ] Range bracket for known pairs (`l`/`r`, `lo`/`hi`, `L`/`R`, `left`/`right`, `i`/`j`); "empty range" when `l > r`
- [ ] Out-of-range marker at the edge in red: "i = 8 ▶ out of range, size 8"
- [ ] Strings: inline text with markers when indexed
- [ ] **Done:** matches the §19.3 mock on the binary-search fixture

## 5. Big arrays (M2-F07 · 3 d)

- [ ] Arrays > 64 elements: 16-cell window following the active marker
- [ ] `[` / `]` move the window; **Go to index…**
- [ ] Minimap: whole array, ticks for non-default cells and cells changed this step, window position
- [ ] **Non-zero only** list (default = most common value: `0`, `-1`, `INF`)
- [ ] Read sparse sequences + `patch` (§19.9.1); `truncated: true` → window only, with "Show range…" (FE-05 §4)
- [ ] 200,005-element sparse fixture
- [ ] **Done:** smooth on the 200,005-element sparse fixture

## 6. Matrix inferred reads (M2-F08 · 1.5 d)

- [ ] Evaluate RHS subscripts with values from **before** the line ran
- [ ] `(x)` read marks, labelled "read (inferred)" on hover
- [ ] Narration line in the matrix header: `dp[2][3] = 10 (was ·) from dp[1][3] = 4 and dp[2][2] = 6` (shares FE-09 templates)
- [ ] **Done:** matches the §19.4.3 mock

## Done when

Binary search, a 200k-element array and the DP grid match the §19.4 mocks.
