-- name: InsertJob :exec
INSERT INTO jobs (trace_id, priority, run_after, created_at, updated_at)
VALUES (sqlc.arg(trace_id), sqlc.arg(priority), sqlc.arg(now), sqlc.arg(now), sqlc.arg(now));

-- name: NextJob :one
SELECT id, trace_id, attempt FROM jobs FORCE INDEX (claim_idx)
WHERE queue = 'default' AND status = 'queued' AND run_after <= sqlc.arg(now)
ORDER BY priority DESC, run_after, id
LIMIT 1
FOR UPDATE SKIP LOCKED;

-- name: LeaseJob :exec
UPDATE jobs
SET status = 'running', attempt = attempt + 1, leased_by = sqlc.arg(leased_by), leased_until = sqlc.arg(leased_until), updated_at = sqlc.arg(now)
WHERE id = sqlc.arg(id);

-- name: LockLeasedJob :one
SELECT attempt FROM jobs
WHERE id = sqlc.arg(id) AND leased_by = sqlc.arg(leased_by) AND status = 'running'
FOR UPDATE;

-- name: LeaseHeld :one
SELECT EXISTS (
  SELECT 1 FROM jobs WHERE id = sqlc.arg(id) AND leased_by = sqlc.arg(leased_by) AND status = 'running'
);

-- name: ExpiredLeases :many
SELECT id, trace_id FROM jobs WHERE status = 'running' AND leased_until < sqlc.arg(now);

-- name: LockExpiredJob :one
SELECT attempt FROM jobs
WHERE id = sqlc.arg(id) AND status = 'running' AND leased_until < sqlc.arg(now)
FOR UPDATE;

-- name: SetJobStatus :exec
UPDATE jobs SET status = sqlc.arg(status), updated_at = sqlc.arg(now) WHERE id = sqlc.arg(id);

-- name: RequeueJob :exec
UPDATE jobs SET status = 'queued', run_after = sqlc.arg(now), updated_at = sqlc.arg(now) WHERE id = sqlc.arg(id);

-- name: CancelQueuedJob :execrows
UPDATE jobs SET status = 'canceled', updated_at = sqlc.arg(now)
WHERE trace_id = sqlc.arg(trace_id) AND status = 'queued';

-- name: DeleteFinishedJobs :execrows
DELETE FROM jobs
WHERE status IN ('done', 'failed', 'canceled') AND updated_at < sqlc.arg(before)
LIMIT 1000;

-- name: CountQueuedJobs :one
SELECT COUNT(*) FROM jobs WHERE queue = 'default' AND status = 'queued';

-- name: DeleteJobsOfTraces :exec
DELETE FROM jobs WHERE trace_id IN (sqlc.slice(trace_ids));
