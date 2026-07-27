import type { RowDataPacket } from 'mysql2/promise';
import { CrmSchemaIncompatibleError, CrmTimeoutError, CrmUnavailableError } from '../../application/customer-profile/errors.js';
import type { MasterCustomerReader } from '../../application/customer-profile/ports.js';
import type { MasterCustomerRecord } from '../../domain/customer-profile/master-customer-record.js';
import type { QueryExecutor } from '../shared/query-executor.js';

const SELECT_BY_ID_SQL = `
  SELECT id, firstname, lastname, email, platform_origin, rut, prestashop_customer_id
  FROM master_customer
  WHERE id = ?
  LIMIT 1
`;

const TIMEOUT_ERROR_CODES = new Set(['ETIMEDOUT', 'PROTOCOL_SEQUENCE_TIMEOUT']);
const UNAVAILABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
]);
const SCHEMA_INCOMPATIBLE_ERROR_CODES = new Set(['ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE']);

interface MasterCustomerRow extends RowDataPacket {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  platform_origin: string;
  rut: string | null;
  prestashop_customer_id: number | null;
}

// Read-only, parameterized, single row by primary key. No email search, no joins, no
// writes. Query failures are classified into typed errors and rejected — they are
// service errors, never mapped to "not found" here.
export function createMysqlMasterCustomerReader(executor: QueryExecutor): MasterCustomerReader {
  return {
    async findById(masterCustomerId) {
      let rows: RowDataPacket[];
      try {
        rows = await executor.execute(SELECT_BY_ID_SQL, [masterCustomerId]);
      } catch (error) {
        throw mapReadError(error);
      }

      const row = rows[0] as MasterCustomerRow | undefined;
      if (!row) {
        return null;
      }

      const record: MasterCustomerRecord = {
        id: String(row.id),
        firstname: row.firstname,
        lastname: row.lastname,
        email: row.email,
        platformOrigin: row.platform_origin,
        rut: row.rut,
        prestashopCustomerId: row.prestashop_customer_id,
      };
      return record;
    },
  };
}

function mapReadError(error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;

  if (code && SCHEMA_INCOMPATIBLE_ERROR_CODES.has(code)) {
    return new CrmSchemaIncompatibleError('CRM schema is incompatible with this service', { cause: error });
  }
  if (code && TIMEOUT_ERROR_CODES.has(code)) {
    return new CrmTimeoutError('CRM query timed out', { cause: error });
  }
  if (code && UNAVAILABLE_ERROR_CODES.has(code)) {
    return new CrmUnavailableError('CRM is unavailable', { cause: error });
  }
  // Unknown/unclassified failure: propagate as-is rather than guessing a reason.
  return error instanceof Error ? error : new Error('Unknown CRM read error', { cause: error });
}
