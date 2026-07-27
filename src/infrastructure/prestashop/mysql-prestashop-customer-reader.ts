import type { RowDataPacket } from 'mysql2/promise';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../application/customer-profile/errors.js';
import type { PrestashopCustomerReader } from '../../application/customer-profile/ports.js';
import type { PrestashopCustomerRecord } from '../../domain/customer-profile/prestashop-customer-record.js';
import type { QueryExecutor } from '../shared/query-executor.js';

// The prefix is concatenated into the table name because SQL cannot parameterize
// identifiers — so it must be validated as safe before it ever touches a query string.
const SAFE_PREFIX_PATTERN = /^[A-Za-z0-9_]+$/;

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

interface PrestashopCustomerRow extends RowDataPacket {
  id_customer: number;
  firstname: string;
  lastname: string;
  email: string;
  active: number;
  id_shop: number;
  date_add: string | null;
  date_upd: string | null;
}

// Read-only, parameterized, single row by id_customer. No email search, no orders, no
// addresses, no writes. Timeout/connection failures are mapped to typed errors so the
// use case can tell them apart; a genuinely missing row is a valid `null`, not an error.
export function createMysqlPrestashopCustomerReader(
  executor: QueryExecutor,
  tablePrefix: string,
): PrestashopCustomerReader {
  if (!SAFE_PREFIX_PATTERN.test(tablePrefix)) {
    throw new Error(`Unsafe PrestaShop table prefix: "${tablePrefix}"`);
  }

  const selectByIdSql = `
    SELECT id_customer, firstname, lastname, email, active, id_shop, date_add, date_upd
    FROM ${tablePrefix}customer
    WHERE id_customer = ?
    LIMIT 1
  `;

  return {
    async findById(prestashopCustomerId) {
      let rows: RowDataPacket[];
      try {
        rows = await executor.execute(selectByIdSql, [prestashopCustomerId]);
      } catch (error) {
        throw mapReadError(error);
      }

      const row = rows[0] as PrestashopCustomerRow | undefined;
      if (!row) {
        return null;
      }

      const record: PrestashopCustomerRecord = {
        idCustomer: row.id_customer,
        firstname: row.firstname,
        lastname: row.lastname,
        email: row.email,
        active: Boolean(row.active),
        idShop: row.id_shop,
        dateAdd: row.date_add,
        dateUpd: row.date_upd,
      };
      return record;
    },
  };
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
