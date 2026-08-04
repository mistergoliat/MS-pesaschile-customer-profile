import type { RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { createMysqlRfmPopulationReader } from '../../src/infrastructure/prestashop/mysql-rfm-population-reader.js';
import type { QueryExecutor } from '../../src/infrastructure/shared/query-executor.js';

function scriptedExecutor(results: RowDataPacket[][]) {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  const executor: QueryExecutor = {
    async execute(sql, params) {
      calls.push({ sql, params });
      const result = results.shift();
      if (!result) throw new Error('Unexpected query');
      return result;
    },
  };
  return { executor, calls };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toUpperCase();
}

describe('createMysqlRfmPopulationReader', () => {
  it('verifies required source schema tables and columns', async () => {
    const columnRows = (columns: readonly string[]) =>
      columns.map((columnName) => ({ columnName }) as unknown as RowDataPacket);
    const { executor, calls } = scriptedExecutor([
      columnRows(['id_order', 'id_customer', 'id_currency', 'id_shop', 'valid', 'date_add', 'total_paid_tax_incl', 'conversion_rate']),
      columnRows(['id_customer']),
      columnRows(['id_currency', 'iso_code']),
      columnRows(['id_order', 'product_quantity_refunded', 'total_refunded_tax_incl']),
    ]);

    await createMysqlRfmPopulationReader(executor, 'ps_').verifySchema();

    expect(calls).toHaveLength(4);
    expect(calls.every((call) => normalizeSql(call.sql).includes('INFORMATION_SCHEMA.COLUMNS'))).toBe(true);
  });

  it('extracts the active population with valid orders, usable customers and inclusive/exclusive bounds', async () => {
    const { executor, calls } = scriptedExecutor([
      [
        {
          prestashopCustomerId: 123,
          firstValidOrderAt: '2025-09-01 10:00:00',
          lastValidOrderAt: '2026-08-02 10:00:00',
          frequencyOrders: '2',
          grossOrderValueTaxIncl: '250.000000',
          distinctShopCount: '2',
        } as unknown as RowDataPacket,
      ],
    ]);

    const result = await createMysqlRfmPopulationReader(executor, 'ps_').readPopulation(
      '2025-08-03 00:00:00',
      '2026-08-03 00:00:00',
    );

    expect(result).toEqual([
      {
        prestashopCustomerId: 123,
        firstValidOrderAt: '2025-09-01 10:00:00',
        lastValidOrderAt: '2026-08-02 10:00:00',
        frequencyOrders: 2,
        grossOrderValueTaxIncl: '250.000000',
        distinctShopCount: 2,
      },
    ]);
    const sql = normalizeSql(calls[0]!.sql);
    expect(sql).toContain('O.VALID = 1');
    expect(sql).toContain('O.ID_CUSTOMER > 0');
    expect(sql).toContain('O.DATE_ADD >= ?');
    expect(sql).toContain('O.DATE_ADD < ?');
    expect(sql).toContain('MIN(CASE WHEN O.DATE_ADD >= ? AND O.DATE_ADD < ? THEN O.DATE_ADD ELSE NULL END)');
    expect(sql).toContain('COUNT(DISTINCT CASE WHEN O.DATE_ADD >= ? AND O.DATE_ADD < ? THEN O.ID_ORDER ELSE NULL END)');
    expect(sql).toContain('SUM(CASE WHEN O.DATE_ADD >= ? AND O.DATE_ADD < ? THEN O.TOTAL_PAID_TAX_INCL ELSE 0 END)');
    expect(sql).not.toMatch(/\b(EMAIL|FIRSTNAME|LASTNAME|PHONE|ADDRESS|RUT|DNI)\b/);
  });

  it('maps diagnostics for currency, refunds, invalid/future exclusions and multishop', async () => {
    const { executor } = scriptedExecutor([
      [{ historicalCustomerCount: '4' } as unknown as RowDataPacket],
      [{
        validOrderCount: '5',
        grossOrderValueTaxIncl: '500.000000',
        zeroAmountOrderCount: '1',
        invalidOrderExcludedCount: '2',
        futureOrderExcludedCount: '3',
      } as unknown as RowDataPacket],
      [{ distinctCurrencyCount: '1', currencyCode: 'CLP', distinctConversionRateCount: '1' } as unknown as RowDataPacket],
      [{
        refundedLineCount: '2',
        partiallyRefundedOrderCount: '1',
        partiallyRefundedAmountObserved: '25.5',
      } as unknown as RowDataPacket],
      [
        { shopId: '1', customers: '2', orders: '3', grossOrderValueTaxIncl: '300' } as unknown as RowDataPacket,
        { shopId: '2', customers: '1', orders: '2', grossOrderValueTaxIncl: '200' } as unknown as RowDataPacket,
      ],
      [{ crossShopCustomers: '1' } as unknown as RowDataPacket],
      [{ unusableCustomerOrderCount: '0', missingPrestashopCustomerOrderCount: '0' } as unknown as RowDataPacket],
    ]);

    await expect(
      createMysqlRfmPopulationReader(executor, 'ps_').readDiagnostics('2025-08-03 00:00:00', '2026-08-03 00:00:00'),
    ).resolves.toMatchObject({
      historicalCustomerCount: 4,
      validOrderCount: 5,
      grossOrderValueTaxIncl: '500.000000',
      currency: { distinctCurrencyCount: 1, currencyCode: 'CLP', distinctConversionRateCount: 1 },
      refunds: {
        refundedLineCount: 2,
        partiallyRefundedOrderCount: 1,
        partiallyRefundedAmountObserved: '25.500000',
      },
      shops: {
        distinctShopCount: 2,
        crossShopCustomers: 1,
      },
      exclusions: {
        invalidOrderExcludedCount: 2,
        futureOrderExcludedCount: 3,
        zeroAmountOrderCount: 1,
      },
    });
  });
});
