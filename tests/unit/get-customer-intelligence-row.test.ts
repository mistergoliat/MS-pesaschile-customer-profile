import { describe, expect, it, vi } from 'vitest';
import { createGetCustomerIntelligenceRow } from '../../src/application/customer-intelligence/get-customer-intelligence-row.js';
import { AnalyticsUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { ResolveCustomerIntelligenceContextResult } from '../../src/application/customer-intelligence/resolve-customer-intelligence-context.js';
import type { CustomerIntelligenceReader } from '../../src/application/customer-intelligence/ports.js';
import type { CustomerIntelligenceRow } from '../../src/domain/customer-intelligence/contracts.js';

const AVAILABLE_CONTEXT: Extract<ResolveCustomerIntelligenceContextResult, { status: 'available' }> = {
  status: 'available',
  context: {
    featureSnapshot: { snapshotId: '17', referenceTime: '2026-08-19T00:00:00.000Z', featureVersion: 'v1', populationPolicyVersion: 'pop-v1' },
    rfmSnapshot: { snapshotId: '1', referenceTime: '2026-08-18T00:00:00.000Z', calculationVersion: 'rfm-population-v1' },
    clusterSnapshot: { snapshotId: '1', referenceTime: '2026-08-18T00:00:00.000Z', modelId: '1', modelVersion: 'behavioral-kmeans-k4-v1' },
    population: { featurePopulation: 1, rfmMatched: 1, clusterMatched: 1, bothMatched: 1, neitherMatched: 0, rfmCoveragePct: 100, clusterCoveragePct: 100 },
    contractVersion: 'customer-intelligence-read-model-v1',
  },
  resolvedIds: {
    featureSnapshotId: '17',
    featureReferenceTime: '2026-08-19T00:00:00.000Z',
    featureVersion: 'v1',
    populationPolicyVersion: 'pop-v1',
    rfmSnapshotId: '1',
    rfmReferenceTime: '2026-08-18T00:00:00.000Z',
    calculationVersion: 'rfm-population-v1',
    clusterSnapshotId: '1',
    clusterReferenceTime: '2026-08-18T00:00:00.000Z',
    clusterModelId: '1',
    clusterModelVersion: 'behavioral-kmeans-k4-v1',
  },
};

function commercialFixture(): CustomerIntelligenceRow['commercial'] {
  return {
    validOrders: 2,
    totalSpentTaxIncl: '1000.000000',
    averageOrderValueTaxIncl: '500.000000',
    firstOrderAt: '2026-01-01T00:00:00.000Z',
    lastOrderAt: '2026-07-01T00:00:00.000Z',
    daysSinceLastOrder: 49,
    customerTenureDays: 1000,
    distinctProducts: 1,
    repeatProductRate: '0.000000',
    top1Share: '1.000000',
    top3Share: '1.000000',
    effectiveDiversity: '1.000000',
    averageUnitsPerOrder: '1.000000',
    purchaseFrequencyDays: '181.000000',
    orders365d: 0,
    cancelledOrderRatio: '0.000000',
    discountShare: '0.000000',
    shippingShare: '0.000000',
  };
}

function rowFixture(overrides: Partial<CustomerIntelligenceRow> = {}): CustomerIntelligenceRow {
  return {
    prestashopCustomerId: 22066,
    featureSnapshot: AVAILABLE_CONTEXT.context.featureSnapshot,
    commercial: commercialFixture(),
    rfm: { snapshot: AVAILABLE_CONTEXT.context.rfmSnapshot!, rScore: 3, fScore: 2, mScore: 4, rfmCode: 'R3F2M4', segmentCode: 'LOYAL' },
    cluster: {
      snapshot: AVAILABLE_CONTEXT.context.clusterSnapshot!,
      clusterId: 3,
      distanceToCentroid: 1.42,
      interpretationVersion: 'behavioral-cluster-interpretation-v1',
      label: 'NEW_BURST_THEN_LAPSED_BUYERS',
      description: 'desc',
    },
    contractVersion: 'customer-intelligence-read-model-v1',
    ...overrides,
  };
}

describe('createGetCustomerIntelligenceRow — task Section 47 five cases', () => {
  it('commercial + RFM + cluster', async () => {
    const intelligenceReader: CustomerIntelligenceReader = {
      getRow: vi.fn(async () => rowFixture()),
      listRows: vi.fn(),
      getCoverageCounts: vi.fn(),
    };
    const getRow = createGetCustomerIntelligenceRow({
      resolveCurrent: async () => AVAILABLE_CONTEXT,
      resolveForFeatureSnapshot: vi.fn(),
      intelligenceReader,
    });
    const result = await getRow({ featureSnapshotId: null, prestashopCustomerId: 22066 });
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.row.rfm).not.toBeNull();
      expect(result.row.cluster).not.toBeNull();
    }
  });

  it('commercial + RFM only (not in clustering population)', async () => {
    const intelligenceReader: CustomerIntelligenceReader = {
      getRow: vi.fn(async () => rowFixture({ cluster: null })),
      listRows: vi.fn(),
      getCoverageCounts: vi.fn(),
    };
    const getRow = createGetCustomerIntelligenceRow({
      resolveCurrent: async () => AVAILABLE_CONTEXT,
      resolveForFeatureSnapshot: vi.fn(),
      intelligenceReader,
    });
    const result = await getRow({ featureSnapshotId: null, prestashopCustomerId: 22066 });
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.row.rfm).not.toBeNull();
      expect(result.row.cluster).toBeNull();
    }
  });

  it('commercial + cluster only (not in RFM snapshot)', async () => {
    const intelligenceReader: CustomerIntelligenceReader = {
      getRow: vi.fn(async () => rowFixture({ rfm: null })),
      listRows: vi.fn(),
      getCoverageCounts: vi.fn(),
    };
    const getRow = createGetCustomerIntelligenceRow({
      resolveCurrent: async () => AVAILABLE_CONTEXT,
      resolveForFeatureSnapshot: vi.fn(),
      intelligenceReader,
    });
    const result = await getRow({ featureSnapshotId: null, prestashopCustomerId: 22066 });
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.row.rfm).toBeNull();
      expect(result.row.cluster).not.toBeNull();
    }
  });

  it('commercial only (one-time buyer, absent from both RFM and clustering)', async () => {
    const intelligenceReader: CustomerIntelligenceReader = {
      getRow: vi.fn(async () => rowFixture({ rfm: null, cluster: null })),
      listRows: vi.fn(),
      getCoverageCounts: vi.fn(),
    };
    const getRow = createGetCustomerIntelligenceRow({
      resolveCurrent: async () => AVAILABLE_CONTEXT,
      resolveForFeatureSnapshot: vi.fn(),
      intelligenceReader,
    });
    const result = await getRow({ featureSnapshotId: null, prestashopCustomerId: 22092 });
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.row.commercial).toBeDefined();
      expect(result.row.rfm).toBeNull();
      expect(result.row.cluster).toBeNull();
    }
  });

  it('customer not in feature snapshot at all', async () => {
    const intelligenceReader: CustomerIntelligenceReader = {
      getRow: vi.fn(async () => null),
      listRows: vi.fn(),
      getCoverageCounts: vi.fn(),
    };
    const getRow = createGetCustomerIntelligenceRow({
      resolveCurrent: async () => AVAILABLE_CONTEXT,
      resolveForFeatureSnapshot: vi.fn(),
      intelligenceReader,
    });
    const result = await getRow({ featureSnapshotId: null, prestashopCustomerId: 999999 });
    expect(result).toEqual(expect.objectContaining({ status: 'customer_not_in_feature_snapshot', prestashopCustomerId: 999999 }));
  });
});

describe('createGetCustomerIntelligenceRow — context propagation', () => {
  it('propagates a non-available context result (e.g. no_published_feature_snapshot) without calling the reader', async () => {
    const intelligenceReader: CustomerIntelligenceReader = { getRow: vi.fn(), listRows: vi.fn(), getCoverageCounts: vi.fn() };
    const getRow = createGetCustomerIntelligenceRow({
      resolveCurrent: async () => ({ status: 'no_published_feature_snapshot', contractVersion: 'customer-intelligence-read-model-v1' }),
      resolveForFeatureSnapshot: vi.fn(),
      intelligenceReader,
    });
    const result = await getRow({ featureSnapshotId: null, prestashopCustomerId: 1 });
    expect(result.status).toBe('no_published_feature_snapshot');
    expect(intelligenceReader.getRow).not.toHaveBeenCalled();
  });

  it('uses resolveForFeatureSnapshot when an explicit featureSnapshotId is passed', async () => {
    const resolveForFeatureSnapshot = vi.fn(async () => AVAILABLE_CONTEXT);
    const intelligenceReader: CustomerIntelligenceReader = { getRow: vi.fn(async () => rowFixture()), listRows: vi.fn(), getCoverageCounts: vi.fn() };
    const getRow = createGetCustomerIntelligenceRow({
      resolveCurrent: vi.fn(),
      resolveForFeatureSnapshot,
      intelligenceReader,
    });
    await getRow({ featureSnapshotId: '17', prestashopCustomerId: 22066 });
    expect(resolveForFeatureSnapshot).toHaveBeenCalledWith('17');
  });

  it('maps an analytics DB failure during the row read to degraded', async () => {
    const intelligenceReader: CustomerIntelligenceReader = {
      getRow: vi.fn(async () => {
        throw new AnalyticsUnavailableError('down');
      }),
      listRows: vi.fn(),
      getCoverageCounts: vi.fn(),
    };
    const getRow = createGetCustomerIntelligenceRow({
      resolveCurrent: async () => AVAILABLE_CONTEXT,
      resolveForFeatureSnapshot: vi.fn(),
      intelligenceReader,
    });
    const result = await getRow({ featureSnapshotId: null, prestashopCustomerId: 1 });
    expect(result).toEqual(expect.objectContaining({ status: 'degraded', reason: 'analytics_unavailable' }));
  });
});
