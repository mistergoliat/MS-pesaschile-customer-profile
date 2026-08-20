import { CUSTOMER_ANALYTICS_CONTRACT_VERSION } from '../../domain/customer-analytics/index.js';
import {
  AnalyticsSchemaIncompatibleError,
  AnalyticsTimeoutError,
  AnalyticsUnavailableError,
} from '../customer-profile/errors.js';
import type { CustomerFeatureSnapshotReader, StoredCustomerFeatureSnapshot } from './ports.js';

export type GetCustomerFeatureSnapshotByIdResult =
  | { readonly status: 'available'; readonly snapshot: StoredCustomerFeatureSnapshot; readonly contractVersion: string }
  | { readonly status: 'snapshot_not_found'; readonly snapshotId: string; readonly contractVersion: string }
  | { readonly status: 'degraded'; readonly reason: 'analytics_not_configured' | 'analytics_unavailable'; readonly contractVersion: string };

export type GetCustomerFeatureSnapshotById = (snapshotId: string) => Promise<GetCustomerFeatureSnapshotByIdResult>;

// Task Section 34/44: historical reproducibility — a snapshot that has since been superseded
// by a newer one must stay readable by its explicit id (the reader only excludes
// building/validated/failed statuses, never 'superseded').
export function createGetCustomerFeatureSnapshotById(deps: {
  readonly reader: CustomerFeatureSnapshotReader;
}): GetCustomerFeatureSnapshotById {
  return async function getCustomerFeatureSnapshotById(snapshotId) {
    try {
      const snapshot = await deps.reader.getSnapshotById(snapshotId);
      if (!snapshot) {
        return { status: 'snapshot_not_found', snapshotId, contractVersion: CUSTOMER_ANALYTICS_CONTRACT_VERSION };
      }
      return { status: 'available', snapshot, contractVersion: CUSTOMER_ANALYTICS_CONTRACT_VERSION };
    } catch (error) {
      if (error instanceof AnalyticsUnavailableError || error instanceof AnalyticsTimeoutError || error instanceof AnalyticsSchemaIncompatibleError) {
        return { status: 'degraded', reason: 'analytics_unavailable', contractVersion: CUSTOMER_ANALYTICS_CONTRACT_VERSION };
      }
      throw error;
    }
  };
}

export const getCustomerFeatureSnapshotByIdNotConfigured: GetCustomerFeatureSnapshotById = async (_snapshotId) => ({
  status: 'degraded',
  reason: 'analytics_not_configured',
  contractVersion: CUSTOMER_ANALYTICS_CONTRACT_VERSION,
});
