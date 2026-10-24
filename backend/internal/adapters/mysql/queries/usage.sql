-- name: AddUsage :exec
INSERT INTO usage_daily (subject, day, count) VALUES (sqlc.arg(subject), sqlc.arg(day), 1)
ON DUPLICATE KEY UPDATE count = count + 1;

-- name: Usage :one
SELECT count FROM usage_daily WHERE subject = sqlc.arg(subject) AND day = sqlc.arg(day);
