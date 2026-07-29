import type { RowDataPacket } from 'mysql2/promise';
import type {
  CustomerProductBehaviorQuery,
  CustomerProductBehaviorReader,
  CustomerProductBehaviorRecord,
  ProductBehaviorVariantRecord,
} from '../../application/customer-purchase-behavior/ports.js';
import { formatDecimalMoney } from '../../domain/customer-commercial-summary/index.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import {
  assertSafePrestashopTablePrefix,
  coerceNonNegativeSafeInteger,
  mapPrestashopReadError,
  parseNullableUtcDateTime,
  resolvePrestashopCustomerId,
} from './commercial-summary-reader-utils.js';

interface GlobalTotalsRow extends RowDataPacket {
  valid_order_count: number | string;
  total_product_units_purchased: number | string;
  total_product_spent_tax_incl: string | number;
}

interface VariantBehaviorRow extends RowDataPacket {
  product_id: number | string;
  product_attribute_id: number | string | null;
  product_name: string;
  product_reference: string | null;
  order_count: number | string;
  total_quantity_purchased: number | string;
  total_spent_tax_incl: string | number | null;
  first_purchased_at: string | Date;
  last_purchased_at: string | Date;
  product_order_count: number | string;
  product_first_purchased_at: string | Date;
  product_last_purchased_at: string | Date;
  latest_observed_product_name: string;
  latest_observed_product_reference: string | null;
}

export function createMysqlCustomerProductBehaviorReader(
  executor: QueryExecutor,
  tablePrefix: string,
): CustomerProductBehaviorReader {
  assertSafePrestashopTablePrefix(tablePrefix);

  const globalTotalsSql = `
    SELECT
      COUNT(DISTINCT o.id_order) AS valid_order_count,
      COALESCE(SUM(od.product_quantity), 0) AS total_product_units_purchased,
      COALESCE(SUM(od.total_price_tax_incl), 0) AS total_product_spent_tax_incl
    FROM ${tablePrefix}orders o
    INNER JOIN ${tablePrefix}order_detail od
      ON od.id_order = o.id_order
    WHERE o.id_customer = ?
      AND o.valid = 1
  `;

  const variantBehaviorSql = `
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
        ) AS variant_latest_rank,
        ROW_NUMBER() OVER (
          PARTITION BY
            od.product_id
          ORDER BY
            o.date_add DESC,
            o.id_order DESC,
            od.id_order_detail DESC
        ) AS product_latest_rank
      FROM ${tablePrefix}orders o
      INNER JOIN ${tablePrefix}order_detail od
        ON od.id_order = o.id_order
      WHERE o.id_customer = ?
        AND o.valid = 1
    ),
    variant_aggregates AS (
      SELECT
        product_id,
        product_attribute_id,
        COUNT(DISTINCT id_order) AS order_count,
        SUM(product_quantity) AS total_quantity_purchased,
        SUM(total_price_tax_incl) AS total_spent_tax_incl,
        MIN(date_add) AS first_purchased_at,
        MAX(date_add) AS last_purchased_at
      FROM ranked_lines
      GROUP BY
        product_id,
        product_attribute_id
    ),
    product_aggregates AS (
      SELECT
        product_id,
        COUNT(DISTINCT id_order) AS product_order_count,
        MIN(date_add) AS product_first_purchased_at,
        MAX(date_add) AS product_last_purchased_at
      FROM ranked_lines
      GROUP BY product_id
    )
    SELECT
      va.product_id,
      va.product_attribute_id,
      latest_variant.product_name,
      latest_variant.product_reference,
      va.order_count,
      va.total_quantity_purchased,
      va.total_spent_tax_incl,
      va.first_purchased_at,
      va.last_purchased_at,
      pa.product_order_count,
      pa.product_first_purchased_at,
      pa.product_last_purchased_at,
      latest_product.product_name AS latest_observed_product_name,
      latest_product.product_reference AS latest_observed_product_reference
    FROM variant_aggregates va
    INNER JOIN product_aggregates pa
      ON pa.product_id = va.product_id
    INNER JOIN ranked_lines latest_variant
      ON latest_variant.product_id = va.product_id
     AND latest_variant.product_attribute_id <=> va.product_attribute_id
     AND latest_variant.variant_latest_rank = 1
    INNER JOIN ranked_lines latest_product
      ON latest_product.product_id = va.product_id
     AND latest_product.product_latest_rank = 1
    ORDER BY
      va.total_spent_tax_incl DESC,
      va.order_count DESC,
      va.total_quantity_purchased DESC,
      va.last_purchased_at DESC,
      va.product_id ASC,
      va.product_attribute_id ASC
  `;

  return {
    async findByCustomerId(query) {
      const prestashopCustomerId = resolveQuery(query);

      let totalRows: RowDataPacket[];
      let variantRows: RowDataPacket[];
      try {
        totalRows = await executor.execute(globalTotalsSql, [prestashopCustomerId]);
        variantRows = await executor.execute(variantBehaviorSql, [prestashopCustomerId]);
      } catch (error) {
        throw mapPrestashopReadError(error);
      }

      const totals = toTotals(totalRows[0] as GlobalTotalsRow | undefined);
      const variants = (variantRows as VariantBehaviorRow[]).map(toVariantRecord);
      validateRecordCoherence(totals, variants);

      return {
        ...totals,
        variants,
      };
    },
  };
}

function resolveQuery(query: CustomerProductBehaviorQuery): number {
  return resolvePrestashopCustomerId(query.prestashopCustomerId);
}

function toTotals(row: GlobalTotalsRow | undefined): Omit<CustomerProductBehaviorRecord, 'variants'> {
  if (!row) {
    throw new Error('Missing product behavior global totals');
  }
  return {
    validOrderCount: coerceNonNegativeSafeInteger(row.valid_order_count, 'valid_order_count'),
    totalProductUnitsPurchased: coerceNonNegativeSafeInteger(
      row.total_product_units_purchased,
      'total_product_units_purchased',
    ),
    totalProductSpentTaxIncl: formatDecimalMoney(String(row.total_product_spent_tax_incl)),
  };
}

function toVariantRecord(row: VariantBehaviorRow): ProductBehaviorVariantRecord {
  const productId = coercePositiveSafeInteger(row.product_id, 'product_id');
  const productAttributeId = coerceNonNegativeSafeInteger(row.product_attribute_id, 'product_attribute_id');
  const orderCount = coercePositiveSafeInteger(row.order_count, 'order_count');
  const totalQuantityPurchased = coerceNonNegativeSafeInteger(
    row.total_quantity_purchased,
    'total_quantity_purchased',
  );
  const firstPurchasedAt = parseRequiredUtcDateTime(row.first_purchased_at, 'first_purchased_at');
  const lastPurchasedAt = parseRequiredUtcDateTime(row.last_purchased_at, 'last_purchased_at');
  const productFirstPurchasedAt = parseRequiredUtcDateTime(
    row.product_first_purchased_at,
    'product_first_purchased_at',
  );
  const productLastPurchasedAt = parseRequiredUtcDateTime(row.product_last_purchased_at, 'product_last_purchased_at');

  if (firstPurchasedAt.getTime() > lastPurchasedAt.getTime()) {
    throw new Error('first_purchased_at cannot be after last_purchased_at');
  }
  if (productFirstPurchasedAt.getTime() > productLastPurchasedAt.getTime()) {
    throw new Error('product_first_purchased_at cannot be after product_last_purchased_at');
  }

  return {
    productId,
    productAttributeId,
    productName: coerceNonEmptyString(row.product_name, 'product_name'),
    productReference: coerceNullableNonEmptyString(row.product_reference, 'product_reference'),
    orderCount,
    totalQuantityPurchased,
    totalSpentTaxIncl: coerceMoney(row.total_spent_tax_incl, 'total_spent_tax_incl'),
    firstPurchasedAt,
    lastPurchasedAt,
    productOrderCount: coercePositiveSafeInteger(row.product_order_count, 'product_order_count'),
    productFirstPurchasedAt,
    productLastPurchasedAt,
    latestObservedProductName: coerceNonEmptyString(
      row.latest_observed_product_name,
      'latest_observed_product_name',
    ),
    latestObservedProductReference: coerceNullableNonEmptyString(
      row.latest_observed_product_reference,
      'latest_observed_product_reference',
    ),
  };
}

function validateRecordCoherence(
  totals: Omit<CustomerProductBehaviorRecord, 'variants'>,
  variants: readonly ProductBehaviorVariantRecord[],
): void {
  if (variants.length === 0) {
    if (
      totals.validOrderCount !== 0 ||
      totals.totalProductUnitsPurchased !== 0 ||
      totals.totalProductSpentTaxIncl !== '0.000000'
    ) {
      throw new Error('Product behavior has totals but no variants');
    }
    return;
  }
  if (totals.validOrderCount <= 0) {
    throw new Error('Product behavior variants require positive valid order count');
  }
}

function coerceMoney(value: unknown, field: string): string {
  if (value === null || value === undefined) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return formatDecimalMoney(String(value));
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
