import type {
  CustomerCommercialAffinityReadModel,
  CustomerCommercialAffinityRow,
  CustomerCommercialAffinityRuntimeRow,
  CustomerCommercialAffinityRuntimeSnapshot,
} from '../../domain/customer-commercial-affinity/index.js';
import type { CustomerCommercialAffinitySnapshotHeader, CustomerCommercialAffinitySnapshotStore } from '../customer-commercial-affinity-snapshot/index.js';
import { AnalyticsTimeoutError } from '../customer-profile/errors.js';

export const CUSTOMER_COMMERCIAL_AFFINITY_RUNTIME_CONTRACT_VERSION = 'customer-commercial-affinity-runtime-v1';
export const CUSTOMER_COMMERCIAL_AFFINITY_MAX_BATCH_SIZE = 5000;

export type CustomerCommercialAffinityAvailability = 'AVAILABLE' | 'NOT_IN_POPULATION' | 'UNAVAILABLE';
type CustomerCommercialAffinityUnavailableReason = 'no_published_snapshot' | 'affinity_unavailable' | 'affinity_timeout' | 'malformed_snapshot';
type CustomerCommercialAffinityReadFailureReason = Exclude<CustomerCommercialAffinityUnavailableReason, 'no_published_snapshot'>;

export type CustomerCommercialAffinityLookupResult =
  | {
      readonly status: 'available';
      readonly customerId: number;
      readonly availability: 'AVAILABLE';
      readonly affinity: CustomerCommercialAffinityReadModel;
      readonly contractVersion: typeof CUSTOMER_COMMERCIAL_AFFINITY_RUNTIME_CONTRACT_VERSION;
    }
  | {
      readonly status: 'not_in_population';
      readonly customerId: number;
      readonly availability: 'NOT_IN_POPULATION';
      readonly affinity: null;
      readonly contractVersion: typeof CUSTOMER_COMMERCIAL_AFFINITY_RUNTIME_CONTRACT_VERSION;
    }
  | {
      readonly status: 'unavailable';
      readonly customerId: number;
      readonly availability: 'UNAVAILABLE';
      readonly affinity: null;
      readonly reason: CustomerCommercialAffinityUnavailableReason;
      readonly contractVersion: typeof CUSTOMER_COMMERCIAL_AFFINITY_RUNTIME_CONTRACT_VERSION;
    };

export type CustomerCommercialAffinitySnapshotResult =
  | {
      readonly status: 'available';
      readonly availability: 'AVAILABLE';
      readonly snapshot: CustomerCommercialAffinityRuntimeSnapshot;
      readonly contractVersion: typeof CUSTOMER_COMMERCIAL_AFFINITY_RUNTIME_CONTRACT_VERSION;
    }
  | {
      readonly status: 'unavailable';
      readonly availability: 'UNAVAILABLE';
      readonly snapshot: null;
      readonly reason: CustomerCommercialAffinityUnavailableReason;
      readonly contractVersion: typeof CUSTOMER_COMMERCIAL_AFFINITY_RUNTIME_CONTRACT_VERSION;
    };

export type GetCustomerCommercialAffinity = (input: { readonly customerId: number }) => Promise<CustomerCommercialAffinityLookupResult>;
export type GetCustomerCommercialAffinities = (input: { readonly customerIds: readonly number[] }) => Promise<readonly CustomerCommercialAffinityLookupResult[]>;
export type GetCustomerCommercialAffinitySnapshot = () => Promise<CustomerCommercialAffinitySnapshotResult>;

type AffinityReader = Pick<CustomerCommercialAffinitySnapshotStore, 'getActiveSnapshotMetadata' | 'getCustomerAffinity' | 'getCustomerAffinities'>;

export function createGetCustomerCommercialAffinity(deps: { readonly reader: AffinityReader }): {
  readonly getCustomerAffinity: GetCustomerCommercialAffinity;
  readonly getCustomerAffinities: GetCustomerCommercialAffinities;
  readonly getSnapshot: GetCustomerCommercialAffinitySnapshot;
} {
  const getSnapshot: GetCustomerCommercialAffinitySnapshot = async () => {
    try {
      const header = await deps.reader.getActiveSnapshotMetadata();
      if (header === null) return unavailableSnapshot('no_published_snapshot');
      return { status: 'available', availability: 'AVAILABLE', snapshot: toRuntimeSnapshot(header), contractVersion: CUSTOMER_COMMERCIAL_AFFINITY_RUNTIME_CONTRACT_VERSION };
    } catch (error) {
      return unavailableSnapshot(reasonForError(error));
    }
  };

  const getCustomerAffinity: GetCustomerCommercialAffinity = async ({ customerId }) => {
    assertCustomerId(customerId);
    try {
      const header = await deps.reader.getActiveSnapshotMetadata();
      if (header === null) return unavailableCustomer(customerId, 'no_published_snapshot');
      const snapshot = toRuntimeSnapshot(header);
      const rows = await deps.reader.getCustomerAffinity(customerId);
      if (rows.length === 0) return { status: 'not_in_population', customerId, availability: 'NOT_IN_POPULATION', affinity: null, contractVersion: CUSTOMER_COMMERCIAL_AFFINITY_RUNTIME_CONTRACT_VERSION };
      return { status: 'available', customerId, availability: 'AVAILABLE', affinity: { customerId, snapshot, affinities: sortRuntimeRows(rows.map(toRuntimeRow)) }, contractVersion: CUSTOMER_COMMERCIAL_AFFINITY_RUNTIME_CONTRACT_VERSION };
    } catch (error) {
      return unavailableCustomer(customerId, reasonForError(error));
    }
  };

  const getCustomerAffinities: GetCustomerCommercialAffinities = async ({ customerIds }) => {
    assertBatchSize(customerIds);
    const uniqueCustomerIds = [...new Set(customerIds)];
    uniqueCustomerIds.forEach(assertCustomerId);
    if (uniqueCustomerIds.length === 0) return [];
    try {
      const header = await deps.reader.getActiveSnapshotMetadata();
      if (header === null) return uniqueCustomerIds.map((customerId) => unavailableCustomer(customerId, 'no_published_snapshot'));
      const snapshot = toRuntimeSnapshot(header);
      const rows = await deps.reader.getCustomerAffinities(uniqueCustomerIds);
      const rowsByCustomerId = new Map<number, CustomerCommercialAffinityRuntimeRow[]>();
      for (const row of rows) {
        const customerRows = rowsByCustomerId.get(row.customerId) ?? [];
        customerRows.push(toRuntimeRow(row));
        rowsByCustomerId.set(row.customerId, customerRows);
      }
      return uniqueCustomerIds.map((customerId) => {
        const affinities = sortRuntimeRows(rowsByCustomerId.get(customerId) ?? []);
        return affinities.length === 0
          ? { status: 'not_in_population' as const, customerId, availability: 'NOT_IN_POPULATION' as const, affinity: null, contractVersion: CUSTOMER_COMMERCIAL_AFFINITY_RUNTIME_CONTRACT_VERSION }
          : { status: 'available' as const, customerId, availability: 'AVAILABLE' as const, affinity: { customerId, snapshot, affinities }, contractVersion: CUSTOMER_COMMERCIAL_AFFINITY_RUNTIME_CONTRACT_VERSION };
      });
    } catch (error) {
      const reason = reasonForError(error);
      return uniqueCustomerIds.map((customerId) => unavailableCustomer(customerId, reason));
    }
  };

  return { getCustomerAffinity, getCustomerAffinities, getSnapshot };
}

export const getCustomerCommercialAffinityNotConfigured: GetCustomerCommercialAffinity = async ({ customerId }) => unavailableCustomer(customerId, 'affinity_unavailable');
export const getCustomerCommercialAffinitiesNotConfigured: GetCustomerCommercialAffinities = async ({ customerIds }) => {
  assertBatchSize(customerIds);
  return [...new Set(customerIds)].map((customerId) => unavailableCustomer(customerId, 'affinity_unavailable'));
};
export const getCustomerCommercialAffinitySnapshotNotConfigured: GetCustomerCommercialAffinitySnapshot = async () => unavailableSnapshot('affinity_unavailable');

function toRuntimeSnapshot(header: CustomerCommercialAffinitySnapshotHeader): CustomerCommercialAffinityRuntimeSnapshot {
  if (header.snapshotId === null || header.status !== 'published') throw new Error('Malformed active affinity snapshot');
  const fields = [header.calculationVersion, header.referenceTime, header.productSemanticSnapshotId, header.productSemanticSchemaVersion, header.ontologyVersion, header.ontologyHash, header.sourceSemanticChecksum, header.consumerSemanticChecksum, header.affinityDatasetChecksum];
  if (fields.some((value) => typeof value !== 'string' || value.trim() === '') || !Number.isSafeInteger(Number(header.snapshotId)) || Number(header.snapshotId) <= 0 || Number.isNaN(Date.parse(header.referenceTime))) throw new Error('Malformed active affinity snapshot');
  for (const checksum of [header.ontologyHash, header.sourceSemanticChecksum, header.consumerSemanticChecksum, header.affinityDatasetChecksum]) {
    if (!/^(?:sha256:)?[a-f0-9]{64}$/u.test(checksum)) throw new Error('Malformed active affinity snapshot');
  }
  return {
    snapshotId: header.snapshotId,
    calculationVersion: header.calculationVersion,
    referenceTime: header.referenceTime,
    productSemanticSnapshotId: header.productSemanticSnapshotId,
    productSemanticSchemaVersion: header.productSemanticSchemaVersion,
    ontologyVersion: header.ontologyVersion,
    ontologyHash: header.ontologyHash,
    sourceSemanticChecksum: header.sourceSemanticChecksum,
    consumerSemanticChecksum: header.consumerSemanticChecksum,
    affinityDatasetChecksum: header.affinityDatasetChecksum,
  };
}

function toRuntimeRow(row: CustomerCommercialAffinityRow): CustomerCommercialAffinityRuntimeRow {
  return {
    affinityAxis: row.affinityAxis,
    affinityCode: row.affinityCode,
    score: row.score,
    supportingOrderCount: row.supportingOrderCount,
    supportingProductCount: row.supportingProductCount,
    supportingSpend: row.supportingSpend,
    lastEvidenceAt: row.lastEvidenceAt,
    explicitEvidenceCoverage: row.explicitEvidenceCoverage,
  };
}

function sortRuntimeRows(rows: readonly CustomerCommercialAffinityRuntimeRow[]): readonly CustomerCommercialAffinityRuntimeRow[] {
  return [...rows].sort((left, right) => compareStrings(left.affinityAxis, right.affinityAxis) || compareStrings(left.affinityCode, right.affinityCode));
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unavailableCustomer(customerId: number, reason: CustomerCommercialAffinityUnavailableReason): CustomerCommercialAffinityLookupResult {
  return { status: 'unavailable', customerId, availability: 'UNAVAILABLE', affinity: null, reason, contractVersion: CUSTOMER_COMMERCIAL_AFFINITY_RUNTIME_CONTRACT_VERSION };
}

function unavailableSnapshot(reason: CustomerCommercialAffinityUnavailableReason): CustomerCommercialAffinitySnapshotResult {
  return { status: 'unavailable', availability: 'UNAVAILABLE', snapshot: null, reason, contractVersion: CUSTOMER_COMMERCIAL_AFFINITY_RUNTIME_CONTRACT_VERSION };
}

function reasonForError(error: unknown): CustomerCommercialAffinityReadFailureReason {
  if (error instanceof AnalyticsTimeoutError) return 'affinity_timeout';
  if (error instanceof Error && /Malformed active affinity snapshot|Invalid persisted affinity/i.test(error.message)) return 'malformed_snapshot';
  return 'affinity_unavailable';
}

function assertCustomerId(customerId: number): void {
  if (!Number.isSafeInteger(customerId) || customerId <= 0) throw new Error('customerId must be a positive integer');
}

function assertBatchSize(customerIds: readonly number[]): void {
  if (customerIds.length > CUSTOMER_COMMERCIAL_AFFINITY_MAX_BATCH_SIZE) throw new Error(`Customer Commercial Affinity batch exceeds maximum size of ${CUSTOMER_COMMERCIAL_AFFINITY_MAX_BATCH_SIZE}`);
}
