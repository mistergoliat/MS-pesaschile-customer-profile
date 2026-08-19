import { describe, expect, it, vi } from 'vitest';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createMysqlClusterSnapshotReader } from '../../src/infrastructure/clustering/mysql-cluster-snapshot-reader.js';
import { ClusterUnavailableError } from '../../src/application/customer-profile/errors.js';

function snapshotRow(): RowDataPacket {
  return {
    snapshotId: 7,
    modelId: 3,
    modelVersion: 'behavioral-kmeans-k4-v1',
    algorithm: 'kmeans',
    k: 4,
    featureVersion: 'behavioral-clustering-features-v1',
    preprocessingVersion: 'behavioral-clustering-preprocessing-v1',
    referenceTime: '2026-08-19 00:00:00',
    publishedAt: '2026-08-19 00:05:00',
    populationSize: 10147,
  } as unknown as RowDataPacket;
}

describe('createMysqlClusterSnapshotReader', () => {
  it('returns snapshot=null, record=null when nothing has ever been published', async () => {
    const pool = { execute: vi.fn(async () => [[], []]) } as unknown as Pool;
    const lookup = await createMysqlClusterSnapshotReader(pool).getCurrentCustomerClusterLookup(22066);
    expect(lookup).toEqual({ snapshot: null, record: null });
  });

  it('returns snapshot with record=null when the customer has no row in the published snapshot', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('FROM customer_cluster_snapshot s')) return [[snapshotRow()], []];
      if (sql.includes('FROM customer_cluster_snapshot_row')) return [[], []];
      return [[], []];
    });
    const pool = { execute } as unknown as Pool;
    const lookup = await createMysqlClusterSnapshotReader(pool).getCurrentCustomerClusterLookup(22092);
    expect(lookup.snapshot?.snapshotId).toBe('7');
    expect(lookup.record).toBeNull();
  });

  it('returns the full record with interpretation when the customer is clustered', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('FROM customer_cluster_snapshot s')) return [[snapshotRow()], []];
      if (sql.includes('FROM customer_cluster_snapshot_row')) {
        return [[{ clusterId: 3, distanceToCentroid: '1.0866226070' } as unknown as RowDataPacket], []];
      }
      if (sql.includes('FROM customer_cluster_interpretation')) {
        return [[{ label: 'NEW_BURST_THEN_LAPSED_BUYERS', description: 'x', interpretationVersion: 'behavioral-cluster-interpretation-v1' } as unknown as RowDataPacket], []];
      }
      return [[], []];
    });
    const pool = { execute } as unknown as Pool;
    const lookup = await createMysqlClusterSnapshotReader(pool).getCurrentCustomerClusterLookup(22066);
    expect(lookup.record).toMatchObject({
      prestashopCustomerId: 22066,
      clusterId: 3,
      distanceToCentroid: 1.086622607,
      interpretationLabel: 'NEW_BURST_THEN_LAPSED_BUYERS',
    });
  });

  it('returns a record with null interpretation fields when no label has been registered yet', async () => {
    const execute = vi.fn(async (sql: string) => {
      if (sql.includes('FROM customer_cluster_snapshot s')) return [[snapshotRow()], []];
      if (sql.includes('FROM customer_cluster_snapshot_row')) {
        return [[{ clusterId: 0, distanceToCentroid: '0.5' } as unknown as RowDataPacket], []];
      }
      if (sql.includes('FROM customer_cluster_interpretation')) return [[], []];
      return [[], []];
    });
    const pool = { execute } as unknown as Pool;
    const lookup = await createMysqlClusterSnapshotReader(pool).getCurrentCustomerClusterLookup(22066);
    expect(lookup.record?.interpretationLabel).toBeNull();
  });

  it('maps a connection failure to ClusterUnavailableError', async () => {
    const pool = {
      execute: vi.fn(async () => {
        throw { code: 'ECONNREFUSED' };
      }),
    } as unknown as Pool;
    await expect(createMysqlClusterSnapshotReader(pool).getCurrentCustomerClusterLookup(22066)).rejects.toThrow(ClusterUnavailableError);
  });
});
