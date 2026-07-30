// CP-R1-T10A-3 (section 6): three ways to treat a customer who has valid orders in more
// than one shop. Simulation A is intentionally not reimplemented here — it is exactly
// population-policies.ts's buildMainShopPopulation(rows, mainShopId): eligibility by having
// any shop-1 order, metrics computed from shop-1 orders only. This module adds B (dominant
// shop by rolling-12m spend, pooled cross-shop metrics) and C (exclude customers whose
// lifetime behavior is predominantly operational even if they have some shop-1 activity).
import { addAuditDecimals, compareAuditDecimalAsc } from './decimal.js';
import type { CustomerLifetimeShopProfile } from './operational-signals.js';
import type { CommercialPopulationRow, ShopScopedWindowRow } from './population-policies.js';

export function groupWindowRowsByCustomer(rows: readonly ShopScopedWindowRow[]): Map<number, ShopScopedWindowRow[]> {
  const byCustomer = new Map<number, ShopScopedWindowRow[]>();
  for (const row of rows) {
    const list = byCustomer.get(row.prestashopCustomerId) ?? [];
    list.push(row);
    byCustomer.set(row.prestashopCustomerId, list);
  }
  return byCustomer;
}

// Simulation B: a customer is eligible only if the shop where they spent the most inside
// the window is the main shop; when eligible, their reported metrics pool ALL of their
// window orders (any shop), not just the main shop's.
export function buildDominantShopEligiblePopulation(
  windowRowsByCustomer: ReadonlyMap<number, readonly ShopScopedWindowRow[]>,
  mainShopId: number,
): readonly CommercialPopulationRow[] {
  const result: CommercialPopulationRow[] = [];
  for (const [customerId, rows] of windowRowsByCustomer.entries()) {
    if (rows.length === 0) continue;
    let dominant = rows[0]!;
    for (const row of rows) {
      if (compareAuditDecimalAsc(row.grossMonetaryTaxIncl, dominant.grossMonetaryTaxIncl) > 0) {
        dominant = row;
      }
    }
    if (dominant.shopId !== mainShopId) continue;
    result.push({
      prestashopCustomerId: customerId,
      frequencyOrders: rows.reduce((sum, row) => sum + row.frequencyOrders, 0),
      grossMonetaryTaxIncl: addAuditDecimals(rows.map((row) => row.grossMonetaryTaxIncl)),
      recencyDays: Math.min(...rows.map((row) => row.recencyDays)),
    });
  }
  return result;
}

// Simulation C: start from Simulation A's population (shop-1 eligible, shop-1-only
// metrics) and drop any customer whose LIFETIME order history is predominantly (>50%) in
// the operational shops, even though they have at least one shop-1 order in the window.
export function excludePredominantlyOperationalCustomers(
  mainShopPopulation: readonly CommercialPopulationRow[],
  lifetimeProfiles: ReadonlyMap<number, CustomerLifetimeShopProfile>,
  operationalShopIds: readonly number[],
): readonly CommercialPopulationRow[] {
  return mainShopPopulation.filter((row) => {
    const profile = lifetimeProfiles.get(row.prestashopCustomerId);
    if (!profile || profile.totalLifetimeOrders === 0) return true;
    const operationalOrders = operationalShopIds.reduce((sum, shopId) => sum + (profile.ordersByShop.get(shopId) ?? 0), 0);
    return operationalOrders <= profile.totalLifetimeOrders / 2;
  });
}
