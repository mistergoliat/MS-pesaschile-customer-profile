import type { RowDataPacket } from 'mysql2/promise';
import type { CustomerIdentityRepository } from '../../application/customer-identity/ports.js';
import type { CustomerIdentity } from '../../domain/customer-identity/index.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import { assertSafePrestashopTablePrefix, mapPrestashopReadError, resolvePrestashopCustomerId } from './commercial-summary-reader-utils.js';

interface CustomerIdentityRow extends RowDataPacket {
  id_customer: number;
}

export function createMysqlPrestaShopCustomerIdentityRepository(
  executor: QueryExecutor,
  tablePrefix: string,
): CustomerIdentityRepository {
  assertSafePrestashopTablePrefix(tablePrefix);

  const selectByCustomerIdSql = `
    SELECT id_customer
    FROM ${tablePrefix}customer
    WHERE id_customer = ?
    LIMIT 1
  `;

  return {
    async findByCustomerId(customerId) {
      const safeCustomerId = resolvePrestashopCustomerId(customerId);

      let rows: RowDataPacket[];
      try {
        rows = await executor.execute(selectByCustomerIdSql, [safeCustomerId]);
      } catch (error) {
        throw mapPrestashopReadError(error);
      }

      const row = rows[0] as CustomerIdentityRow | undefined;
      if (!row) {
        return null;
      }

      const identity: CustomerIdentity = {
        customerId: row.id_customer,
        externalCustomerId: row.id_customer,
        identitySource: 'PRESTASHOP',
        identityStatus: 'DIRECT_SOURCE',
        sourceMetadata: {
          platform: 'PRESTASHOP',
          entity: 'ps_customer',
          primaryKey: 'id_customer',
        },
      };
      return identity;
    },
  };
}

