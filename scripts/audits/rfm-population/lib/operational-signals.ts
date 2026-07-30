// CP-R1-T10A-3 (section 7): operational-account-v1 policy. Flags accounts whose lifetime
// order pattern looks operational (POS/wholesale/integration) rather than an individual
// shopper, using explainable aggregate signals — never a bare `frequencyOrders > N`
// threshold, and never a published identity. See docs/audits/rfm-population/
// CP-R1-T10A-3-operational-account-policy.md for the Facts/Interpretations behind each
// signal and why the exclusion condition requires all three at once.
import { addAuditDecimals, compareAuditDecimalAsc, percentage } from './decimal.js';

export const OPERATIONAL_ACCOUNT_POLICY_VERSION = 'operational-account-v1';

// Shops identified in CP-R1-T10A-2 (multishop analysis) as non-primary/operational
// channels — shop 1 is the e-commerce storefront ("Pesas Chile").
export const OPERATIONAL_SHOP_IDS = [2, 3] as const;

export type ShopScopedLifetimeRow = {
  readonly shopId: number;
  readonly prestashopCustomerId: number;
  readonly firstValidOrderAt: string | null;
  readonly lastValidOrderAt: string | null;
  readonly lifetimeOrders: number;
  readonly lifetimeGrossMonetaryTaxIncl: string;
  readonly lifetimeDistinctDays: number;
};

export type CustomerLifetimeShopProfile = {
  readonly prestashopCustomerId: number;
  readonly ordersByShop: ReadonlyMap<number, number>;
  readonly totalLifetimeOrders: number;
  readonly totalLifetimeGrossMonetaryTaxIncl: string;
  readonly totalLifetimeDistinctDaysApprox: number;
};

export function buildCustomerLifetimeShopProfiles(
  rows: readonly ShopScopedLifetimeRow[],
): Map<number, CustomerLifetimeShopProfile> {
  const byCustomer = new Map<number, ShopScopedLifetimeRow[]>();
  for (const row of rows) {
    const list = byCustomer.get(row.prestashopCustomerId) ?? [];
    list.push(row);
    byCustomer.set(row.prestashopCustomerId, list);
  }
  const profiles = new Map<number, CustomerLifetimeShopProfile>();
  for (const [customerId, customerRows] of byCustomer.entries()) {
    const ordersByShop = new Map<number, number>(customerRows.map((row) => [row.shopId, row.lifetimeOrders]));
    const totalLifetimeOrders = customerRows.reduce((sum, row) => sum + row.lifetimeOrders, 0);
    const totalLifetimeGrossMonetaryTaxIncl = addAuditDecimals(customerRows.map((row) => row.lifetimeGrossMonetaryTaxIncl));
    const totalLifetimeDistinctDaysApprox = customerRows.reduce((sum, row) => sum + row.lifetimeDistinctDays, 0);
    profiles.set(customerId, {
      prestashopCustomerId: customerId,
      ordersByShop,
      totalLifetimeOrders,
      totalLifetimeGrossMonetaryTaxIncl,
      totalLifetimeDistinctDaysApprox,
    });
  }
  return profiles;
}

export type OperationalSignals = {
  readonly operationalShopConcentration: string;
  readonly extremeLifetimeFrequency: boolean;
  readonly denseActivityDays: boolean;
  readonly lifetimeOrders: number;
  readonly lifetimeDistinctDaysApprox: number;
};

const EXTREME_FREQUENCY_THRESHOLD = 100;
const DENSITY_RATIO_THRESHOLD = 2;
const CONCENTRATION_THRESHOLD = '0.950000';

export function computeOperationalSignals(profile: CustomerLifetimeShopProfile): OperationalSignals {
  const operationalOrders = OPERATIONAL_SHOP_IDS.reduce((sum, shopId) => sum + (profile.ordersByShop.get(shopId) ?? 0), 0);
  const operationalShopConcentration =
    profile.totalLifetimeOrders === 0 ? '0.000000' : percentage(operationalOrders, profile.totalLifetimeOrders);
  return {
    operationalShopConcentration,
    extremeLifetimeFrequency: profile.totalLifetimeOrders > EXTREME_FREQUENCY_THRESHOLD,
    denseActivityDays:
      profile.totalLifetimeDistinctDaysApprox > 0 &&
      profile.totalLifetimeOrders > profile.totalLifetimeDistinctDaysApprox * DENSITY_RATIO_THRESHOLD,
    lifetimeOrders: profile.totalLifetimeOrders,
    lifetimeDistinctDaysApprox: profile.totalLifetimeDistinctDaysApprox,
  };
}

export type OperationalClassification = {
  readonly flagged: boolean;
  readonly triggeredSignals: readonly string[];
};

export function classifyOperationalAccount(signals: OperationalSignals): OperationalClassification {
  const triggeredSignals: string[] = [];
  const concentrationHigh = compareAuditDecimalAsc(signals.operationalShopConcentration, CONCENTRATION_THRESHOLD) >= 0;
  if (concentrationHigh) triggeredSignals.push('operational_shop_concentration_gte_95pct');
  if (signals.extremeLifetimeFrequency) triggeredSignals.push('lifetime_orders_gt_100');
  if (signals.denseActivityDays) triggeredSignals.push('order_density_gt_2_per_distinct_day');

  return {
    flagged: concentrationHigh && signals.extremeLifetimeFrequency && signals.denseActivityDays,
    triggeredSignals,
  };
}

export function buildOperationalAccountPolicy(): Record<string, unknown> {
  return {
    policyVersion: OPERATIONAL_ACCOUNT_POLICY_VERSION,
    operationalShopIds: OPERATIONAL_SHOP_IDS,
    signals: [
      {
        signal: 'operational_shop_concentration_gte_95pct',
        definition: '>= 95% of the account\'s lifetime valid orders fall in shop 2 or shop 3',
      },
      { signal: 'lifetime_orders_gt_100', definition: 'lifetime valid order count exceeds 100' },
      {
        signal: 'order_density_gt_2_per_distinct_day',
        definition: 'lifetime valid orders divided by distinct order days exceeds 2 (multiple orders per active day, on average)',
      },
    ],
    exclusionCondition: 'all three signals present simultaneously (AND, not OR) — a single extreme signal alone does not exclude an account; frequencyOrders > N alone is never used',
    reason:
      'this combination — orders concentrated in a non-primary shop, an extreme lifetime count, and dense same-day activity — is consistent with a point-of-sale, wholesale, or integration account rather than an individual retail shopper making that many separate purchase decisions',
    reviewProcess:
      'flagged accounts are reported in aggregate only (count, never identity); PrestaShop back-office confirmation is required before any operational treatment becomes a standing rule',
    futureTreatment:
      'once confirmed operationally, flagged accounts belong in a dedicated operational/B2B model, out of rfm-v1 B2C scope, rather than being scored or silently dropped',
    manualReviewOverride:
      'not available in this audit — no write capability; any manual confirmation must be recorded outside this pipeline and fed back as a future input',
  };
}
