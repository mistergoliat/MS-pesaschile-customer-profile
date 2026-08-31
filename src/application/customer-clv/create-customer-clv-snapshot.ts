import {
  assertValidCustomerClvSnapshotHeader,
  assertValidCustomerClvSnapshotRow,
  type CustomerClvEstimateSupportLevel,
  type CustomerClvSnapshotHeader,
  type CustomerClvSnapshotRow,
  type CustomerClvTrainingMetadata as CustomerClvDomainTrainingMetadata,
} from '../../domain/customer-clv/index.js';
import { sha256Stable } from '../../domain/customer-rfm/checksum.js';

export type CustomerClvProductionSnapshotHeader = Omit<CustomerClvSnapshotHeader, 'trainingMetadata'> & {
  readonly modelVersion: string;
  readonly estimatorPolicyVersion: string;
  readonly activityModelVersion: string;
  readonly activityTrainingWindowPolicy: string;
  readonly activityRecalibrationVersion: string;
  readonly staleAdjustmentPolicyVersion: string;
  readonly conditionalValuePolicyVersion: string;
  readonly rankRefinementPolicyVersion: string;
  readonly estimateSupportPolicyVersion: string;
  readonly trainingTimePolicyVersion: string;
  readonly datasetVersion: string;
  readonly identityAuthority: 'prestashop_customer';
  readonly sourceAvailableDataThrough: string;
  readonly acceptedValidationDecision: string;
  readonly acceptedValidationArtifactVersion: string;
  readonly acceptedValidationArtifactChecksum: string;
  readonly modelChecksum: string;
  readonly inputChecksum: string;
  readonly trainingMetadata: CustomerClvProductionTrainingMetadata;
};

export type CustomerClvProductionTrainingMetadata = CustomerClvDomainTrainingMetadata & {
  readonly trainingCutoffs: readonly string[];
  readonly effectiveStageATrainingCutoffs: readonly string[];
  readonly effectiveStageBTrainingCutoffs: readonly string[];
  readonly trainingDatasetChecksums: readonly string[];
  readonly trainingRowCount: number;
  readonly temporalStatePolicyVersion: string;
};

export type CustomerClvProductionSnapshotInput = {
  readonly header: CustomerClvProductionSnapshotHeader;
  readonly rows: readonly CustomerClvSnapshotRow[];
};

export type CustomerClvPublishedSnapshotLookup = {
  readonly snapshotId: string;
  readonly inputChecksum: string;
  readonly modelChecksum: string;
  readonly outputChecksum: string;
};

export type CustomerClvPersistedSnapshotResult = {
  readonly snapshotId: string;
  readonly persistedRowCount: number;
  readonly outputChecksum: string;
};

export interface CustomerClvSnapshotStore {
  findPublishedSnapshot(snapshotKey: string): Promise<CustomerClvPublishedSnapshotLookup | null>;
  publishSnapshot(input: CustomerClvProductionSnapshotInput): Promise<CustomerClvPersistedSnapshotResult>;
  getActiveSnapshotMetadata(): Promise<CustomerClvProductionSnapshotHeader | null>;
  getCustomerClv(snapshotId: string, customerId: number): Promise<CustomerClvSnapshotRow | null>;
  hasCustomer(snapshotId: string, customerId: number): Promise<boolean>;
  getRows(snapshotId: string, limit: number, offset: number): Promise<readonly CustomerClvSnapshotRow[]>;
}

export class CustomerClvFrozenDescriptorMismatchError extends Error {
  constructor(reason: string) {
    super(`Frozen CLV descriptor mismatch: ${reason}`);
    this.name = 'CustomerClvFrozenDescriptorMismatchError';
  }
}

export class CustomerClvSnapshotKeyConflictError extends Error {
  constructor() {
    super('A published CLV snapshot already exists for this snapshot key with different checksums');
    this.name = 'CustomerClvSnapshotKeyConflictError';
  }
}

export function validateCustomerClvProductionSnapshot(input: CustomerClvProductionSnapshotInput): {
  readonly outputChecksum: string;
  readonly populationSize: number;
  readonly supportCounts: Readonly<Record<CustomerClvEstimateSupportLevel, number>>;
} {
  assertValidCustomerClvSnapshotHeader(input.header as CustomerClvSnapshotHeader);
  const seen = new Set<number>();
  const supportCounts = { SPARSE: 0, SUPPORTED: 0 } satisfies Record<CustomerClvEstimateSupportLevel, number>;
  for (const row of input.rows) {
    assertValidCustomerClvSnapshotRow(row);
    if (seen.has(row.customerId)) throw new Error(`Duplicate CLV snapshot customerId: ${row.customerId}`);
    seen.add(row.customerId);
    supportCounts[row.estimateSupportLevel] += 1;
  }
  if (input.header.populationSize !== input.rows.length) {
    throw new Error(`CLV snapshot population mismatch: header=${input.header.populationSize} rows=${input.rows.length}`);
  }
  if (!input.rows.every((row) => row.customerId > 0)) throw new Error('CLV snapshot contains an invalid customer identity');
  const outputChecksum = sha256Stable({
    snapshotKey: input.header.snapshotKey,
    referenceTime: input.header.referenceTime,
    rows: [...input.rows].sort((left, right) => left.customerId - right.customerId),
  });
  if (outputChecksum !== input.header.outputChecksum) throw new Error('CLV snapshot output checksum mismatch');
  return { outputChecksum, populationSize: input.rows.length, supportCounts };
}
