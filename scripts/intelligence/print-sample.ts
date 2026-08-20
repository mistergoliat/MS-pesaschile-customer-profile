// CP-R3-T02 — PII-free sample rows for manual validation (task Section 53). Bounded by
// default — never dumps the full population.
//
// Usage:
//   npx tsx scripts/intelligence/print-sample.ts [--limit=10] [--feature-snapshot-id=17]
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { assertNoPiiInIntelligenceValue } from '../../src/domain/customer-intelligence/index.js';
import { createMysqlCustomerFeatureSnapshotReader } from '../../src/infrastructure/customer-analytics/mysql-customer-feature-snapshot-reader.js';
import { createMysqlSnapshotHeaderReader } from '../../src/infrastructure/customer-intelligence/mysql-snapshot-header-reader.js';
import { createMysqlCustomerIntelligenceReader } from '../../src/infrastructure/customer-intelligence/mysql-customer-intelligence-reader.js';
import { createCustomerIntelligenceContextResolvers } from '../../src/application/customer-intelligence/resolve-customer-intelligence-context.js';
import { createListCustomerIntelligenceRows } from '../../src/application/customer-intelligence/list-customer-intelligence-rows.js';
import { config } from '../../src/config.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

async function main(): Promise<void> {
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1];
  const featureSnapshotIdArg = process.argv.find((arg) => arg.startsWith('--feature-snapshot-id='))?.split('=')[1] ?? null;
  const limit = Math.min(limitArg ? Number(limitArg) : DEFAULT_LIMIT, MAX_LIMIT);
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('--limit must be a positive integer');
  }

  if (!config.analyticsDb) {
    throw new Error('ANALYTICS_DB_* is not configured — cannot list Customer Intelligence rows (see .env.example)');
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
    const intelligenceReader = createMysqlCustomerIntelligenceReader(pool);
    const resolvers = createCustomerIntelligenceContextResolvers({
      featureSnapshotReader: createMysqlCustomerFeatureSnapshotReader(pool),
      snapshotHeaderReader: createMysqlSnapshotHeaderReader(pool),
      intelligenceReader,
    });
    const listRows = createListCustomerIntelligenceRows({
      resolveCurrent: resolvers.resolveCurrent,
      resolveForFeatureSnapshot: resolvers.resolveForFeatureSnapshot,
      intelligenceReader,
    });

    const result = await listRows({ featureSnapshotId: featureSnapshotIdArg, limit, afterCustomerId: null });
    assertNoPiiInIntelligenceValue(result, 'result');
    console.info(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[intelligence:sample] FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
