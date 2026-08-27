import { describe, expect, it, vi } from 'vitest';
import { createGetDashboardRfm } from '../../src/application/customer-intelligence-dashboard/get-dashboard-rfm.js';
import type { ResolveCustomerIntelligenceContextResult } from '../../src/application/customer-intelligence/resolve-customer-intelligence-context.js';
import type { ClusterAnalyticsReader } from '../../src/infrastructure/clustering/mysql-cluster-analytics-reader.js';
import type { DashboardAnalyticsReader, DashboardRfmSegmentAggregate } from '../../src/application/customer-intelligence-dashboard/ports.js';

const baseAvailable = {
  status: 'available' as const,
  resolvedIds: {
    featureSnapshotId: '17',
    featureReferenceTime: '2026-08-19T00:00:00.000Z',
    featureVersion: 'customer-analytics-features-v1',
    populationPolicyVersion: 'customer-analytics-population-b-v1',
    rfmSnapshotId: '9',
    rfmReferenceTime: '2026-08-18T00:00:00.000Z',
    calculationVersion: 'rfm-v1',
    clusterSnapshotId: null,
    clusterReferenceTime: null,
    clusterModelId: null,
    clusterModelVersion: null,
  },
  context: {
    featureSnapshot: {
      snapshotId: '17',
      referenceTime: '2026-08-19T00:00:00.000Z',
      featureVersion: 'customer-analytics-features-v1',
      populationPolicyVersion: 'customer-analytics-population-b-v1',
    },
    rfmSnapshot: { snapshotId: '9', referenceTime: '2026-08-18T00:00:00.000Z', calculationVersion: 'rfm-v1' },
    clusterSnapshot: null,
    population: { featurePopulation: 100, rfmMatched: 40, clusterMatched: 0, bothMatched: 0, neitherMatched: 60, rfmCoveragePct: 40, clusterCoveragePct: 0 },
    contractVersion: 'customer-intelligence-read-model-v1',
  },
} satisfies ResolveCustomerIntelligenceContextResult;

const noRfmAvailable = {
  ...baseAvailable,
  resolvedIds: { ...baseAvailable.resolvedIds, rfmSnapshotId: null, rfmReferenceTime: null, calculationVersion: null },
  context: { ...baseAvailable.context, rfmSnapshot: null, population: { ...baseAvailable.context.population, rfmMatched: 0, rfmCoveragePct: 0 } },
} satisfies ResolveCustomerIntelligenceContextResult;

const championAggregate: DashboardRfmSegmentAggregate = {
  segmentCode: 'CHAMPION',
  customerCount: 30,
  averageRScore: '4.8000',
  averageFScore: '4.5000',
  averageMScore: '4.7000',
  averageOrderValueTaxIncl: '5000.000000',
  averageTotalSpentTaxIncl: '25000.000000',
  averageValidOrders: '5.0000',
  averageDaysSinceLastOrder: '5.0000',
};

const unsegmentedAggregate: DashboardRfmSegmentAggregate = {
  segmentCode: null,
  customerCount: 10,
  averageRScore: '3.0000',
  averageFScore: '3.0000',
  averageMScore: '3.0000',
  averageOrderValueTaxIncl: '2000.000000',
  averageTotalSpentTaxIncl: '4000.000000',
  averageValidOrders: '2.0000',
  averageDaysSinceLastOrder: '20.0000',
};

function clusterAnalyticsReader(): ClusterAnalyticsReader {
  return {
    getLatestPublishedSnapshot: vi.fn(async () => null),
    getPublishedSnapshotById: vi.fn(async () => null),
    getClusterSizeDistribution: vi.fn(async () => new Map()),
    getInterpretations: vi.fn(async () => new Map()),
    listSnapshotRows: vi.fn(async () => []),
  };
}

function dashboardAnalyticsReader(overrides: Partial<DashboardAnalyticsReader> = {}): DashboardAnalyticsReader {
  return {
    getOverviewCommercialAggregate: vi.fn(async () => {
      throw new Error('unreachable');
    }),
    getRfmSegmentAggregates: vi.fn(async () => [championAggregate, unsegmentedAggregate]),
    getClusterAggregates: vi.fn(async () => []),
    getClusterRfmCrossSectionGroups: vi.fn(async () => []),
    ...overrides,
  };
}

describe('getDashboardRfm', () => {
  it('returns segment distribution with business labels, and never confuses RFM population with the full feature population (task Section 5/10)', async () => {
    const getRfm = createGetDashboardRfm({
      resolveCurrent: vi.fn(async () => baseAvailable),
      resolveForFeatureSnapshot: vi.fn(async () => baseAvailable),
      clusterAnalyticsReader: clusterAnalyticsReader(),
      dashboardAnalyticsReader: dashboardAnalyticsReader(),
    });
    const result = await getRfm({ featureSnapshotId: null });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.analyzedPopulation).toBe(40);
    expect(result.fullFeaturePopulation).toBe(100);
    expect(result.coveragePct).toBe(40);
    const champion = result.segments.find((s) => s.segmentCode === 'CHAMPION')!;
    expect(champion.businessLabel).toBe('Clientes campeones: compra reciente, frecuente y de alto valor');
    expect(champion.percentageOfRfmPopulation).toBe(75); // 30/40
    expect(champion.percentageOfFeaturePopulation).toBe(30); // 30/100
  });

  it('labels a null (legacy unsegmented) segmentCode explicitly, never as a fabricated code (task Section 19 test S)', async () => {
    const getRfm = createGetDashboardRfm({
      resolveCurrent: vi.fn(async () => baseAvailable),
      resolveForFeatureSnapshot: vi.fn(async () => baseAvailable),
      clusterAnalyticsReader: clusterAnalyticsReader(),
      dashboardAnalyticsReader: dashboardAnalyticsReader(),
    });
    const result = await getRfm({ featureSnapshotId: null });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    const unsegmented = result.segments.find((s) => s.segmentCode === null)!;
    expect(unsegmented.businessLabel).toBe('Clientes sin segmento RFM');
    expect(unsegmented.customerCount).toBe(10);
  });

  it('returns no_compatible_rfm_snapshot when the resolved context has no RFM snapshot, without calling the segment aggregate reader', async () => {
    const reader = dashboardAnalyticsReader();
    const getRfm = createGetDashboardRfm({
      resolveCurrent: vi.fn(async () => noRfmAvailable),
      resolveForFeatureSnapshot: vi.fn(async () => noRfmAvailable),
      clusterAnalyticsReader: clusterAnalyticsReader(),
      dashboardAnalyticsReader: reader,
    });
    const result = await getRfm({ featureSnapshotId: null });
    expect(result).toMatchObject({ status: 'no_compatible_rfm_snapshot' });
    expect(reader.getRfmSegmentAggregates).not.toHaveBeenCalled();
  });
});
