-- name: RepeatedVisualization :one
SELECT id FROM visualizations
WHERE subject = sqlc.arg(subject) AND idempotency_key = sqlc.arg(idempotency_key) AND created_at > sqlc.arg(after);

-- name: ActiveVisualizations :many
SELECT v.id, v.trace_id, t.status FROM visualizations v
JOIN traces t ON t.id = v.trace_id
WHERE v.subject = sqlc.arg(subject) AND v.detached = FALSE AND t.status IN ('queued', 'building', 'tracing')
ORDER BY v.created_at, v.id;

-- name: ReleaseIdempotencyKey :exec
UPDATE visualizations SET idempotency_key = NULL
WHERE subject = sqlc.arg(subject) AND idempotency_key = sqlc.arg(idempotency_key) AND created_at <= sqlc.arg(before);

-- name: InsertVisualization :exec
INSERT INTO visualizations (id, trace_id, subject, idempotency_key, created_at, expires_at)
VALUES (sqlc.arg(id), sqlc.arg(trace_id), sqlc.arg(subject), sqlc.arg(idempotency_key), sqlc.arg(now), sqlc.arg(expires_at));

-- name: OwnedVisualizationTrace :one
SELECT trace_id FROM visualizations WHERE id = sqlc.arg(id) AND subject = sqlc.arg(subject) AND shared = FALSE;

-- name: DetachVisualization :exec
UPDATE visualizations SET detached = TRUE WHERE id = sqlc.arg(id);

-- name: CountWaiting :one
SELECT COUNT(*) FROM visualizations WHERE trace_id = sqlc.arg(trace_id) AND detached = FALSE;

-- name: ReadVisualization :one
SELECT v.id, v.trace_id, v.subject, v.shared, v.share_id, v.detached, v.created_at, v.expires_at,
  t.language, t.status, t.version, t.progress_steps, t.build, t.failure_stage, t.failure_kind,
  t.header, t.chunks, t.tail, t.storage_prefix
FROM visualizations v
JOIN traces t ON t.id = v.trace_id
WHERE v.id = sqlc.arg(id);

-- name: DeleteExpiredVisualizations :execrows
DELETE FROM visualizations WHERE expires_at < sqlc.arg(now) LIMIT 1000;

-- name: LockShareID :one
SELECT share_id, expires_at FROM visualizations WHERE id = sqlc.arg(id) FOR UPDATE;

-- name: LockOwnedShareID :one
SELECT share_id FROM visualizations WHERE id = sqlc.arg(id) AND subject = sqlc.arg(subject) AND shared = FALSE FOR UPDATE;

-- name: InsertShareLink :exec
INSERT INTO visualizations (id, trace_id, subject, shared, created_at, expires_at)
VALUES (sqlc.arg(id), sqlc.arg(trace_id), sqlc.arg(subject), TRUE, sqlc.arg(now), sqlc.arg(expires_at));

-- name: SetShareID :exec
UPDATE visualizations SET share_id = sqlc.arg(share_id), expires_at = sqlc.arg(expires_at) WHERE id = sqlc.arg(id);

-- name: ClearShareID :exec
UPDATE visualizations SET share_id = NULL WHERE id = sqlc.arg(id);

-- name: DeleteVisualization :exec
DELETE FROM visualizations WHERE id = sqlc.arg(id);
