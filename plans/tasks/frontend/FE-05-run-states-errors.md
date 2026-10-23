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

- [ ] **Loading:** stepper Queued → Building → Tracing (`progress.steps`) → Ready, progress bar, Cancel
- [ ] **Server busy** (`503` / `capacity`): "Visualizer is busy, try again in a few seconds" + Retry (respects `Retry-After`)
- [ ] **Rate limited** (`429`): message with the wait time
- [ ] **Unsupported module** (`failure.kind = unsupported_module`): "numpy isn't supported in the visualizer. Use Run instead."
- [ ] **Timeout** (`exit.kind = timeout`): steps kept, banner "Stopped after 15 s"
- [ ] **Output limit**: output cut with `… (output truncated)`; trace continues
- [ ] **Basic runtime error** (`exit.kind = exception | signal`): `!` step, status-bar message, **Jump to error step**; signals mapped (`SIGSEGV`, `SIGFPE`, `SIGABRT` → readable text)
- [ ] **Internal error / sandbox error**: "Something went wrong on our side", trace/request ID, Report link
- [ ] **Expired / not found** (`410` / `404`)
- [ ] One story per state, driven by an MSW scenario
- [ ] **Done:** every §5.6 state has a story

## 2. Compile errors & warnings panel (M2-F04 · 2 d)

- [ ] Render `build.diagnostics[]`: `file:line:col severity message`, source excerpt with caret
- [ ] **Go to line N** focuses that line in the IDE editor and closes the visualizer
- [ ] Warnings (`-Wall -Wextra -Wshadow`) shown in a collapsible panel even when the build succeeds, linked to lines
- [ ] Raw compiler output behind a toggle (`build.raw`)
- [ ] **Done:** matches the §5.6 build-error mock with the §8.3 failed-build example

## 3. Friendly-error UI (M3-F04 · 1.5 d)

🔁 Agree the payload shape with BE + DS before M3 (BE-10 §1).

- [ ] Banner: title from `error.kind`, line, step
- [ ] Message + hint templates for every §19.6 row, values filled from the payload
- [ ] **Jump to step N**, **Show values at step N−1**, **Raw message ▾**
- [ ] Fallback to the raw message for unknown kinds
- [ ] Python and C++ fixtures for each kind
- [ ] **Done:** matches the §19.6 mocks

## 4. Step limit, untraced tail & re-run dialogs (M3-F05 · 1.5 d)

- [ ] Step-limit banner: "Trace stopped at step 1,000 (step limit). The program was still running: line 10 in main(), i = 498."
- [ ] With `summary.untracedTail`: "Traced the first 1,000 steps; the program then finished normally (not traced)", exit status, and the full output from `tail.txt.gz` appended in the output pane, marked as untraced
- [ ] **Start tracing from line…** dialog: line input, current breakpoints, max steps (server max 5,000) → re-run with `options.startAtLines`
- [ ] **Raise limit to 5,000** → re-run with `maxSteps`
- [ ] **Show range…** on truncated big arrays → re-run with `options.captureRanges` (FR-11, BE-11 §4)
- [ ] **Why?** explains the step limit
- [ ] **Done:** matches the §5.6 mocks

## Done when

Every §5.6 and §19.6 state has a story.
