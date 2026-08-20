-- CP-R3-T01: Customer Analytics Data Layer Foundation — materialized, point-in-time customer
-- feature snapshots. Additive only. No FK to master_customer or ps_customer (same reasoning
-- as migrations 002/005 — Customer Profile owns this data independently of CRM and does not
-- enforce referential integrity against PrestaShop in its own DB).
--
-- TARGET: Customer Profile's own local MariaDB instance (the same physical instance/schema
-- that already hosts customer_rfm_snapshot*/customer_cluster_* — see infrastructure note
-- below). DO NOT APPLY TO PRESTASHOP RDS. PrestaShop RDS is READ ONLY, always (task Section 5).
--
-- INFRASTRUCTURE NOTE (task Section 7, documented per the user's explicit instruction, not
-- silently inherited): this task's own instruction was to reuse the same local MariaDB
-- instance/schema RFM and clustering already run on in EC2 (no new CREATE DATABASE privilege
-- has been provisioned there either — see migrations/005_create_customer_cluster_tables.sql
-- for the identical constraint T02 hit). These tables are therefore created in the same
-- physical schema, clearly namespaced under the `customer_feature_*` prefix (never
-- `customer_rfm_*` or `customer_cluster_*`) so all three capabilities stay logically separate
-- even though they currently share a schema. ANALYTICS_DB_* is configured as a fully
-- independent credential family in code (src/config.ts) — it happens to point at the same
-- host/port/schema as CLUSTER_DB_*/RFM_SNAPSHOT_DB_* today, but pointing it at a dedicated
-- `customer_analytics` schema later is a one-line config change, not a code change. No
-- RFM/clustering table is touched by this migration.

CREATE TABLE customer_feature_snapshot (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_key VARCHAR(512) NOT NULL,
  status ENUM('building', 'validated', 'published', 'failed', 'superseded') NOT NULL,
  reference_time DATETIME(6) NOT NULL,
  feature_version VARCHAR(100) NOT NULL,
  population_policy_version VARCHAR(100) NOT NULL,
  operational_exclusion_policy_version VARCHAR(100) NOT NULL,
  shop_scope VARCHAR(64) NOT NULL,
  population_size INT UNSIGNED NOT NULL,
  -- Checksum over the RAW PrestaShop extraction, before any feature-derivation math runs —
  -- changes if PrestaShop's underlying rows change retroactively for this referenceTime, even
  -- if derivation formulas stay identical (task Section 27/28: source drift detection).
  source_dataset_checksum CHAR(64) NOT NULL,
  -- Checksum over the final derived, canonical feature rows — what idempotency/re-run
  -- comparison uses (task Section 26).
  feature_dataset_checksum CHAR(64) NOT NULL,
  manifest_json JSON NOT NULL,
  generated_at DATETIME(6) NOT NULL,
  validated_at DATETIME(6) NULL,
  published_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_feature_snapshot_key (snapshot_key),
  KEY idx_customer_feature_snapshot_status_reference (status, reference_time),
  KEY idx_customer_feature_snapshot_feature_version (feature_version, population_policy_version),
  KEY idx_customer_feature_snapshot_published_at (published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_feature_snapshot_row (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  prestashop_customer_id INT UNSIGNED NOT NULL,
  valid_orders INT UNSIGNED NOT NULL,
  total_spent_tax_incl DECIMAL(20,6) NOT NULL,
  average_order_value_tax_incl DECIMAL(20,6) NOT NULL,
  first_order_at DATETIME(6) NOT NULL,
  last_order_at DATETIME(6) NOT NULL,
  days_since_last_order INT UNSIGNED NOT NULL,
  customer_tenure_days INT UNSIGNED NOT NULL,
  distinct_products INT UNSIGNED NOT NULL,
  repeat_product_rate DECIMAL(12,6) NOT NULL,
  top1_share DECIMAL(12,6) NOT NULL,
  top3_share DECIMAL(12,6) NOT NULL,
  effective_diversity DECIMAL(12,6) NOT NULL,
  average_units_per_order DECIMAL(12,6) NOT NULL,
  -- NULL when valid_orders < 2 (task Section 13) — a single-order customer has no purchase
  -- interval to measure. Never a synthetic 0.
  purchase_frequency_days DECIMAL(12,6) NULL,
  orders_365d INT UNSIGNED NOT NULL,
  cancelled_order_ratio DECIMAL(12,6) NOT NULL,
  discount_share DECIMAL(12,6) NOT NULL,
  shipping_share DECIMAL(12,6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_feature_snapshot_row_customer (snapshot_id, prestashop_customer_id),
  KEY idx_customer_feature_snapshot_row_prestashop_customer (prestashop_customer_id),
  CONSTRAINT fk_customer_feature_snapshot_row_snapshot
    FOREIGN KEY (snapshot_id)
    REFERENCES customer_feature_snapshot (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
