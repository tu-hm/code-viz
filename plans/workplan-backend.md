# Backend Work Plan (BE)

| | |
|---|---|
| **Role** | Go services (`vizd` api and worker, `vizctl`), tracers (Python, C++), sandbox, MySQL (including the job queue), object storage, infrastructure, and **owner of the contracts** (trace schema, wire schema, OpenAPI) |
| **Based on** | `code-visualizer-spec.md` v1.1 and `code-visualizer-workplan.md`. Every **§** points to the spec. |
| **Start** | Monday 2026-10-26 |
| **Capacity** | 4.5 focus days per week, for one backend engineer |
| **IDs** | `M0-xx` and `M1-xx` are the same as in the overview plan. `Mx-Bxx` are new backend tasks for M2–M5. |

## 1. Summary

| Milestone | BE load | BE capacity (one engineer) | Verdict |
|---|---|---|---|
| M0 (3 wks) | 13 days | 13.5 | Fits, but tight |
| M1 (6 wks, option A) | 27.5 days | 27 | Fits; M1-11 may slip into M2 week 1. Includes +2.5 days for the MySQL job queue. |
| M2 (4 wks planned) | 29 days | 18 | **Over by 11 days, about 6.5 weeks of work for one engineer** |
| M3 (5 wks) | 20.5 days | 22.5 | Fits |
| M4 (2 wks) | 5–10 days | 9 | Fits with the C adapter; the DAP bridge doesn't fit |
| M5 (4 wks) | 8 days | 18 | Slack, used for hardening |

**Backend is the bottleneck in M1 and M2.** With one backend engineer (option A), launch is about **26 Mar 2027**. A second backend engineer from 16 Nov (option B) brings launch to about **19 Feb 2027**.

## 2. Handoffs to frontend

FE builds on **fixtures** until each item lands. The fallback column says what FE uses until then.

| BE delivers | Task | Due | FE uses it for | FE fallback until then |
|---|---|---|---|---|
| `trace.v1.schema.json` | M0-05 | **Wed 28 Oct** | Codegen, fixtures, trace engine | A draft written from spec §9 |
| Real C++ traces from the S1 prototype | M0-09/10 | Fri 6 Nov | More realistic fixtures | Hand-written fixtures |
| Trace format frozen (G3) | M0-12 | Fri 13 Nov | A stable engine | — |
| `api/openapi.yaml` | M1-01 | **Tue 17 Nov** | IDE and API client | MSW mocks from the spec §8 examples |
| Local stack (`vizd --role=all`) | M1-02 | Wed 18 Nov | Developing against the real API | MSW |
| Real Python traces | M1-05/06 | Fri 4 Dec | Replacing the Python fixtures | Fixtures |
| Staging environment | M1-12 | Mon 28 Dec | Nightly end-to-end tests | Local stack |
| C++ traces with `ptr` values | M2-B04 | M2, week 3 | Pointer arrows | Fixtures with `ptr` |
| Sparse sequences and dirty cells | M2-B08 | End of M2 | Big-array view | Fixtures |
| Friendly-error payloads, `lineHits`, untraced tail | M3-B01–B03 | M3, week 2 | Error UI, hit-count gutter, step-limit banner | Fixtures |

What BE needs from FE:
- the fields each view needs, before G3 on 13 Nov;
- the error-payload shape for friendly errors, agreed with DS before M3.

## 3. Week by week (M0 and M1)

| Week | Dates | Tasks | Load |
|---|---|---|---|
| 1 | 26–30 Oct | M0-01 skeleton · **M0-05 trace schema** · M0-06 wire schema · M0-03 CI | 4.5 |
| 2 | 2–6 Nov | **M0-09 GDB prototype** · **M0-10 sandbox measurements** → gate **G1** on Fri | 4 |
| 3 | 9–13 Nov | M0-11 Python hook spike · M0-12 trace-size spike · M0-14 long-poll spike (stretch) → gates **G2, G3** | 4.5 |
| 4 | 16–20 Nov | **M1-01 OpenAPI** (by Tue) · M1-02 local stack · M1-03 database · start M1-04 | 4.5 |
| 5 | 23–27 Nov | M1-04 tracecore · start M1-05 | 4.5 |
| 6 | 30 Nov – 4 Dec | M1-05 Python tracer · M1-06 runner image and `vizctl` | 4.5 |
| 7 | 7–11 Dec | M1-07 sandbox adapter · start **M1-08 MySQL job queue and worker** | 4.5 |
| 8 | 14–18 Dec | Finish M1-08 · start M1-09 API | 4.5 |
| 9 | 21–25 Dec | Finish M1-09 · M1-10 storage · M1-12 staging · M1-11 observability → gate **G4** | **5 (over)** |

Week 9 is over by about half a day. **M1-11 observability may slip into M2 week 1**, and staging may finish on Mon 28 Dec.

## 4. M0 tasks (BE)

| ID | Task | Days | Depends on | Done when | Spec |
|---|---|---|---|---|---|
| M0-01 | Go repo skeleton: `cmd/vizd`, `cmd/vizctl`, `internal/*`, Makefile (`gen`, `test`, `golden-update`) | 0.5 | — | `make test` passes | §18.6 |
| M0-03 | CI on GitHub Actions: golangci-lint, `go test`, govulncheck, plus the web checks; required on pull requests | 1 | M0-01 | A pull request shows all checks | §18.2 |
| M0-05 | `trace.v1.schema.json`: the §9 format plus the optional v1.1 fields | 2 | M0-01 | Validates every fixture; tests with invalid examples | §9, §19.9 |
| M0-06 | `wire.v1.schema.json` | 1 | M0-05 | Validates the S1 prototype output | §10.1 |
| M0-09 | **S1a** GDB Python prototype that writes wire NDJSON for a loop, recursion and STL | 2 | M0-06 | Valid output for all 3 | §7.11.2 |
| M0-10 | **S1b** run it under gVisor and nsjail (C.9); measure `ptrace`, start time and 1,000-step time; 1-page report | 2 | M0-09 | Answers the S1 pass criteria | §18.7 |
| M0-11 | **S2** Python `settrace` vs `sys.monitoring` | 1.5 | — | Numbers and a recommendation | §18.7 |
| M0-12 | **S4** trace size for a 200k-array DFS (throwaway conversion script) | 1.5 | M0-10 | ≤ 2 MB gzip, or a fix proposed | §18.7 |
| M0-14 | **S5** (stretch) long-poll with 5,000 parked requests, woken by the MySQL change poller | 1.5 | — | Status change reaches the client in ≤ 400 ms p95; memory ≤ 200 MB | §18.7, §7.13.3 |

**Total: 13 days.**

## 5. M1 tasks (BE)

| ID | Task | Days | Depends on | Done when | Spec |
|---|---|---|---|---|---|
| M1-01 | `openapi.yaml` (5 endpoints) and oapi-codegen strict server stubs | 1.5 | M0-07 | Server and TypeScript client generate from it | §8 |
| M1-02 | Docker Compose with MySQL 8.4 and SeaweedFS; `vizd --role=all` | 1 | M0-01 | One command brings up the system | §7.2 |
| M1-03 | MySQL tables `traces`, `visualizations`, `usage_daily`, `jobs`; goose migrations; sqlc; deadlock retry helper (errors 1213, 1205) | 1.5 | M1-02 | Migrations up and down; queries tested | §7.5, §7.13 |
| M1-04 | `tracecore`: validation, stable IDs, deltas and keyframes, chunks, limits, truncation | 4 | M0-06, G3 | Golden tests pass | §9, §10.1 |
| M1-05 | `tracer.py`: hook per G2; frames from `main.py` only; stdout tagging; exact `stdinPos`; internal flags; blocked modules; `callId`; line counter and untraced tail | 4 | G2 | Reproduces every Python fixture from real code | §7.11.1, §19.9 |
| M1-06 | Python runner image and manifest; `vizctl trace` | 1.5 | M1-04, M1-05 | `vizctl trace --lang python3` prints a valid trace | §10.2 |
| M1-07 | Sandbox adapter chosen at G1, with the §11 limits | 2 | G1 | Fork bomb, network and filesystem escapes are blocked | §11, §12 |
| M1-08 | **MySQL job queue**: claim with `SKIP LOCKED`, 45 s leases with `leased_by` checks, rescuer, cancel, cleanup. **Worker**: state machine, retries, 30 s deadline, janitor, graceful shutdown. | 4.5 | M1-03 | No job lost or run twice when workers are killed at random; every §7.8 case tested | §7.7, §7.8, §7.13.2 |
| M1-09 | API: create (single-flight with `ON DUPLICATE KEY`, quotas, idempotency), long-poll get with the change poller, delete, presigned URLs | 3 | M1-01, M1-03 | Contract tests for all §8 examples | §8, §7.12, §7.13.3 |
| M1-10 | Object storage: put, presign, `t7/` and `t90/` lifecycle rules | 1 | M1-02 | Objects expire on staging | §7.5 |
| M1-11 | Observability: slog, OpenTelemetry, Prometheus metrics, including queue claim latency (**may slip into M2 week 1**) | 1 | M1-08 | One request traced end to end | §18.2 |
| M1-12 | Staging with OpenTofu: runner node pool, KEDA MySQL scaler, managed MySQL 8.4 and bucket | 2.5 | M1-07 | Autoscales from 1 to 3 runner pods | §18.4 |

**Total: 27.5 days.**

## 6. M2: C++ (BE tasks)

Suggested order follows the table.

| ID | Task | Days | Depends on | Done when | Spec |
|---|---|---|---|---|---|
| M2-B01 | C++ build pipeline: `flush_init.cpp`, two precompiled headers (checks on and off), safety flags, `--coverage`, warning capture | 3 | — | A build takes ≤ 3 s with the precompiled header | §7.11.2, §19.6 |
| M2-B02 | C++ runner image and manifest; compile-error and warning parsing into diagnostics | 2 | M2-B01 | §8.3 failed-build example reproduced | §8.3, §10.2 |
| M2-B03 | GDB tracer core: start at `main`, `step` with skips, `finish` out of library code, frames outermost first | 4 | M0-09 | The loop, recursion and STL programs trace correctly | §7.11.2 |
| M2-B04 | Variables: globals frame, hidden until declared, internal flags; `ptr` values with pointer following and per-step object budget | 4 | M2-B03 | `cpp_view` mock data reproduced | §7.11.2, §9.4 |
| M2-B05 | Return values (`FinishBreakpoint`), `callId`, signals as error steps | 2 | M2-B03 | fib and segfault fixtures pass | §19.9.6 |
| M2-B06 | Type map with libstdc++ pretty printers (vector, map, set, pair, stack, queue, priority_queue, bitset, string) | 4 | M2-B04 | One test per §10.3 row | §10.3 |
| M2-B07 | Sparse sequences and dirty cells: one memory read per array per step, diff, patches | 3 | M2-B04 | 200k-array DFS stays within the S4 target | §19.9.1 |
| M2-B08 | Hook the sparse and dirty-cell output into `tracecore` (patches, keyframe sparse form) | 1 | M2-B07, M1-04 | Golden tests pass | §19.9.1 |
| M2-B09 | **S6** whole-array read and diff cost | 2 | M2-B07 | ≤ 2 ms per step for 200,005 ints | §18.7 |
| M2-B10 | **S7** overhead of safety checks and coverage on 10 CP solutions | 1.5 | M2-B01 | ≤ 3× unchecked run time | §18.7 |
| M2-B11 | C++ conformance fixtures (ports of the shared Python cases) | 1.5 | M2-B06 | Conformance suite green | §15 |
| M1-11 | Observability, if it slipped from M1 | 1 | — | — | §18.2 |

**Total: 29 days. With one engineer that's about 6.5 weeks, not 4.**

## 7. M3: launch polish and student UX (BE tasks)

| ID | Task | Days | Depends on | Done when | Spec |
|---|---|---|---|---|---|
| M3-B01 | Friendly-error payloads: breakpoints on `__ubsan_handle_*` and the debug-mode error formatter; values involved; message key | 3 | M2-B05 | The §19.6 table reproduced for C++ and Python | §19.6 |
| M3-B02 | `lineHits` from gcov (C++) and the Python counter; `lineHitsSource` | 2 | M2-B01 | Binary-search counts match the §19.3 mock | §19.9.3 |
| M3-B03 | Untraced tail for C++: delete breakpoints after the limit and continue; store `tail.txt.gz` | 2 | M2-B03 | A 2,000-iteration loop gives complete output | §19.9.5 |
| M3-B04 | Start-at-line (`startAtLines`) in both tracers | 1.5 | M2-B03, M1-05 | §5.6 dialog works end to end | §5.6 |
| M3-B05 | Show range (`captureRanges`) re-runs | 1 | M2-B07 | Window moves beyond the recorded range | FR-11 |
| M3-B06 | Share endpoint: copy chunks to `t90/`, permalinks | 1.5 | M1-10 | §8.6 works; links can be revoked | §8.6 |
| M3-B07 | k6 load test at 2× expected peak; tune pools and KEDA | 3 | M1-12 | §13 latency targets met | §13, §15 |
| M3-B08 | Security test suite (§15 list) in CI | 2 | M1-07 | All attack cases are contained | §12, §15 |
| M3-B09 | Production environment, alerts, runbooks | 3 | M1-12 | On-call can follow the runbook for the §7.8 cases | §7.8 |
| M3-B10 | Launch support and fixes buffer | 1.5 | — | — | — |

**Total: 20.5 days.**

## 8. M4 and M5 (BE tasks)

| ID | Task | Days | Spec |
|---|---|---|---|
| M4-B01 | C adapter, reusing the C++ adapter with `gcc -std=c17` | 3 | §10.5 |
| M4-B02 | Run the conformance suite for C; register the manifest behind a flag | 2 | §10.4 |
| M4-B03 | (Alternative to B01) generic DAP bridge with google/go-dap: a bigger effort, which doesn't fit in M4 | 8 | §10.4 |
| M5-B01 | Exact access hints, if S8 accuracy was low | 3 | §19.9.2 |
| M5-B02 | Hardening: cost and performance tuning from production metrics | 3 | §7.9 |
| M5-B03 | Support the usability test environment | 2 | §19.11 |

## 9. Definition of done (BE)

- Unit tests, plus golden traces for anything that touches trace output; masked addresses and timings.
- Schemas, OpenAPI and generated types are updated in the same pull request; CI drift check passes.
- New limits and failure paths are listed in spec §11 and §7.8.
- Metrics or logs exist for anything that can fail in production.
- Behind a feature flag until M3.
