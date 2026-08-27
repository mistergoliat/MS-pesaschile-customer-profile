import { describe, expect, it, vi } from 'vitest';
import { createGetDashboardOverview } from '../../src/application/customer-intelligence-dashboard/get-dashboard-overview.js';
import type { ResolveCustomerIntelligenceContextResult } from '../../src/application/customer-intelligence/resolve-customer-intelligence-context.js';
import type { ClusterAnalyticsReader } from '../../src/infrastructure/clustering/mysql-cluster-analytics-reader.js';
import type { DashboardAnalyticsReader, DashboardOverviewCommercialAggregate } from '../../src/application/customer-intelligence-dashboard/ports.js';

const availableResult: ResolveCustomerIntelligenceContextResult = {
  status: 'available',
  resolvedIds: {
    featureSnapshotId: '17',
    featureReferenceTime: '2026-08-19T00:00:00.000Z',
    featureVersion: 'customer-analytics-features-v1',
    populationPolicyVersion: 'customer-analytics-population-b-v1',
    rfmSnapshotId: null,
    rfmReferenceTime: null,
    calculationVersion: null,
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
    rfmSnapshot: null,
    clusterSnapshot: null,
    population: { featurePopulation: 100, rfmMatched: 0, clusterMatched: 0, bothMatched: 0, neitherMatched: 100, rfmCoveragePct: 0, clusterCoveragePct: 0 },
    contractVersion: 'customer-intelligence-read-model-v1',
  },
};

const commercialAggregate: DashboardOverviewCommercialAggregate = {
  totalSpentTaxIncl: '1000000.000000',
  totalValidOrders: 250,
  averageOrderValueTaxIncl: '4000.000000',
  averageValidOrders: '2.5000',
  averageOrders365d: '1.2000',
  averageDaysSinceLastOrder: '30.0000',
  averagePurchaseFrequencyDays: '45.5000',
  purchaseFrequencyDaysSampleSize: 60,
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
    getOverviewCommercialAggregate: vi.fn(async () => commercialAggregate),
    getRfmSegmentAggregates: vi.fn(async () => []),
    getClusterAggregates: vi.fn(async () => []),
    getClusterRfmCrossSectionGroups: vi.fn(async () => []),
    ...overrides,
  };
}

describe('getDashboardOverview', () => {
  it('returns available with population coverage and commercial KPIs even when RFM/cluster are entirely absent (task Section 4/16)', async () => {
    const getOverview = createGetDashboardOverview({
      resolveCurrent: vi.fn(async () => availableResult),
      resolveForFeatureSnapshot: vi.fn(async () => availableResult),
      clusterAnalyticsReader: clusterAnalyticsReader(),
      dashboardAnalyticsReader: dashboardAnalyticsReader(),
    });
    const result = await getOverview({ featureSnapshotId: null });
    expect(result).toMatchObject({
      status: 'available',
      contractVersion: 'customer-intelligence-dashboard-overview-v1',
      population: { featurePopulation: 100, rfmMatched: 0, clusterMatched: 0 },
      commercial: commercialAggregate,
    });
  });

  it('never fabricates averagePurchaseFrequencyDays when the sample is empty - passes the reader value through as null', async () => {
    const reader = dashboardAnalyticsReader({
      getOverviewCommercialAggregate: vi.fn(async () => ({ ...commercialAggregate, averagePurchaseFrequencyDays: null, purchaseFrequencyDaysSampleSize: 0 })),
    });
    const getOverview = createGetDashboardOverview({
      resolveCurrent: vi.fn(async () => availableResult),
      resolveForFeatureSnapshot: vi.fn(async () => availableResult),
      clusterAnalyticsReader: clusterAnalyticsReader(),
      dashboardAnalyticsReader: reader,
    });
    const result = await getOverview({ featureSnapshotId: null });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.commercial.averagePurchaseFrequencyDays).toBeNull();
    expect(result.commercial.purchaseFrequencyDaysSampleSize).toBe(0);
  });

  it('returns no_published_feature_snapshot without ever calling the dashboard reader', async () => {
    const reader = dashboardAnalyticsReader();
    const getOverview = createGetDashboardOverview({
      resolveCurrent: vi.fn(async () => ({ status: 'no_published_feature_snapshot' as const, contractVersion: 'customer-intelligence-read-model-v1' })),
      resolveForFeatureSnapshot: vi.fn(async () => availableResult),
      clusterAnalyticsReader: clusterAnalyticsReader(),
      dashboardAnalyticsReader: reader,
    });
    const result = await getOverview({ featureSnapshotId: null });
    expect(result).toMatchObject({ status: 'no_published_feature_snapshot' });
    expect(reader.getOverviewCommercialAggregate).not.toHaveBeenCalled();
  });

  it('maps degraded reasons through', async () => {
    const getOverview = createGetDashboardOverview({
      resolveCurrent: vi.fn(async () => ({ status: 'degraded' as const, reason: 'analytics_unavailable' as const, contractVersion: 'customer-intelligence-read-model-v1' })),
      resolveForFeatureSnapshot: vi.fn(async () => availableResult),
      clusterAnalyticsReader: clusterAnalyticsReader(),
      dashboardAnalyticsReader: dashboardAnalyticsReader(),
    });
    expect(await getOverview({ featureSnapshotId: null })).toMatchObject({ status: 'degraded', reason: 'analytics_unavailable' });
  });
});
