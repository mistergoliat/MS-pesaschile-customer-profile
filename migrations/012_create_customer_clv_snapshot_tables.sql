-- CUSTOMER-INTELLIGENCE-CLV-A06: production CLV snapshot persistence.
-- Target: Customer Profile local analytics MariaDB only. Never apply to PrestaShop RDS.
-- Revenue uses DECIMAL(20,6), matching existing analytical monetary storage and leaving
-- headroom above the observed CLP CLV range without introducing floating-point loss.

CREATE TABLE customer_clv_snapshot (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_key VARCHAR(512) NOT NULL,
  status ENUM('building', 'validated', 'published', 'failed', 'superseded') NOT NULL,
  reference_time DATETIME(6) NOT NULL,
  generated_at DATETIME(6) NOT NULL,
  model_version VARCHAR(191) NOT NULL,
  estimator_policy_version VARCHAR(191) NOT NULL,
  horizon_months TINYINT UNSIGNED NOT NULL,
  currency_iso_code CHAR(3) NOT NULL,
  population_policy_version VARCHAR(191) NOT NULL,
  monetary_policy_version VARCHAR(191) NOT NULL,
  dataset_version VARCHAR(191) NOT NULL,
  activity_model_version VARCHAR(191) NOT NULL,
  activity_training_window_policy VARCHAR(191) NOT NULL,
  activity_recalibration_version VARCHAR(191) NOT NULL,
  stale_adjustment_policy_version VARCHAR(191) NOT NULL,
  conditional_value_policy_version VARCHAR(191) NOT NULL,
  rank_refinement_policy_version VARCHAR(191) NOT NULL,
  estimate_support_policy_version VARCHAR(191) NOT NULL,
  training_time_policy_version VARCHAR(191) NOT NULL,
  identity_authority VARCHAR(64) NOT NULL,
  population_size INT UNSIGNED NOT NULL,
  source_available_data_through DATETIME(6) NOT NULL,
  model_checksum CHAR(64) NOT NULL,
  input_checksum CHAR(64) NOT NULL,
  output_checksum CHAR(64) NOT NULL,
  accepted_validation_decision VARCHAR(191) NOT NULL,
  accepted_validation_artifact_version VARCHAR(191) NOT NULL,
  accepted_validation_artifact_checksum CHAR(64) NOT NULL,
  manifest_json JSON NOT NULL,
  validated_at DATETIME(6) NULL,
  published_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_clv_snapshot_key (snapshot_key),
  KEY idx_customer_clv_snapshot_status_reference (status, reference_time),
  KEY idx_customer_clv_snapshot_stream (status, model_version, population_policy_version, monetary_policy_version),
  KEY idx_customer_clv_snapshot_published_at (published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_clv_snapshot_row (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  expected_revenue_tax_incl DECIMAL(20,6) NOT NULL,
  expected_orders DECIMAL(20,6) NULL,
  estimate_support_level ENUM('SPARSE', 'SUPPORTED') NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_clv_snapshot_row_customer (snapshot_id, customer_id),
  KEY idx_customer_clv_snapshot_row_customer (customer_id),
  CONSTRAINT fk_customer_clv_snapshot_row_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES customer_clv_snapshot (id) ON DELETE CASCADE,
  CONSTRAINT chk_customer_clv_snapshot_row_customer CHECK (customer_id > 0),
  CONSTRAINT chk_customer_clv_snapshot_row_revenue CHECK (expected_revenue_tax_incl >= 0),
  CONSTRAINT chk_customer_clv_snapshot_row_orders CHECK (expected_orders IS NULL OR expected_orders >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
