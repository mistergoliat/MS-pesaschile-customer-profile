import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createProductSemanticSnapshotConsumer } from '../../src/application/product-semantic-snapshot/consumer.js';
import { FileProductSemanticSnapshotSource } from '../../src/infrastructure/catalog-product-semantics/file-product-semantic-snapshot-source.js';
import { createMysqlCustomerAffinityPurchaseReader } from '../../src/infrastructure/prestashop/mysql-customer-affinity-purchase-reader.js';
import { createMysqlCustomerCommercialAffinitySnapshotStore } from '../../src/infrastructure/clv/mysql-customer-commercial-affinity-snapshot-store.js';
import {
  buildCustomerCommercialAffinitySnapshotHeader,
  CustomerCommercialAffinitySnapshotKeyConflictError,
  validateCustomerCommercialAffinitySnapshot,
} from '../../src/application/customer-commercial-affinity-snapshot/index.js';
import {
  buildCustomerCommercialAffinityPopulation,
  CUSTOMER_COMMERCIAL_AFFINITY_POPULATION_POLICY_VERSION,
} from '../../src/application/customer-commercial-affinity-population/index.js';
import { assertPrestashopPoolIsReadOnly, createPrestashopPool, createRfmSnapshotPool, loadPrestashopConnectionConfig, loadRfmSnapshotConnectionConfig } from '../clustering/lib/db.js';
import { createQueryExecutor } from '../../src/infrastructure/shared/query-executor.js';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const referenceTime = requiredEnv('AFFINITY_REFERENCE_TIME');
const generatedAt = new Date().toISOString();
const snapshotDirectory = process.env.PRODUCT_SEMANTIC_SNAPSHOT_DIR
  ? resolve(process.env.PRODUCT_SEMANTIC_SNAPSHOT_DIR)
  : resolve(process.cwd(), '..', 'MS-pesaschile-catalog-service', 'data', 'product-semantic-snapshots');
const reportPath = resolve(process.env.AFFINITY_SNAPSHOT_REPORT_PATH ?? 'artifacts/customer-commercial-affinity/a01-5-snapshot-report.json');
const prestashopConnection = loadPrestashopConnectionConfig(process.env);
const prestashopPool = createPrestashopPool(prestashopConnection);
const startedAt = performance.now();

try {
  const readOnlyGrantCheck = await assertPrestashopPoolIsReadOnly(prestashopPool);
  const semanticConsumer = createProductSemanticSnapshotConsumer(new FileProductSemanticSnapshotSource(snapshotDirectory));
  const semanticSnapshot = await semanticConsumer.refresh();
  const reader = createMysqlCustomerAffinityPurchaseReader(createQueryExecutor(prestashopPool, prestashopConnection.queryTimeoutMs), prestashopConnection.prefix);
  const sourceStartedAt = performance.now();
  const purchases = await reader.readEvidence(referenceTime, {
    batchSize: parsePositiveEnv(process.env.AFFINITY_BATCH_SIZE, 1_000),
    maxRetries: parseNonNegativeEnv(process.env.AFFINITY_MAX_RETRIES, 2),
    onProgress: (progress) => console.error(JSON.stringify({ status: 'progress', ...progress })),
  });
  const sourceReadDurationMs = performance.now() - sourceStartedAt;
  const sourceMetrics = reader.getLastReadMetrics();
  const buildStartedAt = performance.now();
  const population = buildCustomerCommercialAffinityPopulation({
    referenceTime,
    purchases,
    semanticSnapshot,
    populationPolicyVersion: CUSTOMER_COMMERCIAL_AFFINITY_POPULATION_POLICY_VERSION,
  });
  const populationBuildDurationMs = performance.now() - buildStartedAt;
  const performanceMetadata = {
    sourceReadDurationMs: round(sourceReadDurationMs),
    populationBuildDurationMs: round(populationBuildDurationMs),
    batchSize: parsePositiveEnv(process.env.AFFINITY_BATCH_SIZE, 1_000),
    sourceQueries: sourceMetrics.sourceQueries,
    sourceRetries: sourceMetrics.retries,
  };
  let header = buildCustomerCommercialAffinitySnapshotHeader({
    population,
    semanticSnapshotMetadata: semanticSnapshot.metadata,
    generatedAt,
    sourceWatermarkOrderId: sourceMetrics.sourceWatermarkOrderId,
    performanceMetadata,
  });
  const validationStartedAt = performance.now();
  let validation = validateCustomerCommercialAffinitySnapshot({ header, rows: population.rows });
  const validationDurationMs = performance.now() - validationStartedAt;
  header = { ...header, performanceMetadata: { ...performanceMetadata, validationDurationMs: round(validationDurationMs) } };
  validation = validateCustomerCommercialAffinitySnapshot({ header, rows: population.rows });
  const sourceCustomerIds = new Set(purchases.map((purchase) => purchase.customerId));
  const affinityCustomerIds = new Set(population.rows.map((row) => row.customerId));
  const customerWithoutAffinity = [...sourceCustomerIds].filter((customerId) => !affinityCustomerIds.has(customerId))[0] ?? null;
  const summary = {
    status: 'ok',
    mode: dryRun ? 'dry_run' : 'persisted',
    readOnlyGrantCheck,
    referenceTime,
    snapshotKey: header.snapshotKey,
    header,
    validation,
    sourceMetrics,
    sourceReadDurationMs: round(sourceReadDurationMs),
    populationBuildDurationMs: round(populationBuildDurationMs),
    validationDurationMs: round(validationDurationMs),
    affinityRowCount: population.rows.length,
    customersWithAffinity: header.customersWithAffinity,
    customersWithoutAffinity: header.customersWithoutAffinity,
    customerWithoutAffinity,
  };

  if (dryRun) {
    await writeReport(summary);
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const analyticsConfig = loadRfmSnapshotConnectionConfig(process.env);
    if (!analyticsConfig) throw new Error('RFM_SNAPSHOT_DB_* local analytics configuration is required for persisted affinity snapshots');
    const analyticsPool = createRfmSnapshotPool(analyticsConfig);
    try {
      const store = createMysqlCustomerCommercialAffinitySnapshotStore(analyticsPool);
      const existing = await store.findSnapshotByKey(header.snapshotKey);
      if (existing) {
        if ((existing.status === 'validated' || existing.status === 'published') && existing.datasetChecksum === header.datasetChecksum && existing.affinityDatasetChecksum === header.affinityDatasetChecksum) {
          const result = { ...summary, mode: 'skipped_existing', snapshotId: existing.snapshotId, persistedRowCount: header.affinityRowCount, persistenceDurationMs: 0, idempotent: true };
          await writeReport(result);
          console.log(JSON.stringify(result, null, 2));
        } else {
          throw new CustomerCommercialAffinitySnapshotKeyConflictError();
        }
      } else {
        const persistenceStartedAt = performance.now();
        const persisted = await store.publishSnapshot({ header, rows: population.rows });
        const persistenceDurationMs = performance.now() - persistenceStartedAt;
        const activeMetadata = await store.getActiveSnapshotMetadata();
        const fixtureWithAffinity = population.rows[0]?.customerId ?? null;
        const fixtureRows = fixtureWithAffinity === null ? [] : await store.getCustomerAffinity(fixtureWithAffinity);
        const fixtureBatch = fixtureWithAffinity === null ? [] : await store.getCustomerAffinities([fixtureWithAffinity]);
        const fixtureWithoutRows = customerWithoutAffinity === null ? [] : await store.getCustomerAffinity(customerWithoutAffinity);
        const idempotentLookup = await store.findSnapshotByKey(header.snapshotKey);
        const result = {
          ...summary,
          mode: 'persisted',
          snapshotId: persisted.snapshotId,
          persistedRowCount: persisted.persistedRowCount,
          activeSnapshotId: activeMetadata?.snapshotId ?? null,
          customerLookupRowCount: fixtureRows.length,
          batchLookupRowCount: fixtureBatch.length,
          customerWithoutAffinityRowCount: fixtureWithoutRows.length,
          idempotentLookup,
          idempotent: idempotentLookup?.snapshotId === persisted.snapshotId && idempotentLookup.affinityDatasetChecksum === header.affinityDatasetChecksum,
          persistenceDurationMs: round(persistenceDurationMs),
          totalDurationMs: round(performance.now() - startedAt),
          persistedChecksum: persisted.affinityDatasetChecksum,
        };
        await writeReport(result);
        console.log(JSON.stringify(result, null, 2));
      }
    } finally {
      await analyticsPool.end();
    }
  }
} catch (error) {
  console.error(JSON.stringify({ status: 'error', errorType: error instanceof Error ? error.name : typeof error, errorMessage: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await prestashopPool.end();
}

async function writeReport(value: unknown): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || Number.isNaN(Date.parse(value))) throw new Error(`${name} must be a valid timestamp`);
  return new Date(value).toISOString();
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
