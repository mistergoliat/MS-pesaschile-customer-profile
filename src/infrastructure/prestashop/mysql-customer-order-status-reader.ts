import type { RowDataPacket } from 'mysql2/promise';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../application/customer-profile/errors.js';
import type { CustomerOrderStatusReader } from '../../application/customer-order-status/ports.js';
import type { CustomerOrderStatusRecord } from '../../domain/customer-order-status/customer-order-status-record.js';
import type { QueryExecutor } from '../shared/query-executor.js';

// The prefix is concatenated into the table name because SQL cannot parameterize
// identifiers — so it must be validated as safe before it ever touches a query string.
const SAFE_PREFIX_PATTERN = /^[A-Za-z0-9_]+$/;

// ps_orders.reference is varchar(9) in the audited PesasChile schema (see
// CP-R1-T06A-schema-inventory.md); bounded higher here so this validation isn't
// coupled to a column width that could change without this adapter needing an update.
const MAX_REFERENCE_LENGTH = 32;
const SAFE_REFERENCE_PATTERN = /^[A-Za-z0-9]+$/;

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

interface CustomerOrderStatusRow extends RowDataPacket {
  id_order: number;
  reference: string;
  id_customer: number;
  current_state: number;
  id_carrier: number;
  date_upd: string;
}

// Read-only, parameterized by (id_customer, reference) together — belonging is
// validated inside this query, never checked after a reference-only lookup. See
// CP-R1-T06 section 3. No joins, no subqueries, no writes.
export function createMysqlCustomerOrderStatusReader(
  executor: QueryExecutor,
  tablePrefix: string,
): CustomerOrderStatusReader {
  if (!SAFE_PREFIX_PATTERN.test(tablePrefix)) {
    throw new Error(`Unsafe PrestaShop table prefix: "${tablePrefix}"`);
  }

  const selectByCustomerAndReferenceSql = `
    SELECT id_order, reference, id_customer, current_state, id_carrier, date_upd
    FROM ${tablePrefix}orders
    WHERE id_customer = ?
      AND reference = ?
    LIMIT 1
  `;

  return {
    async findByCustomerAndReference(prestashopCustomerId, orderReference) {
      const safeCustomerId = resolveCustomerId(prestashopCustomerId);
      const safeReference = resolveReference(orderReference);

      let rows: RowDataPacket[];
      try {
        rows = await executor.execute(selectByCustomerAndReferenceSql, [safeCustomerId, safeReference]);
      } catch (error) {
        throw mapReadError(error);
      }

      const row = rows[0] as CustomerOrderStatusRow | undefined;
      if (!row) {
        return null;
      }

      const record: CustomerOrderStatusRecord = {
        orderId: row.id_order,
        reference: row.reference,
        customerId: row.id_customer,
        currentStateId: row.current_state,
        carrierId: row.id_carrier,
        updatedAt: parseUtcDateTime(row.date_upd),
      };
      return record;
    },
  };
}

function resolveCustomerId(customerId: number): number {
  if (!Number.isSafeInteger(customerId) || customerId <= 0) {
    throw new Error(`Invalid PrestaShop customer id: ${String(customerId)}`);
  }
  return customerId;
}

function resolveReference(reference: string): string {
  if (typeof reference !== 'string') {
    throw new Error('Invalid order reference: must be a string');
  }
  const trimmed = reference.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_REFERENCE_LENGTH || !SAFE_REFERENCE_PATTERN.test(trimmed)) {
    throw new Error('Invalid order reference');
  }
  return trimmed;
}

// The PrestaShop pool sets dateStrings: true + timezone: 'Z' (see prestashop-pool.ts),
// so date_upd arrives as a plain "YYYY-MM-DD HH:MM:SS" UTC string, not a JS Date —
// parsed here because CustomerOrderStatusRecord.updatedAt is a Date (see that type).
// date_upd is NOT NULL in the audited schema, but a malformed value must fail loudly
// here rather than silently becoming an Invalid Date that only breaks later at
// .toISOString() in the use case.
function parseUtcDateTime(value: string): Date {
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid order date_upd value: ${value}`);
  }
  return parsed;
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
