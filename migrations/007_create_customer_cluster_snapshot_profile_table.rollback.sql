-- CP-R2-T03 rollback for the clustering snapshot profile table.
-- TARGET: same local MariaDB schema as migration 007. DO NOT APPLY TO PRESTASHOP RDS.

DROP TABLE IF EXISTS customer_cluster_snapshot_profile;
