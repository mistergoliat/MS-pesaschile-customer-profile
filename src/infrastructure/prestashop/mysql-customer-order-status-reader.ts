import type { RowDataPacket } from 'mysql2/promise';
import type { CustomerOrderStatusReader } from '../../application/customer-order-status/ports.js';
import type { CustomerOrderStatusRecord } from '../../domain/customer-order-status/customer-order-status-record.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import { assertSafePrestashopTablePrefix, mapPrestashopReadError } from './commercial-summary-reader-utils.js';

// ps_orders.reference is varchar(9) in the audited PesasChile schema (see
// CP-R1-T06A-schema-inventory.md); bounded higher here so this validation isn't
// coupled to a column width that could change without this adapter needing an update.
const MAX_REFERENCE_LENGTH = 32;
const SAFE_REFERENCE_PATTERN = /^[A-Za-z0-9]+$/;

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
  assertSafePrestashopTablePrefix(tablePrefix);

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
        throw mapPrestashopReadError(error);
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
