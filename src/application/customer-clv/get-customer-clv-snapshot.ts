import type { CustomerClvActiveSnapshotReader } from '../customer-intelligence/ports.js';
import {
  CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION,
  validateProductionHeader,
} from './get-customer-clv.js';
import { isCustomerClvMalformedSnapshotError, isCustomerClvReadInfrastructureError } from './errors.js';
import { AnalyticsTimeoutError } from '../customer-profile/errors.js';

export type CustomerClvSnapshotMetadata = {
  readonly snapshotId: string;
  readonly snapshotKey: string;
  readonly status: 'published';
  readonly referenceTime: string;
  readonly generatedAt: string;
  readonly populationSize: number;
  readonly modelVersion: string;
  readonly estimatorPolicyVersion: string;
  readonly currencyIsoCode: 'CLP';
  readonly horizonMonths: 12;
  readonly sourceAvailableDataThrough: string;
};

export type GetCustomerClvSnapshotResult =
  | { readonly status: 'available'; readonly snapshot: CustomerClvSnapshotMetadata; readonly contractVersion: typeof CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION }
  | { readonly status: 'no_active_clv_snapshot'; readonly error: 'NO_ACTIVE_CLV_SNAPSHOT'; readonly contractVersion: typeof CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION }
  | { readonly status: 'degraded'; readonly reason: 'clv_unavailable' | 'clv_timeout'; readonly contractVersion: typeof CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION }
  | { readonly status: 'malformed_clv_snapshot'; readonly error: 'MALFORMED_CLV_SNAPSHOT'; readonly contractVersion: typeof CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION };

export type GetCustomerClvSnapshot = () => Promise<GetCustomerClvSnapshotResult>;

export function createGetCustomerClvSnapshot(deps: { readonly reader: CustomerClvActiveSnapshotReader }): GetCustomerClvSnapshot {
  return async () => {
    try {
      const header = await deps.reader.getActiveSnapshotMetadata();
      if (header === null) return { status: 'no_active_clv_snapshot', error: 'NO_ACTIVE_CLV_SNAPSHOT', contractVersion: CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION };
      validateProductionHeader(header);
      return {
        status: 'available',
        snapshot: {
          snapshotId: header.snapshotId!, snapshotKey: header.snapshotKey, status: 'published', referenceTime: header.referenceTime,
          generatedAt: header.generatedAt, populationSize: header.populationSize, modelVersion: header.modelVersion,
          estimatorPolicyVersion: header.estimatorPolicyVersion, currencyIsoCode: header.currencyIsoCode,
          horizonMonths: header.horizonMonths, sourceAvailableDataThrough: header.sourceAvailableDataThrough,
        },
        contractVersion: CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION,
      };
    } catch (error) {
      if (isCustomerClvMalformedSnapshotError(error)) return { status: 'malformed_clv_snapshot', error: 'MALFORMED_CLV_SNAPSHOT', contractVersion: CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION };
      if (isCustomerClvReadInfrastructureError(error)) return { status: 'degraded', reason: error instanceof AnalyticsTimeoutError ? 'clv_timeout' : 'clv_unavailable', contractVersion: CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION };
      throw error;
    }
  };
}

export const getCustomerClvSnapshotNotConfigured: GetCustomerClvSnapshot = async () => ({
  status: 'degraded', reason: 'clv_unavailable', contractVersion: CUSTOMER_CLV_RUNTIME_CONTRACT_VERSION,
});
