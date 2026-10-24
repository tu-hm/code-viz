-- +goose Up
ALTER TABLE visualizations ADD COLUMN share_id VARCHAR(40) NULL, ALGORITHM=INSTANT;

-- +goose Down
ALTER TABLE visualizations DROP COLUMN share_id, ALGORITHM=INSTANT;
