import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../src/application/customer-profile/errors.js';
import { createMysqlOrderStatesReader } from '../../src/infrastructure/prestashop/mysql-order-states-reader.js';
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

describe('createMysqlOrderStatesReader', () => {
  it('returns [] and does not execute a query when stateIds is empty', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlOrderStatesReader(executor, 'ps_');

    const result = await reader.findByIds([], 1);

    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('deduplicates stateIds before building the query', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlOrderStatesReader(executor, 'ps_');

    await reader.findByIds([2, 4, 4, 5], 1);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual([2, 4, 5, 1]);
  });

  it('builds exactly one IN placeholder per unique id', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlOrderStatesReader(executor, 'ps_');

    await reader.findByIds([2, 4, 4, 5], 1);

    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain('IN (?, ?, ?)');
  });

  it('parameterizes ids with languageId as the last parameter', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlOrderStatesReader(executor, 'ps_');

    await reader.findByIds([9], 3);

    expect(calls[0]!.params).toEqual([9, 3]);
  });

  it('queries the prefixed order_state table joined with order_state_lang, filtered by id_lang, no name search, no writes', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlOrderStatesReader(executor, 'ps_');

    await reader.findByIds([4], 1);

    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain('FROM PS_ORDER_STATE OS');
    expect(sql).toContain('INNER JOIN PS_ORDER_STATE_LANG OSL');
    expect(sql).toContain('ON OSL.ID_ORDER_STATE = OS.ID_ORDER_STATE');
    expect(sql).toContain('AND OSL.ID_LANG = ?');
    expect(sql).not.toContain('NAME =');
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER)\b/);
  });

  it('does not use GROUP_CONCAT', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlOrderStatesReader(executor, 'ps_');

    await reader.findByIds([4], 1);

    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).not.toContain('GROUP_CONCAT');
  });

  it('maps rows from snake_case to camelCase', async () => {
    const row = { id_order_state: 4, name: 'Enviado' } as unknown as RowDataPacket;
    const { executor } = fakeExecutor([row]);
    const reader = createMysqlOrderStatesReader(executor, 'ps_');

    const result = await reader.findByIds([4], 1);

    expect(result).toEqual([{ stateId: 4, name: 'Enviado' }]);
  });

  it('rejects an unsafe table prefix instead of interpolating it', () => {
    const { executor } = fakeExecutor([]);

    expect(() => createMysqlOrderStatesReader(executor, 'ps_; DROP TABLE ps_order_state; --')).toThrow();
  });

  it('rejects an invalid stateId (zero, negative, decimal) instead of using it', async () => {
    const { executor } = fakeExecutor([]);
    const reader = createMysqlOrderStatesReader(executor, 'ps_');

    await expect(reader.findByIds([0], 1)).rejects.toThrow();
    await expect(reader.findByIds([-1], 1)).rejects.toThrow();
    await expect(reader.findByIds([1.5], 1)).rejects.toThrow();
  });

  it('rejects an invalid languageId (zero, negative, decimal) instead of using it', async () => {
    const { executor } = fakeExecutor([]);
    const reader = createMysqlOrderStatesReader(executor, 'ps_');

    await expect(reader.findByIds([4], 0)).rejects.toThrow();
    await expect(reader.findByIds([4], -1)).rejects.toThrow();
    await expect(reader.findByIds([4], 1.5)).rejects.toThrow();
  });

  it('rejects an unsafe stateId (NaN, Infinity, -Infinity, MAX_SAFE_INTEGER + 1) without executing SQL', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlOrderStatesReader(executor, 'ps_');

    await expect(reader.findByIds([Number.NaN], 1)).rejects.toThrow();
    await expect(reader.findByIds([Number.POSITIVE_INFINITY], 1)).rejects.toThrow();
    await expect(reader.findByIds([Number.NEGATIVE_INFINITY], 1)).rejects.toThrow();
    await expect(reader.findByIds([Number.MAX_SAFE_INTEGER + 1], 1)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('rejects an unsafe languageId (NaN, Infinity, -Infinity, MAX_SAFE_INTEGER + 1) without executing SQL', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlOrderStatesReader(executor, 'ps_');

    await expect(reader.findByIds([4], Number.NaN)).rejects.toThrow();
    await expect(reader.findByIds([4], Number.POSITIVE_INFINITY)).rejects.toThrow();
    await expect(reader.findByIds([4], Number.NEGATIVE_INFINITY)).rejects.toThrow();
    await expect(reader.findByIds([4], Number.MAX_SAFE_INTEGER + 1)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('maps a timeout error code to PrestashopTimeoutError', async () => {
    const reader = createMysqlOrderStatesReader(throwingExecutor({ code: 'ETIMEDOUT' }), 'ps_');

    await expect(reader.findByIds([4], 1)).rejects.toBeInstanceOf(PrestashopTimeoutError);
  });

  it('maps a connection-refused error code to PrestashopUnavailableError', async () => {
    const reader = createMysqlOrderStatesReader(throwingExecutor({ code: 'ECONNREFUSED' }), 'ps_');

    await expect(reader.findByIds([4], 1)).rejects.toBeInstanceOf(PrestashopUnavailableError);
  });

  it('propagates an unclassified error unchanged instead of guessing', async () => {
    const reader = createMysqlOrderStatesReader(throwingExecutor(new Error('weird driver error')), 'ps_');

    await expect(reader.findByIds([4], 1)).rejects.toThrow('weird driver error');
  });
});
