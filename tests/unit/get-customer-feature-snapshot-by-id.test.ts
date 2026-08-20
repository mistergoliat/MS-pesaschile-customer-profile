import { describe, expect, it, vi } from 'vitest';
import { createGetCustomerFeatureSnapshotById, getCustomerFeatureSnapshotByIdNotConfigured } from '../../src/application/customer-analytics/get-customer-feature-snapshot-by-id.js';
import { AnalyticsUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { CustomerFeatureSnapshotReader, StoredCustomerFeatureSnapshot } from '../../src/application/customer-analytics/ports.js';

function storedSnapshot(overrides: Partial<StoredCustomerFeatureSnapshot> = {}): StoredCustomerFeatureSnapshot {
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
    ...overrides,
  };
}

describe('createGetCustomerFeatureSnapshotById', () => {
  it('returns available for a known id, including a superseded one (historical access)', async () => {
    const reader: CustomerFeatureSnapshotReader = {
      getLatestPublishedSnapshot: vi.fn(),
      getSnapshotById: vi.fn(async () => storedSnapshot({ status: 'superseded' })),
      getRow: vi.fn(),
    };
    const result = await createGetCustomerFeatureSnapshotById({ reader })('7');
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.snapshot.status).toBe('superseded');
    }
  });

  it('returns snapshot_not_found for an unknown id', async () => {
    const reader: CustomerFeatureSnapshotReader = {
      getLatestPublishedSnapshot: vi.fn(),
      getSnapshotById: vi.fn(async () => null),
      getRow: vi.fn(),
    };
    const result = await createGetCustomerFeatureSnapshotById({ reader })('999');
    expect(result).toEqual(expect.objectContaining({ status: 'snapshot_not_found', snapshotId: '999' }));
  });

  it('maps an analytics DB failure to a degraded result rather than throwing', async () => {
    const reader: CustomerFeatureSnapshotReader = {
      getLatestPublishedSnapshot: vi.fn(),
      getSnapshotById: vi.fn(async () => {
        throw new AnalyticsUnavailableError('down');
      }),
      getRow: vi.fn(),
    };
    const result = await createGetCustomerFeatureSnapshotById({ reader })('7');
    expect(result).toEqual(expect.objectContaining({ status: 'degraded', reason: 'analytics_unavailable' }));
  });
});

describe('getCustomerFeatureSnapshotByIdNotConfigured', () => {
  it('is a degraded stub that never touches a reader (ANALYTICS_DB_* absent)', async () => {
    const result = await getCustomerFeatureSnapshotByIdNotConfigured('7');
    expect(result).toEqual(expect.objectContaining({ status: 'degraded', reason: 'analytics_not_configured' }));
  });
});
