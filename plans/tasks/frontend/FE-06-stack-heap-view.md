# FE-06 · Stack & heap view

| | |
|---|---|
| **Milestone** | M0 (week 3) → M1 (weeks 4–5) → M2 → M4 |
| **Estimate** | 8 days |
| **Depends on** | FE-02 §2 (engine); BE-09 §1 (STL type map) for real C++ containers |
| **Blocks** | FE-07 (arrows), FE-08 (array/matrix), FE-14 (widgets) |
| **Covers** | M0-19, M1-16, M2-F02, M2-F03, M4-F01 |
| **Spec** | §5.2–§5.4, §7.10, §9.3–§9.5, §19.4, §19.4.6, FR-23 |

## 1. Basic state panel (M0-19 · 1 d · M0 week 3)

- [ ] One table per frame, outermost first; **Globals** as its own frame
- [ ] Active frame: `═` border, scrolled into view
- [ ] Primitives inline (`int float bool char str none`); references as `●──▶ #id` labels
- [ ] `uninit` / `unavailable` rendered distinctly (greyed, tooltip)
- [ ] Changed values bold + `*` (from the engine's diff)
- [ ] **Done:** every fixture readable step by step

## 2. Heap cards & kind registry (M1-16 · 3 d · M1 weeks 4–5)

- [ ] Kind registry in `@viz/player` (§7.10): `kind → component`, unknown → `opaque`
- [ ] `sequence`: cells with indices, `len`/`size`/`cap` in the title, `… +N` + "Show range…" when windowed
- [ ] `set`: sorted cells; `mapping`: key/value table
- [ ] `record`: field table
- [ ] `function`: signature card
- [ ] `opaque`: type + summary text
- [ ] Cards in first-seen order; title `#id type · len N ◀ a, b` (referrers listed — aliasing must be obvious)
- [ ] Unreachable objects hidden unless the setting is on
- [ ] New objects fade in (150 ms, off under reduced motion)
- [ ] Hidden internals: `hidden: N internals [Show]` per frame (FR-23); setting shows them
- [ ] Click a frame title → jump the code pane to its line
- [ ] **Done:** matches the §5.3 mock

## 3. Value formatters (M2-F02 · 1.5 d · M2; was pulled into M1 week 9, moved back to fit FE-01 §6 + FE-02 §4)

- [ ] Formatter registry keyed by language + type
- [ ] C++: `char` as `'a'` (`97` on hover), `bool` true/false, `enum` names, `long long`/unsigned, floats to 6 significant digits (full on hover)
- [ ] Python: `str` repr with quotes, `None`, big ints, floats
- [ ] Thousands separators on hover
- [ ] `pair`/`tuple` inline as `(4, 2)`
- [ ] One unit test per formatter
- [ ] **Done:** one test per formatter passes

## 4. Record cards & array-of-structs table (M2-F03 · 1.5 d · M2; was pulled into M1 week 9, moved back to fit FE-01 §6 + FE-02 §4)

- [ ] Struct/class cards with nested fields and pointer fields (`●` for FE-07)
- [ ] Array/vector of structs or tuples → table: one row per element, one column per field
- [ ] Toggle Table ↔ Cells, remembered per variable for the session
- [ ] Edge-list fixture (`vector<pair<int,int>>`, `struct Edge {u, v, w}`)
- [ ] **Done:** edge-list fixture renders as a table

## 5. C language check (M4-F01 · 1 d)

- [ ] Run the BE-14 C fixtures through the player; confirm no UI changes needed
- [ ] Add C formatters if any type is missing (e.g. `_Bool`, plain arrays, `char*` strings)
- [ ] Settings for pointers/addresses shown via manifest `capabilities`
- [ ] **Done:** C conformance fixtures render with no code changes outside formatters

## Done when

It matches the §5.3 Python mock and the §5.4 C++ mock.
