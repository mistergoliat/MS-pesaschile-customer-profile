import 'dotenv/config';
import mysql from 'mysql2/promise';
import { config } from '../../src/config.js';
import { getAnalyticalSchema, createExecuteAnalyticalQueryWithResolvedContext } from '../../src/application/customer-intelligence-query/index.js';
import { createAnswerCustomerIntelligenceQuestion } from '../../src/application/customer-intelligence-copilot/index.js';
import { createCustomerIntelligenceContextResolvers } from '../../src/application/customer-intelligence/resolve-customer-intelligence-context.js';
import { createMysqlCustomerFeatureSnapshotReader } from '../../src/infrastructure/customer-analytics/mysql-customer-feature-snapshot-reader.js';
import { createMysqlSnapshotHeaderReader } from '../../src/infrastructure/customer-intelligence/mysql-snapshot-header-reader.js';
import { createMysqlCustomerIntelligenceReader } from '../../src/infrastructure/customer-intelligence/mysql-customer-intelligence-reader.js';
import { createMysqlAnalyticalQueryExecutor } from '../../src/infrastructure/customer-intelligence-query/mysql-analytical-query-executor.js';
import { createQueryExecutor } from '../../src/infrastructure/shared/query-executor.js';
import { createConfiguredCustomerIntelligenceCopilotModel } from '../../src/infrastructure/customer-intelligence-copilot/index.js';

async function main(): Promise<void> {
  const question = readArg('--question=');
  const featureSnapshotId = readArg('--feature-snapshot-id=') ?? null;
  const debug = process.argv.includes('--debug');

  if (!question) {
    throw new Error('Usage: intelligence:copilot -- --question="Cuantos clientes hay en cada cluster?" [--feature-snapshot-id=17] [--debug]');
  }

  const modelConfig = createConfiguredCustomerIntelligenceCopilotModel();
  if (modelConfig.status !== 'configured') {
    throw new Error(modelConfig.reason);
  }
  if (!config.analyticsDb) {
    throw new Error('ANALYTICS_DB_* is not configured - cannot execute Customer Intelligence Copilot queries');
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
    const answerQuestion = createAnswerCustomerIntelligenceQuestion({
      getAnalyticalSchema,
      resolveCurrent: resolvers.resolveCurrent,
      resolveForFeatureSnapshot: resolvers.resolveForFeatureSnapshot,
      executeAnalyticalQuery: createExecuteAnalyticalQueryWithResolvedContext({ queryExecutor }),
      model: modelConfig.model,
    });

    const response = await answerQuestion({ question, featureSnapshotId });
    if (response.status === 'answered' && !debug) {
      console.info(response.answer);
      console.info(JSON.stringify({ status: response.status, analysis: response.analysis, provenance: response.provenance }, null, 2));
    } else {
      console.info(JSON.stringify(response, null, 2));
    }
    if (response.status !== 'answered') process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

function readArg(prefix: string): string | null {
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

main().catch((error) => {
  console.error('[intelligence:copilot] FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
