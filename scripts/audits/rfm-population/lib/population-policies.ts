// CP-R1-T10A-3 (sections 4/5): builds the four comparable commercial-population candidates
// (P0 all shops, P1 main shop only, P2 operational shops only, P3 main shop minus flagged
// operational accounts) from the same shop-scoped window rows already fetched for
// CP-R1-T10A-2's multishop analysis — no population-specific SQL needed beyond that one
// query, everything else is in-memory grouping.
import { addAuditDecimals } from './decimal.js';
import { describeNumericDistribution, monetaryOutlierSummary, type NumericDistribution } from './distribution.js';

export type ShopScopedWindowRow = {
  readonly shopId: number;
  readonly prestashopCustomerId: number;
  readonly frequencyOrders: number;
  readonly grossMonetaryTaxIncl: string;
  readonly recencyDays: number;
};

export type CommercialPopulationRow = {
  readonly prestashopCustomerId: number;
  readonly frequencyOrders: number;
  readonly grossMonetaryTaxIncl: string;
  readonly recencyDays: number;
};

export function buildMainShopPopulation(rows: readonly ShopScopedWindowRow[], mainShopId: number): readonly CommercialPopulationRow[] {
  return rows
    .filter((row) => row.shopId === mainShopId)
    .map((row) => ({
      prestashopCustomerId: row.prestashopCustomerId,
      frequencyOrders: row.frequencyOrders,
      grossMonetaryTaxIncl: row.grossMonetaryTaxIncl,
      recencyDays: row.recencyDays,
    }));
}

export function buildOperationalShopsPopulation(
  rows: readonly ShopScopedWindowRow[],
  operationalShopIds: readonly number[],
): readonly CommercialPopulationRow[] {
  const byCustomer = new Map<number, { frequencyOrders: number; grossMonetaryTaxIncl: string; recencyDays: number }>();
  for (const row of rows) {
    if (!operationalShopIds.includes(row.shopId)) continue;
    const existing = byCustomer.get(row.prestashopCustomerId);
    if (!existing) {
      byCustomer.set(row.prestashopCustomerId, {
        frequencyOrders: row.frequencyOrders,
        grossMonetaryTaxIncl: row.grossMonetaryTaxIncl,
        recencyDays: row.recencyDays,
      });
      continue;
    }
    byCustomer.set(row.prestashopCustomerId, {
      frequencyOrders: existing.frequencyOrders + row.frequencyOrders,
      grossMonetaryTaxIncl: addAuditDecimals([existing.grossMonetaryTaxIncl, row.grossMonetaryTaxIncl]),
      // lower recencyDays = more recent; the combined customer's recency is their most
      // recent order across either operational shop.
      recencyDays: Math.min(existing.recencyDays, row.recencyDays),
    });
  }
  return Array.from(byCustomer.entries()).map(([prestashopCustomerId, agg]) => ({ prestashopCustomerId, ...agg }));
}

export function excludeFlaggedCustomers(
  rows: readonly CommercialPopulationRow[],
  flaggedCustomerIds: ReadonlySet<number>,
): readonly CommercialPopulationRow[] {
  return rows.filter((row) => !flaggedCustomerIds.has(row.prestashopCustomerId));
}

export type CommercialPopulationSummary = {
  readonly activeCustomerCount: number;
  readonly totalOrders: number;
  readonly totalGrossMonetaryTaxIncl: string;
  readonly frequency: NumericDistribution;
  readonly recency: NumericDistribution;
  readonly monetary: ReturnType<typeof monetaryOutlierSummary>;
};

export function summarizeCommercialPopulation(rows: readonly CommercialPopulationRow[]): CommercialPopulationSummary {
  return {
    activeCustomerCount: rows.length,
    totalOrders: rows.reduce((sum, row) => sum + row.frequencyOrders, 0),
    totalGrossMonetaryTaxIncl: rows.length === 0 ? '0.000000' : addAuditDecimals(rows.map((row) => row.grossMonetaryTaxIncl)),
    frequency: describeNumericDistribution(rows.map((row) => row.frequencyOrders)),
    recency: describeNumericDistribution(rows.map((row) => row.recencyDays)),
    monetary: monetaryOutlierSummary(rows.map((row) => row.grossMonetaryTaxIncl)),
  };
}
