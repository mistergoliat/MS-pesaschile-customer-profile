import type { RowDataPacket } from 'mysql2/promise';
import type {
  RfmPopulationSourceRow,
  RfmSnapshotDiagnostics,
} from '../../domain/customer-rfm/index.js';
import { formatRfmDecimal } from '../../domain/customer-rfm/index.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import {
  assertSafePrestashopTablePrefix,
  coerceNonNegativeSafeInteger,
  mapPrestashopReadError,
} from './commercial-summary-reader-utils.js';

const REQUIRED_COLUMNS = {
  orders: [
    'id_order',
    'id_customer',
    'id_currency',
    'id_shop',
    'valid',
    'date_add',
    'total_paid_tax_incl',
    'conversion_rate',
  ],
  customer: ['id_customer'],
  currency: ['id_currency', 'iso_code'],
  order_detail: ['id_order', 'product_quantity_refunded', 'total_refunded_tax_incl'],
} as const;

export type RfmPopulationReader = {
  verifySchema(): Promise<void>;
  readPopulation(windowStartInclusive: string, windowEndExclusive: string): Promise<readonly RfmPopulationSourceRow[]>;
  readDiagnostics(windowStartInclusive: string, windowEndExclusive: string): Promise<RfmSnapshotDiagnostics>;
};

type PopulationRow = RowDataPacket & {
  prestashopCustomerId: number | string;
  firstValidOrderAt: string;
  lastValidOrderAt: string;
  frequencyOrders: number | string;
  grossOrderValueTaxIncl: string | number;
  distinctShopCount: number | string;
};

type DiagnosticsRow = RowDataPacket & Record<string, string | number | null>;

export function createMysqlRfmPopulationReader(executor: QueryExecutor, tablePrefix: string): RfmPopulationReader {
  assertSafePrestashopTablePrefix(tablePrefix);
  const tables = {
    orders: `${tablePrefix}orders`,
    customer: `${tablePrefix}customer`,
    currency: `${tablePrefix}currency`,
    orderDetail: `${tablePrefix}order_detail`,
  };

  return {
    async verifySchema() {
      try {
        await verifyRequiredTable(executor, tables.orders, REQUIRED_COLUMNS.orders);
        await verifyRequiredTable(executor, tables.customer, REQUIRED_COLUMNS.customer);
        await verifyRequiredTable(executor, tables.currency, REQUIRED_COLUMNS.currency);
        await verifyRequiredTable(executor, tables.orderDetail, REQUIRED_COLUMNS.order_detail);
      } catch (error) {
        throw mapPrestashopReadError(error);
      }
    },

    async readPopulation(windowStartInclusive, windowEndExclusive) {
      const sql = `
        WITH active_customers AS (
          SELECT DISTINCT o.id_customer
          FROM ${tables.orders} o
          INNER JOIN ${tables.customer} c
            ON c.id_customer = o.id_customer
          WHERE o.valid = 1
            AND o.id_customer > 0
            AND o.date_add >= ?
            AND o.date_add < ?
        )
        SELECT
          ac.id_customer AS prestashopCustomerId,
          MIN(CASE WHEN o.date_add >= ? AND o.date_add < ? THEN o.date_add ELSE NULL END) AS firstValidOrderAt,
          MAX(o.date_add) AS lastValidOrderAt,
          COUNT(DISTINCT CASE WHEN o.date_add >= ? AND o.date_add < ? THEN o.id_order ELSE NULL END)
            AS frequencyOrders,
          COALESCE(
            SUM(CASE WHEN o.date_add >= ? AND o.date_add < ? THEN o.total_paid_tax_incl ELSE 0 END),
            0
          ) AS grossOrderValueTaxIncl,
          COUNT(DISTINCT CASE WHEN o.date_add >= ? AND o.date_add < ? THEN o.id_shop ELSE NULL END)
            AS distinctShopCount
        FROM active_customers ac
        INNER JOIN ${tables.orders} o
          ON o.id_customer = ac.id_customer
         AND o.valid = 1
         AND o.date_add < ?
        GROUP BY ac.id_customer
        ORDER BY ac.id_customer ASC
      `;
      try {
        const rows = await executor.execute(sql, [
          windowStartInclusive,
          windowEndExclusive,
          windowStartInclusive,
          windowEndExclusive,
          windowStartInclusive,
          windowEndExclusive,
          windowStartInclusive,
          windowEndExclusive,
          windowStartInclusive,
          windowEndExclusive,
          windowEndExclusive,
        ]);
        return (rows as PopulationRow[]).map(toPopulationSourceRow);
      } catch (error) {
        throw mapPrestashopReadError(error);
      }
    },

    async readDiagnostics(windowStartInclusive, windowEndExclusive) {
      try {
        const [
          historical,
          totals,
          currency,
          refunds,
          shopRows,
          crossShop,
          customerQuality,
        ] = await Promise.all([
          one(executor, `
            SELECT COUNT(DISTINCT o.id_customer) AS historicalCustomerCount
            FROM ${tables.orders} o
            INNER JOIN ${tables.customer} c
              ON c.id_customer = o.id_customer
            WHERE o.valid = 1
              AND o.id_customer > 0
              AND o.date_add < ?
          `, [windowEndExclusive]),
          one(executor, `
            SELECT
              COUNT(DISTINCT o.id_order) AS validOrderCount,
              COALESCE(SUM(o.total_paid_tax_incl), 0) AS grossOrderValueTaxIncl,
              COALESCE(SUM(CASE WHEN o.total_paid_tax_incl = 0 THEN 1 ELSE 0 END), 0) AS zeroAmountOrderCount,
              (
                SELECT COUNT(*)
                FROM ${tables.orders} invalid_orders
                WHERE invalid_orders.valid = 0
                  AND invalid_orders.id_customer > 0
                  AND invalid_orders.date_add >= ?
                  AND invalid_orders.date_add < ?
              ) AS invalidOrderExcludedCount,
              (
                SELECT COUNT(*)
                FROM ${tables.orders} future_orders
                WHERE future_orders.valid = 1
                  AND future_orders.id_customer > 0
                  AND future_orders.date_add >= ?
              ) AS futureOrderExcludedCount
            FROM ${tables.orders} o
            INNER JOIN ${tables.customer} c
              ON c.id_customer = o.id_customer
            WHERE o.valid = 1
              AND o.id_customer > 0
              AND o.date_add >= ?
              AND o.date_add < ?
          `, [windowStartInclusive, windowEndExclusive, windowEndExclusive, windowStartInclusive, windowEndExclusive]),
          one(executor, `
            SELECT
              COUNT(DISTINCT o.id_currency) AS distinctCurrencyCount,
              MIN(c.iso_code) AS currencyCode,
              COUNT(DISTINCT o.conversion_rate) AS distinctConversionRateCount
            FROM ${tables.orders} o
            INNER JOIN ${tables.customer} pc
              ON pc.id_customer = o.id_customer
            LEFT JOIN ${tables.currency} c
              ON c.id_currency = o.id_currency
            WHERE o.valid = 1
              AND o.id_customer > 0
              AND o.date_add >= ?
              AND o.date_add < ?
          `, [windowStartInclusive, windowEndExclusive]),
          one(executor, `
            SELECT
              COALESCE(SUM(CASE WHEN od.product_quantity_refunded > 0 THEN 1 ELSE 0 END), 0) AS refundedLineCount,
              COUNT(DISTINCT CASE
                WHEN od.product_quantity_refunded > 0 OR od.total_refunded_tax_incl > 0
                THEN o.id_order
                ELSE NULL
              END) AS partiallyRefundedOrderCount,
              COALESCE(SUM(od.total_refunded_tax_incl), 0) AS partiallyRefundedAmountObserved
            FROM ${tables.orders} o
            INNER JOIN ${tables.customer} c
              ON c.id_customer = o.id_customer
            INNER JOIN ${tables.orderDetail} od
              ON od.id_order = o.id_order
            WHERE o.valid = 1
              AND o.id_customer > 0
              AND o.date_add >= ?
              AND o.date_add < ?
          `, [windowStartInclusive, windowEndExclusive]),
          executor.execute(`
            SELECT
              o.id_shop AS shopId,
              COUNT(DISTINCT o.id_customer) AS customers,
              COUNT(DISTINCT o.id_order) AS orders,
              COALESCE(SUM(o.total_paid_tax_incl), 0) AS grossOrderValueTaxIncl
            FROM ${tables.orders} o
            INNER JOIN ${tables.customer} c
              ON c.id_customer = o.id_customer
            WHERE o.valid = 1
              AND o.id_customer > 0
              AND o.date_add >= ?
              AND o.date_add < ?
            GROUP BY o.id_shop
            ORDER BY o.id_shop ASC
          `, [windowStartInclusive, windowEndExclusive]),
          one(executor, `
            SELECT
              COUNT(*) AS crossShopCustomers
            FROM (
              SELECT o.id_customer, COUNT(DISTINCT o.id_shop) AS shopCount
              FROM ${tables.orders} o
              INNER JOIN ${tables.customer} c
                ON c.id_customer = o.id_customer
              WHERE o.valid = 1
                AND o.id_customer > 0
                AND o.date_add >= ?
                AND o.date_add < ?
              GROUP BY o.id_customer
              HAVING shopCount > 1
            ) cross_shop
          `, [windowStartInclusive, windowEndExclusive]),
          one(executor, `
            SELECT
              COALESCE(SUM(CASE WHEN o.id_customer IS NULL OR o.id_customer <= 0 THEN 1 ELSE 0 END), 0)
                AS unusableCustomerOrderCount,
              COALESCE(SUM(CASE WHEN o.id_customer > 0 AND c.id_customer IS NULL THEN 1 ELSE 0 END), 0)
                AS missingPrestashopCustomerOrderCount
            FROM ${tables.orders} o
            LEFT JOIN ${tables.customer} c
              ON c.id_customer = o.id_customer
            WHERE o.valid = 1
              AND o.date_add >= ?
              AND o.date_add < ?
          `, [windowStartInclusive, windowEndExclusive]),
        ]);

        const perShop = (shopRows as DiagnosticsRow[]).map((row) => ({
          shopId: coerceNonNegativeSafeInteger(row.shopId, 'shopId'),
          customers: coerceNonNegativeSafeInteger(row.customers, 'shop customers'),
          orders: coerceNonNegativeSafeInteger(row.orders, 'shop orders'),
          grossOrderValueTaxIncl: formatRfmDecimal(String(row.grossOrderValueTaxIncl ?? '0')),
        }));

        return {
          historicalCustomerCount: coerceNonNegativeSafeInteger(historical.historicalCustomerCount, 'historicalCustomerCount'),
          validOrderCount: coerceNonNegativeSafeInteger(totals.validOrderCount, 'validOrderCount'),
          grossOrderValueTaxIncl: formatRfmDecimal(String(totals.grossOrderValueTaxIncl ?? '0')),
          currency: {
            distinctCurrencyCount: coerceNonNegativeSafeInteger(currency.distinctCurrencyCount, 'distinctCurrencyCount'),
            currencyCode: coerceNullableNonEmptyString(currency.currencyCode, 'currencyCode'),
            distinctConversionRateCount: coerceNonNegativeSafeInteger(
              currency.distinctConversionRateCount,
              'distinctConversionRateCount',
            ),
          },
          refunds: {
            refundedLineCount: coerceNonNegativeSafeInteger(refunds.refundedLineCount, 'refundedLineCount'),
            partiallyRefundedOrderCount: coerceNonNegativeSafeInteger(
              refunds.partiallyRefundedOrderCount,
              'partiallyRefundedOrderCount',
            ),
            partiallyRefundedAmountObserved: formatRfmDecimal(String(refunds.partiallyRefundedAmountObserved ?? '0')),
          },
          shops: {
            distinctShopCount: perShop.length,
            perShop,
            crossShopCustomers: coerceNonNegativeSafeInteger(crossShop.crossShopCustomers, 'crossShopCustomers'),
          },
          exclusions: {
            invalidOrderExcludedCount: coerceNonNegativeSafeInteger(
              totals.invalidOrderExcludedCount,
              'invalidOrderExcludedCount',
            ),
            futureOrderExcludedCount: coerceNonNegativeSafeInteger(
              totals.futureOrderExcludedCount,
              'futureOrderExcludedCount',
            ),
            zeroAmountOrderCount: coerceNonNegativeSafeInteger(totals.zeroAmountOrderCount, 'zeroAmountOrderCount'),
            unusableCustomerOrderCount: coerceNonNegativeSafeInteger(
              customerQuality.unusableCustomerOrderCount,
              'unusableCustomerOrderCount',
            ),
            missingPrestashopCustomerOrderCount: coerceNonNegativeSafeInteger(
              customerQuality.missingPrestashopCustomerOrderCount,
              'missingPrestashopCustomerOrderCount',
            ),
          },
        } satisfies RfmSnapshotDiagnostics;
      } catch (error) {
        throw mapPrestashopReadError(error);
      }
    },
  };
}

async function verifyRequiredTable(
  executor: QueryExecutor,
  tableName: string,
  requiredColumns: readonly string[],
): Promise<void> {
  const rows = await executor.execute(
    `
      SELECT column_name AS columnName
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
    `,
    [tableName],
  );
  const present = new Set(rows.map((row) => String(row.columnName)));
  const missing = requiredColumns.filter((column) => !present.has(column));
  if (missing.length > 0) {
    throw new Error(`Missing required RFM source columns on ${tableName}: ${missing.join(', ')}`);
  }
}

async function one(executor: QueryExecutor, sql: string, params: readonly unknown[]): Promise<DiagnosticsRow> {
  const rows = await executor.execute(sql, params);
  const row = rows[0] as DiagnosticsRow | undefined;
  if (!row) {
    throw new Error('RFM diagnostic query returned no row');
  }
  return row;
}

function toPopulationSourceRow(row: PopulationRow): RfmPopulationSourceRow {
  return {
    prestashopCustomerId: coercePositiveInteger(row.prestashopCustomerId, 'prestashopCustomerId'),
    firstValidOrderAt: coerceNonEmptyString(row.firstValidOrderAt, 'firstValidOrderAt'),
    lastValidOrderAt: coerceNonEmptyString(row.lastValidOrderAt, 'lastValidOrderAt'),
    frequencyOrders: coercePositiveInteger(row.frequencyOrders, 'frequencyOrders'),
    grossOrderValueTaxIncl: formatRfmDecimal(String(row.grossOrderValueTaxIncl ?? '0')),
    distinctShopCount: coercePositiveInteger(row.distinctShopCount, 'distinctShopCount'),
  };
}

function coercePositiveInteger(value: unknown, field: string): number {
  const parsed = coerceNonNegativeSafeInteger(value, field);
  if (parsed <= 0) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return parsed;
}

function coerceNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return value;
}

function coerceNullableNonEmptyString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return coerceNonEmptyString(value, field);
}
