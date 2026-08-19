import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { createMysqlClusterAnalyticsReader } from '../../src/infrastructure/clustering/mysql-cluster-analytics-reader.js';
import { ClusterUnavailableError } from '../../src/application/customer-profile/errors.js';

function fakePool(byMarker: Record<string, unknown[]>) {
  const execute = vi.fn(async (sql: string) => {
    for (const [marker, rows] of Object.entries(byMarker)) {
      if (sql.includes(marker)) return [rows, []];
    }
    return [[], []];
  });
  return { execute } as unknown as Pool;
}

const metricsRow = {
  snapshotId: 1,
  modelId: 3,
  modelVersion: 'behavioral-kmeans-k4-v1',
  algorithm: 'kmeans',
  k: 4,
  featureVersion: 'behavioral-clustering-features-v1',
  preprocessingVersion: 'behavioral-clustering-preprocessing-v1',
  temporalStabilityStatus: 'not_yet_validated',
  metricsJson: JSON.stringify({
    silhouette: 0.2292,
    daviesBouldin: 1.3348,
    calinskiHarabasz: 2000,
    seedAriMean: 0.9926,
    seedAriMin: 0.987,
    resampleAriMean: 0.9807,
    resampleAriMin: 0.9471,
  }),
  status: 'published',
  referenceTime: '2026-08-19 21:20:00',
  publishedAt: '2026-08-19 21:25:00',
  populationSize: 10147,
};

describe('createMysqlClusterAnalyticsReader', () => {
  it('getLatestPublishedSnapshot returns the assembled meta', async () => {
    const pool = fakePool({ 'FROM customer_cluster_snapshot s': [metricsRow] });
    const reader = createMysqlClusterAnalyticsReader(pool);
    const meta = await reader.getLatestPublishedSnapshot();
    expect(meta).toMatchObject({ snapshotId: '1', modelVersion: 'behavioral-kmeans-k4-v1', status: 'published', populationSize: 10147 });
    expect(meta!.metrics.silhouette).toBe(0.2292);
  });

  it('getLatestPublishedSnapshot returns null when nothing is published', async () => {
    const pool = fakePool({});
    const reader = createMysqlClusterAnalyticsReader(pool);
    expect(await reader.getLatestPublishedSnapshot()).toBeNull();
  });

  it('getPublishedSnapshotById accepts a superseded snapshot (historical reproducibility)', async () => {
    const pool = fakePool({ 'FROM customer_cluster_snapshot s': [{ ...metricsRow, status: 'superseded' }] });
    const reader = createMysqlClusterAnalyticsReader(pool);
    const meta = await reader.getPublishedSnapshotById('1');
    expect(meta).toMatchObject({ status: 'superseded' });
  });

  it('getPublishedSnapshotById returns null for a building/validated/failed snapshot (never exposed)', async () => {
    const pool = fakePool({ 'FROM customer_cluster_snapshot s': [{ ...metricsRow, status: 'building' }] });
    const reader = createMysqlClusterAnalyticsReader(pool);
    expect(await reader.getPublishedSnapshotById('1')).toBeNull();
  });

  it('getClusterSizeDistribution returns a clusterId -> count map', async () => {
    const pool = fakePool({
      'FROM customer_cluster_snapshot_row': [
        { clusterId: 0, customerCount: 6 },
        { clusterId: 1, customerCount: 4 },
      ],
    });
    const reader = createMysqlClusterAnalyticsReader(pool);
    const distribution = await reader.getClusterSizeDistribution('1');
    expect(distribution.get(0)).toBe(6);
    expect(distribution.get(1)).toBe(4);
  });

  it('getInterpretations keeps the latest (highest id) interpretation per clusterId', async () => {
    const pool = fakePool({
      'FROM customer_cluster_interpretation': [
        { id: 1, clusterId: 0, label: 'OLD_LABEL', description: 'old', interpretationVersion: 'v1' },
        { id: 5, clusterId: 0, label: 'NEW_LABEL', description: 'new', interpretationVersion: 'v2' },
      ],
    });
    const reader = createMysqlClusterAnalyticsReader(pool);
    const interpretations = await reader.getInterpretations('3');
    expect(interpretations.get(0)).toEqual({ label: 'NEW_LABEL', description: 'new', interpretationVersion: 'v2' });
  });

  it('listSnapshotRows returns prestashopCustomerId/clusterId/distanceToCentroid', async () => {
    const pool = fakePool({
      'FROM customer_cluster_snapshot_row': [{ prestashopCustomerId: 22066, clusterId: 3, distanceToCentroid: '1.0866226070' }],
    });
    const reader = createMysqlClusterAnalyticsReader(pool);
    const rows = await reader.listSnapshotRows('1');
    expect(rows).toEqual([{ prestashopCustomerId: 22066, clusterId: 3, distanceToCentroid: 1.086622607 }]);
  });

  it('maps a connection failure to ClusterUnavailableError', async () => {
    const pool = { execute: vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' }); }) } as unknown as Pool;
    const reader = createMysqlClusterAnalyticsReader(pool);
    await expect(reader.getLatestPublishedSnapshot()).rejects.toBeInstanceOf(ClusterUnavailableError);
  });
});
