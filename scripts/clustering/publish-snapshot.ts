// CP-R2-T02 — extracts the current population, assigns clusters using the persisted model
// (TS-native transform + nearest-centroid, no Python), and publishes a snapshot transactionally
// (task Section 30). Idempotent: re-running with the same modelVersion at the same
// referenceTime and matching assignment output is a no-op (mode: skipped_existing).
//
// Usage:
//   npx tsx scripts/clustering/publish-snapshot.ts [--model-version=behavioral-kmeans-k4-v1] [--reference-time=ISO] [--dry-run]
import 'dotenv/config';
import mysql from 'mysql2/promise';
import {
  assertPrestashopPoolIsReadOnly,
  createPrestashopPool,
  loadPrestashopConnectionConfig,
} from './lib/db.js';
import { createMysqlClusterPopulationReader } from '../../src/infrastructure/prestashop/mysql-cluster-population-reader.js';
import { createMysqlClusterModelRepository } from '../../src/infrastructure/clustering/mysql-cluster-model-repository.js';
import { createMysqlClusterSnapshotRepository } from '../../src/infrastructure/clustering/mysql-cluster-snapshot-repository.js';
import { createMysqlClusterSnapshotRunRepository } from '../../src/infrastructure/clustering/mysql-cluster-snapshot-run-repository.js';
import { runClusterSnapshotOperation } from '../../src/application/customer-clustering/run-cluster-snapshot-operation.js';
import { modelVersion as defaultModelVersion } from '../../src/domain/customer-clustering/index.js';
import { config } from '../../src/config.js';
import { resolveReferenceTime, toMysqlDateTime, windowStart365dInclusive } from './lib/reference-time.js';

const systemClock = { now: () => new Date() };

async function main(): Promise<void> {
  const modelVersionArg = process.argv.find((arg) => arg.startsWith('--model-version='))?.split('=')[1];
  const referenceTimeArg = process.argv.find((arg) => arg.startsWith('--reference-time='))?.split('=')[1];
  const dryRun = process.argv.includes('--dry-run');
  const modelVersion = modelVersionArg ?? defaultModelVersion;
  const referenceTime = resolveReferenceTime(referenceTimeArg);
  const window365Start = windowStart365dInclusive(referenceTime);

  if (!config.clusterDb && !dryRun) {
    throw new Error('CLUSTER_DB_* is not configured — cannot publish (see .env.example), or pass --dry-run');
  }

  const prestashopConfig = loadPrestashopConnectionConfig(process.env);
  const prestashopPool = createPrestashopPool(prestashopConfig);
  const clusterPool = config.clusterDb
    ? mysql.createPool({
        host: config.clusterDb.host,
        port: config.clusterDb.port,
        user: config.clusterDb.user,
        password: config.clusterDb.password,
        database: config.clusterDb.database,
        connectionLimit: config.clusterDb.connectionLimit,
        supportBigNumbers: true,
        bigNumberStrings: true,
        timezone: 'Z',
      })
    : null;

  try {
    console.info('[publish-snapshot] confirming PrestaShop credentials are read-only (SHOW GRANTS)...');
    await assertPrestashopPoolIsReadOnly(prestashopPool);
    console.info('[publish-snapshot] READ_ONLY_CONFIRMED');

    if (!clusterPool) {
      throw new Error('Unreachable: clusterPool is required outside --dry-run');
    }
    const modelRepository = createMysqlClusterModelRepository(clusterPool);
    const stored = await modelRepository.findByModelVersion(modelVersion);
    if (!stored) {
      throw new Error(`Cluster model ${modelVersion} is not registered — run register-model.ts --persist first`);
    }
    console.info(`[publish-snapshot] using model ${modelVersion} (modelId=${stored.modelId}, status=${stored.status})`);

    const reader = createMysqlClusterPopulationReader(
      prestashopPool,
      prestashopConfig.prefix,
      toMysqlDateTime(referenceTime),
      toMysqlDateTime(window365Start),
    );

    const repository = dryRun ? undefined : createMysqlClusterSnapshotRepository(clusterPool);
    const runRepository = dryRun ? undefined : createMysqlClusterSnapshotRunRepository(clusterPool);

    const result = await runClusterSnapshotOperation(
      {
        triggerSource: 'manual',
        artifact: stored.artifact,
        modelId: stored.modelId,
        dryRun,
        referenceTime,
        generatedAt: null,
      },
      { reader, repository, runRepository, clock: systemClock },
    );

    console.info(JSON.stringify(result, null, 2));
  } finally {
    await prestashopPool.end();
    if (clusterPool) {
      await clusterPool.end();
    }
  }
}

main().catch((error) => {
  console.error('[publish-snapshot] FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
