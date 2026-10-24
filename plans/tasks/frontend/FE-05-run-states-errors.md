# FE-05 · Run states & error screens

| | |
|---|---|
| **Milestone** | M1 (week 6) → M2 (build errors) → M3 (friendly errors, step limit) |
| **Estimate** | 7 days |
| **Depends on** | FE-04, M0-20 designs (DS); BE-07 §2 (diagnostics); BE-10 (friendly-error payload); BE-11 §2–4 (untraced tail, `startAtLines`, `captureRanges`) |
| **Blocks** | FE-13 (launch) |
| **Covers** | M1-15, M2-F04, M3-F04, M3-F05 |
| **Spec** | §5.6, §19.6, §19.8 (D25), FR-11, FR-15, FR-22 |

Every state other than "ready".

## 1. States (M1-15 · 2 d · M1 week 6)

- [x] **Loading:** stepper Queued → Building → Tracing (`progress.steps`) → Ready, progress bar, Cancel — `LoadingScreen` in `run-screens.tsx`; the bar fills with `progress.steps` against the run's `maxSteps`
- [x] **Server busy** (`503` / `capacity`): "Visualizer is busy, try again in a few seconds" + Retry (respects `Retry-After`) — Retry counts down `Retry-After`, then POSTs again with the same `Idempotency-Key`; a long-poll that keeps failing gets the same screen, and Retry resumes it
- [x] **Rate limited** (`429`): message with the wait time — the API's message, "You can visualize again in 8 h 51 min" counting down, and Retry once it has
- [x] **Unsupported module** (`failure.kind = unsupported_module`): "numpy isn't supported in the visualizer. Use Run instead." — the diagnostic's own words, and Go to line
- [x] **Timeout** (`exit.kind = timeout`): steps kept, banner "Stopped after 15 s" — 15 s is §11's default: the trace doesn't carry the limit it ran under
- [x] **Output limit**: output cut with `… (output truncated)`; trace continues — the mark sits under the last step's output, and a banner says the run stopped there
- [x] **Basic runtime error** (`exit.kind = exception | signal`): `!` step, status-bar message, **Jump to error step**; signals mapped (`SIGSEGV`, `SIGFPE`, `SIGABRT` → readable text) — "… · line 2, in f() · raised at step 6, program ended at step 9"; it explains only the error the program died of, also when UBSan exits `normal` ([memory](../../../memory/frontend/run-error-banner.md))
- [ ] **Internal error / sandbox error**: "Something went wrong on our side", trace/request ID, Report link — all but the Report link: the spec doesn't say where a report goes. A failed `sandbox_error` or `internal_error` shows the visualization ID and Try again, an API `500` the request ID and Retry, a trace that ended `internal_error` a banner with its trace ID
- [x] **Expired / not found** (`410` / `404`) — with Visualize again, which makes a new run
- [ ] One story per state, driven by an MSW scenario — Storybook isn't set up (FE-01 §4). Every state has a `?scenario=` under `pnpm dev` (web README) and a test rendered from that scenario or from a fixture: `ide.test.tsx`, `run-screens.test.tsx`, `status-bar.test.tsx`
- [ ] **Done:** every §5.6 state has a story — waits on Storybook, as above

## 2. Compile errors & warnings panel (M2-F04 · 2 d)

- [x] Render `build.diagnostics[]`: `file:line:col severity message`, source excerpt with caret — the line and the next, with the caret under the column past tabs. A failed build's response doesn't name the file, so there it reads `6:14 error: …`; warnings on a completed trace take `main.cpp` from the trace header
- [x] **Go to line N** focuses that line in the IDE editor and closes the visualizer — caret at the line and column
- [x] Warnings (`-Wall -Wextra -Wshadow`) shown in a collapsible panel even when the build succeeds, linked to lines — in the player's `banner` slot
- [x] Raw compiler output behind a toggle (`build.raw`) — shown as the message when there are no diagnostics, such as "Build timed out"
- [ ] **Done:** matches the §5.6 build-error mock with the §8.3 failed-build example — needs design sign-off; `?scenario=failed-build` renders the §8.3 example

## 3. Friendly-error UI (M3-F04 · 1.5 d)

🔁 Agree the payload shape with BE + DS before M3 (BE-10 §1). Built to BE-10's shape (trace format 1.2) on 25 Oct; the agreement is still open.

- [x] Banner: title from `error.kind`, line, step — "Index out of range · line 8, in main() · step 15", in the status bar
- [x] Message + hint templates for every §19.6 row, values filled from the payload — `friendly.ts`, built to BE-10's payload. Any value can be missing, so each template has a wording without it; C++ sends no expression text, so `a[i]` reads `a[5]`
- [x] **Jump to step N**, **Show values at step N−1**, **Raw message ▾**
- [x] Fallback to the raw message for unknown kinds — and for an error with no `kind`
- [x] Python and C++ fixtures for each kind — C++: `cpp-check-index`, `-overflow`, `-divide`, `-empty` and `cpp-stack-overflow`, from the backend goldens; Python: `python-error-index`, `python-error-divide`, `python-recursion`. Signed overflow and empty container have no Python form (§19.6)
- [ ] **Done:** matches the §19.6 mocks — needs design sign-off, and the payload agreed above

## 4. Step limit, untraced tail & re-run dialogs (M3-F05 · 1.5 d)

- [x] Step-limit banner: "Trace stopped at step 1,000 (step limit). The program was still running: line 10 in main(), i = 498." — the values are the innermost frame's first three scalar locals
- [x] With `summary.untracedTail`: "Traced the first 1,000 steps; the program then finished normally (not traced)", exit status, and the full output from `tail.txt.gz` appended in the output pane, marked as untraced — the tail shows on the last step, under "Printed after step 1,000, not traced"
- [x] **Start tracing from line…** dialog: line input, current breakpoints, max steps (server max 5,000) → re-run with `options.startAtLines` — in the IDE (`rerun-dialogs.tsx`). A trace whose start line never ran gets its own screen, with the output and Trace from the start ([memory](../../../memory/frontend/empty-trace.md))
- [x] **Raise limit to 5,000** → re-run with `maxSteps` — the language's `maxStepsCeiling`; hidden once the trace ran at it
- [x] **Show range…** on truncated big arrays → re-run with `options.captureRanges` (FR-11, BE-11 §4) — the dialog and the re-run, through `Player`'s `onShowRange` from FE-06's button; checked against `make dev` (25 Oct): a 1,500-item list re-run with `1200`–`1210` shows `… +1,200`, the 11 cells, `… +289`
- [x] **Why?** explains the step limit
- [ ] **Done:** matches the §5.6 mocks — needs design sign-off

## Done when

Every §5.6 and §19.6 state has a story.
