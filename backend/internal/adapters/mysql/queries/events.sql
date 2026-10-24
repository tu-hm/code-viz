-- name: ChangedTraces :many
SELECT id, version, updated_at FROM traces
WHERE updated_at >= sqlc.arg(since)
ORDER BY updated_at
LIMIT ?;
