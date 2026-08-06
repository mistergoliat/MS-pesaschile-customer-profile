import type { RowDataPacket } from 'mysql2/promise';
import type { PrestashopCustomerReader } from '../../application/customer-profile/ports.js';
import type { PrestashopCustomerRecord } from '../../domain/customer-profile/prestashop-customer-record.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import { assertSafePrestashopTablePrefix, mapPrestashopReadError } from './commercial-summary-reader-utils.js';

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
  assertSafePrestashopTablePrefix(tablePrefix);

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
        throw mapPrestashopReadError(error);
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
