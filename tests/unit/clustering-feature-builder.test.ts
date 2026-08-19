import { describe, expect, it } from 'vitest';
import {
  assertNoNaNOrInfinite,
  buildRawFeatureRow,
  rollupProductConcentration,
  type RawFeatureRow,
} from '../../scripts/clustering/lib/feature-builder.js';
import type {
  RawCustomerOrderAggregate,
  RawCustomerOrderStateAggregate,
  RawCustomerProductAggregate,
  RawCustomerTenure,
} from '../../scripts/clustering/lib/population-reader.js';

function productRow(overrides: Partial<RawCustomerProductAggregate> = {}): RawCustomerProductAggregate {
  return {
    customerId: 1,
    productId: 1,
    productOrderCount: 1,
    totalQuantity: 1,
    totalSpentTaxIncl: '100.000000',
    ...overrides,
  };
}

describe('rollupProductConcentration (effectiveDiversity semantics — CP-R2 audit Step 14)', () => {
  it('is fully concentrated (hhi=1, effectiveDiversity=1) for a single product', () => {
    const result = rollupProductConcentration([productRow({ totalSpentTaxIncl: '500.000000' })]);
    expect(result.hhi).toBe(1);
    expect(result.effectiveDiversity).toBe(1);
    expect(result.top1Share).toBe(1);
    expect(result.top3Share).toBe(1);
  });

  it('effectiveDiversity = 1/hhi and is NOT bounded to [0,1] for an even split across N products', () => {
    const rows = Array.from({ length: 4 }, (_, index) =>
      productRow({ productId: index + 1, totalSpentTaxIncl: '100.000000' }),
    );
    const result = rollupProductConcentration(rows);
    expect(result.hhi).toBeCloseTo(0.25, 6);
    expect(result.effectiveDiversity).toBeCloseTo(4, 6);
    expect(result.effectiveDiversity).toBeGreaterThan(1);
  });

  it('repeatProductRate counts only products purchased in >=2 distinct orders', () => {
    const result = rollupProductConcentration([
      productRow({ productId: 1, productOrderCount: 2, totalSpentTaxIncl: '100.000000' }),
      productRow({ productId: 2, productOrderCount: 1, totalSpentTaxIncl: '100.000000' }),
    ]);
    expect(result.repeatProductRate).toBeCloseTo(0.5, 6);
  });

  it('throws rather than silently defaulting when a customer has zero product rows', () => {
    expect(() => rollupProductConcentration([])).toThrow();
  });
});

const referenceTime = '2026-08-19T00:00:00.000Z';

function orderAggregate(overrides: Partial<RawCustomerOrderAggregate> = {}): RawCustomerOrderAggregate {
  return {
    customerId: 42,
    validOrders: 2,
    totalSpentTaxIncl: '200000.000000',
    firstValidOrderAt: '2026-01-01T00:00:00.000Z',
    lastValidOrderAt: '2026-07-01T00:00:00.000Z',
    totalDiscountsTaxIncl: '10000.000000',
    totalShippingTaxIncl: '5000.000000',
    orders365d: 1,
    ...overrides,
  };
}

function stateAggregate(overrides: Partial<RawCustomerOrderStateAggregate> = {}): RawCustomerOrderStateAggregate {
  return { customerId: 42, totalOrdersAllStates: 2, cancelledOrders: 0, ...overrides };
}

function tenure(overrides: Partial<RawCustomerTenure> = {}): RawCustomerTenure {
  return { customerId: 42, customerCreatedAt: '2024-01-01T00:00:00.000Z', ...overrides };
}

describe('buildRawFeatureRow — population B\' preconditions and ratio handling', () => {
  const baseInput = () => ({
    referenceTime,
    orderAggregate: orderAggregate(),
    stateAggregate: stateAggregate(),
    tenure: tenure(),
    productRows: [productRow({ totalSpentTaxIncl: '200000.000000' })],
  });

  it('computes purchaseFrequencyDays as the average inter-order interval for a >=2-order customer', () => {
    const row = buildRawFeatureRow(baseInput());
    // first->last = 181 days (2026-01-01 -> 2026-07-01), validOrders=2 => /(2-1)
    expect(row.purchaseFrequencyDays).toBeCloseTo(row.daysBetweenFirstLastOrder, 10);
    expect(row.purchaseFrequencyDays).toBeGreaterThan(0);
  });

  it('computes discountShare and shippingShare as raw (unwinsorized) ratios of total spend', () => {
    const row = buildRawFeatureRow(baseInput());
    expect(row.discountShare).toBeCloseTo(10000 / 200000, 10);
    expect(row.shippingShare).toBeCloseTo(5000 / 200000, 10);
  });

  it('computes cancelledOrderRatio against ALL orders (valid + invalid), not just valid ones', () => {
    const row = buildRawFeatureRow({
      ...baseInput(),
      stateAggregate: stateAggregate({ totalOrdersAllStates: 4, cancelledOrders: 1 }),
    });
    expect(row.cancelledOrderRatio).toBeCloseTo(0.25, 10);
  });

  it('throws for a customer with fewer than 2 valid orders (population B\' violation)', () => {
    expect(() =>
      buildRawFeatureRow({ ...baseInput(), orderAggregate: orderAggregate({ validOrders: 1 }) }),
    ).toThrow(/fewer than 2 valid orders/);
  });

  it('fails fast (does not silently default) when the order-state aggregate is missing', () => {
    expect(() => buildRawFeatureRow({ ...baseInput(), stateAggregate: undefined })).toThrow(/Missing order-state aggregate/);
  });

  it('fails fast when ps_customer tenure is missing', () => {
    expect(() => buildRawFeatureRow({ ...baseInput(), tenure: undefined })).toThrow(/Missing ps_customer.date_add/);
  });

  it('fails fast when product rows are missing for an eligible customer', () => {
    expect(() => buildRawFeatureRow({ ...baseInput(), productRows: [] })).toThrow(/Missing product-level rows/);
  });
});

describe('assertNoNaNOrInfinite', () => {
  function validRow(): RawFeatureRow {
    return buildRawFeatureRow({
      referenceTime,
      orderAggregate: orderAggregate(),
      stateAggregate: stateAggregate(),
      tenure: tenure(),
      productRows: [productRow({ totalSpentTaxIncl: '200000.000000' })],
    });
  }

  it('passes for a well-formed row', () => {
    expect(() => assertNoNaNOrInfinite([validRow()])).not.toThrow();
  });

  it('rejects a row containing NaN (e.g. a zero-denominator ratio that slipped through)', () => {
    const row = { ...validRow(), discountShare: NaN };
    expect(() => assertNoNaNOrInfinite([row])).toThrow(/invalid discountShare/);
  });

  it('rejects a row containing Infinity', () => {
    const row = { ...validRow(), shippingShare: Number.POSITIVE_INFINITY };
    expect(() => assertNoNaNOrInfinite([row])).toThrow(/invalid shippingShare/);
  });
});
