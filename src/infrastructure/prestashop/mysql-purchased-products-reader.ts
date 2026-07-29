import type { RowDataPacket } from 'mysql2/promise';
import type {
  PurchasedProductRecord,
  PurchasedProductsQuery,
  PurchasedProductsReader,
} from '../../application/customer-purchased-products/ports.js';
import { formatDecimalMoney } from '../../domain/customer-commercial-summary/index.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import {
  assertSafePrestashopTablePrefix,
  coerceNonNegativeSafeInteger,
  mapPrestashopReadError,
  parseNullableUtcDateTime,
  resolvePrestashopCustomerId,
} from './commercial-summary-reader-utils.js';

const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

interface PurchasedProductRow extends RowDataPacket {
  product_id: number | string;
  product_attribute_id: number | string | null;
  product_name: string;
  product_reference: string | null;
  total_quantity_purchased: number | string;
  order_count: number | string;
  first_purchased_at: string | Date;
  last_purchased_at: string | Date;
  total_spent_tax_incl: string;
  catalog_status: string;
}

export function createMysqlPurchasedProductsReader(
  executor: QueryExecutor,
  tablePrefix: string,
): PurchasedProductsReader {
  assertSafePrestashopTablePrefix(tablePrefix);

  const selectPurchasedProductsSql = `
    WITH ranked_lines AS (
      SELECT
        od.id_order_detail,
        od.product_id,
        od.product_attribute_id,
        od.product_name,
        od.product_reference,
        od.product_quantity,
        od.total_price_tax_incl,
        o.id_order,
        o.date_add,
        ROW_NUMBER() OVER (
          PARTITION BY
            od.product_id,
            od.product_attribute_id
          ORDER BY
            o.date_add DESC,
            o.id_order DESC,
            od.id_order_detail DESC
        ) AS latest_rank
      FROM ${tablePrefix}orders o
      INNER JOIN ${tablePrefix}order_detail od
        ON od.id_order = o.id_order
      WHERE o.id_customer = ?
        AND o.valid = 1
    ),
    aggregated AS (
      SELECT
        product_id,
        product_attribute_id,
        SUM(product_quantity) AS total_quantity_purchased,
        COUNT(DISTINCT id_order) AS order_count,
        MIN(date_add) AS first_purchased_at,
        MAX(date_add) AS last_purchased_at,
        SUM(total_price_tax_incl) AS total_spent_tax_incl
      FROM ranked_lines
      GROUP BY
        product_id,
        product_attribute_id
    )
    SELECT
      a.product_id,
      a.product_attribute_id,
      latest.product_name,
      latest.product_reference,
      a.total_quantity_purchased,
      a.order_count,
      a.first_purchased_at,
      a.last_purchased_at,
      a.total_spent_tax_incl,
      CASE
        WHEN p.id_product IS NULL
          THEN 'deleted_or_unavailable'
        ELSE 'linked'
      END AS catalog_status
    FROM aggregated a
    INNER JOIN ranked_lines latest
      ON latest.product_id = a.product_id
     AND latest.product_attribute_id = a.product_attribute_id
     AND latest.latest_rank = 1
    LEFT JOIN ${tablePrefix}product p
      ON p.id_product = a.product_id
    ORDER BY
      a.last_purchased_at DESC,
      a.product_id DESC,
      a.product_attribute_id DESC
    LIMIT ?
    OFFSET ?
  `;

  return {
    async findByCustomerId(query) {
      const safeQuery = resolveQuery(query);
      const requestedLimit = safeQuery.limit + 1;

      let rows: RowDataPacket[];
      try {
        rows = await executor.execute(selectPurchasedProductsSql, [
          safeQuery.prestashopCustomerId,
          requestedLimit,
          safeQuery.offset,
        ]);
      } catch (error) {
        throw mapPrestashopReadError(error);
      }

      const pageRows = (rows as PurchasedProductRow[]).slice(0, safeQuery.limit);
      return {
        products: pageRows.map(toRecord),
        hasMore: rows.length > safeQuery.limit,
      };
    },
  };
}

function resolveQuery(query: PurchasedProductsQuery): PurchasedProductsQuery {
  const prestashopCustomerId = resolvePrestashopCustomerId(query.prestashopCustomerId);
  if (!Number.isSafeInteger(query.limit) || query.limit < MIN_LIMIT || query.limit > MAX_LIMIT) {
    throw new Error(`Invalid purchased products limit: ${String(query.limit)}`);
  }
  if (!Number.isSafeInteger(query.offset) || query.offset < 0) {
    throw new Error(`Invalid purchased products offset: ${String(query.offset)}`);
  }
  return {
    prestashopCustomerId,
    limit: query.limit,
    offset: query.offset,
  };
}

function toRecord(row: PurchasedProductRow): PurchasedProductRecord {
  const productId = coercePositiveSafeInteger(row.product_id, 'product_id');
  const productAttributeId = coerceNonNegativeSafeInteger(row.product_attribute_id, 'product_attribute_id');
  const productName = coerceNonEmptyString(row.product_name, 'product_name');
  const productReference = coerceNullableNonEmptyString(row.product_reference, 'product_reference');
  const totalQuantityPurchased = coerceNonNegativeSafeInteger(
    row.total_quantity_purchased,
    'total_quantity_purchased',
  );
  const orderCount = coerceNonNegativeSafeInteger(row.order_count, 'order_count');
  const firstPurchasedAt = parseRequiredUtcDateTime(row.first_purchased_at, 'first_purchased_at');
  const lastPurchasedAt = parseRequiredUtcDateTime(row.last_purchased_at, 'last_purchased_at');
  if (firstPurchasedAt.getTime() > lastPurchasedAt.getTime()) {
    throw new Error('first_purchased_at cannot be after last_purchased_at');
  }

  return {
    productId,
    productAttributeId,
    productName,
    productReference,
    totalQuantityPurchased,
    orderCount,
    firstPurchasedAt,
    lastPurchasedAt,
    totalSpentTaxIncl: formatDecimalMoney(String(row.total_spent_tax_incl ?? '')),
    catalogStatus: coerceCatalogStatus(row.catalog_status),
  };
}

function coercePositiveSafeInteger(value: unknown, field: string): number {
  const numericValue = coerceNonNegativeSafeInteger(value, field);
  if (numericValue <= 0) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return numericValue;
}

function parseRequiredUtcDateTime(value: unknown, field: string): Date {
  const parsed = parseNullableUtcDateTime(value, field);
  if (!parsed) {
    throw new Error(`Invalid ${field}`);
  }
  return parsed;
}

function coerceNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}

function coerceNullableNonEmptyString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return coerceNonEmptyString(value, field);
}

function coerceCatalogStatus(value: unknown): 'linked' | 'deleted_or_unavailable' {
  if (value === 'linked' || value === 'deleted_or_unavailable') {
    return value;
  }
  throw new Error(`Invalid catalog_status: ${String(value)}`);
}
