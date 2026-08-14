ALTER TABLE customer_rfm_snapshot_row
  DROP INDEX idx_customer_rfm_snapshot_row_snapshot_segment,
  DROP COLUMN segment_version,
  DROP COLUMN segment_code;
