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

- [ ] Pin a variable or a cell (`+ Pin`, or from a value's context menu)
- [ ] Columns: name · value · short history (`3 → 5`, "(unchanged)")
- [ ] Auto-watch: variables used on the current line, tagged *auto*, drop off when the line changes
- [ ] Pins persist for the session (per visualization)
- [ ] Out-of-scope pins shown greyed ("not in scope")
- [ ] **Done:** matches the §19.3 watch mock

## 2. Timeline strip & lanes (M5-F06 · 3 d)

- [ ] Timeline strip under the slider: `◆` input read, `■` output, `▲` call of the selected function, `!` error, `●` current; click to jump
- [ ] Lanes per pinned variable: `┼` where the value was set or changed
- [ ] Prev / Next change of a pinned variable
- [ ] Hover shows step narration (FE-09)
- [ ] Downsample markers for traces > 1,000 steps (no overlap)
- [ ] **Done:** matches the §19.8 timeline mock

## Done when

It matches the §19.3 watch mock and the §19.8 timeline mock.
