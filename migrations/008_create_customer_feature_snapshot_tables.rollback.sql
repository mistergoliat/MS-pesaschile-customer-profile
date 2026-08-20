-- Rollback for 008_create_customer_feature_snapshot_tables.sql
-- TARGET: same local MariaDB schema as the forward migration. DO NOT APPLY TO PRESTASHOP RDS.

DROP TABLE IF EXISTS customer_feature_snapshot_row;
DROP TABLE IF EXISTS customer_feature_snapshot;
