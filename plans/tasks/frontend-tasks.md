# Frontend Tasks (FE)

14 feature-level tasks. Each one is a piece of functionality you can demo when it's done. The old fine-grained IDs from `workplan-frontend.md` are listed under **Covers**, so you can still trace each task back to the plan. § = section in `code-visualizer-spec_2.md`.

**Fixtures first:** build every view on fixture traces in Storybook before real backend data exists.

| # | Task | Milestone | Est (days) |
|---|---|---|---|
| FE-01 | Foundation & fixtures | M0–M2 | 5 |
| FE-02 | Trace player & step controls | M0, M3 | 9 |
| FE-03 | Code pane | M0, M3 | 3 |
| FE-04 | Visualize from the IDE | M1 | 3.5 |
| FE-05 | Run states & error screens | M1–M3 | 7 |
| FE-06 | Stack & heap view | M0–M2 | 8 |
| FE-07 | Reference & pointer arrows | M0–M2 | 6 |
| FE-08 | Array & matrix views | M1–M2 | 14.5 |
| FE-09 | Narration & input cursor | M1, M3 | 5.5 |
| FE-10 | Go to… & expected-output compare | M1 | 4 |
| FE-11 | Watch panel & timeline | M3, M5 | 5 |
| FE-12 | Share & permalinks | M3 | 1.5 |
| FE-13 | Mobile, accessibility & analytics | M3 | 6.5 |
| FE-14 | CP data views | M5 | 19 |

---

## M0–M1 · Core player

- [ ] **FE-01 · Foundation & fixtures**
  Web workspace (`apps/ide`, `packages/player`), types generated from the backend schemas, hand-written fixture traces (aliasing, binary search, DP grid, fib, exception, 1,000 steps), Storybook with visual regression, and nightly end-to-end tests on staging.
  *Done when:* every fixture loads in Storybook, and E2E runs nightly. · *Covers:* M0-02, M0-07, M0-08, M1-19, M1-20 · §15, §18.1

- [ ] **FE-02 · Trace player & step controls**
  Load a trace and move to any step instantly: Start, Prev, Next, End, slider, keyboard shortcuts, and autoplay at several speeds (stops at errors and breakpoints). Must stay fast on big traces.
  *Done when:* stepping takes ≤ 16 ms on 1,000 steps and works on 5,000 steps with memory under 300 MB. · *Covers:* M0-15, M0-16, M0-18, M3-F06, M3-F12 · §5.9, §9.6, §13

- [ ] **FE-03 · Code pane**
  Read-only code with marks for the line just executed, the next line and the error line, a breakpoint gutter, and hit-count shading per line.
  *Done when:* it matches the §19.3 mock on the binary-search fixture. · *Covers:* M0-17, M3-F02 · §19.3

- [ ] **FE-04 · Visualize from the IDE**
  Visualize button and shortcut in the IDE (shown only for supported languages), a request to the API, live status through long-polling, and cancel.
  *Done when:* clicking Visualize on Python code opens the player; a mid-run API restart doesn't break it. · *Covers:* M1-13, M1-14 · §5.1, §8.3

- [ ] **FE-05 · Run states & error screens**
  Every state other than "ready": loading progress, compile errors and warnings (with links to lines), runtime errors with a friendly message and hint, the step-limit banner with a "start from line…" dialog, and server busy with retry.
  *Done when:* every §5.6 and §19.6 state has a story and an E2E test. · *Covers:* M1-15, M2-F04, M3-F04, M3-F05 · §5.6, §19.6

- [ ] **FE-06 · Stack & heap view**
  Stack frames as tables (separate globals frame, active frame highlighted) and heap objects as cards: lists and arrays, sets, maps, structs/records, arrays of structs as a table, functions. Correct value formatting for Python, C++ and C, and changed values highlighted.
  *Done when:* it matches the §5.3 Python mock and the §5.4 C++ mock. · *Covers:* M0-19, M1-16, M2-F02, M2-F03, M4-F01 · §5.2–§5.4, §9.5

- [ ] **FE-07 · Reference & pointer arrows**
  Arrows from variables to the objects they point at, for Python references and C++ pointers. Includes `∅` for null, the address on hover, bundling, hover highlight, and plain labels when there are too many arrows. Starts with the S3 performance spike.
  *Done when:* 500 objects and 30 arrows render in ≤ 16 ms per step. · *Covers:* M0-13, M1-17, M2-F01 · §5.4, §5.9

## M1–M2 · Student views

- [ ] **FE-08 · Array & matrix views**
  The CP-focused data views. Index markers (`i`, `lo`, `hi`) and range brackets on arrays, a window, minimap and "non-zero only" mode for huge arrays, a matrix view for DP tables with read and write marks. Source parsing in the browser (tree-sitter) works out which indexes each line uses; start with the accuracy spike (S8).
  *Done when:* binary search, a 200k-element array and the DP grid match the §19.4 mocks. · *Covers:* M1-F01, M1-F02, M2-F05, M2-F06, M2-F07, M2-F08 · §19.4.1–§19.4.3

- [ ] **FE-09 · Narration & input cursor**
  One plain-English line per step ("called f(5)", "i changed 3 → 4", "read 7 from input", "loop pass 3", "branch taken") and an input panel showing which stdin tokens have been read so far.
  *Done when:* every narration rule has a test, and the binary-search fixture shows 10 of 10 tokens read. · *Covers:* M1-18, M3-F01, M3-F03 · §19.5, §19.9.4

- [ ] **FE-10 · Go to… & expected-output compare**
  Jump instead of crawling: next change, next time a line runs, next call, next print, the error step, step over and step out. Paste the expected output and jump to the step that printed the first wrong line.
  *Done when:* each jump has a unit test, and compare matches the §19.7 mock. · *Covers:* M1-F03, M1-F04 · §19.7, §19.8

## M3 · Launch

- [ ] **FE-11 · Watch panel & timeline**
  Pin variables to watch with a short value history; auto-watch the current line's variables. Later, timeline lanes that show how pinned values change over the whole run.
  *Done when:* it matches the §19.3 watch mock. · *Covers:* M3-F08, M5-F06 · §19.3, §19.8

- [ ] **FE-12 · Share & permalinks**
  Share button and a permalink page that opens at a given step (`/viz/{id}?step=42`).
  *Done when:* a shared link opens at the right step. · *Covers:* M3-F07 · §8.6

- [ ] **FE-13 · Mobile, accessibility & analytics**
  Code, State and Output tabs on narrow screens; full keyboard use, screen-reader step announcements, contrast and reduced motion; analytics events; launch-fix buffer.
  *Done when:* axe-core is clean, the §5.8 mock works on mobile, and events show up in the analytics tool. · *Covers:* M3-F09, M3-F10, M3-F11, M3-F13 · §5.8, §5.10, §14

## M5 · CP data views

- [ ] **FE-14 · CP data views**
  Recursion call tree, graph and tree views, stack/queue/set/map widgets, bits view, conditional jumps ("go to when x > 5"), loop-pass chips, constant badges. Then fix the top issues from the 8-student usability test.
  *Done when:* the usability test meets §19.11. · *Covers:* M5-F01–F05, M5-F07–F10 · §19.4.4–§19.4.6, §19.11
  *Cut first if late:* tree view, constant badges.

---

**Every task:** fixture plus Storybook story, unit tests for logic, usable by keyboard alone, nothing shown by colour only, and a feature flag until M3.
