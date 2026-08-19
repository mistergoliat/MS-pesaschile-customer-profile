// CP-R2-T03 — backfills/regenerates the per-cluster observability profile for one already-
// published cluster snapshot (task Section 41). Re-derives Feature-Set-A vectors and commercial
// post-hoc aggregates from PrestaShop (read-only) at the snapshot's OWN referenceTime, computes
// aggregate stats once, and persists them to customer_cluster_snapshot_profile. Idempotent:
// re-running for a snapshot whose profile hasn't changed is a no-op (mode: skipped_unchanged).
//
// Usage:
//   npx tsx scripts/clustering/generate-cluster-profile.ts --snapshot-id=1
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { assertPrestashopPoolIsReadOnly, createPrestashopPool, loadPrestashopConnectionConfig } from './lib/db.js';
import {
  createMysqlClusterCommercialAggregateReader,
  createMysqlClusterPopulationReader,
} from '../../src/infrastructure/prestashop/mysql-cluster-population-reader.js';
import { createMysqlClusterAnalyticsReader } from '../../src/infrastructure/clustering/mysql-cluster-analytics-reader.js';
import { createMysqlClusterSnapshotProfileRepository } from '../../src/infrastructure/clustering/mysql-cluster-snapshot-profile-repository.js';
import { generateClusterProfiles } from '../../src/application/customer-clustering/generate-cluster-profiles.js';
import { config } from '../../src/config.js';

const systemClock = { now: () => new Date() };

async function main(): Promise<void> {
  const snapshotId = process.argv.find((arg) => arg.startsWith('--snapshot-id='))?.split('=')[1];
  if (!snapshotId || !/^[1-9]\d*$/.test(snapshotId)) {
    throw new Error('Usage: generate-cluster-profile.ts --snapshot-id=<positive integer>');
  }
  if (!config.clusterDb) {
    throw new Error('CLUSTER_DB_* is not configured — cannot generate a profile (see .env.example)');
  }

  const prestashopConfig = loadPrestashopConnectionConfig(process.env);
  const prestashopPool = createPrestashopPool(prestashopConfig);
  const clusterPool = mysql.createPool({
    host: config.clusterDb.host,
    port: config.clusterDb.port,
    user: config.clusterDb.user,
    password: config.clusterDb.password,
    database: config.clusterDb.database,
    connectionLimit: config.clusterDb.connectionLimit,
    supportBigNumbers: true,
    bigNumberStrings: true,
    timezone: 'Z',
  });

  try {
    console.info('[generate-cluster-profile] confirming PrestaShop credentials are read-only (SHOW GRANTS)...');
    await assertPrestashopPoolIsReadOnly(prestashopPool);
    console.info('[generate-cluster-profile] READ_ONLY_CONFIRMED');

    const clusterAnalyticsReader = createMysqlClusterAnalyticsReader(clusterPool);
    const profileRepository = createMysqlClusterSnapshotProfileRepository(clusterPool);

    const result = await generateClusterProfiles(
      { snapshotId },
      {
        clusterAnalyticsReader,
        createFeatureReader: (referenceTimeMysql, window365StartMysql) =>
          createMysqlClusterPopulationReader(prestashopPool, prestashopConfig.prefix, referenceTimeMysql, window365StartMysql),
        createCommercialAggregateReader: (referenceTimeMysql) =>
          createMysqlClusterCommercialAggregateReader(prestashopPool, prestashopConfig.prefix, referenceTimeMysql),
        profileRepository,
        clock: systemClock,
      },
    );

    console.info(
      JSON.stringify(
        {
          mode: result.mode,
          snapshotId: result.snapshotId,
          upserted: result.upserted,
          skipped: result.skipped,
          clusterCount: result.profiles.length,
          populationConsistency: result.profiles.reduce((sum, profile) => sum + profile.customerCount, 0),
        },
        null,
        2,
      ),
    );
  } finally {
    await prestashopPool.end();
    await clusterPool.end();
  }
}

main().catch((error) => {
  console.error('[generate-cluster-profile] FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
