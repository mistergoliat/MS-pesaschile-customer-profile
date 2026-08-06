import type { RowDataPacket } from 'mysql2/promise';
import type {
  RfmPopulationSourceRow,
  RfmSnapshotDiagnostics,
} from '../../domain/customer-rfm/index.js';
import {
  defaultConfirmedSellerServiceProductIds,
  excludedOperationalAccountPrestashopCustomerIds,
  formatRfmDecimal,
  sellerServiceExclusionPolicyVersion,
} from '../../domain/customer-rfm/index.js';
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
  order_detail: ['id_order', 'product_id', 'total_price_tax_incl', 'product_quantity_refunded', 'total_refunded_tax_incl'],
  order_cart_rule: ['id_order', 'id_cart_rule'],
  cart_rule: ['id_cart_rule', 'reduction_product'],
} as const;

// Every eligible-population query in this reader shares this exact universe definition so
// Frequency, Monetary, Recency and every diagnostic agree on who/what counts. See
// docs/releases/CP-R1-T11A4-approved-monetary-policy.md.
//   - o.valid = 1                                  PrestaShop-confirmed order.
//   - o.total_paid_tax_incl > 0                     excludes neutralized/free-order zero totals.
//   - o.id_customer > 0 AND NOT IN (...)            excludes unusable ids and the 4 confirmed
//                                                    operational accounts (versioned policy,
//                                                    never a name/email/frequency heuristic).
//   - seller-service lines subtracted per order      SUM(order_detail.total_price_tax_incl) for
//                                                    confirmed seller-service product ids,
//                                                    floored at 0 — shipping stays included
//                                                    because it is never touched.
export type RfmPopulationReaderPolicy = {
  readonly confirmedSellerServiceProductIds: readonly number[];
  readonly excludedOperationalAccountPrestashopCustomerIds: readonly number[];
};

export const defaultRfmPopulationReaderPolicy: RfmPopulationReaderPolicy = {
  confirmedSellerServiceProductIds: defaultConfirmedSellerServiceProductIds,
  excludedOperationalAccountPrestashopCustomerIds,
};

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

export function createMysqlRfmPopulationReader(
  executor: QueryExecutor,
  tablePrefix: string,
  policy: RfmPopulationReaderPolicy = defaultRfmPopulationReaderPolicy,
): RfmPopulationReader {
  assertSafePrestashopTablePrefix(tablePrefix);
  const tables = {
    orders: `${tablePrefix}orders`,
    customer: `${tablePrefix}customer`,
    currency: `${tablePrefix}currency`,
    orderDetail: `${tablePrefix}order_detail`,
    orderCartRule: `${tablePrefix}order_cart_rule`,
    cartRule: `${tablePrefix}cart_rule`,
  };
  const sellerServiceIds = [...policy.confirmedSellerServiceProductIds];
  const excludedAccountIds = [...policy.excludedOperationalAccountPrestashopCustomerIds];
  if (sellerServiceIds.length === 0) {
    throw new Error('RFM population reader requires at least one confirmed seller-service product id');
  }
  if (excludedAccountIds.length === 0) {
    throw new Error('RFM population reader requires at least one excluded operational account id');
  }
  const sellerServicePlaceholders = sellerServiceIds.map(() => '?').join(', ');
  const excludedAccountPlaceholders = excludedAccountIds.map(() => '?').join(', ');

  const sellerServiceByOrderCte = `
    seller_service_by_order AS (
      SELECT
        od.id_order,
        SUM(od.total_price_tax_incl) AS seller_service_tax_incl
      FROM ${tables.orderDetail} od
      WHERE od.product_id IN (${sellerServicePlaceholders})
      GROUP BY od.id_order
    )
  `;

  // windowStart/windowEnd (2 placeholders) must be appended by the caller, in that order,
  // after sellerServiceIds and excludedAccountIds.
  const eligibleOrdersCte = `
    eligible_orders AS (
      SELECT
        o.id_order,
        o.id_customer,
        o.date_add,
        o.id_shop,
        o.id_currency,
        o.conversion_rate,
        o.total_paid_tax_incl,
        COALESCE(sso.seller_service_tax_incl, 0) AS seller_service_tax_incl,
        GREATEST(o.total_paid_tax_incl - COALESCE(sso.seller_service_tax_incl, 0), 0) AS eligible_order_monetary_tax_incl
      FROM ${tables.orders} o
      INNER JOIN ${tables.customer} c
        ON c.id_customer = o.id_customer
      LEFT JOIN seller_service_by_order sso
        ON sso.id_order = o.id_order
      WHERE o.valid = 1
        AND o.total_paid_tax_incl > 0
        AND o.id_customer > 0
        AND o.id_customer NOT IN (${excludedAccountPlaceholders})
        AND o.date_add >= ?
        AND o.date_add < ?
    )
  `;

  return {
    async verifySchema() {
      try {
        await verifyRequiredTable(executor, tables.orders, REQUIRED_COLUMNS.orders);
        await verifyRequiredTable(executor, tables.customer, REQUIRED_COLUMNS.customer);
        await verifyRequiredTable(executor, tables.currency, REQUIRED_COLUMNS.currency);
        await verifyRequiredTable(executor, tables.orderDetail, REQUIRED_COLUMNS.order_detail);
        await verifyRequiredTable(executor, tables.orderCartRule, REQUIRED_COLUMNS.order_cart_rule);
        await verifyRequiredTable(executor, tables.cartRule, REQUIRED_COLUMNS.cart_rule);
      } catch (error) {
        throw mapPrestashopReadError(error);
      }
    },

    async readPopulation(windowStartInclusive, windowEndExclusive) {
      const sql = `
        WITH ${sellerServiceByOrderCte},
        ${eligibleOrdersCte}
        SELECT
          eo.id_customer AS prestashopCustomerId,
          MIN(eo.date_add) AS firstValidOrderAt,
          MAX(eo.date_add) AS lastValidOrderAt,
          COUNT(DISTINCT eo.id_order) AS frequencyOrders,
          COALESCE(SUM(eo.eligible_order_monetary_tax_incl), 0) AS grossOrderValueTaxIncl,
          COUNT(DISTINCT eo.id_shop) AS distinctShopCount
        FROM eligible_orders eo
        GROUP BY eo.id_customer
        ORDER BY eo.id_customer ASC
      `;
      try {
        const rows = await executor.execute(sql, [
          ...sellerServiceIds,
          ...excludedAccountIds,
          windowStartInclusive,
          windowEndExclusive,
        ]);
        return (rows as PopulationRow[]).map(toPopulationSourceRow);
      } catch (error) {
        throw mapPrestashopReadError(error);
      }
    },

    async readDiagnostics(windowStartInclusive, windowEndExclusive) {
      try {
        // Consolidated into 5 concurrent queries (not one per concern) so this stays inside
        // the connection pool's concurrency limit — 8-11 concurrent CTE-heavy queries here
        // queued for a free connection long enough to blow the per-query timeout even though
        // no single query was slow on its own.
        const [
          historical,
          summary,
          refunds,
          shopRows,
          rawExclusions,
        ] = await Promise.all([
          // Historical: same eligibility filters (amount + account, no seller-service
          // subtraction needed for a plain customer count), unbounded window start — "how many
          // customers have ever placed an eligible order before this snapshot".
          one(executor, `
            SELECT COUNT(DISTINCT o.id_customer) AS historicalCustomerCount
            FROM ${tables.orders} o
            INNER JOIN ${tables.customer} c
              ON c.id_customer = o.id_customer
            WHERE o.valid = 1
              AND o.total_paid_tax_incl > 0
              AND o.id_customer > 0
              AND o.id_customer NOT IN (${excludedAccountPlaceholders})
              AND o.date_add < ?
          `, [...excludedAccountIds, windowEndExclusive]),

          // Totals, currency, seller-service and cross-shop diagnostics for the eligible
          // (post-filter, post-seller-service) population, in one pass over eligible_orders.
          one(executor, `
            WITH ${sellerServiceByOrderCte},
            ${eligibleOrdersCte}
            SELECT
              COUNT(DISTINCT eo.id_order) AS validOrderCount,
              COALESCE(SUM(eo.eligible_order_monetary_tax_incl), 0) AS grossOrderValueTaxIncl,
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
              ) AS futureOrderExcludedCount,
              COUNT(DISTINCT eo.id_currency) AS distinctCurrencyCount,
              MIN(cur.iso_code) AS currencyCode,
              COUNT(DISTINCT eo.conversion_rate) AS distinctConversionRateCount,
              COUNT(DISTINCT CASE WHEN eo.seller_service_tax_incl > 0 THEN eo.id_order END) AS ordersWithSellerServiceCount,
              COALESCE(SUM(eo.seller_service_tax_incl), 0) AS excludedSellerServiceValueTaxIncl,
              COALESCE(SUM(eo.total_paid_tax_incl), 0) AS grossOrderValueBeforeSellerServiceExclusion,
              (
                SELECT COUNT(*)
                FROM ${tables.orderDetail} sod
                INNER JOIN eligible_orders eo2 ON eo2.id_order = sod.id_order
                WHERE sod.product_id IN (${sellerServicePlaceholders})
              ) AS sellerServiceLineCount,
              (
                SELECT COUNT(DISTINCT ocr.id_order)
                FROM ${tables.orderCartRule} ocr
                INNER JOIN ${tables.cartRule} cr
                  ON cr.id_cart_rule = ocr.id_cart_rule
                INNER JOIN eligible_orders eo3
                  ON eo3.id_order = ocr.id_order
                WHERE cr.reduction_product IN (${sellerServicePlaceholders})
              ) AS productTargetedDiscountOrderCount,
              (
                SELECT COUNT(*)
                FROM (
                  SELECT id_customer
                  FROM eligible_orders
                  GROUP BY id_customer
                  HAVING COUNT(DISTINCT id_shop) > 1
                ) cross_shop
              ) AS crossShopCustomers
            FROM eligible_orders eo
            LEFT JOIN ${tables.currency} cur
              ON cur.id_currency = eo.id_currency
          `, [
            ...sellerServiceIds,
            ...excludedAccountIds,
            windowStartInclusive,
            windowEndExclusive,
            windowStartInclusive,
            windowEndExclusive,
            windowEndExclusive,
            ...sellerServiceIds,
            ...sellerServiceIds,
          ]),

          one(executor, `
            WITH ${sellerServiceByOrderCte},
            ${eligibleOrdersCte}
            SELECT
              COALESCE(SUM(CASE WHEN od.product_quantity_refunded > 0 THEN 1 ELSE 0 END), 0) AS refundedLineCount,
              COUNT(DISTINCT CASE
                WHEN od.product_quantity_refunded > 0 OR od.total_refunded_tax_incl > 0
                THEN eo.id_order
                ELSE NULL
              END) AS partiallyRefundedOrderCount,
              COALESCE(SUM(od.total_refunded_tax_incl), 0) AS partiallyRefundedAmountObserved
            FROM eligible_orders eo
            INNER JOIN ${tables.orderDetail} od
              ON od.id_order = eo.id_order
          `, [...sellerServiceIds, ...excludedAccountIds, windowStartInclusive, windowEndExclusive]),

          executor.execute(`
            WITH ${sellerServiceByOrderCte},
            ${eligibleOrdersCte}
            SELECT
              eo.id_shop AS shopId,
              COUNT(DISTINCT eo.id_customer) AS customers,
              COUNT(DISTINCT eo.id_order) AS orders,
              COALESCE(SUM(eo.eligible_order_monetary_tax_incl), 0) AS grossOrderValueTaxIncl
            FROM eligible_orders eo
            GROUP BY eo.id_shop
            ORDER BY eo.id_shop ASC
          `, [...sellerServiceIds, ...excludedAccountIds, windowStartInclusive, windowEndExclusive]),

          // Raw (non-CTE) diagnostics scanning ps_orders once: the data-quality guardrail is
          // deliberately unaffected by amount/account policy (a bad customer reference must
          // abort regardless of whether that order would later be filtered for other reasons);
          // the zero-value and operational-account counts are deliberately pre-filter/pre- or
          // partially-pre-exclusion so their impact stays measurable.
          one(executor, `
            SELECT
              COALESCE(SUM(CASE WHEN o.id_customer IS NULL OR o.id_customer <= 0 THEN 1 ELSE 0 END), 0)
                AS unusableCustomerOrderCount,
              COALESCE(SUM(CASE WHEN o.id_customer > 0 AND c.id_customer IS NULL THEN 1 ELSE 0 END), 0)
                AS missingPrestashopCustomerOrderCount,
              COALESCE(SUM(CASE WHEN o.id_customer > 0 AND o.total_paid_tax_incl <= 0 THEN 1 ELSE 0 END), 0)
                AS excludedZeroValueOrderCount,
              COUNT(DISTINCT CASE
                WHEN o.total_paid_tax_incl > 0 AND o.id_customer IN (${excludedAccountPlaceholders})
                THEN o.id_customer
              END) AS excludedOperationalAccountCount,
              COUNT(DISTINCT CASE
                WHEN o.total_paid_tax_incl > 0 AND o.id_customer IN (${excludedAccountPlaceholders})
                THEN o.id_order
              END) AS excludedOperationalAccountOrderCount,
              COALESCE(SUM(CASE
                WHEN o.total_paid_tax_incl > 0 AND o.id_customer IN (${excludedAccountPlaceholders})
                THEN o.total_paid_tax_incl ELSE 0
              END), 0) AS excludedOperationalAccountValueTaxIncl
            FROM ${tables.orders} o
            LEFT JOIN ${tables.customer} c
              ON c.id_customer = o.id_customer
            WHERE o.valid = 1
              AND o.date_add >= ?
              AND o.date_add < ?
          `, [...excludedAccountIds, ...excludedAccountIds, ...excludedAccountIds, windowStartInclusive, windowEndExclusive]),
        ]);

        const perShop = (shopRows as DiagnosticsRow[]).map((row) => ({
          shopId: coerceNonNegativeSafeInteger(row.shopId, 'shopId'),
          customers: coerceNonNegativeSafeInteger(row.customers, 'shop customers'),
          orders: coerceNonNegativeSafeInteger(row.orders, 'shop orders'),
          grossOrderValueTaxIncl: formatRfmDecimal(String(row.grossOrderValueTaxIncl ?? '0')),
        }));

        return {
          historicalCustomerCount: coerceNonNegativeSafeInteger(historical.historicalCustomerCount, 'historicalCustomerCount'),
          validOrderCount: coerceNonNegativeSafeInteger(summary.validOrderCount, 'validOrderCount'),
          grossOrderValueTaxIncl: formatRfmDecimal(String(summary.grossOrderValueTaxIncl ?? '0')),
          currency: {
            distinctCurrencyCount: coerceNonNegativeSafeInteger(summary.distinctCurrencyCount, 'distinctCurrencyCount'),
            currencyCode: coerceNullableNonEmptyString(summary.currencyCode, 'currencyCode'),
            distinctConversionRateCount: coerceNonNegativeSafeInteger(
              summary.distinctConversionRateCount,
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
            crossShopCustomers: coerceNonNegativeSafeInteger(summary.crossShopCustomers, 'crossShopCustomers'),
          },
          exclusions: {
            invalidOrderExcludedCount: coerceNonNegativeSafeInteger(
              summary.invalidOrderExcludedCount,
              'invalidOrderExcludedCount',
            ),
            futureOrderExcludedCount: coerceNonNegativeSafeInteger(
              summary.futureOrderExcludedCount,
              'futureOrderExcludedCount',
            ),
            excludedZeroValueOrderCount: coerceNonNegativeSafeInteger(
              rawExclusions.excludedZeroValueOrderCount,
              'excludedZeroValueOrderCount',
            ),
            excludedOperationalAccountCount: coerceNonNegativeSafeInteger(
              rawExclusions.excludedOperationalAccountCount,
              'excludedOperationalAccountCount',
            ),
            excludedOperationalAccountOrderCount: coerceNonNegativeSafeInteger(
              rawExclusions.excludedOperationalAccountOrderCount,
              'excludedOperationalAccountOrderCount',
            ),
            excludedOperationalAccountValueTaxIncl: formatRfmDecimal(
              String(rawExclusions.excludedOperationalAccountValueTaxIncl ?? '0'),
            ),
            unusableCustomerOrderCount: coerceNonNegativeSafeInteger(
              rawExclusions.unusableCustomerOrderCount,
              'unusableCustomerOrderCount',
            ),
            missingPrestashopCustomerOrderCount: coerceNonNegativeSafeInteger(
              rawExclusions.missingPrestashopCustomerOrderCount,
              'missingPrestashopCustomerOrderCount',
            ),
          },
          sellerService: {
            policyVersion: sellerServiceExclusionPolicyVersion,
            confirmedProductIds: sellerServiceIds,
            ordersWithSellerServiceCount: coerceNonNegativeSafeInteger(
              summary.ordersWithSellerServiceCount,
              'ordersWithSellerServiceCount',
            ),
            sellerServiceLineCount: coerceNonNegativeSafeInteger(
              summary.sellerServiceLineCount,
              'sellerServiceLineCount',
            ),
            excludedSellerServiceValueTaxIncl: formatRfmDecimal(
              String(summary.excludedSellerServiceValueTaxIncl ?? '0'),
            ),
            grossOrderValueBeforeSellerServiceExclusion: formatRfmDecimal(
              String(summary.grossOrderValueBeforeSellerServiceExclusion ?? '0'),
            ),
            // Equal to grossOrderValueTaxIncl above by construction (same eligible_order_
            // monetary_tax_incl sum) — not recomputed as a separate column.
            monetaryAfterSellerServiceExclusion: formatRfmDecimal(String(summary.grossOrderValueTaxIncl ?? '0')),
            productTargetedDiscountOrderCount: coerceNonNegativeSafeInteger(
              summary.productTargetedDiscountOrderCount,
              'productTargetedDiscountOrderCount',
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
