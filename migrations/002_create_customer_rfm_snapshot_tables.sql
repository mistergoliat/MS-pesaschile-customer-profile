-- CP-R1-T11A: service-owned RFM snapshot tables.
-- Additive only. No FK to master_customer: T11A uses provisional PrestaShop identity.

CREATE TABLE customer_rfm_snapshot (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_key VARCHAR(512) NOT NULL,
  status ENUM('building', 'validated', 'published', 'failed', 'superseded') NOT NULL,
  reference_time DATETIME(6) NOT NULL,
  window_start DATETIME(6) NOT NULL,
  window_end DATETIME(6) NOT NULL,
  calculation_version VARCHAR(100) NOT NULL,
  identity_authority VARCHAR(64) NOT NULL,
  identity_authority_version VARCHAR(100) NOT NULL,
  population_policy_version VARCHAR(100) NOT NULL,
  monetary_policy_version VARCHAR(100) NOT NULL,
  refund_policy_version VARCHAR(100) NOT NULL,
  scoring_policy_version VARCHAR(191) NOT NULL,
  currency_code CHAR(3) NOT NULL,
  population_size INT UNSIGNED NOT NULL,
  valid_order_count INT UNSIGNED NOT NULL,
  gross_order_value_tax_incl DECIMAL(20,6) NOT NULL,
  manifest_json JSON NOT NULL,
  dataset_checksum CHAR(64) NOT NULL,
  generated_at DATETIME(6) NOT NULL,
  published_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_rfm_snapshot_key (snapshot_key),
  KEY idx_customer_rfm_snapshot_status_reference (status, reference_time),
  KEY idx_customer_rfm_snapshot_version_reference (calculation_version, reference_time),
  KEY idx_customer_rfm_snapshot_publication_stream (
    status,
    identity_authority,
    identity_authority_version,
    population_policy_version,
    monetary_policy_version,
    refund_policy_version,
    scoring_policy_version,
    calculation_version
  ),
  KEY idx_customer_rfm_snapshot_published_at (published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_rfm_snapshot_row (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  prestashop_customer_id INT UNSIGNED NOT NULL,
  master_customer_id BIGINT UNSIGNED NULL,
  identity_resolution_status ENUM('provisional') NOT NULL,
  first_valid_order_at DATETIME(6) NOT NULL,
  last_valid_order_at DATETIME(6) NOT NULL,
  recency_days INT UNSIGNED NOT NULL,
  frequency_orders INT UNSIGNED NOT NULL,
  gross_order_value_tax_incl DECIMAL(20,6) NOT NULL,
  average_order_value_tax_incl DECIMAL(20,6) NOT NULL,
  distinct_shop_count INT UNSIGNED NOT NULL,
  recency_score TINYINT UNSIGNED NOT NULL,
  frequency_score TINYINT UNSIGNED NOT NULL,
  monetary_score TINYINT UNSIGNED NOT NULL,
  rfm_code VARCHAR(8) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_rfm_snapshot_row_customer (snapshot_id, prestashop_customer_id),
  KEY idx_customer_rfm_snapshot_row_snapshot_scores (
    snapshot_id,
    recency_score,
    frequency_score,
    monetary_score
  ),
  KEY idx_customer_rfm_snapshot_row_snapshot_rfm_code (snapshot_id, rfm_code),
  KEY idx_customer_rfm_snapshot_row_prestashop_customer (prestashop_customer_id),
  CONSTRAINT fk_customer_rfm_snapshot_row_snapshot
    FOREIGN KEY (snapshot_id)
    REFERENCES customer_rfm_snapshot (id)
    ON DELETE CASCADE,
  CONSTRAINT chk_customer_rfm_snapshot_row_recency_score CHECK (recency_score BETWEEN 1 AND 5),
  CONSTRAINT chk_customer_rfm_snapshot_row_frequency_score CHECK (frequency_score BETWEEN 1 AND 5),
  CONSTRAINT chk_customer_rfm_snapshot_row_monetary_score CHECK (monetary_score BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
