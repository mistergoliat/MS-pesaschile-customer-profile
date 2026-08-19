-- CP-R2-T02 rollback for service-owned clustering tables.
-- Destructive for generated model/snapshot data. Export first if anything was published.
-- TARGET: same local MariaDB schema as 005_create_customer_cluster_tables.sql. DO NOT APPLY
-- TO PRESTASHOP RDS.

DROP TABLE IF EXISTS customer_cluster_interpretation;
DROP TABLE IF EXISTS customer_cluster_snapshot_row;
DROP TABLE IF EXISTS customer_cluster_snapshot;
DROP TABLE IF EXISTS customer_cluster_model;
