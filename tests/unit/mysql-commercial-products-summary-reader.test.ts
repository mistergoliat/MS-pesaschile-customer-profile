import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../src/application/customer-profile/errors.js';
import { createMysqlCommercialProductsSummaryReader } from '../../src/infrastructure/prestashop/mysql-commercial-products-summary-reader.js';
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
  total_units_purchased: 10,
  distinct_products_purchased: 4,
} as unknown as RowDataPacket;

describe('createMysqlCommercialProductsSummaryReader', () => {
  it('joins orders to order_detail and filters valid orders for one customer', async () => {
    const { executor, calls } = fakeExecutor([aggregateRow]);
    const reader = createMysqlCommercialProductsSummaryReader(executor, 'ps_');

    await reader.findByCustomerId(555);

    expect(calls).toHaveLength(1);
    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain('FROM PS_ORDERS O');
    expect(sql).toContain('INNER JOIN PS_ORDER_DETAIL OD');
    expect(sql).toContain('ON OD.ID_ORDER = O.ID_ORDER');
    expect(sql).toContain('WHERE O.ID_CUSTOMER = ?');
    expect(sql).toContain('AND O.VALID = 1');
    expect(calls[0]!.params).toEqual([555]);
  });

  it('selects only aggregate product metrics, no product names, SELECT * or writes', async () => {
    const { executor, calls } = fakeExecutor([aggregateRow]);
    const reader = createMysqlCommercialProductsSummaryReader(executor, 'ps_');

    await reader.findByCustomerId(555);

    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain('SUM(OD.PRODUCT_QUANTITY)');
    expect(sql).toContain('COUNT(DISTINCT OD.PRODUCT_ID)');
    expect(sql).not.toContain('PRODUCT_NAME');
    expect(sql).not.toContain('SELECT *');
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER)\b/);
  });

  it('maps units and distinct products, including empty purchases', async () => {
    const reader = createMysqlCommercialProductsSummaryReader(fakeExecutor([aggregateRow]).executor, 'ps_');
    await expect(reader.findByCustomerId(555)).resolves.toEqual({
      totalUnitsPurchased: 10,
      distinctProductsPurchased: 4,
    });

    const emptyReader = createMysqlCommercialProductsSummaryReader(
      fakeExecutor([{ total_units_purchased: null, distinct_products_purchased: 0 } as unknown as RowDataPacket])
        .executor,
      'ps_',
    );
    await expect(emptyReader.findByCustomerId(555)).resolves.toEqual({
      totalUnitsPurchased: 0,
      distinctProductsPurchased: 0,
    });
  });

  it('rejects unsafe prefixes, invalid customer ids and invalid counts', async () => {
    const { executor, calls } = fakeExecutor([aggregateRow]);
    expect(() => createMysqlCommercialProductsSummaryReader(executor, 'ps_; DROP TABLE ps_orders; --')).toThrow();

    const reader = createMysqlCommercialProductsSummaryReader(executor, 'ps_');
    for (const id of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(reader.findByCustomerId(id)).rejects.toThrow();
    }

    const badReader = createMysqlCommercialProductsSummaryReader(
      fakeExecutor([{ total_units_purchased: -1, distinct_products_purchased: 0 } as unknown as RowDataPacket])
        .executor,
      'ps_',
    );
    await expect(badReader.findByCustomerId(555)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('maps timeout and unavailable errors while propagating unknown errors', async () => {
    await expect(
      createMysqlCommercialProductsSummaryReader(throwingExecutor({ code: 'ETIMEDOUT' }), 'ps_').findByCustomerId(555),
    ).rejects.toBeInstanceOf(PrestashopTimeoutError);

    await expect(
      createMysqlCommercialProductsSummaryReader(throwingExecutor({ code: 'ECONNREFUSED' }), 'ps_').findByCustomerId(
        555,
      ),
    ).rejects.toBeInstanceOf(PrestashopUnavailableError);

    await expect(
      createMysqlCommercialProductsSummaryReader(throwingExecutor(new Error('weird')), 'ps_').findByCustomerId(555),
    ).rejects.toThrow('weird');
  });
});
