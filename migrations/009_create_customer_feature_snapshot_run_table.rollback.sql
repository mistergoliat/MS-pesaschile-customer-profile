-- Rollback for 009_create_customer_feature_snapshot_run_table.sql
-- TARGET: same local MariaDB schema as the forward migration. DO NOT APPLY TO PRESTASHOP RDS.

DROP TABLE IF EXISTS customer_feature_snapshot_run;
