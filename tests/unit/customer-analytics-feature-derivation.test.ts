import { describe, expect, it } from 'vitest';
import { assertFiniteCustomerFeatureRow, deriveCustomerFeatureRow } from '../../src/domain/customer-analytics/feature-derivation.js';
import type { CustomerFeatureProductAggregate, CustomerFeatureRow, CustomerFeatureSourceRow } from '../../src/domain/customer-analytics/contracts.js';

const referenceTimeMysql = '2026-08-19 00:00:00';

function product(overrides: Partial<CustomerFeatureProductAggregate> = {}): CustomerFeatureProductAggregate {
  return { productId: 1, productOrderCount: 1, totalQuantity: 1, totalSpentTaxIncl: '100.000000', ...overrides };
}

function sourceRow(overrides: Partial<CustomerFeatureSourceRow> = {}): CustomerFeatureSourceRow {
  return {
    prestashopCustomerId: 42,
    validOrders: 2,
    firstOrderAt: '2026-01-01 00:00:00',
    lastOrderAt: '2026-07-01 00:00:00',
    orders365d: 1,
    totalSpentTaxIncl: '200000.000000',
    totalDiscountsTaxIncl: '10000.000000',
    totalShippingTaxIncl: '5000.000000',
    totalOrdersAllStates: 2,
    cancelledOrders: 0,
    customerCreatedAt: '2024-01-01 00:00:00',
    products: [product({ totalSpentTaxIncl: '200000.000000' })],
    ...overrides,
  };
}

describe('deriveCustomerFeatureRow — population B (>=1 valid order, task Section 12/13)', () => {
  it('accepts a single-order customer (population B allows validOrders=1, unlike clustering B\')', () => {
    const row = deriveCustomerFeatureRow(
      sourceRow({ validOrders: 1, firstOrderAt: '2026-07-01 00:00:00', lastOrderAt: '2026-07-01 00:00:00' }),
      referenceTimeMysql,
    );
    expect(row.validOrders).toBe(1);
    expect(row.purchaseFrequencyDays).toBeNull();
  });

  it('throws for a customer with zero valid orders (population B violation)', () => {
    expect(() => deriveCustomerFeatureRow(sourceRow({ validOrders: 0 }), referenceTimeMysql)).toThrow(/population B violation/);
  });

  it('purchaseFrequencyDays is null for validOrders=1 and never a synthetic 0 (task Section 13)', () => {
    const row = deriveCustomerFeatureRow(sourceRow({ validOrders: 1 }), referenceTimeMysql);
    expect(row.purchaseFrequencyDays).toBeNull();
  });

  it('purchaseFrequencyDays is defined for validOrders>=2 as (last-first)/(validOrders-1) days', () => {
    const row = deriveCustomerFeatureRow(
      sourceRow({
        validOrders: 3,
        totalOrdersAllStates: 3,
        firstOrderAt: '2026-01-01 00:00:00',
        lastOrderAt: '2026-07-01 00:00:00',
      }),
      referenceTimeMysql,
    );
    const expectedDays = (new Date('2026-07-01T00:00:00Z').getTime() - new Date('2026-01-01T00:00:00Z').getTime()) / 86_400_000 / 2;
    expect(Number(row.purchaseFrequencyDays)).toBeCloseTo(expectedDays, 5);
  });

  it('repeatProductRate is 0 (not null) for a one-time buyer — a mathematically real ratio, not a missingness case', () => {
    const row = deriveCustomerFeatureRow(sourceRow({ validOrders: 1 }), referenceTimeMysql);
    expect(row.repeatProductRate).toBe('0.000000');
  });

  it('effectiveDiversity = 1/hhi is fully concentrated (1) for a single product', () => {
    const row = deriveCustomerFeatureRow(sourceRow({ products: [product({ totalSpentTaxIncl: '500.000000' })] }), referenceTimeMysql);
    expect(row.effectiveDiversity).toBe('1.000000');
    expect(row.top1Share).toBe('1.000000');
    expect(row.top3Share).toBe('1.000000');
  });

  it('effectiveDiversity > 1 for an even spend split across N products', () => {
    const products = Array.from({ length: 4 }, (_, index) => product({ productId: index + 1, totalSpentTaxIncl: '100.000000' }));
    const row = deriveCustomerFeatureRow(sourceRow({ products }), referenceTimeMysql);
    expect(Number(row.effectiveDiversity)).toBeCloseTo(4, 5);
  });

  it('repeatProductRate counts only products purchased across >=2 distinct orders', () => {
    const row = deriveCustomerFeatureRow(
      sourceRow({
        products: [
          product({ productId: 1, productOrderCount: 2, totalSpentTaxIncl: '100.000000' }),
          product({ productId: 2, productOrderCount: 1, totalSpentTaxIncl: '100.000000' }),
        ],
      }),
      referenceTimeMysql,
    );
    expect(Number(row.repeatProductRate)).toBeCloseTo(0.5, 6);
  });

  it('orders365d passes through the reader-computed windowed count unchanged', () => {
    const row = deriveCustomerFeatureRow(sourceRow({ orders365d: 7 }), referenceTimeMysql);
    expect(row.orders365d).toBe(7);
  });

  it('cancelledOrderRatio divides cancelled orders by ALL orders, not just valid ones', () => {
    const row = deriveCustomerFeatureRow(sourceRow({ totalOrdersAllStates: 4, cancelledOrders: 1 }), referenceTimeMysql);
    expect(Number(row.cancelledOrderRatio)).toBeCloseTo(0.25, 6);
  });

  it('discountShare/shippingShare divide by order-level total spend, not product-level spend', () => {
    const row = deriveCustomerFeatureRow(
      sourceRow({
        totalSpentTaxIncl: '1000.000000',
        totalDiscountsTaxIncl: '100.000000',
        totalShippingTaxIncl: '50.000000',
        products: [product({ totalSpentTaxIncl: '900.000000' })], // product-level spend can differ from order-level
      }),
      referenceTimeMysql,
    );
    expect(Number(row.discountShare)).toBeCloseTo(0.1, 6);
    expect(Number(row.shippingShare)).toBeCloseTo(0.05, 6);
  });

  it('totalSpentTaxIncl/averageOrderValueTaxIncl are the commercial order-level fields (task Section 20)', () => {
    const row = deriveCustomerFeatureRow(
      sourceRow({ totalSpentTaxIncl: '90000.000000', validOrders: 3, totalOrdersAllStates: 3 }),
      referenceTimeMysql,
    );
    expect(row.totalSpentTaxIncl).toBe('90000.000000');
    expect(Number(row.averageOrderValueTaxIncl)).toBeCloseTo(30000, 6);
  });

  it('customerTenureDays is computed from ps_customer.date_add regardless of order count', () => {
    const row = deriveCustomerFeatureRow(sourceRow({ validOrders: 1, customerCreatedAt: '2020-01-01 00:00:00' }), referenceTimeMysql);
    expect(row.customerTenureDays).toBeGreaterThan(2000);
  });

  it('daysSinceLastOrder is computed against referenceTime, never NOW() (task Section 14)', () => {
    const row = deriveCustomerFeatureRow(sourceRow({ lastOrderAt: '2026-08-09 00:00:00' }), referenceTimeMysql);
    expect(row.daysSinceLastOrder).toBe(10);
  });

  it('throws for a customer with valid orders but no product lines', () => {
    expect(() => deriveCustomerFeatureRow(sourceRow({ products: [] }), referenceTimeMysql)).toThrow(/no product lines/);
  });

  it('throws when firstOrderAt is after lastOrderAt (corrupt source data)', () => {
    expect(() =>
      deriveCustomerFeatureRow(sourceRow({ firstOrderAt: '2026-07-02 00:00:00', lastOrderAt: '2026-07-01 00:00:00' }), referenceTimeMysql),
    ).toThrow(/after lastOrderAt/);
  });
});

describe('assertFiniteCustomerFeatureRow — NaN/Inf guard (task Section 50)', () => {
  function validRow(): CustomerFeatureRow {
    return deriveCustomerFeatureRow(sourceRow(), referenceTimeMysql);
  }

  it('accepts a well-formed row', () => {
    expect(() => assertFiniteCustomerFeatureRow(validRow())).not.toThrow();
  });

  it('rejects a row with a NaN decimal field', () => {
    expect(() => assertFiniteCustomerFeatureRow({ ...validRow(), effectiveDiversity: 'NaN' })).toThrow(/not finite/);
  });

  it('rejects a row with an Infinity numeric field', () => {
    expect(() => assertFiniteCustomerFeatureRow({ ...validRow(), daysSinceLastOrder: Infinity })).toThrow(/not finite/);
  });

  it('allows purchaseFrequencyDays to be null without tripping the finite guard', () => {
    expect(() => assertFiniteCustomerFeatureRow({ ...validRow(), purchaseFrequencyDays: null })).not.toThrow();
  });
});
