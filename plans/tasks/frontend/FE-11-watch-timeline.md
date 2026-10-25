# FE-11 · Watch panel & timeline

| | |
|---|---|
| **Milestone** | M3 (watch) → M5 (timeline lanes; option A: during M2 slack) |
| **Estimate** | 5 days |
| **Depends on** | FE-08 §3 (line facts for auto-watch), FE-10 §1 (change search) |
| **Blocks** | — |
| **Covers** | M3-F08, M5-F06 |
| **Spec** | §19.3, §19.8 |

## 1. WATCH panel (M3-F08 · 2 d)

- [x] Pin a variable or a cell (`+ Pin`, or from a value's context menu) — `+ Pin` takes `x`, `a[2]` or `dp[2][3]`; right-click a local's row, a cell or a matrix cell in the state pane for "Pin … to watch"
- [x] Columns: name · value · short history (`3 → 5`, "(unchanged)") — the history is the last change up to this step; a first value, or one set from uninitialized, reads "(unchanged)"; a changed array reads "changed at step N"; `*` when it changed on this step
- [x] Auto-watch: variables used on the current line, tagged *auto*, drop off when the line changes — the next line's (`▷`) identifiers that are in scope, not internal and not references (arrays already have a card); **Pin** keeps one
- [x] Pins persist for the session (per visualization) — kept per trace ID in the store, so closing and reopening the same trace keeps them until the page reloads
- [x] Out-of-scope pins shown greyed ("not in scope")
- [ ] **Done:** matches the §19.3 watch mock — `cpp-binary-search` step 11 gives the mock's rows in a test (`l 4 0 → 4`, `r 7 (unchanged)`, `mid 5* 3 → 5`, `ans -1 (unchanged)`); not yet checked in Chrome

## 2. Timeline strip & lanes (M5-F06 · 3 d)

- [x] Timeline strip under the slider: `◆` input read, `■` output, `▲` call of the selected function, `!` error, `●` current; click to jump — markers sit above the slider as in the §19.3 mock; the selected function is Go to…'s "Next call of" choice; the legend lists only the kinds the run has
- [x] Lanes per pinned variable: `┼` where the value was set or changed — the worker walks the trace once per pin with Go to…'s rules ([memory](../../../memory/frontend/goto-search.md)), yielding every 256 steps
- [x] Prev / Next change of a pinned variable — for the selected lane (click its name), from the lane's own changes
- [x] Hover shows step narration (FE-09) — over the strip and the lanes, and on focus of any marker
- [x] Downsample markers for traces > 1,000 steps (no overlap) — whenever there are more steps than 16 px slots, at any length: one marker per slot, `!` before `▲` before `■` before `◆`, labelled "N more nearby"
- [ ] **Done:** matches the §19.8 timeline mock — lanes, `┼`, `●` and Prev/Next are in; not yet checked in Chrome

## Done when

It matches the §19.3 watch mock and the §19.8 timeline mock.
