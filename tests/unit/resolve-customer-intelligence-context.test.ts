import { describe, expect, it, vi } from 'vitest';
import { createCustomerIntelligenceContextResolvers } from '../../src/application/customer-intelligence/resolve-customer-intelligence-context.js';
import { AnalyticsUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { CustomerFeatureSnapshotReader, StoredCustomerFeatureSnapshot } from '../../src/application/customer-analytics/ports.js';
import type { ClusterSnapshotHeader, CustomerIntelligenceReader, RfmSnapshotHeader, SnapshotHeaderReader } from '../../src/application/customer-intelligence/ports.js';

function featureSnapshot(overrides: Partial<StoredCustomerFeatureSnapshot> = {}): StoredCustomerFeatureSnapshot {
  return {
    snapshotId: '17',
    featureVersion: 'customer-analytics-features-v1',
    populationPolicyVersion: 'customer-analytics-population-b-v1',
    referenceTime: new Date('2026-08-19T00:00:00.000Z'),
    generatedAt: new Date('2026-08-19T00:05:00.000Z'),
    publishedAt: new Date('2026-08-19T00:06:00.000Z'),
    populationSize: 44935,
    sourceDatasetChecksum: 'a'.repeat(64),
    featureDatasetChecksum: 'b'.repeat(64),
    status: 'published',
    ...overrides,
  };
}

function featureReader(snapshot: StoredCustomerFeatureSnapshot | null): CustomerFeatureSnapshotReader {
  return {
    getLatestPublishedSnapshot: vi.fn(async () => snapshot),
    getSnapshotById: vi.fn(async () => snapshot),
    getRow: vi.fn(),
  };
}

function headerReader(rfm: readonly RfmSnapshotHeader[], cluster: readonly ClusterSnapshotHeader[]): SnapshotHeaderReader {
  return {
    getPublishedRfmSnapshotHeaders: vi.fn(async () => rfm),
    getPublishedClusterSnapshotHeaders: vi.fn(async () => cluster),
  };
}

function intelligenceReaderWithCounts(counts: { featurePopulation: number; rfmMatched: number; clusterMatched: number; bothMatched: number }): CustomerIntelligenceReader {
  return {
    getRow: vi.fn(),
    listRows: vi.fn(),
    getCoverageCounts: vi.fn(async () => counts),
  };
}

describe('createCustomerIntelligenceContextResolvers — resolveCurrent', () => {
  it('returns no_published_feature_snapshot when nothing has ever been published', async () => {
    const { resolveCurrent } = createCustomerIntelligenceContextResolvers({
      featureSnapshotReader: featureReader(null),
      snapshotHeaderReader: headerReader([], []),
      intelligenceReader: intelligenceReaderWithCounts({ featurePopulation: 0, rfmMatched: 0, clusterMatched: 0, bothMatched: 0 }),
    });
    const result = await resolveCurrent();
    expect(result.status).toBe('no_published_feature_snapshot');
  });

  it('resolves RFM/cluster to null when no compatible snapshot exists (never an error)', async () => {
    const { resolveCurrent } = createCustomerIntelligenceContextResolvers({
      featureSnapshotReader: featureReader(featureSnapshot()),
      snapshotHeaderReader: headerReader([], []),
      intelligenceReader: intelligenceReaderWithCounts({ featurePopulation: 44935, rfmMatched: 0, clusterMatched: 0, bothMatched: 0 }),
    });
    const result = await resolveCurrent();
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.context.rfmSnapshot).toBeNull();
      expect(result.context.clusterSnapshot).toBeNull();
      expect(result.resolvedIds.rfmSnapshotId).toBeNull();
      expect(result.resolvedIds.clusterSnapshotId).toBeNull();
    }
  });

  it('never selects an RFM/cluster snapshot with a referenceTime after the feature snapshot anchor (future-snapshot guard)', async () => {
    const anchor = featureSnapshot({ referenceTime: new Date('2026-08-19T00:00:00.000Z') });
    const { resolveCurrent } = createCustomerIntelligenceContextResolvers({
      featureSnapshotReader: featureReader(anchor),
      snapshotHeaderReader: headerReader(
        [
          { snapshotId: '90', referenceTime: '2026-08-17T00:00:00.000Z', calculationVersion: 'rfm-population-v1' },
          { snapshotId: '110', referenceTime: '2026-08-21T00:00:00.000Z', calculationVersion: 'rfm-population-v1' }, // future, must be excluded
        ],
        [
          { snapshotId: '95', referenceTime: '2026-08-18T00:00:00.000Z', modelId: '1', modelVersion: 'behavioral-kmeans-k4-v1' },
          { snapshotId: '120', referenceTime: '2026-08-22T00:00:00.000Z', modelId: '1', modelVersion: 'behavioral-kmeans-k4-v1' }, // future
        ],
      ),
      intelligenceReader: intelligenceReaderWithCounts({ featurePopulation: 44935, rfmMatched: 100, clusterMatched: 50, bothMatched: 25 }),
    });
    const result = await resolveCurrent();
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.context.rfmSnapshot?.snapshotId).toBe('90');
      expect(result.context.clusterSnapshot?.snapshotId).toBe('95');
      expect(result.resolvedIds.rfmSnapshotId).toBe('90');
      expect(result.resolvedIds.clusterSnapshotId).toBe('95');
    }
  });

  it('propagates coverage counts through computeCoverageSummary', async () => {
    const { resolveCurrent } = createCustomerIntelligenceContextResolvers({
      featureSnapshotReader: featureReader(featureSnapshot()),
      snapshotHeaderReader: headerReader(
        [{ snapshotId: '1', referenceTime: '2026-08-18T00:00:00.000Z', calculationVersion: 'rfm-population-v1' }],
        [{ snapshotId: '1', referenceTime: '2026-08-18T00:00:00.000Z', modelId: '1', modelVersion: 'behavioral-kmeans-k4-v1' }],
      ),
      intelligenceReader: intelligenceReaderWithCounts({ featurePopulation: 10, rfmMatched: 7, clusterMatched: 4, bothMatched: 3 }),
    });
    const result = await resolveCurrent();
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.context.population).toEqual({
        featurePopulation: 10,
        rfmMatched: 7,
        clusterMatched: 4,
        bothMatched: 3,
        neitherMatched: 2,
        rfmCoveragePct: 70,
        clusterCoveragePct: 40,
      });
    }
  });

  it('maps an analytics DB failure to a degraded result rather than throwing', async () => {
    const failingFeatureReader: CustomerFeatureSnapshotReader = {
      getLatestPublishedSnapshot: vi.fn(async () => {
        throw new AnalyticsUnavailableError('down');
      }),
      getSnapshotById: vi.fn(),
      getRow: vi.fn(),
    };
    const { resolveCurrent } = createCustomerIntelligenceContextResolvers({
      featureSnapshotReader: failingFeatureReader,
      snapshotHeaderReader: headerReader([], []),
      intelligenceReader: intelligenceReaderWithCounts({ featurePopulation: 0, rfmMatched: 0, clusterMatched: 0, bothMatched: 0 }),
    });
    const result = await resolveCurrent();
    expect(result).toEqual(expect.objectContaining({ status: 'degraded', reason: 'analytics_unavailable' }));
  });
});

describe('createCustomerIntelligenceContextResolvers — resolveForFeatureSnapshot (historical, task Section 30/49)', () => {
  it('returns feature_snapshot_not_found for an unknown historical id', async () => {
    const { resolveForFeatureSnapshot } = createCustomerIntelligenceContextResolvers({
      featureSnapshotReader: featureReader(null),
      snapshotHeaderReader: headerReader([], []),
      intelligenceReader: intelligenceReaderWithCounts({ featurePopulation: 0, rfmMatched: 0, clusterMatched: 0, bothMatched: 0 }),
    });
    const result = await resolveForFeatureSnapshot('999');
    expect(result).toEqual(expect.objectContaining({ status: 'feature_snapshot_not_found', featureSnapshotId: '999' }));
  });

  it('anchors to the historical feature snapshot A, not any snapshot published after A', async () => {
    const historicalAnchor = featureSnapshot({ snapshotId: '10', referenceTime: new Date('2026-06-01T00:00:00.000Z') });
    const { resolveForFeatureSnapshot } = createCustomerIntelligenceContextResolvers({
      featureSnapshotReader: featureReader(historicalAnchor),
      snapshotHeaderReader: headerReader(
        [
          { snapshotId: '1', referenceTime: '2026-05-01T00:00:00.000Z', calculationVersion: 'rfm-population-v1' }, // before A
          { snapshotId: '2', referenceTime: '2026-07-01T00:00:00.000Z', calculationVersion: 'rfm-population-v1' }, // after A
        ],
        [],
      ),
      intelligenceReader: intelligenceReaderWithCounts({ featurePopulation: 1000, rfmMatched: 500, clusterMatched: 0, bothMatched: 0 }),
    });
    const result = await resolveForFeatureSnapshot('10');
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.context.featureSnapshot.snapshotId).toBe('10');
      expect(result.context.rfmSnapshot?.snapshotId).toBe('1');
    }
  });
});
