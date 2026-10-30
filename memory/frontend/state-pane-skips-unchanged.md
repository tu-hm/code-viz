# The state pane re-renders only what changed

Decided 2026-10-25.

**Decision:** Three parts work together. `useSession` keeps the previous step's frame and heap objects when the new step's copy is deeply equal (`reuse` in `session.ts`). `HeapCard` and `FrameTable` are `memo` with comparators that check exactly what they draw: their own object, objects drawn inside them (nested structs, table rows) and the status of objects they only name (`Reads`, `sameReads` in `state-layout.ts`). Cards have `content-visibility: auto`.

**Why:** A step arrives from the worker as a structured clone, so every object is new and every card re-rendered. Keydown to DOM on `synthetic-5000` (500 objects), Chrome, production build: 16.5 ms p50 before, 8.1 ms with the memo, 4.0 ms p50 / 7.0 ms p95 with `content-visibility`; `synthetic-1000` 1.9 ms p50. The React Compiler can't skip these: the card list is rebuilt each step.

**How to apply:** A card or frame that starts reading something new through `look` must add it to its `Reads` (`readsOf`) or to its comparator, or it shows the previous step. The "stepping in place draws what a fresh render draws" tests in `state-pane.test.tsx` fail when that happens. Measure on a production build: React's dev build diffs every changed prop for the Performance panel, which made the same steps take 1 s before the memo.
