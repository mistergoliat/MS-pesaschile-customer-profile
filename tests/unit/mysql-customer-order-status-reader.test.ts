import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../src/application/customer-profile/errors.js';
import { createMysqlCustomerOrderStatusReader } from '../../src/infrastructure/prestashop/mysql-customer-order-status-reader.js';
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

const sampleRow = {
  id_order: 123,
  reference: 'ABC123XYZ',
  id_customer: 555,
  current_state: 4,
  id_carrier: 2,
  date_upd: '2026-01-02 10:00:00',
} as unknown as RowDataPacket;

describe('createMysqlCustomerOrderStatusReader', () => {
  it('queries the prefixed orders table by id_customer AND reference in the same WHERE, with LIMIT 1', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCustomerOrderStatusReader(executor, 'ps_');

    await reader.findByCustomerAndReference(555, 'ABC123XYZ');

    expect(calls).toHaveLength(1);
    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain('FROM PS_ORDERS');
    expect(sql).toContain('WHERE ID_CUSTOMER = ?');
    expect(sql).toContain('AND REFERENCE = ?');
    expect(sql).toContain('LIMIT 1');
    expect(calls[0]!.params).toEqual([555, 'ABC123XYZ']);
  });

  it('never queries by reference alone (id_customer is always the first bound parameter)', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCustomerOrderStatusReader(executor, 'ps_');

    await reader.findByCustomerAndReference(555, 'ABC123XYZ');

    expect(calls[0]!.params[0]).toBe(555);
  });

  it('selects only the documented columns, no SELECT *, no writes', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCustomerOrderStatusReader(executor, 'ps_');

    await reader.findByCustomerAndReference(555, 'ABC123XYZ');

    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).not.toContain('SELECT *');
    expect(sql).toContain('ID_ORDER');
    expect(sql).toContain('REFERENCE');
    expect(sql).toContain('ID_CUSTOMER');
    expect(sql).toContain('CURRENT_STATE');
    expect(sql).toContain('ID_CARRIER');
    expect(sql).toContain('DATE_UPD');
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER)\b/);
  });

  it('never touches ps_order_history', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCustomerOrderStatusReader(executor, 'ps_');

    await reader.findByCustomerAndReference(555, 'ABC123XYZ');

    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).not.toContain('ORDER_HISTORY');
  });

  it('rejects an unsafe table prefix instead of interpolating it', () => {
    const { executor } = fakeExecutor([]);

    expect(() => createMysqlCustomerOrderStatusReader(executor, 'ps_; DROP TABLE ps_orders; --')).toThrow();
  });

  it('rejects an invalid customerId (zero, negative, decimal) without executing SQL', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCustomerOrderStatusReader(executor, 'ps_');

    await expect(reader.findByCustomerAndReference(0, 'ABC123XYZ')).rejects.toThrow();
    await expect(reader.findByCustomerAndReference(-1, 'ABC123XYZ')).rejects.toThrow();
    await expect(reader.findByCustomerAndReference(1.5, 'ABC123XYZ')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('rejects an empty reference without executing SQL', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCustomerOrderStatusReader(executor, 'ps_');

    await expect(reader.findByCustomerAndReference(555, '')).rejects.toThrow();
    await expect(reader.findByCustomerAndReference(555, '   ')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('rejects a reference that is too long without executing SQL', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCustomerOrderStatusReader(executor, 'ps_');

    await expect(reader.findByCustomerAndReference(555, 'A'.repeat(33))).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('rejects a reference with unsafe characters without executing SQL', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCustomerOrderStatusReader(executor, 'ps_');

    await expect(reader.findByCustomerAndReference(555, "ABC'; DROP TABLE ps_orders; --")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('returns null when the order does not exist for this customer (e.g. wrong reference or another customer entirely)', async () => {
    const { executor } = fakeExecutor([]);
    const reader = createMysqlCustomerOrderStatusReader(executor, 'ps_');

    const result = await reader.findByCustomerAndReference(555, 'ABC123XYZ');

    expect(result).toBeNull();
  });

  it('maps a row from snake_case to camelCase and parses date_upd into a Date', async () => {
    const { executor } = fakeExecutor([sampleRow]);
    const reader = createMysqlCustomerOrderStatusReader(executor, 'ps_');

    const result = await reader.findByCustomerAndReference(555, 'ABC123XYZ');

    expect(result).toEqual({
      orderId: 123,
      reference: 'ABC123XYZ',
      customerId: 555,
      currentStateId: 4,
      carrierId: 2,
      updatedAt: new Date('2026-01-02T10:00:00Z'),
    });
    expect(result?.updatedAt).toBeInstanceOf(Date);
  });

  it('rejects an unparseable date_upd instead of returning an Invalid Date', async () => {
    const { executor } = fakeExecutor([{ ...sampleRow, date_upd: 'not-a-date' } as unknown as RowDataPacket]);
    const reader = createMysqlCustomerOrderStatusReader(executor, 'ps_');

    await expect(reader.findByCustomerAndReference(555, 'ABC123XYZ')).rejects.toThrow();
  });

  it('maps a timeout error code to PrestashopTimeoutError', async () => {
    const reader = createMysqlCustomerOrderStatusReader(throwingExecutor({ code: 'ETIMEDOUT' }), 'ps_');

    await expect(reader.findByCustomerAndReference(555, 'ABC123XYZ')).rejects.toBeInstanceOf(PrestashopTimeoutError);
  });

  it('maps a connection-refused error code to PrestashopUnavailableError', async () => {
    const reader = createMysqlCustomerOrderStatusReader(throwingExecutor({ code: 'ECONNREFUSED' }), 'ps_');

    await expect(reader.findByCustomerAndReference(555, 'ABC123XYZ')).rejects.toBeInstanceOf(
      PrestashopUnavailableError,
    );
  });

  it('propagates an unclassified error unchanged instead of guessing', async () => {
    const reader = createMysqlCustomerOrderStatusReader(throwingExecutor(new Error('weird driver error')), 'ps_');

    await expect(reader.findByCustomerAndReference(555, 'ABC123XYZ')).rejects.toThrow('weird driver error');
  });
});
