# Watch history and timeline lanes

Decided 2026-10-25.

**Decision:** the WATCH history, the lanes' `┼` and Prev / Next change all come from one list per target, `changeHistory` in the worker: a forward walk of the whole trace with Go to…'s rules ([goto-search](goto-search.md)). Prev / Next read that list, not `findStep`'s `previousChange`. Auto-watch skips variables whose value is a `ref`. Pins live in the store per trace ID, not in `localStorage`.

**Why:** `previousChange` compares each step with the one before it, so a variable coming back into scope unchanged counts as a change there, while the forward rules don't count it; using it would put Prev on steps with no `┼`. A whole-trace walk costs up to 15 ms on `synthetic-5000`, so it yields every 256 steps and the session caches one promise per target. An array's ref shows `#id`, which says nothing on the current line; its card already shows the array.

**How to apply:** a change to what counts as a change goes into `search.ts` once, for Go to…, the lanes and the history together. Keep the walk interruptible like narration ([narration-yields](narration-yields.md)). If pins must survive a reload, that is a new product rule: ask first.
