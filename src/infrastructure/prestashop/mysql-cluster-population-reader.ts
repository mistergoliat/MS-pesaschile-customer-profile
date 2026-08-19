import type { Pool, RowDataPacket } from 'mysql2/promise';
import {
  addBehaviorDecimals,
  compareDecimalDesc,
  divideDecimalToBehaviorDecimal,
  divideIntegerToBehaviorDecimal,
  effectiveDiversityFromHhi,
  squareBehaviorShare,
  sumBehaviorShares,
} from '../../application/customer-purchase-behavior/behavior-decimal.js';
import { excludedOperationalAccountPrestashopCustomerIds } from '../../domain/customer-rfm/operational-account-exclusion-policy.js';
import type { RawClusterFeatureVector } from '../../domain/customer-clustering/index.js';
import { assertSafePrestashopTablePrefix, coerceNonNegativeSafeInteger, mapPrestashopReadError } from './commercial-summary-reader-utils.js';

// Production port of scripts/clustering/lib/population-reader.ts + lib/feature-builder.ts
// (CP-R2-T01). Deliberately a separate, independent implementation rather than an import from
// scripts/ — the same precedent as RFM's audit script (scripts/audits/rfm-population) staying
// independent from its production reader (mysql-rfm-population-reader.ts). The T01 script stays
// frozen for experiment reproducibility; this is the maintained production path. Both share the
// same eligibility policy (imported, not re-derived) and produce the same feature semantics
// (verified by shared domain-level transform/assignment tests).
export type ClusterPopulationRow = {
  readonly prestashopCustomerId: number;
  readonly features: RawClusterFeatureVector;
};

export type ClusterPopulationReader = {
  readPopulation(): Promise<readonly ClusterPopulationRow[]>;
};

type OrderAggregateRow = {
  customerId: number;
  validOrders: number;
  firstValidOrderAt: string;
  lastValidOrderAt: string;
  orders365d: number;
  totalSpentTaxIncl: string;
  totalDiscountsTaxIncl: string;
  totalShippingTaxIncl: string;
};

type OrderStateAggregateRow = {
  customerId: number;
  totalOrdersAllStates: number;
  cancelledOrders: number;
};

type TenureRow = {
  customerId: number;
  customerCreatedAt: string;
};

type ProductAggregateRow = {
  customerId: number;
  productOrderCount: number;
  totalQuantity: number;
  totalSpentTaxIncl: string;
};

export function createMysqlClusterPopulationReader(
  pool: Pool,
  tablePrefix: string,
  referenceTimeMysql: string,
  window365StartMysql: string,
): ClusterPopulationReader {
  assertSafePrestashopTablePrefix(tablePrefix);
  const excludedAccountIds = [...excludedOperationalAccountPrestashopCustomerIds];
  if (excludedAccountIds.length === 0) {
    throw new Error('Cluster population reader requires at least one excluded operational account id');
  }
  const excludedPlaceholders = excludedAccountIds.map(() => '?').join(', ');
  const orders = `${tablePrefix}orders`;
  const customer = `${tablePrefix}customer`;
  const orderDetail = `${tablePrefix}order_detail`;

  const eligibleOrdersCte = `
    eligible_orders AS (
      SELECT
        o.id_order,
        o.id_customer,
        o.date_add,
        o.total_paid_tax_incl,
        o.total_discounts_tax_incl,
        o.total_shipping_tax_incl
      FROM ${orders} o
      INNER JOIN ${customer} c ON c.id_customer = o.id_customer
      WHERE o.valid = 1
        AND o.total_paid_tax_incl > 0
        AND o.id_customer > 0
        AND o.id_customer NOT IN (${excludedPlaceholders})
        AND o.date_add < ?
    )
  `;

  return {
    async readPopulation() {
      try {
        const [orderAggregates, stateAggregates, tenureRows, productAggregates] = await Promise.all([
          readOrderAggregates(pool, eligibleOrdersCte, excludedAccountIds, referenceTimeMysql, window365StartMysql),
          readOrderStateAggregates(pool, orders, referenceTimeMysql),
          readCustomerTenure(pool, customer),
          readProductAggregates(pool, eligibleOrdersCte, orderDetail, excludedAccountIds, referenceTimeMysql),
        ]);

        const stateByCustomer = new Map(stateAggregates.map((row) => [row.customerId, row]));
        const tenureByCustomer = new Map(tenureRows.map((row) => [row.customerId, row]));
        const productsByCustomer = new Map<number, ProductAggregateRow[]>();
        for (const row of productAggregates) {
          const group = productsByCustomer.get(row.customerId) ?? [];
          group.push(row);
          productsByCustomer.set(row.customerId, group);
        }

        const seen = new Set<number>();
        return orderAggregates.map((orderAggregate) => {
          if (seen.has(orderAggregate.customerId)) {
            throw new Error(`Duplicate customerId in cluster population: ${orderAggregate.customerId}`);
          }
          seen.add(orderAggregate.customerId);

          const state = stateByCustomer.get(orderAggregate.customerId);
          const tenure = tenureByCustomer.get(orderAggregate.customerId);
          const products = productsByCustomer.get(orderAggregate.customerId) ?? [];
          if (!state) throw new Error(`Missing order-state aggregate for customer ${orderAggregate.customerId}`);
          if (!tenure) throw new Error(`Missing ps_customer.date_add for customer ${orderAggregate.customerId}`);
          if (products.length === 0) throw new Error(`Missing product rows for customer ${orderAggregate.customerId}`);

          return {
            prestashopCustomerId: orderAggregate.customerId,
            features: buildFeatureVector(referenceTimeMysql, orderAggregate, state, tenure, products),
          };
        });
      } catch (error) {
        throw mapPrestashopReadError(error);
      }
    },
  };
}

function buildFeatureVector(
  referenceTimeMysql: string,
  orderAggregate: OrderAggregateRow,
  state: OrderStateAggregateRow,
  tenure: TenureRow,
  products: readonly ProductAggregateRow[],
): RawClusterFeatureVector {
  if (orderAggregate.validOrders < 2) {
    throw new Error(`Customer ${orderAggregate.customerId} has fewer than 2 valid orders (population B' violation)`);
  }
  const totalSpent = addBehaviorDecimals(products.map((row) => row.totalSpentTaxIncl));
  const totalQuantity = products.reduce((sum, row) => sum + row.totalQuantity, 0);
  const repeatedCount = products.filter((row) => row.productOrderCount >= 2).length;
  const sorted = [...products].sort((a, b) => compareDecimalDesc(a.totalSpentTaxIncl, b.totalSpentTaxIncl));
  const shares = sorted.map((row) => divideDecimalToBehaviorDecimal(row.totalSpentTaxIncl, totalSpent));
  const hhi = sumBehaviorShares(shares.map(squareBehaviorShare));

  const referenceMs = mysqlDateTimeToMs(referenceTimeMysql);
  const firstMs = mysqlDateTimeToMs(orderAggregate.firstValidOrderAt);
  const lastMs = mysqlDateTimeToMs(orderAggregate.lastValidOrderAt);
  const createdMs = mysqlDateTimeToMs(tenure.customerCreatedAt);
  const DAY_MS = 86_400_000;

  // Raw (unwinsorized) ratios — the trained model's persisted p99 cap is applied later by
  // applyFeatureTransform, never recomputed here (task Section 16).
  const totalSpentTaxIncl = Number(orderAggregate.totalSpentTaxIncl);
  const totalDiscountsTaxIncl = Number(orderAggregate.totalDiscountsTaxIncl);
  const totalShippingTaxIncl = Number(orderAggregate.totalShippingTaxIncl);

  return {
    distinctProducts: products.length,
    effectiveDiversity: Number(effectiveDiversityFromHhi(hhi)),
    averageUnitsPerOrder: totalQuantity / orderAggregate.validOrders,
    purchaseFrequencyDays: (lastMs - firstMs) / DAY_MS / (orderAggregate.validOrders - 1),
    orders365d: orderAggregate.orders365d,
    customerTenureDays: Math.floor((referenceMs - createdMs) / DAY_MS),
    repeatProductRate: Number(divideIntegerToBehaviorDecimal(repeatedCount, products.length)),
    top1Share: Number(shares[0] ?? '0.000000'),
    top3Share: Number(sumBehaviorShares(shares.slice(0, 3))),
    cancelledOrderRatio: state.cancelledOrders / state.totalOrdersAllStates,
    discountShare: totalDiscountsTaxIncl / totalSpentTaxIncl,
    shippingShare: totalShippingTaxIncl / totalSpentTaxIncl,
  };
}

// CP-R2-T03 analytics addition: post-hoc commercial metrics (task Section 14) — never a
// training input, never used by readPopulation()/buildFeatureVector() above. Reuses
// readOrderAggregates() as-is (same eligible_orders CTE, same operational-account exclusion,
// same >=2-valid-orders population) rather than writing a second query, so this can never
// silently drift from the model's own population definition.
export type ClusterCommercialAggregateRow = {
  readonly prestashopCustomerId: number;
  readonly totalSpentTaxIncl: number;
  readonly averageOrderValueTaxIncl: number;
  readonly validOrders: number;
  readonly daysSinceLastOrder: number;
};

export type ClusterCommercialAggregateReader = {
  readCommercialAggregates(): Promise<readonly ClusterCommercialAggregateRow[]>;
};

export function createMysqlClusterCommercialAggregateReader(
  pool: Pool,
  tablePrefix: string,
  referenceTimeMysql: string,
): ClusterCommercialAggregateReader {
  assertSafePrestashopTablePrefix(tablePrefix);
  const excludedAccountIds = [...excludedOperationalAccountPrestashopCustomerIds];
  if (excludedAccountIds.length === 0) {
    throw new Error('Cluster commercial aggregate reader requires at least one excluded operational account id');
  }
  const orders = `${tablePrefix}orders`;
  const customer = `${tablePrefix}customer`;
  const excludedPlaceholders = excludedAccountIds.map(() => '?').join(', ');
  const eligibleOrdersCte = `
    eligible_orders AS (
      SELECT
        o.id_order,
        o.id_customer,
        o.date_add,
        o.total_paid_tax_incl,
        o.total_discounts_tax_incl,
        o.total_shipping_tax_incl
      FROM ${orders} o
      INNER JOIN ${customer} c ON c.id_customer = o.id_customer
      WHERE o.valid = 1
        AND o.total_paid_tax_incl > 0
        AND o.id_customer > 0
        AND o.id_customer NOT IN (${excludedPlaceholders})
        AND o.date_add < ?
    )
  `;
  const referenceMs = mysqlDateTimeToMs(referenceTimeMysql);

  return {
    async readCommercialAggregates() {
      try {
        // window365Start is irrelevant to commercial aggregates (orders365d is a features-only
        // concept) — passing referenceTimeMysql again just makes that CASE WHEN branch a no-op.
        const orderAggregates = await readOrderAggregates(pool, eligibleOrdersCte, excludedAccountIds, referenceTimeMysql, referenceTimeMysql);
        return orderAggregates.map((row) => ({
          prestashopCustomerId: row.customerId,
          totalSpentTaxIncl: Number(row.totalSpentTaxIncl),
          averageOrderValueTaxIncl: Number(row.totalSpentTaxIncl) / row.validOrders,
          validOrders: row.validOrders,
          daysSinceLastOrder: Math.floor((referenceMs - mysqlDateTimeToMs(row.lastValidOrderAt)) / 86_400_000),
        }));
      } catch (error) {
        throw mapPrestashopReadError(error);
      }
    },
  };
}

function mysqlDateTimeToMs(value: string): number {
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid MySQL datetime: ${value}`);
  }
  return parsed.getTime();
}

async function readOrderAggregates(
  pool: Pool,
  eligibleOrdersCte: string,
  excludedAccountIds: readonly number[],
  referenceTimeMysql: string,
  window365StartMysql: string,
): Promise<OrderAggregateRow[]> {
  const sql = `
    WITH ${eligibleOrdersCte}
    SELECT
      eo.id_customer AS customerId,
      COUNT(DISTINCT eo.id_order) AS validOrders,
      MIN(eo.date_add) AS firstValidOrderAt,
      MAX(eo.date_add) AS lastValidOrderAt,
      COALESCE(SUM(CASE WHEN eo.date_add >= ? THEN 1 ELSE 0 END), 0) AS orders365d,
      COALESCE(SUM(eo.total_paid_tax_incl), 0) AS totalSpentTaxIncl,
      COALESCE(SUM(eo.total_discounts_tax_incl), 0) AS totalDiscountsTaxIncl,
      COALESCE(SUM(eo.total_shipping_tax_incl), 0) AS totalShippingTaxIncl
    FROM eligible_orders eo
    GROUP BY eo.id_customer
    HAVING COUNT(DISTINCT eo.id_order) >= 2
    ORDER BY eo.id_customer ASC
  `;
  const [rows] = await pool.execute<RowDataPacket[]>(sql, [
    ...excludedAccountIds,
    referenceTimeMysql,
    window365StartMysql,
  ]);
  return rows.map((row) => ({
    customerId: coerceNonNegativeSafeInteger(row.customerId, 'customerId'),
    validOrders: coerceNonNegativeSafeInteger(row.validOrders, 'validOrders'),
    firstValidOrderAt: String(row.firstValidOrderAt),
    lastValidOrderAt: String(row.lastValidOrderAt),
    orders365d: coerceNonNegativeSafeInteger(row.orders365d, 'orders365d'),
    totalSpentTaxIncl: String(row.totalSpentTaxIncl),
    totalDiscountsTaxIncl: String(row.totalDiscountsTaxIncl),
    totalShippingTaxIncl: String(row.totalShippingTaxIncl),
  }));
}

async function readOrderStateAggregates(pool: Pool, ordersTable: string, referenceTimeMysql: string): Promise<OrderStateAggregateRow[]> {
  const sql = `
    SELECT
      o.id_customer AS customerId,
      COUNT(*) AS totalOrdersAllStates,
      COALESCE(SUM(CASE WHEN o.current_state = 6 THEN 1 ELSE 0 END), 0) AS cancelledOrders
    FROM ${ordersTable} o
    WHERE o.id_customer > 0
      AND o.date_add < ?
    GROUP BY o.id_customer
  `;
  const [rows] = await pool.execute<RowDataPacket[]>(sql, [referenceTimeMysql]);
  return rows.map((row) => ({
    customerId: coerceNonNegativeSafeInteger(row.customerId, 'customerId'),
    totalOrdersAllStates: coerceNonNegativeSafeInteger(row.totalOrdersAllStates, 'totalOrdersAllStates'),
    cancelledOrders: coerceNonNegativeSafeInteger(row.cancelledOrders, 'cancelledOrders'),
  }));
}

async function readCustomerTenure(pool: Pool, customerTable: string): Promise<TenureRow[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id_customer AS customerId, date_add AS customerCreatedAt FROM ${customerTable} WHERE id_customer > 0`,
  );
  return rows.map((row) => ({
    customerId: coerceNonNegativeSafeInteger(row.customerId, 'customerId'),
    customerCreatedAt: String(row.customerCreatedAt),
  }));
}

async function readProductAggregates(
  pool: Pool,
  eligibleOrdersCte: string,
  orderDetailTable: string,
  excludedAccountIds: readonly number[],
  referenceTimeMysql: string,
): Promise<ProductAggregateRow[]> {
  const sql = `
    WITH ${eligibleOrdersCte}
    SELECT
      eo.id_customer AS customerId,
      od.product_id AS productId,
      COUNT(DISTINCT eo.id_order) AS productOrderCount,
      COALESCE(SUM(od.product_quantity), 0) AS totalQuantity,
      COALESCE(SUM(od.total_price_tax_incl), 0) AS totalSpentTaxIncl
    FROM eligible_orders eo
    INNER JOIN ${orderDetailTable} od ON od.id_order = eo.id_order
    GROUP BY eo.id_customer, od.product_id
  `;
  const [rows] = await pool.execute<RowDataPacket[]>(sql, [...excludedAccountIds, referenceTimeMysql]);
  return rows.map((row) => ({
    customerId: coerceNonNegativeSafeInteger(row.customerId, 'customerId'),
    productOrderCount: coerceNonNegativeSafeInteger(row.productOrderCount, 'productOrderCount'),
    totalQuantity: coerceNonNegativeSafeInteger(row.totalQuantity, 'totalQuantity'),
    totalSpentTaxIncl: String(row.totalSpentTaxIncl),
  }));
}
