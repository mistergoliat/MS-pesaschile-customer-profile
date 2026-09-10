import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { createMysqlPrestashopCustomerExportReader } from '../../src/infrastructure/prestashop/mysql-prestashop-customer-export-reader.js';
import type { QueryExecutor } from '../../src/infrastructure/shared/query-executor.js';

describe('createMysqlPrestashopCustomerExportReader', () => {
  it('hydrates with bounded set-based IN reads, no N+1, and deterministic customer ordering', async () => {
    const calls: Array<{ readonly sql: string; readonly params: readonly unknown[] }> = [];
    const executor: QueryExecutor = {
      async execute(sql, params) {
        calls.push({ sql, params });
        return params.map((customerId) => ({
          customerId,
          email: `customer-${String(customerId)}@example.com`,
          firstname: 'First',
          lastname: 'Last',
        })) as unknown as RowDataPacket[];
      },
    };
    const reader = createMysqlPrestashopCustomerExportReader(executor, 'ps_', { chunkSize: 2 });

    const result = await reader.readByCustomerIds([4, 2, 3, 1, 2]);

    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.params)).toEqual([[1, 2], [3, 4]]);
    expect(calls.every((call) => call.sql.toUpperCase().includes('FROM PS_CUSTOMER'))).toBe(true);
    expect(calls.every((call) => call.sql.toUpperCase().includes('ID_CUSTOMER IN (?, ?)'))).toBe(true);
    expect(result.map((contact) => contact.customerId)).toEqual([1, 2, 3, 4]);
  });

  it('returns no query for an empty member set', async () => {
    let queryCount = 0;
    const executor: QueryExecutor = { async execute() { queryCount += 1; return []; } };
    const reader = createMysqlPrestashopCustomerExportReader(executor, 'ps_');

    await expect(reader.readByCustomerIds([])).resolves.toEqual([]);
    expect(queryCount).toBe(0);
  });

  it('preserves missing source rows instead of fabricating contacts', async () => {
    const executor: QueryExecutor = {
      async execute() {
        return [{ customerId: 2, email: null, firstname: null, lastname: null }] as unknown as RowDataPacket[];
      },
    };
    const reader = createMysqlPrestashopCustomerExportReader(executor, 'ps_');
    await expect(reader.readByCustomerIds([1, 2])).resolves.toEqual([
      { customerId: 2, email: null, firstname: null, lastname: null },
    ]);
  });
});
