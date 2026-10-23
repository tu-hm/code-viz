-- +goose Up
CREATE TABLE usage_daily (
  subject VARCHAR(255) NOT NULL,
  day     DATE         NOT NULL,
  count   INT          NOT NULL,
  PRIMARY KEY (subject, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- +goose Down
DROP TABLE usage_daily;
