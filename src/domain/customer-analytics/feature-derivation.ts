import {
  addBehaviorDecimals,
  compareDecimalDesc,
  divideDecimalToBehaviorDecimal,
  divideIntegerToBehaviorDecimal,
  effectiveDiversityFromHhi,
  squareBehaviorShare,
  sumBehaviorShares,
} from '../../application/customer-purchase-behavior/behavior-decimal.js';
import type { CustomerFeatureProductAggregate, CustomerFeatureRow, CustomerFeatureSourceRow } from './contracts.js';

const DAY_MS = 86_400_000;

// Pure, DB-free derivation of one customer's CustomerFeatureRow from its raw source
// extraction — kept independent of any SQL shape so feature formulas are unit-testable
// without a database (task Section 50). Reuses the exact same behavior-decimal primitives
// (bigint-scaled, no float summation drift) that mysql-cluster-population-reader.ts already
// uses for the 12 overlapping Feature-Set-A fields — required for clustering parity (task
// Section 53), not a coincidental similarity.
//
// Two distinct "total spent" values are computed here and must not be confused:
//   - product-level spend distribution (SUM of order_detail.total_price_tax_incl per
//     product) drives top1Share/top3Share/effectiveDiversity/repeatProductRate — a
//     concentration-of-spend-across-products signal.
//   - order-level gross spend (orderAggregate totals: SUM of orders.total_paid_tax_incl,
//     which includes shipping) drives the commercial totalSpentTaxIncl/
//     averageOrderValueTaxIncl fields (task Section 20) and the discountShare/shippingShare
//     denominators — matching mysql-cluster-population-reader.ts's own internal split.
export function deriveCustomerFeatureRow(source: CustomerFeatureSourceRow, referenceTimeMysql: string): CustomerFeatureRow {
  if (source.validOrders < 1) {
    throw new Error(`Customer ${source.prestashopCustomerId} has no valid orders (population B violation)`);
  }
  if (source.products.length === 0) {
    throw new Error(`Customer ${source.prestashopCustomerId} has valid orders but no product lines`);
  }

  const products = sortProductsDeterministically(source.products);
  const productSpendTotal = addBehaviorDecimals(products.map((row) => row.totalSpentTaxIncl));
  const totalQuantity = products.reduce((sum, row) => sum + row.totalQuantity, 0);
  const repeatedCount = products.filter((row) => row.productOrderCount >= 2).length;
  const sortedBySpendDesc = [...products].sort((a, b) => compareDecimalDesc(a.totalSpentTaxIncl, b.totalSpentTaxIncl));
  const shares = sortedBySpendDesc.map((row) => divideDecimalToBehaviorDecimal(row.totalSpentTaxIncl, productSpendTotal));
  const hhi = sumBehaviorShares(shares.map(squareBehaviorShare));

  const referenceMs = mysqlDateTimeToMs(referenceTimeMysql);
  const firstMs = mysqlDateTimeToMs(source.firstOrderAt);
  const lastMs = mysqlDateTimeToMs(source.lastOrderAt);
  const createdMs = mysqlDateTimeToMs(source.customerCreatedAt);
  if (firstMs > lastMs) {
    throw new Error(`Customer ${source.prestashopCustomerId} has firstOrderAt after lastOrderAt`);
  }
  if (createdMs > referenceMs) {
    throw new Error(`Customer ${source.prestashopCustomerId} has customerCreatedAt after referenceTime`);
  }

  const totalSpentTaxIncl = source.totalSpentTaxIncl;
  const totalDiscountsTaxIncl = source.totalDiscountsTaxIncl;
  const totalShippingTaxIncl = source.totalShippingTaxIncl;

  if (source.totalOrdersAllStates < source.validOrders) {
    throw new Error(`Customer ${source.prestashopCustomerId} has totalOrdersAllStates below validOrders`);
  }

  const row: CustomerFeatureRow = {
    prestashopCustomerId: source.prestashopCustomerId,
    validOrders: source.validOrders,
    totalSpentTaxIncl,
    averageOrderValueTaxIncl: divideDecimalToBehaviorDecimal(totalSpentTaxIncl, String(source.validOrders)),
    firstOrderAt: mysqlDateTimeToIso(source.firstOrderAt),
    lastOrderAt: mysqlDateTimeToIso(source.lastOrderAt),
    daysSinceLastOrder: Math.floor((referenceMs - lastMs) / DAY_MS),
    customerTenureDays: Math.floor((referenceMs - createdMs) / DAY_MS),
    distinctProducts: products.length,
    repeatProductRate: divideIntegerToBehaviorDecimal(repeatedCount, products.length),
    top1Share: shares[0] ?? '0.000000',
    top3Share: sumBehaviorShares(shares.slice(0, 3)),
    effectiveDiversity: effectiveDiversityFromHhi(hhi),
    averageUnitsPerOrder: divideIntegerToBehaviorDecimal(totalQuantity, source.validOrders),
    purchaseFrequencyDays:
      source.validOrders < 2 ? null : formatDaysDecimal((lastMs - firstMs) / DAY_MS / (source.validOrders - 1)),
    orders365d: source.orders365d,
    cancelledOrderRatio: divideIntegerToBehaviorDecimal(source.cancelledOrders, source.totalOrdersAllStates),
    discountShare: divideDecimalToBehaviorDecimal(totalDiscountsTaxIncl, totalSpentTaxIncl),
    shippingShare: divideDecimalToBehaviorDecimal(totalShippingTaxIncl, totalSpentTaxIncl),
  };

  assertFiniteCustomerFeatureRow(row);
  return row;
}

// Guards against NaN/Infinity ever reaching a persisted row (task Section 50/20) — every
// numeric/decimal field must already be a finite value by construction; this is a defensive
// assertion, not a code path expected to trigger given the decimal-string arithmetic above
// never produces non-finite output.
export function assertFiniteCustomerFeatureRow(row: CustomerFeatureRow): void {
  const numericFields: readonly [string, number][] = [
    ['validOrders', row.validOrders],
    ['daysSinceLastOrder', row.daysSinceLastOrder],
    ['customerTenureDays', row.customerTenureDays],
    ['distinctProducts', row.distinctProducts],
    ['orders365d', row.orders365d],
  ];
  for (const [field, value] of numericFields) {
    if (!Number.isFinite(value)) {
      throw new Error(`CustomerFeatureRow.${field} is not finite for customer ${row.prestashopCustomerId}`);
    }
  }

  const decimalFields: readonly [string, string | null][] = [
    ['totalSpentTaxIncl', row.totalSpentTaxIncl],
    ['averageOrderValueTaxIncl', row.averageOrderValueTaxIncl],
    ['repeatProductRate', row.repeatProductRate],
    ['top1Share', row.top1Share],
    ['top3Share', row.top3Share],
    ['effectiveDiversity', row.effectiveDiversity],
    ['averageUnitsPerOrder', row.averageUnitsPerOrder],
    ['purchaseFrequencyDays', row.purchaseFrequencyDays],
    ['cancelledOrderRatio', row.cancelledOrderRatio],
    ['discountShare', row.discountShare],
    ['shippingShare', row.shippingShare],
  ];
  for (const [field, value] of decimalFields) {
    if (value === null) continue;
    if (!Number.isFinite(Number(value))) {
      throw new Error(`CustomerFeatureRow.${field} is not finite for customer ${row.prestashopCustomerId}`);
    }
  }
}

function sortProductsDeterministically(
  products: readonly CustomerFeatureProductAggregate[],
): readonly CustomerFeatureProductAggregate[] {
  return [...products].sort((a, b) => a.productId - b.productId);
}

function formatDaysDecimal(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid purchaseFrequencyDays value: ${String(value)}`);
  }
  return value.toFixed(6);
}

function mysqlDateTimeToMs(value: string): number {
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid MySQL datetime: ${value}`);
  }
  return parsed.getTime();
}

function mysqlDateTimeToIso(value: string): string {
  return new Date(mysqlDateTimeToMs(value)).toISOString();
}
