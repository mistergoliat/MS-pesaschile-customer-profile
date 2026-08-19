// CP-R2-T03 — analyst-facing CLI (task Section 36): prints the latest published cluster
// snapshot's summary (model provenance, cluster distribution, feature/commercial/distance
// profiles) plus the RFM x cluster cross-tab, straight from local MariaDB. No PrestaShop
// access, no recomputation — same read path as the HTTP endpoints. No PII (task Section 38):
// output is aggregates only, never an individual customerId.
//
// Usage:
//   npm run cluster:summary
//   npm run cluster:summary -- --snapshot-id=1
//   npm run cluster:summary -- --json=./out.json
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { createMysqlClusterAnalyticsReader } from '../../src/infrastructure/clustering/mysql-cluster-analytics-reader.js';
import { createMysqlClusterSnapshotProfileRepository } from '../../src/infrastructure/clustering/mysql-cluster-snapshot-profile-repository.js';
import { createMysqlRfmSegmentBulkReader } from '../../src/infrastructure/rfm/mysql-rfm-segment-bulk-reader.js';
import { createQueryExecutor } from '../../src/infrastructure/shared/query-executor.js';
import { createGetClusterSnapshotSummary } from '../../src/application/customer-clustering/get-cluster-snapshot-summary.js';
import { createGetRfmClusterCrossTab } from '../../src/application/customer-clustering/get-rfm-cluster-cross-tab.js';
import { config } from '../../src/config.js';

async function main(): Promise<void> {
  const snapshotIdArg = process.argv.find((arg) => arg.startsWith('--snapshot-id='))?.split('=')[1] ?? null;
  const jsonOutPath = process.argv.find((arg) => arg.startsWith('--json='))?.split('=')[1] ?? null;

  if (!config.clusterDb) {
    throw new Error('CLUSTER_DB_* is not configured (see .env.example)');
  }
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
  const rfmPool = config.rfmSnapshotDb
    ? mysql.createPool({
        host: config.rfmSnapshotDb.host,
        port: config.rfmSnapshotDb.port,
        user: config.rfmSnapshotDb.user,
        password: config.rfmSnapshotDb.password,
        database: config.rfmSnapshotDb.database,
        connectionLimit: config.rfmSnapshotDb.connectionLimit,
        supportBigNumbers: true,
        bigNumberStrings: true,
        timezone: 'Z',
      })
    : null;

  try {
    const clusterAnalyticsReader = createMysqlClusterAnalyticsReader(clusterPool);
    const clusterSnapshotProfileRepository = createMysqlClusterSnapshotProfileRepository(clusterPool);
    const getClusterSnapshotSummary = createGetClusterSnapshotSummary({ clusterAnalyticsReader, clusterSnapshotProfileRepository });

    const summary = await getClusterSnapshotSummary({ snapshotId: snapshotIdArg });

    let crossTab: unknown = { status: 'degraded', reason: 'rfm_not_configured' };
    if (rfmPool && config.rfmSnapshotDb) {
      const rfmSegmentBulkReader = createMysqlRfmSegmentBulkReader(createQueryExecutor(rfmPool, config.rfmSnapshotDb.queryTimeoutMs));
      const getRfmClusterCrossTab = createGetRfmClusterCrossTab({ clusterAnalyticsReader, rfmSegmentBulkReader });
      crossTab = await getRfmClusterCrossTab({ snapshotId: snapshotIdArg });
    }

    const output = { summary, rfmCrossTab: crossTab };
    const rendered = JSON.stringify(output, null, 2);
    console.info(rendered);

    if (summary.status === 'available') {
      console.info(`\n[cluster:summary] snapshot=${summary.snapshot.snapshotId} model=${summary.model.modelVersion} population=${summary.snapshot.populationSize}`);
      for (const cluster of summary.clusters) {
        console.info(
          `  cluster ${cluster.clusterId}: ${cluster.population.count} (${cluster.population.percentage}%) — ${cluster.interpretation?.label ?? 'no_interpretation'}`,
        );
      }
    }

    if (jsonOutPath) {
      await writeFile(jsonOutPath, rendered, 'utf8');
      console.info(`[cluster:summary] wrote ${jsonOutPath}`);
    }
  } finally {
    await clusterPool.end();
    if (rfmPool) await rfmPool.end();
  }
}

main().catch((error) => {
  console.error('[cluster:summary] FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
