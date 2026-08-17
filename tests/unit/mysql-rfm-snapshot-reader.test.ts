import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { createMysqlRfmSnapshotReader } from '../../src/infrastructure/rfm/mysql-rfm-snapshot-reader.js';
import { RfmUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { QueryExecutor } from '../../src/infrastructure/shared/query-executor.js';

function queuedExecutor(responses: ReadonlyArray<readonly RowDataPacket[] | Error>) {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  let index = 0;
  const executor: QueryExecutor = {
    async execute(sql, params) {
      calls.push({ sql, params });
      const response = responses[index++];
      if (response instanceof Error) {
        throw response;
      }
      return response ? [...response] : [];
    },
  };
  return { executor, calls };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toUpperCase();
}

const currentSnapshotRow = {
  snapshot_id: '55',
  snapshot_key: 'rfm-population-v1__2026-08-03T00-00-00-000Z',
  status: 'published',
  calculation_version: 'rfm-population-v1',
  identity_authority: 'prestashop_customer',
  identity_authority_version: 'prestashop-customer-v1',
  reference_time: '2026-08-03 00:00:00.000000',
  generated_at: '2026-08-03 01:00:00.000000',
  published_at: '2026-08-03 01:00:00.000000',
  population_size: 14164,
  currency_code: 'CLP',
  dataset_checksum: 'a'.repeat(64),
} as unknown as RowDataPacket;

const customerRow = {
  prestashop_customer_id: 777,
  master_customer_id: null,
  identity_resolution_status: 'provisional',
  first_valid_order_at: '2026-07-01 10:00:00.000000',
  last_valid_order_at: '2026-08-01 10:00:00.000000',
  recency_days: 2,
  frequency_orders: 3,
  gross_order_value_tax_incl: '123456.780000',
  average_order_value_tax_incl: '41152.260000',
  distinct_shop_count: 2,
  recency_score: 5,
  frequency_score: 3,
  monetary_score: 4,
  rfm_code: 'R5F3M4',
  segment_code: 'LOYAL',
  segment_version: 'rfm-commercial-v1',
} as unknown as RowDataPacket;

describe('createMysqlRfmSnapshotReader', () => {
  it('returns null when no published snapshot exists', async () => {
    const { executor, calls } = queuedExecutor([[]]);
    const reader = createMysqlRfmSnapshotReader(executor);

    await expect(reader.getCurrentSnapshot()).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('selects the globally latest published snapshot deterministically', async () => {
    const { executor, calls } = queuedExecutor([[currentSnapshotRow]]);
    const reader = createMysqlRfmSnapshotReader(executor);

    const result = await reader.getCurrentSnapshot();

    expect(result).toEqual({
      snapshotId: '55',
      snapshotKey: 'rfm-population-v1__2026-08-03T00-00-00-000Z',
      status: 'published',
      calculationVersion: 'rfm-population-v1',
      identityAuthority: 'prestashop_customer',
      identityAuthorityVersion: 'prestashop-customer-v1',
      referenceTime: new Date('2026-08-03T00:00:00.000Z'),
      generatedAt: new Date('2026-08-03T01:00:00.000Z'),
      publishedAt: new Date('2026-08-03T01:00:00.000Z'),
      populationSize: 14164,
      currencyCode: 'CLP',
      datasetChecksum: 'a'.repeat(64),
    });

    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain("FROM CUSTOMER_RFM_SNAPSHOT");
    expect(sql).toContain("WHERE STATUS = 'PUBLISHED'");
    expect(sql).toContain('ORDER BY PUBLISHED_AT DESC, ID DESC');
    expect(calls[0]!.params).toEqual([]);
  });

  it('returns the current customer RFM with snapshot metadata and preserves monetary precision', async () => {
    const { executor } = queuedExecutor([[currentSnapshotRow], [customerRow]]);
    const reader = createMysqlRfmSnapshotReader(executor);

    const result = await reader.getCurrentPrestashopCustomerRfm(777);

    expect(result).toEqual({
      prestashopCustomerId: 777,
      masterCustomerId: null,
      identityResolutionStatus: 'provisional',
      firstValidOrderAt: new Date('2026-07-01T10:00:00.000Z'),
      lastValidOrderAt: new Date('2026-08-01T10:00:00.000Z'),
      recencyDays: 2,
      frequencyOrders: 3,
      grossOrderValueTaxIncl: '123456.780000',
      averageOrderValueTaxIncl: '41152.260000',
      distinctShopCount: 2,
      recencyScore: 5,
      frequencyScore: 3,
      monetaryScore: 4,
      rfmCode: 'R5F3M4',
      segmentCode: 'LOYAL',
      segmentVersion: 'rfm-commercial-v1',
      snapshot: {
        snapshotId: '55',
        snapshotKey: 'rfm-population-v1__2026-08-03T00-00-00-000Z',
        status: 'published',
        calculationVersion: 'rfm-population-v1',
        identityAuthority: 'prestashop_customer',
        identityAuthorityVersion: 'prestashop-customer-v1',
        referenceTime: new Date('2026-08-03T00:00:00.000Z'),
        generatedAt: new Date('2026-08-03T01:00:00.000Z'),
        publishedAt: new Date('2026-08-03T01:00:00.000Z'),
        populationSize: 14164,
        currencyCode: 'CLP',
        datasetChecksum: 'a'.repeat(64),
      },
    });
  });

  it('returns null when a current snapshot exists but the customer is absent from it', async () => {
    const { executor, calls } = queuedExecutor([[currentSnapshotRow], []]);
    const reader = createMysqlRfmSnapshotReader(executor);

    await expect(reader.getCurrentPrestashopCustomerRfm(777)).resolves.toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('keeps historical snapshots legible when segment fields are still null', async () => {
    const { executor } = queuedExecutor([[currentSnapshotRow], [{ ...customerRow, segment_code: null, segment_version: null } as unknown as RowDataPacket]]);
    const reader = createMysqlRfmSnapshotReader(executor);

    await expect(reader.getCurrentPrestashopCustomerRfm(777)).resolves.toMatchObject({
      segmentCode: null,
      segmentVersion: null,
    });
  });

  it('returns null for customer lookup when no current snapshot exists and never queries rows', async () => {
    const { executor, calls } = queuedExecutor([[]]);
    const reader = createMysqlRfmSnapshotReader(executor);

    await expect(reader.getCurrentPrestashopCustomerRfm(777)).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('keeps customer reads isolated to the resolved current snapshot id', async () => {
    const { executor, calls } = queuedExecutor([[currentSnapshotRow], [customerRow]]);
    const reader = createMysqlRfmSnapshotReader(executor);

    await reader.getCurrentPrestashopCustomerRfm(777);

    expect(calls).toHaveLength(2);
    const customerSql = normalizeSql(calls[1]!.sql);
    expect(customerSql).toContain('FROM CUSTOMER_RFM_SNAPSHOT_ROW');
    expect(customerSql).toContain('WHERE SNAPSHOT_ID = ?');
    expect(customerSql).toContain('AND PRESTASHOP_CUSTOMER_ID = ?');
    expect(calls[1]!.params).toEqual(['55', 777]);
  });

  it('rejects invalid customer ids without executing SQL', async () => {
    const { executor, calls } = queuedExecutor([]);
    const reader = createMysqlRfmSnapshotReader(executor);

    for (const invalidId of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(reader.getCurrentPrestashopCustomerRfm(invalidId)).rejects.toThrow();
    }

    expect(calls).toHaveLength(0);
  });

  it('rejects contractually invalid snapshot rows instead of silently coercing them', async () => {
    const { executor } = queuedExecutor([
      [{ ...currentSnapshotRow, status: 'validated' } as unknown as RowDataPacket],
    ]);
    const reader = createMysqlRfmSnapshotReader(executor);

    await expect(reader.getCurrentSnapshot()).rejects.toThrow(/status/);
  });

  it('propagates real DB failures instead of converting them to not found', async () => {
    const dbError = new Error('snapshot db down');
    const { executor } = queuedExecutor([[currentSnapshotRow], dbError]);
    const reader = createMysqlRfmSnapshotReader(executor);

    await expect(reader.getCurrentPrestashopCustomerRfm(777)).rejects.toThrow('snapshot db down');
  });

  it('reads the current snapshot row by master customer id when canonical wiring exists', async () => {
    const { executor, calls } = queuedExecutor([[currentSnapshotRow], [[{ ...customerRow, master_customer_id: '9001' } as unknown as RowDataPacket][0]!]]);
    const reader = createMysqlRfmSnapshotReader(executor);

    const result = await reader.getCurrentMasterCustomerRfm('9001');

    expect(result).toMatchObject({
      masterCustomerId: '9001',
      prestashopCustomerId: 777,
      grossOrderValueTaxIncl: '123456.780000',
      segmentCode: 'LOYAL',
      segmentVersion: 'rfm-commercial-v1',
      snapshot: { snapshotId: '55' },
    });
    expect(calls[1]!.params).toEqual(['55', '9001']);
  });

  it('returns null for a canonical id absent from the current snapshot', async () => {
    const { executor } = queuedExecutor([[currentSnapshotRow], []]);
    const reader = createMysqlRfmSnapshotReader(executor);

    await expect(reader.getCurrentMasterCustomerRfm('9001')).resolves.toBeNull();
  });

  it('rejects duplicate canonical rows instead of silently colliding two prestashop ids', async () => {
    const { executor } = queuedExecutor([[
      currentSnapshotRow,
    ], [
      { ...customerRow, master_customer_id: '9001', prestashop_customer_id: 777 } as unknown as RowDataPacket,
      { ...customerRow, master_customer_id: '9001', prestashop_customer_id: 888 } as unknown as RowDataPacket,
    ]]);
    const reader = createMysqlRfmSnapshotReader(executor);

    await expect(reader.getCurrentMasterCustomerRfm('9001')).rejects.toThrow(/multiple rows/);
  });

  describe('getCurrentPrestashopCustomerRfmLookup', () => {
    it('keeps "no published snapshot" distinguishable from "row not found" — snapshot null, record null', async () => {
      const { executor, calls } = queuedExecutor([[]]);
      const reader = createMysqlRfmSnapshotReader(executor);

      await expect(reader.getCurrentPrestashopCustomerRfmLookup(777)).resolves.toEqual({
        snapshot: null,
        record: null,
      });
      expect(calls).toHaveLength(1);
    });

    it('returns the current snapshot alongside a null record when the customer is absent from it', async () => {
      const { executor } = queuedExecutor([[currentSnapshotRow], []]);
      const reader = createMysqlRfmSnapshotReader(executor);

      const lookup = await reader.getCurrentPrestashopCustomerRfmLookup(777);

      expect(lookup.snapshot).toEqual({
        snapshotId: '55',
        snapshotKey: 'rfm-population-v1__2026-08-03T00-00-00-000Z',
        status: 'published',
        calculationVersion: 'rfm-population-v1',
        identityAuthority: 'prestashop_customer',
        identityAuthorityVersion: 'prestashop-customer-v1',
        referenceTime: new Date('2026-08-03T00:00:00.000Z'),
        generatedAt: new Date('2026-08-03T01:00:00.000Z'),
        publishedAt: new Date('2026-08-03T01:00:00.000Z'),
        populationSize: 14164,
        currencyCode: 'CLP',
        datasetChecksum: 'a'.repeat(64),
      });
      expect(lookup.record).toBeNull();
    });

    it('returns snapshot and record together when the customer has a current row', async () => {
      const { executor } = queuedExecutor([[currentSnapshotRow], [customerRow]]);
      const reader = createMysqlRfmSnapshotReader(executor);

      const lookup = await reader.getCurrentPrestashopCustomerRfmLookup(777);

      expect(lookup.snapshot?.snapshotId).toBe('55');
      expect(lookup.record).toMatchObject({ prestashopCustomerId: 777, rfmCode: 'R5F3M4' });
    });

    it('getCurrentPrestashopCustomerRfm delegates to the lookup and returns only the record', async () => {
      const { executor, calls } = queuedExecutor([[currentSnapshotRow], [customerRow]]);
      const reader = createMysqlRfmSnapshotReader(executor);

      const record = await reader.getCurrentPrestashopCustomerRfm(777);

      expect(record).toMatchObject({ prestashopCustomerId: 777 });
      expect(calls).toHaveLength(2);
    });
  });

  describe('RFM DB error wrapping', () => {
    it('wraps a connection-refused driver error into RfmUnavailableError', async () => {
      const driverError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), { code: 'ECONNREFUSED' });
      const { executor } = queuedExecutor([driverError]);
      const reader = createMysqlRfmSnapshotReader(executor);

      await expect(reader.getCurrentSnapshot()).rejects.toBeInstanceOf(RfmUnavailableError);
    });

    it('wraps a connection-refused error on the row query the same way', async () => {
      const driverError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), { code: 'ECONNREFUSED' });
      const { executor } = queuedExecutor([[currentSnapshotRow], driverError]);
      const reader = createMysqlRfmSnapshotReader(executor);

      await expect(reader.getCurrentPrestashopCustomerRfmLookup(777)).rejects.toBeInstanceOf(RfmUnavailableError);
    });
  });
});
