import { describe, expect, it, vi } from 'vitest';
import { createGetCurrentRfmSnapshot } from '../../src/application/customer-rfm/get-current-rfm-snapshot.js';
import type { CurrentRfmSnapshotReader } from '../../src/application/customer-rfm/ports.js';
import type { CurrentRfmSnapshotMetadata } from '../../src/domain/customer-rfm/index.js';

const snapshot: CurrentRfmSnapshotMetadata = {
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
};

function readerReturning(result: CurrentRfmSnapshotMetadata | null): CurrentRfmSnapshotReader {
  return {
    getCurrentSnapshot: vi.fn(async () => result),
    getCurrentPrestashopCustomerRfm: vi.fn(async () => null),
    getCurrentMasterCustomerRfm: vi.fn(async () => null),
    getCurrentMasterCustomerRfmLookup: vi.fn(async () => ({ snapshot: result, record: null })),
  };
}

describe('getCurrentRfmSnapshot', () => {
  it('returns null when there is no published snapshot', async () => {
    const getCurrentRfmSnapshot = createGetCurrentRfmSnapshot({
      currentRfmSnapshotReader: readerReturning(null),
    });

    await expect(getCurrentRfmSnapshot()).resolves.toBeNull();
  });

  it('returns the reader metadata unchanged when a current snapshot exists', async () => {
    const reader = readerReturning(snapshot);
    const getCurrentRfmSnapshot = createGetCurrentRfmSnapshot({
      currentRfmSnapshotReader: reader,
    });

    await expect(getCurrentRfmSnapshot()).resolves.toBe(snapshot);
    expect(reader.getCurrentSnapshot).toHaveBeenCalledTimes(1);
  });
});
