import { describe, expect, it, vi } from 'vitest';
import { createGetClusterSnapshotSummary } from '../../src/application/customer-clustering/get-cluster-snapshot-summary.js';
import { getClusterSnapshotSummaryNotConfigured } from '../../src/application/customer-clustering/cluster-analytics-not-configured.js';
import { ClusterSchemaIncompatibleError, ClusterTimeoutError, ClusterUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { ClusterAnalyticsReader, ClusterAnalyticsSnapshotMeta } from '../../src/infrastructure/clustering/mysql-cluster-analytics-reader.js';
import type { ClusterSnapshotProfileRepository } from '../../src/infrastructure/clustering/mysql-cluster-snapshot-profile-repository.js';
import { featureOrder } from '../../src/domain/customer-clustering/model-version.js';
import type { ClusterSnapshotProfile } from '../../src/domain/customer-clustering/index.js';

const meta: ClusterAnalyticsSnapshotMeta = {
  snapshotId: '1',
  modelId: '1',
  modelVersion: 'behavioral-kmeans-k4-v1',
  algorithm: 'kmeans',
  k: 4,
  featureVersion: 'behavioral-clustering-features-v1',
  preprocessingVersion: 'behavioral-clustering-preprocessing-v1',
  temporalStabilityStatus: 'not_yet_validated',
  metrics: {
    silhouette: 0.2292,
    daviesBouldin: 1.3348,
    calinskiHarabasz: 2000,
    seedAriMean: 0.9926,
    seedAriMin: 0.987,
    resampleAriMean: 0.9807,
    resampleAriMin: 0.9471,
  },
  status: 'published',
  referenceTime: new Date('2026-08-19T21:20:00.000Z'),
  publishedAt: new Date('2026-08-19T21:25:00.000Z'),
  populationSize: 10,
};

function stat(value: number) {
  return { mean: value, median: value, p25: value, p75: value };
}

function featureProfile() {
  return Object.fromEntries(featureOrder.map((f) => [f, stat(1)])) as unknown as ClusterSnapshotProfile['featureProfile'];
}

function fakeProfile(clusterId: number): ClusterSnapshotProfile {
  return {
    snapshotId: '1',
    clusterId,
    customerCount: 5,
    featureProfile: featureProfile(),
    commercialProfile: {
      totalSpentTaxIncl: stat(100),
      averageOrderValueTaxIncl: stat(50),
      validOrders: stat(2),
      daysSinceLastOrder: stat(10),
    },
    distanceProfile: { medianDistance: 0.5, p95Distance: 0.9, maxDistance: 1.2 },
    profileChecksum: 'checksum',
    generatedAt: '2026-08-19T21:30:00.000Z',
  };
}

function reader(overrides: Partial<ClusterAnalyticsReader> = {}): ClusterAnalyticsReader {
  return {
    getLatestPublishedSnapshot: vi.fn(async () => meta),
    getPublishedSnapshotById: vi.fn(async () => meta),
    getClusterSizeDistribution: vi.fn(async () => new Map([[0, 6], [1, 4]])),
    getInterpretations: vi.fn(async () => new Map([[0, { label: 'A', description: 'a', interpretationVersion: 'v1' }]])),
    listSnapshotRows: vi.fn(async () => []),
    ...overrides,
  };
}

function profileRepository(overrides: Partial<ClusterSnapshotProfileRepository> = {}): ClusterSnapshotProfileRepository {
  return {
    getProfiles: vi.fn(async () => [fakeProfile(0), fakeProfile(1)]),
    upsertProfiles: vi.fn(async () => ({ upserted: 0, skipped: 0 })),
    ...overrides,
  };
}

describe('getClusterSnapshotSummary', () => {
  it('returns available with population/percentage/interpretation/profile per cluster', async () => {
    const getSummary = createGetClusterSnapshotSummary({
      clusterAnalyticsReader: reader(),
      clusterSnapshotProfileRepository: profileRepository(),
    });
    const result = await getSummary({ snapshotId: null });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.snapshot.snapshotId).toBe('1');
    expect(result.model.k).toBe(4);
    expect(result.clusters).toHaveLength(2);
    const cluster0 = result.clusters.find((c) => c.clusterId === 0)!;
    expect(cluster0.population).toEqual({ count: 6, percentage: 60 });
    expect(cluster0.interpretation).toEqual({ label: 'A', description: 'a', interpretationVersion: 'v1' });
    expect(cluster0.featureProfile).not.toBeNull();
  });

  it('leaves featureProfile/commercialProfile/distanceProfile null for a cluster with no backfilled profile', async () => {
    const getSummary = createGetClusterSnapshotSummary({
      clusterAnalyticsReader: reader(),
      clusterSnapshotProfileRepository: profileRepository({ getProfiles: vi.fn(async () => []) }),
    });
    const result = await getSummary({ snapshotId: null });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    const cluster0 = result.clusters.find((c) => c.clusterId === 0)!;
    expect(cluster0.featureProfile).toBeNull();
    expect(cluster0.commercialProfile).toBeNull();
    expect(cluster0.distanceProfile).toBeNull();
    // Population count/percentage still available even with no profile.
    expect(cluster0.population.count).toBe(6);
  });

  it('returns no_published_cluster_snapshot when snapshotId is null and none exists', async () => {
    const getSummary = createGetClusterSnapshotSummary({
      clusterAnalyticsReader: reader({ getLatestPublishedSnapshot: vi.fn(async () => null) }),
      clusterSnapshotProfileRepository: profileRepository(),
    });
    const result = await getSummary({ snapshotId: null });
    expect(result).toMatchObject({ status: 'no_published_cluster_snapshot' });
  });

  it('returns cluster_snapshot_not_found for an unknown specific snapshotId', async () => {
    const getSummary = createGetClusterSnapshotSummary({
      clusterAnalyticsReader: reader({ getPublishedSnapshotById: vi.fn(async () => null) }),
      clusterSnapshotProfileRepository: profileRepository(),
    });
    const result = await getSummary({ snapshotId: '999' });
    expect(result).toMatchObject({ status: 'cluster_snapshot_not_found', snapshotId: '999' });
  });

  it.each([new ClusterUnavailableError('x'), new ClusterTimeoutError('x'), new ClusterSchemaIncompatibleError('x')])(
    'returns degraded cluster_analytics_unavailable for %s',
    async (error) => {
      const getSummary = createGetClusterSnapshotSummary({
        clusterAnalyticsReader: reader({
          getLatestPublishedSnapshot: vi.fn(async () => {
            throw error;
          }),
        }),
        clusterSnapshotProfileRepository: profileRepository(),
      });
      const result = await getSummary({ snapshotId: null });
      expect(result).toMatchObject({ status: 'degraded', reason: 'cluster_analytics_unavailable' });
    },
  );
});

describe('getClusterSnapshotSummaryNotConfigured', () => {
  it('always returns degraded cluster_analytics_not_configured', async () => {
    const result = await getClusterSnapshotSummaryNotConfigured({ snapshotId: null });
    expect(result).toMatchObject({ status: 'degraded', reason: 'cluster_analytics_not_configured' });
  });
});
