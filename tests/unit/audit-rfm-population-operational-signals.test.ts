import { describe, expect, it } from 'vitest';
import {
  buildCustomerLifetimeShopProfiles,
  buildOperationalAccountPolicy,
  classifyOperationalAccount,
  computeOperationalSignals,
  OPERATIONAL_ACCOUNT_POLICY_VERSION,
  OPERATIONAL_SHOP_IDS,
  type ShopScopedLifetimeRow,
} from '../../scripts/audits/rfm-population/lib/operational-signals.js';

describe('CP-R1-T10A-3 operational-account-v1 policy (section 7)', () => {
  it('never uses a bare frequencyOrders > N rule — requires three signals at once', () => {
    const policy = buildOperationalAccountPolicy();
    expect(policy.policyVersion).toBe(OPERATIONAL_ACCOUNT_POLICY_VERSION);
    expect(policy.exclusionCondition).toContain('all three signals present simultaneously');
    expect(JSON.stringify(policy)).not.toMatch(/frequencyOrders\s*>\s*\d+\s*(only|alone)/i);
  });

  it('flags an account matching CP-R1-T10A-2\'s known outlier shape: shop-2/3 concentrated, extreme, dense', () => {
    const rows: ShopScopedLifetimeRow[] = [
      { shopId: 1, prestashopCustomerId: 99, firstValidOrderAt: null, lastValidOrderAt: null, lifetimeOrders: 1, lifetimeGrossMonetaryTaxIncl: '100.000000', lifetimeDistinctDays: 1 },
      { shopId: 2, prestashopCustomerId: 99, firstValidOrderAt: null, lastValidOrderAt: null, lifetimeOrders: 500, lifetimeGrossMonetaryTaxIncl: '5000000.000000', lifetimeDistinctDays: 40 },
    ];
    const profiles = buildCustomerLifetimeShopProfiles(rows);
    const profile = profiles.get(99)!;
    const signals = computeOperationalSignals(profile);
    expect(signals.lifetimeOrders).toBe(501);
    expect(signals.extremeLifetimeFrequency).toBe(true);
    expect(signals.denseActivityDays).toBe(true); // 501 orders / 41 distinct days > 2

    const classification = classifyOperationalAccount(signals);
    expect(classification.flagged).toBe(true);
    expect(classification.triggeredSignals).toContain('operational_shop_concentration_gte_95pct');
    expect(classification.triggeredSignals).toContain('lifetime_orders_gt_100');
    expect(classification.triggeredSignals).toContain('order_density_gt_2_per_distinct_day');
  });

  it('does not flag an ordinary customer with a handful of shop-1 orders', () => {
    const rows: ShopScopedLifetimeRow[] = [
      { shopId: 1, prestashopCustomerId: 1, firstValidOrderAt: null, lastValidOrderAt: null, lifetimeOrders: 3, lifetimeGrossMonetaryTaxIncl: '300.000000', lifetimeDistinctDays: 3 },
    ];
    const profiles = buildCustomerLifetimeShopProfiles(rows);
    const signals = computeOperationalSignals(profiles.get(1)!);
    const classification = classifyOperationalAccount(signals);
    expect(classification.flagged).toBe(false);
    expect(classification.triggeredSignals).toEqual([]);
  });

  it('does not flag a high-frequency account concentrated in the main shop only (concentration signal absent)', () => {
    const rows: ShopScopedLifetimeRow[] = [
      { shopId: 1, prestashopCustomerId: 2, firstValidOrderAt: null, lastValidOrderAt: null, lifetimeOrders: 400, lifetimeGrossMonetaryTaxIncl: '400000.000000', lifetimeDistinctDays: 50 },
    ];
    const profiles = buildCustomerLifetimeShopProfiles(rows);
    const signals = computeOperationalSignals(profiles.get(2)!);
    expect(signals.operationalShopConcentration).toBe('0.000000');
    expect(classifyOperationalAccount(signals).flagged).toBe(false);
  });

  it('only counts shops 2 and 3 as operational', () => {
    expect(OPERATIONAL_SHOP_IDS).toEqual([2, 3]);
  });
});
