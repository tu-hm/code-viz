-- +goose Up
CREATE TABLE feature_flags (
  name            VARCHAR(64)      NOT NULL,
  rollout_percent TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (name),
  CONSTRAINT rollout_percent_range CHECK (rollout_percent <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- +goose Down
DROP TABLE feature_flags;
