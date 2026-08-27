import { describe, expect, it, vi } from 'vitest';
import { createGetDashboardClusters } from '../../src/application/customer-intelligence-dashboard/get-dashboard-clusters.js';
import type { ResolveCustomerIntelligenceContextResult } from '../../src/application/customer-intelligence/resolve-customer-intelligence-context.js';
import type { ClusterAnalyticsReader } from '../../src/infrastructure/clustering/mysql-cluster-analytics-reader.js';
import type {
  DashboardAnalyticsReader,
  DashboardClusterAggregate,
  DashboardClusterRfmCrossSectionGroup,
} from '../../src/application/customer-intelligence-dashboard/ports.js';

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
    clusterSnapshotId: '5',
    clusterReferenceTime: '2026-08-17T00:00:00.000Z',
    clusterModelId: '2',
    clusterModelVersion: 'behavioral-kmeans-k4-v1',
  },
  context: {
    featureSnapshot: {
      snapshotId: '17',
      referenceTime: '2026-08-19T00:00:00.000Z',
      featureVersion: 'customer-analytics-features-v1',
      populationPolicyVersion: 'customer-analytics-population-b-v1',
    },
    rfmSnapshot: { snapshotId: '9', referenceTime: '2026-08-18T00:00:00.000Z', calculationVersion: 'rfm-v1' },
    clusterSnapshot: { snapshotId: '5', referenceTime: '2026-08-17T00:00:00.000Z', modelId: '2', modelVersion: 'behavioral-kmeans-k4-v1' },
    population: { featurePopulation: 100, rfmMatched: 40, clusterMatched: 35, bothMatched: 20, neitherMatched: 45, rfmCoveragePct: 40, clusterCoveragePct: 35 },
    contractVersion: 'customer-intelligence-read-model-v1',
  },
} satisfies ResolveCustomerIntelligenceContextResult;

const noClusterAvailable = {
  ...baseAvailable,
  resolvedIds: { ...baseAvailable.resolvedIds, clusterSnapshotId: null, clusterReferenceTime: null, clusterModelId: null, clusterModelVersion: null },
  context: { ...baseAvailable.context, clusterSnapshot: null, population: { ...baseAvailable.context.population, clusterMatched: 0, clusterCoveragePct: 0 } },
} satisfies ResolveCustomerIntelligenceContextResult;

const clusterAggregates: readonly DashboardClusterAggregate[] = [
  {
    clusterId: 0,
    customerCount: 20,
    averageOrderValueTaxIncl: '3000.000000',
    averageTotalSpentTaxIncl: '15000.000000',
    averageValidOrders: '3.0000',
    averageOrders365d: '1.0000',
    averageDaysSinceLastOrder: '10.0000',
    averageEffectiveDiversity: '0.5000',
    averageRepeatProductRate: '0.4000',
  },
  {
    clusterId: 1,
    customerCount: 15,
    averageOrderValueTaxIncl: '2000.000000',
    averageTotalSpentTaxIncl: '8000.000000',
    averageValidOrders: '2.0000',
    averageOrders365d: '0.5000',
    averageDaysSinceLastOrder: '40.0000',
    averageEffectiveDiversity: '0.3000',
    averageRepeatProductRate: '0.2000',
  },
];

const crossSectionGroups: readonly DashboardClusterRfmCrossSectionGroup[] = [
  { clusterId: 0, hasRfmRow: true, segmentCode: 'CHAMPION', customerCount: 12 },
  { clusterId: 0, hasRfmRow: true, segmentCode: null, customerCount: 3 },
  { clusterId: 0, hasRfmRow: false, segmentCode: null, customerCount: 5 },
  { clusterId: 1, hasRfmRow: true, segmentCode: 'LOYAL', customerCount: 15 },
];

function clusterAnalyticsReader(overrides: Partial<ClusterAnalyticsReader> = {}): ClusterAnalyticsReader {
  return {
    getLatestPublishedSnapshot: vi.fn(async () => null),
    getPublishedSnapshotById: vi.fn(async () => null),
    getClusterSizeDistribution: vi.fn(async () => new Map()),
    getInterpretations: vi.fn(async () => new Map([[0, { label: 'A', description: 'a', interpretationVersion: 'v1' }]])),
    listSnapshotRows: vi.fn(async () => []),
    ...overrides,
  };
}

function dashboardAnalyticsReader(overrides: Partial<DashboardAnalyticsReader> = {}): DashboardAnalyticsReader {
  return {
    getOverviewCommercialAggregate: vi.fn(async () => {
      throw new Error('unreachable');
    }),
    getRfmSegmentAggregates: vi.fn(async () => {
      throw new Error('unreachable');
    }),
    getClusterAggregates: vi.fn(async () => clusterAggregates),
    getClusterRfmCrossSectionGroups: vi.fn(async () => crossSectionGroups),
    ...overrides,
  };
}

describe('getDashboardClusters', () => {
  it('returns cluster distribution with business labels, and unclustered customers never appear as a cluster row (task Section 20 test Y)', async () => {
    const getClusters = createGetDashboardClusters({
      resolveCurrent: vi.fn(async () => baseAvailable),
      resolveForFeatureSnapshot: vi.fn(async () => baseAvailable),
      clusterAnalyticsReader: clusterAnalyticsReader(),
      dashboardAnalyticsReader: dashboardAnalyticsReader(),
    });
    const result = await getClusters({ featureSnapshotId: null });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.analyzedPopulation).toBe(35);
    expect(result.fullFeaturePopulation).toBe(100);
    expect(result.clusters).toHaveLength(2);
    const cluster0 = result.clusters.find((c) => c.clusterId === 0)!;
    expect(cluster0.businessLabel).toBe('A');
    expect(cluster0.percentageOfClusterPopulation).toBe(57.14); // 20/35*100, rounded to 2 decimals
    expect(cluster0.percentageOfFeaturePopulation).toBe(20); // 20/100*100
    const cluster1 = result.clusters.find((c) => c.clusterId === 1)!;
    expect(cluster1.businessLabel).toBeNull(); // no interpretation for cluster 1 in the fixture
    expect(cluster1.interpretationVersion).toBeNull();
  });

  it('computes the RFM cross-section per cluster, distinguishing UNSEGMENTED (matched, no segment) from not-in-RFM (task Section 19 test S/X)', async () => {
    const getClusters = createGetDashboardClusters({
      resolveCurrent: vi.fn(async () => baseAvailable),
      resolveForFeatureSnapshot: vi.fn(async () => baseAvailable),
      clusterAnalyticsReader: clusterAnalyticsReader(),
      dashboardAnalyticsReader: dashboardAnalyticsReader(),
    });
    const result = await getClusters({ featureSnapshotId: null });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.rfmCrossSectionAvailable).toBe(true);

    const cluster0 = result.clusters.find((c) => c.clusterId === 0)!;
    expect(cluster0.rfmCrossSection).not.toBeNull();
    expect(cluster0.rfmCrossSection!.comparablePopulation).toBe(15);
    expect(cluster0.rfmCrossSection!.notInRfmPopulation).toBe(5);
    expect(cluster0.rfmCrossSection!.coveragePct).toBe(75);
    const champion = cluster0.rfmCrossSection!.segments.find((s) => s.segmentCode === 'CHAMPION')!;
    expect(champion.customerCount).toBe(12);
    expect(champion.percentageOfComparablePopulation).toBe(80);
    const unsegmented = cluster0.rfmCrossSection!.segments.find((s) => s.segmentCode === null)!;
    expect(unsegmented.customerCount).toBe(3);
    expect(unsegmented.businessLabel).toBe('Clientes sin segmento RFM');

    const cluster1 = result.clusters.find((c) => c.clusterId === 1)!;
    expect(cluster1.rfmCrossSection!.notInRfmPopulation).toBe(0);
    expect(cluster1.rfmCrossSection!.coveragePct).toBe(100);
  });

  it('leaves every cluster rfmCrossSection null and never calls the cross-section reader when no compatible RFM snapshot resolved (task Section 16)', async () => {
    const reader = dashboardAnalyticsReader();
    const noRfmResult = {
      ...baseAvailable,
      resolvedIds: { ...baseAvailable.resolvedIds, rfmSnapshotId: null, rfmReferenceTime: null, calculationVersion: null },
      context: { ...baseAvailable.context, rfmSnapshot: null },
    } satisfies ResolveCustomerIntelligenceContextResult;
    const getClusters = createGetDashboardClusters({
      resolveCurrent: vi.fn(async () => noRfmResult),
      resolveForFeatureSnapshot: vi.fn(async () => noRfmResult),
      clusterAnalyticsReader: clusterAnalyticsReader(),
      dashboardAnalyticsReader: reader,
    });
    const result = await getClusters({ featureSnapshotId: null });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.rfmCrossSectionAvailable).toBe(false);
    expect(result.clusters.every((c) => c.rfmCrossSection === null)).toBe(true);
    expect(reader.getClusterRfmCrossSectionGroups).not.toHaveBeenCalled();
  });

  it('returns no_compatible_cluster_snapshot when the resolved context has no cluster snapshot', async () => {
    const reader = dashboardAnalyticsReader();
    const getClusters = createGetDashboardClusters({
      resolveCurrent: vi.fn(async () => noClusterAvailable),
      resolveForFeatureSnapshot: vi.fn(async () => noClusterAvailable),
      clusterAnalyticsReader: clusterAnalyticsReader(),
      dashboardAnalyticsReader: reader,
    });
    const result = await getClusters({ featureSnapshotId: null });
    expect(result).toMatchObject({ status: 'no_compatible_cluster_snapshot' });
    expect(reader.getClusterAggregates).not.toHaveBeenCalled();
  });
});
