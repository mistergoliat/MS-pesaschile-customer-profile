import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  createMysqlClusterSnapshotRepository,
  type ClusterSnapshotRepositoryFailureStage,
} from '../../src/infrastructure/clustering/mysql-cluster-snapshot-repository.js';
import { sha256Stable } from '../../src/domain/customer-rfm/checksum.js';
import { checksumVersion } from '../../src/domain/customer-clustering/model-version.js';
import type { PersistClusterSnapshotInput } from '../../src/application/customer-clustering/ports.js';

function input(): PersistClusterSnapshotInput {
  const rows: PersistClusterSnapshotInput['rows'] = [{ prestashopCustomerId: 22066, clusterId: 3, distanceToCentroid: 1.0866226070 }];
  const assignmentChecksum = sha256Stable({
    checksumVersion,
    modelVersion: 'behavioral-kmeans-k4-v1',
    rows: rows.map((r) => ({ prestashopCustomerId: r.prestashopCustomerId, clusterId: r.clusterId, distanceToCentroid: r.distanceToCentroid.toFixed(10) })),
  });
  return {
    snapshotKey: 'behavioral-kmeans-k4-v1__cp-r2-clustering-population-b-prime-v1__2026-08-19T00-00-00-000Z',
    modelId: '1',
    referenceTime: '2026-08-19T00:00:00.000Z',
    populationPolicyVersion: 'cp-r2-clustering-population-b-prime-v1',
    populationSize: 1,
    datasetChecksum: 'a'.repeat(64),
    assignmentChecksum,
    generatedAt: '2026-08-19T00:00:05.000Z',
    manifest: {
      snapshotKey: 'behavioral-kmeans-k4-v1__cp-r2-clustering-population-b-prime-v1__2026-08-19T00-00-00-000Z',
      modelVersion: 'behavioral-kmeans-k4-v1',
      referenceTime: '2026-08-19T00:00:00.000Z',
      populationPolicyVersion: 'cp-r2-clustering-population-b-prime-v1',
      populationSize: 1,
      datasetChecksum: 'a'.repeat(64),
      assignmentChecksum,
      generatedAt: '2026-08-19T00:00:05.000Z',
      clusterSizeDistribution: { '3': 1 },
    },
    rows,
  };
}

function toPersistedRowData(row: PersistClusterSnapshotInput['rows'][number]): RowDataPacket {
  return {
    prestashopCustomerId: row.prestashopCustomerId,
    clusterId: row.clusterId,
    distanceToCentroid: row.distanceToCentroid.toFixed(10),
  } as unknown as RowDataPacket;
}

function fakePool(
  options: { readonly failOnRowInsert?: boolean; readonly persistedRows?: RowDataPacket[] } = {},
) {
  const calls: string[] = [];
  const execute = vi.fn(async (sql: string) => {
    calls.push(sql);
    if (options.failOnRowInsert && sql.includes('INSERT INTO customer_cluster_snapshot_row')) {
      throw new Error('row insert failed');
    }
    if (sql.includes('COUNT(*) AS rowCount')) return [[{ rowCount: 1 }], []];
    if (sql.includes('FROM customer_cluster_snapshot_row')) {
      return [options.persistedRows ?? [toPersistedRowData(input().rows[0]!)], []];
    }
    if (sql.includes('INSERT INTO customer_cluster_snapshot')) return [{ insertId: 7 }, []];
    return [[], []];
  });
  const connection = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(),
    execute,
  } as unknown as PoolConnection;
  const pool = {
    getConnection: vi.fn(async () => connection),
    execute: vi.fn(async () => [[], []]),
  } as unknown as Pool;
  return { pool, connection, calls };
}

describe('createMysqlClusterSnapshotRepository', () => {
  it('publishes building -> validated -> published inside a single transaction', async () => {
    const { pool, connection, calls } = fakePool();
    const snapshotInput = input();
    const result = await createMysqlClusterSnapshotRepository(pool).publishSnapshot(snapshotInput);

    expect(result).toEqual({ snapshotId: '7', persistedRowCount: 1, assignmentChecksum: snapshotInput.assignmentChecksum });
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(calls.join('\n')).toContain("VALUES (?, ?, 'building'");
    expect(calls.join('\n')).toContain("SET status = 'superseded'");
    expect(calls.join('\n')).toContain("SET status = 'validated'");
    expect(calls.join('\n')).toContain("SET status = 'published'");
  });

  it('rolls back and never commits when row persistence fails', async () => {
    const { pool, connection } = fakePool({ failOnRowInsert: true });
    await expect(createMysqlClusterSnapshotRepository(pool).publishSnapshot(input())).rejects.toThrow(/row insert failed/);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it.each<ClusterSnapshotRepositoryFailureStage>([
    'after_begin',
    'after_header_insert',
    'during_row_insert',
    'after_rows_insert',
    'before_row_count',
    'after_row_count_before_checksum',
    'before_supersede_previous',
    'after_supersede_before_publish',
    'before_commit',
  ])('rolls back cleanly for induced failure stage %s — never a partial published snapshot', async (stage) => {
    const { pool, connection } = fakePool();
    await expect(createMysqlClusterSnapshotRepository(pool, { failAt: stage }).publishSnapshot(input())).rejects.toThrow(
      new RegExp(stage),
    );
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('verifies the persisted assignment checksum before publishing (catches a corrupted write)', async () => {
    const changedRows = [toPersistedRowData({ prestashopCustomerId: 22066, clusterId: 1, distanceToCentroid: 9.9 })];
    const { pool, connection } = fakePool({ persistedRows: changedRows });
    await expect(createMysqlClusterSnapshotRepository(pool).publishSnapshot(input())).rejects.toThrow(/checksum/);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('finds a published snapshot by key', async () => {
    const pool = {
      execute: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT id, assignment_checksum')) {
          return [[{ id: 7, assignment_checksum: 'f'.repeat(64) }], []];
        }
        return [[], []];
      }),
    } as unknown as Pool;
    const result = await createMysqlClusterSnapshotRepository(pool).findPublishedSnapshot('some-key');
    expect(result).toEqual({ snapshotId: '7', assignmentChecksum: 'f'.repeat(64) });
  });

  it('returns null when no published snapshot exists for the key', async () => {
    const pool = { execute: vi.fn(async () => [[], []]) } as unknown as Pool;
    const result = await createMysqlClusterSnapshotRepository(pool).findPublishedSnapshot('missing-key');
    expect(result).toBeNull();
  });
});
