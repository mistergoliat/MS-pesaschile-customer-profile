-- CP-R1-T11G: operational run log for externally scheduled/manual RFM snapshot execution.
-- Additive only. Persists run outcomes and supports operational traceability.

CREATE TABLE customer_rfm_snapshot_run (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  trigger_source ENUM('manual', 'scheduled') NOT NULL,
  status ENUM('started', 'succeeded', 'failed', 'skipped') NOT NULL,
  reference_time DATETIME(6) NOT NULL,
  calculation_version VARCHAR(100) NOT NULL,
  segment_version VARCHAR(100) NOT NULL,
  snapshot_key VARCHAR(512) NOT NULL,
  skip_reason VARCHAR(100) NULL,
  started_at DATETIME(6) NOT NULL,
  completed_at DATETIME(6) NULL,
  snapshot_id BIGINT UNSIGNED NULL,
  error_type VARCHAR(191) NULL,
  error_code VARCHAR(100) NULL,
  summary_json JSON NULL,
  PRIMARY KEY (id),
  KEY idx_customer_rfm_snapshot_run_status_started (status, started_at),
  KEY idx_customer_rfm_snapshot_run_reference_time (reference_time),
  KEY idx_customer_rfm_snapshot_run_snapshot_key (snapshot_key),
  KEY idx_customer_rfm_snapshot_run_snapshot_id (snapshot_id),
  CONSTRAINT fk_customer_rfm_snapshot_run_snapshot
    FOREIGN KEY (snapshot_id)
    REFERENCES customer_rfm_snapshot (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
