import { describe, expect, it, vi } from 'vitest';
import { createGetCustomerRfmByCustomerId } from '../../src/application/customer-rfm/get-customer-rfm-by-customer-id.js';
import { RfmSchemaIncompatibleError, RfmTimeoutError, RfmUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { ResolveCustomerIdentity } from '../../src/application/customer-identity/resolve-customer-identity.js';
import type { CurrentRfmSnapshotReader } from '../../src/application/customer-rfm/ports.js';
import type { CurrentPrestashopCustomerRfmLookup } from '../../src/domain/customer-rfm/index.js';

// This test file never imports anything from src/infrastructure/crm/* or references a
// MasterCustomerReader-shaped dependency, on purpose: createGetCustomerRfmByCustomerId's
// own dependency type has no CRM slot at all, so a CRM read can't sneak back in here
// without first changing that type — that's the regression this file guards structurally,
// on top of the explicit "never called" test below.

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
  populationSize: 14173,
  currencyCode: 'CLP',
  datasetChecksum: 'a'.repeat(64),
};

const record = {
  prestashopCustomerId: 777,
  masterCustomerId: null,
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

function readerReturning(lookup: CurrentPrestashopCustomerRfmLookup): CurrentRfmSnapshotReader {
  return {
    getCurrentSnapshot: vi.fn(async () => lookup.snapshot),
    getCurrentPrestashopCustomerRfm: vi.fn(async () => lookup.record),
    getCurrentPrestashopCustomerRfmLookup: vi.fn(async () => lookup),
    getCurrentMasterCustomerRfm: vi.fn(async () => null),
    getCurrentMasterCustomerRfmLookup: vi.fn(async () => ({ snapshot: lookup.snapshot, record: null })),
  };
}

function readerThrowing(error: unknown): CurrentRfmSnapshotReader {
  return {
    getCurrentSnapshot: vi.fn(async () => {
      throw error;
    }),
    getCurrentPrestashopCustomerRfm: vi.fn(async () => null),
    getCurrentPrestashopCustomerRfmLookup: vi.fn(async () => {
      throw error;
    }),
    getCurrentMasterCustomerRfm: vi.fn(async () => null),
    getCurrentMasterCustomerRfmLookup: vi.fn(async () => ({ snapshot: null, record: null })),
  };
}

function identityReturning(found: boolean): ResolveCustomerIdentity {
  return vi.fn(async () =>
    found
      ? {
          status: 'found' as const,
          identity: {
            customerId: 777,
            externalCustomerId: 777,
            identitySource: 'PRESTASHOP' as const,
            identityStatus: 'DIRECT_SOURCE' as const,
            sourceMetadata: { platform: 'PRESTASHOP' as const, entity: 'ps_customer' as const, primaryKey: 'id_customer' as const },
          },
        }
      : { status: 'not_found' as const },
  );
}

describe('getCustomerRfmByCustomerId', () => {
  it('returns the public RFM contract keyed by customerId when a current record exists', async () => {
    const resolveCustomerIdentity = identityReturning(true);
    const getCustomerRfmByCustomerId = createGetCustomerRfmByCustomerId({
      resolveCustomerIdentity,
      currentRfmSnapshotReader: readerReturning({ snapshot, record }),
    });

    await expect(getCustomerRfmByCustomerId({ customerId: 777 })).resolves.toEqual({
      status: 'available',
      customerId: 777,
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
    // The found path never resolves identity either — the row itself is sufficient proof
    // the customer exists.
    expect(resolveCustomerIdentity).not.toHaveBeenCalled();
  });

  it('returns available with null segment for historical pre-T11E rows', async () => {
    const getCustomerRfmByCustomerId = createGetCustomerRfmByCustomerId({
      resolveCustomerIdentity: identityReturning(true),
      currentRfmSnapshotReader: readerReturning({
        snapshot,
        record: { ...record, segmentCode: null, segmentVersion: null },
      }),
    });

    await expect(getCustomerRfmByCustomerId({ customerId: 777 })).resolves.toMatchObject({
      status: 'available',
      segment: { code: null, version: null },
    });
  });

  it('returns degraded no_published_rfm_snapshot without ever resolving PrestaShop identity', async () => {
    const resolveCustomerIdentity = identityReturning(true);
    const getCustomerRfmByCustomerId = createGetCustomerRfmByCustomerId({
      resolveCustomerIdentity,
      currentRfmSnapshotReader: readerReturning({ snapshot: null, record: null }),
    });

    await expect(getCustomerRfmByCustomerId({ customerId: 777 })).resolves.toEqual({
      status: 'degraded',
      customerId: 777,
      reason: 'no_published_rfm_snapshot',
      contractVersion: 'customer-rfm-runtime-v1',
    });
    expect(resolveCustomerIdentity).not.toHaveBeenCalled();
  });

  it('returns customer_not_found when the snapshot is published but PrestaShop has no such customer', async () => {
    const resolveCustomerIdentity = identityReturning(false);
    const getCustomerRfmByCustomerId = createGetCustomerRfmByCustomerId({
      resolveCustomerIdentity,
      currentRfmSnapshotReader: readerReturning({ snapshot, record: null }),
    });

    await expect(getCustomerRfmByCustomerId({ customerId: 999999 })).resolves.toEqual({
      status: 'customer_not_found',
      customerId: 999999,
      contractVersion: 'customer-rfm-runtime-v1',
    });
    expect(resolveCustomerIdentity).toHaveBeenCalledWith(999999);
  });

  it('returns rfm_not_available when the PrestaShop customer exists but has no row in the current snapshot', async () => {
    const getCustomerRfmByCustomerId = createGetCustomerRfmByCustomerId({
      resolveCustomerIdentity: identityReturning(true),
      currentRfmSnapshotReader: readerReturning({ snapshot, record: null }),
    });

    await expect(getCustomerRfmByCustomerId({ customerId: 777 })).resolves.toEqual({
      status: 'rfm_not_available',
      customerId: 777,
      reason: 'no_current_rfm_record',
      contractVersion: 'customer-rfm-runtime-v1',
    });
  });

  it.each([
    ['RfmUnavailableError', new RfmUnavailableError('rfm db down')],
    ['RfmTimeoutError', new RfmTimeoutError('rfm db timed out')],
    ['RfmSchemaIncompatibleError', new RfmSchemaIncompatibleError('missing table')],
  ] as const)('returns degraded rfm_unavailable when the reader throws %s', async (_name, error) => {
    const resolveCustomerIdentity = identityReturning(true);
    const getCustomerRfmByCustomerId = createGetCustomerRfmByCustomerId({
      resolveCustomerIdentity,
      currentRfmSnapshotReader: readerThrowing(error),
    });

    await expect(getCustomerRfmByCustomerId({ customerId: 777 })).resolves.toEqual({
      status: 'degraded',
      customerId: 777,
      reason: 'rfm_unavailable',
      contractVersion: 'customer-rfm-runtime-v1',
    });
    expect(resolveCustomerIdentity).not.toHaveBeenCalled();
  });

  it('rethrows unrecognized errors instead of masking them as degraded', async () => {
    const getCustomerRfmByCustomerId = createGetCustomerRfmByCustomerId({
      resolveCustomerIdentity: identityReturning(true),
      currentRfmSnapshotReader: readerThrowing(new Error('unexpected programming error')),
    });

    await expect(getCustomerRfmByCustomerId({ customerId: 777 })).rejects.toThrow('unexpected programming error');
  });

  it('never calls a CRM-shaped dependency — the function signature has none to call', async () => {
    // Structural proof, not just a runtime assertion: createGetCustomerRfmByCustomerId's
    // deps type only accepts resolveCustomerIdentity + currentRfmSnapshotReader. If a
    // future change added a CRM read to this path, it would have to widen this deps type
    // first, which would break every call site in this file (including this one).
    const resolveCustomerIdentity = identityReturning(true);
    const currentRfmSnapshotReader = readerReturning({ snapshot, record });
    const getCustomerRfmByCustomerId = createGetCustomerRfmByCustomerId({ resolveCustomerIdentity, currentRfmSnapshotReader });

    await getCustomerRfmByCustomerId({ customerId: 777 });

    expect(currentRfmSnapshotReader.getCurrentMasterCustomerRfm).not.toHaveBeenCalled();
    expect(currentRfmSnapshotReader.getCurrentMasterCustomerRfmLookup).not.toHaveBeenCalled();
  });
});
