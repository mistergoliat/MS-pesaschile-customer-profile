import type { RowDataPacket } from 'mysql2/promise';
import type { MasterCustomerReader } from '../../application/customer-profile/ports.js';
import type { MasterCustomerRecord } from '../../domain/customer-profile/master-customer-record.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import { mapCrmReadError } from './crm-read-error.js';

const SELECT_BY_ID_SQL = `
  SELECT id, firstname, lastname, email, platform_origin, rut, prestashop_customer_id
  FROM master_customer
  WHERE id = ?
  LIMIT 1
`;

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
        throw mapCrmReadError(error);
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
