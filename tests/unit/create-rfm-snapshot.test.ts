import { describe, expect, it, vi } from 'vitest';
import {
  createRfmSnapshot,
  RfmSnapshotKeyConflictError,
  type RfmSnapshotRepository,
} from '../../src/application/customer-rfm/create-rfm-snapshot.js';
import type { RfmCanonicalIdentityResolver } from '../../src/application/customer-rfm/ports.js';
import type { RfmPopulationReader } from '../../src/infrastructure/prestashop/mysql-rfm-population-reader.js';
import type { RfmSnapshotDiagnostics } from '../../src/domain/customer-rfm/index.js';

const referenceTime = '2026-08-03T00:00:00.000Z';
const generatedAt = '2026-08-03T01:00:00.000Z';

function reader(overrides: Partial<RfmSnapshotDiagnostics['exclusions']> = {}): RfmPopulationReader {
  return {
    verifySchema: vi.fn(async () => undefined),
    readPopulation: vi.fn(async () => [
      {
        prestashopCustomerId: 1,
        firstValidOrderAt: '2026-08-01 10:00:00',
        lastValidOrderAt: '2026-08-02 10:00:00',
        frequencyOrders: 2,
        grossOrderValueTaxIncl: '200.000000',
        distinctShopCount: 1,
      },
    ]),
    readDiagnostics: vi.fn(async () => ({
      historicalCustomerCount: 1,
      validOrderCount: 2,
      grossOrderValueTaxIncl: '200.000000',
      currency: { distinctCurrencyCount: 1, currencyCode: 'CLP', distinctConversionRateCount: 1 },
      refunds: {
        refundedLineCount: 0,
        partiallyRefundedOrderCount: 0,
        partiallyRefundedAmountObserved: '0.000000',
      },
      shops: {
        distinctShopCount: 1,
        crossShopCustomers: 0,
        perShop: [{ shopId: 1, customers: 1, orders: 2, grossOrderValueTaxIncl: '200.000000' }],
      },
      exclusions: {
        invalidOrderExcludedCount: 0,
        futureOrderExcludedCount: 0,
        excludedZeroValueOrderCount: 0,
        excludedOperationalAccountCount: 0,
        excludedOperationalAccountOrderCount: 0,
        excludedOperationalAccountValueTaxIncl: '0.000000',
        unusableCustomerOrderCount: 0,
        missingPrestashopCustomerOrderCount: 0,
        ...overrides,
      },
      sellerService: {
        policyVersion: 'seller-service-exclusion-v1',
        confirmedProductIds: [444],
        ordersWithSellerServiceCount: 0,
        sellerServiceLineCount: 0,
        excludedSellerServiceValueTaxIncl: '0.000000',
        grossOrderValueBeforeSellerServiceExclusion: '200.000000',
        monetaryAfterSellerServiceExclusion: '200.000000',
        productTargetedDiscountOrderCount: 0,
      },
    })),
  };
}

describe('createRfmSnapshot', () => {
  it('dry-runs without a repository and passes inclusive/exclusive MySQL bounds to the reader', async () => {
    const fakeReader = reader();
    const result = await createRfmSnapshot(
      { referenceTime, calculationVersion: 'rfm-v1', generatedAt, dryRun: true },
      { reader: fakeReader },
    );

    expect(result.mode).toBe('dry_run');
    expect(result.snapshotId).toBeNull();
    expect(result.rows).toHaveLength(1);
    expect(fakeReader.readPopulation).toHaveBeenCalledWith('2025-08-03 00:00:00', '2026-08-03 00:00:00');
    expect(fakeReader.readDiagnostics).toHaveBeenCalledWith('2025-08-03 00:00:00', '2026-08-03 00:00:00');
  });

  it('persists through the repository when dryRun is false', async () => {
    const repository: RfmSnapshotRepository = {
      findPublishedSnapshot: vi.fn(async () => null),
      publishSnapshot: vi.fn(async (input) => ({
        snapshotId: '123',
        persistedRowCount: input.rows.length,
        datasetChecksum: input.datasetChecksum,
      })),
    };

    const result = await createRfmSnapshot(
      { referenceTime, calculationVersion: 'rfm-v1', generatedAt, dryRun: false },
      { reader: reader(), repository },
    );

    expect(result.mode).toBe('persisted');
    expect(result.snapshotId).toBe('123');
    expect(repository.findPublishedSnapshot).toHaveBeenCalledWith(
      'rfm-v1__prestashop-customer-v1__active-365-valid-prestashop-customer-v2__gross-order-value-tax-incl-minus-seller-service-v2__gross-valid-orders-v1__r-tie-safe-percent-rank-v1__frequency-thresholds-candidate-v1__m-tie-safe-percent-rank-v1__2026-08-03T00-00-00-000Z',
    );
    expect(repository.publishSnapshot).toHaveBeenCalledTimes(1);
  });

  it('skips persistence when the same published snapshot key already exists with the same checksum', async () => {
    const dryRun = await createRfmSnapshot(
      { referenceTime, calculationVersion: 'rfm-v1', generatedAt, dryRun: true },
      { reader: reader() },
    );
    const repository: RfmSnapshotRepository = {
      findPublishedSnapshot: vi.fn(async () => ({
        snapshotId: '123',
        datasetChecksum: dryRun.manifest.datasetChecksum,
      })),
      publishSnapshot: vi.fn(),
    };

    const result = await createRfmSnapshot(
      { referenceTime, calculationVersion: 'rfm-v1', generatedAt, dryRun: false },
      { reader: reader(), repository },
    );

    expect(result.mode).toBe('skipped_existing');
    expect(result.snapshotId).toBe('123');
    expect(repository.publishSnapshot).not.toHaveBeenCalled();
  });

  it('fails explicitly when the same published snapshot key exists with a different checksum', async () => {
    const repository: RfmSnapshotRepository = {
      findPublishedSnapshot: vi.fn(async () => ({
        snapshotId: '123',
        datasetChecksum: 'f'.repeat(64),
      })),
      publishSnapshot: vi.fn(),
    };

    await expect(
      createRfmSnapshot(
        { referenceTime, calculationVersion: 'rfm-v1', generatedAt, dryRun: false },
        { reader: reader(), repository },
      ),
    ).rejects.toThrow(RfmSnapshotKeyConflictError);
    expect(repository.publishSnapshot).not.toHaveBeenCalled();
  });

  it('aborts on unusable or missing PrestaShop customer ids before persistence', async () => {
    await expect(
      createRfmSnapshot(
        { referenceTime, calculationVersion: 'rfm-v1', generatedAt, dryRun: true },
        { reader: reader({ unusableCustomerOrderCount: 1 }) },
      ),
    ).rejects.toThrow(/unusable customer/);

    await expect(
      createRfmSnapshot(
        { referenceTime, calculationVersion: 'rfm-v1', generatedAt, dryRun: true },
        { reader: reader({ missingPrestashopCustomerOrderCount: 1 }) },
      ),
    ).rejects.toThrow(/missing ps_customer/);
  });

  it('wires canonical master customer ids without changing R/F/M metrics', async () => {
    const canonicalIdentityResolver: RfmCanonicalIdentityResolver = {
      resolvePrestashopCustomerIds: vi.fn(async () => ({
        resolutions: [{ prestashopCustomerId: 1, status: 'matched' as const, masterCustomerId: '9001' }],
        coverage: {
          populationSize: 1,
          canonicalMatchedCount: 1,
          canonicalUnmatchedCount: 0,
          canonicalAmbiguousCount: 0,
          canonicalCoveragePct: '100.000000',
        },
      })),
    };

    const result = await createRfmSnapshot(
      { referenceTime, calculationVersion: 'rfm-v1', generatedAt, dryRun: true },
      { reader: reader(), canonicalIdentityResolver },
    );

    expect(result.rows[0]).toMatchObject({
      masterCustomerId: '9001',
      grossOrderValueTaxIncl: '200.000000',
      recencyDays: 1,
      frequencyOrders: 2,
      segmentCode: 'POTENTIAL_LOYAL',
      segmentVersion: 'rfm-commercial-v1',
    });
    expect(result.manifest.canonicalMatchedCount).toBe(1);
    expect(result.manifest.canonicalCoveragePct).toBe('100.000000');
    expect(result.manifest.segmentCounts.POTENTIAL_LOYAL).toBe(1);
  });

  it('propagates canonical identity resolver errors instead of converting them to unmatched', async () => {
    const canonicalIdentityResolver: RfmCanonicalIdentityResolver = {
      resolvePrestashopCustomerIds: vi.fn(async () => Promise.reject(new Error('crm down'))),
    };

    await expect(
      createRfmSnapshot(
        { referenceTime, calculationVersion: 'rfm-v1', generatedAt, dryRun: true },
        { reader: reader(), canonicalIdentityResolver },
      ),
    ).rejects.toThrow('crm down');
  });
});
