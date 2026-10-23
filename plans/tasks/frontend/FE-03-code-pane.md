# FE-03 · Code pane

| | |
|---|---|
| **Milestone** | M0 (week 1) → M3 (hit counts) |
| **Estimate** | 3 days |
| **Depends on** | FE-01 §1; BE-11 §1 (`lineHits`, M3 week 2) for real hit counts |
| **Blocks** | FE-08 §3 (tree-sitter reuses the source), FE-10 (breakpoints), FE-02 §5 (autoplay stops) |
| **Covers** | M0-17, M3-F02 |
| **Spec** | §5.2, §5.10, §19.3, §19.9.3, §19.10 |

## 1. Read-only code pane (M0-17 · 2 d · week 1)

- [ ] CodeMirror 6, read-only, Python and C++ highlighting (lazy-loaded language packs)
- [ ] Line decorations: `▶` just executed (blue band), `▷` next line (amber outline), `!` error line (red) — mark **and** colour (§19.10)
- [ ] Breakpoint gutter: click a line number toggles `●`; stored per visualization; exposed to FE-02 autoplay and FE-10 "next time line runs"
- [ ] Note in the UI that breakpoints feed "Start tracing from line…" on the next run (§5.2)
- [ ] Auto-scroll to keep the current line visible (no jump if already visible)
- [ ] Hit-count column placeholder (`×n`) fed by fixtures
- [ ] Theme from design tokens (light/dark); font size follows settings
- [ ] Story per fixture; screen-reader label on the current line
- [ ] **Done:** matches the §19.3 mock on the binary-search fixture

## 2. Hit-count gutter (M3-F02 · 1 d)

- [ ] Read `summary.lineHits` (+ `lineHitsSource`) from the header
- [ ] `×n` per line; warm tint on the hottest lines (scale by share, colour-blind safe)
- [ ] Hover/focus: "ran 9 times · 35% of all lines run"
- [ ] If `lineHitsSource = "trace"` (crash), label counts as "recorded steps only"
- [ ] Hidden when the trace has no `lineHits`
- [ ] **Done:** matches the §19.3 note on the binary-search fixture

## Done when

It matches the §19.3 mock on the binary-search fixture, with hit counts from the real trace.
