# The status bar explains the error that ended the program

Decided 2026-10-25.

**Decision:** The runtime-error banner (`ending.ts` and `status-bar.tsx` in `@viz/player`) describes the error the program died of. Walking back from the last step over `exception`, `return` and `exit` steps, the earliest step with an `error` is where it was raised. A trace whose last steps aren't that unwinding gets no banner, even when it has error steps. The banner reads the steps, not `exit.kind`.

**Why:** `exit.kind` can't tell. A UBSan check exits `normal` with code 1 (`cpp-check-overflow`), and a caught `RecursionError` leaves an error step in a run that exits `normal`. A Python exception can repeat on each frame it unwinds through (`python-exception`, steps 6 and 8), and §5.6's "raised at step 8, program ended at step 11" needs the first of those.

**How to apply:** Don't switch the banner to the first error step. That's what Go to… "Error step" and autoplay use, because they look for every error, caught ones included; a caught error stays a `!` line in the code pane. The §19.6 text needs `kind`; with none, or a kind this build doesn't know, the banner shows `type: message`.
