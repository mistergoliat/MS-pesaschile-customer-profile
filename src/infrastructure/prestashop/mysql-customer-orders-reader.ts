import type { RowDataPacket } from 'mysql2/promise';
import type { CustomerOrdersReader } from '../../application/customer-profile/ports.js';
import type { CustomerOrderRecord } from '../../domain/customer-profile/customer-order-record.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import { assertSafePrestashopTablePrefix, mapPrestashopReadError } from './commercial-summary-reader-utils.js';

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

interface CustomerOrderRow extends RowDataPacket {
  id_order: number;
  reference: string;
  id_customer: number;
  current_state: number;
  valid: number;
  date_add: string;
  date_upd: string;
  total_paid_tax_incl: string;
  total_products_wt: string;
  id_currency: number;
}

// Read-only, parameterized by id_customer only — never email, name, rut, address, phone
// or id_guest. No joins, no subqueries, no writes. Rows come back most-recent-first
// (date_add DESC, id_order DESC), bounded by a validated LIMIT. Every row in ps_orders
// counts as a paid order per the PesasChile business rule (see
// src/domain/customer-profile/contracts.ts CustomerOrderSummary) — current_state and
// valid are never used to filter here, only captured as raw facts. See CP-R1-T04.
export function createMysqlCustomerOrdersReader(
  executor: QueryExecutor,
  tablePrefix: string,
): CustomerOrdersReader {
  assertSafePrestashopTablePrefix(tablePrefix);

  return {
    async findByCustomerId(prestashopCustomerId, options) {
      const limit = resolveLimit(options?.limit);

      // LIMIT is interpolated, not bound as a `?` parameter: it is validated here as a
      // bounded safe integer (never taken from raw user input) rather than relying on
      // mysql2's prepared-statement support for a LIMIT placeholder, mirroring how the
      // table prefix above is already validated-then-interpolated in this codebase.
      const selectByCustomerIdSql = `
        SELECT
          id_order, reference, id_customer, current_state, valid,
          date_add, date_upd, total_paid_tax_incl, total_products_wt, id_currency
        FROM ${tablePrefix}orders
        WHERE id_customer = ?
        ORDER BY date_add DESC, id_order DESC
        LIMIT ${limit}
      `;

      let rows: RowDataPacket[];
      try {
        rows = await executor.execute(selectByCustomerIdSql, [prestashopCustomerId]);
      } catch (error) {
        throw mapPrestashopReadError(error);
      }

      return (rows as CustomerOrderRow[]).map(
        (row): CustomerOrderRecord => ({
          orderId: row.id_order,
          reference: row.reference,
          customerId: row.id_customer,
          currentStateId: row.current_state,
          valid: Boolean(row.valid),
          createdAt: row.date_add,
          updatedAt: row.date_upd,
          totalPaidTaxIncl: row.total_paid_tax_incl,
          totalProductsTaxIncl: row.total_products_wt,
          currencyId: row.id_currency,
        }),
      );
    },
  };
}

function resolveLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < MIN_LIMIT || value > MAX_LIMIT) {
    throw new Error(`Invalid recent orders limit: ${String(limit)}`);
  }
  return value;
}
