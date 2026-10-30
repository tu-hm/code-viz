# Lease rules: what keeps a stale worker out

Decided 2026-10-24: built in `7c5d5f2` and `11a9345`, model-checked in `3307e37`.

**Decision:** The rules themselves are spec §7.13.2 and the MySQL section of AGENTS.md: a 45 s lease over a 30 s deadline, `leased_by = ?` on every worker write, zero rows means stop. Four choices in the code hold them up, and none is obvious from the rules:

1. A lease holds only while the job row matches its id, `leased_by` and `status = 'running'`, read under the trace lock and then the job lock (`Queue.leased` in `adapters/mysql/queue.go`). The status term matters because the rescuer requeues a job without clearing `leased_by`, so until the next claim a stale worker's name still matches.
2. `leased_by` is the hostname plus 4 random bytes, new for each process (`workerName` in `cmd/vizd`).
3. The worker's job context ends at claim + 45 s, the worker's own copy of the lease. Requeue and fail after that run under `context.WithoutCancel`, and still go through the lease check.
4. The watcher logs a lease check that errors and keeps the job running; only `ErrLeaseLost` cancels it. A database blip shouldn't kill a run, and point 3 caps how long a worker runs on a lease it can't confirm.

**Why:** The TLA+ spike ([report](../../plans/spikes/tla-job-queue.md)) checked every schedule of 2 workers, 3 visualizations and a crash. The database side holds all its invariants even when a worker's writes land after its lease ran out by the rescuer's clock. With one shared worker name, a stalled worker's `Complete` passes the lease check under its successor's lease in 11 steps; that's what point 2 prevents. Without the status term, a worker rescued but not yet replaced could complete a trace whose job is queued, and the next claim would run it again.

The same spike found what the lease doesn't cover: object writes. Chunk and tail keys depend only on the trace (`t7/{traceId}/chunk-NNNN.json.gz`), so a late upload from a rescued worker can land on top of its successor's chunks after the row completes. The player then rejects the chunks on `sha256`, and the broken trace is served from cache for 7 days. It needs a worker clock behind the rescuer's or a PUT that lands late, plus a whole second run finishing first. Not fixed: the fix changes §7.5.

**How to apply:**

- A new worker write to `jobs` or `traces` goes through `Queue.leased`, never a bare `UPDATE`.
- Keep the status term, the random suffix and the claim + 45 s deadline. A test pins only the status term (the "rescued after expiry" case of `TestWritesUnderALostLeaseReturnErrLeaseLostAndChangeNothing`). Dropping the suffix or the deadline passes `make test`; only the TLA model catches a shared name.
- The watcher's log-and-continue looks like an S3 slip. Leave it: cancelling on any check error kills runs on a database blip, and the deadline already bounds the risk.
- Treat object writes as unfenced. The proposed fix is to key a run's objects by job and attempt (`t7/{traceId}/{jobId}-{attempt}/…`) and store that prefix in `Complete` under the lease check; it needs a §7.5 spec change first. Until then, a new object the worker writes has the same gap.
- Allowing cancel of a running job (open in [STATUS.md](../../plans/tasks/STATUS.md)) works through the status term: `status = 'canceled'` makes the next check return `ErrLeaseLost`.
