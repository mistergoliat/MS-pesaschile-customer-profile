import {
  assertNonEmptyIdentifier,
  assertNonNegativeCount,
  assertPositiveInt,
  assertValidAffinityRow,
  assertValidIsoTimestamp,
  isValidAffinityScore,
  isValidDecimalString,
  type CustomerCommercialAffinityAxis,
  type CustomerCommercialAffinityRow,
  customerCommercialAffinityCalculationVersion,
  customerCommercialAffinityIdentityAuthority,
  buildCustomerCommercialAffinitySnapshotKey,
} from '../../domain/customer-commercial-affinity/index.js';
import type {
  CustomerCommercialAffinityPopulation,
  CustomerCommercialAffinityPopulationManifest,
} from '../customer-commercial-affinity-population/index.js';
import { calculateCustomerCommercialAffinityDatasetChecksum } from '../customer-commercial-affinity-population/index.js';
import type { ProductSemanticSnapshotConsumerMetadata } from '../product-semantic-snapshot/consumer.js';

export type CustomerCommercialAffinitySnapshotStatus = 'building' | 'validated' | 'published' | 'failed' | 'superseded';

export type CustomerCommercialAffinitySnapshotPerformanceMetadata = {
  readonly sourceReadDurationMs?: number;
  readonly populationBuildDurationMs?: number;
  readonly validationDurationMs?: number;
  readonly persistenceDurationMs?: number;
  readonly totalDurationMs?: number;
  readonly batchSize?: number;
  readonly sourceQueries?: number;
  readonly sourceRetries?: number;
};

export type CustomerCommercialAffinitySnapshotHeader = {
  readonly snapshotId: string | null;
  readonly snapshotKey: string;
  readonly status: CustomerCommercialAffinitySnapshotStatus;
  readonly calculationVersion: string;
  readonly referenceTime: string;
  readonly generatedAt: string;
  readonly populationPolicyVersion: string;
  readonly orderEligibilityPolicyVersion: string;
  readonly productSemanticSnapshotId: string;
  readonly productSemanticSchemaVersion: string;
  readonly ontologyVersion: string;
  readonly ontologyHash: string;
  readonly sourceSemanticChecksum: string;
  readonly consumerSemanticChecksum: string;
  readonly sourceCustomerCount: number;
  readonly eligibleCustomerCount: number;
  readonly eligibleOrderCount: number;
  readonly eligibleOrderLineCount: number;
  readonly customersWithAffinity: number;
  readonly customersWithoutAffinity: number;
  readonly affinityRowCount: number;
  readonly datasetChecksum: string;
  readonly affinityDatasetChecksum: string;
  readonly identityAuthority: 'prestashop_customer';
  readonly sourceWatermarkOrderId: number | null;
  readonly semanticCoverage: CustomerCommercialAffinityPopulationManifest['coverage'];
  readonly semanticSnapshotMetadata: ProductSemanticSnapshotConsumerMetadata;
  readonly populationManifest: CustomerCommercialAffinityPopulationManifest;
  readonly performanceMetadata?: CustomerCommercialAffinitySnapshotPerformanceMetadata;
};

export type CustomerCommercialAffinitySnapshotInput = {
  readonly header: CustomerCommercialAffinitySnapshotHeader;
  readonly rows: readonly CustomerCommercialAffinityRow[];
};

export type CustomerCommercialAffinitySnapshotValidation = {
  readonly affinityDatasetChecksum: string;
  readonly populationSize: number;
  readonly axisCounts: Readonly<Record<CustomerCommercialAffinityAxis, number>>;
};

export type CustomerCommercialAffinitySnapshotLookup = {
  readonly snapshotId: string;
  readonly status: CustomerCommercialAffinitySnapshotStatus;
  readonly datasetChecksum: string;
  readonly affinityDatasetChecksum: string;
};

export type CustomerCommercialAffinityPersistedSnapshotResult = {
  readonly snapshotId: string;
  readonly persistedRowCount: number;
  readonly affinityDatasetChecksum: string;
};

export interface CustomerCommercialAffinitySnapshotStore {
  findSnapshotByKey(snapshotKey: string): Promise<CustomerCommercialAffinitySnapshotLookup | null>;
  publishSnapshot(input: CustomerCommercialAffinitySnapshotInput): Promise<CustomerCommercialAffinityPersistedSnapshotResult>;
  createBuilding(header: CustomerCommercialAffinitySnapshotHeader): Promise<string>;
  writeRows(snapshotId: string, rows: readonly CustomerCommercialAffinityRow[]): Promise<void>;
  markValidated(snapshotId: string): Promise<void>;
  publish(snapshotId: string): Promise<void>;
  markFailed(snapshotId: string, reason: string): Promise<void>;
  getActiveSnapshotMetadata(): Promise<CustomerCommercialAffinitySnapshotHeader | null>;
  getCustomerAffinity(customerId: number): Promise<readonly CustomerCommercialAffinityRow[]>;
  getCustomerAffinities(customerIds: readonly number[]): Promise<readonly CustomerCommercialAffinityRow[]>;
}

export type CreateCustomerCommercialAffinitySnapshotResult = {
  readonly mode: 'dry_run' | 'persisted' | 'skipped_existing';
  readonly snapshotKey: string;
  readonly snapshotId: string | null;
  readonly header: CustomerCommercialAffinitySnapshotHeader;
  readonly rows: readonly CustomerCommercialAffinityRow[];
  readonly validation: CustomerCommercialAffinitySnapshotValidation;
};

export class CustomerCommercialAffinitySnapshotKeyConflictError extends Error {
  constructor() {
    super('A Customer Commercial Affinity snapshot already exists for this key with different checksums');
    this.name = 'CustomerCommercialAffinitySnapshotKeyConflictError';
  }
}

export function buildCustomerCommercialAffinitySnapshotHeader(input: {
  readonly population: CustomerCommercialAffinityPopulation;
  readonly semanticSnapshotMetadata: ProductSemanticSnapshotConsumerMetadata;
  readonly generatedAt: string;
  readonly sourceWatermarkOrderId: number | null;
  readonly performanceMetadata?: CustomerCommercialAffinitySnapshotPerformanceMetadata;
}): CustomerCommercialAffinitySnapshotHeader {
  const manifest = input.population.manifest;
  const snapshotKey = buildCustomerCommercialAffinitySnapshotKey({
    calculationVersion: manifest.calculationVersion,
    productSemanticSnapshotId: manifest.productSemanticSnapshotId,
    productSemanticSnapshotVersion: manifest.productSemanticSnapshotVersion,
    ontologyHash: manifest.ontologyHash,
    populationPolicyVersion: manifest.populationPolicyVersion,
    referenceTime: manifest.referenceTime,
    consumerSemanticChecksum: manifest.consumerSemanticChecksum,
    datasetChecksum: manifest.datasetChecksum,
  });
  return {
    snapshotId: null,
    snapshotKey,
    status: 'building',
    calculationVersion: manifest.calculationVersion,
    referenceTime: manifest.referenceTime,
    generatedAt: input.generatedAt,
    populationPolicyVersion: manifest.populationPolicyVersion,
    orderEligibilityPolicyVersion: manifest.orderEligibilityPolicyVersion,
    productSemanticSnapshotId: manifest.productSemanticSnapshotId,
    productSemanticSchemaVersion: manifest.productSemanticSnapshotVersion,
    ontologyVersion: manifest.ontologyVersion,
    ontologyHash: manifest.ontologyHash,
    sourceSemanticChecksum: manifest.sourceSemanticChecksum,
    consumerSemanticChecksum: manifest.consumerSemanticChecksum,
    sourceCustomerCount: manifest.sourceCustomerCount,
    eligibleCustomerCount: manifest.eligibleCustomerCount,
    eligibleOrderCount: manifest.eligibleOrderCount,
    eligibleOrderLineCount: manifest.eligibleOrderLineCount,
    customersWithAffinity: manifest.customersWithAffinityRows,
    customersWithoutAffinity: manifest.customersWithoutAffinityRows,
    affinityRowCount: manifest.affinityRowCount,
    datasetChecksum: manifest.datasetChecksum,
    affinityDatasetChecksum: manifest.affinityDatasetChecksum,
    identityAuthority: customerCommercialAffinityIdentityAuthority,
    sourceWatermarkOrderId: input.sourceWatermarkOrderId,
    semanticCoverage: manifest.coverage,
    semanticSnapshotMetadata: input.semanticSnapshotMetadata,
    populationManifest: manifest,
    ...(input.performanceMetadata === undefined ? {} : { performanceMetadata: input.performanceMetadata }),
  };
}

export function validateCustomerCommercialAffinitySnapshot(input: CustomerCommercialAffinitySnapshotInput): CustomerCommercialAffinitySnapshotValidation {
  validateHeader(input.header);
  if (input.header.affinityRowCount !== input.rows.length) {
    throw new Error(`Affinity snapshot row count mismatch: header=${input.header.affinityRowCount} rows=${input.rows.length}`);
  }
  const seen = new Set<string>();
  const axisCounts: Record<CustomerCommercialAffinityAxis, number> = { PRODUCT_FAMILY: 0, DISCIPLINE: 0, USE_CONTEXT: 0 };
  for (const row of input.rows) {
    assertValidAffinityRow(row);
    assertPositiveInt(row.supportingOrderCount, 'supportingOrderCount');
    assertPositiveInt(row.supportingProductCount, 'supportingProductCount');
    assertPersistableDecimal(row.supportingSpend, 'supportingSpend', 20, 6);
    assertFixedPointRoundTrip(row.score, 'score', 9);
    if (row.explicitEvidenceCoverage !== null) assertFixedPointRoundTrip(row.explicitEvidenceCoverage, 'explicitEvidenceCoverage', 9);
    if (!isAllowedAxis(row.affinityAxis)) throw new Error(`Invalid affinityAxis: ${row.affinityAxis}`);
    const rowKey = `${row.customerId}\u0000${row.affinityAxis}\u0000${row.affinityCode}`;
    if (seen.has(rowKey)) throw new Error(`Duplicate affinity snapshot row: ${rowKey}`);
    seen.add(rowKey);
    if (Date.parse(row.lastEvidenceAt) >= Date.parse(input.header.referenceTime)) {
      throw new Error(`Affinity row lastEvidenceAt must be before referenceTime: ${row.customerId}/${row.affinityCode}`);
    }
    axisCounts[row.affinityAxis] += 1;
  }
  const affinityDatasetChecksum = calculateAffinityDatasetChecksum(input.header, input.rows);
  if (affinityDatasetChecksum !== input.header.affinityDatasetChecksum) {
    throw new Error('Affinity snapshot checksum mismatch');
  }
  return { affinityDatasetChecksum, populationSize: input.rows.length, axisCounts };
}

export function calculateAffinityDatasetChecksum(
  header: CustomerCommercialAffinitySnapshotHeader,
  rows: readonly CustomerCommercialAffinityRow[],
): string {
  return calculateCustomerCommercialAffinityDatasetChecksum({
    referenceTime: header.referenceTime,
    semanticSnapshot: header.semanticSnapshotMetadata,
    rows,
  });
}

function validateHeader(header: CustomerCommercialAffinitySnapshotHeader): void {
  if (header.snapshotId !== null) throw new Error('New affinity snapshot header must not have a database snapshotId');
  if (header.status !== 'building') throw new Error(`New affinity snapshot must start as building, got ${header.status}`);
  assertNonEmptyIdentifier(header.snapshotKey, 'snapshotKey');
  assertNonEmptyIdentifier(header.calculationVersion, 'calculationVersion');
  assertNonEmptyIdentifier(header.populationPolicyVersion, 'populationPolicyVersion');
  assertNonEmptyIdentifier(header.orderEligibilityPolicyVersion, 'orderEligibilityPolicyVersion');
  assertNonEmptyIdentifier(header.productSemanticSnapshotId, 'productSemanticSnapshotId');
  assertNonEmptyIdentifier(header.productSemanticSchemaVersion, 'productSemanticSchemaVersion');
  assertNonEmptyIdentifier(header.ontologyVersion, 'ontologyVersion');
  assertNonEmptyIdentifier(header.ontologyHash, 'ontologyHash');
  assertChecksum(header.sourceSemanticChecksum, 'sourceSemanticChecksum');
  assertChecksum(header.consumerSemanticChecksum, 'consumerSemanticChecksum');
  assertChecksum(header.datasetChecksum, 'datasetChecksum');
  assertChecksum(header.affinityDatasetChecksum, 'affinityDatasetChecksum');
  assertValidUtcTimestamp(header.referenceTime, 'referenceTime');
  assertValidUtcTimestamp(header.generatedAt, 'generatedAt');
  if (header.identityAuthority !== customerCommercialAffinityIdentityAuthority) throw new Error(`Invalid identityAuthority: ${header.identityAuthority}`);
  for (const [name, value] of Object.entries({
    sourceCustomerCount: header.sourceCustomerCount,
    eligibleCustomerCount: header.eligibleCustomerCount,
    eligibleOrderCount: header.eligibleOrderCount,
    eligibleOrderLineCount: header.eligibleOrderLineCount,
    customersWithAffinity: header.customersWithAffinity,
    customersWithoutAffinity: header.customersWithoutAffinity,
    affinityRowCount: header.affinityRowCount,
  })) assertNonNegativeCount(value, name);
  if (header.eligibleCustomerCount > header.sourceCustomerCount) throw new Error('eligibleCustomerCount cannot exceed sourceCustomerCount');
  if (header.customersWithAffinity + header.customersWithoutAffinity !== header.eligibleCustomerCount) throw new Error('Affinity customer coverage counts do not reconcile');
  if (header.sourceWatermarkOrderId !== null) assertPositiveInt(header.sourceWatermarkOrderId, 'sourceWatermarkOrderId');
  if (header.calculationVersion !== customerCommercialAffinityCalculationVersion) throw new Error(`Unexpected affinity calculationVersion: ${header.calculationVersion}`);
  const manifest = header.populationManifest;
  const lineageFields: readonly [string, unknown, unknown][] = [
    ['calculationVersion', header.calculationVersion, manifest.calculationVersion],
    ['referenceTime', header.referenceTime, manifest.referenceTime],
    ['populationPolicyVersion', header.populationPolicyVersion, manifest.populationPolicyVersion],
    ['orderEligibilityPolicyVersion', header.orderEligibilityPolicyVersion, manifest.orderEligibilityPolicyVersion],
    ['productSemanticSnapshotId', header.productSemanticSnapshotId, manifest.productSemanticSnapshotId],
    ['productSemanticSchemaVersion', header.productSemanticSchemaVersion, manifest.productSemanticSnapshotVersion],
    ['ontologyVersion', header.ontologyVersion, manifest.ontologyVersion],
    ['ontologyHash', header.ontologyHash, manifest.ontologyHash],
    ['sourceSemanticChecksum', header.sourceSemanticChecksum, manifest.sourceSemanticChecksum],
    ['consumerSemanticChecksum', header.consumerSemanticChecksum, manifest.consumerSemanticChecksum],
    ['datasetChecksum', header.datasetChecksum, manifest.datasetChecksum],
    ['affinityDatasetChecksum', header.affinityDatasetChecksum, manifest.affinityDatasetChecksum],
    ['semanticSnapshotMetadata.snapshotId', header.semanticSnapshotMetadata.snapshotId, header.productSemanticSnapshotId],
    ['semanticSnapshotMetadata.schemaVersion', header.semanticSnapshotMetadata.schemaVersion, header.productSemanticSchemaVersion],
    ['semanticSnapshotMetadata.ontologyVersion', header.semanticSnapshotMetadata.ontologyVersion, header.ontologyVersion],
    ['semanticSnapshotMetadata.ontologyHash', header.semanticSnapshotMetadata.ontologyHash, header.ontologyHash],
    ['semanticSnapshotMetadata.sourceSemanticChecksum', header.semanticSnapshotMetadata.sourceSemanticChecksum, header.sourceSemanticChecksum],
    ['semanticSnapshotMetadata.consumerNormalizedChecksum', header.semanticSnapshotMetadata.consumerNormalizedChecksum, header.consumerSemanticChecksum],
  ];
  for (const [name, actual, expected] of lineageFields) if (actual !== expected) throw new Error(`Affinity snapshot lineage mismatch: ${name}`);
  const expectedKey = buildCustomerCommercialAffinitySnapshotKey({
    calculationVersion: header.calculationVersion,
    productSemanticSnapshotId: header.productSemanticSnapshotId,
    productSemanticSnapshotVersion: header.productSemanticSchemaVersion,
    ontologyHash: header.ontologyHash,
    populationPolicyVersion: header.populationPolicyVersion,
    referenceTime: header.referenceTime,
    consumerSemanticChecksum: header.consumerSemanticChecksum,
    datasetChecksum: header.datasetChecksum,
  });
  if (header.snapshotKey !== expectedKey) throw new Error('Affinity snapshot key does not match immutable lineage');
  for (const [name, value] of Object.entries(header.semanticCoverage)) {
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`Invalid semantic coverage: ${name}`);
  }
}

function assertValidUtcTimestamp(value: string, name: string): void {
  assertValidIsoTimestamp(value, name);
  if (!value.endsWith('Z')) throw new Error(`${name} must be a UTC timestamp`);
}

function assertChecksum(value: string, name: string): void {
  if (!/^(?:sha256:)?[a-f0-9]{64}$/u.test(value)) throw new Error(`Invalid ${name}`);
}

function assertPersistableDecimal(value: string, name: string, precision: number, scale: number): void {
  if (!isValidDecimalString(value)) throw new Error(`Invalid ${name}`);
  const [integer = '', fraction = ''] = value.trim().split('.');
  if (fraction.length > scale || integer.length > precision - scale) throw new Error(`${name} exceeds DECIMAL(${precision},${scale}) storage`);
}

function assertFixedPointRoundTrip(value: number, name: string, scale: number): void {
  if (!isValidAffinityScore(value) || Number(value.toFixed(scale)) !== value) throw new Error(`${name} cannot round-trip through DECIMAL fixed-point storage`);
}

function isAllowedAxis(value: string): value is CustomerCommercialAffinityAxis {
  return value === 'PRODUCT_FAMILY' || value === 'DISCIPLINE' || value === 'USE_CONTEXT';
}
