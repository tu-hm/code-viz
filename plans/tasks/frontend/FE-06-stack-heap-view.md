# FE-06 · Stack & heap view

| | |
|---|---|
| **Milestone** | M0 (week 3) → M1 (weeks 4–5) → M2 → M4 |
| **Estimate** | 8 days |
| **Depends on** | FE-02 §2 (engine); BE-09 §1 (STL type map) for real C++ containers |
| **Blocks** | FE-07 (arrows), FE-08 (array/matrix), FE-14 (widgets) |
| **Covers** | M0-19, M1-16, M2-F02, M2-F03, M4-F01 |
| **Spec** | §5.2–§5.4, §7.10, §9.3–§9.5, §19.4, §19.4.6, FR-23 |

The player draws the state pane itself (`StateBox` in `player.tsx`, the view in `state-pane.tsx`); the `statePane` slot is gone. What gets a card and what folds away: [memory](../../../memory/frontend/state-pane-folding.md).

## 1. Basic state panel (M0-19 · 1 d · M0 week 3)

- [x] One table per frame, outermost first; **Globals** as its own frame — each title also shows the frame's line
- [x] Active frame: `═` border, scrolled into view — a 2px brand outline plus "▲ active frame" under it; scrolls into view when a call or return changes it, not on every step
- [x] Primitives inline (`int float bool char str none`); references as `●──▶ #id` labels — `ptr` too, with `∅` for `nullptr` and the address on hover; `RefLabel` in `value-view.tsx` draws every `●`, for FE-07 to attach to. IDs read `#o2`, as in the step label, not the mock's `#2`
- [x] `uninit` / `unavailable` rendered distinctly (greyed, tooltip) — `·` and `?` in `text-trace-unset`; the tooltip gives the type and the tracer's reason
- [x] Changed values bold + `*` (from the engine's diff) — off with "Highlight changed values"; a pair shown inline is marked when one of its members changed
- [x] **Done:** every fixture readable step by step — `state-pane.test.tsx` renders every step of every fixture (five on each synthetic one): a table per frame in stack order, and a card behind every `●──▶ #id`

## 2. Heap cards & kind registry (M1-16 · 3 d · M1 weeks 4–5)

- [x] Kind registry in `@viz/player` (§7.10): `kind → component`, unknown → `opaque` — `cards` in `cards.tsx`, typed against the schema's kinds, so a kind can't be left out; `class` too
- [x] `sequence`: cells with indices, `len`/`size`/`cap` in the title, `… +N` + "Show range…" when windowed — the first 100 cells (FR-11), 16 of a sparse array until FE-08's window; `… +N` on both sides of a window. "Show range…" calls the new `Player` prop `onShowRange(variable)`, and shows only on a `truncated` sequence that a variable refers to, when the host passes the prop (FE-05 re-runs)
- [x] `set`: sorted cells; `mapping`: key/value table — unordered ones are sorted for reading; ordered ones (`std::set`, a Python `dict`) keep their order
- [x] `record`: field table
- [x] `function`: signature card
- [x] `opaque`: type + summary text
- [x] Cards in first-seen order; title `#id type · len N ◀ a, b` (referrers listed — aliasing must be obvious) — variables first, then places in other objects (`#o4.next`, `#o5[0]`); six, then "+N more"
- [x] Unreachable objects hidden unless the setting is on — the core sends only what the stack reaches, so today this changes nothing; objects reached only through hidden internals hide with the internals
- [x] New objects fade in (150 ms, off under reduced motion) — `@starting-style` with `--duration-fade`; Safari before 17.5 shows them without the fade
- [x] Hidden internals: `hidden: N internals [Show]` per frame (FR-23); setting shows them — the core drops internals unless the run asked for them, so the count shows on runs made with "Show compiler internals" on and then hidden; `cpp-edge-list` has three
- [x] Click a frame title → jump the code pane to its line — the caret lands on the line, which scrolls into view, and the code pane takes focus
- [ ] **Done:** matches the §5.3 mock — built to it: `python-aliasing` step 9 draws the mock's tables, cards and `◀ a, b`; waits on design sign-off

## 3. Value formatters (M2-F02 · 1.5 d · M2; was pulled into M1 week 9, moved back to fit FE-01 §5 + FE-02 §4)

- [x] Formatter registry keyed by language + type — `formatterFor(languageId)` in `format.ts`, then `t` and the declared `type`; an unknown language gets plain values
- [x] C++: `char` as `'a'` (`97` on hover), `bool` true/false, `enum` names, `long long`/unsigned, floats to 6 significant digits (full on hover) — integers stay strings, so 64-bit values keep every digit; the tracer already sends enum names; types read without `std::`
- [x] Python: `str` repr with quotes, `None`, big ints, floats — floats to 6 significant digits too, keeping `.0`
- [x] Thousands separators on hover — on integers of four digits or more. Hover is a `title`, so keyboard and touch users don't get these details yet (design checklist); one reveal for values and FE-07's addresses would fix both
- [x] `pair`/`tuple` inline as `(4, 2)` — C++ `pair`/`tuple` records and Python tuples whose members are all scalars, unless a pointer targets them
- [x] One unit test per formatter — `format.test.ts`
- [x] **Done:** one test per formatter passes

## 4. Record cards & array-of-structs table (M2-F03 · 1.5 d · M2; was pulled into M1 week 9, moved back to fit FE-01 §5 + FE-02 §4)

- [x] Struct/class cards with nested fields and pointer fields (`●` for FE-07) — a C++ struct held in another's field nests inside its card; Python attributes stay references
- [x] Array/vector of structs or tuples → table: one row per element, one column per field — rows fold into the table unless something outside it refers to them, like a range-for's `auto &e`
- [x] Toggle Table ↔ Cells, remembered per variable for the session — `views` in `usePlayer`, not persisted; an object no variable names is keyed by its `#id`
- [x] Edge-list fixture (`vector<pair<int,int>>`, `struct Edge {u, v, w}`) — `cpp-edge-list`, a real trace from `make dev` with internals on; also `cpp-pointers`, the §5.4 program, from the backend golden
- [x] **Done:** edge-list fixture renders as a table

## 5. C language check (M4-F01 · 1 d)

- [ ] Run the BE-14 C fixtures through the player; confirm no UI changes needed — BE-14 has no C fixtures yet
- [ ] Add C formatters if any type is missing (e.g. `_Bool`, plain arrays, `char*` strings) — waits on BE-14's language id and fixtures; a C formatter is one line in `formatters`
- [ ] Settings for pointers/addresses shown via manifest `capabilities` — "Show memory addresses" already follows `capabilities.pointers` (FE-02 §4); unchecked on C until BE-14's manifest exists
- [ ] **Done:** C conformance fixtures render with no code changes outside formatters

## Done when

It matches the §5.3 Python mock and the §5.4 C++ mock. Built to both (`python-aliasing` step 9, `cpp-pointers` steps 6–7); waits on design sign-off.

Stepping stays fast: keydown to DOM on `synthetic-5000` (500 objects) is 4.0 ms p50, 7.0 ms p95 in a production build in Chrome, 16.7 ms p50 at 4× CPU throttle; `synthetic-1000` 1.9 ms p50. [Memory](../../../memory/frontend/state-pane-skips-unchanged.md) has how.
