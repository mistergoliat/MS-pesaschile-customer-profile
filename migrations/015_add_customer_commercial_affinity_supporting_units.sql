-- CUSTOMER-INTELLIGENCE-AFFINITY-A01.2: purchased-unit evidence quantity.
-- Additive migration: legacy rows remain readable with NULL; all new snapshot rows
-- are required by application validation to carry a positive supporting_units value.

ALTER TABLE customer_commercial_affinity_snapshot_row
  ADD COLUMN supporting_units BIGINT UNSIGNED NULL AFTER supporting_product_count,
  ADD CONSTRAINT chk_customer_commercial_affinity_snapshot_row_supporting_units
    CHECK (supporting_units IS NULL OR supporting_units >= 1);
