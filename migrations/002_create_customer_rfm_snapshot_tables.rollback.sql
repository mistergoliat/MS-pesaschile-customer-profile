-- CP-R1-T11A rollback for service-owned RFM snapshot tables.
-- Destructive for generated snapshots. Export snapshots first if any were published.

DROP TABLE IF EXISTS customer_rfm_snapshot_row;
DROP TABLE IF EXISTS customer_rfm_snapshot;
