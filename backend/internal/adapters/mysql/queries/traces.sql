-- name: TraceInput :one
SELECT language, source, stdin, options FROM traces WHERE id = sqlc.arg(id);

-- name: LockTrace :one
SELECT status FROM traces WHERE id = sqlc.arg(id) FOR UPDATE;

-- name: SetTraceStatus :exec
UPDATE traces
SET status = sqlc.arg(status), version = version + 1, updated_at = sqlc.arg(now)
WHERE id = sqlc.arg(id);

-- name: SetTraceProgress :exec
UPDATE traces
SET progress_steps = sqlc.arg(progress_steps), version = version + 1, updated_at = sqlc.arg(now)
WHERE id = sqlc.arg(id);

-- name: RequeueTrace :exec
UPDATE traces
SET status = 'queued', progress_steps = 0, version = version + 1, updated_at = sqlc.arg(now)
WHERE id = sqlc.arg(id);

-- name: CompleteTrace :exec
UPDATE traces
SET status = 'completed', header = sqlc.arg(header), chunks = sqlc.arg(chunks), chunk_count = sqlc.arg(chunk_count),
  exit_kind = sqlc.arg(exit_kind), storage_prefix = sqlc.arg(storage_prefix), build = sqlc.arg(build),
  version = version + 1, updated_at = sqlc.arg(now)
WHERE id = sqlc.arg(id);

-- name: FailTrace :exec
UPDATE traces
SET status = 'failed', failure_stage = sqlc.arg(failure_stage), failure_kind = sqlc.arg(failure_kind), build = sqlc.arg(build),
  version = version + 1, updated_at = sqlc.arg(now)
WHERE id = sqlc.arg(id);
