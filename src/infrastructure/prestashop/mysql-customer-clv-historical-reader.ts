import type { Pool, RowDataPacket } from 'mysql2/promise';
import type {
  CustomerClvBacktestSource,
  CustomerClvBacktestSourceOrder,
  CustomerClvBacktestSourceOrderProduct,
} from '../../domain/customer-clv/index.js';
import {
  CUSTOMER_CLV_CONFIRMED_NON_PRODUCT_PRODUCT_IDS,
  CUSTOMER_CLV_CONFIRMED_SELLER_SERVICE_PRODUCT_IDS,
  CUSTOMER_CLV_EXCLUDED_OPERATIONAL_CUSTOMER_IDS,
} from '../../domain/customer-clv/index.js';
import { assertSafePrestashopTablePrefix, coerceNonNegativeSafeInteger, mapPrestashopReadError } from './commercial-summary-reader-utils.js';

const REQUIRED_COLUMNS = {
  orders: ['id_order', 'id_customer', 'current_state', 'valid', 'date_add', 'total_paid_tax_incl', 'total_discounts_tax_incl', 'total_shipping_tax_incl', 'id_currency'],
  customer: ['id_customer', 'date_add'],
  currency: ['id_currency', 'iso_code'],
  order_detail: ['id_order', 'product_id', 'product_quantity', 'total_price_tax_incl', 'product_quantity_refunded', 'total_refunded_tax_incl'],
} as const;

export type CustomerClvHistoricalReaderPolicy = {
  readonly confirmedSellerServiceProductIds: readonly number[];
  readonly excludedOperationalCustomerIds: readonly number[];
  readonly nonProductFeatureExcludedProductIds: readonly number[];
};

export const defaultCustomerClvHistoricalReaderPolicy: CustomerClvHistoricalReaderPolicy = {
  confirmedSellerServiceProductIds: CUSTOMER_CLV_CONFIRMED_SELLER_SERVICE_PRODUCT_IDS,
  excludedOperationalCustomerIds: CUSTOMER_CLV_EXCLUDED_OPERATIONAL_CUSTOMER_IDS,
  nonProductFeatureExcludedProductIds: CUSTOMER_CLV_CONFIRMED_NON_PRODUCT_PRODUCT_IDS,
};

export type CustomerClvHistoricalReader = {
  verifySchema(): Promise<void>;
  readSource(): Promise<CustomerClvBacktestSource>;
};

type AvailableDataThroughRow = RowDataPacket & { availableDataThrough: string | null };
type OrderRow = RowDataPacket & Record<string, string | number | null>;
type ProductRow = RowDataPacket & Record<string, string | number | null>;

export function createMysqlCustomerClvHistoricalReader(
  pool: Pool,
  tablePrefix: string,
  policy: CustomerClvHistoricalReaderPolicy = defaultCustomerClvHistoricalReaderPolicy,
): CustomerClvHistoricalReader {
  assertSafePrestashopTablePrefix(tablePrefix);
  const tables = {
    orders: `${tablePrefix}orders`,
    customer: `${tablePrefix}customer`,
    currency: `${tablePrefix}currency`,
    orderDetail: `${tablePrefix}order_detail`,
  };
  const sellerServiceIds = uniquePositiveIntegers(policy.confirmedSellerServiceProductIds, 'confirmedSellerServiceProductIds');
  const excludedCustomerIds = uniquePositiveIntegers(policy.excludedOperationalCustomerIds, 'excludedOperationalCustomerIds');
  const nonProductIds = uniquePositiveIntegers(policy.nonProductFeatureExcludedProductIds, 'nonProductFeatureExcludedProductIds');
  if (sellerServiceIds.length === 0) {
    throw new Error('CLV historical reader requires at least one confirmed seller-service product id');
  }
  if (excludedCustomerIds.length === 0) {
    throw new Error('CLV historical reader requires at least one excluded operational customer id');
  }
  if (nonProductIds.length === 0) {
    throw new Error('CLV historical reader requires at least one non-product product id exclusion');
  }

  const sellerServicePlaceholders = sellerServiceIds.map(() => '?').join(', ');
  const excludedCustomerPlaceholders = excludedCustomerIds.map(() => '?').join(', ');
  const nonProductPlaceholders = nonProductIds.map(() => '?').join(', ');

  const sellerServiceByOrderCte = `
    seller_service_by_order AS (
      SELECT
        od.id_order,
        COALESCE(SUM(od.total_price_tax_incl), 0) AS sellerServiceRevenueTaxIncl
      FROM ${tables.orderDetail} od
      WHERE od.product_id IN (${sellerServicePlaceholders})
      GROUP BY od.id_order
    )
  `;

  return {
    async verifySchema() {
      try {
        await verifyRequiredTable(pool, tables.orders, REQUIRED_COLUMNS.orders);
        await verifyRequiredTable(pool, tables.customer, REQUIRED_COLUMNS.customer);
        await verifyRequiredTable(pool, tables.currency, REQUIRED_COLUMNS.currency);
        await verifyRequiredTable(pool, tables.orderDetail, REQUIRED_COLUMNS.order_detail);
      } catch (error) {
        throw mapPrestashopReadError(error);
      }
    },

    async readSource() {
      try {
        const [availableDataThroughRows, orderRows, productRows] = await Promise.all([
          pool.execute<AvailableDataThroughRow[]>(
            `
              SELECT MAX(o.date_add) AS availableDataThrough
              FROM ${tables.orders} o
              INNER JOIN ${tables.customer} c
                ON c.id_customer = o.id_customer
              WHERE o.valid = 1
                AND o.total_paid_tax_incl > 0
                AND o.id_customer > 0
                AND o.id_customer NOT IN (${excludedCustomerPlaceholders})
            `,
            [...excludedCustomerIds],
          ),
          pool.execute<OrderRow[]>(
            `
              WITH ${sellerServiceByOrderCte}
              SELECT
                o.id_order AS orderId,
                o.id_customer AS customerId,
                c.date_add AS customerCreatedAt,
                o.date_add AS createdAt,
                o.valid AS currentValid,
                o.current_state AS currentStateId,
                cur.iso_code AS currencyIsoCode,
                o.total_paid_tax_incl AS totalPaidTaxIncl,
                o.total_discounts_tax_incl AS totalDiscountsTaxIncl,
                o.total_shipping_tax_incl AS totalShippingTaxIncl,
                COALESCE(sso.sellerServiceRevenueTaxIncl, 0) AS sellerServiceRevenueTaxIncl,
                MAX(CASE WHEN od.product_quantity_refunded > 0 OR od.total_refunded_tax_incl > 0 THEN 1 ELSE 0 END) AS refundEvidence
              FROM ${tables.orders} o
              INNER JOIN ${tables.customer} c
                ON c.id_customer = o.id_customer
              LEFT JOIN ${tables.currency} cur
                ON cur.id_currency = o.id_currency
              LEFT JOIN seller_service_by_order sso
                ON sso.id_order = o.id_order
              LEFT JOIN ${tables.orderDetail} od
                ON od.id_order = o.id_order
              WHERE o.id_customer > 0
                AND o.id_customer NOT IN (${excludedCustomerPlaceholders})
              GROUP BY
                o.id_order,
                o.id_customer,
                c.date_add,
                o.date_add,
                o.valid,
                o.current_state,
                cur.iso_code,
                o.total_paid_tax_incl,
                o.total_discounts_tax_incl,
                o.total_shipping_tax_incl,
                sso.sellerServiceRevenueTaxIncl
              ORDER BY o.id_order ASC
            `,
            [...sellerServiceIds, ...excludedCustomerIds],
          ),
          pool.execute<ProductRow[]>(
            `
              SELECT
                o.id_order AS orderId,
                od.product_id AS productId,
                COALESCE(SUM(od.product_quantity), 0) AS quantity,
                COALESCE(SUM(od.total_price_tax_incl), 0) AS revenueTaxIncl
              FROM ${tables.orders} o
              INNER JOIN ${tables.customer} c
                ON c.id_customer = o.id_customer
              INNER JOIN ${tables.orderDetail} od
                ON od.id_order = o.id_order
              WHERE o.id_customer > 0
                AND o.id_customer NOT IN (${excludedCustomerPlaceholders})
                AND od.product_id NOT IN (${nonProductPlaceholders})
              GROUP BY o.id_order, od.product_id
              ORDER BY o.id_order ASC, od.product_id ASC
            `,
            [...excludedCustomerIds, ...nonProductIds],
          ),
        ]);

        const availableDataThrough = toIsoRequired(
          (availableDataThroughRows[0][0] as AvailableDataThroughRow | undefined)?.availableDataThrough,
          'availableDataThrough',
        );
        const productsByOrder = new Map<number, CustomerClvBacktestSourceOrderProduct[]>();
        for (const row of productRows[0] as ProductRow[]) {
          const orderId = coercePositiveInteger(row.orderId, 'orderId');
          const group = productsByOrder.get(orderId) ?? [];
          group.push({
            productId: coercePositiveInteger(row.productId, 'productId'),
            quantity: coerceNonNegativeSafeInteger(row.quantity, 'quantity'),
            revenueTaxIncl: formatMoney(String(row.revenueTaxIncl ?? '0')),
          });
          productsByOrder.set(orderId, group);
        }

        const orders = (orderRows[0] as OrderRow[]).map((row): CustomerClvBacktestSourceOrder => ({
          orderId: coercePositiveInteger(row.orderId, 'orderId'),
          customerId: coercePositiveInteger(row.customerId, 'customerId'),
          customerCreatedAt: toIsoRequired(row.customerCreatedAt, 'customerCreatedAt'),
          createdAt: toIsoRequired(row.createdAt, 'createdAt'),
          currentValid: coerceNonNegativeSafeInteger(row.currentValid, 'currentValid') === 1,
          currentStateId: row.currentStateId === null ? null : coerceNonNegativeSafeInteger(row.currentStateId, 'currentStateId'),
          currencyIsoCode: row.currencyIsoCode === null || row.currencyIsoCode === undefined ? null : String(row.currencyIsoCode),
          totalPaidTaxIncl: formatMoney(String(row.totalPaidTaxIncl ?? '0')),
          totalDiscountsTaxIncl: formatMoney(String(row.totalDiscountsTaxIncl ?? '0')),
          totalShippingTaxIncl: formatMoney(String(row.totalShippingTaxIncl ?? '0')),
          sellerServiceRevenueTaxIncl: formatMoney(String(row.sellerServiceRevenueTaxIncl ?? '0')),
          refundEvidence: coerceNonNegativeSafeInteger(row.refundEvidence, 'refundEvidence') > 0,
          products: (productsByOrder.get(coercePositiveInteger(row.orderId, 'orderId')) ?? []).sort((left, right) => left.productId - right.productId),
        }));

        return {
          availableDataThrough,
          orders,
        } satisfies CustomerClvBacktestSource;
      } catch (error) {
        throw mapPrestashopReadError(error);
      }
    },
  };
}

async function verifyRequiredTable(pool: Pool, tableName: string, requiredColumns: readonly string[]): Promise<void> {
  const [rows] = await pool.execute<RowDataPacket[]>(
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
    throw new Error(`Missing required CLV source columns on ${tableName}: ${missing.join(', ')}`);
  }
}

function uniquePositiveIntegers(values: readonly number[], field: string): readonly number[] {
  const unique = [...new Set(values.map((value) => Number(value)).filter((value) => Number.isSafeInteger(value) && value > 0))].sort(
    (left, right) => left - right,
  );
  if (unique.length !== values.length) {
    throw new Error(`Invalid ${field}`);
  }
  return unique;
}

function coercePositiveInteger(value: unknown, field: string): number {
  const parsed = coerceNonNegativeSafeInteger(value, field);
  if (parsed <= 0) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return parsed;
}

function formatMoney(value: string): string {
  const trimmed = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid money value: ${value}`);
  }
  const sign = trimmed.startsWith('-') ? '-' : '';
  const unsigned = trimmed.replace(/^-/, '');
  const [whole = '0', fractional = ''] = unsigned.split('.');
  if (fractional.length <= 6) {
    return `${sign}${whole}.${fractional.padEnd(6, '0')}`;
  }
  const scaleDiff = fractional.length - 6;
  const divisor = 10n ** BigInt(scaleDiff);
  const units = BigInt(`${whole}${fractional}`);
  const quotient = units / divisor;
  const remainder = units % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  const roundedRaw = rounded.toString().padStart(7, '0');
  return `${sign}${roundedRaw.slice(0, -6)}.${roundedRaw.slice(-6)}`;
}

function toIsoRequired(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  const parsed = new Date(`${value.replace(' ', 'T').replace(/Z$/, '')}Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${field}: ${value}`);
  }
  return parsed.toISOString();
}
