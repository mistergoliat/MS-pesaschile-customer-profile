import { describe, expect, it, vi } from 'vitest';
import { runRfmSnapshotOperation } from '../../src/application/customer-rfm/run-rfm-snapshot-operation.js';
import type { RfmCanonicalIdentityResolver } from '../../src/application/customer-rfm/ports.js';
import type { RfmSnapshotRepository } from '../../src/application/customer-rfm/create-rfm-snapshot.js';
import type { RfmSnapshotDiagnostics } from '../../src/domain/customer-rfm/index.js';
import type { RfmSnapshotRunRepository } from '../../src/infrastructure/rfm/mysql-rfm-snapshot-run-repository.js';
import type { RfmPopulationReader } from '../../src/infrastructure/prestashop/mysql-rfm-population-reader.js';

function reader(): RfmPopulationReader {
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
    readDiagnostics: vi.fn(async () => diagnostics()),
  };
}

function diagnostics(overrides: Partial<RfmSnapshotDiagnostics['exclusions']> = {}): RfmSnapshotDiagnostics {
  return {
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
  };
}

function resolver(): RfmCanonicalIdentityResolver {
  return {
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
}

function repository(): RfmSnapshotRepository {
  return {
    findPublishedSnapshot: vi.fn(async () => null),
    publishSnapshot: vi.fn(async (input) => ({
      snapshotId: '55',
      persistedRowCount: input.rows.length,
      datasetChecksum: input.datasetChecksum,
    })),
  };
}

function runRepository(overrides: Partial<RfmSnapshotRunRepository> = {}): RfmSnapshotRunRepository {
  return {
    tryAcquireExecutionLock: vi.fn(async () => ({
      release: vi.fn(async () => undefined),
    })),
    createRun: vi.fn(async () => '7001'),
    completeRun: vi.fn(async () => undefined),
    ...overrides,
  };
}

function clock(...timestamps: string[]) {
  const queue = [...timestamps];
  return {
    now: vi.fn(() => new Date(queue.shift() ?? timestamps[timestamps.length - 1]!)),
  };
}

describe('runRfmSnapshotOperation', () => {
  it('runs a scheduled persisted snapshot with deterministic UTC start-of-day referenceTime and run logging', async () => {
    const fakeRunRepository = runRepository();
    const fakeClock = clock(
      '2026-08-14T15:45:12.000Z',
      '2026-08-14T15:45:12.000Z',
      '2026-08-14T15:45:13.250Z',
    );

    const result = await runRfmSnapshotOperation(
      {
        triggerSource: 'scheduled',
        calculationVersion: 'rfm-population-v1',
        dryRun: false,
        referenceTime: null,
        generatedAt: null,
      },
      {
        reader: reader(),
        canonicalIdentityResolver: resolver(),
        repository: repository(),
        runRepository: fakeRunRepository,
        clock: fakeClock,
      },
    );

    expect(result.status).toBe('succeeded');
    expect(result.referenceTime).toBe('2026-08-14T00:00:00.000Z');
    expect(result.snapshotId).toBe('55');
    expect(result.runId).toBe('7001');
    expect(result.summary?.populationSize).toBe(1);
    expect(fakeRunRepository.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'started',
        triggerSource: 'scheduled',
        referenceTime: '2026-08-14T00:00:00.000Z',
      }),
    );
    expect(fakeRunRepository.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: '7001',
        status: 'succeeded',
        snapshotId: '55',
      }),
    );
  });

  it('keeps manual dry-run execution working with explicit referenceTime override and no snapshot DB dependencies', async () => {
    const result = await runRfmSnapshotOperation(
      {
        triggerSource: 'manual',
        calculationVersion: 'rfm-population-v1',
        dryRun: true,
        referenceTime: '2026-08-03T00:00:00.000Z',
        generatedAt: null,
      },
      {
        reader: reader(),
        canonicalIdentityResolver: resolver(),
        clock: clock('2026-08-14T15:45:12.000Z', '2026-08-14T15:45:12.100Z'),
      },
    );

    expect(result.status).toBe('succeeded');
    expect(result.mode).toBe('dry_run');
    expect(result.runId).toBeNull();
    expect(result.referenceTime).toBe('2026-08-03T00:00:00.000Z');
    expect(result.summary?.canonicalMatchedCount).toBe(1);
  });

  it('skips safely when another worker already holds the DB execution lock', async () => {
    const fakeRepository = repository();
    const fakeRunRepository = runRepository({
      tryAcquireExecutionLock: vi.fn(async () => null),
    });

    const result = await runRfmSnapshotOperation(
      {
        triggerSource: 'scheduled',
        calculationVersion: 'rfm-population-v1',
        dryRun: false,
        referenceTime: null,
        generatedAt: null,
      },
      {
        reader: reader(),
        canonicalIdentityResolver: resolver(),
        repository: fakeRepository,
        runRepository: fakeRunRepository,
        clock: clock('2026-08-14T15:45:12.000Z', '2026-08-14T15:45:12.000Z'),
      },
    );

    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('execution_lock_not_acquired');
    expect(fakeRepository.publishSnapshot).not.toHaveBeenCalled();
    expect(fakeRunRepository.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'skipped',
        skipReason: 'execution_lock_not_acquired',
      }),
    );
  });

  it('marks the run as failed with typed error metadata when a source dependency fails', async () => {
    const crmError = Object.assign(new Error('crm down secret-host'), { code: 'ECONNREFUSED' });
    const fakeRunRepository = runRepository();

    await expect(
      runRfmSnapshotOperation(
        {
          triggerSource: 'scheduled',
          calculationVersion: 'rfm-population-v1',
          dryRun: false,
          referenceTime: null,
          generatedAt: null,
        },
        {
          reader: reader(),
          canonicalIdentityResolver: {
            resolvePrestashopCustomerIds: vi.fn(async () => Promise.reject(crmError)),
          },
          repository: repository(),
          runRepository: fakeRunRepository,
          clock: clock(
            '2026-08-14T15:45:12.000Z',
            '2026-08-14T15:45:12.000Z',
            '2026-08-14T15:45:12.500Z',
          ),
        },
      ),
    ).rejects.toThrow('crm down secret-host');

    expect(fakeRunRepository.completeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: '7001',
        status: 'failed',
        errorType: 'Error',
        errorCode: 'ECONNREFUSED',
      }),
    );
  });
});
