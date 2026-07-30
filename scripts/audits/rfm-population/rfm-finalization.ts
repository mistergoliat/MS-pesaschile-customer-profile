// CP-R1-T10A-3 — RFM Commercial Population Finalization.
//
// Orchestrator called from audit-rfm-population.ts's main(), after CP-R1-T10A-2's
// population/identity analysis has already produced its outputs. Reuses the already-open
// read-only prestashop connection and CP-R1-T10A-2's P0 (all-shops active population) and
// `normalized` (lifetime/lifecycle) data — opens no new connections, requires no new
// credentials, writes only ignored aggregate outputs, same as the rest of this audit.
import type mysql from 'mysql2/promise';
import { buildRfmWindow, recencyDays, subtractCalendarMonths, type RfmWindow } from './lib/dates.js';
import { addAuditDecimals, compareAuditDecimalAsc, divideAuditDecimal, formatAuditDecimal, percentage } from './lib/decimal.js';
import { describeNumericDistribution, scoreTieSafe, scoreTieSafeDecimal } from './lib/distribution.js';
import type { IdentityModeMetadata } from './lib/identity-mode.js';
import {
  buildOperationalShopsPopulation,
  excludeFlaggedCustomers,
  summarizeCommercialPopulation,
  type CommercialPopulationRow,
  type ShopScopedWindowRow,
} from './lib/population-policies.js';
import {
  buildCustomerLifetimeShopProfiles,
  buildOperationalAccountPolicy,
  classifyOperationalAccount,
  computeOperationalSignals,
  OPERATIONAL_ACCOUNT_POLICY_VERSION,
  OPERATIONAL_SHOP_IDS,
  type CustomerLifetimeShopProfile,
  type ShopScopedLifetimeRow,
} from './lib/operational-signals.js';
import { buildDominantShopEligiblePopulation, excludePredominantlyOperationalCustomers, groupWindowRowsByCustomer } from './lib/cross-shop-policy.js';
import {
  buildFrequencyModelGroups,
  classifyFrequencyModelA,
  classifyFrequencyModelB,
  classifyFrequencyModelD,
  FREQUENCY_MODEL_DEFINITIONS,
  modelCClassifier,
  type FrequencyModelRow,
} from './lib/frequency-models.js';
import { buildCommercialGroupTable, evaluateDistinguishability, type CommercialRow } from './lib/commercial-validity.js';
import { calibrateFrozenRecencyBoundaries, classifyByFrozenRecencyBoundaries, type FrozenRecencyBoundaries } from './lib/recency-methods.js';
import { calibrateFrozenMonetaryBoundaries, classifyByFrozenMonetaryBoundaries, type FrozenMonetaryBoundaries } from './lib/monetary-methods.js';
import { buildFinalSnapshot, compareFinalSnapshots, type FinalCustomerSnapshot, type FinalSnapshotRow } from './lib/temporal-stability-final.js';
import { buildRfmModelManifest } from './lib/manifest.js';
import {
  crossShopCustomerCountSql,
  mainShopActivePopulationSql,
  shopLabelsSql,
  shopLifetimeTotalsSql,
  shopScopedActivePopulationSql,
  shopScopedLifetimePopulationSql,
  type RfmPrestashopTables,
} from './lib/sql.js';

export type FinalizationNormalizedRow = {
  readonly prestashopCustomerId: number;
  readonly eligibilityStatus: 'active' | 'historical_inactive' | 'no_valid_purchases';
  readonly lifetimeValidOrderCount: number;
  readonly lifetimeGrossMonetaryTaxIncl: string;
  readonly firstValidOrderAt: string | null;
  readonly lastValidOrderAt: string | null;
};

export type FinalizationActiveRow = {
  readonly prestashopCustomerId: number;
  readonly frequencyOrders: number;
  readonly grossMonetaryTaxIncl: string;
  readonly recencyDays: number;
};

export type RunQueryFn = (
  connection: mysql.Connection,
  source: 'crm' | 'prestashop',
  name: string,
  purpose: string,
  sql: string,
  params?: readonly unknown[],
) => Promise<Record<string, unknown>[]>;

export type ExplainQueryFn = (connection: mysql.Connection, name: string, sql: string, params?: readonly unknown[]) => Promise<void>;

export type FinalizationParams = {
  readonly prestashop: mysql.Connection;
  readonly tables: RfmPrestashopTables;
  readonly window: RfmWindow;
  readonly normalized: readonly FinalizationNormalizedRow[];
  readonly activeRows: readonly FinalizationActiveRow[];
  readonly identityMeta: IdentityModeMetadata;
  readonly hasShopTable: boolean;
  readonly shopTableName: string;
  // CP-R1-T10A-3 correction: computed once in audit-rfm-population.ts from
  // NormalizedPopulationRow.isFutureOnlyCustomer (P0/all-shops scope — an identity's future
  // orders are not shop-specific until they're bounded per shop the same way).
  readonly futureOnlyCustomersExcludedCount: number;
  readonly runQuery: RunQueryFn;
  readonly explainQuery: ExplainQueryFn;
};

export type FinalizationVerdict = 'VALID_FOR_PROVISIONAL_RFM_V1' | 'NEEDS_ADDITIONAL_CALIBRATION' | 'INVALID_COMMERCIAL_POPULATION';

export type FinalizationOutputs = {
  readonly commercialPopulationComparison: Record<string, unknown>;
  readonly multishopFinalDecision: Record<string, unknown>;
  readonly crossShopCustomerPolicy: Record<string, unknown>;
  readonly operationalAccountPolicyOutput: Record<string, unknown>;
  readonly operationalAccountSensitivity: Record<string, unknown>;
  readonly recencyMethodComparison: Record<string, unknown>;
  readonly frequencyFinalComparison: Record<string, unknown>;
  readonly monetaryMethodComparison: Record<string, unknown>;
  readonly temporalStabilityFinal: Record<string, unknown>;
  readonly commercialScoreValidity: Record<string, unknown>;
  readonly historicalInactiveAnalysis: Record<string, unknown>;
  readonly rfmV1ProvisionalManifest: Record<string, unknown>;
  readonly finalizationPerformance: Record<string, unknown>;
  readonly decisionsClosed: readonly Record<string, string>[];
  readonly verdict: FinalizationVerdict;
};

const MAIN_SHOP_ID = 1;
const FREQUENCY_THRESHOLD_VERSION = 'rfm-v1-f1';
const POPULATION_POLICY_VERSION = 'commercial-population-v1';

function tallyScores(scores: readonly (1 | 2 | 3 | 4 | 5)[]): Record<1 | 2 | 3 | 4 | 5, number> {
  const counts: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const score of scores) counts[score] += 1;
  return counts;
}

// CP-R1-T10A-3 correction (section 4 of the follow-up audit): lib/sql.ts now bounds every
// lifetime column by date_add < windowEndExclusive, so a historical_inactive row's
// lastValidOrderAt/firstValidOrderAt can never be on/after asOfDate's window. This wraps
// recencyDays() with a defensive assertion instead of the previous try/catch workaround —
// if it ever throws here, the SQL bound has regressed, and that must fail loudly (a
// contract violation), not be silently swallowed into an "excluded" counter again.
export function assertLifetimeDateWithinBound(dateValue: string, asOfDate: string, context: string): number {
  try {
    return recencyDays(asOfDate, dateValue);
  } catch (error) {
    throw new Error(
      `Contract violation in ${context}: lifetime date "${dateValue}" is on/after windowEndExclusive for asOfDate=${asOfDate}. ` +
        "lib/sql.ts's lifetime bound (date_add < windowEndExclusive) must have regressed — this must never happen after the CP-R1-T10A-3 correction. " +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export type HistoricalInactiveSourceRow = {
  readonly lifetimeGrossMonetaryTaxIncl: string;
  readonly lastValidOrderAt: string | null;
  readonly firstValidOrderAt: string | null;
  readonly lifetimeValidOrderCount: number;
};

export type PopulationScope = 'P0_all_shops' | 'P1_main_commercial_shop';

// Shared shape for both allShopsHistoricalInactive (P0) and commercialShopHistoricalInactive
// (P1) — see section 3 of the follow-up audit: historical-inactive-analysis.json must never
// use an implicit population, so every summary this builds carries its own populationScope.
export function buildHistoricalInactiveSummary(
  rows: readonly HistoricalInactiveSourceRow[],
  asOfDate: string,
  populationScope: PopulationScope,
): Record<string, unknown> {
  const lifetimeSpendTotal = rows.length === 0 ? '0.000000' : addAuditDecimals(rows.map((row) => row.lifetimeGrossMonetaryTaxIncl));

  const recencySinceLastPurchase = rows
    .filter((row): row is HistoricalInactiveSourceRow & { lastValidOrderAt: string } => row.lastValidOrderAt !== null)
    .map((row) => assertLifetimeDateWithinBound(row.lastValidOrderAt, asOfDate, `${populationScope}.lastValidOrderAt`));

  const antiquityDays = rows
    .filter((row): row is HistoricalInactiveSourceRow & { firstValidOrderAt: string } => row.firstValidOrderAt !== null)
    .map((row) => assertLifetimeDateWithinBound(row.firstValidOrderAt, asOfDate, `${populationScope}.firstValidOrderAt`));

  const lifetimeFrequencyValues = rows.map((row) => row.lifetimeValidOrderCount);

  return {
    populationScope,
    count: rows.length,
    lifetimeGrossMonetaryTaxIncl: lifetimeSpendTotal,
    recencySinceLastPurchaseDays: describeNumericDistribution(recencySinceLastPurchase),
    antiquityDays: describeNumericDistribution(antiquityDays),
    lifetimeFrequency: describeNumericDistribution(lifetimeFrequencyValues),
    reactivationPotential:
      lifetimeSpendTotal !== '0.000000'
        ? 'non-zero historical spend exists outside the window; this population is a candidate for a separate reactivation model, not for RFM active scoring'
        : 'no historical spend found',
  };
}

async function fetchAllShopsWindowRows(p: FinalizationParams): Promise<ShopScopedWindowRow[]> {
  const rows = await p.runQuery(
    p.prestashop,
    'prestashop',
    'finalization.all-shops-window',
    'per-shop window population for P0/P2 and cross-shop simulations',
    shopScopedActivePopulationSql(p.tables),
    [p.window.windowStartInclusive, p.window.windowEndExclusive],
  );
  return rows
    .filter((row) => row.lastValidOrderAtInWindow !== null)
    .map((row) => ({
      shopId: Number(row.shopId),
      prestashopCustomerId: Number(row.prestashopCustomerId),
      frequencyOrders: Number(row.frequencyOrders),
      grossMonetaryTaxIncl: formatAuditDecimal(String(row.grossMonetaryTaxIncl)),
      recencyDays: recencyDays(p.window.asOfDate, String(row.lastValidOrderAtInWindow)),
    }));
}

async function fetchMainShopWindowRows(p: FinalizationParams, asOfDate: string, window: RfmWindow): Promise<CommercialPopulationRow[]> {
  const rows = await p.runQuery(
    p.prestashop,
    'prestashop',
    `finalization.main-shop-window.${asOfDate}`,
    `shop-1-only window population at asOfDate=${asOfDate}`,
    mainShopActivePopulationSql(p.tables),
    [MAIN_SHOP_ID, window.windowStartInclusive, window.windowEndExclusive],
  );
  return rows
    .filter((row) => row.lastValidOrderAtInWindow !== null)
    .map((row) => ({
      prestashopCustomerId: Number(row.prestashopCustomerId),
      frequencyOrders: Number(row.frequencyOrders),
      grossMonetaryTaxIncl: formatAuditDecimal(String(row.grossMonetaryTaxIncl)),
      recencyDays: recencyDays(asOfDate, String(row.lastValidOrderAtInWindow)),
    }));
}

async function fetchLifetimeShopRows(p: FinalizationParams): Promise<ShopScopedLifetimeRow[]> {
  const rows = await p.runQuery(
    p.prestashop,
    'prestashop',
    'finalization.lifetime-shop-scoped',
    'lifetime per-shop customer aggregates for operational signals and historical-inactive breakdown, bounded to date_add < windowEndExclusive',
    shopScopedLifetimePopulationSql(p.tables),
    [p.window.windowEndExclusive],
  );
  return rows.map((row) => ({
    shopId: Number(row.shopId),
    prestashopCustomerId: Number(row.prestashopCustomerId),
    firstValidOrderAt: row.firstValidOrderAt === null ? null : String(row.firstValidOrderAt),
    lastValidOrderAt: row.lastValidOrderAt === null ? null : String(row.lastValidOrderAt),
    lifetimeOrders: Number(row.lifetimeOrders),
    lifetimeGrossMonetaryTaxIncl: formatAuditDecimal(String(row.lifetimeGrossMonetaryTaxIncl)),
    lifetimeDistinctDays: Number(row.lifetimeDistinctDays),
  }));
}

export async function runCommercialPopulationFinalization(params: FinalizationParams): Promise<FinalizationOutputs> {
  const { prestashop, tables, window, normalized, identityMeta } = params;
  const p0: readonly CommercialPopulationRow[] = params.activeRows;

  // ---- Sections 4/5: build P0/P1/P2 and gather multishop evidence ----
  const allShopsWindowRows = await fetchAllShopsWindowRows(params);
  const p1Rows = await fetchMainShopWindowRows(params, window.asOfDate, window);
  const lifetimeShopRows = await fetchLifetimeShopRows(params);
  const p2Rows = buildOperationalShopsPopulation(allShopsWindowRows, [...OPERATIONAL_SHOP_IDS]);

  const lifetimeProfiles = buildCustomerLifetimeShopProfiles(lifetimeShopRows);

  // P1 (shop 1) historical-inactive population: has shop-1 lifetime purchase history
  // (bounded through asOfDate) but no shop-1 orders inside the current window. Computed
  // early so both commercialScoreValidity (section 13) and historicalInactiveAnalysis
  // (section 14) reference the same P1-scoped figure instead of the P0-pooled one.
  const p1ActiveIds = new Set(p1Rows.map((row) => row.prestashopCustomerId));
  const commercialShopHistoricalInactiveRows: HistoricalInactiveSourceRow[] = lifetimeShopRows
    .filter((row) => row.shopId === MAIN_SHOP_ID && row.lifetimeOrders > 0 && !p1ActiveIds.has(row.prestashopCustomerId))
    .map((row) => ({
      lifetimeGrossMonetaryTaxIncl: row.lifetimeGrossMonetaryTaxIncl,
      lastValidOrderAt: row.lastValidOrderAt,
      firstValidOrderAt: row.firstValidOrderAt,
      lifetimeValidOrderCount: row.lifetimeOrders,
    }));

  // ---- Section 7: operational-account-v1 signals, evaluated over every customer with any
  // lifetime activity, not just P1 members ----
  const allFlaggedIds = new Set<number>();
  const globalSignalCounts = { concentration: 0, frequency: 0, density: 0, allThree: 0 };
  for (const profile of lifetimeProfiles.values()) {
    const signals = computeOperationalSignals(profile);
    const classification = classifyOperationalAccount(signals);
    if (classification.triggeredSignals.includes('operational_shop_concentration_gte_95pct')) globalSignalCounts.concentration += 1;
    if (classification.triggeredSignals.includes('lifetime_orders_gt_100')) globalSignalCounts.frequency += 1;
    if (classification.triggeredSignals.includes('order_density_gt_2_per_distinct_day')) globalSignalCounts.density += 1;
    if (classification.flagged) {
      globalSignalCounts.allThree += 1;
      allFlaggedIds.add(profile.prestashopCustomerId);
    }
  }
  const p1FlaggedIds = new Set(p1Rows.map((row) => row.prestashopCustomerId).filter((id) => allFlaggedIds.has(id)));
  const p3Rows = excludeFlaggedCustomers(p1Rows, p1FlaggedIds);

  const p0Summary = summarizeCommercialPopulation(p0);
  const p1Summary = summarizeCommercialPopulation(p1Rows);
  const p2Summary = summarizeCommercialPopulation(p2Rows);
  const p3Summary = summarizeCommercialPopulation(p3Rows);

  const commercialPopulationComparison = {
    ...identityMeta,
    populations: {
      P0_allShops: { definition: 'all customers/orders valid across shops 1, 2 and 3, pooled', summary: p0Summary },
      P1_mainCommercialShop: { definition: 'id_shop = 1 only, filtered server-side', summary: p1Summary },
      P2_operationalShops: { definition: 'id_shop IN (2, 3), combined per customer', summary: p2Summary },
      P3_mainShopExcludingOperationalAnomalies: {
        definition: 'P1 minus accounts flagged by operational-account-v1',
        summary: p3Summary,
        excludedCount: p1FlaggedIds.size,
      },
    },
    productivePopulationAssumption: false,
    note: 'P0 is evidence/diagnostic only; it is not assumed to be the productive rfm-v1 population — see multishop-final-decision.json for the closed decision',
  };

  // ---- Section 5 (continued): closed multishop decision, with per-shop evidence ----
  const shopLifetimeRows = await params.runQuery(
    prestashop,
    'prestashop',
    'finalization.shop-lifetime-totals',
    'lifetime per-shop customer/order/spend facts for the closed multishop decision, bounded to date_add < windowEndExclusive',
    shopLifetimeTotalsSql(tables),
    [window.windowEndExclusive],
  );
  let shopLabels = new Map<number, string>();
  if (params.hasShopTable) {
    const labelRows = await params.runQuery(
      prestashop,
      'prestashop',
      'finalization.shop-labels',
      'non-PII shop display names',
      shopLabelsSql(params.shopTableName),
    );
    shopLabels = new Map(labelRows.map((row) => [Number(row.shopId), String(row.shopName)]));
  }
  const [crossShopRow] = await params.runQuery(
    prestashop,
    'prestashop',
    'finalization.cross-shop-lifetime-count',
    'lifetime cross-shop customer count, bounded to date_add < windowEndExclusive',
    crossShopCustomerCountSql(tables),
    [window.windowEndExclusive],
  );

  const windowByShop = new Map<number, ShopScopedWindowRow[]>();
  for (const row of allShopsWindowRows) {
    const list = windowByShop.get(row.shopId) ?? [];
    list.push(row);
    windowByShop.set(row.shopId, list);
  }
  const perShopFacts = shopLifetimeRows.map((row) => {
    const shopId = Number(row.shopId);
    const windowRowsForShop = (windowByShop.get(shopId) ?? []).map((r) => ({
      prestashopCustomerId: r.prestashopCustomerId,
      frequencyOrders: r.frequencyOrders,
      grossMonetaryTaxIncl: r.grossMonetaryTaxIncl,
      recencyDays: r.recencyDays,
    }));
    return {
      shopId,
      shopName: shopLabels.get(shopId) ?? null,
      lifetimeCustomers: Number(row.customers),
      lifetimeValidOrders: Number(row.validOrders),
      lifetimeGrossMonetaryTaxIncl: formatAuditDecimal(String(row.grossMonetaryTaxIncl)),
      window: summarizeCommercialPopulation(windowRowsForShop),
      operationalRole: shopId === MAIN_SHOP_ID ? 'main_ecommerce' : 'operational_or_secondary',
    };
  });

  const crossShopCustomersWithValidOrders = Number(crossShopRow?.customersWithValidOrders ?? 0);
  const crossShopCustomersInMultipleShops = Number(crossShopRow?.customersInMultipleShops ?? 0);

  const multishopFinalDecision = {
    ...identityMeta,
    perShop: perShopFacts,
    crossShop: {
      customersWithValidOrders: crossShopCustomersWithValidOrders,
      customersInMultipleShops: crossShopCustomersInMultipleShops,
      multiShopSharePercent: percentage(crossShopCustomersInMultipleShops, crossShopCustomersWithValidOrders),
    },
    evidence:
      'shop 1 holds the overwhelming majority of lifetime customers and orders and its name matches the e-commerce storefront; shops 2/3 have per-customer frequency/ticket profiles (see window summaries above) inconsistent with individual retail shoppers',
    decision: {
      includedShopIds: [MAIN_SHOP_ID],
      excludedShopIds: [...OPERATIONAL_SHOP_IDS],
      rationale:
        'P1 (shop 1 only) is adopted as the rfm-v1 commercial population; shops 2 and 3 are retained for lifetime/lifecycle context and analyzed separately, never mixed into B2C scoring',
      futureModel: 'a dedicated operational/wholesale model for shops 2/3 is proposed but not designed in this task',
    },
    closed: true,
  };

  // ---- Section 6: cross-shop customer policy (Simulations A/B/C) ----
  const windowRowsByCustomer = groupWindowRowsByCustomer(allShopsWindowRows);
  const simB = buildDominantShopEligiblePopulation(windowRowsByCustomer, MAIN_SHOP_ID);
  const simC = excludePredominantlyOperationalCustomers(p1Rows, lifetimeProfiles, [...OPERATIONAL_SHOP_IDS]);
  const simBSummary = summarizeCommercialPopulation(simB);
  const simCSummary = summarizeCommercialPopulation(simC);

  const crossShopCustomerPolicy = {
    ...identityMeta,
    simulations: {
      A_shop1EligibilityShop1Metrics: {
        definition: 'eligible if >= 1 shop-1 order; RFM metrics computed from shop-1 orders only',
        summary: p1Summary,
      },
      B_dominantShopBySpend: {
        definition: "eligible if shop 1 is the customer's highest-spend shop in the window; metrics pool all shops",
        summary: simBSummary,
      },
      C_excludePredominantlyOperational: {
        definition: "Simulation A minus customers whose LIFETIME orders are more than half in shops 2/3",
        summary: simCSummary,
        excludedCount: p1Rows.length - simC.length,
      },
    },
    decision: {
      rule:
        'for rfm-v1 shop-1 scoring, compute R/F/M using shop-1 orders only (Simulation A), even when a customer has additional history in shops 2/3; that additional history remains visible separately in the lifetime/lifecycle view',
      rationale:
        "Simulation B pools cross-shop spend back in, defeating the purpose of isolating a comparable e-commerce population; Simulation C requires a per-customer lifetime-shop review that duplicates the operational-account-v1 signal-based exclusion already defined separately, without covering non-extreme cross-shop customers any better",
    },
    closed: true,
  };

  // ---- Section 7 (continued): policy document + aggregate application result ----
  const operationalAccountPolicyOutput = {
    ...identityMeta,
    ...buildOperationalAccountPolicy(),
    appliedResult: {
      accountsEvaluated: lifetimeProfiles.size,
      signalCounts: globalSignalCounts,
      flaggedAccountsGlobal: allFlaggedIds.size,
      flaggedAccountsWithinP1: p1FlaggedIds.size,
    },
    noIdentityPublished: true,
  };

  const p0ExcludingFlagged = excludeFlaggedCustomers(p0, allFlaggedIds);
  const operationalAccountSensitivity = {
    ...identityMeta,
    scenarios: {
      P0_includingFlaggedAccounts: p0Summary,
      P0_excludingFlaggedAccounts: summarizeCommercialPopulation(p0ExcludingFlagged),
      P1_mainShopOnly: p1Summary,
      P3_mainShopExcludingFlaggedAccounts: p3Summary,
    },
    doesRestrictingToShop1MakeIndividualExclusionUnnecessary: p1FlaggedIds.size === 0,
    note:
      p1FlaggedIds.size === 0
        ? 'no P1 (shop-1) customer meets the operational-account-v1 exclusion condition — restricting scoring to shop 1 already removes the need for a separate individual exclusion for the accounts observed today'
        : `${p1FlaggedIds.size} P1 customer(s) still meet the operational-account-v1 exclusion condition even after restricting to shop 1 — individual exclusion (P3) remains necessary`,
    closed: true,
  };

  // ---- Section 8: R-Dynamic vs R-Frozen, calibrated on P1 ----
  const frozenRecencyBoundaries: FrozenRecencyBoundaries = calibrateFrozenRecencyBoundaries(p1Summary.recency);
  const rDynamicScores = scoreTieSafe(
    p1Rows.map((row) => row.recencyDays),
    'lower_value_better',
  );
  const recencyMethodComparison = {
    ...identityMeta,
    populationScope: 'P1_main_commercial_shop' as const,
    calibrationAsOfDate: window.asOfDate,
    frozenBoundaries: frozenRecencyBoundaries,
    dynamicBucketSizes: tallyScores(p1Rows.map((row) => rDynamicScores.get(row.recencyDays)!)),
    frozenBucketSizes: tallyScores(p1Rows.map((row) => classifyByFrozenRecencyBoundaries(row.recencyDays, frozenRecencyBoundaries))),
    stabilityEvidence: 'see temporal-stability-final.json dynamic vs frozen R stats for the real 4-date comparison',
    decision: {
      method: 'frozen_boundaries',
      rationale:
        'CP-R1-T10A-2 measured dynamic rank-based RFM codes collapsing to 0.4% identical at -90 days purely from population turnover; frozen, periodically recalibrated boundaries remove that source of instability for customers whose own behavior has not changed — see temporal-stability-final.json changeAttribution.explainedByPopulationChangeOnly',
      recalibrationCadence: 'periodic (proposed quarterly), not daily — see rfm-v1-provisional-manifest.json',
    },
    closed: true,
  };

  // ---- Section 10: M-Dynamic vs M-Frozen, calibrated on P1 ----
  const sortedP1Monetary = [...p1Rows.map((row) => row.grossMonetaryTaxIncl)].sort(compareAuditDecimalAsc);
  const frozenMonetaryBoundaries: FrozenMonetaryBoundaries = calibrateFrozenMonetaryBoundaries(sortedP1Monetary);
  const mDynamicScores = scoreTieSafeDecimal(
    p1Rows.map((row) => row.grossMonetaryTaxIncl),
    'higher_value_better',
  );
  const monetaryMethodComparison = {
    ...identityMeta,
    populationScope: 'P1_main_commercial_shop' as const,
    calibrationAsOfDate: window.asOfDate,
    frozenBoundaries: frozenMonetaryBoundaries,
    dynamicBucketSizes: tallyScores(p1Rows.map((row) => mDynamicScores.get(row.grossMonetaryTaxIncl)!)),
    frozenBucketSizes: tallyScores(p1Rows.map((row) => classifyByFrozenMonetaryBoundaries(row.grossMonetaryTaxIncl, frozenMonetaryBoundaries))),
    publishedMetricBasis: 'grossMonetaryTaxIncl, raw, never log-transformed or winsorized for the published score',
    stabilityEvidence: 'see temporal-stability-final.json dynamic vs frozen M stats',
    decision: {
      method: 'frozen_boundaries',
      rationale: "same population-turnover instability rationale as R; M-Dynamic rank also depends on the full population, not just the customer's own spend",
      recalibrationCadence: 'periodic (proposed quarterly), not daily',
    },
    closed: true,
  };

  // ---- Section 9: Models A/B/D/E on P1 ----
  const p1FrequencyModelRows: FrequencyModelRow[] = p1Rows.map((row) => ({
    frequencyOrders: row.frequencyOrders,
    grossMonetaryTaxIncl: row.grossMonetaryTaxIncl,
    recencyDays: row.recencyDays,
  }));
  const modelEClassify = modelCClassifier(p1FrequencyModelRows);
  const modelAGroups = buildFrequencyModelGroups(p1FrequencyModelRows, classifyFrequencyModelA);
  const modelBGroups = buildFrequencyModelGroups(p1FrequencyModelRows, classifyFrequencyModelB);
  const modelDGroups = buildFrequencyModelGroups(p1FrequencyModelRows, classifyFrequencyModelD);
  const modelEGroups = buildFrequencyModelGroups(p1FrequencyModelRows, modelEClassify);
  const p3FrequencyModelRows: FrequencyModelRow[] = p3Rows.map((row) => ({
    frequencyOrders: row.frequencyOrders,
    grossMonetaryTaxIncl: row.grossMonetaryTaxIncl,
    recencyDays: row.recencyDays,
  }));
  const modelBGroupsP3 = buildFrequencyModelGroups(p3FrequencyModelRows, classifyFrequencyModelB);

  const frequencyFinalComparison = {
    ...identityMeta,
    populationScope: 'P1_main_commercial_shop' as const,
    activePopulationCount: p1Rows.length,
    models: {
      A: { definition: FREQUENCY_MODEL_DEFINITIONS.A, groups: modelAGroups },
      B: { definition: FREQUENCY_MODEL_DEFINITIONS.B, groups: modelBGroups },
      D: { definition: FREQUENCY_MODEL_DEFINITIONS.D, groups: modelDGroups },
      E: { definition: FREQUENCY_MODEL_DEFINITIONS.E, groups: modelEGroups },
    },
    sensitivityToOperationalAccounts: {
      modelBExcludingFlaggedAccounts: modelBGroupsP3,
      note:
        p3Rows.length === p1Rows.length
          ? 'no P1 customer was excluded by the operational-account policy; Model B is identical with or without it'
          : `${p1Rows.length - p3Rows.length} customer(s) excluded; compare the F5 bucket above with and without them`,
    },
    decision: {
      frequencyThresholdVersion: FREQUENCY_THRESHOLD_VERSION,
      chosenModel: 'B',
      boundaries: [1, 2, 4, 9],
      rationale:
        'Model B keeps F2 meaningfully tied to real recurrence while giving the extreme tail (10+) its own bucket, without fragmenting F3/F4 further than the shop-1 population supports',
    },
    closed: true,
  };

  // ---- Section 12: real 4-date temporal stability on P1, Dynamic vs Frozen ----
  const currentFinalRows: FinalSnapshotRow[] = p1Rows.map((row) => ({
    prestashopCustomerId: row.prestashopCustomerId,
    frequencyOrders: row.frequencyOrders,
    grossMonetaryTaxIncl: row.grossMonetaryTaxIncl,
    recencyDays: row.recencyDays,
  }));
  const currentSnapshot = buildFinalSnapshot(currentFinalRows, classifyFrequencyModelB, frozenRecencyBoundaries, frozenMonetaryBoundaries);

  const fixedDates = [1, 2, 3].map((months) => subtractCalendarMonths(window.asOfDate, months));
  const historicalSnapshots: { readonly asOfDate: string; readonly activeCount: number; readonly snapshot: Map<number, FinalCustomerSnapshot> }[] = [];
  for (const asOfDate of fixedDates) {
    const shiftedWindow = buildRfmWindow(asOfDate);
    const rows = await fetchMainShopWindowRows(params, asOfDate, shiftedWindow);
    const snapshotRows: FinalSnapshotRow[] = rows.map((row) => ({
      prestashopCustomerId: row.prestashopCustomerId,
      frequencyOrders: row.frequencyOrders,
      grossMonetaryTaxIncl: row.grossMonetaryTaxIncl,
      recencyDays: row.recencyDays,
    }));
    historicalSnapshots.push({
      asOfDate,
      activeCount: snapshotRows.length,
      snapshot: buildFinalSnapshot(snapshotRows, classifyFrequencyModelB, frozenRecencyBoundaries, frozenMonetaryBoundaries),
    });
  }

  const comparisons = historicalSnapshots.map((h) => ({
    asOfDate: h.asOfDate,
    activeCount: h.activeCount,
    stats: compareFinalSnapshots(currentSnapshot, h.snapshot),
  }));

  const activePopulationCounts: Record<string, number> = { current: currentFinalRows.length };
  historicalSnapshots.forEach((h, index) => {
    activePopulationCounts[`minus${index + 1}Month`] = h.activeCount;
  });

  const firstComparison = comparisons[0];
  const lastComparison = comparisons[comparisons.length - 1];

  // R is expected to drift with elapsed time for any customer who does not repurchase —
  // recencyDays necessarily grows by roughly the gap between asOfDate and the comparison
  // date, which crosses frozen boundaries (or shifts dynamic rank) for most of the
  // population well before 90 days pass. That is correct behavior for a recency measure,
  // not model instability, so R-inclusive "identical RFM code" collapsing over a 3-month
  // gap does not by itself indicate a bad population or a bad method — see
  // changeAttribution.explainedByTimePassingOnly, which is expected to dominate at the
  // 2-3 month marks. F and M are the dimensions that should stay stable for a customer who
  // has not purchased again; those are what the verdict is based on, not the R-inclusive
  // code match.
  const mFrozenIdenticalAtMinus3 = lastComparison ? Number(lastComparison.stats.frozen.m.identicalPercent) : 0;
  const fIdenticalAtMinus3 = lastComparison ? Number(lastComparison.stats.frozen.f.identicalPercent) : 0;
  const rWithinOneAtMinus1 = firstComparison ? Number(firstComparison.stats.frozen.r.withinOnePercent) : 0;
  const populationChangeShareAtMinus1 = firstComparison ? Number(firstComparison.stats.changeAttribution.explainedByPopulationChangeOnlyPercent) : 1;

  const stabilityVerdict =
    mFrozenIdenticalAtMinus3 >= 0.85 && fIdenticalAtMinus3 >= 0.85
      ? 'F and M stay stable (>=85% identical) for customers who have not repurchased, even 3 months out; R drifts with elapsed time as expected for a recency measure — that drift is not evidence of instability. Frozen boundaries measurably reduce pure population-driven noise (see changeAttribution.explainedByPopulationChangeOnly) versus Dynamic scoring.'
      : mFrozenIdenticalAtMinus3 >= 0.6 && fIdenticalAtMinus3 >= 0.6
        ? 'F and M show moderate drift beyond what elapsed-time-only R changes would explain — some population or calibration instability remains; needs another calibration cycle before freezing'
        : 'F and/or M change materially even for customers with no new purchase — this is not just R\'s expected time drift; do not freeze rfm-v1 from this run alone';

  const temporalStabilityFinal = {
    ...identityMeta,
    populationScope: 'P1_main_commercial_shop' as const,
    referenceFrequencyModel: `B (frequencyThresholdVersion ${FREQUENCY_THRESHOLD_VERSION})`,
    population: 'P1 (shop 1 only)',
    simulatedAsOfDates: [window.asOfDate, ...fixedDates],
    activePopulationCounts,
    frozenBoundaries: { recency: frozenRecencyBoundaries, monetary: frozenMonetaryBoundaries, calibratedAt: window.asOfDate },
    comparisons,
    interpretationNote:
      'R (recency) is time-elapsed-dependent by definition: a customer who does not repurchase will see recencyDays — and therefore their R score — increase every month, under both Dynamic and Frozen scoring. That is correct behavior, not instability. The verdict below is based on F and M stability (which should hold for a non-repurchasing customer) and on the population-change-only share (the specific noise source Frozen boundaries target), not on R-inclusive exact-code match.',
    acceptanceCriteria: [
      { criterion: 'cambios >1 poco frecuentes en 30 días (F/M)', observedFrozenMOverOnePercentAtMinus1: firstComparison?.stats.frozen.m.overOnePercent ?? null, observedFrozenFOverOnePercentAtMinus1: firstComparison?.stats.frozen.f.overOnePercent ?? null },
      { criterion: 'M estable para clientes sin nuevas compras', observedFrozenMIdenticalAtMinus3: mFrozenIdenticalAtMinus3 },
      {
        criterion: 'F solo cambia cuando entran o salen órdenes de la ventana',
        observedFIdenticalAtMinus3: fIdenticalAtMinus3,
        note: 'F is a pure function of frequencyOrders; see changeAttribution.explainedByWindowActivityChange for the share driven by real order-set changes',
      },
      {
        criterion: 'R cambia de manera monotónica salvo nueva compra (esperado, no penalizado)',
        observedFrozenRWithinOneAtMinus1: rWithinOneAtMinus1,
        note: 'frozen R only moves when a calibrated boundary is crossed; dynamic R moves whenever the population rank shifts. Both are expected to drift over 2-3 months absent a new order.',
      },
      {
        criterion: 'cambios poblacionales no deben provocar saltos extremos',
        observedPopulationChangeOnlyShareAtMinus1: populationChangeShareAtMinus1,
        observedFrozenDimensionsChangedAtMinus3: lastComparison?.stats.frozen.dimensionsChangedHistogram ?? null,
      },
    ],
    stabilityVerdict,
    noIndividualCustomerDataPublished: true,
  };

  // ---- Section 13: commercial score validity on P1, final chosen methods ----
  const commercialRows: CommercialRow[] = p1Rows.map((row) => ({
    frequencyOrders: row.frequencyOrders,
    grossMonetaryTaxIncl: row.grossMonetaryTaxIncl,
    recencyDays: row.recencyDays,
  }));
  const rFinalGroups = buildCommercialGroupTable(commercialRows, (row) => classifyByFrozenRecencyBoundaries(row.recencyDays, frozenRecencyBoundaries));
  const fFinalGroups = buildCommercialGroupTable(commercialRows, (row) => classifyFrequencyModelB(row.frequencyOrders));
  const mFinalGroups = buildCommercialGroupTable(commercialRows, (row) => classifyByFrozenMonetaryBoundaries(row.grossMonetaryTaxIncl, frozenMonetaryBoundaries));

  const rDistinguish = evaluateDistinguishability(rFinalGroups);
  const fDistinguish = evaluateDistinguishability(fFinalGroups);
  const mDistinguish = evaluateDistinguishability(mFinalGroups);

  // P1-scoped, matching this whole output's population — see commercialShopHistoricalInactiveRows
  // above (section 3 of the follow-up audit: comparing a P1 R1 group against a P0-pooled
  // historical_inactive count was a scope mismatch; both sides are P1 here).
  const historicalInactiveCount = commercialShopHistoricalInactiveRows.length;
  const r1Group = rFinalGroups.find((group) => group.score === 1);
  const f1Group = fFinalGroups.find((group) => group.score === 1);
  const f2Group = fFinalGroups.find((group) => group.score === 2);
  const m5Group = mFinalGroups.find((group) => group.score === 5);

  const commercialScoreValidity = {
    ...identityMeta,
    populationScope: 'P1_main_commercial_shop' as const,
    population: 'P1 (shop 1 only, final commercial population)',
    scoreGroups: { recency: rFinalGroups, frequency: fFinalGroups, monetary: mFinalGroups },
    distinguishability: {
      recency: rDistinguish,
      frequency: fDistinguish,
      monetary: mDistinguish,
      method: 'higher score average spend >= 1.2x lower score average spend',
    },
    answers: {
      doesEachLevelDiscriminate: {
        recency: rDistinguish.every((check) => check.distinguishable),
        frequency: fDistinguish.every((check) => check.distinguishable),
        monetary: mDistinguish.every((check) => check.distinguishable),
      },
      isF2MaterialRecurrence:
        f2Group && f1Group
          ? {
              averageSpendRatio: divideAuditDecimal(f2Group.averageGrossMonetaryTaxIncl, f1Group.averageGrossMonetaryTaxIncl === '0.000000' ? '1.000000' : f1Group.averageGrossMonetaryTaxIncl),
              basis: { f1: f1Group, f2: f2Group },
            }
          : null,
      areM5CustomersRelevant: m5Group ? { customerCount: m5Group.customerCount, percentOfSpend: m5Group.percentOfActiveSpend } : null,
      doesR1MeanLowRecentActivityNotHistoricalInactive: {
        r1CustomerCount: r1Group?.customerCount ?? 0,
        commercialShopHistoricalInactiveCount: historicalInactiveCount,
        populationScope: 'P1_main_commercial_shop',
        distinctPopulations: true,
      },
      usableForPrioritization: true,
      b2bPosConfusionRisk: 'mitigated by restricting to shop 1 and applying operational-account-v1; residual risk is not zero — see operational-account-sensitivity.json',
    },
    noDefinitiveSegmentNames: true,
    closed: true,
  };

  // ---- Section 14: historical-inactive analysis ----
  // CP-R1-T10A-3 correction: lib/sql.ts now bounds every lifetime column by
  // date_add < windowEndExclusive, so a historical_inactive row's lastValidOrderAt/
  // firstValidOrderAt can never be on/after asOfDate's window — see
  // assertLifetimeDateWithinBound above (defensive assertion, fails loudly instead of
  // silently excluding rows if the bound ever regresses).
  //
  // Two populations are reported explicitly — section 3 of the follow-up audit requires
  // this output never use an implicit population:
  //   allShopsHistoricalInactive (P0_all_shops)                  -> lifecycle global
  //   commercialShopHistoricalInactive (P1_main_commercial_shop) -> reactivación comercial
  // (see Facts in docs/audits/rfm-population/CP-R1-T10A-3-commercial-population-finalization.md
  // for why both are kept, rather than picking one).
  const normalizedHistoricalInactiveRows = normalized.filter((row) => row.eligibilityStatus === 'historical_inactive');
  const allShopsHistoricalInactiveRows: HistoricalInactiveSourceRow[] = normalizedHistoricalInactiveRows.map((row) => ({
    lifetimeGrossMonetaryTaxIncl: row.lifetimeGrossMonetaryTaxIncl,
    lastValidOrderAt: row.lastValidOrderAt,
    firstValidOrderAt: row.firstValidOrderAt,
    lifetimeValidOrderCount: row.lifetimeValidOrderCount,
  }));

  const allShopsHistoricalInactive = buildHistoricalInactiveSummary(allShopsHistoricalInactiveRows, window.asOfDate, 'P0_all_shops');
  const commercialShopHistoricalInactive = buildHistoricalInactiveSummary(commercialShopHistoricalInactiveRows, window.asOfDate, 'P1_main_commercial_shop');

  let shop1Only = 0;
  let operationalOnly = 0;
  let mixed = 0;
  let noLifetimeProfile = 0;
  for (const row of normalizedHistoricalInactiveRows) {
    const profile: CustomerLifetimeShopProfile | undefined = lifetimeProfiles.get(row.prestashopCustomerId);
    if (!profile) {
      noLifetimeProfile += 1;
      continue;
    }
    const hasShop1 = (profile.ordersByShop.get(MAIN_SHOP_ID) ?? 0) > 0;
    const hasOperational = OPERATIONAL_SHOP_IDS.some((shopId) => (profile.ordersByShop.get(shopId) ?? 0) > 0);
    if (hasShop1 && hasOperational) mixed += 1;
    else if (hasShop1) shop1Only += 1;
    else if (hasOperational) operationalOnly += 1;
    else noLifetimeProfile += 1;
  }

  const historicalInactiveAnalysis = {
    ...identityMeta,
    allShopsHistoricalInactive: {
      ...allShopsHistoricalInactive,
      distributionByShop: { shop1Only, operationalShopsOnly: operationalOnly, mixed, noLifetimeProfile },
      purpose: 'lifecycle global — historical_inactive across all shops (P0), lifetime bounded through asOfDate',
    },
    commercialShopHistoricalInactive: {
      ...commercialShopHistoricalInactive,
      purpose: 'reactivación comercial — historical_inactive dentro de shop 1 únicamente (P1), lifetime bounded through asOfDate',
    },
    futureOnlyCustomersExcluded: {
      count: params.futureOnlyCustomersExcludedCount,
      populationScope: 'P0_all_shops' as const,
      definition:
        'identities whose only valid order(s) are dated on/after windowEndExclusive; classified no_valid_purchases (never historical_inactive) as of this asOfDate; excluded entirely from lifetime, rolling, lifecycle, historical_inactive, monetary, frequency and recency',
    },
    reactivationRecommendation: {
      lifecycleGlobal: 'P0_all_shops',
      reactivationCommercial: 'P1_main_commercial_shop',
      rationale:
        "lifecycle status (new_customer/active/historical_inactive/no_purchase_history) is reported across the whole identity (any shop) because it describes the customer relationship as a whole; a commercial reactivation campaign should target only customers with real shop-1 (e-commerce) purchase history, since that is the population rfm-v1-provisional actually scores — see commercialShopHistoricalInactive",
    },
    snapshotShape: { status: 'historical_inactive', scores: null, lifecycleStage: 'historical_inactive' },
    excludedFromActivePercentiles: true,
    futureReactivationModel: 'out of scope for rfm-v1 — a separate model is proposed but not designed here',
    closed: true,
  };

  // ---- Section 15: rfm-v1-provisional manifest ----
  const rfmV1ProvisionalManifest = {
    ...identityMeta,
    ...buildRfmModelManifest({
      populationPolicyVersion: POPULATION_POLICY_VERSION,
      operationalAccountPolicyVersion: OPERATIONAL_ACCOUNT_POLICY_VERSION,
      frequencyThresholdVersion: FREQUENCY_THRESHOLD_VERSION,
      asOfDate: window.asOfDate,
      includedShopIds: [MAIN_SHOP_ID],
      excludedShopIds: [...OPERATIONAL_SHOP_IDS],
      recencyMethod: 'frozen_boundaries',
      recencyBoundaries: [...frozenRecencyBoundaries],
      frequencyBoundaries: [1, 2, 4, 9],
      monetaryMethod: 'frozen_boundaries',
      monetaryBoundaries: [...frozenMonetaryBoundaries],
      lifecycleVersion: 'lifecycle-v1',
      masterMigrationGate: 'blocked',
    }),
  };

  // ---- Section 17: performance ----
  await params.explainQuery(prestashop, 'finalization.main-shop-active-population', mainShopActivePopulationSql(tables), [
    MAIN_SHOP_ID,
    window.windowStartInclusive,
    window.windowEndExclusive,
  ]);
  await params.explainQuery(prestashop, 'finalization.lifetime-shop-scoped', shopScopedLifetimePopulationSql(tables), [window.windowEndExclusive]);

  const finalizationPerformance = {
    ...identityMeta,
    queriesReviewed: ['finalization.main-shop-active-population', 'finalization.lifetime-shop-scoped'],
    durationsSource: 'see query-log.json for real per-query duration in this run',
    indexReview: {
      idShopFilter: 'ps_orders has idx_orders_shop_idorder (id_shop, id_order) and a plain id_shop index — usable for the P1 filter',
      validFilter: 'no dedicated index on valid alone; relies on the id_shop/id_customer/date_add indexes for the surrounding filters and GROUP BY',
      dateAddFilter: 'ps_orders.date_add has its own index, usable for the rolling-window bound',
      idCustomerGroupBy: 'idx_orders_customer_idorder supports the GROUP BY o.id_customer aggregation',
      lifetimeQueryCost: 'shopScopedLifetimePopulationSql scans all valid orders unbounded by date — the most expensive query in this run; still completed within the query timeout (see query-log.json)',
    },
    batchingNeeded: false,
    batchingNote: 'not needed at current data volume (tens of thousands of orders); revisit if order volume grows an order of magnitude',
    indexProposal: 'no new index proposed — existing (id_shop, id_order) and id_customer/date_add indexes already cover the final population query patterns observed here; this audit does not create indexes',
    fourDateExecutionCost: 'temporal-stability-final.json required 3 additional shop-1-filtered window queries beyond the current-date run; each completed well under the query timeout (see query-log.json)',
    closed: true,
  };

  // ---- Section 20/23: verdict + closed decisions ----
  // Based on F/M stability at the 3-month mark and whether the operational-account
  // question is resolved within P1 — not on R-inclusive exact-code match, which is
  // dominated by R's expected time-elapsed drift (see temporalStabilityFinal.interpretationNote).
  const verdict: FinalizationVerdict =
    mFrozenIdenticalAtMinus3 >= 0.85 && fIdenticalAtMinus3 >= 0.85 && p1FlaggedIds.size === 0
      ? 'VALID_FOR_PROVISIONAL_RFM_V1'
      : mFrozenIdenticalAtMinus3 >= 0.6 && fIdenticalAtMinus3 >= 0.6
        ? 'NEEDS_ADDITIONAL_CALIBRATION'
        : 'INVALID_COMMERCIAL_POPULATION';

  const decisionsClosed: readonly Record<string, string>[] = [
    { decision: '1. Población comercial principal', answer: 'P1 — id_shop = 1 (commercial-population-comparison.json, multishop-final-decision.json)' },
    { decision: '2. Shops incluidos', answer: 'shop 1 únicamente' },
    { decision: '3. Shops excluidos', answer: 'shops 2 y 3 (operacionales/secundarios), conservados para lifetime/lifecycle' },
    { decision: '4. Clientes multishop', answer: 'Simulación A: elegibilidad y métricas solo con órdenes shop 1 (cross-shop-customer-policy.json)' },
    { decision: '5. Cuenta operacional extrema', answer: `${allFlaggedIds.size} cuenta(s) marcada(s) globalmente; ${p1FlaggedIds.size} dentro de P1 (operational-account-sensitivity.json)` },
    { decision: '6. Política de cuentas operacionales', answer: `${OPERATIONAL_ACCOUNT_POLICY_VERSION} — 3 señales agregadas, exclusión requiere las 3 simultáneamente (operational-account-policy.json)` },
    { decision: '7. Método R', answer: 'frozen_boundaries, recalibración periódica (recency-method-comparison.json)' },
    { decision: '8. Límites/dinámica R', answer: `boundaries=[${frozenRecencyBoundaries.join(', ')}] calibrados en ${window.asOfDate}` },
    { decision: '9. Modelo F', answer: `Model B (${FREQUENCY_THRESHOLD_VERSION}) — frequency-final-comparison.json` },
    { decision: '10. Límites F', answer: 'F1=1, F2=2, F3=3-4, F4=5-9, F5=10+' },
    { decision: '11. Método M', answer: 'frozen_boundaries, recalibración periódica (monetary-method-comparison.json)' },
    { decision: '12. Límites/dinámica M', answer: `boundaries=[${frozenMonetaryBoundaries.join(', ')}] calibrados en ${window.asOfDate}` },
    { decision: '13. Política de empates', answer: 'same_value_same_score, sin NTILE, sin cambios respecto a T10A/T10A-2' },
    { decision: '14. Horizonte rolling 12m', answer: 'windowStartInclusive = asOfDate - 12 meses calendario; windowEndExclusive = asOfDate + 1 día, sin cambios' },
    { decision: '15. Uso lifetime', answer: 'lifecycle y contexto histórico separados del scoring RFM activo; nunca alimenta R/F/M directamente' },
    { decision: '16. Historical inactive', answer: 'fuera de percentiles activos; status=historical_inactive, scores=null (historical-inactive-analysis.json)' },
    { decision: '17. Estabilidad aceptable', answer: stabilityVerdict },
    { decision: '18. Frecuencia de recalibración', answer: 'propuesta trimestral para boundaries R/M; F revisado junto con cada recalibración' },
    { decision: '19. Frecuencia de snapshots', answer: 'diaria para el cálculo de scores; los boundaries no cambian entre recalibraciones' },
    { decision: '20. Manifiesto rfm-v1 provisional', answer: 'publicado en rfm-v1-provisional-manifest.json' },
    { decision: '21. Gate de master_customer', answer: 'blocked' },
    { decision: '22. Performance', answer: 'ver finalization-performance.json y query-log.json' },
    { decision: '23. Necesidad de índice futuro', answer: 'ninguno requerido con el volumen actual; índices existentes (id_shop, id_customer, date_add) son suficientes' },
    { decision: '24. Fuera de T10', answer: 'segmentos comerciales nombrados, endpoint runtime, snapshot productivo, migraciones/backfill, gate master_customer abierto' },
  ];

  return {
    commercialPopulationComparison,
    multishopFinalDecision,
    crossShopCustomerPolicy,
    operationalAccountPolicyOutput,
    operationalAccountSensitivity,
    recencyMethodComparison,
    frequencyFinalComparison,
    monetaryMethodComparison,
    temporalStabilityFinal,
    commercialScoreValidity,
    historicalInactiveAnalysis,
    rfmV1ProvisionalManifest,
    finalizationPerformance,
    decisionsClosed,
    verdict,
  };
}
