import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import {
  CrmSchemaIncompatibleError,
  CrmTimeoutError,
  CrmUnavailableError,
} from '../../src/application/customer-profile/errors.js';
import { createMysqlMasterCustomerReader } from '../../src/infrastructure/crm/mysql-master-customer-reader.js';
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

describe('createMysqlMasterCustomerReader', () => {
  it('queries by id with a parameter, LIMIT 1, no email lookup, no writes', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlMasterCustomerReader(executor);

    await reader.findById('42');

    expect(calls).toHaveLength(1);
    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain('WHERE ID = ?');
    expect(sql).toContain('LIMIT 1');
    expect(sql).not.toContain('EMAIL = ?');
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    expect(calls[0]!.params).toEqual(['42']);
  });

  it('returns null when no row is found', async () => {
    const { executor } = fakeExecutor([]);
    const reader = createMysqlMasterCustomerReader(executor);

    const result = await reader.findById('999');

    expect(result).toBeNull();
  });

  it('maps a found row from snake_case to camelCase', async () => {
    const row = {
      id: '1',
      firstname: 'Ana',
      lastname: 'Perez',
      email: 'ana@example.com',
      platform_origin: 'prestashop',
      rut: null,
      prestashop_customer_id: 555,
    } as unknown as RowDataPacket;
    const { executor } = fakeExecutor([row]);
    const reader = createMysqlMasterCustomerReader(executor);

    const result = await reader.findById('1');

    expect(result).toEqual({
      id: '1',
      firstname: 'Ana',
      lastname: 'Perez',
      email: 'ana@example.com',
      platformOrigin: 'prestashop',
      rut: null,
      prestashopCustomerId: 555,
    });
  });

  it('preserves a bigint id string without precision loss', async () => {
    const bigId = '18446744073709551615';
    const row = {
      id: bigId,
      firstname: 'Ana',
      lastname: 'Perez',
      email: 'ana@example.com',
      platform_origin: 'prestashop',
      rut: null,
      prestashop_customer_id: null,
    } as unknown as RowDataPacket;
    const { executor } = fakeExecutor([row]);
    const reader = createMysqlMasterCustomerReader(executor);

    const result = await reader.findById(bigId);

    expect(result?.id).toBe(bigId);
    expect(typeof result?.id).toBe('string');
  });

  it('maps ER_BAD_FIELD_ERROR to CrmSchemaIncompatibleError', async () => {
    const reader = createMysqlMasterCustomerReader(
      throwingExecutor(Object.assign(new Error('Unknown column'), { code: 'ER_BAD_FIELD_ERROR' })),
    );

    await expect(reader.findById('1')).rejects.toBeInstanceOf(CrmSchemaIncompatibleError);
  });

  it('maps ER_NO_SUCH_TABLE to CrmSchemaIncompatibleError', async () => {
    const reader = createMysqlMasterCustomerReader(
      throwingExecutor(Object.assign(new Error('no such table'), { code: 'ER_NO_SUCH_TABLE' })),
    );

    await expect(reader.findById('1')).rejects.toBeInstanceOf(CrmSchemaIncompatibleError);
  });

  it('maps ETIMEDOUT to CrmTimeoutError', async () => {
    const reader = createMysqlMasterCustomerReader(
      throwingExecutor(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
    );

    await expect(reader.findById('1')).rejects.toBeInstanceOf(CrmTimeoutError);
  });

  it('maps ECONNREFUSED to CrmUnavailableError', async () => {
    const reader = createMysqlMasterCustomerReader(
      throwingExecutor(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
    );

    await expect(reader.findById('1')).rejects.toBeInstanceOf(CrmUnavailableError);
  });

  it('maps ER_ACCESS_DENIED_ERROR to CrmUnavailableError', async () => {
    const reader = createMysqlMasterCustomerReader(
      throwingExecutor(Object.assign(new Error('Access denied'), { code: 'ER_ACCESS_DENIED_ERROR' })),
    );

    await expect(reader.findById('1')).rejects.toBeInstanceOf(CrmUnavailableError);
  });

  it('propagates an unclassified error unchanged instead of guessing', async () => {
    const reader = createMysqlMasterCustomerReader(throwingExecutor(new Error('weird driver error')));

    await expect(reader.findById('1')).rejects.toThrow('weird driver error');
  });
});
