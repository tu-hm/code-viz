-- +goose Up
CREATE TABLE traces (
  id             VARCHAR(40)  NOT NULL,
  cache_key      BINARY(32)   NOT NULL,
  language       VARCHAR(32)  NOT NULL,
  status         ENUM('queued','building','tracing','completed','failed','canceled') NOT NULL DEFAULT 'queued',
  version        BIGINT       NOT NULL DEFAULT 0,
  progress_steps INT          NOT NULL DEFAULT 0,
  source         MEDIUMTEXT   NOT NULL,
  stdin          MEDIUMTEXT   NOT NULL,
  options        JSON         NOT NULL,
  header         JSON         NULL,
  chunks         JSON         NULL,
  chunk_count    INT          NOT NULL DEFAULT 0,
  storage_prefix VARCHAR(8)   NOT NULL DEFAULT '',
  exit_kind      VARCHAR(32)  NOT NULL DEFAULT '',
  build          JSON         NULL,
  failure_stage  VARCHAR(16)  NOT NULL DEFAULT '',
  failure_kind   VARCHAR(32)  NOT NULL DEFAULT '',
  updated_at     DATETIME(6)  NOT NULL,
  expires_at     DATETIME(6)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY cache_key_idx (cache_key),
  KEY updated_at_idx (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- +goose Down
DROP TABLE traces;
