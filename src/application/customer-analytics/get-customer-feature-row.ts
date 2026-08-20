import { CUSTOMER_ANALYTICS_CONTRACT_VERSION } from '../../domain/customer-analytics/index.js';
import type { CustomerFeatureRow } from '../../domain/customer-analytics/index.js';
import {
  AnalyticsSchemaIncompatibleError,
  AnalyticsTimeoutError,
  AnalyticsUnavailableError,
} from '../customer-profile/errors.js';
import type { CustomerFeatureSnapshotReader, StoredCustomerFeatureSnapshot } from './ports.js';

export type GetCustomerFeatureRowInput = {
  // null => latest published snapshot, matching the clustering/RFM "latest" convention.
  readonly snapshotId: string | null;
  readonly prestashopCustomerId: number;
};

export type GetCustomerFeatureRowResult =
  | {
      readonly status: 'available';
      readonly snapshot: StoredCustomerFeatureSnapshot;
      readonly row: CustomerFeatureRow;
      readonly contractVersion: string;
    }
  | { readonly status: 'no_published_snapshot'; readonly contractVersion: string }
  | { readonly status: 'snapshot_not_found'; readonly snapshotId: string; readonly contractVersion: string }
  | { readonly status: 'customer_not_in_snapshot'; readonly prestashopCustomerId: number; readonly contractVersion: string }
  | { readonly status: 'degraded'; readonly reason: 'analytics_not_configured' | 'analytics_unavailable'; readonly contractVersion: string };

export type GetCustomerFeatureRow = (input: GetCustomerFeatureRowInput) => Promise<GetCustomerFeatureRowResult>;

// Task Section 34: "get row by snapshotId + customerId". Single-row internal lookup — never
// the bulk/all-rows shape task Section 35 explicitly forbids as an HTTP endpoint.
export function createGetCustomerFeatureRow(deps: {
  readonly reader: CustomerFeatureSnapshotReader;
}): GetCustomerFeatureRow {
  return async function getCustomerFeatureRow(input) {
    try {
      const snapshot =
        input.snapshotId === null
          ? await deps.reader.getLatestPublishedSnapshot()
          : await deps.reader.getSnapshotById(input.snapshotId);

      if (!snapshot) {
        if (input.snapshotId === null) {
          return { status: 'no_published_snapshot', contractVersion: CUSTOMER_ANALYTICS_CONTRACT_VERSION };
        }
        return { status: 'snapshot_not_found', snapshotId: input.snapshotId, contractVersion: CUSTOMER_ANALYTICS_CONTRACT_VERSION };
      }

      const row = await deps.reader.getRow(snapshot.snapshotId, input.prestashopCustomerId);
      if (!row) {
        return {
          status: 'customer_not_in_snapshot',
          prestashopCustomerId: input.prestashopCustomerId,
          contractVersion: CUSTOMER_ANALYTICS_CONTRACT_VERSION,
        };
      }

      return { status: 'available', snapshot, row, contractVersion: CUSTOMER_ANALYTICS_CONTRACT_VERSION };
    } catch (error) {
      if (error instanceof AnalyticsUnavailableError || error instanceof AnalyticsTimeoutError || error instanceof AnalyticsSchemaIncompatibleError) {
        return { status: 'degraded', reason: 'analytics_unavailable', contractVersion: CUSTOMER_ANALYTICS_CONTRACT_VERSION };
      }
      throw error;
    }
  };
}

export const getCustomerFeatureRowNotConfigured: GetCustomerFeatureRow = async () => ({
  status: 'degraded',
  reason: 'analytics_not_configured',
  contractVersion: CUSTOMER_ANALYTICS_CONTRACT_VERSION,
});
