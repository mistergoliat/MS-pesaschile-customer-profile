import { describe, expect, it, vi } from 'vitest';
import { createGetCustomerFeatureRow, getCustomerFeatureRowNotConfigured } from '../../src/application/customer-analytics/get-customer-feature-row.js';
import { AnalyticsUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { CustomerFeatureSnapshotReader, StoredCustomerFeatureSnapshot } from '../../src/application/customer-analytics/ports.js';
import type { CustomerFeatureRow } from '../../src/domain/customer-analytics/contracts.js';

function storedSnapshot(): StoredCustomerFeatureSnapshot {
  return {
    snapshotId: '7',
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

describe('createGetCustomerFeatureRow (task Section 34/35 — single-row lookup, never bulk)', () => {
  it('resolves the latest published snapshot when snapshotId is null', async () => {
    const reader: CustomerFeatureSnapshotReader = {
      getLatestPublishedSnapshot: vi.fn(async () => storedSnapshot()),
      getSnapshotById: vi.fn(),
      getRow: vi.fn(async () => row()),
    };
    const result = await createGetCustomerFeatureRow({ reader })({ snapshotId: null, prestashopCustomerId: 22066 });
    expect(result.status).toBe('available');
    expect(reader.getSnapshotById).not.toHaveBeenCalled();
  });

  it('resolves an explicit snapshotId', async () => {
    const reader: CustomerFeatureSnapshotReader = {
      getLatestPublishedSnapshot: vi.fn(),
      getSnapshotById: vi.fn(async () => storedSnapshot()),
      getRow: vi.fn(async () => row()),
    };
    const result = await createGetCustomerFeatureRow({ reader })({ snapshotId: '7', prestashopCustomerId: 22066 });
    expect(result.status).toBe('available');
    expect(reader.getLatestPublishedSnapshot).not.toHaveBeenCalled();
  });

  it('returns no_published_snapshot when snapshotId is null and nothing is published', async () => {
    const reader: CustomerFeatureSnapshotReader = {
      getLatestPublishedSnapshot: vi.fn(async () => null),
      getSnapshotById: vi.fn(),
      getRow: vi.fn(),
    };
    const result = await createGetCustomerFeatureRow({ reader })({ snapshotId: null, prestashopCustomerId: 1 });
    expect(result.status).toBe('no_published_snapshot');
  });

  it('returns snapshot_not_found for an unknown explicit id', async () => {
    const reader: CustomerFeatureSnapshotReader = {
      getLatestPublishedSnapshot: vi.fn(),
      getSnapshotById: vi.fn(async () => null),
      getRow: vi.fn(),
    };
    const result = await createGetCustomerFeatureRow({ reader })({ snapshotId: '999', prestashopCustomerId: 1 });
    expect(result).toEqual(expect.objectContaining({ status: 'snapshot_not_found', snapshotId: '999' }));
  });

  it('returns customer_not_in_snapshot when the row does not exist', async () => {
    const reader: CustomerFeatureSnapshotReader = {
      getLatestPublishedSnapshot: vi.fn(async () => storedSnapshot()),
      getSnapshotById: vi.fn(),
      getRow: vi.fn(async () => null),
    };
    const result = await createGetCustomerFeatureRow({ reader })({ snapshotId: null, prestashopCustomerId: 999999 });
    expect(result).toEqual(expect.objectContaining({ status: 'customer_not_in_snapshot', prestashopCustomerId: 999999 }));
  });

  it('maps an analytics DB failure to a degraded result rather than throwing', async () => {
    const reader: CustomerFeatureSnapshotReader = {
      getLatestPublishedSnapshot: vi.fn(async () => {
        throw new AnalyticsUnavailableError('down');
      }),
      getSnapshotById: vi.fn(),
      getRow: vi.fn(),
    };
    const result = await createGetCustomerFeatureRow({ reader })({ snapshotId: null, prestashopCustomerId: 1 });
    expect(result).toEqual(expect.objectContaining({ status: 'degraded', reason: 'analytics_unavailable' }));
  });
});

describe('getCustomerFeatureRowNotConfigured', () => {
  it('is a degraded stub that never touches a reader (ANALYTICS_DB_* absent)', async () => {
    const result = await getCustomerFeatureRowNotConfigured({ snapshotId: null, prestashopCustomerId: 1 });
    expect(result).toEqual(expect.objectContaining({ status: 'degraded', reason: 'analytics_not_configured' }));
  });
});
