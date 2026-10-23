# Frontend Work Plan (FE)

| | |
|---|---|
| **Role** | The web app: IDE integration, the `@viz/player` package (trace engine, renderer, views), source parsing with tree-sitter, narration, navigation, compare, design-system implementation, Storybook and Playwright tests, accessibility |
| **Based on** | `code-visualizer-spec.md` v1.1 and `code-visualizer-workplan.md`. Every **§** points to the spec. |
| **Start** | Monday 2026-10-26 |
| **Capacity** | 4.5 focus days per week, for one frontend engineer |
| **IDs** | `M0-xx` and `M1-xx` are the same as in the overview plan. `Mx-Fxx` are new frontend tasks. |
| **Working mode** | **Fixtures first:** every view is built and tested on fixture traces (Storybook) before the real backend data exists. |

## 1. Summary

| Milestone | FE load | FE capacity | Verdict |
|---|---|---|---|
| M0 (3 wks) | 13.5 days | 13.5 | Fits exactly |
| M1 (6 wks, option A) | 27 days | 27 | Fits exactly. Weeks 7–9 pull work forward from M2 and M3. |
| M2 (4 wks) | 12.5 days left (17.5 planned) | 18 | Fits. M2-F02, F03 and F05 are done in M1 week 9. If M2 stretches for backend (option A), continue with M5 tasks (see *M4 and M5*). |
| M3 (5 wks) | 21.5 days | 22.5 | Fits |
| M4 (2 wks) | 1 day + buffer | 9 | Slack: start M5 early |
| M5 (4 wks) | 22 days | 18 | Over by 4 days, unless M2 or M4 slack was used; cut list in *M4 and M5* |

- **Option A** (one backend engineer): backend runs long in M1 and M2, so FE has spare weeks. The plan uses them to pull student views forward, so M3 and M5 get lighter.
- **Option B** (two backend engineers): M1 is 3 weeks. Weeks 7–9 below then move into M2.

## 2. What FE needs, and the fallback until it lands

| Need | From | Due | Fallback |
|---|---|---|---|
| `trace.v1.schema.json` | BE, M0-05 | **Wed 28 Oct** | Draft types from spec §9 |
| Design tokens and layout v1.1 | DS, M0-20 | Fri 30 Oct (tokens), Fri 13 Nov (all M1 screens) | Spec mocks (§5, §19) |
| Real C++ traces from S1 | BE, M0-10 | Fri 6 Nov | Hand-written fixtures |
| Trace format frozen (G3) | Lead, BE | Fri 13 Nov | — |
| `api/openapi.yaml` | BE, M1-01 | **Tue 17 Nov** | MSW mocks from the spec §8 examples |
| Local stack | BE, M1-02 | Wed 18 Nov | MSW |
| Designs for the matrix view, Go to… and expected-output compare | DS, M1-21 (first part) | **Fri 4 Dec** | Spec mocks §19.4.3, §19.7, §19.8 |
| Real Python traces | BE, M1-05/06 | Fri 4 Dec | Fixtures |
| Staging | BE, M1-12 | Mon 28 Dec | Local stack |
| C++ `ptr` values | BE, M2-B04 | M2, week 3 | Fixtures with `ptr` |
| Sparse sequences and dirty cells | BE, M2-B07/08 | End of M2 | Sparse fixtures |
| Friendly-error payloads, `lineHits`, untraced tail | BE, M3-B01–B03 | M3, week 2 | Fixtures |

What FE gives BE:
- the fields each view needs, before G3 on 13 Nov;
- the friendly-error payload shape (with DS), before M3;
- the S8 result (tree-sitter accuracy), which decides whether BE must send exact access hints (M5-B01).

## 3. Week by week (M0 and M1, option A)

| Week | Dates | Tasks | Load |
|---|---|---|---|
| 1 | 26–30 Oct | M0-02 web skeleton · **M0-17 code pane** · M0-07 codegen (after the schema on Wed) · start M0-08 fixtures | 4.5 |
| 2 | 2–6 Nov | Finish M0-08 · **M0-13 arrow spike (S3)** · M0-15 player skeleton · start M0-16 engine | 4.5 |
| 3 | 9–13 Nov | Finish **M0-16 engine** · M0-18 controls · M0-19 basic state panel → M0 demo | 4.5 |
| 4 | 16–20 Nov | M1-13 IDE (MSW until OpenAPI on Tue) · M1-14 API client · start M1-16 heap cards | 4.5 |
| 5 | 23–27 Nov | Finish M1-16 · **M1-17 arrows** | 4 |
| 6 | 30 Nov – 4 Dec | M1-15 states · M1-18 narration v0 · M1-19 Storybook | 4.5 |
| 7 | 7–11 Dec | **M1-F01 tree-sitter spike (S8)** · start M1-F02 matrix view | 4.5 |
| 8 | 14–18 Dec | Finish M1-F02 · M1-F03 Go to… · M1-F04 expected-output compare | 4.5 |
| 9 | 21–25 Dec | Pulled forward from M2: **M2-F05** tree-sitter in the player · M2-F02 value formatters · M2-F03 record cards | 5 |

M1-20 (end-to-end on staging) moves to M2 week 1, because staging lands on 28 Dec.

## 4. M0 tasks (FE)

| ID | Task | Days | Depends on | Done when | Spec |
|---|---|---|---|---|---|
| M0-02 | Web workspace: pnpm, Vite 8, React 19.3, strict TypeScript, Tailwind v4, Vitest; `packages/player`, `apps/ide` | 0.5 | — | `pnpm test` and `pnpm build` pass | §18.1 |
| M0-07 | Codegen: TypeScript and Go types from the schemas; `make gen`; CI drift check | 1 | M0-05 | A hand edit fails CI | D14 |
| M0-08 | Fixtures: Python aliasing, binary search, DP grid, fib with memo, exception, plus a synthetic 1,000-step trace | 1.5 | M0-05 | All pass the schema | §5.3, §19 |
| M0-13 | **S3** SVG arrow overlay: 500 objects, 30 arrows | 2 | M0-02 | ≤ 16 ms per step | §18.7 |
| M0-15 | `@viz/player` skeleton: load header and chunks from files; sha256 check | 1 | M0-07 | Loads every fixture | §8.4 |
| M0-16 | Trace engine in a Web Worker (Comlink): keyframes and deltas, 200-step LRU | 3 | M0-15 | ≤ 16 ms per step on 1,000 steps; unit tests | §9.6 |
| M0-17 | Code pane: CodeMirror 6 read-only, `▶ ▷ !` gutter, hit-count column | 2 | M0-02 | Matches the §19.3 mock | §19.3 |
| M0-18 | Controls, slider, keyboard shortcuts | 1.5 | M0-16 | All §5.9 shortcuts work | §5.9 |
| M0-19 | Basic state panel: frames as tables, inline values, `#id` labels | 1 | M0-16 | Every fixture readable step by step | §5.2 |

**Total: 13.5 days.**

## 5. M1 tasks (FE)

| ID | Task | Days | Depends on | Done when | Spec |
|---|---|---|---|---|---|
| M1-13 | IDE: CodeMirror 6 editor, language picker from `GET /languages`, Visualize button and shortcut | 2 | M1-01 | Matches the §5.1 mock | §5.1 |
| M1-14 | API client (openapi-fetch + TanStack Query), long-poll loop, cancel | 1.5 | M1-01 | Survives an API restart mid-poll | §8.3 |
| M1-15 | States: loading, build error, runtime error, step limit, busy and retry | 2 | M0-20 | A story and an end-to-end test per §5.6 state | §5.6 |
| M1-16 | Heap cards and kind registry (`sequence`, `set`, `mapping`, `record`, `function`, `opaque`) | 3 | M0-19 | Matches the §5.3 mock | §9.5, §7.10 |
| M1-17 | Arrow overlay from S3: bundling, hover highlight, label fallback above 30 arrows | 2 | M0-13, M1-16 | Meets the S3 numbers in the real UI | §5.9 |
| M1-18 | Narration v0: call, return, value changes, output | 1.5 | M0-16 | Every fixture step has a line | §19.5 |
| M1-19 | Storybook on fixtures, plus visual regression | 1 | M1-16 | CI flags unintended visual changes | §15 |
| M1-F01 | **S8** web-tree-sitter (C++ and Python grammars, lazy-loaded): subscript and identifier detection on 50 real CP solutions | 2 | M0-17 | Accuracy measured; ≥ 95% target; bundle size noted | §18.7, D23 |
| M1-F02 | Matrix view: auto-switch for 2-D data, `[x]` writes from the diff, `·` for unset cells, i and j markers, frozen headers, 30 × 30 scroll | 3 | M1-16, DS designs | Matches the §19.4.3 mock on the DP fixture | §19.4.3 |
| M1-F03 | Go to…: next change (variable, cell, array), next time a line runs, next call, next print, error, step over and out | 2.5 | M0-16 | Every §19.8 jump has a unit test on fixtures | §19.8 |
| M1-F04 | Expected-output compare: paste, normalized compare, first difference mapped to its step, "output ended early" | 1.5 | M0-16 | Matches the §19.7 mock | §19.7 |

**Total: 22 days.** M1-20 (Playwright on staging, 1 day) moves to M2.

## 6. M2: C++ support and student views (FE tasks)

| ID | Task | Days | Depends on | Done when | Spec |
|---|---|---|---|---|---|
| M1-20 | Playwright end-to-end on staging, carried over from M1 | 1 | M1-12 | Runs nightly | §15 |
| M2-F01 | Pointer arrows from `ptr` values; `∅` for null; address on hover; "Show memory addresses" setting | 2 | M2-B04 | Matches the §5.4 mock | §5.4, §9.4 |
| M2-F02 | Value formatters: C++ (`char`, `enum`, `bool`, `long long`, floats) and Python | 1.5 | M1-16 | One test per formatter | §19.4.6 |
| M2-F03 | Record cards and the array-of-structs table | 1.5 | M1-16 | Edge-list fixture renders as a table | §19.4 |
| M2-F04 | Compile-error and warnings panel with links to lines | 2 | M2-B02 | Matches the §5.6 build-error mock | §5.6, §19.6 |
| M2-F05 | tree-sitter in the player: parse once per trace, cache per line | 2 | M1-F01 | Parsing never blocks a step change | D23 |
| M2-F06 | Index markers and range brackets; out-of-range marker in red | 3 | M2-F05 | Matches the §19.3 mock on the binary-search fixture | §19.4.1 |
| M2-F07 | Big arrays: 16-cell window following the active marker, minimap, non-zero only, Go to index | 3 | M2-B08 (fixtures until then) | Smooth on a 200,005-element sparse fixture | §19.4.2 |
| M2-F08 | Matrix inferred reads `(x)` from the line, labelled "read (inferred)" | 1.5 | M2-F05, M1-F02 | Matches the §19.4.3 mock | §19.9.2 |

**Total: 17.5 days, of which 12.5 remain under option A** (M2-F02, F03 and F05 are done in M1 week 9). With option A, backend's M2 runs about 6.5 weeks; FE then continues with M5-F01, F04, F05 and F06 (see *M4 and M5*) during that time.

## 7. M3: launch polish and student UX (FE tasks)

| ID | Task | Days | Depends on | Done when | Spec |
|---|---|---|---|---|---|
| M3-F01 | Full narration: input reads, loop passes, branch outcomes, "+N more", story panel | 2 | M2-F05 | Every rule in the §19.5 table has a test | §19.5 |
| M3-F02 | Hit-count gutter: warm tint, hover with share of all lines run | 1 | M3-B02 | Matches the §19.3 note | §19.3 |
| M3-F03 | Input cursor: Python exact; C++ inferred by counting `>>` operands and `scanf` conversions | 2 | M2-F05 | Binary-search fixture shows 10 of 10 tokens read | §19.9.4 |
| M3-F04 | Friendly-error UI: banner, hint, jump to step, values at the previous step, raw message | 1.5 | M3-B01 | Matches the §19.6 mocks | §19.6 |
| M3-F05 | Step-limit and untraced-tail banner; start-at-line dialog | 1.5 | M3-B03, M3-B04 | Matches the §5.6 mocks | §5.6, §19.8 |
| M3-F06 | Autoplay with speeds; stops at errors and breakpoints | 1.5 | M0-18 | §5.9 rules pass | §5.9 |
| M3-F07 | Share UI and permalink page (`/viz/{id}?step=42`) | 1.5 | M3-B06 | Opens at the right step | §8.6, FR-18 |
| M3-F08 | WATCH panel: pins, auto-watch of the current line's variables, short history | 2 | M2-F05 | Matches the §19.3 mock | §19.3 |
| M3-F09 | Narrow layout: Code, State and Output tabs | 2 | M1-16 | Matches the §5.8 mock | §5.8 |
| M3-F10 | Accessibility: keyboard paths, `aria-live` step announcements, contrast, reduced motion | 2 | — | axe-core clean; §5.10 checklist passes | §5.10, §19.10 |
| M3-F11 | Analytics events | 1 | — | Events visible in the analytics tool | §14 |
| M3-F12 | Performance: 5,000-step traces, 500 objects, memory under 300 MB | 2 | — | §13 step-navigation target met | §13 |
| M3-F13 | Launch fixes buffer | 1.5 | — | — | — |

**Total: 21.5 days.**

## 8. M4 and M5 (FE tasks)

| ID | Task | Days | Spec |
|---|---|---|---|
| M4-F01 | Check the C adapter needs no UI changes; add C formatters if needed | 1 | §10.4 |
| M5-F01 | Call tree: arguments and return values, ↺ repeated, collapse rules, jump to call or return | 3 | §19.4.4 |
| M5-F02 | Graph view: elkjs layered layout, stable positions, colour and label by array, 2-hop limit above 200 nodes | 5 | §19.4.5 |
| M5-F03 | Tree view from parent arrays and DFS trees | 2 | §19.4.5 |
| M5-F04 | Container widgets: stack, queue, deque, priority_queue, set, map, multiset | 2 | §19.4.6 |
| M5-F05 | Bits view | 1 | §19.4.6 |
| M5-F06 | Timeline lanes for pinned variables, plus history | 3 | §19.8 |
| M5-F07 | Conditional jumps (a small expression evaluator over step state) | 2 | §19.8 |
| M5-F08 | Loop-pass chips | 1 | §19.8 |
| M5-F09 | Constant badges; string labels on matrix headers | 1 | §19.4.3, §19.4.6 |
| M5-F10 | Fixes from the usability test | 2 | §19.11 |

**Total: 22 days against 18 days of capacity.**
- **Option A:** F01, F04, F05 and F06 (9 days) fit in the extra M2 weeks, so M5 fits.
- **Option B:** move F03 (tree view) and F09 (badges and labels) to after M5, and start M5 during M4's slack.

## 9. Definition of done (FE)

- A fixture and a Storybook story for every view and state; visual regression baseline updated on purpose only.
- Unit tests for the engine, navigation searches, narration rules and formatters.
- Works with the keyboard alone; nothing relies on colour only (§19.10).
- Stepping stays ≤ 16 ms on the 1,000-step fixture.
- Behind a feature flag until M3.
