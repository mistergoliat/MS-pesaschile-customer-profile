import { describe, expect, it } from 'vitest';
import {
  buildDominantShopEligiblePopulation,
  excludePredominantlyOperationalCustomers,
  groupWindowRowsByCustomer,
} from '../../scripts/audits/rfm-population/lib/cross-shop-policy.js';
import type { ShopScopedWindowRow } from '../../scripts/audits/rfm-population/lib/population-policies.js';
import { buildCustomerLifetimeShopProfiles, type ShopScopedLifetimeRow } from '../../scripts/audits/rfm-population/lib/operational-signals.js';

describe('CP-R1-T10A-3 cross-shop customer simulations B and C (section 6)', () => {
  const windowRows: ShopScopedWindowRow[] = [
    { shopId: 1, prestashopCustomerId: 1, frequencyOrders: 1, grossMonetaryTaxIncl: '500.000000', recencyDays: 30 },
    { shopId: 2, prestashopCustomerId: 1, frequencyOrders: 3, grossMonetaryTaxIncl: '100.000000', recencyDays: 10 },
    { shopId: 2, prestashopCustomerId: 2, frequencyOrders: 5, grossMonetaryTaxIncl: '900.000000', recencyDays: 5 },
    { shopId: 1, prestashopCustomerId: 2, frequencyOrders: 1, grossMonetaryTaxIncl: '50.000000', recencyDays: 60 },
  ];

  it('groups window rows by customer regardless of shop', () => {
    const grouped = groupWindowRowsByCustomer(windowRows);
    expect(grouped.get(1)).toHaveLength(2);
    expect(grouped.get(2)).toHaveLength(2);
  });

  it('Simulation B: eligibility by dominant window spend shop, metrics pooled across all shops', () => {
    const grouped = groupWindowRowsByCustomer(windowRows);
    const simB = buildDominantShopEligiblePopulation(grouped, 1);
    // customer 1: shop1 spend 500 > shop2 spend 100 -> dominant shop is 1 -> eligible, pooled metrics
    // customer 2: shop2 spend 900 > shop1 spend 50 -> dominant shop is 2 -> not eligible
    expect(simB).toHaveLength(1);
    expect(simB[0]!.prestashopCustomerId).toBe(1);
    expect(simB[0]!.frequencyOrders).toBe(4); // 1 + 3, pooled
    expect(simB[0]!.grossMonetaryTaxIncl).toBe('600.000000'); // 500 + 100, pooled
  });

  it('Simulation C: excludes a shop-1-eligible customer whose lifetime history is predominantly operational', () => {
    const mainShopPopulation = [{ prestashopCustomerId: 1, frequencyOrders: 1, grossMonetaryTaxIncl: '500.000000', recencyDays: 30 }];
    const lifetimeRows: ShopScopedLifetimeRow[] = [
      { shopId: 1, prestashopCustomerId: 1, firstValidOrderAt: null, lastValidOrderAt: null, lifetimeOrders: 2, lifetimeGrossMonetaryTaxIncl: '1000.000000', lifetimeDistinctDays: 2 },
      { shopId: 2, prestashopCustomerId: 1, firstValidOrderAt: null, lastValidOrderAt: null, lifetimeOrders: 20, lifetimeGrossMonetaryTaxIncl: '5000.000000', lifetimeDistinctDays: 15 },
    ];
    const profiles = buildCustomerLifetimeShopProfiles(lifetimeRows);
    const simC = excludePredominantlyOperationalCustomers(mainShopPopulation, profiles, [2, 3]);
    expect(simC).toHaveLength(0); // 20 of 22 lifetime orders (>50%) are in shop 2
  });

  it('Simulation C: keeps a customer whose lifetime history is mostly shop-1', () => {
    const mainShopPopulation = [{ prestashopCustomerId: 5, frequencyOrders: 1, grossMonetaryTaxIncl: '500.000000', recencyDays: 30 }];
    const lifetimeRows: ShopScopedLifetimeRow[] = [
      { shopId: 1, prestashopCustomerId: 5, firstValidOrderAt: null, lastValidOrderAt: null, lifetimeOrders: 10, lifetimeGrossMonetaryTaxIncl: '1000.000000', lifetimeDistinctDays: 10 },
      { shopId: 2, prestashopCustomerId: 5, firstValidOrderAt: null, lastValidOrderAt: null, lifetimeOrders: 1, lifetimeGrossMonetaryTaxIncl: '50.000000', lifetimeDistinctDays: 1 },
    ];
    const profiles = buildCustomerLifetimeShopProfiles(lifetimeRows);
    const simC = excludePredominantlyOperationalCustomers(mainShopPopulation, profiles, [2, 3]);
    expect(simC).toHaveLength(1);
  });
});
