import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import { createMysqlCustomerFeatureReader } from '../../src/infrastructure/prestashop/mysql-customer-feature-reader.js';
import { excludedOperationalAccountPrestashopCustomerIds } from '../../src/domain/customer-rfm/operational-account-exclusion-policy.js';

function fakePool(responses: Record<string, unknown[]>) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const execute = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    for (const [marker, rows] of Object.entries(responses)) {
      if (sql.includes(marker)) return [rows, []];
    }
    return [[], []];
  });
  return { pool: { execute } as unknown as Pool, calls };
}

describe('createMysqlCustomerFeatureReader — Population B (>=1 valid order, task Section 12/17)', () => {
  const referenceTimeMysql = '2026-08-19 00:00:00';
  const window365StartMysql = '2025-08-19 00:00:00';

  it('reuses the exact same valid-order eligibility and operational-account exclusion as clustering, with no >=2-orders HAVING clause (Population B, not B\')', async () => {
    const { pool, calls } = fakePool({});
    const reader = createMysqlCustomerFeatureReader(pool, 'ps_', referenceTimeMysql, window365StartMysql);
    await reader.readPopulation();

    const orderAggregateCall = calls.find((c) => c.sql.includes('COUNT(DISTINCT eo.id_order) AS validOrders'));
    expect(orderAggregateCall).toBeDefined();
    expect(orderAggregateCall!.sql).not.toContain('HAVING');
    expect(orderAggregateCall!.sql).toContain('o.valid = 1');
    expect(orderAggregateCall!.sql).toContain('o.total_paid_tax_incl > 0');
    expect(orderAggregateCall!.sql).not.toContain('seller_service');
    for (const excludedId of excludedOperationalAccountPrestashopCustomerIds) {
      expect(orderAggregateCall!.params).toContain(excludedId);
    }
  });

  it('rejects an unsafe table prefix rather than interpolating it into SQL', () => {
    const { pool } = fakePool({});
    expect(() =>
      createMysqlCustomerFeatureReader(pool, "ps_'; DROP TABLE orders; --", referenceTimeMysql, window365StartMysql),
    ).toThrow(/Unsafe/);
  });

  it('includes a single-order (validOrders=1) customer without throwing — the reader stays raw, no B\' guard', async () => {
    const { pool } = fakePool({
      'COUNT(DISTINCT eo.id_order) AS validOrders': [
        {
          customerId: 22092,
          validOrders: 1,
          firstValidOrderAt: '2026-07-01 00:00:00',
          lastValidOrderAt: '2026-07-01 00:00:00',
          orders365d: 1,
          totalSpentTaxIncl: '15000.000000',
          totalDiscountsTaxIncl: '0.000000',
          totalShippingTaxIncl: '3000.000000',
        },
      ],
      'current_state = 6': [{ customerId: 22092, totalOrdersAllStates: 1, cancelledOrders: 0 }],
      'FROM ps_customer WHERE': [{ customerId: 22092, customerCreatedAt: '2026-06-01 00:00:00' }],
      'od.product_id AS productId': [
        { customerId: 22092, productId: 7, productOrderCount: 1, totalQuantity: 1, totalSpentTaxIncl: '15000.000000' },
      ],
    });
    const reader = createMysqlCustomerFeatureReader(pool, 'ps_', referenceTimeMysql, window365StartMysql);
    const rows = await reader.readPopulation();

    expect(rows).toHaveLength(1);
    expect(rows[0]!.prestashopCustomerId).toBe(22092);
    expect(rows[0]!.validOrders).toBe(1);
    expect(rows[0]!.products).toHaveLength(1);
  });

  it('returns the raw pre-derivation shape — only aggregates, no computed features (reader/domain split)', async () => {
    const { pool } = fakePool({
      'COUNT(DISTINCT eo.id_order) AS validOrders': [
        {
          customerId: 22066,
          validOrders: 2,
          firstValidOrderAt: '2026-01-01 00:00:00',
          lastValidOrderAt: '2026-07-01 00:00:00',
          orders365d: 0,
          totalSpentTaxIncl: '56433.000000',
          totalDiscountsTaxIncl: '0.000000',
          totalShippingTaxIncl: '18931.000000',
        },
      ],
      'current_state = 6': [{ customerId: 22066, totalOrdersAllStates: 2, cancelledOrders: 0 }],
      'FROM ps_customer WHERE': [{ customerId: 22066, customerCreatedAt: '2022-09-02 00:00:00' }],
      'od.product_id AS productId': [
        { customerId: 22066, productId: 1, productOrderCount: 1, totalQuantity: 3, totalSpentTaxIncl: '56433.000000' },
      ],
    });
    const reader = createMysqlCustomerFeatureReader(pool, 'ps_', referenceTimeMysql, window365StartMysql);
    const rows = await reader.readPopulation();

    expect(rows).toEqual([
      {
        prestashopCustomerId: 22066,
        validOrders: 2,
        firstOrderAt: '2026-01-01 00:00:00',
        lastOrderAt: '2026-07-01 00:00:00',
        orders365d: 0,
        totalSpentTaxIncl: '56433.000000',
        totalDiscountsTaxIncl: '0.000000',
        totalShippingTaxIncl: '18931.000000',
        totalOrdersAllStates: 2,
        cancelledOrders: 0,
        customerCreatedAt: '2022-09-02 00:00:00',
        products: [{ productId: 1, productOrderCount: 1, totalQuantity: 3, totalSpentTaxIncl: '56433.000000' }],
      },
    ]);
  });

  it('fails fast when a product row is missing for an eligible customer', async () => {
    const { pool } = fakePool({
      'COUNT(DISTINCT eo.id_order) AS validOrders': [
        {
          customerId: 22066,
          validOrders: 1,
          firstValidOrderAt: '2026-01-01 00:00:00',
          lastValidOrderAt: '2026-01-01 00:00:00',
          orders365d: 0,
          totalSpentTaxIncl: '1000.000000',
          totalDiscountsTaxIncl: '0.000000',
          totalShippingTaxIncl: '0.000000',
        },
      ],
      'current_state = 6': [{ customerId: 22066, totalOrdersAllStates: 1, cancelledOrders: 0 }],
      'FROM ps_customer WHERE': [{ customerId: 22066, customerCreatedAt: '2022-09-02 00:00:00' }],
      'od.product_id AS productId': [],
    });
    const reader = createMysqlCustomerFeatureReader(pool, 'ps_', referenceTimeMysql, window365StartMysql);
    await expect(reader.readPopulation()).rejects.toThrow(/Missing product rows/);
  });

  it('rejects a duplicate customerId surfaced by the SQL layer', async () => {
    const { pool } = fakePool({
      'COUNT(DISTINCT eo.id_order) AS validOrders': [
        {
          customerId: 1,
          validOrders: 1,
          firstValidOrderAt: '2026-01-01 00:00:00',
          lastValidOrderAt: '2026-01-01 00:00:00',
          orders365d: 0,
          totalSpentTaxIncl: '1000.000000',
          totalDiscountsTaxIncl: '0.000000',
          totalShippingTaxIncl: '0.000000',
        },
        {
          customerId: 1,
          validOrders: 1,
          firstValidOrderAt: '2026-01-02 00:00:00',
          lastValidOrderAt: '2026-01-02 00:00:00',
          orders365d: 0,
          totalSpentTaxIncl: '2000.000000',
          totalDiscountsTaxIncl: '0.000000',
          totalShippingTaxIncl: '0.000000',
        },
      ],
      'current_state = 6': [{ customerId: 1, totalOrdersAllStates: 2, cancelledOrders: 0 }],
      'FROM ps_customer WHERE': [{ customerId: 1, customerCreatedAt: '2022-09-02 00:00:00' }],
      'od.product_id AS productId': [{ customerId: 1, productId: 1, productOrderCount: 1, totalQuantity: 1, totalSpentTaxIncl: '1000.000000' }],
    });
    const reader = createMysqlCustomerFeatureReader(pool, 'ps_', referenceTimeMysql, window365StartMysql);
    await expect(reader.readPopulation()).rejects.toThrow(/Duplicate customerId/);
  });
});
