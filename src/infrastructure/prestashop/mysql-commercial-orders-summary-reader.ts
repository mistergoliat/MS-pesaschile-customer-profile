import type { RowDataPacket } from 'mysql2/promise';
import type {
  CommercialOrdersSummaryReader,
  CommercialOrdersSummaryRecord,
} from '../../application/customer-commercial-summary/ports.js';
import { assertNonNegativeDecimal } from '../../domain/customer-commercial-summary/index.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import {
  assertSafePrestashopTablePrefix,
  coerceNonNegativeSafeInteger,
  mapPrestashopReadError,
  parseNullableUtcDateTime,
  resolvePrestashopCustomerId,
} from './commercial-summary-reader-utils.js';

interface CommercialOrdersSummaryRow extends RowDataPacket {
  total_orders: number | string | null;
  total_spent_tax_incl: string;
  first_order_at: string | Date | null;
  last_order_at: string | Date | null;
  cancelled_order_count: number | string | null;
  refunded_order_count: number | string | null;
}

export function createMysqlCommercialOrdersSummaryReader(
  executor: QueryExecutor,
  tablePrefix: string,
): CommercialOrdersSummaryReader {
  assertSafePrestashopTablePrefix(tablePrefix);

  const selectCommercialOrdersSummarySql = `
    SELECT
      COALESCE(SUM(CASE WHEN valid = 1 THEN 1 ELSE 0 END), 0) AS total_orders,
      COALESCE(
        SUM(CASE WHEN valid = 1 THEN total_paid_tax_incl ELSE 0 END),
        0
      ) AS total_spent_tax_incl,
      MIN(CASE WHEN valid = 1 THEN date_add ELSE NULL END) AS first_order_at,
      MAX(CASE WHEN valid = 1 THEN date_add ELSE NULL END) AS last_order_at,
      COALESCE(SUM(CASE WHEN current_state = 6 THEN 1 ELSE 0 END), 0)
        AS cancelled_order_count,
      COALESCE(SUM(CASE WHEN current_state = 7 THEN 1 ELSE 0 END), 0)
        AS refunded_order_count
    FROM ${tablePrefix}orders
    WHERE id_customer = ?
  `;

  return {
    async findByCustomerId(prestashopCustomerId) {
      const safeCustomerId = resolvePrestashopCustomerId(prestashopCustomerId);

      let rows: RowDataPacket[];
      try {
        rows = await executor.execute(selectCommercialOrdersSummarySql, [safeCustomerId]);
      } catch (error) {
        throw mapPrestashopReadError(error);
      }

      return toRecord(rows[0] as CommercialOrdersSummaryRow | undefined);
    },
  };
}

function toRecord(row: CommercialOrdersSummaryRow | undefined): CommercialOrdersSummaryRecord {
  if (!row) {
    throw new Error('Commercial orders summary query returned no aggregate row');
  }

  const totalOrders = coerceNonNegativeSafeInteger(row.total_orders ?? 0, 'total_orders');
  const cancelledOrderCount = coerceNonNegativeSafeInteger(row.cancelled_order_count ?? 0, 'cancelled_order_count');
  const refundedOrderCount = coerceNonNegativeSafeInteger(row.refunded_order_count ?? 0, 'refunded_order_count');
  const totalSpentTaxIncl = String(row.total_spent_tax_incl ?? '0');
  assertNonNegativeDecimal(totalSpentTaxIncl);

  const firstOrderAt = parseNullableUtcDateTime(row.first_order_at, 'first_order_at');
  const lastOrderAt = parseNullableUtcDateTime(row.last_order_at, 'last_order_at');

  if (totalOrders === 0 && (firstOrderAt !== null || lastOrderAt !== null)) {
    throw new Error('Commercial order dates must be null when total_orders is zero');
  }
  if (totalOrders > 0 && (firstOrderAt === null || lastOrderAt === null)) {
    throw new Error('Commercial order dates are required when total_orders is positive');
  }
  if (firstOrderAt && lastOrderAt && firstOrderAt.getTime() > lastOrderAt.getTime()) {
    throw new Error('first_order_at cannot be after last_order_at');
  }

  return {
    totalOrders,
    totalSpentTaxIncl,
    firstOrderAt,
    lastOrderAt,
    cancelledOrderCount,
    refundedOrderCount,
  };
}
