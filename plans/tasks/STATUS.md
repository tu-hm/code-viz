# Task status

**Updated Sun 25 Oct 2026.** One row per task. The checklist in each task file is the source of truth; when you tick items there, update the row here. The recount command is at the bottom.

✅ done · 🟡 in progress · 🟢 ready to start · ⏳ waiting on another task

## Now

- **In progress:** BE-01 (41/46). CI runs `make check` on every push and PR to `main`, and the first run is green. Every item left waits on another task or on a decision; see [BE-01 open items](#be-01-open-items).
- **In progress:** FE-02 (41/43). `@viz/player` loads a trace in a Web Worker and steps it inside the §5.2 shell with settings, autoplay and FE-06's state pane; `?fixture=<name>` under `pnpm dev` shows it. Stepping `synthetic-5000` with 500 heap cards takes 4.0 ms p50 and 11.6 ms at worst from keydown to DOM, inside the §13 budget. Closing the player drops `?step=`, so the next trace opens at its first step. Virtualizing containers isn't needed: FE-08 draws big arrays as a 16-cell window. Left: the Share slot (FE-12) and profile storage (auth).
- **Done:** FE-10 (20/20). Go to… jumps from the controls row or a key: step over and out (`Shift + →`, `Shift + ↑`, Shift-click Next), next time a line or a breakpoint runs (`L`), next change of a variable, a cell or a whole array (`C`), next call (`F`), print (`P`), error (`E`) and first wrong output (`D`). The worker searches forward and backward for changes; FE-11 can use the backward path for "Prev change". The compare puts a pasted EXPECTED column next to the output, ignores trailing spaces and line endings unless Exact is on, and jumps to the step that printed the first wrong character, untraced tail included.
- **Done:** FE-09 (18/18). The worker builds one deterministic narration per step from parsed source and trace changes in short batches while controls remain responsive. Story holds the last 20 lines, the timeline hover shows any step's line, and input markers jump to reads. The INPUT panel shows exact Python or inferred C++ progress; binary search reaches 10 of 10 tokens.
- **Done except stories:** FE-03 (14/15). The code pane is CodeMirror 6: `▶ ▷ !` with their bands, breakpoints from a line number or Enter that stop autoplay, and whole-run `×n` hit counts, tinted, with their share on hover or focus; Python and C++ highlighting loads on demand. It matches the §19.3 mock in Chrome, light and dark. Left: a story per fixture, with Storybook (FE-01 §4).
- **Done:** FE-04 (18/18). The IDE has an editable CodeMirror editor with a language picker fed by `GET /languages`, and **Visualize** (or `Ctrl/Cmd + Shift + Enter`) for each language that can visualize. A click POSTs the code, stdin and settings with one `Idempotency-Key`, opens the visualizer at once, long-polls with `since` until the status is final and hands the trace to the player; Cancel or Close deletes a run that isn't final. Network errors, `502`–`504` and `Retry-After` are retried, so a poll survives `vizd` restarting: checked against `make dev` by killing it mid-poll. Python and C++ both visualize from the real API in Chrome. API errors reach FE-05 as `ApiError` with the §8.7 `code`.
- **Done except stories and sign-offs:** FE-05 (23/29). Every run state has its own screen or banner: a Queued → Building → Tracing → Ready stepper with a progress bar; busy and rate-limited with a `Retry-After` countdown; expired and not found; build errors as `file:line:col` with a source excerpt, a caret and Go to line, which puts the IDE editor's caret there; warnings in the player's banner. A runtime error gets a §19.6 friendly banner filled from BE-10's payload, with Jump to step, Show values at step N−1 and the raw message; signals read as text. The step limit says where the program was, shows the untraced tail on the last step, and offers Raise limit, Start tracing from line… and Why?. Show range… re-runs with `captureRanges`. Each state has a `?scenario=` and a test; checked against `make dev` in Chrome (25 Oct). Left: stories (FE-01 §4), the Report link (the spec doesn't say where a report goes), and design sign-off on the §5.6 and §19.6 mocks.
- **Done except sign-offs and C:** FE-06 (29/34). The state pane draws one table per frame, outermost first, with the active one outlined; references as `●──▶ #id`; changed values bold with `*`. Heap cards come from a kind registry (sequence, set, mapping, record, function, opaque), titled `#id type · len N ◀ a, b` so aliasing shows, with `hidden: N internals [Show]` per frame. Values are formatted by language and declared type, a vector of structs or pairs reads as a table that toggles to cells, and a frame title jumps the code pane to its line. Built to the §5.3 and §5.4 mocks (`python-aliasing` step 9, `cpp-pointers` steps 6–7). Left: design sign-off, and the C check (§5), which waits on BE-14.
- **Done except 16 ms at 4× throttle:** FE-07 (20/21). One SVG over the state pane draws a cubic Bézier from each `●` in a frame or a card to the left edge of its card, arrows to the same card bundled into one stem and head. Hovering or focusing a card or a `●` highlights the card, every `●` that points to it and their arrows; above 30 arrows on screen it shows labels only and draws a card's arrows on hover; the setting off or a screen under 768 px also means labels only, and clicking or tapping a `●` scrolls to its card. C++ pointers follow to heap or global cards, `nullptr` is `∅`, the address shows on hover, focus or tap and inline with *Show memory addresses*, and a pointer to nothing the trace holds is its address, not an arrow. Spike S3 ([report](../spikes/s3-arrow-overlay.md)): on `synthetic-5000` with up to 30 arrows the overlay adds 0.4–0.6 ms p50 (4.6 ms a step, 8.1 ms p95); at 4× throttle a step is 16.6–17.2 ms p50 with arrows and 15.2 ms without, so the pane needs to get faster before that target holds.
- **In progress:** FE-01 (28/37). The web workspace, design system, codegen, fixtures and mock API are in `web/`, and `pnpm dev` works against `make dev` too. Storybook (§4) is planned for week 6. The frontend is trimmed to the IDE: no i18n, no Playwright end-to-end tests (spec v1.3).
- **Done:** BE-08 (33/33). The GDB tracer gives calls and returns with values, locals in declaration order, pointers followed to records or into C arrays, signals as error steps, stdin, and the step limit with an untraced tail; a one-line loop gives one step per iteration. 18 golden fixtures under `backend/fixtures/cpp/`. Deep recursion with ordinary frames ends as `memory_limit`, and C arrays and containers record 100 items until sparse arrays (BE-09). The API offers C++ (`enabled: true`, 24 Oct).
- **Done except one decision:** BE-09 (23/24). The C++ type map is `adapters/cpp/typemap.json`: every §10.3 row, with type names the same with safety checks on or off, one `type-*` fixture per row. Arrays of scalars longer than 64 are sparse sequences: the tracer reads each once per step, diffs it (S6: 0.1 ms at 200,005 ints) and sends a patch of the changed cells; the core (BE-04 §3) keeps the cells, checks every patch and builds keyframes and delta patches itself. A 1,000-step DFS over two `int[200005]` stores 32 KB gzipped. Python ports `aliasing`, `binary-search`, `exception`, `input` and `thread-main` and `TestPortsAgreeAcrossLanguages` check that the two languages agree. Left: the conformance test runs in CI but blocks merges only once checks are required on `main` (your decision below).
- **Done except the sign-off:** BE-10 (13/14). An error step carries `kind`, the §19.6 row it matches, and `values`, what it involves (trace format 1.2). The C++ tracer stops on UBSan's handlers and libstdc++'s checks, so a failed check is one step on the user's line with the index and size, the operands and the type's max, or the empty container's call and name; a stack-overflow `SIGSEGV` is `recursion_too_deep`. The Python tracer reads the failing subscript or division from the source, without running the program's code. One fixture per §19.6 row in each language. Left: FE + DS sign off on the payload (spec §19.6 has it).
- **Done:** BE-11 (22/22). Every trace has whole-run `lineHits`: C++ reads gcov's files itself and counts each line by its busiest block, so the §19.3 mock's binary search gets the mock's numbers; a crash falls back to the recorded steps (`lineHitsSource: "trace"`). The output after the step limit is stored as `tail.txt.gz` and listed as `trace.tail` in `GET /visualizations/{id}`. `startAtLines` and `captureRanges` work in both languages, and a re-run with ranges gives the same steps; FE-05's dialogs drive both from the IDE. **§5, exact read hints (25 Oct):** both tracers record the sequence cells each step reads, and the core makes them `access` (spec v1.17). C++ builds with `-fsanitize=kernel-address`, every check made a call into `/opt/viz/reads.o`, which costs 12–18% of run time with the safety checks on. Python uses a `sys.monitoring` callback on `main.py`'s subscripts, at no measurable cost. `t[p ^ 1]`, `a[l++]`, `dp[c - w[i]]`, pointers and struct fields are exact; a constant index into a named C array isn't seen, and the player infers those.
- **In progress:** BE-02 (48/54). G1 is decided: nsjail (spec v1.5, [S1b report](../spikes/s1b-sandbox.md)). The nsjail adapter passes `sandboxtest`, and `make check` runs the suite against both adapters. What's left waits on other tasks; see the task file.
- **Done except signing:** BE-03 (34/35). The Python tracer, its runner image and manifest, `vizctl trace`/`validate`, and eight golden fixtures traced from real code. Signing the image waits on a registry (BE-13). Spike S2 recommends `sys.monitoring` for G2 ([S2 report](../spikes/s2-python-hook.md)); the tracer uses `settrace` until G2 decides.
- **In progress:** BE-04 (26/31). `tracecore` (§2) was built early, inside BE-03, so `vizctl` prints real traces. The S4 spike is done and the goldens run on both architectures in CI. Open: presenting the format at G3, and sparse arrays (§3).
- **Done except one decision:** BE-05 (29/30). `vizd --role=worker` (and `all`) runs trace jobs end to end: claim, build, trace, upload the chunks, complete, with requeue on infra errors, a lease watcher, the 25 s drain and a periodic sandbox sweep. Checked against the local Compose stack. Cancel of a running job waits on your decision below.
- **Done:** BE-12 (10/10). `POST /visualizations/{id}/share` gives a completed visualization a share link: a new `viz_` ID of the same trace that anyone can read, kept with the trace for 90 days from the share and copied to `t90/`. Calling it again returns the same link; `DELETE …/share` revokes it, so it answers `404` for everyone while the owner's own ID still reads, and sharing again makes a new link. Anything not completed gets `400`. `GET` on a link is cacheable for 60 s. Checked against `make dev`'s stack.
- **In progress:** BE-06 (49/52). `vizd` serves the visualization API: create with single-flight, quota, idempotency and the 2-active rule; get with long-poll; owner-only delete; the nightly cleanup of expired rows and chunks; server-side copy for BE-12. Open: spike S5 and the browser checks.
- **Done except signing:** BE-07 (20/21). The C++ runner image is GCC 13.5 and GDB 14.2, with one precompiled header per safety-check mode; builds take 0.3–0.8 s. `options.safetyChecks: false` switches the checks off. GCC diagnostics point at the user's line, and the §8.3 example is reproduced. Spike S7 is in: `_GLIBCXX_DEBUG` fails the 3× run-time target, so G5 has a decision (below).
- **In progress:** BE-13 (11/68). `make dev` builds the runner images, runs MySQL with the §7.13 settings, and `make seed` loads all 66 golden traces (Python and C++) as completed visualizations. vizd has Prometheus metrics (`VIZ_METRICS=true`) and OpenTelemetry tracing (`OTEL_EXPORTER_OTLP_ENDPOINT`), both off by default; a create request and its job share one trace through `jobs.traceparent`, seen end to end in the dev Jaeger. The beta deploys as Docker Compose on one server (spec v1.16).
- **Done except two items:** FE-08 (35/37). The worker parses the source with web-tree-sitter (C++ and Python grammars, loaded only when a trace opens) into per-line facts, without holding up a step. A 2-D sequence draws as a matrix with `[x]` writes, `(x)` inferred reads and the §19.4.3 narration; 1-D arrays get index markers, pins, `l..r` ranges and out-of-range markers, strings too; arrays over 64 cells get a 16-cell window, a minimap, Go to index… and Non-zero only. Matches the §19.3 and §19.4.3 mocks in Chrome; stepping the new 200,005-cell `cpp-sparse-dfs` fixture takes 2.5 ms p50. S8 ([report](../spikes/s8-tree-sitter.md)): 99.9% of traced steps correct, but 77.6% of subscript lines in contest-style code, so it recommends triggering BE-11 §5. Left: a corpus of real CP solutions, a check on a matrix over 30 × 30, and design sign-off (M1-21).
- **Next, by the suggested order:** BE-13 §3–§6. On FE: FE-11 (watch panel and timeline), with FE-09 and FE-10 complete.
- **Ahead of plan:** M0 starts Mon 26 Oct. Both BE → FE contracts are delivered early.

## Decisions waiting on you

- [ ] G2 (Fri 13 Nov): keep `sys.settrace` (D12) or switch to `sys.monitoring`? S2 recommends `sys.monitoring`: tied on a 1,000-step trace, 1.5–3.4× faster after the step limit ([S2 report](../spikes/s2-python-hook.md)).
- [ ] Mark the CI checks as required on `main` (BE-01 §2, BE-09 §4)? This blocks direct pushes to `main`, so every change would go through a PR.
- [ ] API: auth scheme (`securitySchemes`) for signed-in callers.
- [ ] API: should a failed response carry the trace ID (§5.6)?
- [ ] Queue: cancel a running job? §7.7 and the §7.13.2 SQL cancel queued jobs only, which is what `JobQueue.Cancel` does; §7.13.2's prose and BE-05 §2–3 also stop a running one at its next lease check. Allowing it is one more status in `Cancel`'s `WHERE`, and the worker then sees `ErrLeaseLost`.
- [ ] G5 (Fri 19 Feb): keep `_GLIBCXX_DEBUG` (D21) or switch to `-D_GLIBCXX_ASSERTIONS` plus a narrower UBSan? S7: with `_GLIBCXX_DEBUG`, 3 of 10 CP solutions never finished in 60 s and 6 of 9 measured ran over 3×. The lighter flags stay within 3× but drop iterator checks ([S7 report](../spikes/s7-safety-checks.md)).
- [ ] C++ build memory: the build shares the program's 256 MB box. Should it get its own limit (512 MB, the §11 ceiling), and should a build that runs out of memory say so instead of "Build timed out"? With the S7 flags the worst build has about 40 MB to spare.
- [ ] Lead items (option A vs B before 16 Nov, MySQL hosting): see [README.md](README.md#lead--design-tasks-not-in-the-befe-lists).

## Backend

| Task | Milestone | Status | Done | Next step, or what it waits on |
|---|---|---|---|---|
| [BE-01](backend/BE-01-foundation-contracts.md) Foundation & contracts | M0–M1 | 🟡 | 41/46 | CI runs `make check`. Open items: see [BE-01 open items](#be-01-open-items) |
| [BE-02](backend/BE-02-sandbox.md) Sandbox ⚠ | M0–M1, M3 | 🟡 | 48/54 | G1: nsjail. Docker and nsjail adapters pass `sandboxtest`. Open: Compose socket (BE-13 §1), per-image seccomp allowlist (before GA), first CI run with `test-nsjail`, fake fd-3 (BE-03/04), `ptrace` and runner image checks (BE-07) |
| [BE-03](backend/BE-03-python-tracer.md) Python tracer | M0–M1 | 🟡 | 34/35 | Done except cosign signing (needs a registry, BE-13). S2 report in; G2 (Fri 13 Nov) open |
| [BE-04](backend/BE-04-trace-processing.md) Trace processing | M0–M2 | 🟡 | 30/31 | §1–§3 done: sparse sequences and patches came with BE-09. Open: present the format at G3 (Fri 13 Nov) |
| [BE-05](backend/BE-05-job-queue-worker.md) Job queue & worker | M1 | 🟡 | 29/30 | Queue and worker done: `vizd --role=worker` claims, builds, traces, uploads and completes, and drains on SIGTERM. Open: cancel while running (your decision, above) |
| [BE-06](backend/BE-06-visualization-api.md) Visualization API | M0–M1 | 🟡 | 49/52 | The API runs under `vizd --role=api` and `all`, tested against MySQL and SeaweedFS. Open: §1 spike S5 (stretch), the browser checks locally and on staging |
| [BE-07](backend/BE-07-cpp-build.md) C++ build | M2 | 🟡 | 20/21 | Done except cosign signing (needs a registry, BE-13). S7 report in; G5 (Fri 19 Feb) open |
| [BE-08](backend/BE-08-cpp-tracer.md) C++ tracer ⚠ | M0, M2 | ✅ | 33/33 | Done: `adapters/cpp/trace.py` and 18 fixtures. The API offers C++ |
| [BE-09](backend/BE-09-cpp-stl-big-arrays.md) C++ STL & big arrays | M2 | 🟡 | 23/24 | Done except "blocks merges": the conformance test runs in CI; required checks on `main` are your decision |
| [BE-10](backend/BE-10-friendly-errors.md) Friendly errors | M3 | 🟡 | 13/14 | Done except the FE + DS sign-off on the payload (spec §19.6, trace format 1.2). FE-05 renders it; open for the agreement: C++ sends no expression text, so messages read `a[5]`, not `a[i]` |
| [BE-11](backend/BE-11-whole-run-trace-options.md) Whole-run data & options | M3 (M5) | ✅ | 22/22 | Done: line hits, the tail, start lines and capture ranges, and §5's exact read hints from both tracers (spec v1.17) |
| [BE-12](backend/BE-12-share-permalinks.md) Share & permalinks | M3 | ✅ | 10/10 | Done: a share link is its own `viz_` ID, revocable, 90 days in `t90/` (spec v1.14) |
| [BE-13](backend/BE-13-environments-launch.md) Environments & launch (single machine) | M1–M5 | 🟡 | 11/68 | §1–§2 done except one `make dev` run after `make reset`. Next: §3–§6 as Docker Compose on one server (spec v1.16) |
| [BE-14](backend/BE-14-c-language.md) C language | M4 | 🟢 | 0/10 | Can start: BE-07–09 are in |
| **Total** | | | **363/450** | |

### BE-01 open items

| Item | Waits on |
|---|---|
| §2 required checks on `main` | Your decision (above) |
| §2 Done: a PR shows every check | The first PR |
| §6 sandbox tests on Linux runners | The first CI run with `make test-nsjail` (wired into `make check`) |
| §6 multi-arch runner images | BE-03, BE-08 (`vizd` already builds for both) |
| §6 Done: clone to completed local job | One `make dev` run after `make reset` (BE-13 §1) |

## Frontend

| Task | Milestone | Status | Done | Next step, or what it waits on |
|---|---|---|---|---|
| [FE-01](frontend/FE-01-foundation-fixtures.md) Foundation & fixtures | M0–M1 | 🟡 | 28/37 | §4 Storybook (week 6); §5 seeded traces (`make seed` loads none yet, BE-13 §1) |
| [FE-02](frontend/FE-02-trace-player-controls.md) Trace player & controls | M0–M1, M3 | 🟡 | 41/43 | Shell, state pane, banners and the perf budget with 500 heap cards are in; no virtualizing needed after FE-08. Open: the Share slot (FE-12), profile storage (auth) |
| [FE-03](frontend/FE-03-code-pane.md) Code pane | M0, M3 | 🟡 | 14/15 | Code pane, breakpoints and hit counts are in. Open: a story per fixture (FE-01 §4) |
| [FE-04](frontend/FE-04-visualize-from-ide.md) Visualize from the IDE | M1 | ✅ | 18/18 | Done: editor, Visualize, create, long-poll and cancel, against the real API |
| [FE-05](frontend/FE-05-run-states-errors.md) Run states & errors | M1–M3 | 🟡 | 23/29 | Every state, build diagnostics, friendly errors and the re-run dialogs are in. Open: stories (FE-01 §4), the Report link's target, design sign-off |
| [FE-06](frontend/FE-06-stack-heap-view.md) Stack & heap view | M0–M2, M4 | 🟡 | 29/34 | Frames, heap cards, formatters and struct tables are in. Open: design sign-off on §5.3/§5.4, the C check (BE-14) |
| [FE-07](frontend/FE-07-reference-pointer-arrows.md) Reference & pointer arrows | M0–M2 | 🟡 | 20/21 | Arrows, hover highlight, the >30 fallback and C++ pointers are in; S3 done. Open: 16 ms at 4× CPU throttle, which the state pane misses without arrows too |
| [FE-08](frontend/FE-08-array-matrix-views.md) Array & matrix views | M1–M2 | 🟡 | 35/37 | Matrix, markers, reads (exact from BE-11 §5, inferred otherwise), big-array window and S8 are in. Open: real CP solutions for S8, a matrix over 30 × 30 |
| [FE-09](frontend/FE-09-narration-input-cursor.md) Narration & input cursor | M1, M3 | ✅ | 18/18 | Narration, Story, input cursor and read markers |
| [FE-10](frontend/FE-10-goto-expected-output.md) Go to… & expected output | M1 | ✅ | 20/20 | Forward and backward search, Go to… and expected-output compare |
| [FE-11](frontend/FE-11-watch-timeline.md) Watch panel & timeline | M3, M5 | 🟢 | 0/12 | Ready: parsed facts and previous-change search are in |
| [FE-12](frontend/FE-12-share-permalinks.md) Share & permalinks | M3 | ⏳ | 0/8 | FE-02 §3 (BE-12's share and revoke are in) |
| [FE-13](frontend/FE-13-mobile-a11y-analytics.md) Mobile, a11y & analytics | M3 | ⏳ | 0/23 | FE-02 §4, FE-07 (FE-06 is in) |
| [FE-14](frontend/FE-14-cp-data-views.md) CP data views | M5 | ⏳ | 0/32 | FE-08 (FE-06 and FE-10 are in) |
| **Total** | | | **246/347** | |

## Decision gates

| Gate | Date | Decides | Input | Status |
|---|---|---|---|---|
| G1 | Fri 6 Nov | gVisor or nsjail | BE-02 §1 | ✅ 23 Oct: nsjail (spec v1.5) |
| G2 | Fri 13 Nov | `settrace` or `sys.monitoring` | BE-03 §1 | Open; S2 recommends `sys.monitoring` |
| G3 | Fri 13 Nov | Freeze trace format | BE-04 §1, fixtures | Open |
| G4 | Fri 25 Dec | Python beta go/no-go, team size | M1 | Open |
| G5 | Fri 19 Feb | Safety checks, tree-sitter, big arrays | BE-07 §3, BE-09 §3, FE-08 §1 | Open on the safety checks; S7 recommends `_GLIBCXX_ASSERTIONS` over `_GLIBCXX_DEBUG`. ✅ 25 Oct: BE-11 §5 triggered by S8 and done (spec v1.17) |

## Handoffs (BE → FE)

| Delivers | Due | Status |
|---|---|---|
| Trace schema | Wed 28 Oct | ✅ 23 Oct (`fb41bd7`) |
| Real C++ traces (S1) | Fri 6 Nov | ✅ 24 Oct: `backend/fixtures/cpp/*/expected.trace.json`, from `vizctl trace` |
| Format frozen | Fri 13 Nov | G3 |
| OpenAPI | Tue 17 Nov | ✅ 23 Oct (`3ebd66b`) |
| Local stack | Wed 18 Nov | 🟡 24 Oct: `make dev` runs MySQL, SeaweedFS, migrations, the bucket, 66 seeded traces and the Docker sandbox; one run from a clean checkout is left |
| Real Python traces | Fri 4 Dec | ✅ 24 Oct: `backend/fixtures/python/*/expected.trace.json`, from `vizctl trace` |
| Staging | Mon 28 Dec | Not started (BE-13 §3) |
| C++ pointer values | M2 week 3 | ✅ 24 Oct: `ptr` with `target` and `index` in the `backend/fixtures/cpp/` goldens (`pointer`, `array-pointer`, `methods`, `segfault`, `stl`) |
| Sparse arrays | End of M2 | ✅ 24 Oct: `sparse` and `patch` in the C++ goldens (`sparse-dfs`, `sparse-default`, `sparse-window`, `pointer`, `read-loop`) and `backend/internal/tracecore/testdata/golden/cpp-sparse.trace.json` |
| Friendly errors, line hits, untraced tail | M3 week 2 | 🟡 Friendly errors: `kind` and `values` on the error steps of the `check-*` and `error-*` goldens, rendered by FE-05, awaiting FE + DS sign-off (BE-10). ✅ 24 Oct: `lineHits` and `lineHitsSource` in every golden, the tail as `trace.tail` in the API (OpenAPI `Tail`), `startAtLines` and `captureRanges` (BE-11) |

## Recount

Prints `done/total` for every task file; copy the numbers into the tables above.

```bash
cd plans/tasks
for f in backend/*.md frontend/*.md; do
  echo "$(basename "$f" .md | cut -d- -f1-2) $(grep -c '\- \[x\]' "$f")/$(grep -cE '\- \[[ x]\]' "$f")"
done
```
