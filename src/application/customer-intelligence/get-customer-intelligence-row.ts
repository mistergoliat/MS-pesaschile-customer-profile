import { CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION, type CustomerIntelligenceRow, type CustomerIntelligenceSnapshotContext } from '../../domain/customer-intelligence/index.js';
import { AnalyticsSchemaIncompatibleError, AnalyticsTimeoutError, AnalyticsUnavailableError } from '../customer-profile/errors.js';
import type { ResolveCustomerIntelligenceContextResult } from './resolve-customer-intelligence-context.js';
import type { CustomerIntelligenceReader } from './ports.js';

export type GetCustomerIntelligenceRowInput = {
  // null => current (latest feature snapshot); explicit id => historical (task Section 30).
  readonly featureSnapshotId: string | null;
  readonly prestashopCustomerId: number;
};

export type GetCustomerIntelligenceRowResult =
  | { readonly status: 'available'; readonly context: CustomerIntelligenceSnapshotContext; readonly row: CustomerIntelligenceRow }
  | Exclude<ResolveCustomerIntelligenceContextResult, { status: 'available' }>
  | { readonly status: 'customer_not_in_feature_snapshot'; readonly prestashopCustomerId: number; readonly contractVersion: string };

export type GetCustomerIntelligenceRow = (input: GetCustomerIntelligenceRowInput) => Promise<GetCustomerIntelligenceRowResult>;

// Single-row lookup only (task Section 20/21) — the caller of this function is expected to be
// an internal consumer or, if wired later, a single-customer HTTP route; never the bulk shape
// listCustomerIntelligenceRows exists for.
export function createGetCustomerIntelligenceRow(deps: {
  readonly resolveCurrent: () => Promise<ResolveCustomerIntelligenceContextResult>;
  readonly resolveForFeatureSnapshot: (featureSnapshotId: string) => Promise<ResolveCustomerIntelligenceContextResult>;
  readonly intelligenceReader: CustomerIntelligenceReader;
}): GetCustomerIntelligenceRow {
  return async function getCustomerIntelligenceRow(input) {
    const contextResult =
      input.featureSnapshotId === null ? await deps.resolveCurrent() : await deps.resolveForFeatureSnapshot(input.featureSnapshotId);

    if (contextResult.status !== 'available') {
      return contextResult;
    }

    try {
      const row = await deps.intelligenceReader.getRow(contextResult.resolvedIds, input.prestashopCustomerId);
      if (!row) {
        return {
          status: 'customer_not_in_feature_snapshot',
          prestashopCustomerId: input.prestashopCustomerId,
          contractVersion: CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION,
        };
      }
      return { status: 'available', context: contextResult.context, row };
    } catch (error) {
      if (error instanceof AnalyticsUnavailableError || error instanceof AnalyticsTimeoutError || error instanceof AnalyticsSchemaIncompatibleError) {
        return { status: 'degraded', reason: 'analytics_unavailable', contractVersion: CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION };
      }
      throw error;
    }
  };
}

export const getCustomerIntelligenceRowNotConfigured: GetCustomerIntelligenceRow = async () => ({
  status: 'degraded',
  reason: 'analytics_not_configured',
  contractVersion: CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION,
});
