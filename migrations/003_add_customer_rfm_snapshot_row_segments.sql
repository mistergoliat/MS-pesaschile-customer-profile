-- CP-R1-T11E: materialized deterministic commercial segmentation for RFM rows.
-- Additive only. Historical rows remain readable with NULL segment fields.

ALTER TABLE customer_rfm_snapshot_row
  ADD COLUMN segment_code VARCHAR(64) NULL AFTER rfm_code,
  ADD COLUMN segment_version VARCHAR(100) NULL AFTER segment_code,
  ADD KEY idx_customer_rfm_snapshot_row_snapshot_segment (snapshot_id, segment_code);
