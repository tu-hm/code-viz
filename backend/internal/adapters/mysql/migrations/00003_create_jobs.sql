-- +goose Up
CREATE TABLE jobs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  trace_id     VARCHAR(40)  NOT NULL,
  queue        VARCHAR(32)  NOT NULL DEFAULT 'default',
  status       ENUM('queued','running','done','failed','canceled') NOT NULL DEFAULT 'queued',
  priority     TINYINT      NOT NULL DEFAULT 0,
  attempt      TINYINT      NOT NULL DEFAULT 0,
  run_after    DATETIME(6)  NOT NULL,
  leased_by    VARCHAR(64)  NULL,
  leased_until DATETIME(6)  NULL,
  created_at   DATETIME(6)  NOT NULL,
  updated_at   DATETIME(6)  NOT NULL,
  PRIMARY KEY (id),
  -- DESC matches claim ORDER BY; ASC => filesort, claim locks every queued row
  KEY claim_idx (queue, status, priority DESC, run_after, id),
  KEY lease_idx (status, leased_until),
  KEY trace_idx (trace_id),
  CONSTRAINT jobs_trace_fk FOREIGN KEY (trace_id) REFERENCES traces (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- +goose Down
DROP TABLE jobs;
