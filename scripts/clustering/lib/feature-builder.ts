import {
  addBehaviorDecimals,
  compareDecimalDesc,
  divideDecimalToBehaviorDecimal,
  divideIntegerToBehaviorDecimal,
  effectiveDiversityFromHhi,
  squareBehaviorShare,
  sumBehaviorShares,
} from '../../../src/application/customer-purchase-behavior/behavior-decimal.js';
import { daysBetween, floorDaysBetween } from './reference-time.js';
import type {
  RawCustomerOrderAggregate,
  RawCustomerOrderStateAggregate,
  RawCustomerProductAggregate,
  RawCustomerTenure,
} from './population-reader.js';

export type ProductConcentration = {
  readonly distinctProducts: number;
  readonly repeatProductRate: number;
  readonly top1Share: number;
  readonly top3Share: number;
  readonly hhi: number;
  readonly effectiveDiversity: number;
  readonly totalQuantity: number;
};

// Reuses the exact HHI/effectiveDiversity/share formulas already shipped in
// get-customer-purchase-behavior.ts (via behavior-decimal.ts) rather than reimplementing them —
// this is what guarantees the CP-R2 audit's Step 14 correction (effectiveDiversity = 1/hhi,
// NOT bounded to [0,1]) is verified against the real formula, not an assumed one.
export function rollupProductConcentration(rows: readonly RawCustomerProductAggregate[]): ProductConcentration {
  if (rows.length === 0) {
    throw new Error('Product concentration requires at least one product row');
  }
  const totalSpent = addBehaviorDecimals(rows.map((row) => row.totalSpentTaxIncl));
  const totalQuantity = rows.reduce((sum, row) => sum + row.totalQuantity, 0);
  const repeatedCount = rows.filter((row) => row.productOrderCount >= 2).length;
  const sorted = [...rows].sort((a, b) => compareDecimalDesc(a.totalSpentTaxIncl, b.totalSpentTaxIncl));
  const shares = sorted.map((row) => divideDecimalToBehaviorDecimal(row.totalSpentTaxIncl, totalSpent));
  const hhi = sumBehaviorShares(shares.map(squareBehaviorShare));

  return {
    distinctProducts: rows.length,
    repeatProductRate: Number(divideIntegerToBehaviorDecimal(repeatedCount, rows.length)),
    top1Share: Number(shares[0] ?? '0.000000'),
    top3Share: Number(sumBehaviorShares(shares.slice(0, 3))),
    hhi: Number(hhi),
    effectiveDiversity: Number(effectiveDiversityFromHhi(hhi)),
    totalQuantity,
  };
}

export type RawFeatureRow = {
  readonly customerId: number;
  readonly validOrders: number;
  readonly totalSpentTaxIncl: number;
  readonly averageOrderValueTaxIncl: number;
  readonly customerTenureDays: number;
  readonly daysSinceLastOrder: number;
  readonly purchaseFrequencyDays: number;
  readonly daysBetweenFirstLastOrder: number;
  readonly orders365d: number;
  readonly totalOrdersAllStates: number;
  readonly cancelledOrders: number;
  readonly cancelledOrderRatio: number;
  readonly totalDiscountsTaxIncl: number;
  readonly totalShippingTaxIncl: number;
  readonly discountShare: number;
  readonly shippingShare: number;
  readonly distinctProducts: number;
  readonly repeatProductRate: number;
  readonly top1Share: number;
  readonly top3Share: number;
  readonly hhi: number;
  readonly effectiveDiversity: number;
  readonly averageUnitsPerOrder: number;
};

export function buildRawFeatureRow(input: {
  readonly referenceTime: string;
  readonly orderAggregate: RawCustomerOrderAggregate;
  readonly stateAggregate: RawCustomerOrderStateAggregate | undefined;
  readonly tenure: RawCustomerTenure | undefined;
  readonly productRows: readonly RawCustomerProductAggregate[];
}): RawFeatureRow {
  const { referenceTime, orderAggregate, stateAggregate, tenure, productRows } = input;

  if (!stateAggregate) {
    throw new Error(`Missing order-state aggregate for eligible customer ${orderAggregate.customerId}`);
  }
  if (!tenure) {
    throw new Error(`Missing ps_customer.date_add for eligible customer ${orderAggregate.customerId}`);
  }
  if (productRows.length === 0) {
    throw new Error(`Missing product-level rows for eligible customer ${orderAggregate.customerId}`);
  }
  if (orderAggregate.validOrders < 2) {
    throw new Error(`Customer ${orderAggregate.customerId} has fewer than 2 valid orders (population B' violation)`);
  }
  if (stateAggregate.totalOrdersAllStates < orderAggregate.validOrders) {
    throw new Error(
      `Customer ${orderAggregate.customerId}: all-state order count cannot be less than the valid-order count`,
    );
  }

  const totalSpentTaxIncl = Number(orderAggregate.totalSpentTaxIncl);
  const totalDiscountsTaxIncl = Number(orderAggregate.totalDiscountsTaxIncl);
  const totalShippingTaxIncl = Number(orderAggregate.totalShippingTaxIncl);
  const concentration = rollupProductConcentration(productRows);

  return {
    customerId: orderAggregate.customerId,
    validOrders: orderAggregate.validOrders,
    totalSpentTaxIncl,
    averageOrderValueTaxIncl: totalSpentTaxIncl / orderAggregate.validOrders,
    customerTenureDays: floorDaysBetween(tenure.customerCreatedAt, referenceTime),
    daysSinceLastOrder: floorDaysBetween(orderAggregate.lastValidOrderAt, referenceTime),
    // Mirrors commercial-summary-calculations.ts's purchaseFrequencyDays exactly (average
    // inter-order interval) — always defined here because population B' requires >=2 valid
    // orders, the same precondition that module already encodes for a non-null result.
    purchaseFrequencyDays:
      daysBetween(orderAggregate.firstValidOrderAt, orderAggregate.lastValidOrderAt) / (orderAggregate.validOrders - 1),
    daysBetweenFirstLastOrder: daysBetween(orderAggregate.firstValidOrderAt, orderAggregate.lastValidOrderAt),
    orders365d: orderAggregate.orders365d,
    totalOrdersAllStates: stateAggregate.totalOrdersAllStates,
    cancelledOrders: stateAggregate.cancelledOrders,
    cancelledOrderRatio: stateAggregate.cancelledOrders / stateAggregate.totalOrdersAllStates,
    totalDiscountsTaxIncl,
    totalShippingTaxIncl,
    discountShare: totalDiscountsTaxIncl / totalSpentTaxIncl,
    shippingShare: totalShippingTaxIncl / totalSpentTaxIncl,
    distinctProducts: concentration.distinctProducts,
    repeatProductRate: concentration.repeatProductRate,
    top1Share: concentration.top1Share,
    top3Share: concentration.top3Share,
    hhi: concentration.hhi,
    effectiveDiversity: concentration.effectiveDiversity,
    averageUnitsPerOrder: concentration.totalQuantity / orderAggregate.validOrders,
  };
}

export const RAW_FEATURE_COLUMNS: readonly (keyof RawFeatureRow)[] = [
  'customerId',
  'validOrders',
  'totalSpentTaxIncl',
  'averageOrderValueTaxIncl',
  'customerTenureDays',
  'daysSinceLastOrder',
  'purchaseFrequencyDays',
  'daysBetweenFirstLastOrder',
  'orders365d',
  'totalOrdersAllStates',
  'cancelledOrders',
  'cancelledOrderRatio',
  'totalDiscountsTaxIncl',
  'totalShippingTaxIncl',
  'discountShare',
  'shippingShare',
  'distinctProducts',
  'repeatProductRate',
  'top1Share',
  'top3Share',
  'hhi',
  'effectiveDiversity',
  'averageUnitsPerOrder',
];

export function assertNoNaNOrInfinite(rows: readonly RawFeatureRow[]): void {
  for (const row of rows) {
    for (const column of RAW_FEATURE_COLUMNS) {
      const value = row[column];
      if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
        throw new Error(`Feature row for customer ${row.customerId} has invalid ${column}: ${String(value)}`);
      }
    }
  }
}
