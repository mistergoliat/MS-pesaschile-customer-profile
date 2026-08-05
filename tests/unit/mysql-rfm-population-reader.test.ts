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

// readDiagnostics fires exactly 5 concurrent queries, in this order: historical, summary
// (totals + currency + seller-service + cross-shop), refunds, shopRows, rawExclusions
// (data-quality guardrail + zero-value + operational-account, all off the raw ps_orders scan).
function diagnosticsResults(overrides: {
  historical?: Partial<Record<string, string>>;
  summary?: Partial<Record<string, string>>;
  refunds?: Partial<Record<string, string>>;
  shopRows?: RowDataPacket[];
  rawExclusions?: Partial<Record<string, string>>;
} = {}): RowDataPacket[][] {
  return [
    [{ historicalCustomerCount: '0', ...overrides.historical } as unknown as RowDataPacket],
    [{
      validOrderCount: '0',
      grossOrderValueTaxIncl: '0',
      invalidOrderExcludedCount: '0',
      futureOrderExcludedCount: '0',
      distinctCurrencyCount: '1',
      currencyCode: 'CLP',
      distinctConversionRateCount: '1',
      ordersWithSellerServiceCount: '0',
      excludedSellerServiceValueTaxIncl: '0',
      grossOrderValueBeforeSellerServiceExclusion: '0',
      sellerServiceLineCount: '0',
      productTargetedDiscountOrderCount: '0',
      crossShopCustomers: '0',
      ...overrides.summary,
    } as unknown as RowDataPacket],
    [{ refundedLineCount: '0', partiallyRefundedOrderCount: '0', partiallyRefundedAmountObserved: '0', ...overrides.refunds } as unknown as RowDataPacket],
    overrides.shopRows ?? [],
    [{
      unusableCustomerOrderCount: '0',
      missingPrestashopCustomerOrderCount: '0',
      excludedZeroValueOrderCount: '0',
      excludedOperationalAccountCount: '0',
      excludedOperationalAccountOrderCount: '0',
      excludedOperationalAccountValueTaxIncl: '0',
      ...overrides.rawExclusions,
    } as unknown as RowDataPacket],
  ];
}

describe('createMysqlRfmPopulationReader', () => {
  it('verifies required source schema tables and columns, including cart-rule tables', async () => {
    const columnRows = (columns: readonly string[]) =>
      columns.map((columnName) => ({ columnName }) as unknown as RowDataPacket);
    const { executor, calls } = scriptedExecutor([
      columnRows(['id_order', 'id_customer', 'id_currency', 'id_shop', 'valid', 'date_add', 'total_paid_tax_incl', 'conversion_rate']),
      columnRows(['id_customer']),
      columnRows(['id_currency', 'iso_code']),
      columnRows(['id_order', 'product_id', 'total_price_tax_incl', 'product_quantity_refunded', 'total_refunded_tax_incl']),
      columnRows(['id_order', 'id_cart_rule']),
      columnRows(['id_cart_rule', 'reduction_product']),
    ]);

    await createMysqlRfmPopulationReader(executor, 'ps_').verifySchema();

    expect(calls).toHaveLength(6);
    expect(calls.every((call) => normalizeSql(call.sql).includes('INFORMATION_SCHEMA.COLUMNS'))).toBe(true);
  });

  it('rejects an empty seller-service or excluded-account policy', () => {
    const { executor } = scriptedExecutor([]);
    expect(() =>
      createMysqlRfmPopulationReader(executor, 'ps_', {
        confirmedSellerServiceProductIds: [],
        excludedOperationalAccountPrestashopCustomerIds: [85980],
      }),
    ).toThrow(/seller-service/);
    expect(() =>
      createMysqlRfmPopulationReader(executor, 'ps_', {
        confirmedSellerServiceProductIds: [444],
        excludedOperationalAccountPrestashopCustomerIds: [],
      }),
    ).toThrow(/excluded operational account/);
  });

  it('extracts the eligible population applying zero-value, account-exclusion and seller-service filters', async () => {
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

    const result = await createMysqlRfmPopulationReader(executor, 'ps_', {
      confirmedSellerServiceProductIds: [444],
      excludedOperationalAccountPrestashopCustomerIds: [85980, 39617, 90890, 86421],
    }).readPopulation('2025-08-03 00:00:00', '2026-08-03 00:00:00');

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
    expect(sql).toContain('O.TOTAL_PAID_TAX_INCL > 0');
    expect(sql).toContain('O.ID_CUSTOMER > 0');
    expect(sql).toContain('O.ID_CUSTOMER NOT IN (?, ?, ?, ?)');
    expect(sql).toContain('OD.PRODUCT_ID IN (?)');
    expect(sql).toContain('GREATEST(O.TOTAL_PAID_TAX_INCL - COALESCE(SSO.SELLER_SERVICE_TAX_INCL, 0), 0)');
    expect(sql).toContain('O.DATE_ADD >= ?');
    expect(sql).toContain('O.DATE_ADD < ?');
    expect(sql).not.toMatch(/\b(EMAIL|FIRSTNAME|LASTNAME|PHONE|ADDRESS|RUT|DNI)\b/);
    // Params: [sellerServiceIds..., excludedAccountIds..., windowStart, windowEnd]
    expect(calls[0]!.params).toEqual([444, 85980, 39617, 90890, 86421, '2025-08-03 00:00:00', '2026-08-03 00:00:00']);
  });

  it('returns an empty population when nothing survives the filters', async () => {
    const { executor } = scriptedExecutor([[]]);
    const result = await createMysqlRfmPopulationReader(executor, 'ps_').readPopulation(
      '2025-08-03 00:00:00',
      '2026-08-03 00:00:00',
    );
    expect(result).toEqual([]);
  });

  it('fires exactly 5 concurrent diagnostic queries and maps every field', async () => {
    const { executor, calls } = scriptedExecutor(
      diagnosticsResults({
        historical: { historicalCustomerCount: '4' },
        summary: {
          validOrderCount: '5',
          grossOrderValueTaxIncl: '2901342226.20',
          invalidOrderExcludedCount: '2',
          futureOrderExcludedCount: '3',
          distinctCurrencyCount: '1',
          currencyCode: 'CLP',
          distinctConversionRateCount: '1',
          ordersWithSellerServiceCount: '1393',
          excludedSellerServiceValueTaxIncl: '1414.00',
          grossOrderValueBeforeSellerServiceExclusion: '2901343640.20',
          sellerServiceLineCount: '1394',
          productTargetedDiscountOrderCount: '0',
          crossShopCustomers: '1',
        },
        refunds: {
          refundedLineCount: '2',
          partiallyRefundedOrderCount: '1',
          partiallyRefundedAmountObserved: '25.5',
        },
        shopRows: [
          { shopId: '1', customers: '2', orders: '3', grossOrderValueTaxIncl: '300' } as unknown as RowDataPacket,
          { shopId: '2', customers: '1', orders: '2', grossOrderValueTaxIncl: '200' } as unknown as RowDataPacket,
        ],
        rawExclusions: {
          unusableCustomerOrderCount: '0',
          missingPrestashopCustomerOrderCount: '0',
          excludedZeroValueOrderCount: '4',
          excludedOperationalAccountCount: '2',
          excludedOperationalAccountOrderCount: '2080',
          excludedOperationalAccountValueTaxIncl: '166398429.27',
        },
      }),
    );

    const diagnostics = await createMysqlRfmPopulationReader(executor, 'ps_').readDiagnostics(
      '2025-08-03 00:00:00',
      '2026-08-03 00:00:00',
    );

    expect(calls).toHaveLength(5);
    expect(diagnostics).toMatchObject({
      historicalCustomerCount: 4,
      validOrderCount: 5,
      grossOrderValueTaxIncl: '2901342226.200000',
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
        excludedZeroValueOrderCount: 4,
        excludedOperationalAccountCount: 2,
        excludedOperationalAccountOrderCount: 2080,
        excludedOperationalAccountValueTaxIncl: '166398429.270000',
      },
      sellerService: {
        policyVersion: 'seller-service-exclusion-v1',
        confirmedProductIds: [444],
        ordersWithSellerServiceCount: 1393,
        sellerServiceLineCount: 1394,
        excludedSellerServiceValueTaxIncl: '1414.000000',
        grossOrderValueBeforeSellerServiceExclusion: '2901343640.200000',
        monetaryAfterSellerServiceExclusion: '2901342226.200000',
        productTargetedDiscountOrderCount: 0,
      },
    });
  });

  it('scopes the raw-exclusions query to a single ps_orders scan (no seller-service CTE)', async () => {
    const { executor, calls } = scriptedExecutor(diagnosticsResults());
    await createMysqlRfmPopulationReader(executor, 'ps_', {
      confirmedSellerServiceProductIds: [444],
      excludedOperationalAccountPrestashopCustomerIds: [85980, 39617, 90890, 86421],
    }).readDiagnostics('2025-08-03 00:00:00', '2026-08-03 00:00:00');

    const rawExclusionsSql = normalizeSql(calls[4]!.sql);
    expect(rawExclusionsSql).not.toContain('WITH');
    expect(rawExclusionsSql).toContain('O.TOTAL_PAID_TAX_INCL <= 0');
    expect(rawExclusionsSql).toContain('O.ID_CUSTOMER IN (?, ?, ?, ?)');
    expect(calls[4]!.params).toEqual([
      85980, 39617, 90890, 86421,
      85980, 39617, 90890, 86421,
      85980, 39617, 90890, 86421,
      '2025-08-03 00:00:00', '2026-08-03 00:00:00',
    ]);
  });
});
