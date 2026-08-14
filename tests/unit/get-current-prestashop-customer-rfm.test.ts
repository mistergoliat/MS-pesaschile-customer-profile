import { describe, expect, it, vi } from 'vitest';
import { createGetCurrentMasterCustomerRfm } from '../../src/application/customer-rfm/get-current-master-customer-rfm.js';
import { createGetCurrentPrestashopCustomerRfm } from '../../src/application/customer-rfm/get-current-prestashop-customer-rfm.js';
import type { CurrentRfmSnapshotReader } from '../../src/application/customer-rfm/ports.js';
import type { CurrentMasterCustomerRfmRecord, CurrentPrestashopCustomerRfmRecord } from '../../src/domain/customer-rfm/index.js';

const record: CurrentPrestashopCustomerRfmRecord = {
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
};

function readerReturning(result: CurrentPrestashopCustomerRfmRecord | null): CurrentRfmSnapshotReader {
  return {
    getCurrentSnapshot: vi.fn(async () => null),
    getCurrentPrestashopCustomerRfm: vi.fn(async () => result),
    getCurrentMasterCustomerRfm: vi.fn(async () => (result?.masterCustomerId ? ({ ...result, masterCustomerId: result.masterCustomerId } as CurrentMasterCustomerRfmRecord) : null)),
    getCurrentMasterCustomerRfmLookup: vi.fn(async () => ({
      snapshot: result?.snapshot ?? null,
      record: result?.masterCustomerId ? ({ ...result, masterCustomerId: result.masterCustomerId } as CurrentMasterCustomerRfmRecord) : null,
    })),
  };
}

describe('getCurrentPrestashopCustomerRfm', () => {
  it('returns null when the current snapshot does not contain the customer', async () => {
    const reader = readerReturning(null);
    const getCurrentPrestashopCustomerRfm = createGetCurrentPrestashopCustomerRfm({
      currentRfmSnapshotReader: reader,
    });

    await expect(getCurrentPrestashopCustomerRfm({ prestashopCustomerId: 777 })).resolves.toBeNull();
    expect(reader.getCurrentPrestashopCustomerRfm).toHaveBeenCalledWith(777);
  });

  it('returns the reader record unchanged when the customer exists in the current snapshot', async () => {
    const reader = readerReturning(record);
    const getCurrentPrestashopCustomerRfm = createGetCurrentPrestashopCustomerRfm({
      currentRfmSnapshotReader: reader,
    });

    await expect(getCurrentPrestashopCustomerRfm({ prestashopCustomerId: 777 })).resolves.toBe(record);
  });

  it('rejects invalid prestashop customer ids before touching the reader', async () => {
    const reader = readerReturning(record);
    const getCurrentPrestashopCustomerRfm = createGetCurrentPrestashopCustomerRfm({
      currentRfmSnapshotReader: reader,
    });

    for (const invalidId of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(getCurrentPrestashopCustomerRfm({ prestashopCustomerId: invalidId })).rejects.toThrow();
    }

    expect(reader.getCurrentPrestashopCustomerRfm).not.toHaveBeenCalled();
  });
});

describe('getCurrentMasterCustomerRfm', () => {
  it('returns the reader record unchanged when the canonical customer exists in the current snapshot', async () => {
    const reader = {
      getCurrentSnapshot: vi.fn(async () => null),
      getCurrentPrestashopCustomerRfm: vi.fn(async () => null),
      getCurrentMasterCustomerRfm: vi.fn(async () => ({
        ...record,
        masterCustomerId: '9001',
      })),
      getCurrentMasterCustomerRfmLookup: vi.fn(async () => ({
        snapshot: record.snapshot,
        record: {
          ...record,
          masterCustomerId: '9001',
        },
      })),
    } satisfies CurrentRfmSnapshotReader;
    const getCurrentMasterCustomerRfm = createGetCurrentMasterCustomerRfm({
      currentRfmSnapshotReader: reader,
    });

    await expect(getCurrentMasterCustomerRfm({ masterCustomerId: '9001' })).resolves.toEqual({
      ...record,
      masterCustomerId: '9001',
    });
  });

  it('returns null when the canonical id is absent from the current snapshot', async () => {
    const reader = {
      getCurrentSnapshot: vi.fn(async () => null),
      getCurrentPrestashopCustomerRfm: vi.fn(async () => null),
      getCurrentMasterCustomerRfm: vi.fn(async () => null),
      getCurrentMasterCustomerRfmLookup: vi.fn(async () => ({ snapshot: null, record: null })),
    } satisfies CurrentRfmSnapshotReader;
    const getCurrentMasterCustomerRfm = createGetCurrentMasterCustomerRfm({
      currentRfmSnapshotReader: reader,
    });

    await expect(getCurrentMasterCustomerRfm({ masterCustomerId: '9001' })).resolves.toBeNull();
  });

  it('rejects invalid master customer ids before touching the reader', async () => {
    const reader = {
      getCurrentSnapshot: vi.fn(async () => null),
      getCurrentPrestashopCustomerRfm: vi.fn(async () => null),
      getCurrentMasterCustomerRfm: vi.fn(async () => null),
      getCurrentMasterCustomerRfmLookup: vi.fn(async () => ({ snapshot: null, record: null })),
    } satisfies CurrentRfmSnapshotReader;
    const getCurrentMasterCustomerRfm = createGetCurrentMasterCustomerRfm({
      currentRfmSnapshotReader: reader,
    });

    for (const invalidId of ['', ' ', '0', '000', 'abc', '1.5', '-1', 'x9001']) {
      await expect(getCurrentMasterCustomerRfm({ masterCustomerId: invalidId })).rejects.toThrow();
    }

    expect(reader.getCurrentMasterCustomerRfm).not.toHaveBeenCalled();
  });
});
