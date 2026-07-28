import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../src/application/customer-profile/errors.js';
import { createMysqlCustomerOrdersReader } from '../../src/infrastructure/prestashop/mysql-customer-orders-reader.js';
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
  id_order: 100,
  reference: 'REF100',
  id_customer: 555,
  current_state: 4,
  valid: 1,
  date_add: '2026-01-01 10:00:00',
  date_upd: '2026-01-02 10:00:00',
  total_paid_tax_incl: '10000.000000',
  total_products_wt: '9500.000000',
  id_currency: 1,
} as unknown as RowDataPacket;

describe('createMysqlCustomerOrdersReader', () => {
  it('queries the prefixed orders table by id_customer with a parameter, no email, no writes', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCustomerOrdersReader(executor, 'ps_');

    await reader.findByCustomerId(555);

    expect(calls).toHaveLength(1);
    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain('FROM PS_ORDERS');
    expect(sql).toContain('WHERE ID_CUSTOMER = ?');
    expect(sql).not.toContain('EMAIL');
    expect(sql).not.toContain('ID_GUEST');
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER)\b/);
    expect(calls[0]!.params).toEqual([555]);
  });

  it('orders deterministically by date_add DESC, id_order DESC', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCustomerOrdersReader(executor, 'ps_');

    await reader.findByCustomerId(555);

    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain('ORDER BY DATE_ADD DESC, ID_ORDER DESC');
  });

  it('applies the default LIMIT when none is provided', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCustomerOrdersReader(executor, 'ps_');

    await reader.findByCustomerId(555);

    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain('LIMIT 10');
  });

  it('applies a caller-provided LIMIT', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCustomerOrdersReader(executor, 'ps_');

    await reader.findByCustomerId(555, { limit: 3 });

    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain('LIMIT 3');
  });

  it('does not filter by current_state or valid — every ps_orders row counts as paid', async () => {
    const { executor, calls } = fakeExecutor([]);
    const reader = createMysqlCustomerOrdersReader(executor, 'ps_');

    await reader.findByCustomerId(555);

    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).not.toContain('CURRENT_STATE =');
    expect(sql).not.toContain('VALID =');
    // Both columns must still be selected (captured raw), just never used as a filter.
    expect(sql).toContain('CURRENT_STATE');
    expect(sql).toContain('VALID');
  });

  it('rejects an unsafe table prefix instead of interpolating it', () => {
    const { executor } = fakeExecutor([]);

    expect(() => createMysqlCustomerOrdersReader(executor, 'ps_; DROP TABLE ps_orders; --')).toThrow();
  });

  it('rejects an invalid limit (zero, negative, non-integer, or above the max) instead of using it', async () => {
    const { executor } = fakeExecutor([]);
    const reader = createMysqlCustomerOrdersReader(executor, 'ps_');

    await expect(reader.findByCustomerId(555, { limit: 0 })).rejects.toThrow();
    await expect(reader.findByCustomerId(555, { limit: -1 })).rejects.toThrow();
    await expect(reader.findByCustomerId(555, { limit: 1.5 })).rejects.toThrow();
    await expect(reader.findByCustomerId(555, { limit: 51 })).rejects.toThrow();
  });

  it('returns an empty array when ps_orders has no matching rows (not an error)', async () => {
    const { executor } = fakeExecutor([]);
    const reader = createMysqlCustomerOrdersReader(executor, 'ps_');

    const result = await reader.findByCustomerId(555);

    expect(result).toEqual([]);
  });

  it('maps rows from snake_case to camelCase, preserving amounts as strings and converting valid to boolean', async () => {
    const { executor } = fakeExecutor([sampleRow]);
    const reader = createMysqlCustomerOrdersReader(executor, 'ps_');

    const result = await reader.findByCustomerId(555);

    expect(result).toEqual([
      {
        orderId: 100,
        reference: 'REF100',
        customerId: 555,
        currentStateId: 4,
        valid: true,
        createdAt: '2026-01-01 10:00:00',
        updatedAt: '2026-01-02 10:00:00',
        totalPaidTaxIncl: '10000.000000',
        totalProductsTaxIncl: '9500.000000',
        currencyId: 1,
      },
    ]);
    expect(typeof result[0]!.totalPaidTaxIncl).toBe('string');
    expect(typeof result[0]!.totalProductsTaxIncl).toBe('string');
  });

  it('converts valid = 0 to false', async () => {
    const { executor } = fakeExecutor([{ ...sampleRow, valid: 0 } as unknown as RowDataPacket]);
    const reader = createMysqlCustomerOrdersReader(executor, 'ps_');

    const result = await reader.findByCustomerId(555);

    expect(result[0]!.valid).toBe(false);
  });

  it('maps a timeout error code to PrestashopTimeoutError', async () => {
    const reader = createMysqlCustomerOrdersReader(throwingExecutor({ code: 'ETIMEDOUT' }), 'ps_');

    await expect(reader.findByCustomerId(555)).rejects.toBeInstanceOf(PrestashopTimeoutError);
  });

  it('maps a connection-refused error code to PrestashopUnavailableError', async () => {
    const reader = createMysqlCustomerOrdersReader(throwingExecutor({ code: 'ECONNREFUSED' }), 'ps_');

    await expect(reader.findByCustomerId(555)).rejects.toBeInstanceOf(PrestashopUnavailableError);
  });

  it('propagates an unclassified error unchanged instead of guessing', async () => {
    const reader = createMysqlCustomerOrdersReader(throwingExecutor(new Error('weird driver error')), 'ps_');

    await expect(reader.findByCustomerId(555)).rejects.toThrow('weird driver error');
  });
});
