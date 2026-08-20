import type { Pool, RowDataPacket } from 'mysql2/promise';
import { excludedOperationalAccountPrestashopCustomerIds } from '../../domain/customer-rfm/operational-account-exclusion-policy.js';
import type { CustomerFeatureProductAggregate, CustomerFeatureSourceRow } from '../../domain/customer-analytics/index.js';
import { assertSafePrestashopTablePrefix, coerceNonNegativeSafeInteger, mapPrestashopReadError } from './commercial-summary-reader-utils.js';

// CP-R3-T01 production reader — Population B (>=1 valid order lifetime), deliberately
// broader than mysql-cluster-population-reader.ts's Population B' (>=2 valid orders, task
// Section 12). Shares the exact same "valid order" eligibility (task Section 17: never a new
// definition) and the same operational-account exclusion policy, but is a separate,
// independent implementation — same precedent as clustering staying independent from RFM's
// reader (both documented in mysql-cluster-population-reader.ts's own header comment) rather
// than one capability importing another's SQL and risking silent coupling.
export type CustomerFeatureReader = {
  readPopulation(): Promise<readonly CustomerFeatureSourceRow[]>;
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
  productId: number;
  productOrderCount: number;
  totalQuantity: number;
  totalSpentTaxIncl: string;
};

export function createMysqlCustomerFeatureReader(
  pool: Pool,
  tablePrefix: string,
  referenceTimeMysql: string,
  window365StartMysql: string,
): CustomerFeatureReader {
  assertSafePrestashopTablePrefix(tablePrefix);
  const excludedAccountIds = [...excludedOperationalAccountPrestashopCustomerIds];
  if (excludedAccountIds.length === 0) {
    throw new Error('Customer feature reader requires at least one excluded operational account id');
  }
  const excludedPlaceholders = excludedAccountIds.map(() => '?').join(', ');
  const orders = `${tablePrefix}orders`;
  const customer = `${tablePrefix}customer`;
  const orderDetail = `${tablePrefix}order_detail`;

  // Same eligibility policy as mysql-cluster-population-reader.ts's eligible_orders CTE
  // (task Section 17): valid=1, total_paid_tax_incl>0, id_customer>0 and not an excluded
  // operational account, date_add strictly before referenceTime. No seller-service
  // subtraction here — that is RFM's Monetary-specific policy (order-detail-level product
  // exclusion for confirmed seller-service SKUs), not part of the general "valid order"
  // definition every other capability shares.
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
            throw new Error(`Duplicate customerId in customer feature population: ${orderAggregate.customerId}`);
          }
          seen.add(orderAggregate.customerId);

          const state = stateByCustomer.get(orderAggregate.customerId);
          const tenure = tenureByCustomer.get(orderAggregate.customerId);
          const products = productsByCustomer.get(orderAggregate.customerId) ?? [];
          if (!state) throw new Error(`Missing order-state aggregate for customer ${orderAggregate.customerId}`);
          if (!tenure) throw new Error(`Missing ${tablePrefix}customer.date_add for customer ${orderAggregate.customerId}`);
          if (products.length === 0) throw new Error(`Missing product rows for customer ${orderAggregate.customerId}`);

          const sourceRow: CustomerFeatureSourceRow = {
            prestashopCustomerId: orderAggregate.customerId,
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
            products: products
              .map(
                (row): CustomerFeatureProductAggregate => ({
                  productId: row.productId,
                  productOrderCount: row.productOrderCount,
                  totalQuantity: row.totalQuantity,
                  totalSpentTaxIncl: row.totalSpentTaxIncl,
                }),
              )
              .sort((a, b) => a.productId - b.productId),
          };
          return sourceRow;
        });
      } catch (error) {
        throw mapPrestashopReadError(error);
      }
    },
  };
}

async function readOrderAggregates(
  pool: Pool,
  eligibleOrdersCte: string,
  excludedAccountIds: readonly number[],
  referenceTimeMysql: string,
  window365StartMysql: string,
): Promise<OrderAggregateRow[]> {
  // No HAVING COUNT(...) >= 2 here — Population B (this reader) includes single-order
  // customers; population B' (clustering-only) is the narrower one. Every eligible customer
  // with >=1 valid order is in scope.
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
    productId: coerceNonNegativeSafeInteger(row.productId, 'productId'),
    productOrderCount: coerceNonNegativeSafeInteger(row.productOrderCount, 'productOrderCount'),
    totalQuantity: coerceNonNegativeSafeInteger(row.totalQuantity, 'totalQuantity'),
    totalSpentTaxIncl: String(row.totalSpentTaxIncl),
  }));
}
