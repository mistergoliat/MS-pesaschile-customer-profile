import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../src/application/customer-profile/errors.js';
import { createMysqlCommercialOrdersSummaryReader } from '../../src/infrastructure/prestashop/mysql-commercial-orders-summary-reader.js';
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

const aggregateRow = {
  total_orders: 2,
  total_spent_tax_incl: '142177.121231',
  first_order_at: '2026-01-02 10:00:00',
  last_order_at: '2026-01-05 12:30:00',
  cancelled_order_count: 1,
  refunded_order_count: 1,
} as unknown as RowDataPacket;

describe('createMysqlCommercialOrdersSummaryReader', () => {
  it('runs the aggregate-only orders query with id_customer as the only parameter', async () => {
    const { executor, calls } = fakeExecutor([aggregateRow]);
    const reader = createMysqlCommercialOrdersSummaryReader(executor, 'ps_');

    await reader.findByCustomerId(555);

    expect(calls).toHaveLength(1);
    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain('FROM PS_ORDERS');
    expect(sql).toContain('WHERE ID_CUSTOMER = ?');
    expect(calls[0]!.params).toEqual([555]);
  });

  it('uses valid = 1 only for commercial purchase metrics', async () => {
    const { executor, calls } = fakeExecutor([aggregateRow]);
    const reader = createMysqlCommercialOrdersSummaryReader(executor, 'ps_');

    await reader.findByCustomerId(555);

    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain('CASE WHEN VALID = 1 THEN 1 ELSE 0 END');
    expect(sql).toContain('CASE WHEN VALID = 1 THEN TOTAL_PAID_TAX_INCL ELSE 0 END');
    expect(sql).toContain('MIN(CASE WHEN VALID = 1 THEN DATE_ADD ELSE NULL END)');
    expect(sql).toContain('MAX(CASE WHEN VALID = 1 THEN DATE_ADD ELSE NULL END)');
    expect(sql).toContain('CASE WHEN CURRENT_STATE = 6 THEN 1 ELSE 0 END');
    expect(sql).toContain('CASE WHEN CURRENT_STATE = 7 THEN 1 ELSE 0 END');
    expect(sql).not.toContain('CURRENT_STATE = 2');
    expect(sql).not.toContain('ORDER_HISTORY');
  });

  it('selects no PII, references, joins, SELECT * or writes', async () => {
    const { executor, calls } = fakeExecutor([aggregateRow]);
    const reader = createMysqlCommercialOrdersSummaryReader(executor, 'ps_');

    await reader.findByCustomerId(555);

    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).not.toContain('SELECT *');
    expect(sql).not.toMatch(/\b(FIRSTNAME|LASTNAME|EMAIL|RUT|PHONE|ADDRESS|REFERENCE)\b/);
    expect(sql).not.toMatch(/\bJOIN\b/);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER)\b/);
  });

  it('maps valid aggregate rows and parses dates as UTC', async () => {
    const { executor } = fakeExecutor([aggregateRow]);
    const reader = createMysqlCommercialOrdersSummaryReader(executor, 'ps_');

    const result = await reader.findByCustomerId(555);

    expect(result).toEqual({
      totalOrders: 2,
      totalSpentTaxIncl: '142177.121231',
      firstOrderAt: new Date('2026-01-02T10:00:00.000Z'),
      lastOrderAt: new Date('2026-01-05T12:30:00.000Z'),
      cancelledOrderCount: 1,
      refundedOrderCount: 1,
    });
  });

  it('handles a customer with no orders and null commercial dates', async () => {
    const { executor } = fakeExecutor([
      {
        total_orders: null,
        total_spent_tax_incl: '0.000000',
        first_order_at: null,
        last_order_at: null,
        cancelled_order_count: null,
        refunded_order_count: null,
      } as unknown as RowDataPacket,
    ]);
    const reader = createMysqlCommercialOrdersSummaryReader(executor, 'ps_');

    await expect(reader.findByCustomerId(555)).resolves.toEqual({
      totalOrders: 0,
      totalSpentTaxIncl: '0.000000',
      firstOrderAt: null,
      lastOrderAt: null,
      cancelledOrderCount: 0,
      refundedOrderCount: 0,
    });
  });

  it('rejects contractually invalid aggregate data', async () => {
    const readerWithBadCount = createMysqlCommercialOrdersSummaryReader(
      fakeExecutor([{ ...aggregateRow, total_orders: '-1' } as unknown as RowDataPacket]).executor,
      'ps_',
    );
    await expect(readerWithBadCount.findByCustomerId(555)).rejects.toThrow();

    const readerWithBadDates = createMysqlCommercialOrdersSummaryReader(
      fakeExecutor([
        {
          ...aggregateRow,
          first_order_at: '2026-01-06 00:00:00',
          last_order_at: '2026-01-05 00:00:00',
        } as unknown as RowDataPacket,
      ]).executor,
      'ps_',
    );
    await expect(readerWithBadDates.findByCustomerId(555)).rejects.toThrow();

    const readerWithPositiveOrdersAndNullDates = createMysqlCommercialOrdersSummaryReader(
      fakeExecutor([
        {
          ...aggregateRow,
          total_orders: 1,
          first_order_at: null,
          last_order_at: null,
        } as unknown as RowDataPacket,
      ]).executor,
      'ps_',
    );
    await expect(readerWithPositiveOrdersAndNullDates.findByCustomerId(555)).rejects.toThrow();

    const readerWithZeroOrdersAndNonNullDates = createMysqlCommercialOrdersSummaryReader(
      fakeExecutor([
        {
          ...aggregateRow,
          total_orders: 0,
          first_order_at: '2026-01-02 10:00:00',
          last_order_at: null,
        } as unknown as RowDataPacket,
      ]).executor,
      'ps_',
    );
    await expect(readerWithZeroOrdersAndNonNullDates.findByCustomerId(555)).rejects.toThrow();

    const readerWithBadMoney = createMysqlCommercialOrdersSummaryReader(
      fakeExecutor([{ ...aggregateRow, total_spent_tax_incl: '-1.00' } as unknown as RowDataPacket]).executor,
      'ps_',
    );
    await expect(readerWithBadMoney.findByCustomerId(555)).rejects.toThrow();
  });

  it('rejects unsafe prefixes and invalid customer ids without executing SQL', async () => {
    const { executor, calls } = fakeExecutor([aggregateRow]);
    expect(() => createMysqlCommercialOrdersSummaryReader(executor, 'ps_; DROP TABLE ps_orders; --')).toThrow();

    const reader = createMysqlCommercialOrdersSummaryReader(executor, 'ps_');
    for (const id of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(reader.findByCustomerId(id)).rejects.toThrow();
    }
    expect(calls).toHaveLength(0);
  });

  it('maps timeout and unavailable errors while propagating unknown errors', async () => {
    await expect(
      createMysqlCommercialOrdersSummaryReader(throwingExecutor({ code: 'ETIMEDOUT' }), 'ps_').findByCustomerId(555),
    ).rejects.toBeInstanceOf(PrestashopTimeoutError);

    await expect(
      createMysqlCommercialOrdersSummaryReader(throwingExecutor({ code: 'ECONNREFUSED' }), 'ps_').findByCustomerId(555),
    ).rejects.toBeInstanceOf(PrestashopUnavailableError);

    await expect(
      createMysqlCommercialOrdersSummaryReader(throwingExecutor(new Error('weird')), 'ps_').findByCustomerId(555),
    ).rejects.toThrow('weird');
  });
});
