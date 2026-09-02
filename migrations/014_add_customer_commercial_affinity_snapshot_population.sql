-- CUSTOMER-INTELLIGENCE-AFFINITY-A01.5.1: immutable eligible population membership.
-- Target: local Customer Profile analytics MariaDB only. Never apply to PrestaShop.
-- The checksum is nullable for legacy snapshots created before this migration; every
-- new audience-compatible snapshot must populate it and the membership table.

ALTER TABLE customer_commercial_affinity_snapshot
  ADD COLUMN eligible_population_checksum CHAR(64) NULL AFTER affinity_dataset_checksum;

CREATE TABLE customer_commercial_affinity_snapshot_population (
  snapshot_id BIGINT UNSIGNED NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (snapshot_id, customer_id),
  CONSTRAINT fk_customer_commercial_affinity_snapshot_population_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES customer_commercial_affinity_snapshot (id) ON DELETE CASCADE,
  CONSTRAINT chk_customer_commercial_affinity_snapshot_population_customer
    CHECK (customer_id > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
