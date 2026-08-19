import type { Pool, RowDataPacket } from 'mysql2/promise';
import { excludedOperationalAccountPrestashopCustomerIds } from '../../../src/domain/customer-rfm/operational-account-exclusion-policy.js';

const SAFE_PREFIX_PATTERN = /^[A-Za-z0-9_]+$/;

export function assertSafeTablePrefix(prefix: string): void {
  if (!SAFE_PREFIX_PATTERN.test(prefix)) {
    throw new Error(`Unsafe PrestaShop table prefix: "${prefix}"`);
  }
}

export type RawCustomerOrderAggregate = {
  readonly customerId: number;
  readonly validOrders: number;
  readonly totalSpentTaxIncl: string;
  readonly firstValidOrderAt: string;
  readonly lastValidOrderAt: string;
  readonly totalDiscountsTaxIncl: string;
  readonly totalShippingTaxIncl: string;
  readonly orders365d: number;
};

export type RawCustomerOrderStateAggregate = {
  readonly customerId: number;
  readonly totalOrdersAllStates: number;
  readonly cancelledOrders: number;
};

export type RawCustomerTenure = {
  readonly customerId: number;
  readonly customerCreatedAt: string;
};

export type RawCustomerProductAggregate = {
  readonly customerId: number;
  readonly productId: number;
  readonly productOrderCount: number;
  readonly totalQuantity: number;
  readonly totalSpentTaxIncl: string;
};

export type ClusteringPopulationReader = {
  readOrderAggregates(): Promise<readonly RawCustomerOrderAggregate[]>;
  readOrderStateAggregates(): Promise<readonly RawCustomerOrderStateAggregate[]>;
  readCustomerTenure(): Promise<readonly RawCustomerTenure[]>;
  readProductAggregates(): Promise<readonly RawCustomerProductAggregate[]>;
};

// Same eligibility base the shipped RFM population reader uses (mysql-rfm-population-reader.ts):
// valid=1, total_paid_tax_incl > 0, id_customer > 0, NOT IN the 4 confirmed operational
// accounts. Unlike RFM's population C (365-day window), this population is lifetime (no lower
// date bound) — only bounded above by referenceTime for reproducibility (Section 55: a
// customer's population membership must not silently change because the query ran later).
// Reuses all-shops-pooled scope, matching the reader that actually shipped (see the readiness
// audit Step 5's flagged T10A-3-vs-T11A inconsistency — not resolved here, flagged in the
// final report as instructed).
export function createClusteringPopulationReader(
  pool: Pool,
  tablePrefix: string,
  referenceTimeMysql: string,
  window365StartMysql: string,
): ClusteringPopulationReader {
  assertSafeTablePrefix(tablePrefix);
  const excludedAccountIds = [...excludedOperationalAccountPrestashopCustomerIds];
  if (excludedAccountIds.length === 0) {
    throw new Error('Clustering population reader requires at least one excluded operational account id');
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
    async readOrderAggregates() {
      const sql = `
        WITH ${eligibleOrdersCte}
        SELECT
          eo.id_customer AS customerId,
          COUNT(DISTINCT eo.id_order) AS validOrders,
          COALESCE(SUM(eo.total_paid_tax_incl), 0) AS totalSpentTaxIncl,
          MIN(eo.date_add) AS firstValidOrderAt,
          MAX(eo.date_add) AS lastValidOrderAt,
          COALESCE(SUM(eo.total_discounts_tax_incl), 0) AS totalDiscountsTaxIncl,
          COALESCE(SUM(eo.total_shipping_tax_incl), 0) AS totalShippingTaxIncl,
          COALESCE(SUM(CASE WHEN eo.date_add >= ? THEN 1 ELSE 0 END), 0) AS orders365d
        FROM eligible_orders eo
        GROUP BY eo.id_customer
        HAVING COUNT(DISTINCT eo.id_order) >= 2
        ORDER BY eo.id_customer ASC
      `;
      const rows = await execute(pool, sql, [...excludedAccountIds, referenceTimeMysql, window365StartMysql]);
      return rows.map(toOrderAggregate);
    },

    async readOrderStateAggregates() {
      const sql = `
        SELECT
          o.id_customer AS customerId,
          COUNT(*) AS totalOrdersAllStates,
          COALESCE(SUM(CASE WHEN o.current_state = 6 THEN 1 ELSE 0 END), 0) AS cancelledOrders
        FROM ${orders} o
        WHERE o.id_customer > 0
          AND o.date_add < ?
        GROUP BY o.id_customer
      `;
      const rows = await execute(pool, sql, [referenceTimeMysql]);
      return rows.map(toOrderStateAggregate);
    },

    async readCustomerTenure() {
      const sql = `
        SELECT id_customer AS customerId, date_add AS customerCreatedAt
        FROM ${customer}
        WHERE id_customer > 0
      `;
      const rows = await execute(pool, sql, []);
      return rows.map(toTenure);
    },

    async readProductAggregates() {
      const sql = `
        WITH ${eligibleOrdersCte}
        SELECT
          eo.id_customer AS customerId,
          od.product_id AS productId,
          COUNT(DISTINCT eo.id_order) AS productOrderCount,
          COALESCE(SUM(od.product_quantity), 0) AS totalQuantity,
          COALESCE(SUM(od.total_price_tax_incl), 0) AS totalSpentTaxIncl
        FROM eligible_orders eo
        INNER JOIN ${orderDetail} od ON od.id_order = eo.id_order
        GROUP BY eo.id_customer, od.product_id
      `;
      const rows = await execute(pool, sql, [...excludedAccountIds, referenceTimeMysql]);
      return rows.map(toProductAggregate);
    },
  };
}

async function execute(pool: Pool, sql: string, params: readonly unknown[]): Promise<RowDataPacket[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(sql, params as Array<string | number | null>);
  return rows;
}

function toOrderAggregate(row: RowDataPacket): RawCustomerOrderAggregate {
  return {
    customerId: coercePositiveInt(row.customerId, 'customerId'),
    validOrders: coercePositiveInt(row.validOrders, 'validOrders'),
    totalSpentTaxIncl: coerceDecimalString(row.totalSpentTaxIncl, 'totalSpentTaxIncl'),
    firstValidOrderAt: coerceIsoDateTime(row.firstValidOrderAt, 'firstValidOrderAt'),
    lastValidOrderAt: coerceIsoDateTime(row.lastValidOrderAt, 'lastValidOrderAt'),
    totalDiscountsTaxIncl: coerceDecimalString(row.totalDiscountsTaxIncl, 'totalDiscountsTaxIncl'),
    totalShippingTaxIncl: coerceDecimalString(row.totalShippingTaxIncl, 'totalShippingTaxIncl'),
    orders365d: coerceNonNegativeInt(row.orders365d, 'orders365d'),
  };
}

function toOrderStateAggregate(row: RowDataPacket): RawCustomerOrderStateAggregate {
  return {
    customerId: coercePositiveInt(row.customerId, 'customerId'),
    totalOrdersAllStates: coercePositiveInt(row.totalOrdersAllStates, 'totalOrdersAllStates'),
    cancelledOrders: coerceNonNegativeInt(row.cancelledOrders, 'cancelledOrders'),
  };
}

function toTenure(row: RowDataPacket): RawCustomerTenure {
  return {
    customerId: coercePositiveInt(row.customerId, 'customerId'),
    customerCreatedAt: coerceIsoDateTime(row.customerCreatedAt, 'customerCreatedAt'),
  };
}

function toProductAggregate(row: RowDataPacket): RawCustomerProductAggregate {
  return {
    customerId: coercePositiveInt(row.customerId, 'customerId'),
    productId: coercePositiveInt(row.productId, 'productId'),
    productOrderCount: coercePositiveInt(row.productOrderCount, 'productOrderCount'),
    totalQuantity: coerceNonNegativeInt(row.totalQuantity, 'totalQuantity'),
    totalSpentTaxIncl: coerceDecimalString(row.totalSpentTaxIncl, 'totalSpentTaxIncl'),
  };
}

function coercePositiveInt(value: unknown, field: string): number {
  const numeric = coerceNonNegativeInt(value, field);
  if (numeric <= 0) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return numeric;
}

function coerceNonNegativeInt(value: unknown, field: string): number {
  let numeric: number;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    numeric = Number(value);
  } else if (typeof value === 'number') {
    numeric = value;
  } else {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return numeric;
}

function coerceDecimalString(value: unknown, field: string): string {
  const asString = typeof value === 'number' ? String(value) : value;
  if (typeof asString !== 'string' || !/^\d+(\.\d+)?$/.test(asString)) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return asString;
}

function coerceIsoDateTime(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return parsed.toISOString();
}
