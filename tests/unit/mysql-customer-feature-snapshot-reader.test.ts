import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { createMysqlCustomerFeatureSnapshotReader } from '../../src/infrastructure/customer-analytics/mysql-customer-feature-snapshot-reader.js';
import { AnalyticsUnavailableError } from '../../src/application/customer-profile/errors.js';

function snapshotRowFixture() {
  return {
    id: 7,
    featureVersion: 'customer-analytics-features-v1',
    populationPolicyVersion: 'customer-analytics-population-b-v1',
    referenceTime: new Date('2026-08-19T00:00:00.000Z'),
    generatedAt: new Date('2026-08-19T00:05:00.000Z'),
    publishedAt: new Date('2026-08-19T00:06:00.000Z'),
    populationSize: 44935,
    sourceDatasetChecksum: 'a'.repeat(64),
    featureDatasetChecksum: 'b'.repeat(64),
    status: 'published',
  };
}

function customerRowFixture() {
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
  };
}

describe('createMysqlCustomerFeatureSnapshotReader', () => {
  it('getLatestPublishedSnapshot returns the newest published-status snapshot', async () => {
    const pool = { execute: vi.fn(async () => [[snapshotRowFixture()], []]) } as unknown as Pool;
    const reader = createMysqlCustomerFeatureSnapshotReader(pool);
    const snapshot = await reader.getLatestPublishedSnapshot();
    expect(snapshot?.snapshotId).toBe('7');
    expect(snapshot?.populationSize).toBe(44935);
    expect(snapshot?.referenceTime.toISOString()).toBe('2026-08-19T00:00:00.000Z');
  });

  it('getLatestPublishedSnapshot returns null when nothing has ever been published', async () => {
    const pool = { execute: vi.fn(async () => [[], []]) } as unknown as Pool;
    const reader = createMysqlCustomerFeatureSnapshotReader(pool);
    expect(await reader.getLatestPublishedSnapshot()).toBeNull();
  });

  it('getSnapshotById returns a superseded snapshot (historical access, task Section 44/51)', async () => {
    const pool = {
      execute: vi.fn(async () => [[{ ...snapshotRowFixture(), status: 'superseded' }], []]),
    } as unknown as Pool;
    const reader = createMysqlCustomerFeatureSnapshotReader(pool);
    const snapshot = await reader.getSnapshotById('7');
    expect(snapshot?.status).toBe('superseded');
  });

  it('getSnapshotById returns null for an unknown id', async () => {
    const pool = { execute: vi.fn(async () => [[], []]) } as unknown as Pool;
    const reader = createMysqlCustomerFeatureSnapshotReader(pool);
    expect(await reader.getSnapshotById('999')).toBeNull();
  });

  it('getRow returns the materialized row for a known customer', async () => {
    const pool = { execute: vi.fn(async () => [[customerRowFixture()], []]) } as unknown as Pool;
    const reader = createMysqlCustomerFeatureSnapshotReader(pool);
    const row = await reader.getRow('7', 22066);
    expect(row?.prestashopCustomerId).toBe(22066);
    expect(row?.purchaseFrequencyDays).toBe('181.000000');
    expect(row?.firstOrderAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('getRow returns a null purchaseFrequencyDays as null, never a string "null"', async () => {
    const pool = { execute: vi.fn(async () => [[{ ...customerRowFixture(), purchaseFrequencyDays: null }], []]) } as unknown as Pool;
    const reader = createMysqlCustomerFeatureSnapshotReader(pool);
    const row = await reader.getRow('7', 22066);
    expect(row?.purchaseFrequencyDays).toBeNull();
  });

  it('getRow returns null when the customer is not in the snapshot', async () => {
    const pool = { execute: vi.fn(async () => [[], []]) } as unknown as Pool;
    const reader = createMysqlCustomerFeatureSnapshotReader(pool);
    expect(await reader.getRow('7', 999999)).toBeNull();
  });

  it('maps a connection failure to AnalyticsUnavailableError', async () => {
    const pool = {
      execute: vi.fn(async () => {
        throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
      }),
    } as unknown as Pool;
    const reader = createMysqlCustomerFeatureSnapshotReader(pool);
    await expect(reader.getLatestPublishedSnapshot()).rejects.toThrow(AnalyticsUnavailableError);
  });
});
