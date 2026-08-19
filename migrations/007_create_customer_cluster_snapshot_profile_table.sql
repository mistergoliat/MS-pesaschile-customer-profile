-- CP-R2-T03: per-cluster, per-snapshot aggregate observability profile.
-- Additive only. No FK to master_customer or ps_customer (same reasoning as migration 005).
--
-- TARGET: Customer Profile's own local MariaDB instance, same physical `rfm_snapshot` schema
-- migration 005/006 already used for `customer_cluster_*` (see the infrastructure note there —
-- the only provisioned credential has DDL/DML privileges scoped to that schema only).
-- DO NOT APPLY TO PRESTASHOP RDS. PrestaShop RDS is READ ONLY, always.
--
-- WHY THIS TABLE EXISTS (task Section 11/12): customer_cluster_snapshot_row only stores
-- (customerId, clusterId, distanceToCentroid) — enough to assign a customer to a cluster, not
-- enough to answer "what characterizes cluster 2?" without re-querying PrestaShop for every
-- request. This table persists that characterization once, at snapshot-publish/backfill time
-- (heavy calculation), so HTTP reads stay local-only (task Section 15).
--
-- WHY JSON COLUMNS (task Section 12: "no asumir JSON automáticamente"): this table is never
-- filtered/sorted by an individual feature's mean/median in SQL — it is always read whole, one
-- (snapshot_id, cluster_id) row at a time, and rendered into a nested API response. Explicit
-- columns for 12 features x 4 stats (+ 4 commercial metrics x 4 stats) would be 64 columns of
-- write-only-together, read-only-together data with no independent query pattern — the same
-- tradeoff customer_cluster_model already made for artifact_json/metrics_json/hyperparameters_
-- json in migration 005. Indexing is on (snapshot_id, cluster_id), the only queryable axis.

CREATE TABLE customer_cluster_snapshot_profile (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_id BIGINT UNSIGNED NOT NULL,
  cluster_id TINYINT UNSIGNED NOT NULL,
  customer_count INT UNSIGNED NOT NULL,
  -- Per Feature-Set-A feature: {mean, median, p25, p75}. Keys are the 12 canonical
  -- ClusterFeatureName values (src/domain/customer-clustering/model-version.ts) — never raw
  -- R/F/M (task Section 2).
  feature_profile_json JSON NOT NULL,
  -- Post-hoc only, never a training input (task Section 14): totalSpentTaxIncl,
  -- averageOrderValueTaxIncl, validOrders, daysSinceLastOrder, each {mean, median, p25, p75}.
  commercial_profile_json JSON NOT NULL,
  -- {medianDistance, p95Distance, maxDistance} over customer_cluster_snapshot_row.distance_to_centroid
  -- for this cluster (task Section 29) — never converted into a probability (task Section 29).
  distance_profile_json JSON NOT NULL,
  -- Deterministic hash over (snapshotId, clusterId, customerCount, the three profiles above) —
  -- no generatedAt or other variable timestamp included (task Section 42), so re-generating the
  -- same snapshot's profile always reproduces the same checksum (idempotency check, task
  -- Section 41).
  profile_checksum CHAR(64) NOT NULL,
  generated_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_cluster_snapshot_profile (snapshot_id, cluster_id),
  KEY idx_customer_cluster_snapshot_profile_snapshot (snapshot_id),
  CONSTRAINT fk_customer_cluster_snapshot_profile_snapshot
    FOREIGN KEY (snapshot_id)
    REFERENCES customer_cluster_snapshot (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
