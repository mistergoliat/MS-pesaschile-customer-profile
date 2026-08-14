import { describe, expect, it, vi } from 'vitest';
import {
  createMysqlRfmSnapshotRepository,
  type RfmSnapshotRepositoryFailureStage,
} from '../../src/infrastructure/rfm/mysql-rfm-snapshot-repository.js';
import {
  checksumVersion,
  currencyPolicyVersion,
  identityAuthority,
  identityAuthorityVersion,
  monetaryPolicyVersion,
  populationPolicyVersion,
  populationScope,
  rfmCommercialSegmentVersion,
  refundPolicyVersion,
  scoringPolicyVersion,
  sha256Stable,
} from '../../src/domain/customer-rfm/index.js';
import type { PersistRfmSnapshotInput } from '../../src/application/customer-rfm/create-rfm-snapshot.js';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

function input(): PersistRfmSnapshotInput {
  const rows: PersistRfmSnapshotInput['rows'] = [
    {
      prestashopCustomerId: 1,
      masterCustomerId: null,
      identityResolutionStatus: 'provisional',
      firstValidOrderAt: '2026-08-01 10:00:00',
      lastValidOrderAt: '2026-08-02 10:00:00',
      recencyDays: 1,
      frequencyOrders: 2,
      grossOrderValueTaxIncl: '200.000000',
      averageOrderValueTaxIncl: '100.000000',
      distinctShopCount: 1,
      recencyScore: 5,
      frequencyScore: 2,
      monetaryScore: 5,
      rfmCode: 'R5F2M5',
      segmentCode: 'POTENTIAL_LOYAL',
      segmentVersion: rfmCommercialSegmentVersion,
    },
  ];
  const datasetChecksum = checksumDataset('rfm-v1', rows);
  return {
    snapshotKey: 'rfm-v1__2026-08-03T00-00-00-000Z',
    referenceTime: '2026-08-03T00:00:00.000Z',
    windowStartInclusive: '2025-08-03T00:00:00.000Z',
    windowEndExclusive: '2026-08-03T00:00:00.000Z',
    calculationVersion: 'rfm-v1',
    currencyCode: 'CLP',
    populationSize: 1,
    validOrderCount: 2,
    grossOrderValueTaxIncl: '200.000000',
    manifest: {
      snapshotId: null,
      referenceTime: '2026-08-03T00:00:00.000Z',
      windowStartInclusive: '2025-08-03T00:00:00.000Z',
      windowEndExclusive: '2026-08-03T00:00:00.000Z',
      generatedAt: '2026-08-03T01:00:00.000Z',
      identityAuthority: 'prestashop_customer',
      identityAuthorityVersion: 'prestashop-customer-v1',
      populationScope: 'all_valid_prestashop_shops',
      populationPolicyVersion: 'active-365-valid-prestashop-customer-v1',
      monetaryPolicyVersion: 'gross-order-value-tax-incl-v1',
      refundPolicyVersion: 'gross-valid-orders-v1',
      currencyPolicyVersion: 'single-source-currency-v1',
      scoringPolicyVersion: 'r-tie-safe-percent-rank-v1__frequency-thresholds-candidate-v1__m-tie-safe-percent-rank-v1',
      checksumVersion: 'rfm-checksum-canonical-json-v1',
      sourceDateTimeStorage: 'mysql_datetime',
      timezoneStatus: 'UNVERIFIED',
      sourceTimezone: 'UNVERIFIED',
      calculationTimezone: 'UTC',
      referenceTimeTimezone: 'UTC',
      recencyCalendarPolicy: 'utc-calendar-days-v1',
      monetaryDefinition: 'total_paid_tax_incl minus confirmed seller-service line value, floored at 0',
      shippingIncluded: true,
      sellerServiceExcluded: true,
      sellerServiceExclusionPolicyVersion: 'seller-service-exclusion-v1',
      operationalAccountPolicyVersion: 'operational-account-exclusion-v1',
      historicalCustomerCount: 1,
      activeCustomerCount: 1,
      scoredCustomerCount: 1,
      excludedCustomerCount: 0,
      excludedOperationalAccountCount: 0,
      validOrderCount: 2,
      grossOrderValueTaxIncl: '200.000000',
      currencyCode: 'CLP',
      distinctCurrencyCount: 1,
      distinctShopCount: 1,
      excludedZeroValueOrderCount: 0,
      futureOrderExcludedCount: 0,
      invalidOrderExcludedCount: 0,
      partiallyRefundedOrderCount: 0,
      partiallyRefundedAmountObserved: '0.000000',
      ordersWithSellerServiceCount: 0,
      sellerServiceLineCount: 0,
      excludedSellerServiceValueTaxIncl: '0.000000',
      grossOrderValueBeforeSellerServiceExclusion: '200.000000',
      monetaryAfterSellerServiceExclusion: '200.000000',
      recencyDistribution: distribution(),
      frequencyDistribution: distribution(),
      monetaryDistribution: { ...distribution(), min: '200.000000', max: '200.000000', p20: '200.000000', p40: '200.000000', p60: '200.000000', p80: '200.000000', p90: '200.000000', p95: '200.000000', p99: '200.000000' },
      recencyScoreDistribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 1 },
      frequencyScoreDistribution: { '1': 0, '2': 1, '3': 0, '4': 0, '5': 0 },
      monetaryScoreDistribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 1 },
      rfmCodeDistribution: { R5F2M5: 1 },
      frequencyOutlierDiagnostics: {
        maximumFrequencyOrders: 2,
        frequencyOutlierCount: 0,
        frequencyP95: 2,
        frequencyP99: 2,
        frequencyP99_5: null,
        top1CustomerFrequencyShare: '1.000000',
        top5CustomerFrequencyShare: '1.000000',
        top10CustomerFrequencyShare: '1.000000',
        customersAbove100Orders: 0,
        customersAbove500Orders: 0,
        scoreDistributionExcludingAbove100Orders: { '1': 0, '2': 1, '3': 0, '4': 0, '5': 0 },
        scoreDistributionExcludingAbove500Orders: { '1': 0, '2': 1, '3': 0, '4': 0, '5': 0 },
      },
      scoreCutoffs: {
        recency: {
          '1': { min: null, max: null, uniqueValueCount: 0 },
          '2': { min: null, max: null, uniqueValueCount: 0 },
          '3': { min: null, max: null, uniqueValueCount: 0 },
          '4': { min: null, max: null, uniqueValueCount: 0 },
          '5': { min: 1, max: 1, uniqueValueCount: 1 },
        },
        monetary: {
          '1': { min: null, max: null, uniqueValueCount: 0 },
          '2': { min: null, max: null, uniqueValueCount: 0 },
          '3': { min: null, max: null, uniqueValueCount: 0 },
          '4': { min: null, max: null, uniqueValueCount: 0 },
          '5': { min: '200.000000', max: '200.000000', uniqueValueCount: 1 },
        },
      },
      frequencyThresholds: {},
      sourceChecksum: 'a'.repeat(64),
      datasetChecksum,
      canonicalIdentitySource: 'master_customer.prestashop_customer_id',
      canonicalMatchedCount: 0,
      canonicalUnmatchedCount: 1,
      canonicalAmbiguousCount: 0,
      canonicalCoveragePct: '0.000000',
      segmentVersion: rfmCommercialSegmentVersion,
      segmentCounts: {
        CHAMPION: 0,
        LOYAL: 0,
        POTENTIAL_LOYAL: 1,
        RECENT_HIGH_VALUE: 0,
        RECENT_ONE_TIME: 0,
        NEEDS_ATTENTION: 0,
        AT_RISK_HIGH_VALUE: 0,
        HIBERNATING: 0,
      },
      segmentPercentages: {
        CHAMPION: '0.000000',
        LOYAL: '0.000000',
        POTENTIAL_LOYAL: '100.000000',
        RECENT_HIGH_VALUE: '0.000000',
        RECENT_ONE_TIME: '0.000000',
        NEEDS_ATTENTION: '0.000000',
        AT_RISK_HIGH_VALUE: '0.000000',
        HIBERNATING: '0.000000',
      },
    },
    datasetChecksum,
    generatedAt: '2026-08-03T01:00:00.000Z',
    rows,
  };
}

function checksumDataset(calculationVersion: string, rows: PersistRfmSnapshotInput['rows']): string {
  return sha256Stable({
    calculationVersion,
    identityAuthority,
    identityAuthorityVersion,
    populationPolicyVersion,
    monetaryPolicyVersion,
    refundPolicyVersion,
    currencyPolicyVersion,
    scoringPolicyVersion,
    checksumVersion,
    populationScope,
    rows,
  });
}

function distribution() {
  return {
    count: 1,
    min: 1,
    max: 1,
    average: '1.000000',
    p20: 1,
    p40: 1,
    p60: 1,
    p80: 1,
    p90: 1,
    p95: 1,
    p99: 1,
    uniqueValueCount: 1,
    tieValueCount: 0,
  };
}

function fakePool(
  options: {
    readonly failOnRowInsert?: boolean;
    readonly persistedRows?: RowDataPacket[];
    readonly duplicateHeader?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const execute = vi.fn(async (sql: string) => {
    calls.push(sql);
    if (options.failOnRowInsert && sql.includes('INSERT INTO customer_rfm_snapshot_row')) {
      throw new Error('row insert failed');
    }
    if (options.duplicateHeader && sql.includes('INSERT INTO customer_rfm_snapshot')) {
      throw { code: 'ER_DUP_ENTRY' };
    }
    if (sql.includes('COUNT(*) AS rowCount')) return [[{ rowCount: 1 }], []];
    if (sql.includes('FROM customer_rfm_snapshot_row')) {
      return [options.persistedRows ?? [toPersistedRowData(input().rows[0]!)], []];
    }
    if (sql.includes('INSERT INTO customer_rfm_snapshot')) return [{ insertId: 55 }, []];
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

function toPersistedRowData(row: PersistRfmSnapshotInput['rows'][number]): RowDataPacket {
  return {
    prestashopCustomerId: row.prestashopCustomerId,
    masterCustomerId: row.masterCustomerId,
    identityResolutionStatus: row.identityResolutionStatus,
    firstValidOrderAt: row.firstValidOrderAt,
    lastValidOrderAt: row.lastValidOrderAt,
    recencyDays: row.recencyDays,
    frequencyOrders: row.frequencyOrders,
    grossOrderValueTaxIncl: row.grossOrderValueTaxIncl,
    averageOrderValueTaxIncl: row.averageOrderValueTaxIncl,
    distinctShopCount: row.distinctShopCount,
    recencyScore: row.recencyScore,
    frequencyScore: row.frequencyScore,
    monetaryScore: row.monetaryScore,
    rfmCode: row.rfmCode,
    segmentCode: row.segmentCode,
    segmentVersion: row.segmentVersion,
  } as unknown as RowDataPacket;
}

describe('createMysqlRfmSnapshotRepository', () => {
  it('publishes building -> validated -> published inside a transaction', async () => {
    const { pool, connection, calls } = fakePool();
    const snapshotInput = input();
    const result = await createMysqlRfmSnapshotRepository(pool).publishSnapshot(snapshotInput);

    expect(result).toEqual({ snapshotId: '55', persistedRowCount: 1, datasetChecksum: snapshotInput.datasetChecksum });
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(calls.join('\n')).toContain("VALUES (?, 'building'");
    expect(calls.join('\n')).toContain("SET status = 'superseded'");
    expect(calls.join('\n')).toContain("SET status = 'validated'");
    expect(calls.join('\n')).toContain("SET status = 'published'");
  });

  it('rolls back when row persistence fails', async () => {
    const { pool, connection } = fakePool({ failOnRowInsert: true });

    await expect(createMysqlRfmSnapshotRepository(pool).publishSnapshot(input())).rejects.toThrow(/row insert failed/);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it.each<RfmSnapshotRepositoryFailureStage>([
    'after_begin',
    'after_header_insert',
    'during_row_insert',
    'after_rows_insert',
    'before_row_count',
    'after_row_count_before_checksum',
    'before_supersede_previous',
    'after_supersede_before_publish',
    'before_commit',
  ])('rolls back cleanly for induced failure stage %s', async (stage) => {
    const { pool, connection } = fakePool();

    await expect(createMysqlRfmSnapshotRepository(pool, { failAt: stage }).publishSnapshot(input())).rejects.toThrow(
      new RegExp(stage),
    );
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('verifies the persisted dataset checksum before publishing', async () => {
    const changedRows = [toPersistedRowData({ ...input().rows[0]!, grossOrderValueTaxIncl: '201.000000' })];
    const { pool, connection } = fakePool({ persistedRows: changedRows });

    await expect(createMysqlRfmSnapshotRepository(pool).publishSnapshot(input())).rejects.toThrow(/checksum/);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it('maps duplicate snapshot key errors to a controlled failure', async () => {
    const { pool, connection } = fakePool({ duplicateHeader: true });

    await expect(createMysqlRfmSnapshotRepository(pool).publishSnapshot(input())).rejects.toThrow(/Duplicate RFM snapshot key/);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });
});
