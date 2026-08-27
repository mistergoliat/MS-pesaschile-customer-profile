import { describe, expect, it, vi } from 'vitest';
import { createGetDashboardIntersection } from '../../src/application/customer-intelligence-dashboard/get-dashboard-intersection.js';
import type { ExecuteIntersection } from '../../src/application/customer-intelligence-intersection/index.js';
import type { CustomerIntelligenceIntersectionResult } from '../../src/domain/customer-intelligence-intersection/index.js';
import type { ClusterAnalyticsReader } from '../../src/infrastructure/clustering/mysql-cluster-analytics-reader.js';

const resolvedContext = {
  featureSnapshot: {
    snapshotId: '17',
    referenceTime: '2026-08-19T00:00:00.000Z',
    featureVersion: 'customer-analytics-features-v1',
    populationPolicyVersion: 'customer-analytics-population-b-v1',
  },
  rfmSnapshot: { snapshotId: '9', referenceTime: '2026-08-18T00:00:00.000Z', calculationVersion: 'rfm-v1' },
  clusterSnapshot: { snapshotId: '5', referenceTime: '2026-08-17T00:00:00.000Z', modelId: '2', modelVersion: 'behavioral-kmeans-k4-v1' },
  population: { featurePopulation: 100, rfmMatched: 40, clusterMatched: 35, bothMatched: 20, neitherMatched: 45, rfmCoveragePct: 40, clusterCoveragePct: 35 },
  contractVersion: 'customer-intelligence-read-model-v1' as const,
};

const availableIntersection: CustomerIntelligenceIntersectionResult = {
  status: 'available',
  definition: {
    contractVersion: 'customer-intelligence-intersection-v1',
    filters: { field: 'rfm.segmentCode', operator: 'eq', value: 'CHAMPION' },
    resolvedContext,
    queryPlanHash: 'a'.repeat(64),
  },
  population: {
    matchingPopulation: 30,
    featurePopulation: 100,
    rfmMatchedPopulation: 40,
    clusterMatchedPopulation: 35,
    bothMatchedPopulation: 20,
    rfmCoveragePct: 40,
    clusterCoveragePct: 35,
    requiredDimensions: ['rfm'],
  },
  metrics: {
    totalSpentTaxIncl: '900000.000000',
    averageOrderValueTaxIncl: '10000.000000',
    averageTotalSpentTaxIncl: '30000.000000',
    averageValidOrders: '3.000000',
    averageOrders365d: '1.500000',
    averageDaysSinceLastOrder: '10.000000',
    averagePurchaseFrequencyDays: '45.000000',
    purchaseFrequencyDaysSampleSize: 25,
    averageEffectiveDiversity: '1.800000',
    averageRepeatProductRate: '0.400000',
  },
  execution: { queryCount: 2, filterLeafCount: 1, filterDepth: 1 },
};

function clusterAnalyticsReader(): ClusterAnalyticsReader {
  return {
    getLatestPublishedSnapshot: vi.fn(async () => null),
    getPublishedSnapshotById: vi.fn(async () => null),
    getClusterSizeDistribution: vi.fn(async () => new Map()),
    getInterpretations: vi.fn(async () => new Map([[3, { label: 'C', description: 'c', interpretationVersion: 'v1' }]])),
    listSnapshotRows: vi.fn(async () => []),
  };
}

describe('getDashboardIntersection', () => {
  it('reshapes an available intersection into the dashboard response, flattening context and preserving the queryPlanHash', async () => {
    const executeIntersection: ExecuteIntersection = vi.fn(async () => availableIntersection);
    const getIntersection = createGetDashboardIntersection({ executeIntersection, clusterAnalyticsReader: clusterAnalyticsReader() });
    const result = await getIntersection({ featureSnapshotId: null, filters: { field: 'rfm.segmentCode', operator: 'eq', value: 'CHAMPION' } });
    expect(result).toMatchObject({
      status: 'available',
      contractVersion: 'customer-intelligence-dashboard-intersection-response-v1',
      context: { featureSnapshotId: '17', rfmSnapshotId: '9', clusterSnapshotId: '5' },
      intersection: { matchingPopulation: 30, requiredDimensions: ['rfm'] },
      metrics: availableIntersection.metrics,
      analyticalDefinition: { queryPlanHash: 'a'.repeat(64) },
      execution: { queryCount: 2 },
    });
  });

  it('maps required_rfm_snapshot_unavailable through with a flattened context', async () => {
    const executeIntersection: ExecuteIntersection = vi.fn(async () => ({ status: 'required_rfm_snapshot_unavailable' as const, resolvedContext }));
    const getIntersection = createGetDashboardIntersection({ executeIntersection, clusterAnalyticsReader: clusterAnalyticsReader() });
    const result = await getIntersection({ featureSnapshotId: null, filters: undefined });
    expect(result).toMatchObject({ status: 'required_rfm_snapshot_unavailable', context: { rfmSnapshotId: '9' } });
  });

  it('passes invalid_intersection errors through unchanged', async () => {
    const executeIntersection: ExecuteIntersection = vi.fn(async () => ({ status: 'invalid_intersection' as const, errors: ['unknown field: x'] }));
    const getIntersection = createGetDashboardIntersection({ executeIntersection, clusterAnalyticsReader: clusterAnalyticsReader() });
    const result = await getIntersection({ featureSnapshotId: null, filters: undefined });
    expect(result).toMatchObject({ status: 'invalid_intersection', errors: ['unknown field: x'] });
  });

  it('maps degraded analytics_unavailable/analytics_not_configured to the dashboard vocabulary', async () => {
    const executeIntersection: ExecuteIntersection = vi.fn(async () => ({ status: 'degraded' as const, reason: 'analytics_not_configured' as const }));
    const getIntersection = createGetDashboardIntersection({ executeIntersection, clusterAnalyticsReader: clusterAnalyticsReader() });
    const result = await getIntersection({ featureSnapshotId: null, filters: undefined });
    expect(result).toMatchObject({ status: 'degraded', reason: 'dashboard_not_configured' });
  });
});
