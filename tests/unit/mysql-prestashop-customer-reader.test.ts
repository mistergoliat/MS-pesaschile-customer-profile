import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../src/application/customer-profile/errors.js';
import { createMysqlPrestashopCustomerReader } from '../../src/infrastructure/prestashop/mysql-prestashop-customer-reader.js';
import type { QueryExecutor } from '../../src/infrastructure/shared/query-executor.js';

function fakeExecutor(rows: RowDataPacket[]) {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const executor: QueryExecutor = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return rows;
    },
  };
  return { executor, calls };
}

function throwingExecutor(error: unknown): QueryExecutor {
  return {
    async execute() {
      throw error;
    },
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toUpperCase();
}

describe('createMysqlPrestashopCustomerReader', () => {
  it('queries the prefixed table by id_customer with a parameter, LIMIT 1, no email lookup, no writes', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlPrestashopCustomerReader(executor, 'ps_');

    await reader.findById(555);

    expect(calls).toHaveLength(1);
    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain('WHERE ID_CUSTOMER = ?');
    expect(sql).toContain('LIMIT 1');
    expect(sql).toContain('FROM PS_CUSTOMER');
    expect(sql).not.toContain('EMAIL = ?');
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(calls[0]!.params).toEqual([555]);
  });

  it('rejects an unsafe table prefix instead of interpolating it', () => {
    const { executor } = fakeExecutor([]);

    expect(() => createMysqlPrestashopCustomerReader(executor, 'ps_; DROP TABLE ps_customer; --')).toThrow();
  });

  it('returns null when ps_customer has no matching row', async () => {
    const { executor } = fakeExecutor([]);
    const reader = createMysqlPrestashopCustomerReader(executor, 'ps_');

    const result = await reader.findById(555);

    expect(result).toBeNull();
  });

  it('maps a found row from snake_case to camelCase, coercing active to boolean', async () => {
    const row = {
      id_customer: 555,
      firstname: 'Ana',
      lastname: 'Perez',
      email: 'ana@example.com',
      active: 1,
      id_shop: 1,
      date_add: '2024-01-01 00:00:00',
      date_upd: '2024-01-02 00:00:00',
    } as unknown as RowDataPacket;
    const { executor } = fakeExecutor([row]);
    const reader = createMysqlPrestashopCustomerReader(executor, 'ps_');

    const result = await reader.findById(555);

    expect(result).toEqual({
      idCustomer: 555,
      firstname: 'Ana',
      lastname: 'Perez',
      email: 'ana@example.com',
      active: true,
      idShop: 1,
      dateAdd: '2024-01-01 00:00:00',
      dateUpd: '2024-01-02 00:00:00',
    });
  });

  it('maps a timeout error code to PrestashopTimeoutError', async () => {
    const reader = createMysqlPrestashopCustomerReader(throwingExecutor({ code: 'ETIMEDOUT' }), 'ps_');

    await expect(reader.findById(555)).rejects.toBeInstanceOf(PrestashopTimeoutError);
  });

  it('maps a connection-refused error code to PrestashopUnavailableError', async () => {
    const reader = createMysqlPrestashopCustomerReader(throwingExecutor({ code: 'ECONNREFUSED' }), 'ps_');

    await expect(reader.findById(555)).rejects.toBeInstanceOf(PrestashopUnavailableError);
  });

  it('propagates an unclassified error unchanged instead of guessing', async () => {
    const reader = createMysqlPrestashopCustomerReader(throwingExecutor(new Error('weird driver error')), 'ps_');

    await expect(reader.findById(555)).rejects.toThrow('weird driver error');
  });
});
