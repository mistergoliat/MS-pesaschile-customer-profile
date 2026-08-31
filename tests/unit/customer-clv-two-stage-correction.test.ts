import { describe, expect, it } from 'vitest';
import type { CustomerClvBacktestDataset, CustomerClvBacktestExample } from '../../src/domain/customer-clv/dataset.js';
import { evaluateCustomerClvTwoStageCorrectionCandidates, evaluateCustomerClvTwoStageHardeningCandidates } from '../../src/domain/customer-clv/index.js';

function example(overrides: Partial<CustomerClvBacktestExample> = {}): CustomerClvBacktestExample {
  return {
    customerId: 1,
    cutoffTime: '2024-01-01T00:00:00.000Z',
    features: {
      historicalValidOrderCount: 3,
      historicalRevenueTaxIncl: '300000.000000',
      historicalAovTaxIncl: '100000.000000',
      firstValidOrderAt: '2023-01-01T00:00:00.000Z',
      lastValidOrderAt: '2023-12-01T00:00:00.000Z',
      customerTenureDays: 365,
      daysSinceLastOrder: 30,
      purchaseFrequencyDays: '120.000000',
      orders90d: 1,
      orders180d: 2,
      orders365d: 3,
      revenue90d: '100000.000000',
      revenue180d: '200000.000000',
      revenue365d: '300000.000000',
      distinctPurchaseMonths: 3,
      cancellationRatio: '0.000000',
      discountShare: '0.000000',
      shippingShare: '0.000000',
      distinctProductCount: 3,
      repeatProductRate: '0.500000',
      productConcentration: '0.500000',
    },
    labels: {
      futureRevenueTaxIncl: '200000.000000',
      futureValidOrderCount: 1,
    },
    observationMetadata: {
      historyStart: '2023-01-01T00:00:00.000Z',
      firstValidOrderAt: '2023-01-01T00:00:00.000Z',
      lastValidOrderAt: '2023-12-01T00:00:00.000Z',
      historicalValidOrderCount: 3,
      historyDays: 365,
    },
    ...overrides,
  };
}

function dataset(
  cutoffTime: string,
  rows: readonly CustomerClvBacktestExample[],
  labelWindowEndExclusive: string,
): CustomerClvBacktestDataset {
  return {
    manifest: {
      datasetVersion: 'customer-clv-backtest-dataset-v1',
      populationPolicyVersion: 'customer-clv-population-valid-order-ge1-operational-excluded-v1',
      monetaryPolicyVersion: 'customer-clv-future-valid-order-tax-incl-clp-revenue-v1',
      orderEligibilityPolicyVersion: 'customer-clv-order-eligibility-current-valid-positive-clp-v1',
      productFeaturePolicyVersion: 'customer-clv-product-features-non-product-excluded-v1',
      orderStatusTemporalPolicyVersion: 'customer-clv-current-valid-observed-with-documented-drift-v1',
      cutoffTime,
      labelWindowStartInclusive: cutoffTime,
      labelWindowEndExclusive,
      availableDataThrough: '2026-08-31T16:13:13.000Z',
      horizonMonths: 12,
      customerCount: rows.length,
      historyOrderCount: rows.reduce((total, row) => total + row.features.historicalValidOrderCount, 0),
      labelOrderCount: rows.reduce((total, row) => total + row.labels.futureValidOrderCount, 0),
      zeroFutureOrderCustomerCount: rows.filter((row) => row.labels.futureValidOrderCount === 0).length,
      singleHistoricalOrderCustomerCount: rows.filter((row) => row.features.historicalValidOrderCount === 1).length,
      excludedInconsistentCustomerCreatedAtCustomerCount: 0,
      excludedOrderBeforeCustomerCreatedAtCustomerCount: 0,
      currencyIsoCode: 'CLP',
      sourceDateTimeStorage: 'mysql_datetime',
      timezoneStatus: 'UNVERIFIED',
      sourceTimezone: 'UNVERIFIED',
      calculationTimezone: 'UTC',
      referenceTimeTimezone: 'UTC',
      temporalStateKnownLimitations: [],
      inputChecksum: `${cutoffTime}-input`,
      featureChecksum: `${cutoffTime}-feature`,
      labelChecksum: `${cutoffTime}-label`,
      datasetChecksum: `${cutoffTime}-dataset`,
    },
    rows: rows.map((row) => ({ ...row, cutoffTime })),
  };
}

function evaluationWithDatasets(datasets: readonly CustomerClvBacktestDataset[]) {
  return evaluateCustomerClvTwoStageCorrectionCandidates({
    datasets,
    generatedAt: '2026-08-31T20:00:00.000Z',
  });
}

function hardeningEvaluationWithDatasets(datasets: readonly CustomerClvBacktestDataset[]) {
  return evaluateCustomerClvTwoStageHardeningCandidates({
    datasets,
    generatedAt: '2026-08-31T20:00:00.000Z',
  });
}

function candidateById(report: ReturnType<typeof evaluateCustomerClvTwoStageCorrectionCandidates>, candidateId: string) {
  const found = report.candidateEvaluations.find((candidate) => candidate.candidateId === candidateId);
  expect(found).toBeDefined();
  return found!;
}

describe('customer CLV two-stage correction candidates', () => {
  it('keeps activity recalibration cutoff-safe when evaluation labels change', () => {
    const training = dataset(
      '2023-01-01T00:00:00.000Z',
      [
        example({ customerId: 1, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
        example({ customerId: 2, labels: { futureRevenueTaxIncl: '200000.000000', futureValidOrderCount: 1 } }),
        example({ customerId: 3, features: { ...example().features, daysSinceLastOrder: 800, revenue365d: '0.000000', orders365d: 0 }, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
      ],
      '2024-01-01T00:00:00.000Z',
    );

    const left = evaluationWithDatasets([
      training,
      dataset('2024-01-01T00:00:00.000Z', [example({ customerId: 10, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } })], '2025-01-01T00:00:00.000Z'),
    ]);
    const right = evaluationWithDatasets([
      training,
      dataset('2024-01-01T00:00:00.000Z', [example({ customerId: 10, labels: { futureRevenueTaxIncl: '999999.000000', futureValidOrderCount: 1 } })], '2025-01-01T00:00:00.000Z'),
    ]);

    expect(candidateById(left, 'two-stage-cohort-a04-band-calibrated-v1').cutoffResults[0]!.modelChecksum).toBe(
      candidateById(right, 'two-stage-cohort-a04-band-calibrated-v1').cutoffResults[0]!.modelChecksum,
    );
    expect(
      candidateById(left, 'two-stage-cohort-a04-band-calibrated-v1').topCustomerSanityCheck.map((row) => ({
        customerId: row.customerId,
        activityProbability: row.activityProbability,
        expectedRevenueGivenActiveTaxIncl: row.expectedRevenueGivenActiveTaxIncl,
        expectedRevenueTaxIncl: row.expectedRevenueTaxIncl,
      })),
    ).toEqual(
      candidateById(right, 'two-stage-cohort-a04-band-calibrated-v1').topCustomerSanityCheck.map((row) => ({
        customerId: row.customerId,
        activityProbability: row.activityProbability,
        expectedRevenueGivenActiveTaxIncl: row.expectedRevenueGivenActiveTaxIncl,
        expectedRevenueTaxIncl: row.expectedRevenueTaxIncl,
      })),
    );
  });

  it('keeps calibrated activity probabilities inside [0,1]', () => {
    const report = evaluationWithDatasets([
      dataset(
        '2023-01-01T00:00:00.000Z',
        [
          example({ customerId: 1, labels: { futureRevenueTaxIncl: '250000.000000', futureValidOrderCount: 1 } }),
          example({ customerId: 2, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
          example({ customerId: 3, features: { ...example().features, daysSinceLastOrder: 850, revenue365d: '0.000000', orders365d: 0 }, labels: { futureRevenueTaxIncl: '100000.000000', futureValidOrderCount: 1 } }),
        ],
        '2024-01-01T00:00:00.000Z',
      ),
      dataset('2024-01-01T00:00:00.000Z', [example({ customerId: 10 })], '2025-01-01T00:00:00.000Z'),
    ]);

    const candidate = candidateById(report, 'two-stage-cohort-a04-band-recency-rank25-v1');
    for (const row of candidate.topCustomerSanityCheck) {
      expect(Number(row.activityProbability)).toBeGreaterThanOrEqual(0);
      expect(Number(row.activityProbability)).toBeLessThanOrEqual(1);
    }
  });

  it('leaves conditional value unchanged when lambda is zero', () => {
    const report = evaluationWithDatasets([
      dataset(
        '2023-01-01T00:00:00.000Z',
        [
          example({ customerId: 1, features: { ...example().features, revenue365d: '500000.000000', historicalRevenueTaxIncl: '500000.000000', historicalAovTaxIncl: '166666.666667' }, labels: { futureRevenueTaxIncl: '450000.000000', futureValidOrderCount: 1 } }),
          example({ customerId: 2, features: { ...example().features, revenue365d: '900000.000000', historicalRevenueTaxIncl: '900000.000000', historicalAovTaxIncl: '300000.000000' }, labels: { futureRevenueTaxIncl: '700000.000000', futureValidOrderCount: 1 } }),
        ],
        '2024-01-01T00:00:00.000Z',
      ),
      dataset(
        '2024-01-01T00:00:00.000Z',
        [example({ customerId: 10, features: { ...example().features, revenue365d: '800000.000000', historicalRevenueTaxIncl: '800000.000000', historicalAovTaxIncl: '266666.666667' } })],
        '2025-01-01T00:00:00.000Z',
      ),
    ]);

    const original = candidateById(report, 'two-stage-cohort-a04-original-v1');
    const calibratedOnly = candidateById(report, 'two-stage-cohort-a04-band-calibrated-v1');
    expect(calibratedOnly.topCustomerSanityCheck[0]!.expectedRevenueGivenActiveTaxIncl).toBe(
      original.topCustomerSanityCheck[0]!.expectedRevenueGivenActiveTaxIncl,
    );
  });

  it('keeps zero revenue365d customers above zero when the cohort supports future value', () => {
    const staleTrainingTemplate = example({
      features: {
        ...example().features,
        historicalValidOrderCount: 1,
        historicalRevenueTaxIncl: '120000.000000',
        historicalAovTaxIncl: '120000.000000',
        daysSinceLastOrder: 820,
        revenue90d: '0.000000',
        revenue180d: '0.000000',
        revenue365d: '0.000000',
        orders90d: 0,
        orders180d: 0,
        orders365d: 0,
      },
      observationMetadata: { ...example().observationMetadata, historicalValidOrderCount: 1 },
    });
    const report = evaluationWithDatasets([
      dataset(
        '2023-01-01T00:00:00.000Z',
        [
          { ...staleTrainingTemplate, customerId: 1, labels: { futureRevenueTaxIncl: '180000.000000', futureValidOrderCount: 1 } },
          { ...staleTrainingTemplate, customerId: 2, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } },
          { ...staleTrainingTemplate, customerId: 3, labels: { futureRevenueTaxIncl: '120000.000000', futureValidOrderCount: 1 } },
        ],
        '2024-01-01T00:00:00.000Z',
      ),
      dataset(
        '2024-01-01T00:00:00.000Z',
        [{ ...staleTrainingTemplate, customerId: 10, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }],
        '2025-01-01T00:00:00.000Z',
      ),
    ]);

    const candidate = candidateById(report, 'two-stage-cohort-a04-band-recency-rank25-v1');
    const row = candidate.topCustomerSanityCheck.find((entry) => entry.customerId === 10)!;
    expect(Number(row.activityProbability)).toBeGreaterThan(0);
    expect(Number(row.expectedRevenueGivenActiveTaxIncl)).toBeGreaterThan(0);
    expect(Number(row.expectedRevenueTaxIncl)).toBeGreaterThan(0);
  });

  it('reduces top-end ties with within-cohort rank refinement', () => {
    const report = evaluationWithDatasets([
      dataset(
        '2023-01-01T00:00:00.000Z',
        [
          example({ customerId: 1, features: { ...example().features, revenue365d: '500000.000000', historicalRevenueTaxIncl: '500000.000000' }, labels: { futureRevenueTaxIncl: '300000.000000', futureValidOrderCount: 1 } }),
          example({ customerId: 2, features: { ...example().features, revenue365d: '1100000.000000', historicalRevenueTaxIncl: '1100000.000000' }, labels: { futureRevenueTaxIncl: '750000.000000', futureValidOrderCount: 1 } }),
          example({ customerId: 3, features: { ...example().features, revenue365d: '1400000.000000', historicalRevenueTaxIncl: '1400000.000000' }, labels: { futureRevenueTaxIncl: '950000.000000', futureValidOrderCount: 1 } }),
          example({ customerId: 4, features: { ...example().features, revenue365d: '600000.000000', historicalRevenueTaxIncl: '600000.000000' }, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
        ],
        '2024-01-01T00:00:00.000Z',
      ),
      dataset(
        '2024-01-01T00:00:00.000Z',
        [
          example({ customerId: 10, features: { ...example().features, revenue365d: '500000.000000', historicalRevenueTaxIncl: '500000.000000' } }),
          example({ customerId: 11, features: { ...example().features, revenue365d: '900000.000000', historicalRevenueTaxIncl: '900000.000000' } }),
          example({ customerId: 12, features: { ...example().features, revenue365d: '1300000.000000', historicalRevenueTaxIncl: '1300000.000000' } }),
        ],
        '2025-01-01T00:00:00.000Z',
      ),
    ]);

    const original = candidateById(report, 'two-stage-cohort-a04-original-v1');
    const corrected = candidateById(report, 'two-stage-cohort-a04-band-recency-rank25-v1');
    expect(Number(corrected.tieDiagnostics.sharedPredictionRate)).toBeLessThan(Number(original.tieDiagnostics.sharedPredictionRate));
    expect(new Set(corrected.topCustomerSanityCheck.map((row) => row.expectedRevenueTaxIncl)).size).toBeGreaterThan(
      new Set(original.topCustomerSanityCheck.map((row) => row.expectedRevenueTaxIncl)).size,
    );
  });

  it('is deterministic under input permutation', () => {
    const trainingRows = [
      example({ customerId: 1, features: { ...example().features, revenue365d: '600000.000000', historicalRevenueTaxIncl: '600000.000000' }, labels: { futureRevenueTaxIncl: '400000.000000', futureValidOrderCount: 1 } }),
      example({ customerId: 2, features: { ...example().features, revenue365d: '0.000000', historicalRevenueTaxIncl: '120000.000000', orders365d: 0 }, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
      example({ customerId: 3, features: { ...example().features, daysSinceLastOrder: 780, revenue365d: '0.000000', historicalRevenueTaxIncl: '120000.000000', orders365d: 0 }, labels: { futureRevenueTaxIncl: '150000.000000', futureValidOrderCount: 1 } }),
    ];
    const evaluationRows = [
      example({ customerId: 10, features: { ...example().features, revenue365d: '500000.000000', historicalRevenueTaxIncl: '500000.000000' } }),
      example({ customerId: 11, features: { ...example().features, daysSinceLastOrder: 820, revenue365d: '0.000000', historicalRevenueTaxIncl: '120000.000000', orders365d: 0 } }),
    ];

    const left = evaluationWithDatasets([
      dataset('2023-01-01T00:00:00.000Z', trainingRows, '2024-01-01T00:00:00.000Z'),
      dataset('2024-01-01T00:00:00.000Z', evaluationRows, '2025-01-01T00:00:00.000Z'),
    ]);
    const right = evaluationWithDatasets([
      dataset('2023-01-01T00:00:00.000Z', [trainingRows[2]!, trainingRows[0]!, trainingRows[1]!], '2024-01-01T00:00:00.000Z'),
      dataset('2024-01-01T00:00:00.000Z', [evaluationRows[1]!, evaluationRows[0]!], '2025-01-01T00:00:00.000Z'),
    ]);

    expect(left).toEqual(right);
  });

  it('adds scale-aware reliability metrics', () => {
    const report = evaluationWithDatasets([
      dataset(
        '2023-01-01T00:00:00.000Z',
        [
          example({ customerId: 1, labels: { futureRevenueTaxIncl: '300000.000000', futureValidOrderCount: 1 } }),
          example({ customerId: 2, features: { ...example().features, daysSinceLastOrder: 820, revenue365d: '0.000000', orders365d: 0 }, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
          example({ customerId: 3, features: { ...example().features, historicalValidOrderCount: 5, revenue365d: '900000.000000', historicalRevenueTaxIncl: '900000.000000', daysSinceLastOrder: 15, customerTenureDays: 900 }, observationMetadata: { ...example().observationMetadata, historicalValidOrderCount: 5, historyDays: 900 }, labels: { futureRevenueTaxIncl: '700000.000000', futureValidOrderCount: 2 } }),
        ],
        '2024-01-01T00:00:00.000Z',
      ),
      dataset(
        '2024-01-01T00:00:00.000Z',
        [
          example({ customerId: 10 }),
          example({ customerId: 11, features: { ...example().features, daysSinceLastOrder: 820, revenue365d: '0.000000', orders365d: 0 } }),
          example({ customerId: 12, features: { ...example().features, historicalValidOrderCount: 5, revenue365d: '1000000.000000', historicalRevenueTaxIncl: '1000000.000000', daysSinceLastOrder: 15, customerTenureDays: 900 }, observationMetadata: { ...example().observationMetadata, historicalValidOrderCount: 5, historyDays: 900 } }),
        ],
        '2025-01-01T00:00:00.000Z',
      ),
    ]);

    const candidate = candidateById(report, 'two-stage-cohort-a04-band-recency-rank50-refined-v1');
    for (const row of candidate.reliabilityResults) {
      expect(row.normalizedAbsoluteError).not.toBeNull();
      expect(row.medianNormalizedAbsoluteError).not.toBeNull();
    }
  });

  it('uses a stale-parent recalibration hierarchy without forcing stale customers to zero', () => {
    const staleTemplate = example({
      features: {
        ...example().features,
        historicalValidOrderCount: 1,
        historicalRevenueTaxIncl: '120000.000000',
        historicalAovTaxIncl: '120000.000000',
        daysSinceLastOrder: 820,
        revenue90d: '0.000000',
        revenue180d: '0.000000',
        revenue365d: '0.000000',
        orders90d: 0,
        orders180d: 0,
        orders365d: 0,
      },
      observationMetadata: { ...example().observationMetadata, historicalValidOrderCount: 1 },
    });
    const report = hardeningEvaluationWithDatasets([
      dataset(
        '2023-01-01T00:00:00.000Z',
        [
          { ...staleTemplate, customerId: 1, labels: { futureRevenueTaxIncl: '140000.000000', futureValidOrderCount: 1 } },
          { ...staleTemplate, customerId: 2, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } },
          example({ customerId: 3, labels: { futureRevenueTaxIncl: '300000.000000', futureValidOrderCount: 1 } }),
        ],
        '2024-01-01T00:00:00.000Z',
      ),
      dataset(
        '2023-07-01T00:00:00.000Z',
        [
          { ...staleTemplate, customerId: 11, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } },
          { ...staleTemplate, customerId: 12, labels: { futureRevenueTaxIncl: '100000.000000', futureValidOrderCount: 1 } },
          example({ customerId: 13, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
        ],
        '2024-07-01T00:00:00.000Z',
      ),
      dataset(
        '2024-01-01T00:00:00.000Z',
        [{ ...staleTemplate, customerId: 20, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }],
        '2025-01-01T00:00:00.000Z',
      ),
    ]);

    const candidate = report.candidateEvaluations.find((row) => row.candidateId === 'two-stage-cohort-a04-2-stale-support-recent2-v1')!;
    expect(candidate.activityRecalibration.strategy).toBe('probability_band_stale_parent');
    const row = candidate.topCustomerSanityCheck.find((entry) => entry.customerId === 20)!;
    expect(Number(row.activityProbability)).toBeGreaterThan(0);
    expect(Number(row.expectedRevenueTaxIncl)).toBeGreaterThan(0);
  });

  it('keeps recent-customer structure intact under A04.2 hardening', () => {
    const report = hardeningEvaluationWithDatasets([
      dataset(
        '2023-01-01T00:00:00.000Z',
        [
          example({ customerId: 1, features: { ...example().features, daysSinceLastOrder: 20 }, labels: { futureRevenueTaxIncl: '300000.000000', futureValidOrderCount: 1 } }),
          example({ customerId: 2, features: { ...example().features, daysSinceLastOrder: 120 }, labels: { futureRevenueTaxIncl: '120000.000000', futureValidOrderCount: 1 } }),
          example({ customerId: 3, features: { ...example().features, daysSinceLastOrder: 820, revenue365d: '0.000000', orders365d: 0 }, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
        ],
        '2024-01-01T00:00:00.000Z',
      ),
      dataset(
        '2024-01-01T00:00:00.000Z',
        [
          example({ customerId: 10, features: { ...example().features, daysSinceLastOrder: 20 } }),
          example({ customerId: 11, features: { ...example().features, daysSinceLastOrder: 120 } }),
          example({ customerId: 12, features: { ...example().features, daysSinceLastOrder: 820, revenue365d: '0.000000', orders365d: 0 } }),
        ],
        '2025-01-01T00:00:00.000Z',
      ),
    ]);

    const candidate = report.selectedCandidate;
    const recencyAudit = candidate.cutoffResults[0]!.recencyAudit;
    expect(recencyAudit.find((row) => row.bucket === '0-180d')).toBeDefined();
    const ranked = [...candidate.topCustomerSanityCheck].sort((left, right) => left.customerId - right.customerId);
    expect(Number(ranked[0]!.activityProbability)).toBeGreaterThan(Number(ranked[2]!.activityProbability));
    expect(Number(ranked[1]!.activityProbability)).toBeGreaterThan(Number(ranked[2]!.activityProbability));
  });

  it('prevents invalid HIGH support semantics in the hardened candidate', () => {
    const report = hardeningEvaluationWithDatasets([
      dataset(
        '2023-01-01T00:00:00.000Z',
        [
          example({ customerId: 1, labels: { futureRevenueTaxIncl: '400000.000000', futureValidOrderCount: 1 } }),
          example({ customerId: 2, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
          example({ customerId: 3, features: { ...example().features, daysSinceLastOrder: 820, revenue365d: '0.000000', orders365d: 0 }, labels: { futureRevenueTaxIncl: '150000.000000', futureValidOrderCount: 1 } }),
        ],
        '2024-01-01T00:00:00.000Z',
      ),
      dataset(
        '2023-07-01T00:00:00.000Z',
        [
          example({ customerId: 21, labels: { futureRevenueTaxIncl: '250000.000000', futureValidOrderCount: 1 } }),
          example({ customerId: 22, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
          example({ customerId: 23, features: { ...example().features, daysSinceLastOrder: 820, revenue365d: '0.000000', orders365d: 0 }, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
        ],
        '2024-07-01T00:00:00.000Z',
      ),
      dataset(
        '2024-01-01T00:00:00.000Z',
        [
          example({ customerId: 30 }),
          example({ customerId: 31, features: { ...example().features, daysSinceLastOrder: 820, revenue365d: '0.000000', orders365d: 0 } }),
        ],
        '2025-01-01T00:00:00.000Z',
      ),
    ]);

    expect(report.selectedCandidate.reliabilityResults.find((row) => row.reliabilityBucket === 'HIGH')).toBeUndefined();
    const customerReliability = new Map(report.selectedCandidate.topCustomerSanityCheck.map((row) => [row.customerId, row.reliabilityBucket]));
    expect(customerReliability.get(31)).toBe('LOW');
  });

  it('emits a deterministic frozen candidate descriptor', () => {
    const datasets = [
      dataset(
        '2023-01-01T00:00:00.000Z',
        [
          example({ customerId: 1, labels: { futureRevenueTaxIncl: '300000.000000', futureValidOrderCount: 1 } }),
          example({ customerId: 2, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
          example({ customerId: 3, features: { ...example().features, daysSinceLastOrder: 820, revenue365d: '0.000000', orders365d: 0 }, labels: { futureRevenueTaxIncl: '100000.000000', futureValidOrderCount: 1 } }),
        ],
        '2024-01-01T00:00:00.000Z',
      ),
      dataset(
        '2023-07-01T00:00:00.000Z',
        [
          example({ customerId: 11, labels: { futureRevenueTaxIncl: '250000.000000', futureValidOrderCount: 1 } }),
          example({ customerId: 12, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
          example({ customerId: 13, features: { ...example().features, daysSinceLastOrder: 820, revenue365d: '0.000000', orders365d: 0 }, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
        ],
        '2024-07-01T00:00:00.000Z',
      ),
      dataset('2024-01-01T00:00:00.000Z', [example({ customerId: 20 })], '2025-01-01T00:00:00.000Z'),
    ] as const;

    const left = hardeningEvaluationWithDatasets(datasets);
    const right = hardeningEvaluationWithDatasets([datasets[1]!, datasets[0]!, datasets[2]!]);
    expect(left.frozenCandidateDescriptor).toEqual(right.frozenCandidateDescriptor);
  });
});
