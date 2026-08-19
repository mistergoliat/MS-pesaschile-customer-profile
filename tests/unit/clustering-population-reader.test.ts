import { describe, expect, it, vi } from 'vitest';
import { createClusteringPopulationReader, assertSafeTablePrefix } from '../../scripts/clustering/lib/population-reader.js';
import { excludedOperationalAccountPrestashopCustomerIds } from '../../src/domain/customer-rfm/operational-account-exclusion-policy.js';

type FakePool = {
  execute: ReturnType<typeof vi.fn>;
};

function fakePool(rows: Record<string, unknown>[]): FakePool {
  return { execute: vi.fn().mockResolvedValue([rows]) };
}

describe('assertSafeTablePrefix', () => {
  it('accepts the standard PrestaShop prefix', () => {
    expect(() => assertSafeTablePrefix('ps_')).not.toThrow();
  });

  it('rejects a prefix containing SQL-unsafe characters', () => {
    expect(() => assertSafeTablePrefix("ps_'; DROP TABLE orders; --")).toThrow(/Unsafe/);
  });
});

describe('createClusteringPopulationReader — eligibility policy reuse (Section 10)', () => {
  const referenceTimeMysql = '2026-08-19 00:00:00';
  const window365StartMysql = '2025-08-19 00:00:00';

  it('reuses the exact operational-account exclusion policy (same ids RFM uses) rather than re-deriving one', async () => {
    const pool = fakePool([]);
    const reader = createClusteringPopulationReader(pool as never, 'ps_', referenceTimeMysql, window365StartMysql);
    await reader.readOrderAggregates();

    const [sql, params] = pool.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('o.valid = 1');
    expect(sql).toContain('o.total_paid_tax_incl > 0');
    expect(sql).toContain('o.id_customer NOT IN');
    expect(sql).toContain('HAVING COUNT(DISTINCT eo.id_order) >= 2');
    for (const excludedId of excludedOperationalAccountPrestashopCustomerIds) {
      expect(params).toContain(excludedId);
    }
  });

  it('computes cancellation ratio against ALL orders — the state query has no valid=1/amount filter', async () => {
    const pool = fakePool([]);
    const reader = createClusteringPopulationReader(pool as never, 'ps_', referenceTimeMysql, window365StartMysql);
    await reader.readOrderStateAggregates();

    const [sql] = pool.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('valid = 1');
    expect(sql).not.toContain('total_paid_tax_incl');
    expect(sql).toContain('current_state = 6');
  });

  it('coerces decimal/date fields from mysql row shapes and rejects malformed rows', async () => {
    const pool = fakePool([
      {
        customerId: '42',
        validOrders: 3,
        totalSpentTaxIncl: '123456.789000',
        firstValidOrderAt: '2026-01-01 00:00:00',
        lastValidOrderAt: '2026-06-01 00:00:00',
        totalDiscountsTaxIncl: '0.000000',
        totalShippingTaxIncl: '5000.000000',
        orders365d: '1',
      },
    ]);
    const reader = createClusteringPopulationReader(pool as never, 'ps_', referenceTimeMysql, window365StartMysql);
    const [row] = await reader.readOrderAggregates();
    expect(row?.customerId).toBe(42);
    expect(row?.validOrders).toBe(3);
    expect(row?.totalSpentTaxIncl).toBe('123456.789000');
    expect(row?.firstValidOrderAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('fails fast on a malformed decimal value rather than silently coercing it to 0', async () => {
    const pool = fakePool([
      {
        customerId: '42',
        validOrders: 2,
        totalSpentTaxIncl: 'not-a-number',
        firstValidOrderAt: '2026-01-01 00:00:00',
        lastValidOrderAt: '2026-06-01 00:00:00',
        totalDiscountsTaxIncl: '0.000000',
        totalShippingTaxIncl: '0.000000',
        orders365d: '0',
      },
    ]);
    const reader = createClusteringPopulationReader(pool as never, 'ps_', referenceTimeMysql, window365StartMysql);
    await expect(reader.readOrderAggregates()).rejects.toThrow(/Invalid totalSpentTaxIncl/);
  });
});
