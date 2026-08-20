import { describe, expect, it } from 'vitest';
import { toClusteringFeatureVector } from '../../src/domain/customer-analytics/clustering-adapter.js';
import { featureOrder } from '../../src/domain/customer-clustering/model-version.js';
import { deriveCustomerFeatureRow } from '../../src/domain/customer-analytics/feature-derivation.js';
import type { CustomerFeatureSourceRow } from '../../src/domain/customer-analytics/contracts.js';

const referenceTimeMysql = '2026-08-19 00:00:00';

function sourceRow(overrides: Partial<CustomerFeatureSourceRow> = {}): CustomerFeatureSourceRow {
  return {
    prestashopCustomerId: 22066,
    validOrders: 3,
    firstOrderAt: '2026-01-01 00:00:00',
    lastOrderAt: '2026-07-01 00:00:00',
    orders365d: 1,
    totalSpentTaxIncl: '90000.000000',
    totalDiscountsTaxIncl: '0.000000',
    totalShippingTaxIncl: '9000.000000',
    totalOrdersAllStates: 3,
    cancelledOrders: 0,
    customerCreatedAt: '2022-01-01 00:00:00',
    products: [{ productId: 1, productOrderCount: 2, totalQuantity: 3, totalSpentTaxIncl: '90000.000000' }],
    ...overrides,
  };
}

// Task Section 40: demonstrates the materialized row is sufficient to feed clustering's own
// K-Means transform pipeline without re-querying PrestaShop — clustering itself is not wired
// to this yet.
describe('toClusteringFeatureVector (task Section 40/46)', () => {
  it('covers exactly clustering\'s 12 Feature Set A fields (12/12 coverage)', () => {
    const row = deriveCustomerFeatureRow(sourceRow(), referenceTimeMysql);
    const vector = toClusteringFeatureVector(row);
    expect(vector).not.toBeNull();
    expect(Object.keys(vector!).sort()).toEqual([...featureOrder].sort());
  });

  it('every value is a finite number', () => {
    const row = deriveCustomerFeatureRow(sourceRow(), referenceTimeMysql);
    const vector = toClusteringFeatureVector(row)!;
    for (const feature of featureOrder) {
      expect(Number.isFinite(vector[feature])).toBe(true);
    }
  });

  it('returns null for a customer below clustering\'s own >=2-orders population policy (validOrders=1)', () => {
    const row = deriveCustomerFeatureRow(sourceRow({ validOrders: 1 }), referenceTimeMysql);
    expect(toClusteringFeatureVector(row)).toBeNull();
  });

  it('numeric fields (distinctProducts, orders365d, customerTenureDays) pass through unchanged', () => {
    const row = deriveCustomerFeatureRow(sourceRow(), referenceTimeMysql);
    const vector = toClusteringFeatureVector(row)!;
    expect(vector.distinctProducts).toBe(row.distinctProducts);
    expect(vector.orders365d).toBe(row.orders365d);
    expect(vector.customerTenureDays).toBe(row.customerTenureDays);
  });

  it('decimal-string fields are converted to numbers with the same value', () => {
    const row = deriveCustomerFeatureRow(sourceRow(), referenceTimeMysql);
    const vector = toClusteringFeatureVector(row)!;
    expect(vector.effectiveDiversity).toBeCloseTo(Number(row.effectiveDiversity), 6);
    expect(vector.discountShare).toBeCloseTo(Number(row.discountShare), 6);
  });
});
