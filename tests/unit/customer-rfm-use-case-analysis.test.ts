import { describe, expect, it } from 'vitest';
import {
  assertRfmUseCaseReportHasNoPii,
  buildLifetimeCustomerMetrics,
  buildRfmUseCaseAnalysis,
  type HistoricalRfmOrderInput,
  type RfmScore,
  type RfmSnapshotRow,
} from '../../src/domain/customer-rfm/index.js';

const referenceTime = '2026-08-03T00:00:00.000Z';
const calculationVersion = 'rfm-population-v1';

function row(input: {
  readonly id: number;
  readonly first?: string;
  readonly last?: string;
  readonly recency: number;
  readonly frequency: number;
  readonly monetary: string;
  readonly r?: RfmScore;
  readonly f?: RfmScore;
  readonly m?: RfmScore;
}): RfmSnapshotRow {
  const recencyScore = input.r ?? 5;
  const frequencyScore = input.f ?? (input.frequency >= 6 ? 5 : input.frequency >= 4 ? 4 : input.frequency >= 3 ? 3 : input.frequency >= 2 ? 2 : 1);
  const monetaryScore = input.m ?? 3;
  return {
    prestashopCustomerId: input.id,
    masterCustomerId: null,
    identityResolutionStatus: 'provisional',
    firstValidOrderAt: input.first ?? input.last ?? '2026-07-01 00:00:00',
    lastValidOrderAt: input.last ?? '2026-07-01 00:00:00',
    recencyDays: input.recency,
    frequencyOrders: input.frequency,
    grossOrderValueTaxIncl: input.monetary,
    averageOrderValueTaxIncl: '100.000000',
    distinctShopCount: 1,
    recencyScore,
    frequencyScore,
    monetaryScore,
    rfmCode: `R${recencyScore}F${frequencyScore}M${monetaryScore}`,
  };
}

function order(
  prestashopCustomerId: number,
  orderId: number,
  validOrderAt: string,
  grossOrderValueTaxIncl = '100.000000',
  shopId = 1,
): HistoricalRfmOrderInput {
  return { prestashopCustomerId, orderId, validOrderAt, grossOrderValueTaxIncl, shopId };
}

function baseOperationalRows(): readonly RfmSnapshotRow[] {
  return [
    row({ id: 1, last: '2026-07-20 10:00:00', recency: 14, frequency: 1, monetary: '100.000000', r: 5, f: 1, m: 2 }),
    row({ id: 2, first: '2026-06-01 10:00:00', last: '2026-06-08 10:00:00', recency: 56, frequency: 2, monetary: '500.000000', r: 4, f: 2, m: 4 }),
    row({ id: 3, first: '2026-05-01 10:00:00', last: '2026-07-25 10:00:00', recency: 9, frequency: 4, monetary: '5000.000000', r: 5, f: 4, m: 5 }),
    row({ id: 6, first: '2025-09-01 10:00:00', last: '2026-08-01 10:00:00', recency: 2, frequency: 101, monetary: '1010.000000', r: 5, f: 5, m: 4 }),
  ];
}

function baseHistoricalOrders(): readonly HistoricalRfmOrderInput[] {
  return [
    order(1, 11, '2026-07-20 10:00:00', '100.000000', 1),
    order(2, 21, '2026-06-01 10:00:00', '250.000000', 1),
    order(2, 22, '2026-06-08 10:00:00', '250.000000', 1),
    order(3, 31, '2026-05-01 10:00:00', '1000.000000', 2),
    order(3, 32, '2026-06-01 10:00:00', '1000.000000', 2),
    order(3, 33, '2026-07-01 10:00:00', '1000.000000', 2),
    order(3, 34, '2026-07-25 10:00:00', '2000.000000', 2),
    order(4, 41, '2024-01-01 10:00:00', '3000.000000', 1),
    order(4, 42, '2024-02-01 10:00:00', '4000.000000', 1),
    order(5, 51, '2024-03-01 10:00:00', '50.000000', 3),
    ...Array.from({ length: 101 }, (_, index) =>
      order(6, 600 + index, `2026-07-${String((index % 28) + 1).padStart(2, '0')} 10:00:00`, '10.000000', 1),
    ),
  ];
}

describe('RFM use-case temporal layers', () => {
  it('separates operational and lifetime metrics without mixing inactive customers into operational RFM', () => {
    const lifetime = buildLifetimeCustomerMetrics(referenceTime, baseOperationalRows(), baseHistoricalOrders());
    const customer1 = lifetime.find((entry) => entry.prestashopCustomerId === 1);
    const customer4 = lifetime.find((entry) => entry.prestashopCustomerId === 4);

    expect(customer1).toMatchObject({
      lifetimeFirstValidOrderAt: '2026-07-20 10:00:00',
      lifetimeLastValidOrderAt: '2026-07-20 10:00:00',
      lifetimeFrequencyOrders: 1,
      lifetimeGrossOrderValueTaxIncl: '100.000000',
      lifetimeAverageOrderValueTaxIncl: '100.000000',
      hasOrderInOperationalWindow: true,
    });
    expect(customer4).toMatchObject({
      lifetimeFirstValidOrderAt: '2024-01-01 10:00:00',
      lifetimeLastValidOrderAt: '2024-02-01 10:00:00',
      lifetimeFrequencyOrders: 2,
      lifetimeGrossOrderValueTaxIncl: '7000.000000',
      lifetimeAverageOrderValueTaxIncl: '3500.000000',
      hasOrderInOperationalWindow: false,
    });
  });

  it('reports operational, historical and outside-window population counts', () => {
    const analysis = buildRfmUseCaseAnalysis({
      referenceTime,
      calculationVersion,
      operationalRows: baseOperationalRows(),
      historicalOrders: baseHistoricalOrders(),
    });

    expect(analysis.populationSummary).toMatchObject({
      operationalCustomerCount: 4,
      historicalCustomerCount: 6,
      historicalOutsideOperationalWindowCount: 2,
      operationalShareOfHistoricalCustomers: '0.666667',
      timezoneStatus: 'UNVERIFIED',
      identityResolutionStatus: 'provisional',
    });
    expect(analysis.operationalVsLifetime).toMatchObject({
      operationalOnlyCustomerCount: 0,
      historicalOnlyCustomerCount: 2,
      customersInBothLayersCount: 4,
    });
  });
});

describe('RFM second purchase analysis', () => {
  function secondPurchaseFixture(): readonly HistoricalRfmOrderInput[] {
    return [
      order(1, 100, '2026-07-01 10:00:00'),
      order(2, 201, '2026-07-01 10:00:00'),
      order(2, 200, '2026-07-01 10:00:00'),
      order(3, 300, '2026-06-01 10:00:00'),
      order(3, 301, '2026-06-08 10:00:00'),
      order(4, 400, '2026-06-01 10:00:00'),
      order(4, 401, '2026-07-01 10:00:00'),
      order(5, 500, '2025-01-01 10:00:00'),
      order(5, 501, '2026-01-01 10:00:00'),
      order(6, 600, '2024-01-01 10:00:00'),
      order(6, 601, '2025-01-02 10:00:00'),
      order(7, 700, '2026-07-20 10:00:00'),
      order(7, 701, '2026-07-28 10:00:00'),
      order(8, 800, '2026-04-01 10:00:00'),
      order(8, 801, '2026-06-15 10:00:00'),
    ];
  }

  it('classifies no second purchase, same-day, 7-day, 30-day, 365-day and over-365-day outcomes', () => {
    const analysis = buildRfmUseCaseAnalysis({
      referenceTime,
      calculationVersion,
      operationalRows: [],
      historicalOrders: secondPurchaseFixture(),
    });

    expect(analysis.secondPurchaseAnalysis.buckets.noSecondPurchase).toBe(1);
    expect(analysis.secondPurchaseAnalysis.buckets.sameDay).toBe(1);
    expect(analysis.secondPurchaseAnalysis.buckets['1-7 days']).toBe(1);
    expect(analysis.secondPurchaseAnalysis.buckets['8-30 days']).toBe(2);
    expect(analysis.secondPurchaseAnalysis.buckets['61-90 days']).toBe(1);
    expect(analysis.secondPurchaseAnalysis.buckets['181-365 days']).toBe(1);
    expect(analysis.secondPurchaseAnalysis.buckets['>365 days']).toBe(1);
    expect(analysis.secondPurchaseAnalysis.customersWithSecondPurchase).toBe(7);
    expect(analysis.secondPurchaseAnalysis.caveat).toBe('NOT_CAUSAL_CONVERSION_RATE');
  });

  it('separates mature first-purchase cohorts from not-yet-observed cohorts', () => {
    const analysis = buildRfmUseCaseAnalysis({
      referenceTime,
      calculationVersion,
      operationalRows: [],
      historicalOrders: secondPurchaseFixture(),
    });

    const mature = analysis.secondPurchaseAnalysis.firstPurchaseCohorts.find((entry) => entry.cohortMonth === '2024-01');
    const recent = analysis.secondPurchaseAnalysis.firstPurchaseCohorts.find((entry) => entry.cohortMonth === '2026-07');
    expect(mature).toMatchObject({ matured365DayObservation: true, noSecondPurchaseObservedCount: 0 });
    expect(recent).toMatchObject({ matured365DayObservation: false, notYetObservedCount: 1 });
  });
});

describe('RFM candidate cohorts and sensitivity', () => {
  it('builds overlapping candidate cohorts without assuming exclusivity', () => {
    const analysis = buildRfmUseCaseAnalysis({
      referenceTime,
      calculationVersion,
      operationalRows: baseOperationalRows(),
      historicalOrders: baseHistoricalOrders(),
    });

    expect(analysis.candidateCohorts.recentFirstPurchase.recent_first_purchase_30d_candidate?.customerCount).toBe(1);
    expect(analysis.candidateCohorts.repeatCustomer.repeat_customer_2_plus_candidate?.customerCount).toBe(3);
    expect(analysis.candidateCohorts.highGrossPurchaseValueActive.high_gross_purchase_value_active_monetary_score_5_candidate?.customerCount).toBe(1);
    expect(analysis.candidateCohorts.activeRepeatHighGross.active_repeat_high_gross_r4_f4_m4_plus_candidate?.customerCount).toBe(2);
    expect(analysis.candidateCohorts.historicallyHighGrossInactive.historically_high_gross_inactive_top_20_percent_candidate?.customerCount).toBe(1);
    expect(analysis.candidateCohorts.frequencyOutlierReview.frequency_outlier_review_frequency_gt_100?.customerCount).toBe(1);
    expect(analysis.candidateCohorts.actionability.every((entry) => entry.automationReadiness !== 'POTENTIAL_FUTURE_AUTOMATION' || entry.requiresHumanReview)).toBe(true);
  });

  it('reports recency, frequency and monetary threshold sensitivity without changing scoring policy', () => {
    const analysis = buildRfmUseCaseAnalysis({
      referenceTime,
      calculationVersion,
      operationalRows: baseOperationalRows(),
      historicalOrders: baseHistoricalOrders(),
    });

    expect(analysis.thresholdSensitivity.recency.recency_lte_30?.customerCount).toBe(3);
    expect(analysis.thresholdSensitivity.recency.recency_lte_60?.customerCount).toBe(4);
    expect(analysis.thresholdSensitivity.frequency.frequency_gte_2?.customerCount).toBe(3);
    expect(analysis.thresholdSensitivity.frequency.frequency_gte_6?.customerCount).toBe(1);
    expect(analysis.thresholdSensitivity.monetary.monetary_p80?.customerCount).toBe(1);
    expect(analysis.thresholdSensitivity.monetary.monetary_p95?.customerCount).toBe(1);
  });
});

describe('RFM incremental value, cross signals and safety', () => {
  it('classifies simple filters, RFM enrichment and T08/T09 dependency', () => {
    const analysis = buildRfmUseCaseAnalysis({
      referenceTime,
      calculationVersion,
      operationalRows: baseOperationalRows(),
      historicalOrders: baseHistoricalOrders(),
    });

    expect(analysis.rfmIncrementalValue.map((entry) => entry.verdict)).toContain('RFM_ADDS_MEANINGFUL_VALUE');
    expect(analysis.rfmIncrementalValue.map((entry) => entry.verdict)).toContain('SIMPLE_FILTER_IS_SUFFICIENT');
    expect(analysis.rfmIncrementalValue.map((entry) => entry.verdict)).toContain('REQUIRES_T08_T09');
    expect(analysis.t08T09CrossAnalysis.recentFirstPurchaseT08.status).toBe('CROSS_SIGNAL_UNAVAILABLE');
    expect(analysis.useCaseValidationVerdict.primaryVerdict).toBe('RFM_USE_CASES_VALIDATED');
    expect(analysis.useCaseValidationVerdict.secondaryConditions).toContain('RFM_REQUIRES_HISTORICAL_LAYER');
    expect(analysis.useCaseValidationVerdict.infrastructureDecision).toBe('FREEZE_PERSISTENCE');
  });

  it('keeps versioned reports free of customer IDs, order IDs and PII-shaped fields', () => {
    const analysis = buildRfmUseCaseAnalysis({
      referenceTime,
      calculationVersion,
      operationalRows: baseOperationalRows(),
      historicalOrders: baseHistoricalOrders(),
    });

    const serialized = JSON.stringify(analysis);
    expect(serialized).not.toMatch(/prestashopCustomerId|masterCustomerId|orderId|email|phone|rut/i);
    expect(analysis.populationSummary.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(() => assertRfmUseCaseReportHasNoPii({ prestashopCustomerId: 123 })).toThrow(/forbidden field/);
    expect(() => assertRfmUseCaseReportHasNoPii({ note: 'ana@example.com' })).toThrow(/PII-shaped/);
  });

  it('exposes deterministic checksums for identical aggregate inputs', () => {
    const first = buildRfmUseCaseAnalysis({
      referenceTime,
      calculationVersion,
      operationalRows: baseOperationalRows(),
      historicalOrders: baseHistoricalOrders(),
    });
    const second = buildRfmUseCaseAnalysis({
      referenceTime,
      calculationVersion,
      operationalRows: [...baseOperationalRows()].reverse(),
      historicalOrders: [...baseHistoricalOrders()].reverse(),
    });

    expect(second.populationSummary.checksum).toBe(first.populationSummary.checksum);
  });
});
