import 'dotenv/config';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  buildCustomerCommercialAffinityPopulation,
  CUSTOMER_COMMERCIAL_AFFINITY_POPULATION_POLICY_VERSION,
} from '../../src/application/customer-commercial-affinity-population/population-builder.js';
import { createMysqlCustomerAffinityPurchaseReader } from '../../src/infrastructure/prestashop/mysql-customer-affinity-purchase-reader.js';
import { createQueryExecutor } from '../../src/infrastructure/shared/query-executor.js';
import { assertPrestashopPoolIsReadOnly, createPrestashopPool, loadPrestashopConnectionConfig } from '../clustering/lib/db.js';
import { loadCustomerAffinitySemanticSnapshot } from './lib/semantic-source.js';

const referenceTime = requiredEnv('AFFINITY_REFERENCE_TIME');
const outputPath = resolve(process.env.AFFINITY_OUTPUT_PATH ?? 'artifacts/customer-commercial-affinity/a01-4-population.json');
const connection = loadPrestashopConnectionConfig(process.env);
const pool = createPrestashopPool(connection);
const startedAt = performance.now();

try {
  const readOnlyGrantCheck = await assertPrestashopPoolIsReadOnly(pool);
  const reader = createMysqlCustomerAffinityPurchaseReader(
    createQueryExecutor(pool, connection.queryTimeoutMs),
    connection.prefix,
  );
  const sourceStartedAt = performance.now();
  const purchases = await reader.readEvidence(referenceTime, {
    batchSize: parsePositiveEnv(process.env.AFFINITY_BATCH_SIZE, 1_000),
    maxRetries: parseNonNegativeEnv(process.env.AFFINITY_MAX_RETRIES, 2),
    onProgress: (progress) => console.error(JSON.stringify({ status: 'progress', ...progress })),
  });
  const sourceReadDurationMs = performance.now() - sourceStartedAt;
  const sourceMetrics = reader.getLastReadMetrics();
  const semanticStartedAt = performance.now();
  const semanticLoad = await loadCustomerAffinitySemanticSnapshot(purchases, { referenceTime });
  const semanticSnapshot = semanticLoad.snapshot;
  const semanticJoinDurationMs = performance.now() - semanticStartedAt;
  const buildStartedAt = performance.now();
  const population = buildCustomerCommercialAffinityPopulation({
    referenceTime,
    purchases,
    semanticSnapshot,
    populationPolicyVersion: CUSTOMER_COMMERCIAL_AFFINITY_POPULATION_POLICY_VERSION,
    sampleCustomerIds: parseCustomerSample(process.env.AFFINITY_SAMPLE_CUSTOMER_IDS),
  });
  const aggregationAndScoringDurationMs = performance.now() - buildStartedAt;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(population, null, 2)}\n`, 'utf8');
  const artifactBytes = (await stat(outputPath)).size;
  console.log(JSON.stringify({
    status: 'ok',
    artifactPath: outputPath,
    artifactBytes,
    readOnlyGrantCheck,
    sourceOrdersRead: sourceMetrics.sourceOrdersRead,
    sourceLinesRead: sourceMetrics.sourceLinesRead,
    sourceWatermarkOrderId: sourceMetrics.sourceWatermarkOrderId,
    sourceQueries: sourceMetrics.sourceQueries,
    batches: sourceMetrics.batches,
    batchSize: parsePositiveEnv(process.env.AFFINITY_BATCH_SIZE, 1_000),
    retries: sourceMetrics.retries,
    purchaseRowsRead: purchases.length,
    distinctProductIds: semanticLoad.metrics.requestedDistinctProductIds,
    semanticBatches: semanticLoad.metrics.semanticBatches,
    requestedProductIds: semanticLoad.metrics.requestedProductIds,
    matchedSemanticFacts: semanticLoad.metrics.matchedSemanticFacts,
    missingProductIds: semanticLoad.metrics.missingProductIds,
    classificationCounts: semanticLoad.metrics.classificationCounts,
    productSemanticSnapshotId: semanticLoad.metrics.productSemanticSnapshotId,
    ontologyVersion: semanticLoad.metrics.ontologyVersion,
    ontologyHash: semanticLoad.metrics.ontologyHash,
    semanticSource: process.env.AFFINITY_SEMANTIC_SOURCE ?? 'http',
    distinctCustomers: population.manifest.eligibleCustomerCount,
    semanticJoinDurationMs: round(semanticJoinDurationMs),
    sourceReadDurationMs: round(sourceReadDurationMs),
    aggregationAndScoringDurationMs: round(aggregationAndScoringDurationMs),
    totalDurationMs: round(performance.now() - startedAt),
    peakRssBytesApproximation: process.memoryUsage().rss,
    manifest: population.manifest,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    status: 'error',
    errorType: error instanceof Error ? error.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
} finally {
  await pool.end();
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required; use one fixed UTC timestamp for the whole run`);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${name} must be a valid timestamp`);
  return value;
}

function parseCustomerSample(value: string | undefined): readonly number[] | undefined {
  if (!value?.trim()) return undefined;
  const ids = value.split(',').map((entry) => Number(entry.trim()));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error('AFFINITY_SAMPLE_CUSTOMER_IDS must be comma-separated positive integers');
  return ids;
}

function parsePositiveEnv(value: string | undefined, fallback: number): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error('AFFINITY_BATCH_SIZE must be a positive integer');
  return result;
}

function parseNonNegativeEnv(value: string | undefined, fallback: number): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('AFFINITY_MAX_RETRIES must be a non-negative integer');
  return result;
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
