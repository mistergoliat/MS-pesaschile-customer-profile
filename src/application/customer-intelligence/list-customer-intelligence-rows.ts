import { CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION, type CustomerIntelligenceRow, type CustomerIntelligenceSnapshotContext } from '../../domain/customer-intelligence/index.js';
import { AnalyticsSchemaIncompatibleError, AnalyticsTimeoutError, AnalyticsUnavailableError } from '../customer-profile/errors.js';
import type { ResolveCustomerIntelligenceContextResult } from './resolve-customer-intelligence-context.js';
import type { CustomerClvActiveSnapshotReader, CustomerIntelligenceReader, ResolvedCustomerIntelligenceSnapshotIds } from './ports.js';
import { toCustomerIntelligenceClv } from './get-customer-intelligence-row.js';

const MAX_BATCH_SIZE = 5000;
const DEFAULT_BATCH_SIZE = 1000;

export type ListCustomerIntelligenceRowsInput = {
  readonly featureSnapshotId: string | null;
  readonly limit: number;
  readonly afterCustomerId: number | null;
};

export type ListCustomerIntelligenceRowsResult =
  | {
      readonly status: 'available';
      readonly context: CustomerIntelligenceSnapshotContext;
      readonly rows: readonly CustomerIntelligenceRow[];
      readonly hasMore: boolean;
    }
  | Exclude<ResolveCustomerIntelligenceContextResult, { status: 'available' }>;

export type ListCustomerIntelligenceRows = (input: ListCustomerIntelligenceRowsInput) => Promise<ListCustomerIntelligenceRowsResult>;

// Internal/application-only (task Section 21/22) — never wired to a bulk HTTP route. Batch
// size is bounded (task Section 36: never construct huge nested objects unnecessarily) —
// callers ask for a batch, not "everything at once".
export function createListCustomerIntelligenceRows(deps: {
  readonly resolveCurrent: () => Promise<ResolveCustomerIntelligenceContextResult>;
  readonly resolveForFeatureSnapshot: (featureSnapshotId: string) => Promise<ResolveCustomerIntelligenceContextResult>;
  readonly intelligenceReader: CustomerIntelligenceReader;
  readonly clvSnapshotReader?: CustomerClvActiveSnapshotReader;
}): ListCustomerIntelligenceRows {
  return async function listCustomerIntelligenceRows(input) {
    if (!Number.isSafeInteger(input.limit) || input.limit <= 0 || input.limit > MAX_BATCH_SIZE) {
      throw new Error(`limit must be a positive integer <= ${MAX_BATCH_SIZE}`);
    }

    const contextResult =
      input.featureSnapshotId === null ? await deps.resolveCurrent() : await deps.resolveForFeatureSnapshot(input.featureSnapshotId);

    if (contextResult.status !== 'available') {
      return contextResult;
    }

    try {
      const page = await deps.intelligenceReader.listRows(contextResult.resolvedIds, {
        limit: input.limit,
        afterCustomerId: input.afterCustomerId,
      });
      const rows = await enrichClvRows(page.rows, contextResult.resolvedIds, deps.clvSnapshotReader);
      return { status: 'available', context: contextResult.context, rows, hasMore: page.hasMore };
    } catch (error) {
      if (error instanceof AnalyticsUnavailableError || error instanceof AnalyticsTimeoutError || error instanceof AnalyticsSchemaIncompatibleError) {
        return { status: 'degraded', reason: 'analytics_unavailable', contractVersion: CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION };
      }
      throw error;
    }
  };
}

async function enrichClvRows(
  rows: readonly CustomerIntelligenceRow[],
  ids: ResolvedCustomerIntelligenceSnapshotIds,
  reader: CustomerClvActiveSnapshotReader | undefined,
): Promise<readonly CustomerIntelligenceRow[]> {
  if (reader === undefined || ids.clvSnapshotId === undefined) return rows.map((row) => Object.prototype.hasOwnProperty.call(row, 'clv') ? row : { ...row, clv: null });
  if (ids.clvSnapshotId === null || rows.length === 0) return rows.map((row) => ({ ...row, clv: null }));
  if (rows.every((row) => Object.prototype.hasOwnProperty.call(row, 'clv'))) return rows;
  if (reader.getCustomerClvBatch) {
    const clvRows = await reader.getCustomerClvBatch(ids.clvSnapshotId, rows.map((row) => row.prestashopCustomerId));
    const byCustomerId = new Map(clvRows.map((row) => [row.customerId, row]));
    return rows.map((row) => {
      const clvRow = byCustomerId.get(row.prestashopCustomerId);
      return clvRow === undefined ? { ...row, clv: null } : { ...row, clv: toCustomerIntelligenceClv(ids, clvRow) };
    });
  }
  return Promise.all(rows.map(async (row) => {
    if (Object.prototype.hasOwnProperty.call(row, 'clv')) return row;
    const clvRow = await reader.getCustomerClv(ids.clvSnapshotId!, row.prestashopCustomerId);
    return clvRow === null ? { ...row, clv: null } : { ...row, clv: toCustomerIntelligenceClv(ids, clvRow) };
  }));
}

export const listCustomerIntelligenceRowsNotConfigured: ListCustomerIntelligenceRows = async () => ({
  status: 'degraded',
  reason: 'analytics_not_configured',
  contractVersion: CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION,
});

// Batched full-population traversal (task Section 21: "async iterator / paginated batches",
// the future analytical query runtime's expected consumption pattern) — resolves the context
// ONCE, then keyset-paginates without ever holding more than one batch of
// CustomerIntelligenceRow objects in memory at a time.
export async function* iterateCustomerIntelligenceRows(
  deps: { readonly intelligenceReader: CustomerIntelligenceReader },
  resolvedIds: ResolvedCustomerIntelligenceSnapshotIds,
  batchSize: number = DEFAULT_BATCH_SIZE,
): AsyncGenerator<readonly CustomerIntelligenceRow[], void, void> {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`batchSize must be a positive integer <= ${MAX_BATCH_SIZE}`);
  }
  let afterCustomerId: number | null = null;
  for (;;) {
    const page = await deps.intelligenceReader.listRows(resolvedIds, { limit: batchSize, afterCustomerId });
    if (page.rows.length === 0) return;
    yield page.rows;
    if (!page.hasMore) return;
    afterCustomerId = page.rows[page.rows.length - 1]!.prestashopCustomerId;
  }
}
