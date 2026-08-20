-- CP-R3-T01: operational run log for manual customer-feature-snapshot publication, mirroring
-- customer_cluster_snapshot_run (migration 006) / customer_rfm_snapshot_run (migration 004).
-- Additive only. TARGET: same local MariaDB schema as migration 008. DO NOT APPLY TO
-- PRESTASHOP RDS.

CREATE TABLE customer_feature_snapshot_run (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  trigger_source ENUM('manual') NOT NULL,
  status ENUM('started', 'succeeded', 'failed', 'skipped') NOT NULL,
  reference_time DATETIME(6) NOT NULL,
  feature_version VARCHAR(100) NOT NULL,
  snapshot_key VARCHAR(512) NOT NULL,
  skip_reason VARCHAR(100) NULL,
  started_at DATETIME(6) NOT NULL,
  completed_at DATETIME(6) NULL,
  snapshot_id BIGINT UNSIGNED NULL,
  error_type VARCHAR(191) NULL,
  error_code VARCHAR(100) NULL,
  summary_json JSON NULL,
  PRIMARY KEY (id),
  KEY idx_customer_feature_snapshot_run_status_started (status, started_at),
  KEY idx_customer_feature_snapshot_run_reference_time (reference_time),
  KEY idx_customer_feature_snapshot_run_snapshot_key (snapshot_key),
  KEY idx_customer_feature_snapshot_run_snapshot_id (snapshot_id),
  CONSTRAINT fk_customer_feature_snapshot_run_snapshot
    FOREIGN KEY (snapshot_id)
    REFERENCES customer_feature_snapshot (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
