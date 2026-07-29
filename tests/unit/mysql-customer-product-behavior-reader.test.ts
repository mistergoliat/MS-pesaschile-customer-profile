import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { PrestashopTimeoutError, PrestashopUnavailableError } from '../../src/application/customer-profile/errors.js';
import { createMysqlCustomerProductBehaviorReader } from '../../src/infrastructure/prestashop/mysql-customer-product-behavior-reader.js';
import type { QueryExecutor } from '../../src/infrastructure/shared/query-executor.js';

function fakeExecutor(responses: RowDataPacket[][]) {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const executor: QueryExecutor = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return responses[calls.length - 1] ?? [];
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

const totalsRow = {
  valid_order_count: 2,
  total_product_units_purchased: 5,
  total_product_spent_tax_incl: '100.000000',
} as unknown as RowDataPacket;

const variantRow = {
  product_id: 123,
  product_attribute_id: 0,
  product_name: 'Disco historico',
  product_reference: 'DISC',
  order_count: 2,
  total_quantity_purchased: 5,
  total_spent_tax_incl: '100.000000',
  first_purchased_at: '2026-01-01 00:00:00',
  last_purchased_at: '2026-01-05 00:00:00',
  product_order_count: 2,
  product_first_purchased_at: '2026-01-01 00:00:00',
  product_last_purchased_at: '2026-01-05 00:00:00',
  latest_observed_product_name: 'Disco historico latest',
  latest_observed_product_reference: 'DISC-L',
} as unknown as RowDataPacket;

describe('createMysqlCustomerProductBehaviorReader', () => {
  it('runs global and variant aggregate queries for the full valid-order universe', async () => {
    const { executor, calls } = fakeExecutor([[totalsRow], [variantRow]]);
    const reader = createMysqlCustomerProductBehaviorReader(executor, 'ps_');

    const result = await reader.findByCustomerId({ prestashopCustomerId: 555 });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.params).toEqual([555]);
    expect(calls[1]!.params).toEqual([555]);
    const globalSql = normalizeSql(calls[0]!.sql);
    const variantSql = normalizeSql(calls[1]!.sql);
    expect(globalSql).toContain('COUNT(DISTINCT O.ID_ORDER) AS VALID_ORDER_COUNT');
    expect(globalSql).toContain('SUM(OD.PRODUCT_QUANTITY)');
    expect(globalSql).toContain('SUM(OD.TOTAL_PRICE_TAX_INCL)');
    expect(variantSql).toContain('WITH RANKED_LINES AS');
    expect(variantSql).toContain('PARTITION BY OD.PRODUCT_ID, OD.PRODUCT_ATTRIBUTE_ID');
    expect(variantSql).toContain('PARTITION BY OD.PRODUCT_ID');
    expect(variantSql).toContain('COUNT(DISTINCT ID_ORDER) AS ORDER_COUNT');
    expect(variantSql).toContain('COUNT(DISTINCT ID_ORDER) AS PRODUCT_ORDER_COUNT');
    expect(variantSql).toContain('OD.PRODUCT_NAME');
    expect(variantSql).toContain('OD.PRODUCT_REFERENCE');
    expect(variantSql).toContain('WHERE O.ID_CUSTOMER = ? AND O.VALID = 1');
    expect(variantSql).not.toContain('LIMIT');
    expect(result).toEqual({
      validOrderCount: 2,
      totalProductUnitsPurchased: 5,
      totalProductSpentTaxIncl: '100.000000',
      variants: [
        {
          productId: 123,
          productAttributeId: 0,
          productName: 'Disco historico',
          productReference: 'DISC',
          orderCount: 2,
          totalQuantityPurchased: 5,
          totalSpentTaxIncl: '100.000000',
          firstPurchasedAt: new Date('2026-01-01T00:00:00.000Z'),
          lastPurchasedAt: new Date('2026-01-05T00:00:00.000Z'),
          productOrderCount: 2,
          productFirstPurchasedAt: new Date('2026-01-01T00:00:00.000Z'),
          productLastPurchasedAt: new Date('2026-01-05T00:00:00.000Z'),
          latestObservedProductName: 'Disco historico latest',
          latestObservedProductReference: 'DISC-L',
        },
      ],
    });
  });

  it('does not use categories, current catalog enrichment, order states, order history, SELECT * or PII', async () => {
    const { executor, calls } = fakeExecutor([[totalsRow], [variantRow]]);
    const reader = createMysqlCustomerProductBehaviorReader(executor, 'ps_');

    await reader.findByCustomerId({ prestashopCustomerId: 555 });

    const sql = `${normalizeSql(calls[0]!.sql)} ${normalizeSql(calls[1]!.sql)}`;
    expect(sql).not.toContain('SELECT *');
    expect(sql).not.toMatch(/\b(CATEGORY|MANUFACTURER|PRODUCT_LANG|PRODUCT_SHOP|PS_PRODUCT)\b/);
    expect(sql).not.toContain('CURRENT_STATE = 2');
    expect(sql).not.toContain('ORDER_STATE');
    expect(sql).not.toContain('ORDER_HISTORY');
    expect(sql).not.toMatch(/\b(EMAIL|FIRSTNAME|LASTNAME|RUT|PHONE|ADDRESS)\b/);
  });

  it('returns an empty record when the customer has no valid purchases', async () => {
    const reader = createMysqlCustomerProductBehaviorReader(
      fakeExecutor([
        [
          {
            valid_order_count: 0,
            total_product_units_purchased: 0,
            total_product_spent_tax_incl: '0',
          } as unknown as RowDataPacket,
        ],
        [],
      ]).executor,
      'ps_',
    );

    await expect(reader.findByCustomerId({ prestashopCustomerId: 555 })).resolves.toEqual({
      validOrderCount: 0,
      totalProductUnitsPurchased: 0,
      totalProductSpentTaxIncl: '0.000000',
      variants: [],
    });
  });

  it('rejects invalid inputs and invalid row data contractually', async () => {
    const { executor, calls } = fakeExecutor([[totalsRow], [variantRow]]);
    const reader = createMysqlCustomerProductBehaviorReader(executor, 'ps_');

    await expect(reader.findByCustomerId({ prestashopCustomerId: 0 })).rejects.toThrow();
    expect(calls).toHaveLength(0);

    const invalidRows = [
      { ...variantRow, product_id: 0 },
      { ...variantRow, product_attribute_id: -1 },
      { ...variantRow, product_attribute_id: null },
      { ...variantRow, product_name: '' },
      { ...variantRow, product_reference: '' },
      { ...variantRow, order_count: 0 },
      { ...variantRow, total_quantity_purchased: -1 },
      { ...variantRow, total_spent_tax_incl: null },
      { ...variantRow, total_spent_tax_incl: 'bad' },
      { ...variantRow, first_purchased_at: 'not-a-date' },
      { ...variantRow, first_purchased_at: '2026-01-06 00:00:00', last_purchased_at: '2026-01-05 00:00:00' },
      { ...variantRow, product_order_count: 0 },
      { ...variantRow, latest_observed_product_name: '' },
      { ...variantRow, latest_observed_product_reference: '' },
    ];

    for (const invalidRow of invalidRows) {
      const invalidReader = createMysqlCustomerProductBehaviorReader(
        fakeExecutor([[totalsRow], [invalidRow as unknown as RowDataPacket]]).executor,
        'ps_',
      );
      await expect(invalidReader.findByCustomerId({ prestashopCustomerId: 555 })).rejects.toThrow();
    }
  });

  it('maps timeout and unavailable errors while propagating unknown errors', async () => {
    await expect(
      createMysqlCustomerProductBehaviorReader(throwingExecutor({ code: 'ETIMEDOUT' }), 'ps_').findByCustomerId({
        prestashopCustomerId: 555,
      }),
    ).rejects.toBeInstanceOf(PrestashopTimeoutError);

    await expect(
      createMysqlCustomerProductBehaviorReader(throwingExecutor({ code: 'ECONNREFUSED' }), 'ps_').findByCustomerId({
        prestashopCustomerId: 555,
      }),
    ).rejects.toBeInstanceOf(PrestashopUnavailableError);

    await expect(
      createMysqlCustomerProductBehaviorReader(throwingExecutor(new Error('weird')), 'ps_').findByCustomerId({
        prestashopCustomerId: 555,
      }),
    ).rejects.toThrow('weird');
  });
});

