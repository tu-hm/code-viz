# Task status

**Updated Sat 24 Oct 2026.** One row per task. The checklist in each task file is the source of truth; when you tick items there, update the row here. The recount command is at the bottom.

✅ done · 🟡 in progress · 🟢 ready to start · ⏳ waiting on another task

## Now

- **In progress:** BE-01 (41/46). CI runs `make check` on every push and PR to `main`, and the first run is green. Every item left waits on another task or on a decision; see [BE-01 open items](#be-01-open-items).
- **In progress:** FE-01 (26/37). The web workspace, design system, codegen, fixtures and mock API are in `web/`. Storybook (§4) is planned for week 6. The frontend is trimmed to the IDE: no i18n, no Playwright end-to-end tests (spec v1.3).
- **Done:** BE-08 §1 (4/4). The GDB prototype traces the loop, recursion and STL programs, its output validates against the wire schema, and it ran under both sandboxes for S1b.
- **In progress:** BE-02 (48/54). G1 is decided: nsjail (spec v1.5, [S1b report](../spikes/s1b-sandbox.md)). The nsjail adapter passes `sandboxtest`, and `make check` runs the suite against both adapters. What's left waits on other tasks; see the task file.
- **Done except signing:** BE-03 (34/35). The Python tracer, its runner image and manifest, `vizctl trace`/`validate`, and eight golden fixtures traced from real code. Signing the image waits on a registry (BE-13). Spike S2 recommends `sys.monitoring` for G2 ([S2 report](../spikes/s2-python-hook.md)); the tracer uses `settrace` until G2 decides.
- **In progress:** BE-04 (26/31). `tracecore` (§2) was built early, inside BE-03, so `vizctl` prints real traces. The S4 spike is done and the goldens run on both architectures in CI. Open: presenting the format at G3, and sparse arrays (§3).
- **Done except one decision:** BE-05 (29/30). `vizd --role=worker` (and `all`) runs trace jobs end to end: claim, build, trace, upload the chunks, complete, with requeue on infra errors, a lease watcher, the 25 s drain and a periodic sandbox sweep. Checked against the local Compose stack. Cancel of a running job waits on your decision below.
- **In progress:** BE-06 (48/52). `vizd` serves the visualization API: create with single-flight, quota, idempotency and the 2-active rule; get with long-poll; owner-only delete; the nightly cleanup of expired rows and chunks. Open: spike S5, server-side copy (BE-12) and the browser checks.
- **Next, by the suggested order:** BE-13 §2–3. On FE: FE-02 §1 (player skeleton) and FE-03 §1 (code pane), both built on the fixtures.
- **Ahead of plan:** M0 starts Mon 26 Oct. Both BE → FE contracts are delivered early.

## Decisions waiting on you

- [ ] G2 (Fri 13 Nov): keep `sys.settrace` (D12) or switch to `sys.monitoring`? S2 recommends `sys.monitoring`: tied on a 1,000-step trace, 1.5–3.4× faster after the step limit ([S2 report](../spikes/s2-python-hook.md)).
- [ ] Mark the CI checks as required on `main` (BE-01 §2)? This blocks direct pushes to `main`, so every change would go through a PR.
- [ ] API: what does `POST /visualizations/{id}/share` return before the visualization is completed?
- [ ] API: auth scheme (`securitySchemes`) for signed-in callers.
- [ ] API: should a failed response carry the trace ID (§5.6)?
- [ ] Queue: cancel a running job? §7.7 and the §7.13.2 SQL cancel queued jobs only, which is what `JobQueue.Cancel` does; §7.13.2's prose and BE-05 §2–3 also stop a running one at its next lease check. Allowing it is one more status in `Cancel`'s `WHERE`, and the worker then sees `ErrLeaseLost`.
- [ ] Lead items (option A vs B before 16 Nov, MySQL hosting, deploy path): see [README.md](README.md#lead--design-tasks-not-in-the-befe-lists).

## Backend

| Task | Milestone | Status | Done | Next step, or what it waits on |
|---|---|---|---|---|
| [BE-01](backend/BE-01-foundation-contracts.md) Foundation & contracts | M0–M1 | 🟡 | 41/46 | CI runs `make check`. Open items: see [BE-01 open items](#be-01-open-items) |
| [BE-02](backend/BE-02-sandbox.md) Sandbox ⚠ | M0–M1, M3 | 🟡 | 48/54 | G1: nsjail. Docker and nsjail adapters pass `sandboxtest`. Open: Compose socket (BE-13 §1), per-image seccomp allowlist (before GA), first CI run with `test-nsjail`, fake fd-3 (BE-03/04), `ptrace` and runner image checks (BE-07) |
| [BE-03](backend/BE-03-python-tracer.md) Python tracer | M0–M1 | 🟡 | 34/35 | Done except cosign signing (needs a registry, BE-13). S2 report in; G2 (Fri 13 Nov) open |
| [BE-04](backend/BE-04-trace-processing.md) Trace processing | M0–M2 | 🟡 | 26/31 | §1 S4 and §2 done; goldens run on both architectures in CI. Open: present the format at G3 (Fri 13 Nov), §3 after BE-09 |
| [BE-05](backend/BE-05-job-queue-worker.md) Job queue & worker | M1 | 🟡 | 29/30 | Queue and worker done: `vizd --role=worker` claims, builds, traces, uploads and completes, and drains on SIGTERM. Open: cancel while running (your decision, above) |
| [BE-06](backend/BE-06-visualization-api.md) Visualization API | M0–M1 | 🟡 | 48/52 | The API runs under `vizd --role=api` and `all`, tested against MySQL and SeaweedFS. Open: §1 spike S5 (stretch), server-side copy (BE-12), the browser checks locally and on staging |
| [BE-07](backend/BE-07-cpp-build.md) C++ build | M2 | ⏳ | 0/20 | BE-02. The worker's build stage (BE-05) is in |
| [BE-08](backend/BE-08-cpp-tracer.md) C++ tracer ⚠ | M0, M2 | 🟡 | 4/33 | §1 done (prototype in `adapters/cpp/trace.py`, measured in S1b). §2+ need BE-07 |
| [BE-09](backend/BE-09-cpp-stl-big-arrays.md) C++ STL & big arrays | M2 | ⏳ | 0/24 | BE-08 |
| [BE-10](backend/BE-10-friendly-errors.md) Friendly errors | M3 | ⏳ | 0/14 | BE-03, BE-07, BE-08 |
| [BE-11](backend/BE-11-whole-run-trace-options.md) Whole-run data & options | M3 (M5) | ⏳ | 0/22 | BE-03, BE-07–09 |
| [BE-12](backend/BE-12-share-permalinks.md) Share & permalinks | M3 | ⏳ | 0/10 | BE-06 |
| [BE-13](backend/BE-13-environments-launch.md) Environments & launch (single machine) | M1–M5 | 🟢 | 0/68 | §1 can start. Rewritten for single Linux server, no cloud/K8s |
| [BE-14](backend/BE-14-c-language.md) C language | M4 | ⏳ | 0/10 | BE-07–09 |
| **Total** | | | **230/449** | |

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
| [FE-01](frontend/FE-01-foundation-fixtures.md) Foundation & fixtures | M0–M1 | 🟡 | 26/37 | §4 Storybook (week 6); §5 against `make dev` can start: the API is in (BE-06) |
| [FE-02](frontend/FE-02-trace-player-controls.md) Trace player & controls | M0–M1, M3 | 🟢 | 0/43 | §1 can start: fixtures, trace types and the store are in |
| [FE-03](frontend/FE-03-code-pane.md) Code pane | M0, M3 | 🟢 | 0/15 | §1 can start; §2 needs BE-11 §1 |
| [FE-04](frontend/FE-04-visualize-from-ide.md) Visualize from the IDE | M1 | 🟢 | 0/18 | Can start, against the mock API (FE-01 §5) or the real one under `make dev` (BE-06) |
| [FE-05](frontend/FE-05-run-states-errors.md) Run states & errors | M1–M3 | ⏳ | 0/29 | FE-04; BE-07 §2, BE-10, BE-11 |
| [FE-06](frontend/FE-06-stack-heap-view.md) Stack & heap view | M0–M2, M4 | ⏳ | 0/34 | FE-02 §2; BE-09 §1 |
| [FE-07](frontend/FE-07-reference-pointer-arrows.md) Reference & pointer arrows | M0–M2 | 🟢 | 0/21 | §1 spike S3 can start on the fixtures; §2 needs FE-06 §2 |
| [FE-08](frontend/FE-08-array-matrix-views.md) Array & matrix views | M1–M2 | ⏳ | 0/37 | FE-03, FE-06; BE-09 §2 |
| [FE-09](frontend/FE-09-narration-input-cursor.md) Narration & input cursor | M1, M3 | ⏳ | 0/18 | FE-02 §2, FE-08 §3 |
| [FE-10](frontend/FE-10-goto-expected-output.md) Go to… & expected output | M1 | ⏳ | 0/20 | FE-02 §2, FE-03 |
| [FE-11](frontend/FE-11-watch-timeline.md) Watch panel & timeline | M3, M5 | ⏳ | 0/12 | FE-08 §3, FE-10 §1 |
| [FE-12](frontend/FE-12-share-permalinks.md) Share & permalinks | M3 | ⏳ | 0/8 | BE-12, FE-02 §3 |
| [FE-13](frontend/FE-13-mobile-a11y-analytics.md) Mobile, a11y & analytics | M3 | ⏳ | 0/23 | FE-02 §4, FE-06, FE-07 |
| [FE-14](frontend/FE-14-cp-data-views.md) CP data views | M5 | ⏳ | 0/32 | FE-06, FE-08, FE-10 |
| **Total** | | | **26/347** | |

## Decision gates

| Gate | Date | Decides | Input | Status |
|---|---|---|---|---|
| G1 | Fri 6 Nov | gVisor or nsjail | BE-02 §1 | ✅ 23 Oct: nsjail (spec v1.5) |
| G2 | Fri 13 Nov | `settrace` or `sys.monitoring` | BE-03 §1 | Open; S2 recommends `sys.monitoring` |
| G3 | Fri 13 Nov | Freeze trace format | BE-04 §1, fixtures | Open |
| G4 | Fri 25 Dec | Python beta go/no-go, team size | M1 | Open |
| G5 | Fri 19 Feb | Safety checks, tree-sitter, big arrays | BE-07 §3, BE-09 §3, FE-08 §1 | Open |

## Handoffs (BE → FE)

| Delivers | Due | Status |
|---|---|---|
| Trace schema | Wed 28 Oct | ✅ 23 Oct (`fb41bd7`) |
| Real C++ traces (S1) | Fri 6 Nov | 🟡 Wire output from the prototype in `schema/testdata/wire/`; the trace format needs the core (BE-04) |
| Format frozen | Fri 13 Nov | G3 |
| OpenAPI | Tue 17 Nov | ✅ 23 Oct (`3ebd66b`) |
| Local stack | Wed 18 Nov | 🟡 MySQL, SeaweedFS and migrations run; buckets, seed data and sandbox missing |
| Real Python traces | Fri 4 Dec | ✅ 24 Oct: `backend/fixtures/python/*/expected.trace.json`, from `vizctl trace` |
| Staging | Mon 28 Dec | Not started (BE-13 §3) |
| C++ pointer values | M2 week 3 | Not started (BE-08 §3) |
| Sparse arrays | End of M2 | Not started (BE-04 §3) |
| Friendly errors, line hits, untraced tail | M3 week 2 | Not started (BE-10, BE-11) |

## Recount

Prints `done/total` for every task file; copy the numbers into the tables above.

```bash
cd plans/tasks
for f in backend/*.md frontend/*.md; do
  echo "$(basename "$f" .md | cut -d- -f1-2) $(grep -c '\- \[x\]' "$f")/$(grep -cE '\- \[[ x]\]' "$f")"
done
```
