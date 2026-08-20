import { CUSTOMER_ANALYTICS_CONTRACT_VERSION } from '../../domain/customer-analytics/index.js';
import {
  AnalyticsSchemaIncompatibleError,
  AnalyticsTimeoutError,
  AnalyticsUnavailableError,
} from '../customer-profile/errors.js';
import type { CustomerFeatureSnapshotReader, StoredCustomerFeatureSnapshot } from './ports.js';

export type GetLatestCustomerFeatureSnapshotResult =
  | { readonly status: 'available'; readonly snapshot: StoredCustomerFeatureSnapshot; readonly contractVersion: string }
  | { readonly status: 'no_published_snapshot'; readonly contractVersion: string }
  | { readonly status: 'degraded'; readonly reason: 'analytics_not_configured' | 'analytics_unavailable'; readonly contractVersion: string };

export type GetLatestCustomerFeatureSnapshot = () => Promise<GetLatestCustomerFeatureSnapshotResult>;

// Task Section 34: "get latest published feature snapshot" — never recomputes, never touches
// PrestaShop, reads only the local analytics DB (task Section 15 point-in-time guarantee).
export function createGetLatestCustomerFeatureSnapshot(deps: {
  readonly reader: CustomerFeatureSnapshotReader;
}): GetLatestCustomerFeatureSnapshot {
  return async function getLatestCustomerFeatureSnapshot() {
    try {
      const snapshot = await deps.reader.getLatestPublishedSnapshot();
      if (!snapshot) {
        return { status: 'no_published_snapshot', contractVersion: CUSTOMER_ANALYTICS_CONTRACT_VERSION };
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

export const getLatestCustomerFeatureSnapshotNotConfigured: GetLatestCustomerFeatureSnapshot = async () => ({
  status: 'degraded',
  reason: 'analytics_not_configured',
  contractVersion: CUSTOMER_ANALYTICS_CONTRACT_VERSION,
});
