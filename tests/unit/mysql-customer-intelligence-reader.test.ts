import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { createMysqlCustomerIntelligenceReader } from '../../src/infrastructure/customer-intelligence/mysql-customer-intelligence-reader.js';
import { AnalyticsUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { ResolvedCustomerIntelligenceSnapshotIds } from '../../src/application/customer-intelligence/ports.js';

const BASE_IDS: ResolvedCustomerIntelligenceSnapshotIds = {
  featureSnapshotId: '17',
  featureReferenceTime: '2026-08-19T00:00:00.000Z',
  featureVersion: 'customer-analytics-features-v1',
  populationPolicyVersion: 'customer-analytics-population-b-v1',
  rfmSnapshotId: '1',
  rfmReferenceTime: '2026-08-18T00:00:00.000Z',
  calculationVersion: 'rfm-population-v1',
  clusterSnapshotId: '2',
  clusterReferenceTime: '2026-08-18T00:00:00.000Z',
  clusterModelId: '9',
  clusterModelVersion: 'behavioral-kmeans-k4-v1',
};

function fullJoinRow(overrides: Record<string, unknown> = {}) {
  return {
    prestashopCustomerId: 22066,
    validOrders: 2,
    totalSpentTaxIncl: '56433.000000',
    averageOrderValueTaxIncl: '28216.500000',
    firstOrderAt: new Date('2026-01-01T00:00:00.000Z'),
    lastOrderAt: new Date('2026-07-01T00:00:00.000Z'),
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
    rScore: 3,
    fScore: 2,
    mScore: 4,
    rfmCode: 'R3F2M4',
    rfmSegmentCode: 'LOYAL',
    clusterId: 3,
    clusterDistanceToCentroid: '1.420000',
    ...overrides,
  };
}

function fakePool(options: {
  readonly rowResult?: unknown[];
  readonly interpretationRows?: unknown[];
  readonly countHandler?: (sql: string) => number;
} = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const execute = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('FROM customer_cluster_interpretation')) {
      return [options.interpretationRows ?? [], []];
    }
    if (sql.includes('COUNT(*) AS n')) {
      return [[{ n: options.countHandler ? options.countHandler(sql) : 0 }], []];
    }
    if (sql.includes('FROM customer_feature_snapshot_row fr')) {
      return [options.rowResult ?? [], []];
    }
    return [[], []];
  });
  return { pool: { execute } as unknown as Pool, calls };
}

describe('createMysqlCustomerIntelligenceReader — getRow', () => {
  it('returns a fully-composed row when RFM and cluster both match, with interpretation merged', async () => {
    const { pool, calls } = fakePool({
      rowResult: [fullJoinRow()],
      interpretationRows: [{ id: 1, clusterId: 3, label: 'NEW_BURST_THEN_LAPSED_BUYERS', description: 'desc', interpretationVersion: 'behavioral-cluster-interpretation-v1' }],
    });
    const reader = createMysqlCustomerIntelligenceReader(pool);
    const row = await reader.getRow(BASE_IDS, 22066);

    expect(row).not.toBeNull();
    expect(row!.rfm).toEqual({
      snapshot: { snapshotId: '1', referenceTime: '2026-08-18T00:00:00.000Z', calculationVersion: 'rfm-population-v1' },
      rScore: 3,
      fScore: 2,
      mScore: 4,
      rfmCode: 'R3F2M4',
      segmentCode: 'LOYAL',
    });
    expect(row!.cluster).toEqual({
      snapshot: { snapshotId: '2', referenceTime: '2026-08-18T00:00:00.000Z', modelId: '9', modelVersion: 'behavioral-kmeans-k4-v1' },
      clusterId: 3,
      distanceToCentroid: 1.42,
      interpretationVersion: 'behavioral-cluster-interpretation-v1',
      label: 'NEW_BURST_THEN_LAPSED_BUYERS',
      description: 'desc',
    });
    expect(row!.commercial.totalSpentTaxIncl).toBe('56433.000000');
    expect(row!.commercial.firstOrderAt).toBe('2026-01-01T00:00:00.000Z');

    // Interpretation is scoped by the resolved cluster model id (task Section 48).
    const interpretationCall = calls.find((c) => c.sql.includes('FROM customer_cluster_interpretation'));
    expect(interpretationCall!.params).toEqual(['9']);
  });

  it('returns null when the customer is not in the feature snapshot', async () => {
    const { pool } = fakePool({ rowResult: [] });
    const reader = createMysqlCustomerIntelligenceReader(pool);
    expect(await reader.getRow(BASE_IDS, 999999)).toBeNull();
  });

  it('rfm is null when no RFM snapshot was resolved (sentinel bypass)', async () => {
    const ids = { ...BASE_IDS, rfmSnapshotId: null, rfmReferenceTime: null, calculationVersion: null };
    const { pool, calls } = fakePool({ rowResult: [fullJoinRow({ rScore: null, fScore: null, mScore: null, rfmCode: null, rfmSegmentCode: null })] });
    const reader = createMysqlCustomerIntelligenceReader(pool);
    const row = await reader.getRow(ids, 22066);
    expect(row!.rfm).toBeNull();
    const joinCall = calls.find((c) => c.sql.includes('FROM customer_feature_snapshot_row fr'));
    expect(joinCall!.params[0]).toBe('0'); // sentinel, never matches a real snapshot_id
  });

  it('cluster is null when the customer is absent from an otherwise-resolved cluster snapshot', async () => {
    const { pool } = fakePool({ rowResult: [fullJoinRow({ clusterId: null, clusterDistanceToCentroid: null })] });
    const reader = createMysqlCustomerIntelligenceReader(pool);
    const row = await reader.getRow(BASE_IDS, 22066);
    expect(row!.cluster).toBeNull();
    expect(row!.rfm).not.toBeNull();
  });

  it('cluster label/description are null when no interpretation has been backfilled for this clusterId', async () => {
    const { pool } = fakePool({ rowResult: [fullJoinRow()], interpretationRows: [] });
    const reader = createMysqlCustomerIntelligenceReader(pool);
    const row = await reader.getRow(BASE_IDS, 22066);
    expect(row!.cluster!.label).toBeNull();
    expect(row!.cluster!.description).toBeNull();
    expect(row!.cluster!.interpretationVersion).toBeNull();
  });

  it('never queries customer_cluster_interpretation when no cluster snapshot was resolved', async () => {
    const ids = { ...BASE_IDS, clusterSnapshotId: null, clusterReferenceTime: null, clusterModelId: null, clusterModelVersion: null };
    const { pool, calls } = fakePool({ rowResult: [fullJoinRow({ clusterId: null, clusterDistanceToCentroid: null })] });
    const reader = createMysqlCustomerIntelligenceReader(pool);
    await reader.getRow(ids, 22066);
    expect(calls.some((c) => c.sql.includes('FROM customer_cluster_interpretation'))).toBe(false);
  });

  it('maps a connection failure to AnalyticsUnavailableError', async () => {
    const pool = { execute: vi.fn(async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); }) } as unknown as Pool;
    const reader = createMysqlCustomerIntelligenceReader(pool);
    await expect(reader.getRow(BASE_IDS, 1)).rejects.toThrow(AnalyticsUnavailableError);
  });
});

describe('createMysqlCustomerIntelligenceReader — listRows (keyset pagination)', () => {
  it('reports hasMore=false when exactly `limit` rows are returned', async () => {
    const { pool, calls } = fakePool({ rowResult: [fullJoinRow({ prestashopCustomerId: 1 }), fullJoinRow({ prestashopCustomerId: 2 })] });
    const reader = createMysqlCustomerIntelligenceReader(pool);
    const page = await reader.listRows(BASE_IDS, { limit: 2, afterCustomerId: null });
    expect(page.rows).toHaveLength(2);
    expect(page.hasMore).toBe(false);
    const joinCall = calls.find((c) => c.sql.includes('FROM customer_feature_snapshot_row fr'));
    expect(joinCall!.sql).not.toContain('prestashop_customer_id > ?');
  });

  it('reports hasMore=true and trims the extra row when more than `limit` rows are returned', async () => {
    const { pool } = fakePool({
      rowResult: [fullJoinRow({ prestashopCustomerId: 1 }), fullJoinRow({ prestashopCustomerId: 2 }), fullJoinRow({ prestashopCustomerId: 3 })],
    });
    const reader = createMysqlCustomerIntelligenceReader(pool);
    const page = await reader.listRows(BASE_IDS, { limit: 2, afterCustomerId: null });
    expect(page.rows).toHaveLength(2);
    expect(page.hasMore).toBe(true);
  });

  it('applies the keyset cursor when afterCustomerId is provided', async () => {
    const { pool, calls } = fakePool({ rowResult: [] });
    const reader = createMysqlCustomerIntelligenceReader(pool);
    await reader.listRows(BASE_IDS, { limit: 10, afterCustomerId: 5 });
    const joinCall = calls.find((c) => c.sql.includes('FROM customer_feature_snapshot_row fr'));
    expect(joinCall!.sql).toContain('fr.prestashop_customer_id > ?');
    expect(joinCall!.params).toContain(5);
  });
});

describe('createMysqlCustomerIntelligenceReader — getCoverageCounts', () => {
  it('short-circuits rfmMatched/bothMatched to 0 when no RFM snapshot is resolved', async () => {
    const ids = { ...BASE_IDS, rfmSnapshotId: null, rfmReferenceTime: null, calculationVersion: null };
    const { pool, calls } = fakePool({ countHandler: () => 5 });
    const reader = createMysqlCustomerIntelligenceReader(pool);
    const counts = await reader.getCoverageCounts(ids);
    expect(counts).toEqual({ featurePopulation: 5, rfmMatched: 0, clusterMatched: 5, bothMatched: 0 });
    expect(calls.filter((c) => c.sql.includes('COUNT(*) AS n'))).toHaveLength(2); // featurePopulation + clusterMatched only
  });

  it('runs all four counts when both RFM and cluster are resolved', async () => {
    const { pool, calls } = fakePool({ countHandler: () => 7 });
    const reader = createMysqlCustomerIntelligenceReader(pool);
    const counts = await reader.getCoverageCounts(BASE_IDS);
    expect(counts).toEqual({ featurePopulation: 7, rfmMatched: 7, clusterMatched: 7, bothMatched: 7 });
    expect(calls.filter((c) => c.sql.includes('COUNT(*) AS n'))).toHaveLength(4);
  });
});
