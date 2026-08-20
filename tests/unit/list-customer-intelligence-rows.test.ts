import { describe, expect, it, vi } from 'vitest';
import {
  createListCustomerIntelligenceRows,
  iterateCustomerIntelligenceRows,
} from '../../src/application/customer-intelligence/list-customer-intelligence-rows.js';
import { AnalyticsUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { ResolveCustomerIntelligenceContextResult } from '../../src/application/customer-intelligence/resolve-customer-intelligence-context.js';
import type { CustomerIntelligenceReader } from '../../src/application/customer-intelligence/ports.js';
import type { CustomerIntelligenceRow } from '../../src/domain/customer-intelligence/contracts.js';

const AVAILABLE_CONTEXT: Extract<ResolveCustomerIntelligenceContextResult, { status: 'available' }> = {
  status: 'available',
  context: {
    featureSnapshot: { snapshotId: '17', referenceTime: '2026-08-19T00:00:00.000Z', featureVersion: 'v1', populationPolicyVersion: 'pop-v1' },
    rfmSnapshot: null,
    clusterSnapshot: null,
    population: { featurePopulation: 3, rfmMatched: 0, clusterMatched: 0, bothMatched: 0, neitherMatched: 3, rfmCoveragePct: 0, clusterCoveragePct: 0 },
    contractVersion: 'customer-intelligence-read-model-v1',
  },
  resolvedIds: {
    featureSnapshotId: '17',
    featureReferenceTime: '2026-08-19T00:00:00.000Z',
    featureVersion: 'v1',
    populationPolicyVersion: 'pop-v1',
    rfmSnapshotId: null,
    rfmReferenceTime: null,
    calculationVersion: null,
    clusterSnapshotId: null,
    clusterReferenceTime: null,
    clusterModelId: null,
    clusterModelVersion: null,
  },
};

function minimalRow(prestashopCustomerId: number): CustomerIntelligenceRow {
  return {
    prestashopCustomerId,
    featureSnapshot: AVAILABLE_CONTEXT.context.featureSnapshot,
    commercial: {
      validOrders: 1,
      totalSpentTaxIncl: '100.000000',
      averageOrderValueTaxIncl: '100.000000',
      firstOrderAt: '2026-01-01T00:00:00.000Z',
      lastOrderAt: '2026-01-01T00:00:00.000Z',
      daysSinceLastOrder: 0,
      customerTenureDays: 0,
      distinctProducts: 1,
      repeatProductRate: '0.000000',
      top1Share: '1.000000',
      top3Share: '1.000000',
      effectiveDiversity: '1.000000',
      averageUnitsPerOrder: '1.000000',
      purchaseFrequencyDays: null,
      orders365d: 1,
      cancelledOrderRatio: '0.000000',
      discountShare: '0.000000',
      shippingShare: '0.000000',
    },
    rfm: null,
    cluster: null,
    contractVersion: 'customer-intelligence-read-model-v1',
  };
}

describe('createListCustomerIntelligenceRows', () => {
  it('rejects a non-positive or oversized limit', async () => {
    const intelligenceReader: CustomerIntelligenceReader = { getRow: vi.fn(), listRows: vi.fn(), getCoverageCounts: vi.fn() };
    const listRows = createListCustomerIntelligenceRows({ resolveCurrent: async () => AVAILABLE_CONTEXT, resolveForFeatureSnapshot: vi.fn(), intelligenceReader });
    await expect(listRows({ featureSnapshotId: null, limit: 0, afterCustomerId: null })).rejects.toThrow(/limit must be/);
    await expect(listRows({ featureSnapshotId: null, limit: 100000, afterCustomerId: null })).rejects.toThrow(/limit must be/);
  });

  it('returns a page with hasMore=true when more rows remain', async () => {
    const intelligenceReader: CustomerIntelligenceReader = {
      getRow: vi.fn(),
      listRows: vi.fn(async () => ({ rows: [minimalRow(1), minimalRow(2)], hasMore: true })),
      getCoverageCounts: vi.fn(),
    };
    const listRows = createListCustomerIntelligenceRows({ resolveCurrent: async () => AVAILABLE_CONTEXT, resolveForFeatureSnapshot: vi.fn(), intelligenceReader });
    const result = await listRows({ featureSnapshotId: null, limit: 2, afterCustomerId: null });
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.rows).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    }
    expect(intelligenceReader.listRows).toHaveBeenCalledWith(AVAILABLE_CONTEXT.resolvedIds, { limit: 2, afterCustomerId: null });
  });

  it('propagates a non-available context result without calling the reader', async () => {
    const intelligenceReader: CustomerIntelligenceReader = { getRow: vi.fn(), listRows: vi.fn(), getCoverageCounts: vi.fn() };
    const listRows = createListCustomerIntelligenceRows({
      resolveCurrent: async () => ({ status: 'no_published_feature_snapshot', contractVersion: 'customer-intelligence-read-model-v1' }),
      resolveForFeatureSnapshot: vi.fn(),
      intelligenceReader,
    });
    const result = await listRows({ featureSnapshotId: null, limit: 10, afterCustomerId: null });
    expect(result.status).toBe('no_published_feature_snapshot');
    expect(intelligenceReader.listRows).not.toHaveBeenCalled();
  });

  it('maps an analytics DB failure to degraded', async () => {
    const intelligenceReader: CustomerIntelligenceReader = {
      getRow: vi.fn(),
      listRows: vi.fn(async () => {
        throw new AnalyticsUnavailableError('down');
      }),
      getCoverageCounts: vi.fn(),
    };
    const listRows = createListCustomerIntelligenceRows({ resolveCurrent: async () => AVAILABLE_CONTEXT, resolveForFeatureSnapshot: vi.fn(), intelligenceReader });
    const result = await listRows({ featureSnapshotId: null, limit: 10, afterCustomerId: null });
    expect(result).toEqual(expect.objectContaining({ status: 'degraded', reason: 'analytics_unavailable' }));
  });
});

describe('iterateCustomerIntelligenceRows (task Section 21/36 — batched full-population traversal)', () => {
  it('yields successive batches using keyset pagination until hasMore is false', async () => {
    const listRowsMock = vi
      .fn<CustomerIntelligenceReader['listRows']>()
      .mockResolvedValueOnce({ rows: [minimalRow(1), minimalRow(2)], hasMore: true })
      .mockResolvedValueOnce({ rows: [minimalRow(3)], hasMore: false });
    const intelligenceReader: CustomerIntelligenceReader = { getRow: vi.fn(), listRows: listRowsMock, getCoverageCounts: vi.fn() };

    const batches: number[][] = [];
    for await (const batch of iterateCustomerIntelligenceRows({ intelligenceReader }, AVAILABLE_CONTEXT.resolvedIds, 2)) {
      batches.push(batch.map((row) => row.prestashopCustomerId));
    }

    expect(batches).toEqual([[1, 2], [3]]);
    expect(listRowsMock).toHaveBeenCalledTimes(2);
    expect(listRowsMock).toHaveBeenNthCalledWith(1, AVAILABLE_CONTEXT.resolvedIds, { limit: 2, afterCustomerId: null });
    expect(listRowsMock).toHaveBeenNthCalledWith(2, AVAILABLE_CONTEXT.resolvedIds, { limit: 2, afterCustomerId: 2 });
  });

  it('stops immediately on an empty first page', async () => {
    const intelligenceReader: CustomerIntelligenceReader = {
      getRow: vi.fn(),
      listRows: vi.fn(async () => ({ rows: [], hasMore: false })),
      getCoverageCounts: vi.fn(),
    };
    const batches: unknown[] = [];
    for await (const batch of iterateCustomerIntelligenceRows({ intelligenceReader }, AVAILABLE_CONTEXT.resolvedIds, 10)) {
      batches.push(batch);
    }
    expect(batches).toHaveLength(0);
  });

  it('rejects an invalid batchSize', async () => {
    const intelligenceReader: CustomerIntelligenceReader = { getRow: vi.fn(), listRows: vi.fn(), getCoverageCounts: vi.fn() };
    const generator = iterateCustomerIntelligenceRows({ intelligenceReader }, AVAILABLE_CONTEXT.resolvedIds, 0);
    await expect(generator.next()).rejects.toThrow(/batchSize must be/);
  });
});

