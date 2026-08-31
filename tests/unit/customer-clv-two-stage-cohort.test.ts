import { describe, expect, it } from 'vitest';
import type { CustomerClvBacktestDataset, CustomerClvBacktestExample } from '../../src/domain/customer-clv/dataset.js';
import {
  CUSTOMER_CLV_MODEL_VERSION,
  evaluateCustomerClvTwoStageCandidates,
  type CustomerClvTwoStageCandidateEvaluation,
} from '../../src/domain/customer-clv/index.js';

function example(overrides: Partial<CustomerClvBacktestExample> = {}): CustomerClvBacktestExample {
  return {
    customerId: 1,
    cutoffTime: '2024-01-01T00:00:00.000Z',
    features: {
      historicalValidOrderCount: 1,
      historicalRevenueTaxIncl: '120.000000',
      historicalAovTaxIncl: '120.000000',
      firstValidOrderAt: '2023-01-01T00:00:00.000Z',
      lastValidOrderAt: '2023-12-01T00:00:00.000Z',
      customerTenureDays: 365,
      daysSinceLastOrder: 31,
      purchaseFrequencyDays: null,
      orders90d: 1,
      orders180d: 1,
      orders365d: 1,
      revenue90d: '120.000000',
      revenue180d: '120.000000',
      revenue365d: '120.000000',
      distinctPurchaseMonths: 1,
      cancellationRatio: '0.000000',
      discountShare: '0.000000',
      shippingShare: '0.000000',
      distinctProductCount: 1,
      repeatProductRate: '0.000000',
      productConcentration: '1.000000',
    },
    labels: {
      futureRevenueTaxIncl: '100.000000',
      futureValidOrderCount: 1,
    },
    observationMetadata: {
      historyStart: '2023-01-01T00:00:00.000Z',
      firstValidOrderAt: '2023-01-01T00:00:00.000Z',
      lastValidOrderAt: '2023-12-01T00:00:00.000Z',
      historicalValidOrderCount: 1,
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
  return evaluateCustomerClvTwoStageCandidates({
    datasets,
    generatedAt: '2026-08-31T20:00:00.000Z',
  });
}

function candidateById(report: ReturnType<typeof evaluateCustomerClvTwoStageCandidates>, candidateId: string): CustomerClvTwoStageCandidateEvaluation {
  const found = report.candidateEvaluations.find((candidate) => candidate.candidateId === candidateId);
  expect(found).toBeDefined();
  return found!;
}

describe('customer CLV two-stage cohort model', () => {
  it('pins the CLV model version to the explicit two-stage methodology', () => {
    expect(CUSTOMER_CLV_MODEL_VERSION).toBe('customer-clv-two-stage-cohort-v1');
  });

  it('multiplies activity probability by expected active revenue to form the final prediction', () => {
    const report = evaluationWithDatasets([
      dataset(
        '2023-01-01T00:00:00.000Z',
        [
          example({ customerId: 1, labels: { futureRevenueTaxIncl: '100.000000', futureValidOrderCount: 1 } }),
          example({ customerId: 2, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
        ],
        '2024-01-01T00:00:00.000Z',
      ),
      dataset(
        '2024-01-01T00:00:00.000Z',
        [example({ customerId: 10, labels: { futureRevenueTaxIncl: '40.000000', futureValidOrderCount: 1 } })],
        '2025-01-01T00:00:00.000Z',
      ),
    ]);

    const sample = report.selectedCandidate.topCustomerSanityCheck[0]!;
    const combined = Number(sample.activityProbability) * Number(sample.expectedRevenueGivenActiveTaxIncl);
    expect(Number(sample.expectedRevenueTaxIncl)).toBeCloseTo(combined, 5);
  });

  it('shrinks stale customers to low but non-zero activity when evidence exists', () => {
    const stale = example({
      customerId: 10,
      features: { ...example().features, daysSinceLastOrder: 900, revenue365d: '0.000000', orders365d: 0, revenue90d: '0.000000', revenue180d: '0.000000' },
      labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 },
    });
    const report = evaluationWithDatasets([
      dataset(
        '2023-01-01T00:00:00.000Z',
        [
          example({ customerId: 1, features: { ...example().features, daysSinceLastOrder: 850, revenue365d: '0.000000', orders365d: 0 }, labels: { futureRevenueTaxIncl: '50.000000', futureValidOrderCount: 1 } }),
          example({ customerId: 2, features: { ...example().features, daysSinceLastOrder: 870, revenue365d: '0.000000', orders365d: 0 }, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
          example({ customerId: 3, features: { ...example().features, daysSinceLastOrder: 40 }, labels: { futureRevenueTaxIncl: '90.000000', futureValidOrderCount: 1 } }),
        ],
        '2024-01-01T00:00:00.000Z',
      ),
      dataset('2024-01-01T00:00:00.000Z', [stale], '2025-01-01T00:00:00.000Z'),
    ]);

    const sample = report.selectedCandidate.topCustomerSanityCheck[0]!;
    expect(Number(sample.activityProbability)).toBeGreaterThan(0);
    expect(Number(sample.expectedRevenueTaxIncl)).toBeGreaterThan(0);
  });

  it('differentiates one-order customers by recency', () => {
    const report = evaluationWithDatasets([
      dataset(
        '2023-01-01T00:00:00.000Z',
        [
          example({ customerId: 1, features: { ...example().features, daysSinceLastOrder: 20 }, labels: { futureRevenueTaxIncl: '100.000000', futureValidOrderCount: 1 } }),
          example({ customerId: 2, features: { ...example().features, daysSinceLastOrder: 750, revenue365d: '0.000000', orders365d: 0 }, labels: { futureRevenueTaxIncl: '30.000000', futureValidOrderCount: 1 } }),
          example({ customerId: 3, features: { ...example().features, daysSinceLastOrder: 760, revenue365d: '0.000000', orders365d: 0 }, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
        ],
        '2024-01-01T00:00:00.000Z',
      ),
      dataset(
        '2024-01-01T00:00:00.000Z',
        [
          example({ customerId: 10, features: { ...example().features, daysSinceLastOrder: 20 } }),
          example({ customerId: 11, features: { ...example().features, daysSinceLastOrder: 760, revenue365d: '0.000000', orders365d: 0 } }),
        ],
        '2025-01-01T00:00:00.000Z',
      ),
    ]);

    const sanity = [...report.selectedCandidate.topCustomerSanityCheck].sort((left, right) => left.customerId - right.customerId);
    expect(Number(sanity[0]!.expectedRevenueTaxIncl)).toBeGreaterThan(Number(sanity[1]!.expectedRevenueTaxIncl));
  });

  it('uses the recent-activity candidate to reduce stale prior inflation when recent cutoffs cool down', () => {
    const report = evaluationWithDatasets([
      dataset(
        '2023-01-01T00:00:00.000Z',
        Array.from({ length: 10 }, (_, index) =>
          example({ customerId: index + 1, labels: { futureRevenueTaxIncl: '100.000000', futureValidOrderCount: 1 } }),
        ),
        '2024-01-01T00:00:00.000Z',
      ),
      dataset(
        '2023-07-01T00:00:00.000Z',
        Array.from({ length: 10 }, (_, index) =>
          example({ customerId: index + 101, labels: { futureRevenueTaxIncl: '80.000000', futureValidOrderCount: 1 } }),
        ),
        '2024-07-01T00:00:00.000Z',
      ),
      dataset(
        '2024-01-01T00:00:00.000Z',
        [
          ...Array.from({ length: 9 }, (_, index) =>
            example({ customerId: index + 201, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
          ),
          example({ customerId: 210, labels: { futureRevenueTaxIncl: '60.000000', futureValidOrderCount: 1 } }),
        ],
        '2025-01-01T00:00:00.000Z',
      ),
      dataset(
        '2025-01-01T00:00:00.000Z',
        [example({ customerId: 999, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } })],
        '2026-01-01T00:00:00.000Z',
      ),
    ]);

    const allHistory = candidateById(report, 'two-stage-cohort-all-cutoffs-order-recency-value-v1');
    const recentActivity = candidateById(report, 'two-stage-cohort-recent-activity-order-recency-value-v1');
    expect(Number(recentActivity.overallActivityMetrics.predictedActivityRate!)).toBeLessThan(
      Number(allHistory.overallActivityMetrics.predictedActivityRate!),
    );
  });

  it('is deterministic under training and evaluation row permutation', () => {
    const trainingRows = [
      example({ customerId: 1, labels: { futureRevenueTaxIncl: '100.000000', futureValidOrderCount: 1 } }),
      example({ customerId: 2, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
      example({ customerId: 3, labels: { futureRevenueTaxIncl: '60.000000', futureValidOrderCount: 1 } }),
    ];
    const evaluationRows = [
      example({ customerId: 10, labels: { futureRevenueTaxIncl: '40.000000', futureValidOrderCount: 1 } }),
      example({ customerId: 11, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
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

  it('changing evaluation labels does not alter the fitted model checksum', () => {
    const baseDatasets = [
      dataset(
        '2023-01-01T00:00:00.000Z',
        [
          example({ customerId: 1, labels: { futureRevenueTaxIncl: '100.000000', futureValidOrderCount: 1 } }),
          example({ customerId: 2, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
        ],
        '2024-01-01T00:00:00.000Z',
      ),
    ];
    const left = evaluateCustomerClvTwoStageCandidates({
      datasets: [
        ...baseDatasets,
        dataset('2024-01-01T00:00:00.000Z', [example({ customerId: 10, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } })], '2025-01-01T00:00:00.000Z'),
      ],
      generatedAt: '2026-08-31T20:00:00.000Z',
    });
    const right = evaluateCustomerClvTwoStageCandidates({
      datasets: [
        ...baseDatasets,
        dataset('2024-01-01T00:00:00.000Z', [example({ customerId: 10, labels: { futureRevenueTaxIncl: '9999.000000', futureValidOrderCount: 1 } })], '2025-01-01T00:00:00.000Z'),
      ],
      generatedAt: '2026-08-31T20:00:00.000Z',
    });

    expect(left.selectedCandidate.cutoffResults[0]!.modelChecksum).toBe(right.selectedCandidate.cutoffResults[0]!.modelChecksum);
  });

  it('keeps strong support customers out of LOW and still marks stale weak-support customers as LOW', () => {
    const repeatTemplate = example({
      features: { ...example().features, historicalValidOrderCount: 5, historicalRevenueTaxIncl: '600.000000', historicalAovTaxIncl: '120.000000', revenue365d: '600.000000', orders365d: 5, daysSinceLastOrder: 20, customerTenureDays: 900 },
      observationMetadata: { ...example().observationMetadata, historicalValidOrderCount: 5, historyDays: 900 },
    });
    const firstTrainingRows = [
      ...Array.from({ length: 180 }, (_, index) =>
        ({
          ...repeatTemplate,
          customerId: index + 1,
          labels: { futureRevenueTaxIncl: '400.000000', futureValidOrderCount: 2 },
        }) satisfies CustomerClvBacktestExample,
      ),
      ...Array.from({ length: 120 }, (_, index) =>
        ({
          ...repeatTemplate,
          customerId: index + 1000,
          features: { ...repeatTemplate.features, historicalValidOrderCount: 1, daysSinceLastOrder: 850, revenue365d: '0.000000', orders365d: 0, historicalRevenueTaxIncl: '120.000000', historicalAovTaxIncl: '120.000000', customerTenureDays: 365 },
          observationMetadata: { ...repeatTemplate.observationMetadata, historicalValidOrderCount: 1, historyDays: 365 },
          labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 },
        }) satisfies CustomerClvBacktestExample,
      ),
    ];
    const secondTrainingRows = [
      ...Array.from({ length: 180 }, (_, index) =>
        ({
          ...repeatTemplate,
          customerId: index + 5000,
          cutoffTime: '2023-07-01T00:00:00.000Z',
          labels: { futureRevenueTaxIncl: '380.000000', futureValidOrderCount: 2 },
        }) satisfies CustomerClvBacktestExample,
      ),
      ...Array.from({ length: 120 }, (_, index) =>
        ({
          ...repeatTemplate,
          customerId: index + 7000,
          cutoffTime: '2023-07-01T00:00:00.000Z',
          features: { ...repeatTemplate.features, historicalValidOrderCount: 1, daysSinceLastOrder: 850, revenue365d: '0.000000', orders365d: 0, historicalRevenueTaxIncl: '120.000000', historicalAovTaxIncl: '120.000000', customerTenureDays: 365 },
          observationMetadata: { ...repeatTemplate.observationMetadata, historicalValidOrderCount: 1, historyDays: 365 },
          labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 },
        }) satisfies CustomerClvBacktestExample,
      ),
    ];
    const report = evaluationWithDatasets([
      dataset('2023-01-01T00:00:00.000Z', firstTrainingRows, '2024-01-01T00:00:00.000Z'),
      dataset('2023-07-01T00:00:00.000Z', secondTrainingRows, '2024-07-01T00:00:00.000Z'),
      dataset(
        '2024-07-01T00:00:00.000Z',
        [
          { ...repeatTemplate, customerId: 10000, cutoffTime: '2024-07-01T00:00:00.000Z' },
          example({ customerId: 10001, cutoffTime: '2024-07-01T00:00:00.000Z', features: { ...example().features, daysSinceLastOrder: 850, revenue365d: '0.000000', orders365d: 0 }, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
        ],
        '2025-07-01T00:00:00.000Z',
      ),
    ]);

    const byCustomer = new Map(report.selectedCandidate.topCustomerSanityCheck.map((row) => [row.customerId, row]));
    expect(byCustomer.get(10000)?.reliabilityBucket).toBe('MEDIUM');
    expect(byCustomer.get(10001)?.reliabilityBucket).toBe('LOW');
  });
});
