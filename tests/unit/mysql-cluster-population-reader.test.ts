import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import {
  createMysqlClusterCommercialAggregateReader,
  createMysqlClusterPopulationReader,
} from '../../src/infrastructure/prestashop/mysql-cluster-population-reader.js';
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

describe('createMysqlClusterPopulationReader — policy reuse (Section 10)', () => {
  const referenceTimeMysql = '2026-08-19 00:00:00';
  const window365StartMysql = '2025-08-19 00:00:00';

  it('reuses the exact operational-account exclusion policy in the order-aggregate query', async () => {
    const { pool, calls } = fakePool({});
    const reader = createMysqlClusterPopulationReader(pool, 'ps_', referenceTimeMysql, window365StartMysql);
    await reader.readPopulation();

    const orderAggregateCall = calls.find((c) => c.sql.includes('HAVING COUNT(DISTINCT eo.id_order) >= 2'));
    expect(orderAggregateCall).toBeDefined();
    expect(orderAggregateCall!.sql).toContain('o.valid = 1');
    expect(orderAggregateCall!.sql).toContain('o.total_paid_tax_incl > 0');
    for (const excludedId of excludedOperationalAccountPrestashopCustomerIds) {
      expect(orderAggregateCall!.params).toContain(excludedId);
    }
  });

  it('rejects an unsafe table prefix rather than interpolating it into SQL', () => {
    const { pool } = fakePool({});
    expect(() =>
      createMysqlClusterPopulationReader(pool, "ps_'; DROP TABLE orders; --", referenceTimeMysql, window365StartMysql),
    ).toThrow(/Unsafe/);
  });

  it('builds a raw (unwinsorized) feature vector from joined order/state/tenure/product rows', async () => {
    const { pool } = fakePool({
      "HAVING COUNT(DISTINCT eo.id_order) >= 2": [
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
    const reader = createMysqlClusterPopulationReader(pool, 'ps_', referenceTimeMysql, window365StartMysql);
    const rows = await reader.readPopulation();

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row!.prestashopCustomerId).toBe(22066);
    expect(row!.features.distinctProducts).toBe(1);
    expect(row!.features.discountShare).toBe(0);
    expect(row!.features.shippingShare).toBeCloseTo(18931 / 56433, 10);
    expect(row!.features.cancelledOrderRatio).toBe(0);
  });

  it('fails fast when a product row is missing for an eligible customer', async () => {
    const { pool } = fakePool({
      "HAVING COUNT(DISTINCT eo.id_order) >= 2": [
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
      'od.product_id AS productId': [],
    });
    const reader = createMysqlClusterPopulationReader(pool, 'ps_', referenceTimeMysql, window365StartMysql);
    await expect(reader.readPopulation()).rejects.toThrow(/Missing product rows/);
  });
});

// CP-R2-T03: post-hoc commercial aggregates reused from the same tested readOrderAggregates()
// query the population reader above already relies on (task Section 14).
describe('createMysqlClusterCommercialAggregateReader', () => {
  const referenceTimeMysql = '2026-08-19 00:00:00';

  it('derives totalSpent/averageOrderValue/validOrders/daysSinceLastOrder from the shared order-aggregate query', async () => {
    const { pool } = fakePool({
      'HAVING COUNT(DISTINCT eo.id_order) >= 2': [
        {
          customerId: 22066,
          validOrders: 2,
          firstValidOrderAt: '2026-01-01 00:00:00',
          lastValidOrderAt: '2026-08-09 00:00:00',
          orders365d: 2,
          totalSpentTaxIncl: '100.000000',
          totalDiscountsTaxIncl: '0.000000',
          totalShippingTaxIncl: '0.000000',
        },
      ],
    });
    const reader = createMysqlClusterCommercialAggregateReader(pool, 'ps_', referenceTimeMysql);
    const rows = await reader.readCommercialAggregates();
    expect(rows).toEqual([
      {
        prestashopCustomerId: 22066,
        totalSpentTaxIncl: 100,
        averageOrderValueTaxIncl: 50,
        validOrders: 2,
        daysSinceLastOrder: 10, // 2026-08-19 - 2026-08-09
      },
    ]);
  });

  it('rejects an unsafe table prefix rather than interpolating it into SQL', () => {
    const { pool } = fakePool({});
    expect(() => createMysqlClusterCommercialAggregateReader(pool, "ps_'; DROP TABLE orders; --", referenceTimeMysql)).toThrow(/Unsafe/);
  });
});
