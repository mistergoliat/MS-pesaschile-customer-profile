import type { RowDataPacket } from 'mysql2/promise';
import type {
  CommercialProductsSummaryReader,
  CommercialProductsSummaryRecord,
} from '../../application/customer-commercial-summary/ports.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import {
  assertSafePrestashopTablePrefix,
  coerceNonNegativeSafeInteger,
  mapPrestashopReadError,
  resolvePrestashopCustomerId,
} from './commercial-summary-reader-utils.js';

interface CommercialProductsSummaryRow extends RowDataPacket {
  total_units_purchased: number | string | null;
  distinct_products_purchased: number | string | null;
}

export function createMysqlCommercialProductsSummaryReader(
  executor: QueryExecutor,
  tablePrefix: string,
): CommercialProductsSummaryReader {
  assertSafePrestashopTablePrefix(tablePrefix);

  const selectCommercialProductsSummarySql = `
    SELECT
      COALESCE(SUM(od.product_quantity), 0) AS total_units_purchased,
      COUNT(DISTINCT od.product_id) AS distinct_products_purchased
    FROM ${tablePrefix}orders o
    INNER JOIN ${tablePrefix}order_detail od
      ON od.id_order = o.id_order
    WHERE o.id_customer = ?
      AND o.valid = 1
  `;

  return {
    async findByCustomerId(prestashopCustomerId) {
      const safeCustomerId = resolvePrestashopCustomerId(prestashopCustomerId);

      let rows: RowDataPacket[];
      try {
        rows = await executor.execute(selectCommercialProductsSummarySql, [safeCustomerId]);
      } catch (error) {
        throw mapPrestashopReadError(error);
      }

      return toRecord(rows[0] as CommercialProductsSummaryRow | undefined);
    },
  };
}

function toRecord(row: CommercialProductsSummaryRow | undefined): CommercialProductsSummaryRecord {
  if (!row) {
    throw new Error('Commercial products summary query returned no aggregate row');
  }

  return {
    totalUnitsPurchased: coerceNonNegativeSafeInteger(row.total_units_purchased ?? 0, 'total_units_purchased'),
    distinctProductsPurchased: coerceNonNegativeSafeInteger(
      row.distinct_products_purchased ?? 0,
      'distinct_products_purchased',
    ),
  };
}
