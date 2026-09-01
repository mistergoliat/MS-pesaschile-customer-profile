import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { buildCustomerCommercialAffinityPopulation } from '../../src/application/customer-commercial-affinity-population/index.js';
import { buildCustomerCommercialAffinitySnapshotHeader } from '../../src/application/customer-commercial-affinity-snapshot/index.js';
import {
  buildBuildingSnapshotInsertStatement,
  createMysqlCustomerCommercialAffinitySnapshotStore,
} from '../../src/infrastructure/clv/mysql-customer-commercial-affinity-snapshot-store.js';
import type { CustomerCommercialAffinitySnapshotInput } from '../../src/application/customer-commercial-affinity-snapshot/index.js';

function input(): CustomerCommercialAffinitySnapshotInput {
  const semanticMetadata = {
    snapshotId: `sha256:${'a'.repeat(64)}`,
    schemaVersion: '1' as const,
    generatedAt: '2026-08-31T00:00:00.000Z',
    ontologyVersion: 'commercial-product-ontology-v3',
    ontologyHash: 'f'.repeat(64),
    classifierVersion: 'product-semantic-classifier-v1',
    sourceProductCount: 1,
    recordCount: 1,
    classificationCounts: { CLASSIFIED: 1, PARTIALLY_CLASSIFIED: 0, OTHER: 0, EXCLUDED_NON_PRODUCT: 0, NEEDS_REVIEW: 0 },
    sourceSemanticChecksum: 'b'.repeat(64),
    consumerNormalizedChecksum: 'c'.repeat(64),
  };
  const population = buildCustomerCommercialAffinityPopulation({
    referenceTime: '2026-09-01T00:00:00.000Z',
    purchases: [{ customerId: 10, orderId: 100, orderDetailId: 1, orderCreatedAt: '2026-08-01T00:00:00.000Z', productId: 1, lineRevenueTaxIncl: '100.10' }],
    semanticSnapshot: {
      metadata: semanticMetadata,
      facts: [{
        productId: 1,
        ontologyVersion: 'commercial-product-ontology-v3',
        ontologyHash: 'f'.repeat(64),
        classificationStatus: 'CLASSIFIED',
        primaryProductFamily: { code: 'BARBELL', confidence: 'EXPLICIT' },
        secondaryProductFamilies: [],
        disciplines: [],
        useContexts: [],
      }],
    },
  });
  return {
    header: buildCustomerCommercialAffinitySnapshotHeader({
      population,
      semanticSnapshotMetadata: semanticMetadata,
      generatedAt: '2026-09-01T00:01:00.000Z',
      sourceWatermarkOrderId: 100,
    }),
    rows: population.rows,
  };
}

function persistedRow(row: CustomerCommercialAffinitySnapshotInput['rows'][number]): RowDataPacket {
  return {
    customerId: row.customerId,
    affinityAxis: row.affinityAxis,
    affinityCode: row.affinityCode,
    score: row.score.toFixed(9),
    supportingOrderCount: row.supportingOrderCount,
    supportingProductCount: row.supportingProductCount,
    supportingSpend: row.supportingSpend,
    lastEvidenceAt: row.lastEvidenceAt.replace('T', ' ').replace('Z', ''),
    explicitEvidenceCoverage: row.explicitEvidenceCoverage,
  } as unknown as RowDataPacket;
}

function fakePool(options: { readonly corrupted?: boolean } = {}) {
  const snapshotInput = input();
  const calls: string[] = [];
  const execute = vi.fn(async (sql: string) => {
    calls.push(sql);
    if (sql.includes('INSERT INTO customer_commercial_affinity_snapshot (')) return [{ insertId: 7 }, []];
    if (sql.includes('COUNT(*) AS rowCount')) return [[{ rowCount: 1 }], []];
    if (sql.includes('FROM customer_commercial_affinity_snapshot_row')) {
      const row = options.corrupted ? { ...snapshotInput.rows[0]!, supportingSpend: '1.000000' } : snapshotInput.rows[0]!;
      return [[persistedRow(row)], []];
    }
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
    execute: vi.fn(async (sql: string) => {
      calls.push(sql);
      return [[], []];
    }),
  } as unknown as Pool;
  return { pool, connection, calls, snapshotInput };
}

describe('MySQL Customer Commercial Affinity snapshot store', () => {
  it('keeps building header INSERT columns, SQL values, and bound parameters aligned', () => {
    const statement = buildBuildingSnapshotInsertStatement(input().header);
    const match = statement.sql.match(/customer_commercial_affinity_snapshot \(([^]+)\) VALUES \(([^]+)\)$/u);
    expect(match).not.toBeNull();
    const columnCount = match![1]!.split(',').length;
    const valueExpressions = match![2]!.split(',');

    expect(columnCount).toBe(26);
    expect(statement.columnCount).toBe(columnCount);
    expect(valueExpressions).toHaveLength(columnCount);
    expect((match![2]!.match(/\?/g) ?? [])).toHaveLength(statement.values.length);
    expect(statement.values).toHaveLength(columnCount - 1);
    expect(match![2]).toContain("'building'");
  });

  it('persists, validates, supersedes, and publishes atomically', async () => {
    const { pool, connection, calls, snapshotInput } = fakePool();
    const result = await createMysqlCustomerCommercialAffinitySnapshotStore(pool).publishSnapshot(snapshotInput);

    expect(result).toEqual({ snapshotId: '7', persistedRowCount: 1, affinityDatasetChecksum: snapshotInput.header.affinityDatasetChecksum });
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(calls.join('\n')).toContain("status = 'validated'");
    expect(calls.join('\n')).toContain("status = 'superseded'");
    expect(calls.join('\n')).toContain("status = 'published'");
  });

  it('rolls back a persisted checksum mismatch and records the failed build', async () => {
    const { pool, connection, calls } = fakePool({ corrupted: true });
    await expect(createMysqlCustomerCommercialAffinitySnapshotStore(pool).publishSnapshot(input())).rejects.toThrow(/checksum mismatch/);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    expect(calls.join('\n')).toContain("status = 'failed'");
  });

  it('reads only published rows and bounds customer batch lookups', async () => {
    const snapshotInput = input();
    const pool = {
      execute: vi.fn(async (sql: string) => {
        if (sql.includes('manifest_json')) return [[{ id: 7, status: 'published', manifest_json: JSON.stringify(snapshotInput.header) }], []];
        if (sql.includes('customer_commercial_affinity_snapshot_row')) return [[persistedRow(snapshotInput.rows[0]!)], []];
        return [[], []];
      }),
    } as unknown as Pool;
    const store = createMysqlCustomerCommercialAffinitySnapshotStore(pool);
    await expect(store.getActiveSnapshotMetadata()).resolves.toMatchObject({ snapshotId: '7', status: 'published', snapshotKey: snapshotInput.header.snapshotKey });
    await expect(store.getCustomerAffinity(10)).resolves.toHaveLength(1);
    await expect(store.getCustomerAffinities([10])).resolves.toHaveLength(1);
    await expect(store.getCustomerAffinities(Array.from({ length: 5001 }, (_, index) => index + 1))).rejects.toThrow(/bounded/);
    expect((pool.execute as ReturnType<typeof vi.fn>).mock.calls.filter(([sql]) => String(sql).includes('customer_commercial_affinity_snapshot_row')).every(([sql]) => String(sql).includes("s.status = 'published'"))).toBe(true);
  });
});
