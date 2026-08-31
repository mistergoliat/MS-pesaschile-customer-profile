import { describe, expect, it } from 'vitest';
import {
  buildCustomerClvBacktestDataset,
  buildCustomerClvCandidateBacktestCutoffs,
  CUSTOMER_CLV_BACKTEST_DATASET_VERSION,
  CUSTOMER_CLV_EXCLUDED_OPERATIONAL_CUSTOMER_IDS,
  type CustomerClvBacktestSourceOrder,
  type CustomerClvBacktestSourceOrderProduct,
} from '../../src/domain/customer-clv/index.js';

const cutoffTime = '2024-07-01T00:00:00.000Z';
const availableDataThrough = '2025-07-01T00:00:00.000Z';

function product(overrides: Partial<CustomerClvBacktestSourceOrderProduct> = {}): CustomerClvBacktestSourceOrderProduct {
  return {
    productId: 10,
    quantity: 1,
    revenueTaxIncl: '100.000000',
    ...overrides,
  };
}

function order(overrides: Partial<CustomerClvBacktestSourceOrder> = {}): CustomerClvBacktestSourceOrder {
  return {
    orderId: 1,
    customerId: 42,
    customerCreatedAt: '2023-01-01T00:00:00.000Z',
    createdAt: '2024-06-01T00:00:00.000Z',
    currentValid: true,
    currentStateId: 2,
    currencyIsoCode: 'CLP',
    totalPaidTaxIncl: '100.000000',
    totalDiscountsTaxIncl: '10.000000',
    totalShippingTaxIncl: '5.000000',
    sellerServiceRevenueTaxIncl: '0.000000',
    refundEvidence: false,
    products: [product()],
    ...overrides,
  };
}

function build(sourceOrders: readonly CustomerClvBacktestSourceOrder[], overrides: Partial<{
  cutoffTime: string;
  availableDataThrough: string;
}> = {}) {
  return buildCustomerClvBacktestDataset({
    cutoffTime: overrides.cutoffTime ?? cutoffTime,
    availableDataThrough: overrides.availableDataThrough ?? availableDataThrough,
    sourceOrders,
  });
}

describe('buildCustomerClvBacktestDataset', () => {
  it('A. uses orders before cutoff only for features', () => {
    const dataset = build([order()]);
    const row = dataset.rows[0]!;

    expect(row.features.historicalValidOrderCount).toBe(1);
    expect(row.features.historicalRevenueTaxIncl).toBe('100.000000');
    expect(row.labels.futureRevenueTaxIncl).toBe('0.000000');
    expect(row.labels.futureValidOrderCount).toBe(0);
  });

  it('B. sends an order exactly at cutoff into labels only', () => {
    const dataset = build([
      order({ orderId: 1, createdAt: '2024-06-30T23:59:59.999Z' }),
      order({ orderId: 2, createdAt: cutoffTime, totalPaidTaxIncl: '250.000000', products: [product({ revenueTaxIncl: '250.000000' })] }),
    ]);
    const row = dataset.rows[0]!;

    expect(row.features.historicalValidOrderCount).toBe(1);
    expect(row.features.lastValidOrderAt).toBe('2024-06-30T23:59:59.999Z');
    expect(row.labels.futureRevenueTaxIncl).toBe('250.000000');
    expect(row.labels.futureValidOrderCount).toBe(1);
  });

  it('C. excludes an order exactly at cutoff + 12 months', () => {
    const dataset = build([
      order(),
      order({ orderId: 2, createdAt: availableDataThrough, totalPaidTaxIncl: '999.000000', products: [product({ revenueTaxIncl: '999.000000' })] }),
    ]);
    const row = dataset.rows[0]!;

    expect(row.labels.futureRevenueTaxIncl).toBe('0.000000');
    expect(row.labels.futureValidOrderCount).toBe(0);
    expect(dataset.manifest.labelOrderCount).toBe(0);
  });

  it('D. keeps customers with no future orders as real zero-label rows', () => {
    const dataset = build([order()]);

    expect(dataset.rows).toHaveLength(1);
    expect(dataset.rows[0]!.labels).toEqual({
      futureRevenueTaxIncl: '0.000000',
      futureValidOrderCount: 0,
    });
    expect(dataset.manifest.zeroFutureOrderCustomerCount).toBe(1);
  });

  it('E. keeps one-order historical customers in population with sparse null semantics', () => {
    const dataset = build([order()]);
    const row = dataset.rows[0]!;

    expect(row.features.historicalValidOrderCount).toBe(1);
    expect(row.features.purchaseFrequencyDays).toBeNull();
    expect(dataset.manifest.singleHistoricalOrderCustomerCount).toBe(1);
  });

  it('F. excludes customers with no historical valid order before cutoff', () => {
    const dataset = build([
      order({ orderId: 1, createdAt: '2024-07-15T00:00:00.000Z' }),
      order({ orderId: 2, createdAt: '2024-06-15T00:00:00.000Z', currentValid: false }),
    ]);

    expect(dataset.rows).toEqual([]);
    expect(dataset.manifest.customerCount).toBe(0);
  });

  it('G. excludes operational customers even if the source includes them', () => {
    const operationalCustomerId = CUSTOMER_CLV_EXCLUDED_OPERATIONAL_CUSTOMER_IDS[0]!;
    const dataset = build([
      order({ customerId: operationalCustomerId }),
      order({ orderId: 2, customerId: 777 }),
    ]);

    expect(dataset.rows.map((row) => row.customerId)).toEqual([777]);
  });

  it('H. excludes customers registered after cutoff', () => {
    const dataset = build([
      order({
        customerId: 99,
        customerCreatedAt: '2024-07-02T00:00:00.000Z',
        createdAt: '2024-07-10T00:00:00.000Z',
      }),
    ]);

    expect(dataset.rows).toEqual([]);
  });

  it('excludes customers whose observed orders predate ps_customer.date_add and counts the anomaly', () => {
    const dataset = build([
      order({
        customerId: 1234,
        customerCreatedAt: '2024-06-15T00:00:00.000Z',
        createdAt: '2024-06-01T00:00:00.000Z',
      }),
      order({
        orderId: 2,
        customerId: 77,
      }),
    ]);

    expect(dataset.rows.map((row) => row.customerId)).toEqual([77]);
    expect(dataset.manifest.excludedOrderBeforeCustomerCreatedAtCustomerCount).toBe(1);
  });

  it('I. never lets a future order change historical revenue, AOV or recency', () => {
    const base = build([
      order({ orderId: 1, createdAt: '2024-05-01T00:00:00.000Z', totalPaidTaxIncl: '100.000000' }),
      order({ orderId: 2, createdAt: '2024-06-15T00:00:00.000Z', totalPaidTaxIncl: '200.000000', products: [product({ revenueTaxIncl: '200.000000' })] }),
    ]);
    const withFuture = build([
      order({ orderId: 1, createdAt: '2024-05-01T00:00:00.000Z', totalPaidTaxIncl: '100.000000' }),
      order({ orderId: 2, createdAt: '2024-06-15T00:00:00.000Z', totalPaidTaxIncl: '200.000000', products: [product({ revenueTaxIncl: '200.000000' })] }),
      order({
        orderId: 3,
        createdAt: '2024-11-01T00:00:00.000Z',
        totalPaidTaxIncl: '9000.000000',
        totalDiscountsTaxIncl: '0.000000',
        totalShippingTaxIncl: '0.000000',
        products: [product({ productId: 999, revenueTaxIncl: '9000.000000' })],
      }),
    ]);

    expect(withFuture.rows[0]!.features).toEqual(base.rows[0]!.features);
    expect(withFuture.rows[0]!.observationMetadata).toEqual(base.rows[0]!.observationMetadata);
    expect(withFuture.rows[0]!.labels.futureRevenueTaxIncl).toBe('9000.000000');
  });

  it('J. keeps order-level revenue and count stable when one order has multiple product lines', () => {
    const dataset = build([
      order({
        totalPaidTaxIncl: '100.000000',
        products: [
          product({ productId: 11, revenueTaxIncl: '40.000000' }),
          product({ productId: 12, revenueTaxIncl: '60.000000' }),
        ],
      }),
    ]);
    const row = dataset.rows[0]!;

    expect(row.features.historicalValidOrderCount).toBe(1);
    expect(row.features.historicalRevenueTaxIncl).toBe('100.000000');
    expect(row.features.distinctProductCount).toBe(2);
  });

  it('rejects duplicate physical order ids so one order cannot contribute twice', () => {
    expect(() =>
      build([
        order({ orderId: 1 }),
        order({ orderId: 1, createdAt: '2024-06-02T00:00:00.000Z' }),
      ]),
    ).toThrow(/Duplicate orderId/);
  });

  it('K. uses null purchaseFrequencyDays for one-order customers', () => {
    const dataset = build([order()]);
    expect(dataset.rows[0]!.features.purchaseFrequencyDays).toBeNull();
  });

  it('L. computes two-order purchaseFrequencyDays from historical timing only', () => {
    const dataset = build([
      order({ orderId: 1, createdAt: '2024-06-01T00:00:00.000Z' }),
      order({ orderId: 2, createdAt: '2024-06-11T00:00:00.000Z' }),
    ]);

    expect(dataset.rows[0]!.features.purchaseFrequencyDays).toBe('10.000000');
  });

  it('M. rejects an incomplete 12-month label window', () => {
    expect(() =>
      build([order()], {
        cutoffTime,
        availableDataThrough: '2025-06-30T23:59:59.999Z',
      }),
    ).toThrow(/mature 12-month label window/);
  });

  it('N. rejects a valid positive non-CLP order instead of silently converting it', () => {
    expect(() =>
      build([
        order(),
        order({ orderId: 2, currencyIsoCode: 'USD', createdAt: '2024-08-01T00:00:00.000Z' }),
      ]),
    ).toThrow(/currencyIsoCode/);
  });

  it('O. produces identical rows and checksums for the same source under different input permutations', () => {
    const source = [
      order({ orderId: 1, createdAt: '2024-05-01T00:00:00.000Z' }),
      order({ orderId: 2, createdAt: '2024-06-15T00:00:00.000Z', totalPaidTaxIncl: '200.000000', products: [product({ revenueTaxIncl: '200.000000' })] }),
      order({ orderId: 3, createdAt: '2024-09-01T00:00:00.000Z', totalPaidTaxIncl: '300.000000', products: [product({ revenueTaxIncl: '300.000000' })] }),
    ] as const;

    const left = build(source);
    const right = build([source[2]!, source[0]!, source[1]!]);

    expect(left.rows).toEqual(right.rows);
    expect(left.manifest).toEqual(right.manifest);
  });

  it('P. emits exactly one example per customerId x cutoffTime even when the customer has many orders', () => {
    const dataset = build([
      order({ orderId: 1 }),
      order({ orderId: 2, createdAt: '2024-06-10T00:00:00.000Z' }),
      order({ orderId: 3, createdAt: '2024-08-10T00:00:00.000Z' }),
    ]);

    expect(dataset.rows).toHaveLength(1);
    expect(dataset.rows[0]!.customerId).toBe(42);
    expect(dataset.rows[0]!.cutoffTime).toBe(cutoffTime);
  });

  it('creates a deterministic manifest with checksums and lineage metadata', () => {
    const dataset = build([order()]);

    expect(dataset.manifest.datasetVersion).toBe(CUSTOMER_CLV_BACKTEST_DATASET_VERSION);
    expect(dataset.manifest.inputChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(dataset.manifest.featureChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(dataset.manifest.labelChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(dataset.manifest.datasetChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(dataset.manifest.temporalStateKnownLimitations).toHaveLength(3);
  });

  it('enforces product aggregation at orderId x productId grain', () => {
    expect(() =>
      build([
        order({
          products: [
            product({ productId: 11, revenueTaxIncl: '40.000000' }),
            product({ productId: 11, revenueTaxIncl: '60.000000' }),
          ],
        }),
      ]),
    ).toThrow(/Duplicate productId/);
  });

  it('keeps seller-service revenue out of commercial history and future labels', () => {
    const dataset = build([
      order({ sellerServiceRevenueTaxIncl: '15.000000' }),
      order({
        orderId: 2,
        createdAt: '2024-08-01T00:00:00.000Z',
        totalPaidTaxIncl: '200.000000',
        sellerServiceRevenueTaxIncl: '50.000000',
        products: [product({ revenueTaxIncl: '150.000000' })],
      }),
    ]);
    const row = dataset.rows[0]!;

    expect(row.features.historicalRevenueTaxIncl).toBe('85.000000');
    expect(row.labels.futureRevenueTaxIncl).toBe('150.000000');
  });

  it('has a mandatory leakage regression: identical pre-cutoff history yields identical features while future labels diverge', () => {
    const history = [
      order({ orderId: 1, createdAt: '2024-02-01T00:00:00.000Z', totalPaidTaxIncl: '100.000000' }),
      order({ orderId: 2, createdAt: '2024-06-20T00:00:00.000Z', totalPaidTaxIncl: '200.000000', products: [product({ revenueTaxIncl: '200.000000' })] }),
    ] as const;
    const calmFuture = build([
      ...history,
      order({ orderId: 3, createdAt: '2024-08-01T00:00:00.000Z', totalPaidTaxIncl: '10.000000', products: [product({ productId: 21, revenueTaxIncl: '10.000000' })] }),
    ]);
    const extremeFuture = build([
      ...history,
      order({ orderId: 3, createdAt: '2024-08-01T00:00:00.000Z', totalPaidTaxIncl: '99999.000000', products: [product({ productId: 21, revenueTaxIncl: '99999.000000' })] }),
      order({ orderId: 4, createdAt: '2025-06-30T23:59:59.999Z', totalPaidTaxIncl: '88888.000000', products: [product({ productId: 22, revenueTaxIncl: '88888.000000' })] }),
    ]);

    expect(calmFuture.rows[0]!.features).toEqual(extremeFuture.rows[0]!.features);
    expect(calmFuture.rows[0]!.labels).not.toEqual(extremeFuture.rows[0]!.labels);
  });

  it('documents the temporal-state limitation explicitly: cancellationRatio uses observed current_state, not a reconstructed as-of-cutoff state', () => {
    const dataset = build([
      order({
        orderId: 1,
        currentValid: true,
        currentStateId: 6,
      }),
    ]);
    const row = dataset.rows[0]!;

    expect(row.features.historicalValidOrderCount).toBe(1);
    expect(row.features.cancellationRatio).toBe('1.000000');
    expect(dataset.manifest.orderStatusTemporalPolicyVersion).toContain('documented-drift');
  });
});

describe('buildCustomerClvCandidateBacktestCutoffs', () => {
  it('returns only mature semiannual cutoffs', () => {
    expect(
      buildCustomerClvCandidateBacktestCutoffs({
        firstObservedOrderAt: '2022-03-15T10:00:00.000Z',
        availableDataThrough: '2025-08-30T00:00:00.000Z',
        maxCutoffs: 10,
      }),
    ).toEqual([
      '2022-07-01T00:00:00.000Z',
      '2023-01-01T00:00:00.000Z',
      '2023-07-01T00:00:00.000Z',
      '2024-01-01T00:00:00.000Z',
      '2024-07-01T00:00:00.000Z',
    ]);
  });

  it('returns an empty schedule when no mature cutoff exists yet', () => {
    expect(
      buildCustomerClvCandidateBacktestCutoffs({
        firstObservedOrderAt: '2025-01-15T00:00:00.000Z',
        availableDataThrough: '2025-08-30T00:00:00.000Z',
      }),
    ).toEqual([]);
  });
});
