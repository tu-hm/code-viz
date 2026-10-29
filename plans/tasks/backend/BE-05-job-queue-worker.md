# BE-05 · Job queue & worker

| | |
|---|---|
| **Milestone** | M1 (weeks 7–8) |
| **Estimate** | 4.5 days |
| **Depends on** | BE-06 §2 (MySQL tables), BE-02 (sandbox), BE-04 (`tracecore`) |
| **Blocks** | BE-06 API end to end, BE-13 staging |
| **Covers** | M1-08 |
| **Spec** | §7.7, §7.8, §7.13.2, §7.13.4 |

## 1. `JobQueue` port + `internal/adapters/mysqlqueue`

- [x] Port in `internal/ports`: `Enqueue(tx)`, `Claim`, `Heartbeat/CheckLease`, `Complete`, `Fail`, `Requeue`, `Cancel`
- [x] **Enqueue** inside the trace-create transaction (§7.6)
- [x] **Claim** (short tx): `SELECT … FORCE INDEX (claim_idx) … FOR UPDATE SKIP LOCKED`, then `UPDATE … status='running', attempt+1, leased_by, leased_until = NOW(6)+45s`
- [x] Priority: signed-in users first (`priority` column)
- [x] Idle polling every 200 ms with jitter, back off to 1 s after 10 empty claims; claim again right after a job
- [x] Every worker write checks `leased_by = ?`
- [x] **Rescuer** (any worker, ≤ once / 10 s): expired leases with `attempt < 2` → `queued`; `attempt >= 2` → `failed` (`internal_error`)
- [x] **Cancel**: `UPDATE … status='canceled' WHERE trace_id=? AND status='queued'`
- [x] **Cleanup**: delete finished jobs in batches after 24 h
- [x] Use the deadlock retry helper (1213/1205, 3 tries with jitter)

The adapter is `mysql.Queue` in `internal/adapters/mysql`, not a `mysqlqueue` package: AGENTS.md keeps all SQL there. Every time comes in as `now`; no query calls `NOW(6)`. The port also has `Building`, `Tracing` and `Progress`, which bump `traces.version` and `updated_at`, and `Rescue` and `Cleanup`, which the worker schedules. A job's status and its trace's status change in one transaction that locks the trace row first, then the job row only if it is still `running` under this `leased_by`; otherwise `domain.ErrLeaseLost`, and nothing changes. `CheckLease` only reads: the 45 s lease is never extended. `Fail` takes the stage from the trace (`tracing` → `trace`, else `build`). `Cancel` leaves a running job to finish (see STATUS decisions). The worker runs the idle poll loop and schedules the rescuer and cleanup (§2).

## 2. Worker (`vizd --role=worker`)

**State machine** (§7.7)
- [x] `queued → building → tracing → completed | failed`
- [x] Skip `building` when the language has no build
- [x] Bump `traces.version` + `updated_at` on every status change
- [x] Write `progress_steps` at most once per second

**Run a job**
- [x] Load source/stdin/options; pick manifest from the `Adapters` port
- [x] Build in the sandbox (if any) → on failure: `failed` with `compile_error` / `unsupported_module`
- [x] Trace in the sandbox → stream into `tracecore`
- [x] Upload chunks via `BlobStore` (3 retries with backoff, §7.8)
- [x] Write header, `chunk_count`, `exit_kind`, status `completed`

**Errors & retries**
- [x] User program outcomes (exception, signal, timeout, limits) → `completed` with `exit.kind`, **never retried**
- [x] Infra errors (sandbox start, node drain, storage) → requeue once, on another worker
- [x] Broken tracer output → `failed` `internal_error`

**Deadlines & cancel**
- [x] 30 s hard deadline per job; on hit, kill sandbox, keep steps, `truncation.time_limit`
- [x] Lease check every second; if canceled, kill the sandbox

**Lifecycle**
- [x] `SIGTERM`: stop claiming; finish running jobs within 25 s; otherwise requeue them
- [x] Node janitor: kill orphaned sandboxes by label and age

The worker is `app.Worker` in `internal/app`, run by `vizd` under `worker` and `all`: one slot per process, named `leased_by` = hostname + random suffix. Each loop pass runs the chores that are due (rescue every 10 s, `Sandbox.Sweep` every minute, cleanup every hour), then claims; empty claims wait 200 ms ±20%, 1 s from the 10th in a row. A per-job watcher checks the lease every second and writes `Progress` instead when the step count moved, so progress is at most one write a second; a lost lease cancels the job's context, which kills the box, and nothing more is written. Start, build and trace run within 30 s of the claim, build and trace also within the §11 15 s wall time, upload and `Complete` within the 45 s lease. `ErrInfra` (sandbox, storage, a failed status write, a language that is unknown or disabled here) requeues; the queue fails the second attempt. A retry goes back to the shared queue, so nothing makes it land on another worker. The janitor is `Sweep(ctx, now)` on the `Sandbox` port: the Docker and nsjail adapters only cleaned up at start. nsjail now takes the manifest's image name and finds it under `/opt/viz/rootfs`; the manifest loader refuses names that leave that directory. `app.Build` is the build step for both the worker and `vizctl`.

## 3. Tests

- [x] Unit tests for each §7.7 transition
- [x] Every §7.8 failure case (worker crash, drain, storage down, broken tracer output, deadlock)
- [x] Property test: random worker kills → no job lost, no job run twice (testcontainers MySQL)
- [ ] Cancel while queued and while running

Queue side done in `internal/adapters/mysql`: each transition's write, a lost lease after rescue or a re-claim, worker crash (rescue on both sides of the lease expiry), a real deadlock through `InTx`, and cancel while queued and while running (the running job is left alone). The property test is a seeded, single-goroutine run of 150 jobs and workers that are killed or stall past their lease, and it logs the seed. Worker side in `internal/app` (real MySQL and SeaweedFS, waits through a scripted clock): each §7.7 path end to end with the Docker sandbox and the Python runner image, and with a fake sandbox a skipped build, a start failure, a broken tracer, the wall-time deadline, a lost lease, storage down, a crashed worker rescued on the 10 s schedule, both drain outcomes, progress and the idle backoff. A deadlock is retried inside `InTx`, so the worker has no case of its own. Open: cancel while running waits on the STATUS decision; the worker already stops within a second once a write or lease check returns `ErrLeaseLost`.

## Done when

No job is lost or run twice when workers are killed at random.
