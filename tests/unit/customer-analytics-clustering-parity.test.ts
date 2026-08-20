import { describe, expect, it } from 'vitest';
import { buildFeatureVector } from '../../src/infrastructure/prestashop/mysql-cluster-population-reader.js';
import { featureOrder } from '../../src/domain/customer-clustering/model-version.js';
import { deriveCustomerFeatureRow } from '../../src/domain/customer-analytics/feature-derivation.js';
import { toClusteringFeatureVector } from '../../src/domain/customer-analytics/clustering-adapter.js';
import type { CustomerFeatureSourceRow } from '../../src/domain/customer-analytics/contracts.js';

// Task Section 53 (critical): the Data Layer must never carry a second, silently-drifting
// definition of clustering's Feature Set A. This test calls the REAL production clustering
// formula (mysql-cluster-population-reader.ts's own buildFeatureVector, exported for exactly
// this purpose) and the Data Layer's own derivation on the same shared fixture, and asserts
// the 12 overlapping fields match exactly — not "should be equivalent by inspection".
describe('clustering Feature Set A parity (task Section 53)', () => {
  const referenceTimeMysql = '2026-08-19 00:00:00';

  const orderAggregate = {
    customerId: 999,
    validOrders: 3,
    firstValidOrderAt: '2026-01-01 00:00:00',
    lastValidOrderAt: '2026-07-01 00:00:00',
    orders365d: 1,
    totalSpentTaxIncl: '90000.000000',
    totalDiscountsTaxIncl: '9000.000000',
    totalShippingTaxIncl: '4500.000000',
  };
  const state = { customerId: 999, totalOrdersAllStates: 4, cancelledOrders: 1 };
  const tenure = { customerId: 999, customerCreatedAt: '2022-01-01 00:00:00' };
  const products = [
    { customerId: 999, productOrderCount: 2, totalQuantity: 5, totalSpentTaxIncl: '60000.000000' },
    { customerId: 999, productOrderCount: 1, totalQuantity: 2, totalSpentTaxIncl: '30000.000000' },
  ];

  const clusteringVector = buildFeatureVector(referenceTimeMysql, orderAggregate, state, tenure, products);

  const sourceRow: CustomerFeatureSourceRow = {
    prestashopCustomerId: 999,
    validOrders: orderAggregate.validOrders,
    firstOrderAt: orderAggregate.firstValidOrderAt,
    lastOrderAt: orderAggregate.lastValidOrderAt,
    orders365d: orderAggregate.orders365d,
    totalSpentTaxIncl: orderAggregate.totalSpentTaxIncl,
    totalDiscountsTaxIncl: orderAggregate.totalDiscountsTaxIncl,
    totalShippingTaxIncl: orderAggregate.totalShippingTaxIncl,
    totalOrdersAllStates: state.totalOrdersAllStates,
    cancelledOrders: state.cancelledOrders,
    customerCreatedAt: tenure.customerCreatedAt,
    products: products.map((row, index) => ({
      productId: index + 1,
      productOrderCount: row.productOrderCount,
      totalQuantity: row.totalQuantity,
      totalSpentTaxIncl: row.totalSpentTaxIncl,
    })),
  };
  const analyticsRow = deriveCustomerFeatureRow(sourceRow, referenceTimeMysql);
  const analyticsVector = toClusteringFeatureVector(analyticsRow);

  it('the Data Layer row is eligible for clustering (validOrders>=2)', () => {
    expect(analyticsVector).not.toBeNull();
  });

  it.each(featureOrder)('%s matches the production clustering formula exactly', (feature) => {
    // Tolerance of 1e-5, not bit-exact: the Data Layer intentionally stores ratio/share
    // fields as 6-decimal fixed-point decimals (behavior-decimal SCALE, matching every DB
    // DECIMAL(*,6) column, task Section 22) rather than full-precision JS floats, so a
    // sub-1e-6 quantization difference against clustering's raw float is expected, not a
    // formula mismatch. Any real semantic drift between the two definitions would differ by
    // far more than this.
    expect(analyticsVector![feature]).toBeCloseTo(clusteringVector[feature], 5);
  });

  it('all 12 Feature Set A fields are covered (12/12)', () => {
    expect(featureOrder).toHaveLength(12);
    expect(Object.keys(analyticsVector!).sort()).toEqual([...featureOrder].sort());
  });
});
