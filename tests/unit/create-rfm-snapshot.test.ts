import { describe, expect, it, vi } from 'vitest';
import { createRfmSnapshot, type RfmSnapshotRepository } from '../../src/application/customer-rfm/create-rfm-snapshot.js';
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
        zeroAmountOrderCount: 0,
        unusableCustomerOrderCount: 0,
        missingPrestashopCustomerOrderCount: 0,
        ...overrides,
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
      hasPublishedSnapshot: vi.fn(async () => false),
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
    expect(repository.hasPublishedSnapshot).toHaveBeenCalledWith(
      'rfm-v1__prestashop-customer-v1__active-365-valid-prestashop-customer-v1__gross-order-value-tax-incl-v1__gross-valid-orders-v1__r-tie-safe-percent-rank-v1__frequency-thresholds-candidate-v1__m-tie-safe-percent-rank-v1__2026-08-03T00-00-00-000Z',
    );
    expect(repository.publishSnapshot).toHaveBeenCalledTimes(1);
  });

  it('aborts if a published snapshot already exists for the same referenceTime and calculationVersion', async () => {
    const repository: RfmSnapshotRepository = {
      hasPublishedSnapshot: vi.fn(async () => true),
      publishSnapshot: vi.fn(),
    };

    await expect(
      createRfmSnapshot(
        { referenceTime, calculationVersion: 'rfm-v1', generatedAt, dryRun: false },
        { reader: reader(), repository },
      ),
    ).rejects.toThrow(/already exists/);
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
});
