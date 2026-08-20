// CP-R3-T02 — Customer Intelligence context summary (task Section 24/52). Local analytics DB
// reads only, no PrestaShop connection, no dashboard.
//
// Usage:
//   npx tsx scripts/intelligence/print-summary.ts [--feature-snapshot-id=17]
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION } from '../../src/domain/customer-intelligence/index.js';
import { createMysqlCustomerFeatureSnapshotReader } from '../../src/infrastructure/customer-analytics/mysql-customer-feature-snapshot-reader.js';
import { createMysqlSnapshotHeaderReader } from '../../src/infrastructure/customer-intelligence/mysql-snapshot-header-reader.js';
import { createMysqlCustomerIntelligenceReader } from '../../src/infrastructure/customer-intelligence/mysql-customer-intelligence-reader.js';
import { createCustomerIntelligenceContextResolvers } from '../../src/application/customer-intelligence/resolve-customer-intelligence-context.js';
import { config } from '../../src/config.js';

async function main(): Promise<void> {
  const featureSnapshotIdArg = process.argv.find((arg) => arg.startsWith('--feature-snapshot-id='))?.split('=')[1] ?? null;

  if (!config.analyticsDb) {
    throw new Error('ANALYTICS_DB_* is not configured — cannot resolve a Customer Intelligence context (see .env.example)');
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
    const resolvers = createCustomerIntelligenceContextResolvers({
      featureSnapshotReader: createMysqlCustomerFeatureSnapshotReader(pool),
      snapshotHeaderReader: createMysqlSnapshotHeaderReader(pool),
      intelligenceReader: createMysqlCustomerIntelligenceReader(pool),
    });

    const result = featureSnapshotIdArg ? await resolvers.resolveForFeatureSnapshot(featureSnapshotIdArg) : await resolvers.resolveCurrent();

    console.info(JSON.stringify({ readModelVersion: CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION, ...result }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[intelligence:summary] FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
