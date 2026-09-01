-- CUSTOMER-INTELLIGENCE-A01.5: immutable Customer Commercial Affinity snapshots.
-- Target: local Customer Profile analytics MariaDB only. Never apply to PrestaShop.
-- supportingSpend follows the repository's DECIMAL(20,6) CLP convention. Scores and
-- explicit-evidence coverage use fixed-point DECIMAL(12,9), never FLOAT/DOUBLE.

CREATE TABLE customer_commercial_affinity_snapshot (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_key VARCHAR(512) NOT NULL,
  status ENUM('building', 'validated', 'published', 'failed', 'superseded') NOT NULL,
  calculation_version VARCHAR(191) NOT NULL,
  reference_time DATETIME(6) NOT NULL,
  generated_at DATETIME(6) NOT NULL,
  population_policy_version VARCHAR(191) NOT NULL,
  order_eligibility_policy_version VARCHAR(191) NOT NULL,
  product_semantic_snapshot_id VARCHAR(255) NOT NULL,
  product_semantic_schema_version VARCHAR(64) NOT NULL,
  ontology_version VARCHAR(191) NOT NULL,
  ontology_hash CHAR(64) NOT NULL,
  source_semantic_checksum CHAR(64) NOT NULL,
  consumer_semantic_checksum CHAR(64) NOT NULL,
  source_customer_count INT UNSIGNED NOT NULL,
  eligible_customer_count INT UNSIGNED NOT NULL,
  eligible_order_count INT UNSIGNED NOT NULL,
  eligible_order_line_count INT UNSIGNED NOT NULL,
  customers_with_affinity INT UNSIGNED NOT NULL,
  customers_without_affinity INT UNSIGNED NOT NULL,
  affinity_row_count INT UNSIGNED NOT NULL,
  dataset_checksum CHAR(64) NOT NULL,
  affinity_dataset_checksum CHAR(64) NOT NULL,
  identity_authority VARCHAR(64) NOT NULL,
  source_watermark_order_id BIGINT UNSIGNED NULL,
  performance_metadata_json JSON NULL,
  manifest_json JSON NOT NULL,
  failure_reason VARCHAR(500) NULL,
  validated_at DATETIME(6) NULL,
  published_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_commercial_affinity_snapshot_key (snapshot_key),
  KEY idx_customer_commercial_affinity_snapshot_status_reference (status, reference_time, id),
  KEY idx_customer_commercial_affinity_snapshot_published (status, published_at, id),
  CONSTRAINT chk_customer_commercial_affinity_snapshot_counts CHECK (
    eligible_customer_count <= source_customer_count
    AND customers_with_affinity + customers_without_affinity = eligible_customer_count
    AND affinity_row_count >= customers_with_affinity
  ),
  CONSTRAINT chk_customer_commercial_affinity_snapshot_identity CHECK (identity_authority = 'prestashop_customer')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_commercial_affinity_snapshot_row (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  affinity_axis VARCHAR(32) NOT NULL,
  affinity_code VARCHAR(191) NOT NULL,
  score DECIMAL(12,9) NOT NULL,
  supporting_order_count INT UNSIGNED NOT NULL,
  supporting_product_count INT UNSIGNED NOT NULL,
  supporting_spend DECIMAL(20,6) NOT NULL,
  last_evidence_at DATETIME(6) NOT NULL,
  explicit_evidence_coverage DECIMAL(12,9) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_commercial_affinity_snapshot_row_identity (snapshot_id, customer_id, affinity_axis, affinity_code),
  KEY idx_customer_commercial_affinity_snapshot_row_customer (snapshot_id, customer_id),
  KEY idx_customer_commercial_affinity_snapshot_row_axis_code (snapshot_id, affinity_axis, affinity_code),
  CONSTRAINT fk_customer_commercial_affinity_snapshot_row_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES customer_commercial_affinity_snapshot (id) ON DELETE CASCADE,
  CONSTRAINT chk_customer_commercial_affinity_snapshot_row_customer CHECK (customer_id > 0),
  CONSTRAINT chk_customer_commercial_affinity_snapshot_row_axis CHECK (affinity_axis IN ('PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT')),
  CONSTRAINT chk_customer_commercial_affinity_snapshot_row_code CHECK (CHAR_LENGTH(TRIM(affinity_code)) > 0),
  CONSTRAINT chk_customer_commercial_affinity_snapshot_row_score CHECK (score >= 0 AND score <= 1),
  CONSTRAINT chk_customer_commercial_affinity_snapshot_row_order_count CHECK (supporting_order_count >= 1),
  CONSTRAINT chk_customer_commercial_affinity_snapshot_row_product_count CHECK (supporting_product_count >= 1),
  CONSTRAINT chk_customer_commercial_affinity_snapshot_row_spend CHECK (supporting_spend >= 0),
  CONSTRAINT chk_customer_commercial_affinity_snapshot_row_coverage CHECK (
    explicit_evidence_coverage IS NULL OR (explicit_evidence_coverage >= 0 AND explicit_evidence_coverage <= 1)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
