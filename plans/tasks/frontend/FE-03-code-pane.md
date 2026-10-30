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

- [x] CodeMirror 6, read-only, Python and C++ highlighting (lazy-loaded language packs) — picked by the language's `editorMode`; an unknown mode, or a pack that fails to load, shows plain text (the latter says so). Keywords, strings and comments only, with three new `syntax-*` tokens
- [x] Line decorations: `▶` just executed (blue band), `▷` next line (amber outline), `!` error line (red) — mark **and** colour (§19.10) — an error step shows only `!`; a step whose next line is the line it just ran (a return) shows only `▶`
- [x] Breakpoint gutter: click a line number toggles `●`; stored per visualization; exposed to FE-02 autoplay and FE-10 "next time line runs" — `usePlayer` `breakpoints`, emptied when a trace opens; Enter on the caret's line toggles too
- [x] Note in the UI that breakpoints feed "Start tracing from line…" on the next run (§5.2) — a line under the code, announced politely
- [x] Auto-scroll to keep the current line visible (no jump if already visible) — the next line, else the error or the line just run; checked in Chrome on `synthetic-1000`
- [x] Hit-count column placeholder (`×n`) fed by fixtures — real counts from the header (§2)
- [x] Theme from design tokens (light/dark); font size follows settings — checked in Chrome, including a live switch to L
- [ ] Story per fixture; screen-reader label on the current line — labels in ("Line 9, just ran:"); Storybook waits on FE-01 §4, and a test per fixture renders the pane until then
- [x] **Done:** matches the §19.3 mock on the binary-search fixture — checked in Chrome, light and dark

## 2. Hit-count gutter (M3-F02 · 1 d)

- [x] Read `summary.lineHits` (+ `lineHitsSource`) from the header
- [x] `×n` per line; warm tint on the hottest lines (scale by share, colour-blind safe) — three amber tints by where a count sits between the run's lowest and highest, none when every line ran equally often; contrast tested in both themes
- [x] Hover/focus: "ran 9 times · 35% of all lines run" — hover or tap the `×n`, or put the caret on the line
- [x] If `lineHitsSource = "trace"` (crash), label counts as "recorded steps only" — in the tooltip and in a note under the code
- [x] Hidden when the trace has no `lineHits`
- [x] **Done:** matches the §19.3 note on the binary-search fixture — the fixture's counts equal the real `backend/fixtures/cpp/line-hits` trace's gcov counts

## Done when

It matches the §19.3 mock on the binary-search fixture, with hit counts from the real trace.
