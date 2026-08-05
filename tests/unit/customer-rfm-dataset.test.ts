import { describe, expect, it } from 'vitest';
import {
  buildRfmSnapshotDataset,
  buildRfmSnapshotWindow,
  defaultFrequencyThresholds,
  recencyCalendarDays,
  scoreFrequencyThresholds,
  scoreMonetaryTieSafe,
  scoreRecencyTieSafe,
  type RfmSnapshotDiagnostics,
  type RfmPopulationSourceRow,
} from '../../src/domain/customer-rfm/index.js';

const referenceTime = '2026-08-03T00:00:00.000Z';
const generatedAt = '2026-08-03T01:00:00.000Z';

function diagnostics(overrides: Partial<RfmSnapshotDiagnostics> = {}): RfmSnapshotDiagnostics {
  return {
    historicalCustomerCount: 4,
    validOrderCount: 11,
    grossOrderValueTaxIncl: '1320.000000',
    currency: {
      distinctCurrencyCount: 1,
      currencyCode: 'CLP',
      distinctConversionRateCount: 1,
    },
    refunds: {
      refundedLineCount: 2,
      partiallyRefundedOrderCount: 1,
      partiallyRefundedAmountObserved: '50.000000',
    },
    shops: {
      distinctShopCount: 2,
      crossShopCustomers: 1,
      perShop: [
        { shopId: 1, customers: 2, orders: 7, grossOrderValueTaxIncl: '820.000000' },
        { shopId: 2, customers: 1, orders: 4, grossOrderValueTaxIncl: '500.000000' },
      ],
    },
    exclusions: {
      invalidOrderExcludedCount: 3,
      futureOrderExcludedCount: 0,
      excludedZeroValueOrderCount: 1,
      excludedOperationalAccountCount: 2,
      excludedOperationalAccountOrderCount: 5,
      excludedOperationalAccountValueTaxIncl: '900.000000',
      unusableCustomerOrderCount: 0,
      missingPrestashopCustomerOrderCount: 0,
    },
    sellerService: {
      policyVersion: 'seller-service-exclusion-v1',
      confirmedProductIds: [444],
      ordersWithSellerServiceCount: 2,
      sellerServiceLineCount: 2,
      excludedSellerServiceValueTaxIncl: '4.000000',
      grossOrderValueBeforeSellerServiceExclusion: '1324.000000',
      monetaryAfterSellerServiceExclusion: '1320.000000',
      productTargetedDiscountOrderCount: 0,
    },
    ...overrides,
  };
}

function rows(): readonly RfmPopulationSourceRow[] {
  return [
    {
      prestashopCustomerId: 20,
      firstValidOrderAt: '2026-07-01 12:00:00',
      lastValidOrderAt: '2026-08-02 23:59:59',
      frequencyOrders: 2,
      grossOrderValueTaxIncl: '120.000000',
      distinctShopCount: 1,
    },
    {
      prestashopCustomerId: 10,
      firstValidOrderAt: '2025-09-03 10:00:00',
      lastValidOrderAt: '2026-08-01 08:00:00',
      frequencyOrders: 1,
      grossOrderValueTaxIncl: '0',
      distinctShopCount: 1,
    },
    {
      prestashopCustomerId: 30,
      firstValidOrderAt: '2026-01-01 10:00:00',
      lastValidOrderAt: '2026-08-01 18:00:00',
      frequencyOrders: 8,
      grossOrderValueTaxIncl: '1200',
      distinctShopCount: 2,
    },
  ];
}

describe('RFM snapshot window', () => {
  it('requires an explicit UTC referenceTime and builds a 365-day [start, end) window', () => {
    expect(buildRfmSnapshotWindow(referenceTime)).toEqual({
      referenceTime,
      windowStartInclusive: '2025-08-03T00:00:00.000Z',
      windowEndExclusive: referenceTime,
    });

    expect(() => buildRfmSnapshotWindow('2026-08-03')).toThrow(/explicit UTC ISO timestamp/);
    expect(() => buildRfmSnapshotWindow('')).toThrow(/required/);
  });

  it('computes recency as calendar days from referenceTime to the last valid order', () => {
    expect(recencyCalendarDays(referenceTime, '2026-08-02 23:59:59')).toBe(1);
    expect(recencyCalendarDays(referenceTime, '2026-08-01 00:00:00')).toBe(2);
    expect(() => recencyCalendarDays(referenceTime, '2026-08-03 00:00:00')).toThrow();
  });
});

describe('RFM scoring', () => {
  it('uses tie-safe R and M scores and configurable frequency thresholds', () => {
    const recencyScores = scoreRecencyTieSafe([1, 2, 2, 10]);
    expect(recencyScores.get(1)).toBe(5);
    expect(recencyScores.get(2)).toBe(4);

    const monetaryScores = scoreMonetaryTieSafe(['0.000000', '120.000000', '120.000000', '1200.000000']);
    expect(monetaryScores.get('1200.000000')).toBe(5);
    expect(monetaryScores.get('120.000000')).toBe(4);

    expect(scoreFrequencyThresholds(1, defaultFrequencyThresholds)).toBe(1);
    expect(scoreFrequencyThresholds(2, defaultFrequencyThresholds)).toBe(2);
    expect(scoreFrequencyThresholds(3, defaultFrequencyThresholds)).toBe(3);
    expect(scoreFrequencyThresholds(4, defaultFrequencyThresholds)).toBe(4);
    expect(scoreFrequencyThresholds(5, defaultFrequencyThresholds)).toBe(4);
    expect(scoreFrequencyThresholds(6, defaultFrequencyThresholds)).toBe(5);
  });
});

describe('buildRfmSnapshotDataset', () => {
  it('builds deterministic provisional rows, gross monetary metrics, manifest and RFM codes', () => {
    const window = buildRfmSnapshotWindow(referenceTime);
    const result = buildRfmSnapshotDataset({
      ...window,
      generatedAt,
      calculationVersion: 'rfm-v1',
      sourceRows: rows(),
      diagnostics: diagnostics(),
    });

    expect(result.rows.map((row) => row.prestashopCustomerId)).toEqual([10, 20, 30]);
    expect(result.rows[0]).toMatchObject({
      masterCustomerId: null,
      identityResolutionStatus: 'provisional',
      recencyDays: 2,
      frequencyOrders: 1,
      grossOrderValueTaxIncl: '0.000000',
      averageOrderValueTaxIncl: '0.000000',
      frequencyScore: 1,
    });
    expect(result.rows[1]?.rfmCode).toMatch(/^R\dF\dM\d$/);
    expect(result.rows[1]?.grossOrderValueTaxIncl).toBe('120.000000');
    expect(result.rows[2]).toMatchObject({ frequencyScore: 5, distinctShopCount: 2 });

    expect(result.manifest).toMatchObject({
      identityAuthority: 'prestashop_customer',
      identityAuthorityVersion: 'prestashop-customer-v1',
      populationScope: 'all_valid_prestashop_shops',
      shippingIncluded: true,
      sellerServiceExcluded: true,
      sellerServiceExclusionPolicyVersion: 'seller-service-exclusion-v1',
      operationalAccountPolicyVersion: 'operational-account-exclusion-v1',
      activeCustomerCount: 3,
      scoredCustomerCount: 3,
      historicalCustomerCount: 4,
      excludedCustomerCount: 1,
      excludedOperationalAccountCount: 2,
      validOrderCount: 11,
      grossOrderValueTaxIncl: '1320.000000',
      currencyCode: 'CLP',
      distinctCurrencyCount: 1,
      distinctShopCount: 2,
      excludedZeroValueOrderCount: 1,
      invalidOrderExcludedCount: 3,
      partiallyRefundedOrderCount: 1,
      partiallyRefundedAmountObserved: '50.000000',
      ordersWithSellerServiceCount: 2,
      sellerServiceLineCount: 2,
      excludedSellerServiceValueTaxIncl: '4.000000',
      grossOrderValueBeforeSellerServiceExclusion: '1324.000000',
      monetaryAfterSellerServiceExclusion: '1320.000000',
    });
    expect(result.manifest.frequencyThresholds).toEqual(defaultFrequencyThresholds);
    expect(JSON.stringify(result.manifest)).not.toMatch(/email|phone|address|rut|dni/i);

    const second = buildRfmSnapshotDataset({
      ...window,
      generatedAt,
      calculationVersion: 'rfm-v1',
      sourceRows: [...rows()].reverse(),
      diagnostics: diagnostics(),
    });
    expect(second.datasetChecksum).toBe(result.datasetChecksum);
    expect(second.sourceChecksum).toBe(result.sourceChecksum);
  });

  it('aborts on multi-currency, incompatible conversion rates, duplicate customers and bad scores inputs', () => {
    const window = buildRfmSnapshotWindow(referenceTime);
    expect(() =>
      buildRfmSnapshotDataset({
        ...window,
        generatedAt,
        calculationVersion: 'rfm-v1',
        sourceRows: rows(),
        diagnostics: diagnostics({ currency: { distinctCurrencyCount: 2, currencyCode: 'CLP', distinctConversionRateCount: 1 } }),
      }),
    ).toThrow(/exactly one source currency/);

    expect(() =>
      buildRfmSnapshotDataset({
        ...window,
        generatedAt,
        calculationVersion: 'rfm-v1',
        sourceRows: rows(),
        diagnostics: diagnostics({ currency: { distinctCurrencyCount: 1, currencyCode: 'CLP', distinctConversionRateCount: 2 } }),
      }),
    ).toThrow(/conversion rate/);

    expect(() =>
      buildRfmSnapshotDataset({
        ...window,
        generatedAt,
        calculationVersion: 'rfm-v1',
        sourceRows: [rows()[0]!, rows()[0]!],
        diagnostics: diagnostics(),
      }),
    ).toThrow(/duplicate/);
  });
});
