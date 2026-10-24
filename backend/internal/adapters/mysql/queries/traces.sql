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

-- name: InsertTrace :execrows
INSERT INTO traces (id, cache_key, language, source, stdin, options, updated_at, expires_at)
VALUES (sqlc.arg(id), sqlc.arg(cache_key), sqlc.arg(language), sqlc.arg(source), sqlc.arg(stdin), sqlc.arg(options), sqlc.arg(now), sqlc.arg(expires_at))
ON DUPLICATE KEY UPDATE id = id;

-- name: LockTraceByCacheKey :one
SELECT id, status, failure_kind, expires_at FROM traces WHERE cache_key = sqlc.arg(cache_key) FOR UPDATE;

-- name: ResetTrace :exec
UPDATE traces
SET status = 'queued', version = version + 1, progress_steps = 0, header = NULL, chunks = NULL, chunk_count = 0,
  storage_prefix = '', exit_kind = '', build = NULL, failure_stage = '', failure_kind = '',
  updated_at = sqlc.arg(now), expires_at = sqlc.arg(expires_at)
WHERE id = sqlc.arg(id);

-- name: LockExpiredTraces :many
SELECT id, storage_prefix, chunk_count FROM traces
WHERE expires_at < sqlc.arg(now)
ORDER BY expires_at
LIMIT 1000
FOR UPDATE;

-- name: DeleteTraces :exec
DELETE FROM traces WHERE id IN (sqlc.slice(ids));
