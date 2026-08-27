import { describe, expect, it, vi } from 'vitest';
import { createGetDashboardContext } from '../../src/application/customer-intelligence-dashboard/get-dashboard-context.js';
import type { ResolveCustomerIntelligenceContextResult } from '../../src/application/customer-intelligence/resolve-customer-intelligence-context.js';
import type { ClusterAnalyticsReader } from '../../src/infrastructure/clustering/mysql-cluster-analytics-reader.js';

const availableResult: ResolveCustomerIntelligenceContextResult = {
  status: 'available',
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
    population: { featurePopulation: 100, rfmMatched: 40, clusterMatched: 20, bothMatched: 10, neitherMatched: 50, rfmCoveragePct: 40, clusterCoveragePct: 20 },
    contractVersion: 'customer-intelligence-read-model-v1',
  },
};

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

describe('getDashboardContext', () => {
  it('flattens the resolved context into the dashboard-context-v1 shape and passes through population verbatim', async () => {
    const getContext = createGetDashboardContext({
      resolveCurrent: vi.fn(async () => availableResult),
      resolveForFeatureSnapshot: vi.fn(async () => availableResult),
      clusterAnalyticsReader: clusterAnalyticsReader(),
    });
    const result = await getContext({ featureSnapshotId: null });
    expect(result).toMatchObject({
      status: 'available',
      contractVersion: 'customer-intelligence-dashboard-context-v1',
      context: {
        featureSnapshotId: '17',
        rfmSnapshotId: '9',
        clusterSnapshotId: '5',
        clusterModelVersion: 'behavioral-kmeans-k4-v1',
        clusterInterpretationVersion: 'v1',
      },
      population: availableResult.context.population,
    });
  });

  it('derives clusterInterpretationVersion as null when interpreted clusters disagree on version', async () => {
    const getContext = createGetDashboardContext({
      resolveCurrent: vi.fn(async () => availableResult),
      resolveForFeatureSnapshot: vi.fn(async () => availableResult),
      clusterAnalyticsReader: clusterAnalyticsReader({
        getInterpretations: vi.fn(
          async () =>
            new Map([
              [0, { label: 'A', description: 'a', interpretationVersion: 'v1' }],
              [1, { label: 'B', description: 'b', interpretationVersion: 'v2' }],
            ]),
        ),
      }),
    });
    const result = await getContext({ featureSnapshotId: null });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.context.clusterInterpretationVersion).toBeNull();
  });

  it('sets clusterInterpretationVersion null when no cluster snapshot resolved', async () => {
    const noClusterResult: ResolveCustomerIntelligenceContextResult = {
      ...availableResult,
      context: { ...availableResult.context, clusterSnapshot: null },
      resolvedIds: { ...availableResult.resolvedIds, clusterSnapshotId: null, clusterReferenceTime: null, clusterModelId: null, clusterModelVersion: null },
    };
    const reader = clusterAnalyticsReader();
    const getContext = createGetDashboardContext({
      resolveCurrent: vi.fn(async () => noClusterResult),
      resolveForFeatureSnapshot: vi.fn(async () => noClusterResult),
      clusterAnalyticsReader: reader,
    });
    const result = await getContext({ featureSnapshotId: null });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.context.clusterInterpretationVersion).toBeNull();
    expect(reader.getInterpretations).not.toHaveBeenCalled();
  });

  it('calls resolveForFeatureSnapshot when an explicit featureSnapshotId is given, resolveCurrent otherwise', async () => {
    const resolveCurrent = vi.fn(async () => availableResult);
    const resolveForFeatureSnapshot = vi.fn(async () => availableResult);
    const getContext = createGetDashboardContext({ resolveCurrent, resolveForFeatureSnapshot, clusterAnalyticsReader: clusterAnalyticsReader() });

    await getContext({ featureSnapshotId: null });
    expect(resolveCurrent).toHaveBeenCalledTimes(1);
    expect(resolveForFeatureSnapshot).not.toHaveBeenCalled();

    await getContext({ featureSnapshotId: '17' });
    expect(resolveForFeatureSnapshot).toHaveBeenCalledWith('17');
  });

  it('passes through no_published_feature_snapshot / feature_snapshot_not_found / degraded statuses unchanged', async () => {
    const getContext = createGetDashboardContext({
      resolveCurrent: vi.fn(async () => ({ status: 'no_published_feature_snapshot' as const, contractVersion: 'customer-intelligence-read-model-v1' })),
      resolveForFeatureSnapshot: vi.fn(async () => ({ status: 'feature_snapshot_not_found' as const, featureSnapshotId: '999', contractVersion: 'customer-intelligence-read-model-v1' })),
      clusterAnalyticsReader: clusterAnalyticsReader(),
    });
    expect(await getContext({ featureSnapshotId: null })).toMatchObject({ status: 'no_published_feature_snapshot' });
    expect(await getContext({ featureSnapshotId: '999' })).toMatchObject({ status: 'feature_snapshot_not_found', featureSnapshotId: '999' });
  });

  it('maps degraded analytics_unavailable/analytics_not_configured to the dashboard degraded reasons', async () => {
    const getContext = createGetDashboardContext({
      resolveCurrent: vi.fn(async () => ({ status: 'degraded' as const, reason: 'analytics_unavailable' as const, contractVersion: 'customer-intelligence-read-model-v1' })),
      resolveForFeatureSnapshot: vi.fn(async () => availableResult),
      clusterAnalyticsReader: clusterAnalyticsReader(),
    });
    expect(await getContext({ featureSnapshotId: null })).toMatchObject({ status: 'degraded', reason: 'analytics_unavailable' });
  });
});
