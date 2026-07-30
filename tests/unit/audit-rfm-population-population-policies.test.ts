import { describe, expect, it } from 'vitest';
import {
  buildMainShopPopulation,
  buildOperationalShopsPopulation,
  excludeFlaggedCustomers,
  summarizeCommercialPopulation,
  type ShopScopedWindowRow,
} from '../../scripts/audits/rfm-population/lib/population-policies.js';

const rows: ShopScopedWindowRow[] = [
  { shopId: 1, prestashopCustomerId: 1, frequencyOrders: 3, grossMonetaryTaxIncl: '100.000000', recencyDays: 10 },
  { shopId: 1, prestashopCustomerId: 2, frequencyOrders: 1, grossMonetaryTaxIncl: '50.000000', recencyDays: 200 },
  { shopId: 2, prestashopCustomerId: 3, frequencyOrders: 5, grossMonetaryTaxIncl: '200.000000', recencyDays: 5 },
  { shopId: 3, prestashopCustomerId: 3, frequencyOrders: 2, grossMonetaryTaxIncl: '30.000000', recencyDays: 20 },
  { shopId: 2, prestashopCustomerId: 4, frequencyOrders: 4, grossMonetaryTaxIncl: '80.000000', recencyDays: 15 },
];

describe('CP-R1-T10A-3 commercial population policies P0/P1/P2/P3 (section 4)', () => {
  it('builds P1 (main shop only) from shop-scoped window rows', () => {
    const p1 = buildMainShopPopulation(rows, 1);
    expect(p1).toHaveLength(2);
    expect(p1.map((row) => row.prestashopCustomerId).sort()).toEqual([1, 2]);
  });

  it('builds P2 (operational shops) combining a customer active in both operational shops', () => {
    const p2 = buildOperationalShopsPopulation(rows, [2, 3]);
    expect(p2).toHaveLength(2);
    const customer3 = p2.find((row) => row.prestashopCustomerId === 3)!;
    expect(customer3.frequencyOrders).toBe(7); // 5 + 2, combined across shop 2 and shop 3
    expect(customer3.grossMonetaryTaxIncl).toBe('230.000000'); // 200.000000 + 30.000000
    expect(customer3.recencyDays).toBe(5); // most recent (lowest) of 5 and 20
  });

  it('excludes flagged customers without mutating the input array', () => {
    const p1 = buildMainShopPopulation(rows, 1);
    const excluded = excludeFlaggedCustomers(p1, new Set([1]));
    expect(excluded).toHaveLength(1);
    expect(excluded[0]!.prestashopCustomerId).toBe(2);
    expect(p1).toHaveLength(2);
  });

  it('summarizes a commercial population with count/orders/spend/distributions', () => {
    const p1 = buildMainShopPopulation(rows, 1);
    const summary = summarizeCommercialPopulation(p1);
    expect(summary.activeCustomerCount).toBe(2);
    expect(summary.totalOrders).toBe(4);
    expect(summary.totalGrossMonetaryTaxIncl).toBe('150.000000');
    expect(summary.frequency.max).toBe(3);
    expect(summary.recency.min).toBe(10);
  });

  it('handles an empty population without throwing', () => {
    const summary = summarizeCommercialPopulation([]);
    expect(summary.activeCustomerCount).toBe(0);
    expect(summary.totalGrossMonetaryTaxIncl).toBe('0.000000');
  });
});
