import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CustomerClvBacktestDataset, CustomerClvBacktestExample } from '../../src/domain/customer-clv/dataset.js';
import {
  assertTrainingDatasetsMatureForEvaluation,
  evaluateCustomerClvRollingOrigin,
} from '../../src/domain/customer-clv/index.js';

function example(overrides: Partial<CustomerClvBacktestExample> = {}): CustomerClvBacktestExample {
  return {
    customerId: 1,
    cutoffTime: '2024-01-01T00:00:00.000Z',
    features: {
      historicalValidOrderCount: 2,
      historicalRevenueTaxIncl: '120.000000',
      historicalAovTaxIncl: '60.000000',
      firstValidOrderAt: '2023-01-01T00:00:00.000Z',
      lastValidOrderAt: '2023-12-01T00:00:00.000Z',
      customerTenureDays: 730,
      daysSinceLastOrder: 31,
      purchaseFrequencyDays: '334.000000',
      orders90d: 1,
      orders180d: 1,
      orders365d: 2,
      revenue90d: '60.000000',
      revenue180d: '60.000000',
      revenue365d: '120.000000',
      distinctPurchaseMonths: 2,
      cancellationRatio: '0.000000',
      discountShare: '0.000000',
      shippingShare: '0.000000',
      distinctProductCount: 2,
      repeatProductRate: '0.500000',
      productConcentration: '0.500000',
    },
    labels: {
      futureRevenueTaxIncl: '100.000000',
      futureValidOrderCount: 1,
    },
    observationMetadata: {
      historyStart: '2022-01-01T00:00:00.000Z',
      firstValidOrderAt: '2023-01-01T00:00:00.000Z',
      lastValidOrderAt: '2023-12-01T00:00:00.000Z',
      historicalValidOrderCount: 2,
      historyDays: 730,
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
      availableDataThrough: '2026-08-30T16:13:13.000Z',
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

function evaluateSingleModel(
  modelId:
    | 'global-mean-v1'
    | 'global-activity-x-conditional-mean-v1'
    | 'historical-12m-revenue-v1'
    | 'lifetime-monthly-rate-shrunk-v1'
    | 'aov-x-order-rate-v1'
    | 'recency-adjusted-projection-v1'
    | 'cutoff-safe-rfm-bucket-median-v1'
    | 'simple-cohort-prior-v1',
  trainingRows: readonly CustomerClvBacktestExample[],
  evaluationRows: readonly CustomerClvBacktestExample[],
  options: Partial<{ trainingCutoff: string; trainingLabelEnd: string; evaluationCutoff: string; evaluationLabelEnd: string }> = {},
) {
  const trainingCutoff = options.trainingCutoff ?? '2023-01-01T00:00:00.000Z';
  const evaluationCutoff = options.evaluationCutoff ?? '2024-01-01T00:00:00.000Z';
  const report = evaluateCustomerClvRollingOrigin({
    datasets: [
      dataset(trainingCutoff, trainingRows, options.trainingLabelEnd ?? evaluationCutoff),
      dataset(evaluationCutoff, evaluationRows, options.evaluationLabelEnd ?? '2025-01-01T00:00:00.000Z'),
    ],
    generatedAt: '2026-08-30T20:00:00.000Z',
    evaluationCutoff,
    modelIds: [modelId],
  });
  return report.models[0]!;
}

describe('customer CLV baselines and rolling-origin harness', () => {
  it('global mean baseline predicts the training mean exactly', () => {
    const model = evaluateSingleModel(
      'global-mean-v1',
      [
        example({ customerId: 1, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
        example({ customerId: 2, labels: { futureRevenueTaxIncl: '100.000000', futureValidOrderCount: 1 } }),
        example({ customerId: 3, labels: { futureRevenueTaxIncl: '200.000000', futureValidOrderCount: 1 } }),
      ],
      [example({ customerId: 10, labels: { futureRevenueTaxIncl: '75.000000', futureValidOrderCount: 1 } })],
    );

    expect(model.cutoffResults[0]!.revenueMetrics.meanPrediction).toBe('100.000000');
  });

  it('activity x conditional value baseline matches P(active) x E[value | active] from training only', () => {
    const model = evaluateSingleModel(
      'global-activity-x-conditional-mean-v1',
      [
        example({ customerId: 1, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
        example({ customerId: 2, labels: { futureRevenueTaxIncl: '100.000000', futureValidOrderCount: 1 } }),
        example({ customerId: 3, labels: { futureRevenueTaxIncl: '200.000000', futureValidOrderCount: 1 } }),
      ],
      [example({ customerId: 10, labels: { futureRevenueTaxIncl: '75.000000', futureValidOrderCount: 1 } })],
    );

    expect(model.cutoffResults[0]!.revenueMetrics.meanPrediction).toBe('100.000050');
    expect(model.cutoffResults[0]!.activityMetrics.brierScore).not.toBeNull();
  });

  it('historical 12m revenue baseline uses cutoff-safe revenue365d', () => {
    const model = evaluateSingleModel(
      'historical-12m-revenue-v1',
      [example()],
      [example({ customerId: 10, features: { ...example().features, revenue365d: '345.000000' } })],
    );

    expect(model.cutoffResults[0]!.revenueMetrics.meanPrediction).toBe('345.000000');
  });

  it('lifetime monthly rate baseline applies the sparse-tenure shrinkage guard', () => {
    const model = evaluateSingleModel(
      'lifetime-monthly-rate-shrunk-v1',
      [
        example({
          customerId: 1,
          features: { ...example().features, historicalRevenueTaxIncl: '1200.000000' },
          observationMetadata: { ...example().observationMetadata, historyDays: 365 },
        }),
      ],
      [
        example({
          customerId: 10,
          features: { ...example().features, historicalRevenueTaxIncl: '1200.000000' },
          observationMetadata: { ...example().observationMetadata, historyDays: 30 },
        }),
      ],
    );

    expect(Number(model.cutoffResults[0]!.revenueMetrics.meanPrediction)).toBeCloseTo(3092.769441, 5);
  });

  it('AOV x order-rate baseline uses shrinkage for sparse histories', () => {
    const model = evaluateSingleModel(
      'aov-x-order-rate-v1',
      [
        example({
          customerId: 1,
          features: { ...example().features, historicalValidOrderCount: 2, historicalAovTaxIncl: '50.000000' },
          observationMetadata: { ...example().observationMetadata, historyDays: 365 },
        }),
      ],
      [
        example({
          customerId: 10,
          features: { ...example().features, historicalValidOrderCount: 1, historicalAovTaxIncl: '120.000000' },
          observationMetadata: { ...example().observationMetadata, historyDays: 30 },
        }),
      ],
    );

    expect(Number(model.cutoffResults[0]!.revenueMetrics.meanPrediction)).toBeGreaterThan(0);
    expect(Number(model.cutoffResults[0]!.revenueMetrics.meanPrediction)).toBeLessThan(1440);
  });

  it('recency-adjusted projection is monotonic by recency for the same history', () => {
    const shared = example({ customerId: 1, features: { ...example().features, historicalRevenueTaxIncl: '1200.000000' } });
    const model = evaluateSingleModel(
      'recency-adjusted-projection-v1',
      [shared],
      [
        { ...shared, customerId: 10, features: { ...shared.features, daysSinceLastOrder: 30 } },
        { ...shared, customerId: 11, features: { ...shared.features, daysSinceLastOrder: 800 } },
      ],
    );

    const [topDecile, bottomDecile] = [model.cutoffResults[0]!.deciles[0]!, model.cutoffResults[0]!.deciles.at(-1)!];
    expect(Number(topDecile.meanPredictedRevenue!)).toBeGreaterThan(Number(bottomDecile.meanPredictedRevenue!));
  });

  it('cohort baseline falls back deterministically when exact cells are too small', () => {
    const model = evaluateSingleModel(
      'simple-cohort-prior-v1',
      [example({ customerId: 1, labels: { futureRevenueTaxIncl: '77.000000', futureValidOrderCount: 1 } })],
      [example({ customerId: 10 })],
    );

    expect(model.cutoffResults[0]!.revenueMetrics.meanPrediction).toBe('77.000000');
  });

  it('R/F/M bucket median fallback is deterministic under input permutation and tied predictions', () => {
    const training = [
      example({ customerId: 1, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
      example({ customerId: 2, labels: { futureRevenueTaxIncl: '90.000000', futureValidOrderCount: 1 } }),
      example({ customerId: 3, labels: { futureRevenueTaxIncl: '90.000000', futureValidOrderCount: 1 } }),
    ];
    const evaluationA = [
      example({ customerId: 10, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
      example({ customerId: 11, labels: { futureRevenueTaxIncl: '300.000000', futureValidOrderCount: 1 } }),
    ];
    const evaluationB = [evaluationA[1]!, evaluationA[0]!];

    const left = evaluateSingleModel('cutoff-safe-rfm-bucket-median-v1', training, evaluationA);
    const right = evaluateSingleModel('cutoff-safe-rfm-bucket-median-v1', training, evaluationB);

    expect(left).toEqual(right);
  });

  it('reports zero-target populations without inventing positive activity', () => {
    const model = evaluateSingleModel(
      'global-mean-v1',
      [example({ labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } })],
      [example({ customerId: 10, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } })],
    );

    expect(model.cutoffResults[0]!.activityMetrics.actualActivityRate).toBe('0.000000');
    expect(model.cutoffResults[0]!.revenueMetrics.calibrationRatio).toBeNull();
  });

  it('reports all-positive populations correctly', () => {
    const model = evaluateSingleModel(
      'global-activity-x-conditional-mean-v1',
      [example({ labels: { futureRevenueTaxIncl: '100.000000', futureValidOrderCount: 1 } })],
      [example({ customerId: 10, labels: { futureRevenueTaxIncl: '120.000000', futureValidOrderCount: 1 } })],
    );

    expect(model.cutoffResults[0]!.activityMetrics.actualActivityRate).toBe('1.000000');
    expect(model.cutoffResults[0]!.activityMetrics.rocAuc).toBeNull();
  });

  it('preserves outlier sensitivity reporting for a single extreme future spender', () => {
    const model = evaluateSingleModel(
      'global-mean-v1',
      [example({ labels: { futureRevenueTaxIncl: '1.000000', futureValidOrderCount: 1 } })],
      [
        example({ customerId: 10, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }),
        example({ customerId: 11, labels: { futureRevenueTaxIncl: '44579241.000000', futureValidOrderCount: 1 } }),
      ],
    );

    expect(model.outlierSensitivity.winsorizedAtActualP99.capRevenueTaxIncl).toBe('44579241.000000');
  });

  it('A. changing evaluation labels does not alter fitted baseline parameters', () => {
    const training = [example({ customerId: 1, labels: { futureRevenueTaxIncl: '100.000000', futureValidOrderCount: 1 } })];
    const evalA = [example({ customerId: 10, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } })];
    const evalB = [example({ customerId: 10, labels: { futureRevenueTaxIncl: '9999.000000', futureValidOrderCount: 1 } })];

    const left = evaluateSingleModel('global-mean-v1', training, evalA);
    const right = evaluateSingleModel('global-mean-v1', training, evalB);

    expect(left.cutoffResults[0]!.fitChecksum).toBe(right.cutoffResults[0]!.fitChecksum);
  });

  it('B. changing future labels after the evaluation cutoff does not alter predictions', () => {
    const training = [example({ customerId: 1 })];
    const evalA = [example({ customerId: 10, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } })];
    const evalB = [example({ customerId: 10, labels: { futureRevenueTaxIncl: '9999.000000', futureValidOrderCount: 1 } })];

    const left = evaluateSingleModel('historical-12m-revenue-v1', training, evalA);
    const right = evaluateSingleModel('historical-12m-revenue-v1', training, evalB);

    expect(left.cutoffResults[0]!.revenueMetrics.meanPrediction).toBe(right.cutoffResults[0]!.revenueMetrics.meanPrediction);
  });

  it('C. rejects training cutoffs whose label windows are not known by the evaluation cutoff', () => {
    expect(() =>
      assertTrainingDatasetsMatureForEvaluation(
        [dataset('2024-07-01T00:00:00.000Z', [example()], '2025-07-01T00:00:00.000Z')],
        '2025-01-01T00:00:00.000Z',
      ),
    ).toThrow(/after evaluation cutoff/);
  });

  it('D. exposes only rolling-origin evaluation metadata and marks randomSplit false', () => {
    const report = evaluateCustomerClvRollingOrigin({
      datasets: [
        dataset('2023-01-01T00:00:00.000Z', [example({ cutoffTime: '2023-01-01T00:00:00.000Z' })], '2024-01-01T00:00:00.000Z'),
        dataset('2024-01-01T00:00:00.000Z', [example({ cutoffTime: '2024-01-01T00:00:00.000Z' })], '2025-01-01T00:00:00.000Z'),
      ],
      generatedAt: '2026-08-30T20:00:00.000Z',
      modelIds: ['global-mean-v1'],
    });

    expect(report.metadata.randomSplit).toBe(false);
  });

  it('rejects empty training or evaluation datasets', () => {
    expect(() =>
      evaluateCustomerClvRollingOrigin({
        datasets: [
          dataset('2023-01-01T00:00:00.000Z', [], '2024-01-01T00:00:00.000Z'),
          dataset('2024-01-01T00:00:00.000Z', [example()], '2025-01-01T00:00:00.000Z'),
        ],
        generatedAt: '2026-08-30T20:00:00.000Z',
        modelIds: ['global-mean-v1'],
      }),
    ).toThrow(/empty cutoff populations|no evaluation cutoffs/);

    expect(() =>
      evaluateCustomerClvRollingOrigin({
        datasets: [
          dataset('2023-01-01T00:00:00.000Z', [example({ cutoffTime: '2023-01-01T00:00:00.000Z' })], '2024-01-01T00:00:00.000Z'),
          dataset('2024-01-01T00:00:00.000Z', [], '2025-01-01T00:00:00.000Z'),
        ],
        generatedAt: '2026-08-30T20:00:00.000Z',
        modelIds: ['global-mean-v1'],
      }),
    ).toThrow(/must not be empty/);
  });

  it('E. does not import current RFM snapshots, clustering snapshots, affinity snapshots or random split helpers', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'domain', 'customer-clv', 'baselines.ts'), 'utf8');
    expect(source).not.toMatch(/customer-rfm\/.*snapshot/);
    expect(source).not.toMatch(/customer-clustering/);
    expect(source).not.toMatch(/customer-commercial-affinity/);
    expect(source).not.toMatch(/trainTestSplit|shuffle/i);
  });
});
