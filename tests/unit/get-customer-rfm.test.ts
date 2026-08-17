import { describe, expect, it, vi } from 'vitest';
import { createGetCustomerRfm } from '../../src/application/customer-rfm/get-customer-rfm.js';
import type { CurrentRfmSnapshotReader } from '../../src/application/customer-rfm/ports.js';
import type { MasterCustomerReader } from '../../src/application/customer-profile/ports.js';
import type { CurrentMasterCustomerRfmLookup } from '../../src/domain/customer-rfm/index.js';

const snapshot = {
  snapshotId: '55',
  snapshotKey: 'rfm-population-v1__2026-08-03T00-00-00-000Z',
  status: 'published' as const,
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

const record = {
  prestashopCustomerId: 777,
  masterCustomerId: '9001',
  identityResolutionStatus: 'provisional' as const,
  firstValidOrderAt: new Date('2026-07-01T10:00:00.000Z'),
  lastValidOrderAt: new Date('2026-08-01T10:00:00.000Z'),
  recencyDays: 2,
  frequencyOrders: 3,
  grossOrderValueTaxIncl: '123456.780000',
  averageOrderValueTaxIncl: '41152.260000',
  distinctShopCount: 2,
  recencyScore: 5 as const,
  frequencyScore: 3 as const,
  monetaryScore: 4 as const,
  rfmCode: 'R5F3M4',
  segmentCode: 'LOYAL' as const,
  segmentVersion: 'rfm-commercial-v1',
  snapshot,
};

function readerReturning(lookup: CurrentMasterCustomerRfmLookup): CurrentRfmSnapshotReader {
  return {
    getCurrentSnapshot: vi.fn(async () => lookup.snapshot),
    getCurrentPrestashopCustomerRfm: vi.fn(async () => null),
    getCurrentPrestashopCustomerRfmLookup: vi.fn(async () => ({ snapshot: lookup.snapshot, record: null })),
    getCurrentMasterCustomerRfm: vi.fn(async () => lookup.record),
    getCurrentMasterCustomerRfmLookup: vi.fn(async () => lookup),
  };
}

function masterReaderReturning(found: boolean): MasterCustomerReader {
  return {
    findById: vi.fn(async (masterCustomerId) =>
      found
        ? {
            id: masterCustomerId,
            firstname: 'Ana',
            lastname: 'Perez',
            email: 'ana@example.com',
            platformOrigin: 'prestashop',
            rut: null,
            prestashopCustomerId: 777,
          }
        : null,
    ),
  };
}

describe('getCustomerRfm', () => {
  it('returns the public RFM contract when a current canonical record exists', async () => {
    const getCustomerRfm = createGetCustomerRfm({
      masterCustomerReader: masterReaderReturning(true),
      currentRfmSnapshotReader: readerReturning({ snapshot, record }),
    });

    await expect(getCustomerRfm({ masterCustomerId: '9001' })).resolves.toEqual({
      status: 'available',
      masterCustomerId: '9001',
      snapshot: {
        snapshotId: '55',
        calculationVersion: 'rfm-population-v1',
        referenceTime: '2026-08-03T00:00:00.000Z',
        publishedAt: '2026-08-03T01:00:00.000Z',
        currencyCode: 'CLP',
      },
      rfm: {
        recencyDays: 2,
        frequencyOrders: 3,
        grossOrderValueTaxIncl: '123456.780000',
        averageOrderValueTaxIncl: '41152.260000',
        recencyScore: 5,
        frequencyScore: 3,
        monetaryScore: 4,
        rfmCode: 'R5F3M4',
      },
      segment: {
        code: 'LOYAL',
        version: 'rfm-commercial-v1',
      },
      contractVersion: 'customer-rfm-runtime-v1',
    });
  });

  it('returns available with null segment for historical pre-T11E rows', async () => {
    const getCustomerRfm = createGetCustomerRfm({
      masterCustomerReader: masterReaderReturning(true),
      currentRfmSnapshotReader: readerReturning({
        snapshot,
        record: {
          ...record,
          segmentCode: null,
          segmentVersion: null,
        },
      }),
    });

    await expect(getCustomerRfm({ masterCustomerId: '9001' })).resolves.toMatchObject({
      status: 'available',
      segment: {
        code: null,
        version: null,
      },
    });
  });

  it('returns degraded when no current snapshot is published', async () => {
    const masterReader = masterReaderReturning(true);
    const getCustomerRfm = createGetCustomerRfm({
      masterCustomerReader: masterReader,
      currentRfmSnapshotReader: readerReturning({ snapshot: null, record: null }),
    });

    await expect(getCustomerRfm({ masterCustomerId: '9001' })).resolves.toEqual({
      status: 'degraded',
      masterCustomerId: '9001',
      reason: 'no_published_rfm_snapshot',
      contractVersion: 'customer-rfm-runtime-v1',
    });
    expect(masterReader.findById).not.toHaveBeenCalled();
  });

  it('returns customer_not_found when the current snapshot exists but the master customer does not', async () => {
    const masterReader = masterReaderReturning(false);
    const getCustomerRfm = createGetCustomerRfm({
      masterCustomerReader: masterReader,
      currentRfmSnapshotReader: readerReturning({ snapshot, record: null }),
    });

    await expect(getCustomerRfm({ masterCustomerId: '9001' })).resolves.toEqual({
      status: 'customer_not_found',
      masterCustomerId: '9001',
      contractVersion: 'customer-rfm-runtime-v1',
    });
    expect(masterReader.findById).toHaveBeenCalledWith('9001');
  });

  it('returns rfm_not_available when the master exists but has no row in the current snapshot', async () => {
    const getCustomerRfm = createGetCustomerRfm({
      masterCustomerReader: masterReaderReturning(true),
      currentRfmSnapshotReader: readerReturning({ snapshot, record: null }),
    });

    await expect(getCustomerRfm({ masterCustomerId: '9001' })).resolves.toEqual({
      status: 'rfm_not_available',
      masterCustomerId: '9001',
      reason: 'no_current_rfm_record',
      contractVersion: 'customer-rfm-runtime-v1',
    });
  });

  it('rejects invalid masterCustomerId before touching readers', async () => {
    const masterReader = masterReaderReturning(true);
    const currentRfmSnapshotReader = readerReturning({ snapshot, record });
    const getCustomerRfm = createGetCustomerRfm({
      masterCustomerReader: masterReader,
      currentRfmSnapshotReader,
    });

    await expect(getCustomerRfm({ masterCustomerId: '0' })).rejects.toThrow(/Invalid master customer id/);
    await expect(getCustomerRfm({ masterCustomerId: 'abc' })).rejects.toThrow(/Invalid master customer id/);
    expect(currentRfmSnapshotReader.getCurrentMasterCustomerRfmLookup).not.toHaveBeenCalled();
    expect(masterReader.findById).not.toHaveBeenCalled();
  });
});
