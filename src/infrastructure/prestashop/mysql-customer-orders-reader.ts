import type { RowDataPacket } from 'mysql2/promise';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../application/customer-profile/errors.js';
import type { CustomerOrdersReader } from '../../application/customer-profile/ports.js';
import type { CustomerOrderRecord } from '../../domain/customer-profile/customer-order-record.js';
import type { QueryExecutor } from '../shared/query-executor.js';

// The prefix is concatenated into the table name because SQL cannot parameterize
// identifiers — so it must be validated as safe before it ever touches a query string.
const SAFE_PREFIX_PATTERN = /^[A-Za-z0-9_]+$/;

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

const TIMEOUT_ERROR_CODES = new Set(['ETIMEDOUT', 'PROTOCOL_SEQUENCE_TIMEOUT']);
const UNAVAILABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'POOL_CLOSED',
  'ER_CON_COUNT_ERROR',
]);

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
  if (!SAFE_PREFIX_PATTERN.test(tablePrefix)) {
    throw new Error(`Unsafe PrestaShop table prefix: "${tablePrefix}"`);
  }

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
        throw mapReadError(error);
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

function mapReadError(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;

  if (code && TIMEOUT_ERROR_CODES.has(code)) {
    return new PrestashopTimeoutError('PrestaShop query timed out', { cause: error });
  }
  if (code && UNAVAILABLE_ERROR_CODES.has(code)) {
    return new PrestashopUnavailableError('PrestaShop is unavailable', { cause: error });
  }
  // Unknown/unclassified failure: propagate as-is rather than guessing a degraded reason.
  return error instanceof Error ? error : new Error('Unknown PrestaShop read error', { cause: error });
}
