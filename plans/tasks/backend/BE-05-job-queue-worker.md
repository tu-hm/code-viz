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

- [ ] Port in `internal/ports`: `Enqueue(tx)`, `Claim`, `Heartbeat/CheckLease`, `Complete`, `Fail`, `Requeue`, `Cancel`
- [ ] **Enqueue** inside the trace-create transaction (§7.6)
- [ ] **Claim** (short tx): `SELECT … FORCE INDEX (claim_idx) … FOR UPDATE SKIP LOCKED`, then `UPDATE … status='running', attempt+1, leased_by, leased_until = NOW(6)+45s`
- [ ] Priority: signed-in users first (`priority` column)
- [ ] Idle polling every 200 ms with jitter, back off to 1 s after 10 empty claims; claim again right after a job
- [ ] Every worker write checks `leased_by = ?`
- [ ] **Rescuer** (any worker, ≤ once / 10 s): expired leases with `attempt < 2` → `queued`; `attempt >= 2` → `failed` (`internal_error`)
- [ ] **Cancel**: `UPDATE … status='canceled' WHERE trace_id=? AND status='queued'`
- [ ] **Cleanup**: delete finished jobs in batches after 24 h
- [ ] Use the deadlock retry helper (1213/1205, 3 tries with jitter)

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
- [ ] Property test: random worker kills → no job lost, no job run twice (testcontainers MySQL)
- [ ] Cancel while queued and while running

## Done when

No job is lost or run twice when workers are killed at random.
