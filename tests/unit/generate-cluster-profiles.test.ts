import { describe, expect, it, vi } from 'vitest';
import { generateClusterProfiles } from '../../src/application/customer-clustering/generate-cluster-profiles.js';
import { featureOrder } from '../../src/domain/customer-clustering/model-version.js';
import type { ClusterAnalyticsReader, ClusterAnalyticsSnapshotMeta } from '../../src/infrastructure/clustering/mysql-cluster-analytics-reader.js';
import type { ClusterSnapshotProfileRepository } from '../../src/infrastructure/clustering/mysql-cluster-snapshot-profile-repository.js';
import type {
  ClusterCommercialAggregateReader,
  ClusterPopulationReader,
} from '../../src/infrastructure/prestashop/mysql-cluster-population-reader.js';
import type { RawClusterFeatureVector } from '../../src/domain/customer-clustering/contracts.js';

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
    silhouette: 0.2,
    daviesBouldin: 1.3,
    calinskiHarabasz: 2000,
    seedAriMean: 0.99,
    seedAriMin: 0.98,
    resampleAriMean: 0.98,
    resampleAriMin: 0.96,
  },
  status: 'published',
  referenceTime: new Date('2026-08-19T00:00:00.000Z'),
  publishedAt: new Date('2026-08-19T00:05:00.000Z'),
  populationSize: 2,
};

const snapshotRows = [
  { prestashopCustomerId: 1, clusterId: 0, distanceToCentroid: 0.1 },
  { prestashopCustomerId: 2, clusterId: 1, distanceToCentroid: 0.2 },
];

function featureVector(value: number): RawClusterFeatureVector {
  return Object.fromEntries(featureOrder.map((f) => [f, value])) as RawClusterFeatureVector;
}

function analyticsReader(overrides: Partial<ClusterAnalyticsReader> = {}): ClusterAnalyticsReader {
  return {
    getLatestPublishedSnapshot: vi.fn(async () => meta),
    getPublishedSnapshotById: vi.fn(async () => meta),
    getClusterSizeDistribution: vi.fn(async () => new Map()),
    getInterpretations: vi.fn(async () => new Map()),
    listSnapshotRows: vi.fn(async () => snapshotRows),
    ...overrides,
  };
}

function featureReaderReturning(rows: { prestashopCustomerId: number; features: RawClusterFeatureVector }[]): ClusterPopulationReader {
  return { readPopulation: vi.fn(async () => rows) };
}

function commercialReaderReturning(
  rows: { prestashopCustomerId: number; totalSpentTaxIncl: number; averageOrderValueTaxIncl: number; validOrders: number; daysSinceLastOrder: number }[],
): ClusterCommercialAggregateReader {
  return { readCommercialAggregates: vi.fn(async () => rows) };
}

const clock = { now: () => new Date('2026-08-19T12:00:00.000Z') };

describe('generateClusterProfiles', () => {
  it('builds and upserts profiles for a published snapshot', async () => {
    const upsertProfiles = vi.fn(async () => ({ upserted: 2, skipped: 0 }));
    const profileRepository: ClusterSnapshotProfileRepository = { getProfiles: vi.fn(async () => []), upsertProfiles };

    const result = await generateClusterProfiles(
      { snapshotId: '1' },
      {
        clusterAnalyticsReader: analyticsReader(),
        createFeatureReader: () =>
          featureReaderReturning([
            { prestashopCustomerId: 1, features: featureVector(10) },
            { prestashopCustomerId: 2, features: featureVector(20) },
          ]),
        createCommercialAggregateReader: () =>
          commercialReaderReturning([
            { prestashopCustomerId: 1, totalSpentTaxIncl: 100, averageOrderValueTaxIncl: 50, validOrders: 2, daysSinceLastOrder: 5 },
            { prestashopCustomerId: 2, totalSpentTaxIncl: 200, averageOrderValueTaxIncl: 100, validOrders: 2, daysSinceLastOrder: 3 },
          ]),
        profileRepository,
        clock,
      },
    );

    expect(result.mode).toBe('generated');
    expect(result.profiles).toHaveLength(2);
    expect(upsertProfiles).toHaveBeenCalledOnce();
    const sumCounts = result.profiles.reduce((sum, p) => sum + p.customerCount, 0);
    expect(sumCounts).toBe(meta.populationSize);
  });

  it('reports skipped_unchanged when the repository reuses an existing matching checksum', async () => {
    const profileRepository: ClusterSnapshotProfileRepository = {
      getProfiles: vi.fn(async () => []),
      upsertProfiles: vi.fn(async () => ({ upserted: 0, skipped: 2 })),
    };

    const result = await generateClusterProfiles(
      { snapshotId: '1' },
      {
        clusterAnalyticsReader: analyticsReader(),
        createFeatureReader: () =>
          featureReaderReturning([
            { prestashopCustomerId: 1, features: featureVector(10) },
            { prestashopCustomerId: 2, features: featureVector(20) },
          ]),
        createCommercialAggregateReader: () =>
          commercialReaderReturning([
            { prestashopCustomerId: 1, totalSpentTaxIncl: 100, averageOrderValueTaxIncl: 50, validOrders: 2, daysSinceLastOrder: 5 },
            { prestashopCustomerId: 2, totalSpentTaxIncl: 200, averageOrderValueTaxIncl: 100, validOrders: 2, daysSinceLastOrder: 3 },
          ]),
        profileRepository,
        clock,
      },
    );

    expect(result.mode).toBe('skipped_unchanged');
  });

  it('throws when the requested snapshot is not published', async () => {
    await expect(
      generateClusterProfiles(
        { snapshotId: '404' },
        {
          clusterAnalyticsReader: analyticsReader({ getPublishedSnapshotById: vi.fn(async () => null) }),
          createFeatureReader: () => featureReaderReturning([]),
          createCommercialAggregateReader: () => commercialReaderReturning([]),
          profileRepository: { getProfiles: vi.fn(async () => []), upsertProfiles: vi.fn() },
          clock,
        },
      ),
    ).rejects.toThrow(/not published/);
  });

  it('throws when re-extracted population is missing a customer present in the published snapshot (Section 43: fail on mismatch)', async () => {
    await expect(
      generateClusterProfiles(
        { snapshotId: '1' },
        {
          clusterAnalyticsReader: analyticsReader(),
          // Only customer 1 comes back — customer 2 (present in snapshotRows) is missing,
          // simulating PrestaShop order-validity drift since publication.
          createFeatureReader: () => featureReaderReturning([{ prestashopCustomerId: 1, features: featureVector(10) }]),
          createCommercialAggregateReader: () =>
            commercialReaderReturning([{ prestashopCustomerId: 1, totalSpentTaxIncl: 100, averageOrderValueTaxIncl: 50, validOrders: 2, daysSinceLastOrder: 5 }]),
          profileRepository: { getProfiles: vi.fn(async () => []), upsertProfiles: vi.fn() },
          clock,
        },
      ),
    ).rejects.toThrow(/missing/);
  });

  it('throws when the snapshot row count does not match its own populationSize', async () => {
    await expect(
      generateClusterProfiles(
        { snapshotId: '1' },
        {
          clusterAnalyticsReader: analyticsReader({ listSnapshotRows: vi.fn(async () => [snapshotRows[0]!]) }),
          createFeatureReader: () => featureReaderReturning([]),
          createCommercialAggregateReader: () => commercialReaderReturning([]),
          profileRepository: { getProfiles: vi.fn(async () => []), upsertProfiles: vi.fn() },
          clock,
        },
      ),
    ).rejects.toThrow(/populationSize/);
  });
});
