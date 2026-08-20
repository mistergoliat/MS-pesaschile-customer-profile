import { describe, expect, it, vi } from 'vitest';
import { createGetLatestCustomerFeatureSnapshot, getLatestCustomerFeatureSnapshotNotConfigured } from '../../src/application/customer-analytics/get-latest-customer-feature-snapshot.js';
import { AnalyticsUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { CustomerFeatureSnapshotReader, StoredCustomerFeatureSnapshot } from '../../src/application/customer-analytics/ports.js';

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

describe('createGetLatestCustomerFeatureSnapshot', () => {
  it('returns available with the stored snapshot', async () => {
    const reader: CustomerFeatureSnapshotReader = {
      getLatestPublishedSnapshot: vi.fn(async () => storedSnapshot()),
      getSnapshotById: vi.fn(),
      getRow: vi.fn(),
    };
    const result = await createGetLatestCustomerFeatureSnapshot({ reader })();
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.snapshot.snapshotId).toBe('7');
    }
  });

  it('returns no_published_snapshot when nothing has ever been published', async () => {
    const reader: CustomerFeatureSnapshotReader = {
      getLatestPublishedSnapshot: vi.fn(async () => null),
      getSnapshotById: vi.fn(),
      getRow: vi.fn(),
    };
    const result = await createGetLatestCustomerFeatureSnapshot({ reader })();
    expect(result.status).toBe('no_published_snapshot');
  });

  it('maps an analytics DB failure to a degraded result rather than throwing', async () => {
    const reader: CustomerFeatureSnapshotReader = {
      getLatestPublishedSnapshot: vi.fn(async () => {
        throw new AnalyticsUnavailableError('down');
      }),
      getSnapshotById: vi.fn(),
      getRow: vi.fn(),
    };
    const result = await createGetLatestCustomerFeatureSnapshot({ reader })();
    expect(result).toEqual(expect.objectContaining({ status: 'degraded', reason: 'analytics_unavailable' }));
  });
});

describe('getLatestCustomerFeatureSnapshotNotConfigured', () => {
  it('is a degraded stub that never touches a reader (ANALYTICS_DB_* absent)', async () => {
    const result = await getLatestCustomerFeatureSnapshotNotConfigured();
    expect(result).toEqual(expect.objectContaining({ status: 'degraded', reason: 'analytics_not_configured' }));
  });
});
