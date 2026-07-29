import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../src/application/customer-profile/errors.js';
import { createMysqlPurchasedProductsReader } from '../../src/infrastructure/prestashop/mysql-purchased-products-reader.js';
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

const linkedRow = {
  product_id: 123,
  product_attribute_id: 0,
  product_name: 'Disco olimpico 20kg',
  product_reference: 'DISC20',
  total_quantity_purchased: 5,
  order_count: 2,
  first_purchased_at: '2026-01-02 10:00:00',
  last_purchased_at: '2026-01-05 12:30:00',
  total_spent_tax_incl: '99990.123456',
  catalog_status: 'linked',
} as unknown as RowDataPacket;

const deletedRow = {
  ...linkedRow,
  product_id: 122,
  product_attribute_id: 7,
  product_name: 'Barra historica',
  product_reference: null,
  total_spent_tax_incl: '0',
  catalog_status: 'deleted_or_unavailable',
} as unknown as RowDataPacket;

describe('createMysqlPurchasedProductsReader', () => {
  it('runs the deterministic historical aggregate query with limit + 1 and offset', async () => {
    const { executor, calls } = fakeExecutor([linkedRow]);
    const reader = createMysqlPurchasedProductsReader(executor, 'ps_');

    await reader.findByCustomerId({ prestashopCustomerId: 555, limit: 20, offset: 40 });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toEqual([555, 21, 40]);
    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain('WITH RANKED_LINES AS');
    expect(sql).toContain('FROM PS_ORDERS O');
    expect(sql).toContain('INNER JOIN PS_ORDER_DETAIL OD');
    expect(sql).toContain('ON OD.ID_ORDER = O.ID_ORDER');
    expect(sql).toContain('WHERE O.ID_CUSTOMER = ?');
    expect(sql).toContain('AND O.VALID = 1');
    expect(sql).toContain('PARTITION BY OD.PRODUCT_ID, OD.PRODUCT_ATTRIBUTE_ID');
    expect(sql).toContain('O.DATE_ADD DESC, O.ID_ORDER DESC, OD.ID_ORDER_DETAIL DESC');
    expect(sql).toContain('GROUP BY PRODUCT_ID, PRODUCT_ATTRIBUTE_ID');
    expect(sql).toContain('SUM(PRODUCT_QUANTITY) AS TOTAL_QUANTITY_PURCHASED');
    expect(sql).toContain('COUNT(DISTINCT ID_ORDER) AS ORDER_COUNT');
    expect(sql).toContain('MIN(DATE_ADD) AS FIRST_PURCHASED_AT');
    expect(sql).toContain('MAX(DATE_ADD) AS LAST_PURCHASED_AT');
    expect(sql).toContain('SUM(TOTAL_PRICE_TAX_INCL) AS TOTAL_SPENT_TAX_INCL');
    expect(sql).toContain('LATEST.PRODUCT_NAME');
    expect(sql).toContain('LATEST.PRODUCT_REFERENCE');
    expect(sql).toContain('LEFT JOIN PS_PRODUCT P');
    expect(sql).toContain('ORDER BY A.LAST_PURCHASED_AT DESC, A.PRODUCT_ID DESC, A.PRODUCT_ATTRIBUTE_ID DESC');
    expect(sql).toContain('LIMIT ? OFFSET ?');
  });

  it('does not use SELECT *, PII, current price, stock, current product name, state names or order history', async () => {
    const { executor, calls } = fakeExecutor([linkedRow]);
    const reader = createMysqlPurchasedProductsReader(executor, 'ps_');

    await reader.findByCustomerId({ prestashopCustomerId: 555, limit: 20, offset: 0 });

    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).not.toContain('SELECT *');
    expect(sql).not.toMatch(/\b(FIRSTNAME|LASTNAME|EMAIL|RUT|PHONE|ADDRESS)\b/);
    expect(sql).not.toContain('CURRENT_STATE = 2');
    expect(sql).not.toContain('ORDER_HISTORY');
    expect(sql).not.toContain('PS_ORDER_STATE');
    expect(sql).not.toContain('PRODUCT_PRICE');
    expect(sql).not.toContain('WHOLESALE_PRICE');
    expect(sql).not.toContain('PRICE_TAX_EXCL');
    expect(sql).not.toContain('STOCK');
    expect(sql).not.toContain('PRODUCT_LANG');
  });

  it('maps linked and deleted products, formats money, parses dates as UTC and preserves latest historical name/reference', async () => {
    const { executor } = fakeExecutor([linkedRow, deletedRow]);
    const reader = createMysqlPurchasedProductsReader(executor, 'ps_');

    const result = await reader.findByCustomerId({ prestashopCustomerId: 555, limit: 20, offset: 0 });

    expect(result).toEqual({
      products: [
        {
          productId: 123,
          productAttributeId: 0,
          productName: 'Disco olimpico 20kg',
          productReference: 'DISC20',
          totalQuantityPurchased: 5,
          orderCount: 2,
          firstPurchasedAt: new Date('2026-01-02T10:00:00.000Z'),
          lastPurchasedAt: new Date('2026-01-05T12:30:00.000Z'),
          totalSpentTaxIncl: '99990.123456',
          catalogStatus: 'linked',
        },
        {
          productId: 122,
          productAttributeId: 7,
          productName: 'Barra historica',
          productReference: null,
          totalQuantityPurchased: 5,
          orderCount: 2,
          firstPurchasedAt: new Date('2026-01-02T10:00:00.000Z'),
          lastPurchasedAt: new Date('2026-01-05T12:30:00.000Z'),
          totalSpentTaxIncl: '0.000000',
          catalogStatus: 'deleted_or_unavailable',
        },
      ],
      hasMore: false,
    });
  });

  it('calculates hasMore and trims rows to the requested limit', async () => {
    const { executor } = fakeExecutor([linkedRow, deletedRow]);
    const reader = createMysqlPurchasedProductsReader(executor, 'ps_');

    const result = await reader.findByCustomerId({ prestashopCustomerId: 555, limit: 1, offset: 0 });

    expect(result.products).toHaveLength(1);
    expect(result.hasMore).toBe(true);
  });

  it('returns an empty page for a customer without valid purchases', async () => {
    const { executor } = fakeExecutor([]);
    const reader = createMysqlPurchasedProductsReader(executor, 'ps_');

    await expect(reader.findByCustomerId({ prestashopCustomerId: 555, limit: 20, offset: 0 })).resolves.toEqual({
      products: [],
      hasMore: false,
    });
  });

  it('rejects unsafe prefixes and invalid query inputs without executing SQL', async () => {
    const { executor, calls } = fakeExecutor([linkedRow]);
    expect(() => createMysqlPurchasedProductsReader(executor, 'ps_; DROP TABLE ps_orders; --')).toThrow();

    const reader = createMysqlPurchasedProductsReader(executor, 'ps_');
    await expect(reader.findByCustomerId({ prestashopCustomerId: 0, limit: 20, offset: 0 })).rejects.toThrow();
    await expect(reader.findByCustomerId({ prestashopCustomerId: 555, limit: 0, offset: 0 })).rejects.toThrow();
    await expect(reader.findByCustomerId({ prestashopCustomerId: 555, limit: 101, offset: 0 })).rejects.toThrow();
    await expect(reader.findByCustomerId({ prestashopCustomerId: 555, limit: 1.5, offset: 0 })).rejects.toThrow();
    await expect(reader.findByCustomerId({ prestashopCustomerId: 555, limit: 20, offset: -1 })).rejects.toThrow();
    await expect(reader.findByCustomerId({ prestashopCustomerId: 555, limit: 20, offset: 1.5 })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('rejects invalid row data contractually', async () => {
    const invalidRows = [
      { ...linkedRow, product_id: 0 },
      { ...linkedRow, product_id: Number.MAX_SAFE_INTEGER + 1 },
      { ...linkedRow, product_attribute_id: -1 },
      { ...linkedRow, product_attribute_id: null },
      { ...linkedRow, product_attribute_id: Number.MAX_SAFE_INTEGER + 1 },
      { ...linkedRow, product_name: '' },
      { ...linkedRow, product_reference: '' },
      { ...linkedRow, total_quantity_purchased: -1 },
      { ...linkedRow, total_quantity_purchased: 1.5 },
      { ...linkedRow, order_count: -1 },
      { ...linkedRow, order_count: 1.5 },
      { ...linkedRow, total_spent_tax_incl: '-1.00' },
      { ...linkedRow, total_spent_tax_incl: 'not-money' },
      { ...linkedRow, first_purchased_at: 'not-a-date' },
      { ...linkedRow, first_purchased_at: '2026-01-06 00:00:00', last_purchased_at: '2026-01-05 00:00:00' },
      { ...linkedRow, catalog_status: 'archived' },
    ];

    for (const invalidRow of invalidRows) {
      const reader = createMysqlPurchasedProductsReader(fakeExecutor([invalidRow as unknown as RowDataPacket]).executor, 'ps_');
      await expect(reader.findByCustomerId({ prestashopCustomerId: 555, limit: 20, offset: 0 })).rejects.toThrow();
    }
  });

  it('supports large money totals without converting them to numbers', async () => {
    const reader = createMysqlPurchasedProductsReader(
      fakeExecutor([
        {
          ...linkedRow,
          total_spent_tax_incl: '9007199254740993.123456',
        } as unknown as RowDataPacket,
      ]).executor,
      'ps_',
    );

    const result = await reader.findByCustomerId({ prestashopCustomerId: 555, limit: 20, offset: 0 });

    expect(result.products[0]?.totalSpentTaxIncl).toBe('9007199254740993.123456');
  });

  it('maps timeout and unavailable errors while propagating unknown errors', async () => {
    await expect(
      createMysqlPurchasedProductsReader(throwingExecutor({ code: 'ETIMEDOUT' }), 'ps_').findByCustomerId({
        prestashopCustomerId: 555,
        limit: 20,
        offset: 0,
      }),
    ).rejects.toBeInstanceOf(PrestashopTimeoutError);

    await expect(
      createMysqlPurchasedProductsReader(throwingExecutor({ code: 'ECONNREFUSED' }), 'ps_').findByCustomerId({
        prestashopCustomerId: 555,
        limit: 20,
        offset: 0,
      }),
    ).rejects.toBeInstanceOf(PrestashopUnavailableError);

    await expect(
      createMysqlPurchasedProductsReader(throwingExecutor(new Error('weird')), 'ps_').findByCustomerId({
        prestashopCustomerId: 555,
        limit: 20,
        offset: 0,
      }),
    ).rejects.toThrow('weird');
  });
});
