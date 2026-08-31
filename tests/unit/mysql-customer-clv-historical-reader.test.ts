import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import {
  createMysqlCustomerClvHistoricalReader,
  defaultCustomerClvHistoricalReaderPolicy,
} from '../../src/infrastructure/prestashop/mysql-customer-clv-historical-reader.js';
import { CUSTOMER_CLV_EXCLUDED_OPERATIONAL_CUSTOMER_IDS } from '../../src/domain/customer-clv/index.js';

function fakePool(responses: Record<string, unknown[]>) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const execute = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    for (const [marker, rows] of Object.entries(responses)) {
      if (sql.includes(marker)) {
        return [rows, []];
      }
    }
    return [[], []];
  });
  return { pool: { execute } as unknown as Pool, calls };
}

describe('createMysqlCustomerClvHistoricalReader', () => {
  it('verifies required CLV source columns across orders, customer, currency and order_detail', async () => {
    const { pool, calls } = fakePool({
      'FROM information_schema.columns': [
        { columnName: 'id_order' },
        { columnName: 'id_customer' },
        { columnName: 'current_state' },
        { columnName: 'valid' },
        { columnName: 'date_add' },
        { columnName: 'total_paid_tax_incl' },
        { columnName: 'total_discounts_tax_incl' },
        { columnName: 'total_shipping_tax_incl' },
        { columnName: 'id_currency' },
        { columnName: 'iso_code' },
        { columnName: 'product_id' },
        { columnName: 'product_quantity' },
        { columnName: 'product_quantity_refunded' },
        { columnName: 'total_refunded_tax_incl' },
        { columnName: 'total_price_tax_incl' },
      ],
    });

    await createMysqlCustomerClvHistoricalReader(pool, 'ps_').verifySchema();

    expect(calls).toHaveLength(4);
    expect(calls.map((call) => call.params[0])).toEqual(['ps_orders', 'ps_customer', 'ps_currency', 'ps_order_detail']);
  });

  it('rejects an unsafe table prefix or an empty policy set', () => {
    const { pool } = fakePool({});

    expect(() => createMysqlCustomerClvHistoricalReader(pool, "ps_'; DROP TABLE orders; --")).toThrow(/Unsafe/);
    expect(() =>
      createMysqlCustomerClvHistoricalReader(pool, 'ps_', {
        ...defaultCustomerClvHistoricalReaderPolicy,
        confirmedSellerServiceProductIds: [],
      }),
    ).toThrow(/seller-service/);
    expect(() =>
      createMysqlCustomerClvHistoricalReader(pool, 'ps_', {
        ...defaultCustomerClvHistoricalReaderPolicy,
        excludedOperationalCustomerIds: [],
      }),
    ).toThrow(/excluded operational customer/);
  });

  it('reads one order-level row per order and maps aggregated products separately', async () => {
    const { pool } = fakePool({
      'MAX(o.date_add) AS availableDataThrough': [{ availableDataThrough: '2025-07-01 00:00:00' }],
      'COALESCE(sso.sellerServiceRevenueTaxIncl, 0) AS sellerServiceRevenueTaxIncl': [
        {
          orderId: 10,
          customerId: 42,
          customerCreatedAt: '2023-01-01 00:00:00',
          createdAt: '2024-06-01 12:30:45',
          currentValid: 1,
          currentStateId: 2,
          currencyIsoCode: 'CLP',
          totalPaidTaxIncl: '150.5',
          totalDiscountsTaxIncl: '10',
          totalShippingTaxIncl: '5',
          sellerServiceRevenueTaxIncl: '15',
          refundEvidence: 1,
        },
      ],
      'od.product_id AS productId': [
        { orderId: 10, productId: 99, quantity: 2, revenueTaxIncl: '60' },
        { orderId: 10, productId: 11, quantity: 1, revenueTaxIncl: '75.5' },
      ],
    });

    const source = await createMysqlCustomerClvHistoricalReader(pool, 'ps_').readSource();

    expect(source.availableDataThrough).toBe('2025-07-01T00:00:00.000Z');
    expect(source.orders).toEqual([
      {
        orderId: 10,
        customerId: 42,
        customerCreatedAt: '2023-01-01T00:00:00.000Z',
        createdAt: '2024-06-01T12:30:45.000Z',
        currentValid: true,
        currentStateId: 2,
        currencyIsoCode: 'CLP',
        totalPaidTaxIncl: '150.500000',
        totalDiscountsTaxIncl: '10.000000',
        totalShippingTaxIncl: '5.000000',
        sellerServiceRevenueTaxIncl: '15.000000',
        refundEvidence: true,
        products: [
          { productId: 11, quantity: 1, revenueTaxIncl: '75.500000' },
          { productId: 99, quantity: 2, revenueTaxIncl: '60.000000' },
        ],
      },
    ]);
  });

  it('uses the CLV SQL policy: seller-service CTE, operational-account exclusion and non-product product exclusion', async () => {
    const { pool, calls } = fakePool({
      'MAX(o.date_add) AS availableDataThrough': [{ availableDataThrough: '2025-07-01 00:00:00' }],
      'COALESCE(sso.sellerServiceRevenueTaxIncl, 0) AS sellerServiceRevenueTaxIncl': [],
      'od.product_id AS productId': [],
    });

    await createMysqlCustomerClvHistoricalReader(pool, 'ps_').readSource();

    const availableDataSql = calls.find((call) => call.sql.includes('MAX(o.date_add) AS availableDataThrough'));
    const orderSql = calls.find((call) => call.sql.includes('sellerServiceRevenueTaxIncl'));
    const productSql = calls.find((call) => call.sql.includes('od.product_id AS productId'));

    expect(availableDataSql).toBeDefined();
    expect(orderSql).toBeDefined();
    expect(productSql).toBeDefined();
    expect(orderSql!.sql).toContain('seller_service_by_order AS');
    expect(orderSql!.sql).toContain('o.id_customer NOT IN (?, ?, ?, ?)');
    expect(orderSql!.sql).toContain('od.product_quantity_refunded > 0 OR od.total_refunded_tax_incl > 0');
    expect(productSql!.sql).toContain('od.product_id NOT IN (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    expect(availableDataSql!.params).toEqual([...CUSTOMER_CLV_EXCLUDED_OPERATIONAL_CUSTOMER_IDS]);
    expect(orderSql!.params).toEqual([
      444,
      ...CUSTOMER_CLV_EXCLUDED_OPERATIONAL_CUSTOMER_IDS,
    ]);
    expect(productSql!.params).toEqual([
      ...CUSTOMER_CLV_EXCLUDED_OPERATIONAL_CUSTOMER_IDS,
      444, 505, 554, 555, 556, 557, 558, 902, 903,
    ]);
  });
});
