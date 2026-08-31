import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  buildCustomerClvBacktestDataset,
  buildCustomerClvCandidateBacktestCutoffs,
  buildCustomerClvProductionDataset,
  CUSTOMER_CLV_CURRENCY_ISO_CODE,
  CUSTOMER_CLV_HORIZON_MONTHS,
  CUSTOMER_CLV_IDENTITY_AUTHORITY,
  CUSTOMER_CLV_MODEL_VERSION,
  CUSTOMER_CLV_MONETARY_POLICY_VERSION,
  CUSTOMER_CLV_POPULATION_POLICY_VERSION,
  predictCustomerClvTwoStageFrozenProduction,
  type CustomerClvBacktestSourceOrder,
  type CustomerClvSnapshotRow,
  type CustomerClvTwoStageFrozenCandidateDescriptor,
} from '../../src/domain/customer-clv/index.js';
import { buildCustomerClvSnapshotKey } from '../../src/domain/customer-clv/snapshot.js';
import { validateCustomerClvProductionSnapshot, type CustomerClvProductionSnapshotHeader } from '../../src/application/customer-clv/create-customer-clv-snapshot.js';
import { createMysqlCustomerClvSnapshotStore } from '../../src/infrastructure/clv/mysql-customer-clv-snapshot-store.js';
import { createMysqlCustomerClvHistoricalReader } from '../../src/infrastructure/prestashop/mysql-customer-clv-historical-reader.js';
import { assertPrestashopPoolIsReadOnly, createPrestashopPool, loadPrestashopConnectionConfig, loadRfmSnapshotConnectionConfig, createRfmSnapshotPool } from '../clustering/lib/db.js';
import { sha256Stable } from '../../src/domain/customer-rfm/checksum.js';

const descriptorPath = resolve('artifacts/clv/a04-3-frozen-candidate.json');
const acceptancePath = resolve('artifacts/clv/a05-acceptance-validation-report.json');
const dryRunPath = resolve('artifacts/clv/a06-dry-run-report.json');
const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as CustomerClvTwoStageFrozenCandidateDescriptor;
const acceptanceArtifact = JSON.parse(await readFile(acceptancePath, 'utf8')) as { reportVersion?: string; acceptanceGates?: Record<string, unknown>; aggregateResults?: { frozenCandidate?: { modelChecksum?: string } } };
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const referenceTimeArg = process.argv.find((arg) => arg.startsWith('--reference-time='))?.slice('--reference-time='.length);
const generatedAt = new Date().toISOString();
const prestashopPool = createPrestashopPool(loadPrestashopConnectionConfig(process.env));
const startedAt = Date.now();

try {
  assertAcceptedFrozenDescriptor(descriptor, acceptanceArtifact);
  const readOnlyGrantCheck = await assertPrestashopPoolIsReadOnly(prestashopPool);
  const reader = createMysqlCustomerClvHistoricalReader(prestashopPool, loadPrestashopConnectionConfig(process.env).prefix);
  await reader.verifySchema();
  const source = await reader.readSource();
  const referenceTime = referenceTimeArg ?? source.availableDataThrough;
  const candidateCutoffs = buildCustomerClvCandidateBacktestCutoffs({
    firstObservedOrderAt: firstObservedOrderAt(source.orders),
    availableDataThrough: source.availableDataThrough,
    maxCutoffs: 8,
  }).filter((cutoff) => Date.parse(cutoff) < Date.parse(referenceTime));
  const trainingDatasets = candidateCutoffs.map((cutoffTime) => buildCustomerClvBacktestDataset({ cutoffTime, availableDataThrough: source.availableDataThrough, sourceOrders: source.orders }));
  const productionDataset = buildCustomerClvProductionDataset({ referenceTime, availableDataThrough: source.availableDataThrough, sourceOrders: source.orders });
  const fitStarted = Date.now();
  const fitted = predictCustomerClvTwoStageFrozenProduction({ trainingDatasets, productionDataset, frozenDescriptor: descriptor });
  const fitAndPredictionDurationMs = Date.now() - fitStarted;
  const rows: CustomerClvSnapshotRow[] = fitted.predictions.map((prediction) => ({
    customerId: prediction.customerId,
    expectedRevenueTaxIncl: prediction.predictedRevenueTaxIncl,
    ...(prediction.expectedOrders === undefined ? {} : { expectedOrders: prediction.expectedOrders }),
    estimateSupportLevel: prediction.estimateSupportLevel,
  }));
  const inputChecksum = sha256Stable({ referenceTime, sourceAvailableDataThrough: source.availableDataThrough, productionFeatureChecksum: productionDataset.manifest.featureChecksum, trainingDatasetChecksums: fitted.trainingDatasetChecksums });
  const outputChecksum = sha256Stable({ snapshotKey: buildCustomerClvSnapshotKey({ modelVersion: descriptor.modelVersion, horizonMonths: CUSTOMER_CLV_HORIZON_MONTHS, populationPolicyVersion: descriptor.populationPolicyVersion, monetaryPolicyVersion: descriptor.monetaryPolicyVersion, referenceTime, modelChecksum: descriptor.modelChecksum }), referenceTime, rows: [...rows].sort((left, right) => left.customerId - right.customerId) });
  const snapshotKey = buildCustomerClvSnapshotKey({ modelVersion: descriptor.modelVersion, horizonMonths: CUSTOMER_CLV_HORIZON_MONTHS, populationPolicyVersion: descriptor.populationPolicyVersion, monetaryPolicyVersion: descriptor.monetaryPolicyVersion, referenceTime, modelChecksum: descriptor.modelChecksum });
  const header: CustomerClvProductionSnapshotHeader = {
    snapshotId: null,
    snapshotKey,
    status: 'building',
    referenceTime,
    generatedAt,
    horizonMonths: CUSTOMER_CLV_HORIZON_MONTHS,
    modelVersion: descriptor.modelVersion,
    estimatorPolicyVersion: descriptor.estimatorPolicyVersion,
    activityModelVersion: descriptor.activityModelVersion,
    activityTrainingWindowPolicy: descriptor.activityTrainingWindowPolicy,
    activityRecalibrationVersion: descriptor.activityRecalibrationVersion,
    staleAdjustmentPolicyVersion: descriptor.staleAdjustmentPolicyVersion,
    conditionalValuePolicyVersion: descriptor.conditionalValuePolicyVersion,
    rankRefinementPolicyVersion: descriptor.rankRefinementPolicyVersion,
    estimateSupportPolicyVersion: descriptor.estimateSupportPolicyVersion,
    trainingTimePolicyVersion: descriptor.trainingTimePolicyVersion,
    datasetVersion: descriptor.datasetVersion,
    populationPolicyVersion: descriptor.populationPolicyVersion,
    monetaryPolicyVersion: descriptor.monetaryPolicyVersion,
    identityAuthority: CUSTOMER_CLV_IDENTITY_AUTHORITY,
    currencyIsoCode: CUSTOMER_CLV_CURRENCY_ISO_CODE,
    populationSize: rows.length,
    sourceAvailableDataThrough: source.availableDataThrough,
    datasetChecksum: inputChecksum,
    modelChecksum: descriptor.modelChecksum,
    inputChecksum,
    outputChecksum,
    acceptedValidationDecision: 'CLV_MODEL_V1_ACCEPTED_WITH_DOCUMENTED_DEBT',
    acceptedValidationArtifactVersion: acceptanceArtifact.reportVersion ?? 'customer-clv-a05-acceptance-validation-v1',
    acceptedValidationArtifactChecksum: sha256Stable(acceptanceArtifact),
    trainingMetadata: {
      trainingCutoffs: candidateCutoffs,
      effectiveStageATrainingCutoffs: fitted.trainingCutoffs,
      effectiveStageBTrainingCutoffs: trainingDatasets.map((dataset) => dataset.manifest.cutoffTime),
      trainingDatasetChecksums: fitted.trainingDatasetChecksums,
      trainingRowCount: fitted.trainingRowCount,
      temporalStatePolicyVersion: 'customer-clv-current-valid-observed-with-documented-drift-v1',
    },
  };
  const validationStarted = Date.now();
  const validation = validateCustomerClvProductionSnapshot({ header, rows });
  const validationDurationMs = Date.now() - validationStarted;
  const result = {
    generatedAt,
    dryRun,
    readOnlyGrantCheck,
    physicalDatabase: dryRun ? 'not_written' : 'RFM_SNAPSHOT_DB local analytics schema',
    snapshotKey,
    referenceTime,
    sourceAvailableDataThrough: source.availableDataThrough,
    header,
    validation,
    rowCount: rows.length,
    supportCounts: validation.supportCounts,
    modelChecksum: descriptor.modelChecksum,
    inputChecksum,
    outputChecksum,
    predictionChecksum: fitted.predictionChecksum,
    trainingCutoffs: fitted.trainingCutoffs,
    timings: { fitAndPredictionDurationMs, validationDurationMs, totalDurationMs: Date.now() - startedAt },
    peakRssBytesApproximation: process.memoryUsage().rss,
  };
  if (dryRun) {
    await mkdir(dirname(dryRunPath), { recursive: true });
    await writeFile(dryRunPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(`CLV A06 dry-run validated: ${rows.length} rows`);
    console.log(`Dry-run report written to ${dryRunPath}`);
  } else {
    const analyticsConfig = loadRfmSnapshotConnectionConfig(process.env);
    if (!analyticsConfig) throw new Error('RFM_SNAPSHOT_DB_* local analytics configuration is required for persisted CLV snapshots');
    const analyticsPool = createRfmSnapshotPool(analyticsConfig);
    try {
      const store = createMysqlCustomerClvSnapshotStore(analyticsPool);
      const existing = await store.findPublishedSnapshot(snapshotKey);
      if (existing) {
        if (existing.inputChecksum === inputChecksum && existing.modelChecksum === descriptor.modelChecksum && existing.outputChecksum === outputChecksum) {
          console.log(`CLV A06 snapshot already published: ${existing.snapshotId}`);
        } else {
          throw new Error('Published CLV snapshot key exists with different checksums');
        }
      } else {
        const persisted = await store.publishSnapshot({ header, rows });
        console.log(`CLV A06 snapshot published: ${persisted.snapshotId} (${persisted.persistedRowCount} rows)`);
      }
    } finally {
      await analyticsPool.end();
    }
  }
} finally {
  await prestashopPool.end();
}

function assertAcceptedFrozenDescriptor(descriptor: CustomerClvTwoStageFrozenCandidateDescriptor, acceptanceArtifact: { acceptanceGates?: Record<string, unknown>; aggregateResults?: { frozenCandidate?: { modelChecksum?: string } } }): void {
  const expected = {
    modelVersion: CUSTOMER_CLV_MODEL_VERSION,
    estimatorPolicyVersion: 'two-stage-cohort-a04-3-far-stale-adjustment-recent2-v1',
    activityTrainingWindowPolicy: 'recent_2_eligible_cutoffs',
    estimateSupportPolicyVersion: 'customer-clv-estimate-support-v1',
    staleAdjustmentPolicyVersion: 'customer-clv-two-stage-stale-activity-adjustment-v1',
    populationPolicyVersion: CUSTOMER_CLV_POPULATION_POLICY_VERSION,
    monetaryPolicyVersion: CUSTOMER_CLV_MONETARY_POLICY_VERSION,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (descriptor[key as keyof CustomerClvTwoStageFrozenCandidateDescriptor] !== value) throw new Error(`Frozen CLV descriptor mismatch for ${key}`);
  }
  if (acceptanceArtifact.acceptanceGates?.frozenDescriptorMatch !== true) throw new Error('A05 accepted artifact does not confirm frozen descriptor match');
  if (acceptanceArtifact.aggregateResults?.frozenCandidate?.modelChecksum !== descriptor.modelChecksum) throw new Error('Frozen CLV descriptor checksum does not match A05 aggregate model checksum');
}

function firstObservedOrderAt(orders: readonly CustomerClvBacktestSourceOrder[]): string | null {
  return orders.map((order) => order.createdAt).sort()[0] ?? null;
}
