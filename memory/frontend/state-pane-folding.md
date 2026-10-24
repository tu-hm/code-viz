# What the state pane draws as a card, and what it folds away

Decided 2026-10-25.

**Decision:** `layoutState` in `state-layout.ts` decides it, from the step alone:

- An object reached only through hidden internals hides with them. "Unreachable" means no local reaches it, internal or not; only those wait on "Show unreachable objects".
- A `pair`/`tuple` whose members are all scalars reads inline, `(4, 2)`, and gets no card, unless a pointer targets it.
- A C++ struct held in another struct's field, and nowhere else, nests inside that card. Python attributes always stay references.
- A sequence of records or tuples with the same fields is a table by default. Its rows get no card unless something outside the sequence also refers to them, such as a range-for's `auto &e`.
- "Show range…" shows only on a `truncated` sequence with a variable referring to it. A sparse array holds every cell, so it gets `… +N` and no re-run.

**Why:** The core keeps only objects the stack reaches and drops internals unless the run asked for them (`tracecore/step.go`), so with today's tracers nothing is ever unreachable. Calling an internal's iterator "unreachable" would be wrong. Pairs and by-value structs have no identity a student can alias, so a card for each only adds `●──▶` noise; Python objects can be aliased, so they keep theirs. `options.captureRanges` is keyed by variable name (both tracers), so a range has to name one.

**How to apply:** Keep every rule in `layoutState`, where the readability test checks that every `●──▶ #id` has a card. A new view that folds objects (FE-08's matrix rows) adds its rule there, not in a card. If the spec means "unreachable" as objects that went away in an earlier step (kept as ghosts), that is engine work and a question for the spec first.
