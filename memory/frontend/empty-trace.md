# A trace with no steps never reaches the player

Decided 2026-10-25.

**Decision:** When `summary.stepCount` is 0 (a start line that never ran, a crash before `main`), `Completed` in `apps/ide/src/visualizer.tsx` shows `NoStepsScreen` instead of the `Player`, and fetches the output itself with `loadTrace` on the main thread.

**Why:** The player opens at step 0: `useSession` asks the worker for it at once, and the engine has no step 0 to rebuild. A trace without steps keeps all its output in the tail (§19.9.5), so the screen needs nothing else. The fixtures avoid such a trace for the same reason: every player test walks each fixture from step 1.

**How to apply:** Keep the guard until the player draws an empty trace itself, then delete this entry. A zero-step trace goes in the `nothing-traced` mock scenario, not in `@viz/fixtures`.
