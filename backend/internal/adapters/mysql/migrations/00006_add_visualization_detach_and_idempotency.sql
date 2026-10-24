-- +goose Up
ALTER TABLE visualizations
  ADD COLUMN detached BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN idempotency_key VARCHAR(64) NULL,
  ADD UNIQUE KEY idempotency_idx (subject, idempotency_key),
  ADD KEY subject_idx (subject, created_at),
  ADD KEY expires_at_idx (expires_at),
  ALGORITHM=INPLACE, LOCK=NONE;

-- +goose Down
ALTER TABLE visualizations
  DROP INDEX expires_at_idx,
  DROP INDEX subject_idx,
  DROP INDEX idempotency_idx,
  DROP COLUMN idempotency_key,
  DROP COLUMN detached,
  ALGORITHM=INPLACE, LOCK=NONE;
