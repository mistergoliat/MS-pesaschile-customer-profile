// CP-R3-T01 — Customer Analytics Data Layer Foundation. Single CLI covering the whole
// pipeline (task Section 29): resolve referenceTime -> assert PrestaShop READ ONLY -> extract
// -> derive features -> validate -> checksum -> publish -> report. Unlike clustering, there is
// no separate "train/register a model" step here — a feature snapshot is a materialized
// extraction, not a fitted model, so extraction and publication collapse into one CLI.
//
// Usage:
//   npx tsx scripts/analytics/snapshot-features.ts [--reference-time=ISO] [--dry-run]
import 'dotenv/config';
import mysql from 'mysql2/promise';
import {
  assertPrestashopPoolIsReadOnly,
  createPrestashopPool,
  loadPrestashopConnectionConfig,
} from '../clustering/lib/db.js';
import { resolveReferenceTime, toMysqlDateTime, windowStart365dInclusive } from '../clustering/lib/reference-time.js';
import { createMysqlCustomerFeatureReader } from '../../src/infrastructure/prestashop/mysql-customer-feature-reader.js';
import { createMysqlCustomerFeatureSnapshotRepository } from '../../src/infrastructure/customer-analytics/mysql-customer-feature-snapshot-repository.js';
import { createMysqlCustomerFeatureSnapshotRunRepository } from '../../src/infrastructure/customer-analytics/mysql-customer-feature-snapshot-run-repository.js';
import { runCustomerFeatureSnapshotOperation } from '../../src/application/customer-analytics/run-customer-feature-snapshot-operation.js';
import {
  featureVersion,
  operationalAccountExclusionPolicyVersion,
  populationPolicyVersion,
  shopScope,
} from '../../src/domain/customer-analytics/index.js';
import { config } from '../../src/config.js';

const systemClock = { now: () => new Date() };

async function main(): Promise<void> {
  const referenceTimeArg = process.argv.find((arg) => arg.startsWith('--reference-time='))?.split('=')[1];
  const dryRun = process.argv.includes('--dry-run');
  const referenceTime = resolveReferenceTime(referenceTimeArg);
  const window365Start = windowStart365dInclusive(referenceTime);

  if (!config.analyticsDb && !dryRun) {
    throw new Error('ANALYTICS_DB_* is not configured — cannot publish (see .env.example), or pass --dry-run');
  }

  const prestashopConfig = loadPrestashopConnectionConfig(process.env);
  const prestashopPool = createPrestashopPool(prestashopConfig);
  const analyticsPool = config.analyticsDb
    ? mysql.createPool({
        host: config.analyticsDb.host,
        port: config.analyticsDb.port,
        user: config.analyticsDb.user,
        password: config.analyticsDb.password,
        database: config.analyticsDb.database,
        connectionLimit: config.analyticsDb.connectionLimit,
        supportBigNumbers: true,
        bigNumberStrings: true,
        timezone: 'Z',
      })
    : null;

  try {
    console.info('[snapshot-features] confirming PrestaShop credentials are read-only (SHOW GRANTS)...');
    await assertPrestashopPoolIsReadOnly(prestashopPool);
    console.info('[snapshot-features] READ_ONLY_CONFIRMED');

    const reader = createMysqlCustomerFeatureReader(
      prestashopPool,
      prestashopConfig.prefix,
      toMysqlDateTime(referenceTime),
      toMysqlDateTime(window365Start),
    );

    const repository = dryRun || !analyticsPool ? undefined : createMysqlCustomerFeatureSnapshotRepository(analyticsPool);
    const runRepository = dryRun || !analyticsPool ? undefined : createMysqlCustomerFeatureSnapshotRunRepository(analyticsPool);

    const result = await runCustomerFeatureSnapshotOperation(
      {
        triggerSource: 'manual',
        featureVersion,
        populationPolicyVersion,
        operationalExclusionPolicyVersion: operationalAccountExclusionPolicyVersion,
        shopScope,
        dryRun,
        referenceTime,
        referenceTimeMysql: toMysqlDateTime(referenceTime),
        generatedAt: null,
      },
      { reader, repository, runRepository, clock: systemClock },
    );

    console.info(JSON.stringify(result, null, 2));
  } finally {
    await prestashopPool.end();
    if (analyticsPool) {
      await analyticsPool.end();
    }
  }
}

main().catch((error) => {
  console.error('[snapshot-features] FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
