-- +goose Up
CREATE TABLE visualizations (
  id         VARCHAR(40)  NOT NULL,
  trace_id   VARCHAR(40)  NOT NULL,
  subject    VARCHAR(255) NOT NULL,
  shared     BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at DATETIME(6)  NOT NULL,
  expires_at DATETIME(6)  NOT NULL,
  PRIMARY KEY (id),
  KEY trace_idx (trace_id),
  CONSTRAINT visualizations_trace_fk FOREIGN KEY (trace_id) REFERENCES traces (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- +goose Down
DROP TABLE visualizations;
