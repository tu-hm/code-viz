# Task status

**Updated Sat 24 Oct 2026.** One row per task. The checklist in each task file is the source of truth; when you tick items there, update the row here. The recount command is at the bottom.

✅ done · 🟡 in progress · 🟢 ready to start · ⏳ waiting on another task

## Now

- **In progress:** BE-01 (41/46). CI runs `make check` on every push and PR to `main`, and the first run is green. Every item left waits on another task or on a decision; see [BE-01 open items](#be-01-open-items).
- **In progress:** FE-02 (36/43). `@viz/player` loads a trace in a Web Worker and steps it within the §13 budget (worst step 1.4 ms on 1,000 steps), inside the §5.2 shell with settings and autoplay; `?fixture=<name>` under `pnpm dev` shows it. Real Python traces from `make dev` load; what's left is slots for other tasks.
- **Done except the backward scan:** FE-10 (19/20). Go to… jumps from the controls row or a key: step over and out (`Shift + →`, `Shift + ↑`, Shift-click Next), next time a line or a breakpoint runs (`L`), next change of a variable, a cell or a whole array (`C`), next call (`F`), print (`P`), error (`E`) and first wrong output (`D`). The searches run in the worker (8 ms worst case on 5,000 steps), entries with no match are disabled, and a miss says "not found after step N". The compare puts a pasted EXPECTED column next to the output, ignores trailing spaces and line endings unless Exact is on, and jumps to the step that printed the first wrong character, untraced tail included; `Player`'s `expected` prop fills it from a problem's sample. Left: scanning backward, which FE-11's "Prev change" needs first.
- **Done except stories:** FE-03 (14/15). The code pane is CodeMirror 6: `▶ ▷ !` with their bands, breakpoints from a line number or Enter that stop autoplay, and whole-run `×n` hit counts, tinted, with their share on hover or focus; Python and C++ highlighting loads on demand. It matches the §19.3 mock in Chrome, light and dark. Left: a story per fixture, with Storybook (FE-01 §4).
- **Done:** FE-04 (18/18). The IDE has an editable CodeMirror editor with a language picker fed by `GET /languages`, and **Visualize** (or `Ctrl/Cmd + Shift + Enter`) for each language that can visualize. A click POSTs the code, stdin and settings with one `Idempotency-Key`, opens the visualizer at once, long-polls with `since` until the status is final and hands the trace to the player; Cancel or Close deletes a run that isn't final. Network errors, `502`–`504` and `Retry-After` are retried, so a poll survives `vizd` restarting: checked against `make dev` by killing it mid-poll. Python and C++ both visualize from the real API in Chrome. API errors reach FE-05 as `ApiError` with the §8.7 `code`.
- **In progress:** FE-01 (28/37). The web workspace, design system, codegen, fixtures and mock API are in `web/`, and `pnpm dev` works against `make dev` too. Storybook (§4) is planned for week 6. The frontend is trimmed to the IDE: no i18n, no Playwright end-to-end tests (spec v1.3).
- **Done:** BE-08 (33/33). The GDB tracer gives calls and returns with values, locals in declaration order, pointers followed to records or into C arrays, signals as error steps, stdin, and the step limit with an untraced tail; a one-line loop gives one step per iteration. 18 golden fixtures under `backend/fixtures/cpp/`. Deep recursion with ordinary frames ends as `memory_limit`, and C arrays and containers record 100 items until sparse arrays (BE-09). The API offers C++ (`enabled: true`, 24 Oct).
- **Done except one decision:** BE-09 (23/24). The C++ type map is `adapters/cpp/typemap.json`: every §10.3 row, with type names the same with safety checks on or off, one `type-*` fixture per row. Arrays of scalars longer than 64 are sparse sequences: the tracer reads each once per step, diffs it (S6: 0.1 ms at 200,005 ints) and sends a patch of the changed cells; the core (BE-04 §3) keeps the cells, checks every patch and builds keyframes and delta patches itself. A 1,000-step DFS over two `int[200005]` stores 32 KB gzipped. Python ports `aliasing`, `binary-search`, `exception`, `input` and `thread-main` and `TestPortsAgreeAcrossLanguages` check that the two languages agree. Left: the conformance test runs in CI but blocks merges only once checks are required on `main` (your decision below).
- **Done except the sign-off:** BE-10 (13/14). An error step carries `kind`, the §19.6 row it matches, and `values`, what it involves (trace format 1.2). The C++ tracer stops on UBSan's handlers and libstdc++'s checks, so a failed check is one step on the user's line with the index and size, the operands and the type's max, or the empty container's call and name; a stack-overflow `SIGSEGV` is `recursion_too_deep`. The Python tracer reads the failing subscript or division from the source, without running the program's code. One fixture per §19.6 row in each language. Left: FE + DS sign off on the payload (spec §19.6 has it).
- **Done except FE's half:** BE-11 (19/22). Every trace has whole-run `lineHits`: C++ reads gcov's files itself and counts each line by its busiest block, so the §19.3 mock's binary search gets the mock's numbers; a crash falls back to the recorded steps (`lineHitsSource: "trace"`). The output after the step limit is stored as `tail.txt.gz` and listed as `trace.tail` in `GET /visualizations/{id}`. `startAtLines` and `captureRanges` work in both languages, and a re-run with ranges gives the same steps. Left: the start-at-line dialog (FE-05), and exact access hints (§5) only if S8 misses.
- **In progress:** BE-02 (48/54). G1 is decided: nsjail (spec v1.5, [S1b report](../spikes/s1b-sandbox.md)). The nsjail adapter passes `sandboxtest`, and `make check` runs the suite against both adapters. What's left waits on other tasks; see the task file.
- **Done except signing:** BE-03 (34/35). The Python tracer, its runner image and manifest, `vizctl trace`/`validate`, and eight golden fixtures traced from real code. Signing the image waits on a registry (BE-13). Spike S2 recommends `sys.monitoring` for G2 ([S2 report](../spikes/s2-python-hook.md)); the tracer uses `settrace` until G2 decides.
- **In progress:** BE-04 (26/31). `tracecore` (§2) was built early, inside BE-03, so `vizctl` prints real traces. The S4 spike is done and the goldens run on both architectures in CI. Open: presenting the format at G3, and sparse arrays (§3).
- **Done except one decision:** BE-05 (29/30). `vizd --role=worker` (and `all`) runs trace jobs end to end: claim, build, trace, upload the chunks, complete, with requeue on infra errors, a lease watcher, the 25 s drain and a periodic sandbox sweep. Checked against the local Compose stack. Cancel of a running job waits on your decision below.
- **Done:** BE-12 (10/10). `POST /visualizations/{id}/share` gives a completed visualization a share link: a new `viz_` ID of the same trace that anyone can read, kept with the trace for 90 days from the share and copied to `t90/`. Calling it again returns the same link; `DELETE …/share` revokes it, so it answers `404` for everyone while the owner's own ID still reads, and sharing again makes a new link. Anything not completed gets `400`. `GET` on a link is cacheable for 60 s. Checked against `make dev`'s stack.
- **In progress:** BE-06 (49/52). `vizd` serves the visualization API: create with single-flight, quota, idempotency and the 2-active rule; get with long-poll; owner-only delete; the nightly cleanup of expired rows and chunks; server-side copy for BE-12. Open: spike S5 and the browser checks.
- **Done except signing:** BE-07 (20/21). The C++ runner image is GCC 13.5 and GDB 14.2, with one precompiled header per safety-check mode; builds take 0.3–0.8 s. `options.safetyChecks: false` switches the checks off. GCC diagnostics point at the user's line, and the §8.3 example is reproduced. Spike S7 is in: `_GLIBCXX_DEBUG` fails the 3× run-time target, so G5 has a decision (below).
- **Next, by the suggested order:** BE-13 §2–3. On FE: FE-07 §1 (spike S3) and FE-06 §1 (stack and heap), both built on the fixtures.
- **Ahead of plan:** M0 starts Mon 26 Oct. Both BE → FE contracts are delivered early.

## Decisions waiting on you

- [ ] G2 (Fri 13 Nov): keep `sys.settrace` (D12) or switch to `sys.monitoring`? S2 recommends `sys.monitoring`: tied on a 1,000-step trace, 1.5–3.4× faster after the step limit ([S2 report](../spikes/s2-python-hook.md)).
- [ ] Mark the CI checks as required on `main` (BE-01 §2, BE-09 §4)? This blocks direct pushes to `main`, so every change would go through a PR.
- [ ] API: auth scheme (`securitySchemes`) for signed-in callers.
- [ ] API: should a failed response carry the trace ID (§5.6)?
- [ ] Queue: cancel a running job? §7.7 and the §7.13.2 SQL cancel queued jobs only, which is what `JobQueue.Cancel` does; §7.13.2's prose and BE-05 §2–3 also stop a running one at its next lease check. Allowing it is one more status in `Cancel`'s `WHERE`, and the worker then sees `ErrLeaseLost`.
- [ ] G5 (Fri 19 Feb): keep `_GLIBCXX_DEBUG` (D21) or switch to `-D_GLIBCXX_ASSERTIONS` plus a narrower UBSan? S7: with `_GLIBCXX_DEBUG`, 3 of 10 CP solutions never finished in 60 s and 6 of 9 measured ran over 3×. The lighter flags stay within 3× but drop iterator checks ([S7 report](../spikes/s7-safety-checks.md)).
- [ ] C++ build memory: the build shares the program's 256 MB box. Should it get its own limit (512 MB, the §11 ceiling), and should a build that runs out of memory say so instead of "Build timed out"? With the S7 flags the worst build has about 40 MB to spare.
- [ ] Lead items (option A vs B before 16 Nov, MySQL hosting, deploy path): see [README.md](README.md#lead--design-tasks-not-in-the-befe-lists).

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
| [BE-10](backend/BE-10-friendly-errors.md) Friendly errors | M3 | 🟡 | 13/14 | Done except the FE + DS sign-off on the payload (spec §19.6, trace format 1.2) |
| [BE-11](backend/BE-11-whole-run-trace-options.md) Whole-run data & options | M3 (M5) | 🟡 | 19/22 | Done except the §5.6 dialog (FE-05) and §5, which only happens if spike S8 misses 95% |
| [BE-12](backend/BE-12-share-permalinks.md) Share & permalinks | M3 | ✅ | 10/10 | Done: a share link is its own `viz_` ID, revocable, 90 days in `t90/` (spec v1.14) |
| [BE-13](backend/BE-13-environments-launch.md) Environments & launch (single machine) | M1–M5 | 🟢 | 0/68 | §1 can start. Rewritten for single Linux server, no cloud/K8s |
| [BE-14](backend/BE-14-c-language.md) C language | M4 | 🟢 | 0/10 | Can start: BE-07–09 are in |
| **Total** | | | **349/450** | |

### BE-01 open items

| Item | Waits on |
|---|---|
| §2 required checks on `main` | Your decision (above) |
| §2 Done: a PR shows every check | The first PR |
| §6 sandbox tests on Linux runners | The first CI run with `make test-nsjail` (wired into `make check`) |
| §6 multi-arch runner images | BE-03, BE-08 (`vizd` already builds for both) |
| §6 Done: clone to completed local job | BE-02, BE-06, BE-13 §1 |

## Frontend

| Task | Milestone | Status | Done | Next step, or what it waits on |
|---|---|---|---|---|
| [FE-01](frontend/FE-01-foundation-fixtures.md) Foundation & fixtures | M0–M1 | 🟡 | 28/37 | §4 Storybook (week 6); §5 seeded traces (`make seed` loads none yet, BE-13 §1) |
| [FE-02](frontend/FE-02-trace-player-controls.md) Trace player & controls | M0–M1, M3 | 🟡 | 36/43 | Loader, worker engine, controls, shell, settings, autoplay, the code pane, every §5.9 shortcut and the perf budget are in. Open: slots for FE-05/06/12, profile storage (auth) |
| [FE-03](frontend/FE-03-code-pane.md) Code pane | M0, M3 | 🟡 | 14/15 | Code pane, breakpoints and hit counts are in. Open: a story per fixture (FE-01 §4) |
| [FE-04](frontend/FE-04-visualize-from-ide.md) Visualize from the IDE | M1 | ✅ | 18/18 | Done: editor, Visualize, create, long-poll and cancel, against the real API |
| [FE-05](frontend/FE-05-run-states-errors.md) Run states & errors | M1–M3 | 🟢 | 0/29 | Can start: FE-04's interim screens in `visualizer.tsx` are the place (BE-07 §2 diagnostics, BE-10's error payload, and BE-11's tail and start lines are in) |
| [FE-06](frontend/FE-06-stack-heap-view.md) Stack & heap view | M0–M2, M4 | ⏳ | 0/34 | FE-02 §2 (BE-09 §1 is in) |
| [FE-07](frontend/FE-07-reference-pointer-arrows.md) Reference & pointer arrows | M0–M2 | 🟢 | 0/21 | §1 spike S3 can start on the fixtures; §2 needs FE-06 §2 |
| [FE-08](frontend/FE-08-array-matrix-views.md) Array & matrix views | M1–M2 | ⏳ | 0/37 | FE-06 (FE-03 and BE-09 §2 are in) |
| [FE-09](frontend/FE-09-narration-input-cursor.md) Narration & input cursor | M1, M3 | ⏳ | 0/18 | FE-02 §2, FE-08 §3 |
| [FE-10](frontend/FE-10-goto-expected-output.md) Go to… & expected output | M1 | 🟡 | 19/20 | Every §19.8 jump and the §19.7 compare are in. Open: the backward scan, with FE-11's "Prev change" |
| [FE-11](frontend/FE-11-watch-timeline.md) Watch panel & timeline | M3, M5 | ⏳ | 0/12 | FE-08 §3 (FE-10's change search is in; §2 adds the backward scan) |
| [FE-12](frontend/FE-12-share-permalinks.md) Share & permalinks | M3 | ⏳ | 0/8 | FE-02 §3 (BE-12's share and revoke are in) |
| [FE-13](frontend/FE-13-mobile-a11y-analytics.md) Mobile, a11y & analytics | M3 | ⏳ | 0/23 | FE-02 §4, FE-06, FE-07 |
| [FE-14](frontend/FE-14-cp-data-views.md) CP data views | M5 | ⏳ | 0/32 | FE-06, FE-08 (FE-10 is in) |
| **Total** | | | **115/347** | |

## Decision gates

| Gate | Date | Decides | Input | Status |
|---|---|---|---|---|
| G1 | Fri 6 Nov | gVisor or nsjail | BE-02 §1 | ✅ 23 Oct: nsjail (spec v1.5) |
| G2 | Fri 13 Nov | `settrace` or `sys.monitoring` | BE-03 §1 | Open; S2 recommends `sys.monitoring` |
| G3 | Fri 13 Nov | Freeze trace format | BE-04 §1, fixtures | Open |
| G4 | Fri 25 Dec | Python beta go/no-go, team size | M1 | Open |
| G5 | Fri 19 Feb | Safety checks, tree-sitter, big arrays | BE-07 §3, BE-09 §3, FE-08 §1 | Open; S7 recommends `_GLIBCXX_ASSERTIONS` over `_GLIBCXX_DEBUG` |

## Handoffs (BE → FE)

| Delivers | Due | Status |
|---|---|---|
| Trace schema | Wed 28 Oct | ✅ 23 Oct (`fb41bd7`) |
| Real C++ traces (S1) | Fri 6 Nov | ✅ 24 Oct: `backend/fixtures/cpp/*/expected.trace.json`, from `vizctl trace` |
| Format frozen | Fri 13 Nov | G3 |
| OpenAPI | Tue 17 Nov | ✅ 23 Oct (`3ebd66b`) |
| Local stack | Wed 18 Nov | 🟡 MySQL, SeaweedFS and migrations run; buckets, seed data and sandbox missing |
| Real Python traces | Fri 4 Dec | ✅ 24 Oct: `backend/fixtures/python/*/expected.trace.json`, from `vizctl trace` |
| Staging | Mon 28 Dec | Not started (BE-13 §3) |
| C++ pointer values | M2 week 3 | ✅ 24 Oct: `ptr` with `target` and `index` in the `backend/fixtures/cpp/` goldens (`pointer`, `array-pointer`, `methods`, `segfault`, `stl`) |
| Sparse arrays | End of M2 | ✅ 24 Oct: `sparse` and `patch` in the C++ goldens (`sparse-dfs`, `sparse-default`, `sparse-window`, `pointer`, `read-loop`) and `backend/internal/tracecore/testdata/golden/cpp-sparse.trace.json` |
| Friendly errors, line hits, untraced tail | M3 week 2 | 🟡 Friendly errors: `kind` and `values` on the error steps of the `check-*` and `error-*` goldens, awaiting FE + DS sign-off (BE-10). ✅ 24 Oct: `lineHits` and `lineHitsSource` in every golden, the tail as `trace.tail` in the API (OpenAPI `Tail`), `startAtLines` and `captureRanges` (BE-11) |

## Recount

Prints `done/total` for every task file; copy the numbers into the tables above.

```bash
cd plans/tasks
for f in backend/*.md frontend/*.md; do
  echo "$(basename "$f" .md | cut -d- -f1-2) $(grep -c '\- \[x\]' "$f")/$(grep -cE '\- \[[ x]\]' "$f")"
done
```
