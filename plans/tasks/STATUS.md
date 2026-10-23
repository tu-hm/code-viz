# Task status

**Updated Fri 23 Oct 2026.** One row per task. The checklist in each task file is the source of truth; when you tick items there, update the row here. The recount command is at the bottom.

✅ done · 🟡 in progress · 🟢 ready to start · ⏳ waiting on another task

## Now

- **In progress:** BE-01 (37/46). CI runs `make check` on every push and PR to `main`, and the first run is green. Every item left waits on another task or on a decision; see [BE-01 open items](#be-01-open-items).
- **Next, by the suggested order:** BE-08 §1 (GDB prototype, feeds G1 and the S1 traces due Fri 6 Nov), then BE-02 §1. On FE: FE-01 §1–2. The trace schema and OpenAPI are both on `main`, so FE codegen can start.
- **Ahead of plan:** M0 starts Mon 26 Oct. Both BE → FE contracts are delivered early.

## Decisions waiting on you

- [ ] Mark the CI checks as required on `main` (BE-01 §2)? This blocks direct pushes to `main`, so every change would go through a PR.
- [ ] API: what does `wait` do when `since` is missing?
- [ ] API: what does `POST /visualizations/{id}/share` return before the visualization is completed?
- [ ] API: auth scheme (`securitySchemes`) for signed-in callers.
- [ ] API: should a failed response carry the trace ID (§5.6)?
- [ ] Lead items (option A vs B before 16 Nov, MySQL hosting, deploy path): see [README.md](README.md#lead--design-tasks-not-in-the-befe-lists).

## Backend

| Task | Milestone | Status | Done | Next step, or what it waits on |
|---|---|---|---|---|
| [BE-01](backend/BE-01-foundation-contracts.md) Foundation & contracts | M0–M1 | 🟡 | 37/46 | CI runs `make check`. Open items: see [BE-01 open items](#be-01-open-items) |
| [BE-02](backend/BE-02-sandbox.md) Sandbox ⚠ | M0–M1, M3 | 🟡 | 19/54 | §2 Docker dev adapter done and passes `sandboxtest`. §1 spike S1b needs the BE-08 §1 prototype; result decides G1 (Fri 6 Nov) |
| [BE-03](backend/BE-03-python-tracer.md) Python tracer | M0–M1 | ⏳ | 0/35 | §1 spike S2 comes after BE-02 §1 in the M0 order; decides G2 (Fri 13 Nov). §2+ need BE-02 §2, BE-04 |
| [BE-04](backend/BE-04-trace-processing.md) Trace processing | M0–M2 | 🟢 | 0/31 | §1 spike S4 (input to G3, Fri 13 Nov); needs only BE-01 |
| [BE-05](backend/BE-05-job-queue-worker.md) Job queue & worker | M1 | ⏳ | 0/30 | BE-02, BE-04, BE-06 §2 |
| [BE-06](backend/BE-06-visualization-api.md) Visualization API | M0–M1 | 🟢 | 0/50 | §1 spike S5 (stretch) can start; §2+ need BE-13 §1 |
| [BE-07](backend/BE-07-cpp-build.md) C++ build | M2 | ⏳ | 0/20 | BE-02, BE-05 |
| [BE-08](backend/BE-08-cpp-tracer.md) C++ tracer ⚠ | M0, M2 | 🟢 | 0/33 | §1 GDB prototype is next; §2+ need BE-07 |
| [BE-09](backend/BE-09-cpp-stl-big-arrays.md) C++ STL & big arrays | M2 | ⏳ | 0/24 | BE-08 |
| [BE-10](backend/BE-10-friendly-errors.md) Friendly errors | M3 | ⏳ | 0/14 | BE-03, BE-07, BE-08 |
| [BE-11](backend/BE-11-whole-run-trace-options.md) Whole-run data & options | M3 (M5) | ⏳ | 0/22 | BE-03, BE-07–09 |
| [BE-12](backend/BE-12-share-permalinks.md) Share & permalinks | M3 | ⏳ | 0/10 | BE-06 |
| [BE-13](backend/BE-13-environments-launch.md) Environments & launch | M1–M5 | 🟢 | 0/48 | §1 can start. BE-01 §6 already covers part of it (Compose with MySQL + SeaweedFS, `migrate up` on start); not ticked yet |
| [BE-14](backend/BE-14-c-language.md) C language | M4 | ⏳ | 0/10 | BE-07–09 |
| **Total** | | | **56/427** | |

### BE-01 open items

| Item | Waits on |
|---|---|
| §2 web checks job | FE-01 §1 (the web workspace) |
| §2 required checks on `main` | Your decision (above) |
| §2 Done: a PR shows every check | The first PR |
| §6 sandbox tests on Linux runners | BE-02 §3 (testcontainers and Docker sandbox tests already run in CI) |
| §3 and §5 TypeScript output from `make gen` | FE-01 §2 (the Go side is done) |
| §4 Done: validates S1 prototype output | BE-08 §1 |
| §6 multi-arch runner images | BE-03, BE-08 (`vizd` already builds for both) |
| §6 Done: clone to completed local job | BE-02, BE-05, BE-06, BE-13 §1 |

## Frontend

| Task | Milestone | Status | Done | Next step, or what it waits on |
|---|---|---|---|---|
| [FE-01](frontend/FE-01-foundation-fixtures.md) Foundation & fixtures | M0–M2 | 🟢 | 0/45 | §1 web workspace, then §2 codegen (both contracts are ready) |
| [FE-02](frontend/FE-02-trace-player-controls.md) Trace player & controls | M0–M1, M3 | ⏳ | 0/43 | FE-01 |
| [FE-03](frontend/FE-03-code-pane.md) Code pane | M0, M3 | ⏳ | 0/15 | §1 right after FE-01 §1; §2 needs BE-11 §1 |
| [FE-04](frontend/FE-04-visualize-from-ide.md) Visualize from the IDE | M1 | ⏳ | 0/18 | FE-01 §6, BE-06 (MSW mocks can use the OpenAPI examples until then) |
| [FE-05](frontend/FE-05-run-states-errors.md) Run states & errors | M1–M3 | ⏳ | 0/29 | FE-04; BE-07 §2, BE-10, BE-11 |
| [FE-06](frontend/FE-06-stack-heap-view.md) Stack & heap view | M0–M2, M4 | ⏳ | 0/34 | FE-02 §2; BE-09 §1 |
| [FE-07](frontend/FE-07-reference-pointer-arrows.md) Reference & pointer arrows | M0–M2 | ⏳ | 0/21 | §1 spike S3 after FE-01 §3; §2 needs FE-06 §2 |
| [FE-08](frontend/FE-08-array-matrix-views.md) Array & matrix views | M1–M2 | ⏳ | 0/37 | FE-03, FE-06; BE-09 §2 |
| [FE-09](frontend/FE-09-narration-input-cursor.md) Narration & input cursor | M1, M3 | ⏳ | 0/19 | FE-02 §2, FE-08 §3 |
| [FE-10](frontend/FE-10-goto-expected-output.md) Go to… & expected output | M1 | ⏳ | 0/20 | FE-02 §2, FE-03 |
| [FE-11](frontend/FE-11-watch-timeline.md) Watch panel & timeline | M3, M5 | ⏳ | 0/12 | FE-08 §3, FE-10 §1 |
| [FE-12](frontend/FE-12-share-permalinks.md) Share & permalinks | M3 | ⏳ | 0/9 | BE-12, FE-02 §3 |
| [FE-13](frontend/FE-13-mobile-a11y-analytics.md) Mobile, a11y & analytics | M3 | ⏳ | 0/24 | FE-02 §4, FE-06, FE-07 |
| [FE-14](frontend/FE-14-cp-data-views.md) CP data views | M5 | ⏳ | 0/32 | FE-06, FE-08, FE-10 |
| **Total** | | | **0/358** | |

## Decision gates

| Gate | Date | Decides | Input | Status |
|---|---|---|---|---|
| G1 | Fri 6 Nov | gVisor or nsjail | BE-02 §1 | Open |
| G2 | Fri 13 Nov | `settrace` or `sys.monitoring` | BE-03 §1 | Open |
| G3 | Fri 13 Nov | Freeze trace format | BE-04 §1, fixtures | Open |
| G4 | Fri 25 Dec | Python beta go/no-go, team size | M1 | Open |
| G5 | Fri 19 Feb | Safety checks, tree-sitter, big arrays | BE-07 §3, BE-09 §3, FE-08 §1 | Open |

## Handoffs (BE → FE)

| Delivers | Due | Status |
|---|---|---|
| Trace schema | Wed 28 Oct | ✅ 23 Oct (`fb41bd7`) |
| Real C++ traces (S1) | Fri 6 Nov | Not started (BE-08 §1) |
| Format frozen | Fri 13 Nov | G3 |
| OpenAPI | Tue 17 Nov | ✅ 23 Oct (`3ebd66b`) |
| Local stack | Wed 18 Nov | 🟡 MySQL, SeaweedFS and migrations run; buckets, seed data and sandbox missing |
| Real Python traces | Fri 4 Dec | Not started (BE-03) |
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
