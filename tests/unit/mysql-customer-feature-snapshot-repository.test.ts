import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  createMysqlCustomerFeatureSnapshotRepository,
  type CustomerFeatureSnapshotRepositoryFailureStage,
} from '../../src/infrastructure/customer-analytics/mysql-customer-feature-snapshot-repository.js';
import { sha256Stable } from '../../src/domain/customer-rfm/checksum.js';
import { checksumVersion, featureVersion, operationalAccountExclusionPolicyVersion, populationPolicyVersion, shopScope } from '../../src/domain/customer-analytics/model-version.js';
import type { CustomerFeatureRow } from '../../src/domain/customer-analytics/contracts.js';
import type { PersistCustomerFeatureSnapshotInput } from '../../src/application/customer-analytics/ports.js';

function row(): CustomerFeatureRow {
  return {
    prestashopCustomerId: 22066,
    validOrders: 2,
    totalSpentTaxIncl: '56433.000000',
    averageOrderValueTaxIncl: '28216.500000',
    firstOrderAt: '2026-01-01T00:00:00.000Z',
    lastOrderAt: '2026-07-01T00:00:00.000Z',
    daysSinceLastOrder: 49,
    customerTenureDays: 1447,
    distinctProducts: 1,
    repeatProductRate: '0.000000',
    top1Share: '1.000000',
    top3Share: '1.000000',
    effectiveDiversity: '1.000000',
    averageUnitsPerOrder: '1.500000',
    purchaseFrequencyDays: '181.000000',
    orders365d: 0,
    cancelledOrderRatio: '0.000000',
    discountShare: '0.000000',
    shippingShare: '0.335596',
  };
}

function input(): PersistCustomerFeatureSnapshotInput {
  const rows = [row()];
  const featureDatasetChecksum = sha256Stable({ checksumVersion, featureVersion, rows });
  return {
    snapshotKey: 'customer-analytics-features-v1__customer-analytics-population-b-v1__2026-08-19T00-00-00-000Z',
    referenceTime: '2026-08-19T00:00:00.000Z',
    featureVersion,
    populationPolicyVersion,
    operationalExclusionPolicyVersion: operationalAccountExclusionPolicyVersion,
    shopScope,
    populationSize: 1,
    sourceDatasetChecksum: 'a'.repeat(64),
    featureDatasetChecksum,
    generatedAt: '2026-08-19T00:00:05.000Z',
    manifest: {
      snapshotKey: 'customer-analytics-features-v1__customer-analytics-population-b-v1__2026-08-19T00-00-00-000Z',
      featureVersion,
      populationPolicyVersion,
      operationalExclusionPolicyVersion: operationalAccountExclusionPolicyVersion,
      shopScope,
      referenceTime: '2026-08-19T00:00:00.000Z',
      populationSize: 1,
      sourceDatasetChecksum: 'a'.repeat(64),
      featureDatasetChecksum,
      generatedAt: '2026-08-19T00:00:05.000Z',
    },
    rows,
  };
}

function toPersistedRowData(r: CustomerFeatureRow): RowDataPacket {
  return {
    prestashopCustomerId: r.prestashopCustomerId,
    validOrders: r.validOrders,
    totalSpentTaxIncl: r.totalSpentTaxIncl,
    averageOrderValueTaxIncl: r.averageOrderValueTaxIncl,
    firstOrderAt: new Date(r.firstOrderAt),
    lastOrderAt: new Date(r.lastOrderAt),
    daysSinceLastOrder: r.daysSinceLastOrder,
    customerTenureDays: r.customerTenureDays,
    distinctProducts: r.distinctProducts,
    repeatProductRate: r.repeatProductRate,
    top1Share: r.top1Share,
    top3Share: r.top3Share,
    effectiveDiversity: r.effectiveDiversity,
    averageUnitsPerOrder: r.averageUnitsPerOrder,
    purchaseFrequencyDays: r.purchaseFrequencyDays,
    orders365d: r.orders365d,
    cancelledOrderRatio: r.cancelledOrderRatio,
    discountShare: r.discountShare,
    shippingShare: r.shippingShare,
  } as unknown as RowDataPacket;
}

function fakePool(options: { readonly failOnRowInsert?: boolean; readonly persistedRows?: RowDataPacket[] } = {}) {
  const calls: string[] = [];
  const execute = vi.fn(async (sql: string) => {
    calls.push(sql);
    if (options.failOnRowInsert && sql.includes('INSERT INTO customer_feature_snapshot_row')) {
      throw new Error('row insert failed');
    }
    if (sql.includes('COUNT(*) AS rowCount')) return [[{ rowCount: 1 }], []];
    if (sql.includes('FROM customer_feature_snapshot_row')) {
      return [options.persistedRows ?? [toPersistedRowData(input().rows[0]!)], []];
    }
    if (sql.includes('INSERT INTO customer_feature_snapshot ')) return [{ insertId: 7 }, []];
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

describe('createMysqlCustomerFeatureSnapshotRepository', () => {
  it('publishes building -> validated -> published inside a single transaction', async () => {
    const { pool, connection, calls } = fakePool();
    const snapshotInput = input();
    const result = await createMysqlCustomerFeatureSnapshotRepository(pool).publishSnapshot(snapshotInput);

    expect(result).toEqual({ snapshotId: '7', persistedRowCount: 1, featureDatasetChecksum: snapshotInput.featureDatasetChecksum });
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(calls.join('\n')).toContain("VALUES (?, 'building'");
    expect(calls.join('\n')).toContain("SET status = 'superseded'");
    expect(calls.join('\n')).toContain("SET status = 'validated'");
    expect(calls.join('\n')).toContain("SET status = 'published'");
  });

  it('batches row inserts (task Section 55) rather than one INSERT per row', async () => {
    const { pool, calls } = fakePool();
    await createMysqlCustomerFeatureSnapshotRepository(pool).publishSnapshot(input());
    const rowInsertCalls = calls.filter((sql) => sql.includes('INSERT INTO customer_feature_snapshot_row'));
    expect(rowInsertCalls).toHaveLength(1); // single row, single batch
    expect(rowInsertCalls[0]).toContain('VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  });

  it('rolls back and never commits when row persistence fails', async () => {
    const { pool, connection } = fakePool({ failOnRowInsert: true });
    await expect(createMysqlCustomerFeatureSnapshotRepository(pool).publishSnapshot(input())).rejects.toThrow(/row insert failed/);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it.each<CustomerFeatureSnapshotRepositoryFailureStage>([
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
    await expect(createMysqlCustomerFeatureSnapshotRepository(pool, { failAt: stage }).publishSnapshot(input())).rejects.toThrow(
      new RegExp(stage),
    );
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('verifies the persisted feature dataset checksum before publishing (catches a corrupted write)', async () => {
    const changed = row();
    const changedRows = [toPersistedRowData({ ...changed, totalSpentTaxIncl: '1.000000' })];
    const { pool, connection } = fakePool({ persistedRows: changedRows });
    await expect(createMysqlCustomerFeatureSnapshotRepository(pool).publishSnapshot(input())).rejects.toThrow(/checksum/);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('finds a published snapshot by key', async () => {
    const pool = {
      execute: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT id, source_dataset_checksum, feature_dataset_checksum')) {
          return [[{ id: 7, source_dataset_checksum: 'a'.repeat(64), feature_dataset_checksum: 'f'.repeat(64) }], []];
        }
        return [[], []];
      }),
    } as unknown as Pool;
    const result = await createMysqlCustomerFeatureSnapshotRepository(pool).findPublishedSnapshot('some-key');
    expect(result).toEqual({ snapshotId: '7', sourceDatasetChecksum: 'a'.repeat(64), featureDatasetChecksum: 'f'.repeat(64) });
  });

  it('returns null when no published snapshot exists for the key', async () => {
    const pool = { execute: vi.fn(async () => [[], []]) } as unknown as Pool;
    const result = await createMysqlCustomerFeatureSnapshotRepository(pool).findPublishedSnapshot('missing-key');
    expect(result).toBeNull();
  });
});
