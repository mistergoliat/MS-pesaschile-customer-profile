// CP-R3-T03 — Analytical Query Runtime CLI (task Section 48). Local analytics DB reads only,
// SELECT-only by construction, no PrestaShop connection. This is the deterministic engine a
// future Copilot LLM will call after turning natural language into a query plan — this CLI
// exercises the exact same application capability by hand, from a JSON file.
//
// Usage:
//   npx tsx scripts/intelligence/query.ts --file=scripts/intelligence/examples/cluster-distribution.json
//   npx tsx scripts/intelligence/query.ts --file=query.json --feature-snapshot-id=17
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { createMysqlCustomerFeatureSnapshotReader } from '../../src/infrastructure/customer-analytics/mysql-customer-feature-snapshot-reader.js';
import { createMysqlSnapshotHeaderReader } from '../../src/infrastructure/customer-intelligence/mysql-snapshot-header-reader.js';
import { createMysqlCustomerIntelligenceReader } from '../../src/infrastructure/customer-intelligence/mysql-customer-intelligence-reader.js';
import { createCustomerIntelligenceContextResolvers } from '../../src/application/customer-intelligence/resolve-customer-intelligence-context.js';
import { createMysqlAnalyticalQueryExecutor } from '../../src/infrastructure/customer-intelligence-query/mysql-analytical-query-executor.js';
import { createQueryExecutor } from '../../src/infrastructure/shared/query-executor.js';
import { createExecuteAnalyticalQuery } from '../../src/application/customer-intelligence-query/index.js';
import { assertNoPiiInAnalyticalValue } from '../../src/domain/customer-intelligence-query/index.js';
import { config } from '../../src/config.js';

async function main(): Promise<void> {
  const fileArg = process.argv.find((arg) => arg.startsWith('--file='))?.split('=')[1];
  const featureSnapshotIdArg = process.argv.find((arg) => arg.startsWith('--feature-snapshot-id='))?.split('=')[1] ?? null;

  if (!fileArg) {
    throw new Error('Usage: intelligence:query -- --file=<path to query plan JSON> [--feature-snapshot-id=17]');
  }
  const plan: unknown = JSON.parse(readFileSync(fileArg, 'utf8'));

  if (!config.analyticsDb) {
    throw new Error('ANALYTICS_DB_* is not configured — cannot execute an analytical query (see .env.example)');
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
    const queryExecutor = createMysqlAnalyticalQueryExecutor(createQueryExecutor(pool, config.analyticsDb.queryTimeoutMs));
    const executeAnalyticalQuery = createExecuteAnalyticalQuery({
      resolveCurrent: resolvers.resolveCurrent,
      resolveForFeatureSnapshot: resolvers.resolveForFeatureSnapshot,
      queryExecutor,
    });

    const result = await executeAnalyticalQuery({ plan, featureSnapshotId: featureSnapshotIdArg });
    assertNoPiiInAnalyticalValue(result, 'result');
    console.info(JSON.stringify(result, null, 2));
    if (result.status !== 'ok') {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[intelligence:query] FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
