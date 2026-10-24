-- +goose Up
ALTER TABLE traces ADD KEY expires_at_idx (expires_at), ALGORITHM=INPLACE, LOCK=NONE;

-- +goose Down
ALTER TABLE traces DROP INDEX expires_at_idx, ALGORITHM=INPLACE, LOCK=NONE;
