-- CP-R2-T02 rollback for the clustering snapshot run log.
-- TARGET: same local MariaDB schema as migration 006. DO NOT APPLY TO PRESTASHOP RDS.

DROP TABLE IF EXISTS customer_cluster_snapshot_run;
