import {
  assertNonEmptyString,
  assertValidCustomerClvSnapshotHeader,
  assertValidCustomerClvSnapshotRow,
} from '../../domain/customer-clv/index.js';
import type { CustomerClvProductionSnapshotHeader } from './create-customer-clv-snapshot.js';
import { AnalyticsTimeoutError } from '../customer-profile/errors.js';
import type { CustomerClvActiveSnapshotReader } from '../customer-intelligence/ports.js';
import {
  CustomerClvMalformedSnapshotError,
  isCustomerClvMalformedSnapshotError,
  isCustomerClvReadInfrastructureError,
} from './errors.js';

export const CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION = 'customer-clv-runtime-v1';

export type CustomerClvApi = {
  readonly horizonMonths: 12;
  readonly expectedRevenueTaxIncl: string;
  readonly expectedOrders?: string;
  readonly currencyIsoCode: 'CLP';
  readonly estimateSupportLevel: 'SPARSE' | 'SUPPORTED';
  readonly modelVersion: string;
  readonly estimatorPolicyVersion: string;
  readonly referenceTime: string;
  readonly generatedAt: string;
  readonly snapshotId: string;
  readonly snapshotKey: string;
  readonly sourceAvailableDataThrough: string;
};

export type GetCustomerClvResult =
  | { readonly status: 'available'; readonly customerId: number; readonly clv: CustomerClvApi; readonly contractVersion: typeof CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION }
  | { readonly status: 'no_active_clv_snapshot'; readonly customerId: number; readonly error: 'NO_ACTIVE_CLV_SNAPSHOT'; readonly contractVersion: typeof CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION }
  | { readonly status: 'customer_clv_not_found'; readonly customerId: number; readonly error: 'CUSTOMER_CLV_NOT_FOUND'; readonly contractVersion: typeof CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION }
  | { readonly status: 'degraded'; readonly customerId: number; readonly reason: 'clv_unavailable' | 'clv_timeout'; readonly contractVersion: typeof CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION }
  | { readonly status: 'malformed_clv_snapshot'; readonly customerId: number; readonly error: 'MALFORMED_CLV_SNAPSHOT'; readonly contractVersion: typeof CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION };

export type GetCustomerClv = (input: { readonly customerId: number }) => Promise<GetCustomerClvResult>;

export function createGetCustomerClv(deps: { readonly reader: CustomerClvActiveSnapshotReader }): GetCustomerClv {
  return async ({ customerId }) => {
    try {
      const snapshot = await deps.reader.getActiveSnapshotMetadata();
      if (snapshot === null) {
        return { status: 'no_active_clv_snapshot', customerId, error: 'NO_ACTIVE_CLV_SNAPSHOT', contractVersion: CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION };
      }
      validateProductionHeader(snapshot);
      const row = await deps.reader.getCustomerClv(snapshot.snapshotId!, customerId);
      if (row === null) {
        return { status: 'customer_clv_not_found', customerId, error: 'CUSTOMER_CLV_NOT_FOUND', contractVersion: CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION };
      }
      assertValidCustomerClvSnapshotRow(row);
      return { status: 'available', customerId, clv: toApi(snapshot, row), contractVersion: CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION };
    } catch (error) {
      if (isCustomerClvMalformedSnapshotError(error) || (!(isCustomerClvReadInfrastructureError(error)) && error instanceof Error && /Invalid (?:customerId|expected|estimate|horizon|currency|model|reference|snapshot|source|generated)/i.test(error.message))) {
        return { status: 'malformed_clv_snapshot', customerId, error: 'MALFORMED_CLV_SNAPSHOT', contractVersion: CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION };
      }
      if (isCustomerClvReadInfrastructureError(error)) {
        return {
          status: 'degraded',
          customerId,
          reason: error instanceof AnalyticsTimeoutError ? 'clv_timeout' : 'clv_unavailable',
          contractVersion: CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION,
        };
      }
      throw error;
    }
  };
}

export const getCustomerClvNotConfigured: GetCustomerClv = async ({ customerId }) => ({
  status: 'degraded',
  customerId,
  reason: 'clv_unavailable',
  contractVersion: CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION,
});

export function validateProductionHeader(header: CustomerClvProductionSnapshotHeader): void {
  assertValidCustomerClvSnapshotHeader(header);
  if (header.snapshotId === null || header.status !== 'published') throw new CustomerClvMalformedSnapshotError('Active CLV snapshot is not published');
  const requiredStringFields = [
    'snapshotKey', 'modelVersion', 'estimatorPolicyVersion', 'activityModelVersion',
    'activityTrainingWindowPolicy', 'activityRecalibrationVersion', 'staleAdjustmentPolicyVersion',
    'conditionalValuePolicyVersion', 'rankRefinementPolicyVersion', 'estimateSupportPolicyVersion',
    'trainingTimePolicyVersion', 'datasetVersion', 'sourceAvailableDataThrough',
    'acceptedValidationDecision', 'acceptedValidationArtifactVersion', 'acceptedValidationArtifactChecksum',
    'modelChecksum', 'inputChecksum', 'outputChecksum', 'datasetChecksum',
  ] as const;
  for (const name of requiredStringFields) {
    const value = header[name];
    if (typeof value !== 'string' || value.trim() === '') throw new CustomerClvMalformedSnapshotError(`Malformed CLV snapshot header field: ${name}`);
    assertNonEmptyString(value, name);
  }
}

function toApi(header: CustomerClvProductionSnapshotHeader, row: { readonly expectedRevenueTaxIncl: string; readonly expectedOrders?: string; readonly estimateSupportLevel: 'SPARSE' | 'SUPPORTED' }): CustomerClvApi {
  return {
    horizonMonths: header.horizonMonths,
    expectedRevenueTaxIncl: row.expectedRevenueTaxIncl,
    ...(row.expectedOrders === undefined ? {} : { expectedOrders: row.expectedOrders }),
    currencyIsoCode: header.currencyIsoCode,
    estimateSupportLevel: row.estimateSupportLevel,
    modelVersion: header.modelVersion,
    estimatorPolicyVersion: header.estimatorPolicyVersion,
    referenceTime: header.referenceTime,
    generatedAt: header.generatedAt,
    snapshotId: header.snapshotId!,
    snapshotKey: header.snapshotKey,
    sourceAvailableDataThrough: header.sourceAvailableDataThrough,
  };
}
