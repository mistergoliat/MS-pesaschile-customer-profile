// CP-R3-T01 — lightweight snapshot summary (task Section 36). Local analytics DB reads only,
// no PrestaShop connection, no dashboard — just the header fields an operator/auditor needs:
// snapshotId, referenceTime, featureVersion, populationSize, checksums, status.
//
// Usage:
//   npx tsx scripts/analytics/print-snapshot-summary.ts [--snapshot-id=123]
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { createMysqlCustomerFeatureSnapshotReader } from '../../src/infrastructure/customer-analytics/mysql-customer-feature-snapshot-reader.js';
import { config } from '../../src/config.js';

async function main(): Promise<void> {
  const snapshotIdArg = process.argv.find((arg) => arg.startsWith('--snapshot-id='))?.split('=')[1] ?? null;

  if (!config.analyticsDb) {
    throw new Error('ANALYTICS_DB_* is not configured — cannot read a snapshot summary (see .env.example)');
  }

  const pool = mysql.createPool({
    host: config.analyticsDb.host,
    port: config.analyticsDb.port,
    user: config.analyticsDb.user,
    password: config.analyticsDb.password,
    database: config.analyticsDb.database,
    connectionLimit: config.analyticsDb.connectionLimit,
    supportBigNumbers: true,
    bigNumberStrings: true,
    timezone: 'Z',
  });

  try {
    const reader = createMysqlCustomerFeatureSnapshotReader(pool);
    const snapshot = snapshotIdArg ? await reader.getSnapshotById(snapshotIdArg) : await reader.getLatestPublishedSnapshot();

    if (!snapshot) {
      console.info(JSON.stringify({ status: snapshotIdArg ? 'snapshot_not_found' : 'no_published_snapshot' }, null, 2));
      return;
    }

    console.info(
      JSON.stringify(
        {
          status: 'available',
          snapshotId: snapshot.snapshotId,
          featureVersion: snapshot.featureVersion,
          populationPolicyVersion: snapshot.populationPolicyVersion,
          referenceTime: snapshot.referenceTime.toISOString(),
          generatedAt: snapshot.generatedAt.toISOString(),
          publishedAt: snapshot.publishedAt.toISOString(),
          populationSize: snapshot.populationSize,
          sourceDatasetChecksum: snapshot.sourceDatasetChecksum,
          featureDatasetChecksum: snapshot.featureDatasetChecksum,
          snapshotStatus: snapshot.status,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[print-snapshot-summary] FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
