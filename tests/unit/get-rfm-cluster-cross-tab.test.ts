import { describe, expect, it, vi } from 'vitest';
import { createGetRfmClusterCrossTab } from '../../src/application/customer-clustering/get-rfm-cluster-cross-tab.js';
import { getRfmClusterCrossTabNotConfigured, getRfmClusterCrossTabRfmNotConfigured } from '../../src/application/customer-clustering/cluster-analytics-not-configured.js';
import { ClusterUnavailableError, RfmUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { ClusterAnalyticsReader, ClusterAnalyticsSnapshotMeta } from '../../src/infrastructure/clustering/mysql-cluster-analytics-reader.js';
import type { RfmSegmentBulkReader } from '../../src/infrastructure/rfm/mysql-rfm-segment-bulk-reader.js';

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
  populationSize: 6,
};

// Cluster 0: customers 1,2,3. Cluster 1: customers 4,5,6. Customer 5 has no RFM row at all
// (unmatched); customer 6 has a null segment_code (pre-migration-003 historical row).
const clusterRows = [
  { prestashopCustomerId: 1, clusterId: 0, distanceToCentroid: 0.1 },
  { prestashopCustomerId: 2, clusterId: 0, distanceToCentroid: 0.2 },
  { prestashopCustomerId: 3, clusterId: 0, distanceToCentroid: 0.3 },
  { prestashopCustomerId: 4, clusterId: 1, distanceToCentroid: 0.4 },
  { prestashopCustomerId: 5, clusterId: 1, distanceToCentroid: 0.5 },
  { prestashopCustomerId: 6, clusterId: 1, distanceToCentroid: 0.6 },
];

const rfmSnapshotRows = [
  { prestashopCustomerId: 1, segmentCode: 'CHAMPION' },
  { prestashopCustomerId: 2, segmentCode: 'CHAMPION' },
  { prestashopCustomerId: 3, segmentCode: 'LOYAL' },
  { prestashopCustomerId: 4, segmentCode: 'CHAMPION' },
  { prestashopCustomerId: 6, segmentCode: null },
];

function analyticsReader(overrides: Partial<ClusterAnalyticsReader> = {}): ClusterAnalyticsReader {
  return {
    getLatestPublishedSnapshot: vi.fn(async () => meta),
    getPublishedSnapshotById: vi.fn(async () => meta),
    getClusterSizeDistribution: vi.fn(async () => new Map()),
    getInterpretations: vi.fn(async () => new Map()),
    listSnapshotRows: vi.fn(async () => clusterRows),
    ...overrides,
  };
}

function rfmReader(overrides: Partial<RfmSegmentBulkReader> = {}): RfmSegmentBulkReader {
  return {
    getLatestPublishedSnapshotSegments: vi.fn(async () => ({
      snapshot: { snapshotId: '9', referenceTime: new Date('2026-08-18T00:00:00.000Z') },
      rows: rfmSnapshotRows,
    })),
    ...overrides,
  };
}

describe('getRfmClusterCrossTab', () => {
  it('computes coverage and per-cell counts/percentages with partial overlap', async () => {
    const getCrossTab = createGetRfmClusterCrossTab({ clusterAnalyticsReader: analyticsReader(), rfmSegmentBulkReader: rfmReader() });
    const result = await getCrossTab({ snapshotId: null });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;

    expect(result.clusterSnapshot).toEqual({ snapshotId: '1', referenceTime: '2026-08-19T00:00:00.000Z' });
    expect(result.rfmSnapshot).toEqual({ snapshotId: '9', referenceTime: '2026-08-18T00:00:00.000Z' });
    expect(result.coverage).toEqual({
      clusterPopulation: 6,
      comparablePopulation: 5,
      unmatchedPopulation: 1,
      coveragePct: 83.33,
    });

    const cell = (clusterId: number, rfmSegment: string) => result.rows.find((r) => r.clusterId === clusterId && r.rfmSegment === rfmSegment);
    expect(cell(0, 'CHAMPION')).toMatchObject({ customerCount: 2, pctWithinCluster: 66.67, pctWithinRfmSegment: 66.67 });
    expect(cell(0, 'LOYAL')).toMatchObject({ customerCount: 1, pctWithinCluster: 33.33, pctWithinRfmSegment: 100 });
    expect(cell(1, 'CHAMPION')).toMatchObject({ customerCount: 1, pctWithinCluster: 50, pctWithinRfmSegment: 33.33 });
    expect(cell(1, 'UNSEGMENTED')).toMatchObject({ customerCount: 1, pctWithinCluster: 50, pctWithinRfmSegment: 100 });
  });

  it('returns no_compatible_rfm_snapshot without failing cluster analytics when no RFM snapshot is published', async () => {
    const getCrossTab = createGetRfmClusterCrossTab({
      clusterAnalyticsReader: analyticsReader(),
      rfmSegmentBulkReader: rfmReader({ getLatestPublishedSnapshotSegments: vi.fn(async () => null) }),
    });
    const result = await getCrossTab({ snapshotId: null });
    expect(result).toMatchObject({ status: 'no_compatible_rfm_snapshot', clusterSnapshot: { snapshotId: '1' } });
  });

  it('returns no_published_cluster_snapshot when latest is requested and none exists', async () => {
    const getCrossTab = createGetRfmClusterCrossTab({
      clusterAnalyticsReader: analyticsReader({ getLatestPublishedSnapshot: vi.fn(async () => null) }),
      rfmSegmentBulkReader: rfmReader(),
    });
    const result = await getCrossTab({ snapshotId: null });
    expect(result).toMatchObject({ status: 'no_published_cluster_snapshot' });
  });

  it('returns cluster_snapshot_not_found for an unknown specific snapshotId', async () => {
    const getCrossTab = createGetRfmClusterCrossTab({
      clusterAnalyticsReader: analyticsReader({ getPublishedSnapshotById: vi.fn(async () => null) }),
      rfmSegmentBulkReader: rfmReader(),
    });
    const result = await getCrossTab({ snapshotId: '999' });
    expect(result).toMatchObject({ status: 'cluster_snapshot_not_found', snapshotId: '999' });
  });

  it('returns degraded cluster_analytics_unavailable when the cluster DB read fails', async () => {
    const getCrossTab = createGetRfmClusterCrossTab({
      clusterAnalyticsReader: analyticsReader({
        listSnapshotRows: vi.fn(async () => {
          throw new ClusterUnavailableError('x');
        }),
      }),
      rfmSegmentBulkReader: rfmReader(),
    });
    const result = await getCrossTab({ snapshotId: null });
    expect(result).toMatchObject({ status: 'degraded', reason: 'cluster_analytics_unavailable' });
  });

  it('returns degraded rfm_unavailable when the RFM DB read fails (cluster side stays intact)', async () => {
    const getCrossTab = createGetRfmClusterCrossTab({
      clusterAnalyticsReader: analyticsReader(),
      rfmSegmentBulkReader: rfmReader({
        getLatestPublishedSnapshotSegments: vi.fn(async () => {
          throw new RfmUnavailableError('x');
        }),
      }),
    });
    const result = await getCrossTab({ snapshotId: null });
    expect(result).toMatchObject({ status: 'degraded', reason: 'rfm_unavailable' });
  });
});

describe('not-configured constants', () => {
  it('getRfmClusterCrossTabNotConfigured always returns cluster_analytics_not_configured', async () => {
    const result = await getRfmClusterCrossTabNotConfigured({ snapshotId: null });
    expect(result).toMatchObject({ status: 'degraded', reason: 'cluster_analytics_not_configured' });
  });

  it('getRfmClusterCrossTabRfmNotConfigured always returns rfm_not_configured', async () => {
    const result = await getRfmClusterCrossTabRfmNotConfigured({ snapshotId: null });
    expect(result).toMatchObject({ status: 'degraded', reason: 'rfm_not_configured' });
  });
});
