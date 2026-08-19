-- CP-R2-T02: service-owned behavioral clustering persistence.
-- Additive only. No FK to master_customer or ps_customer (same reasoning as migration 002 —
-- Customer Profile owns this data independently of CRM and does not enforce referential
-- integrity against PrestaShop in its own DB).
--
-- TARGET: Customer Profile's own local MariaDB instance (the same physical instance/schema
-- that already hosts customer_rfm_snapshot* — see infrastructure note below).
-- DO NOT APPLY TO PRESTASHOP RDS. PrestaShop RDS is READ ONLY, always (see
-- docs/audits/CP-R2-behavioral-clustering-readiness-feature-audit.md Step 5 / task Section 5).
--
-- INFRASTRUCTURE NOTE (documented per task Section 10/33): the readiness audit proposed a new,
-- dedicated schema for clustering (`customer_analytics` or `customer_clustering`) so future
-- capabilities are not tied exclusively to RFM's schema. That remains the right target
-- long-term. However, the only currently-provisioned local MariaDB credential
-- (`customer_profile_rfm_writer`) has DDL/DML privileges scoped to the `rfm_snapshot` schema
-- only (`SHOW GRANTS`: SELECT/INSERT/UPDATE/DELETE/CREATE/DROP/REFERENCES/INDEX/ALTER ON
-- `rfm_snapshot`.*, USAGE only on `*.*` — no CREATE DATABASE privilege). Rather than block T02
-- on provisioning new infrastructure, these tables are created in the same physical
-- `rfm_snapshot` schema RFM already uses, clearly namespaced under the `customer_cluster_*`
-- prefix (not `customer_rfm_*`) so the two capabilities stay logically separate even though
-- they currently share a schema. This is an infrastructure-driven compromise, not a design
-- preference — no RFM table was modified, and CLUSTER_DB_* is configured as an independent
-- credential family in code (src/config.ts) so pointing at a dedicated schema later is a
-- one-line config change, not a code change.

CREATE TABLE customer_cluster_model (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  model_version VARCHAR(100) NOT NULL,
  algorithm VARCHAR(32) NOT NULL,
  k TINYINT UNSIGNED NOT NULL,
  training_seed INT UNSIGNED NOT NULL,
  feature_version VARCHAR(100) NOT NULL,
  preprocessing_version VARCHAR(100) NOT NULL,
  population_policy_version VARCHAR(100) NOT NULL,
  operational_exclusion_policy_version VARCHAR(100) NOT NULL,
  shop_scope VARCHAR(64) NOT NULL,
  training_reference_time DATETIME(6) NOT NULL,
  training_population_size INT UNSIGNED NOT NULL,
  training_dataset_checksum CHAR(64) NOT NULL,
  artifact_json JSON NOT NULL,
  artifact_checksum CHAR(64) NOT NULL,
  hyperparameters_json JSON NOT NULL,
  metrics_json JSON NOT NULL,
  temporal_stability_status ENUM('not_yet_validated', 'preliminary', 'validated') NOT NULL DEFAULT 'not_yet_validated',
  status ENUM('building', 'validated', 'published', 'failed', 'superseded') NOT NULL,
  trained_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_cluster_model_version (model_version),
  KEY idx_customer_cluster_model_status (status),
  KEY idx_customer_cluster_model_feature_version (feature_version, preprocessing_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_cluster_snapshot (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_key VARCHAR(512) NOT NULL,
  model_id BIGINT UNSIGNED NOT NULL,
  status ENUM('building', 'validated', 'published', 'failed', 'superseded') NOT NULL,
  reference_time DATETIME(6) NOT NULL,
  population_policy_version VARCHAR(100) NOT NULL,
  population_size INT UNSIGNED NOT NULL,
  dataset_checksum CHAR(64) NOT NULL,
  assignment_checksum CHAR(64) NOT NULL,
  generated_at DATETIME(6) NOT NULL,
  validated_at DATETIME(6) NULL,
  published_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_cluster_snapshot_key (snapshot_key),
  KEY idx_customer_cluster_snapshot_status_reference (status, reference_time),
  KEY idx_customer_cluster_snapshot_model (model_id, status),
  KEY idx_customer_cluster_snapshot_published_at (published_at),
  CONSTRAINT fk_customer_cluster_snapshot_model
    FOREIGN KEY (model_id)
    REFERENCES customer_cluster_model (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_cluster_snapshot_row (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  prestashop_customer_id INT UNSIGNED NOT NULL,
  cluster_id TINYINT UNSIGNED NOT NULL,
  -- K-Means produces a distance, not a membership probability (task Section 22) — never
  -- store a fabricated "confidence" here.
  distance_to_centroid DECIMAL(20,10) NOT NULL,
  assigned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_cluster_snapshot_row_customer (snapshot_id, prestashop_customer_id),
  KEY idx_customer_cluster_snapshot_row_snapshot_cluster (snapshot_id, cluster_id),
  KEY idx_customer_cluster_snapshot_row_prestashop_customer (prestashop_customer_id),
  CONSTRAINT fk_customer_cluster_snapshot_row_snapshot
    FOREIGN KEY (snapshot_id)
    REFERENCES customer_cluster_snapshot (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_cluster_interpretation (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  model_id BIGINT UNSIGNED NOT NULL,
  cluster_id TINYINT UNSIGNED NOT NULL,
  interpretation_version VARCHAR(100) NOT NULL,
  label VARCHAR(100) NOT NULL,
  description VARCHAR(512) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_cluster_interpretation (model_id, cluster_id, interpretation_version),
  CONSTRAINT fk_customer_cluster_interpretation_model
    FOREIGN KEY (model_id)
    REFERENCES customer_cluster_model (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
