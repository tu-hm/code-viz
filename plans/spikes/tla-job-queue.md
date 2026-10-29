# TLA+: the job queue, leases and single-flight

**Run Sat 24 Oct 2026 · code at `26837b8` · TLC 1.8.0 · result: the database side holds every invariant and no job is lost; chunk uploads are not fenced by the lease, so a late upload can leave a completed trace with chunks that fail their checksum**

## Question

Does the queue of §7.13.2 keep its promises when workers crash, stall past their lease, or get rescued while still running? The property test (`TestNoJobIsLostOrCompletedTwiceWhenWorkersDieAtRandom`) samples random schedules against real MySQL. A model checker tries every schedule of a small system instead.

## The model

`plans/spikes/tla/JobQueue.tla` follows `internal/adapters/mysql/queue.go`, `store.go` and `internal/app/worker.go`:

- **Transactions are atomic steps.** Each transaction that writes a trace or its job locks the trace row first (`FOR UPDATE`); `Claim` locks only the job row with `SKIP LOCKED` and doesn't write the trace; Cancel's `UPDATE` re-reads the job's status once Claim's lock is gone (READ COMMITTED). So no interleaving inside a transaction changes the outcome.
- **API:** `Create(v, k)` is one create transaction: a new trace and job for an unseen cache key, a reset and a new job for a canceled trace or one that failed with `internal_error`, otherwise attach. `Detach(v)` cancels the queued job when no other visualization waits; the bump of the oldest queued visualization inside `Create` is the same detach under the same lock.
- **Worker:** claim; mark building; build fails (`compile_error`) or mark tracing; the sandbox runs, fails to start (requeue) or prints malformed output (`internal_error`); upload chunks or storage fails (requeue); complete. Every database write goes through the lease check of `queue.leased` (`leased_by = ? AND status = 'running'`); a lost lease ends the run with no write. The watch goroutine may notice a lost lease at any point. Chunk uploads have no lease check, as in `Blobs.Put`.
- **Time:** `Expire(i)` is the moment job i's lease runs out by the rescuer's clock. With perfect clocks it is also the worker's context deadline (both are claim + 45 s), so the worker can then only requeue under `context.WithoutCancel`, which is lease-checked. `Rescue(i)` requeues or fails an expired running job. `Crash(p)` kills a worker for good.
- **`LateWrites`:** the worker learns of its deadline after the rescuer did: its clock is behind, or a PUT it sent before the deadline lands after it.
- **`SharedName`:** every worker process leases under one name, as it would without the random suffix in `workerName`.

Invariants:

| Invariant | Says |
|---|---|
| `OneLiveJobPerTrace` | At most one queued or running job per trace (§7.13.2) |
| `TraceMatchesJob` | A trace is queued, building or tracing exactly when its job is queued or running, and building or tracing only while the job runs |
| `AttemptsBounded` | A job is claimed at most twice (§7.7) |
| `AttachedNeverCanceled` | A trace that a visualization still waits on is never canceled (§7.7) |
| `CompletedByCurrentLease` | A completed trace's row describes the run that held the job's latest lease |
| `ChunksMatchTrace` | The chunks in object storage are the ones the completed row describes (its `sha256` and `sizeBytes`) |

Liveness, with weak fairness for live workers, lease expiry and the rescuer, and at most one crash: `JobsEnd` (every queued or running job ends: none is lost) and `VisualizationsSettle` (every attached visualization reaches a final status or is detached).

## Results

| Config | Constants | Distinct states | Result |
|---|---|---|---|
| `safety.cfg` | 2 cache keys, 3 visualizations, 2 workers, 1 crash | 8,706,623 | **All six invariants hold** |
| `late-writes.cfg` | same, `LateWrites` | 35,240,923 | **The five database invariants hold** |
| `late-chunks.cfg` | same, `LateWrites` | 93,858 before the error | **`ChunksMatchTrace` fails**, 15 steps |
| `shared-name.cfg` | same, `LateWrites`, `SharedName` | 6,444 before the error | **`CompletedByCurrentLease` fails**, 11 steps |
| `liveness.cfg` | 1 key, 3 visualizations, 2 workers, 1 crash | 1,843,781 | **`JobsEnd` and `VisualizationsSettle` hold** |
| `liveness-late.cfg` | same, `LateWrites` | 5,936,859 | **Both hold**: a stale worker still ends, and so does its job |

### Finding: a late upload overwrites the chunks of a completed trace

TLC's shortest counterexample:

1. `v1` is created; `p1` claims its job, marks it building, then tracing, and its sandbox finishes.
2. The lease expires by the rescuer's clock, but not yet by `p1`'s. The rescuer requeues the job.
3. `p2` claims it (attempt 2), runs it, and uploads its chunks.
4. `p1`'s upload lands on the same keys: `t7/{traceId}/chunk-NNNN.json.gz` depend only on the trace.
5. `p2` completes. The row holds `p2`'s `sha256` and sizes; the bucket holds `p1`'s bytes.

The player checks each chunk's `sha256`, so the trace fails to load. And because the trace is the cache entry for its program and input (§7.12), every later request for the same code gets the broken trace until it expires, 7 days later. A completed trace is never re-run.

The database side is safe in the same run (`late-writes.cfg`): `p1`'s `Complete` fails its lease check. Only the object writes escape the fence. With perfect clocks and a PUT that can't land after its context ends, the model finds nothing (`safety.cfg`). So today this needs both of:

- `p1`'s write landing after its lease expired: a worker clock behind the rescuer's, or a PUT that SeaweedFS commits after the client gave up;
- a whole second run, claim to upload, finishing before that late write lands.

That is unlikely with NTP and a 45 s lease, but it doesn't need a bug anywhere else, and its damage lasts a week.

**Fix, not made here:** put the run into the object key, e.g. `t7/{traceId}/{jobId}-{attempt}/chunk-NNNN.json.gz`, and store that prefix with the chunks in `Complete`, under the lease check. A stale run then writes to keys no row points to. The retention cleanup builds its keys from the stored prefix, so it follows; a stale run's objects stay as orphans, which §7.8 already allows. It changes the object layout of §7.5, so it needs a spec change first.

### Finding: unique worker names are what keeps a stale run out

With `SharedName`, `p1` stalls past its lease, the rescuer requeues the job, and `p2` claims it under the same `leased_by`. `p1`'s `Complete` then passes the lease check and commits `p1`'s run while `p2` is still running. `workerName` adds 4 random bytes to the hostname, which is exactly what this needs; the model shows it must stay.

### Not modeled

- The change poller and long-polls. A parked request re-reads its row when its wait runs out, so a missed wake-up is late, never wrong (§7.13.3).
- Quotas, idempotency keys and the queue cap: one row lock each, no interaction with leases.
- Retention: expiry, the nightly cleanup and the reset of an expired trace.
- Deadlocks. `Create` can lock two trace rows (its own, then the bumped one) in either order across two transactions; MySQL then aborts one with 1213 and `InTx` retries it.

## How to rerun

```bash
cd plans/spikes/tla
curl -LO https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar
java -XX:+UseParallelGC -cp tla2tools.jar tlc2.TLC -workers auto -config safety.cfg MC.tla
```

Swap in each `.cfg` above. `safety.cfg` takes about 2 minutes on an M5 with 8 workers, `late-writes.cfg` 8 minutes, `liveness.cfg` 7 minutes and `liveness-late.cfg` 28 minutes.
