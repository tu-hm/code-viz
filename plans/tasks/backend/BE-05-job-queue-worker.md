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
- [ ] Idle polling every 200 ms with jitter, back off to 1 s after 10 empty claims; claim again right after a job
- [x] Every worker write checks `leased_by = ?`
- [x] **Rescuer** (any worker, ≤ once / 10 s): expired leases with `attempt < 2` → `queued`; `attempt >= 2` → `failed` (`internal_error`)
- [x] **Cancel**: `UPDATE … status='canceled' WHERE trace_id=? AND status='queued'`
- [x] **Cleanup**: delete finished jobs in batches after 24 h
- [x] Use the deadlock retry helper (1213/1205, 3 tries with jitter)

The adapter is `mysql.Queue` in `internal/adapters/mysql`, not a `mysqlqueue` package: AGENTS.md keeps all SQL there. Every time comes in as `now`; no query calls `NOW(6)`. The port also has `Building`, `Tracing` and `Progress`, which bump `traces.version` and `updated_at`, and `Rescue` and `Cleanup`, which the worker schedules. A job's status and its trace's status change in one transaction that locks the trace row first, then the job row only if it is still `running` under this `leased_by`; otherwise `domain.ErrLeaseLost`, and nothing changes. `CheckLease` only reads: the 45 s lease is never extended. `Fail` takes the stage from the trace (`tracing` → `trace`, else `build`). `Cancel` leaves a running job to finish (see STATUS decisions). Open here: the idle poll loop, the rescuer and cleanup schedules (§2).

## 2. Worker (`vizd --role=worker`)

**State machine** (§7.7)
- [ ] `queued → building → tracing → completed | failed`
- [ ] Skip `building` when the language has no build
- [ ] Bump `traces.version` + `updated_at` on every status change
- [ ] Write `progress_steps` at most once per second

**Run a job**
- [ ] Load source/stdin/options; pick manifest from the `Adapters` port
- [ ] Build in the sandbox (if any) → on failure: `failed` with `compile_error` / `unsupported_module`
- [ ] Trace in the sandbox → stream into `tracecore`
- [ ] Upload chunks via `BlobStore` (3 retries with backoff, §7.8)
- [ ] Write header, `chunk_count`, `exit_kind`, status `completed`

**Errors & retries**
- [ ] User program outcomes (exception, signal, timeout, limits) → `completed` with `exit.kind`, **never retried**
- [ ] Infra errors (sandbox start, node drain, storage) → requeue once, on another worker
- [ ] Broken tracer output → `failed` `internal_error`

**Deadlines & cancel**
- [ ] 30 s hard deadline per job; on hit, kill sandbox, keep steps, `truncation.time_limit`
- [ ] Lease check every second; if canceled, kill the sandbox

**Lifecycle**
- [ ] `SIGTERM`: stop claiming; finish running jobs within 25 s; otherwise requeue them
- [ ] Node janitor: kill orphaned sandboxes by label and age

## 3. Tests

- [ ] Unit tests for each §7.7 transition
- [ ] Every §7.8 failure case (worker crash, drain, storage down, broken tracer output, deadlock)
- [x] Property test: random worker kills → no job lost, no job run twice (testcontainers MySQL)
- [ ] Cancel while queued and while running

Queue side done in `internal/adapters/mysql`: each transition's write, a lost lease after rescue or a re-claim, worker crash (rescue on both sides of the lease expiry), a real deadlock through `InTx`, and cancel while queued and while running (the running job is left alone). The property test is a seeded, single-goroutine run of 150 jobs and workers that are killed or stall past their lease, and it logs the seed. Open: the worker's side of each item (§2).

## Done when

No job is lost or run twice when workers are killed at random.
