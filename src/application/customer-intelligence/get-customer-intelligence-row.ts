import { CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION, type CustomerIntelligenceClv, type CustomerIntelligenceRow, type CustomerIntelligenceSnapshotContext } from '../../domain/customer-intelligence/index.js';
import { AnalyticsSchemaIncompatibleError, AnalyticsTimeoutError, AnalyticsUnavailableError } from '../customer-profile/errors.js';
import type { ResolveCustomerIntelligenceContextResult } from './resolve-customer-intelligence-context.js';
import type { CustomerClvActiveSnapshotReader, CustomerIntelligenceReader, ResolvedCustomerIntelligenceSnapshotIds } from './ports.js';
import { isCustomerClvMalformedSnapshotError, isCustomerClvReadInfrastructureError } from '../customer-clv/errors.js';

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
  readonly clvSnapshotReader?: CustomerClvActiveSnapshotReader;
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
      return { status: 'available', context: contextResult.context, row: await enrichClvIfNeeded(row, contextResult.resolvedIds, deps.clvSnapshotReader) };
    } catch (error) {
      if (error instanceof AnalyticsUnavailableError || error instanceof AnalyticsTimeoutError || error instanceof AnalyticsSchemaIncompatibleError) {
        return { status: 'degraded', reason: 'analytics_unavailable', contractVersion: CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION };
      }
      throw error;
    }
  };
}

async function enrichClvIfNeeded(
  row: CustomerIntelligenceRow,
  ids: ResolvedCustomerIntelligenceSnapshotIds,
  reader: CustomerClvActiveSnapshotReader | undefined,
): Promise<CustomerIntelligenceRow> {
  // The feature/RFM/cluster reader and A06 CLV store may live in separate schemas. Compose the
  // bounded CLV row here, after the existing read-model row has been resolved.
  if (Object.prototype.hasOwnProperty.call(row, 'clv')) return row;
  if (reader === undefined || ids.clvSnapshotId === undefined) return { ...row, clv: null };
  if (ids.clvSnapshotId === null) return { ...row, clv: null };
  let clvRow;
  try {
    clvRow = await reader.getCustomerClv(ids.clvSnapshotId, row.prestashopCustomerId);
  } catch (error) {
    if (isCustomerClvMalformedSnapshotError(error) || isCustomerClvReadInfrastructureError(error)) return { ...row, clv: null };
    throw error;
  }
  if (clvRow === null) return { ...row, clv: null };
  return { ...row, clv: toCustomerIntelligenceClv(ids, clvRow) };
}

export function toCustomerIntelligenceClv(
  ids: ResolvedCustomerIntelligenceSnapshotIds,
  clvRow: { readonly expectedRevenueTaxIncl: string; readonly expectedOrders?: string; readonly estimateSupportLevel: 'SPARSE' | 'SUPPORTED' },
): CustomerIntelligenceClv {
  return {
    expectedRevenueTaxIncl: clvRow.expectedRevenueTaxIncl,
    ...(clvRow.expectedOrders === undefined ? {} : { expectedOrders: clvRow.expectedOrders }),
    horizonMonths: ids.clvHorizonMonths as 12,
    currencyIsoCode: ids.clvCurrencyIsoCode as 'CLP',
    estimateSupportLevel: clvRow.estimateSupportLevel,
    snapshot: {
      snapshotId: ids.clvSnapshotId!,
      snapshotKey: ids.clvSnapshotKey!,
      referenceTime: ids.clvReferenceTime!,
      generatedAt: ids.clvGeneratedAt!,
      modelVersion: ids.clvModelVersion!,
      estimatorPolicyVersion: ids.clvEstimatorPolicyVersion!,
      sourceAvailableDataThrough: ids.clvSourceAvailableDataThrough!,
      horizonMonths: ids.clvHorizonMonths as 12,
    },
    model: { modelVersion: ids.clvModelVersion!, estimatorPolicyVersion: ids.clvEstimatorPolicyVersion! },
  };
}

export const getCustomerIntelligenceRowNotConfigured: GetCustomerIntelligenceRow = async () => ({
  status: 'degraded',
  reason: 'analytics_not_configured',
  contractVersion: CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION,
});
