import {
  CUSTOMER_INTELLIGENCE_QUERY_PLAN_VERSION,
  computeQueryPlanHash,
  validateAnalyticalQueryPlan,
  type AnalyticalFilterInput,
  type AnalyticalQueryPlan,
} from '../../domain/customer-intelligence-query/index.js';
import {
  CUSTOMER_INTELLIGENCE_INTERSECTION_CONTRACT_VERSION,
  collectRequiredDimensions,
  filterTreeStats,
  type CustomerIntelligenceIntersectionDefinition,
  type CustomerIntelligenceIntersectionResult,
  type IntersectionMetrics,
  type IntersectionPopulation,
} from '../../domain/customer-intelligence-intersection/index.js';
import type {
  ResolveCurrentCustomerIntelligenceContext,
  ResolveCustomerIntelligenceContextForFeatureSnapshot,
} from '../customer-intelligence/resolve-customer-intelligence-context.js';
import type { ExecuteAnalyticalQueryWithResolvedContext } from '../customer-intelligence-query/index.js';

export type ExecuteIntersectionInput = {
  readonly featureSnapshotId: string | null;
  readonly filters: AnalyticalFilterInput | undefined;
};

export type ExecuteIntersection = (input: ExecuteIntersectionInput) => Promise<CustomerIntelligenceIntersectionResult>;

// task Section 9: one aggregate AnalyticalQueryPlan (no dimensions => an ungrouped aggregate,
// which SQL always returns as exactly one row - "0 matches" is COUNT(*)=0 in that one row, never
// a query returning zero rows, which is what makes task Section 14's "zero is not an error"
// requirement structurally free rather than something this code has to special-case). Exactly
// MAX_METRICS (10) - the type-level cap T03's own validator already enforces, reused rather than
// re-declared. sumValidOrders is deliberately not part of the public IntersectionMetrics
// contract - it exists only to compute the order-weighted AOV ratio below (task Section 21: "AOV
// must remain order-weighted... do not silently change semantics from T06.2").
const MAIN_METRICS: NonNullable<AnalyticalQueryPlan['metrics']> = [
  { aggregation: 'count', alias: 'matchingPopulation' },
  { aggregation: 'sum', field: 'commercial.totalSpentTaxIncl', alias: 'totalSpentTaxIncl' },
  { aggregation: 'sum', field: 'commercial.validOrders', alias: 'sumValidOrders' },
  { aggregation: 'avg', field: 'commercial.totalSpentTaxIncl', alias: 'averageTotalSpentTaxIncl' },
  { aggregation: 'avg', field: 'commercial.validOrders', alias: 'averageValidOrders' },
  { aggregation: 'avg', field: 'commercial.orders365d', alias: 'averageOrders365d' },
  { aggregation: 'avg', field: 'commercial.daysSinceLastOrder', alias: 'averageDaysSinceLastOrder' },
  { aggregation: 'avg', field: 'commercial.purchaseFrequencyDays', alias: 'averagePurchaseFrequencyDays' },
  { aggregation: 'avg', field: 'commercial.effectiveDiversity', alias: 'averageEffectiveDiversity' },
  { aggregation: 'avg', field: 'commercial.repeatProductRate', alias: 'averageRepeatProductRate' },
];

const PURCHASE_FREQUENCY_FIELD = 'commercial.purchaseFrequencyDays';

// task Section 8: public intersection request -> deterministic adapter -> existing T03
// validator/compiler/executor -> result. No raw SQL, no alternate compiler, no planner LLM -
// executeAnalyticalQueryWithResolvedContext is the exact function bootstrap.ts already wires for
// the Copilot (createExecuteAnalyticalQueryWithResolvedContext), reused verbatim here, not a
// second executor.
export function createExecuteIntersection(deps: {
  readonly resolveCurrent: ResolveCurrentCustomerIntelligenceContext;
  readonly resolveForFeatureSnapshot: ResolveCustomerIntelligenceContextForFeatureSnapshot;
  readonly executeAnalyticalQueryWithResolvedContext: ExecuteAnalyticalQueryWithResolvedContext;
}): ExecuteIntersection {
  return async (input) => {
    const mainPlan: AnalyticalQueryPlan = {
      planVersion: CUSTOMER_INTELLIGENCE_QUERY_PLAN_VERSION,
      metrics: MAIN_METRICS,
      ...(input.filters !== undefined ? { filters: input.filters } : {}),
      limit: 1,
    };

    // Validated here (not only inside the executor below) purely to read the normalized filter
    // tree's registered field sources for dimension-aware gating (task Section 7) - a second,
    // cheap, pure, I/O-free call to the same validator, never a parallel/different validation
    // rule set (task Section 15: "reuse T03 validation errors").
    const validation = validateAnalyticalQueryPlan(mainPlan);
    if (!validation.ok) {
      return { status: 'invalid_intersection', errors: validation.errors };
    }
    const requiredDimensions = collectRequiredDimensions(validation.plan.filters);
    const { leafCount: filterLeafCount, depth: filterDepth } = filterTreeStats(validation.plan.filters);

    const resolved =
      input.featureSnapshotId === null ? await deps.resolveCurrent() : await deps.resolveForFeatureSnapshot(input.featureSnapshotId);

    switch (resolved.status) {
      case 'no_published_feature_snapshot':
        return { status: 'no_published_feature_snapshot' };
      case 'feature_snapshot_not_found':
        return { status: 'feature_snapshot_not_found', featureSnapshotId: resolved.featureSnapshotId };
      case 'degraded':
        return { status: 'degraded', reason: resolved.reason === 'analytics_unavailable' ? 'analytics_unavailable' : 'analytics_not_configured' };
      case 'available':
        break;
      default: {
        const exhaustive: never = resolved;
        throw new Error(`Unhandled resolveCustomerIntelligenceContext status: ${JSON.stringify(exhaustive)}`);
      }
    }

    const { context, resolvedIds } = resolved;

    // task Section 16: an unused, unavailable dimension never blocks execution - only a filter
    // that actually references rfm.*/cluster.* does, and only when that specific dependency is
    // unresolved for this context.
    if (requiredDimensions.includes('rfm') && resolvedIds.rfmSnapshotId === null) {
      return { status: 'required_rfm_snapshot_unavailable', resolvedContext: context };
    }
    if (requiredDimensions.includes('cluster') && resolvedIds.clusterSnapshotId === null) {
      return { status: 'required_cluster_snapshot_unavailable', resolvedContext: context };
    }

    const mainExecution = await deps.executeAnalyticalQueryWithResolvedContext({ plan: mainPlan, context, resolvedIds });
    if (mainExecution.status === 'invalid_plan') {
      // Unreachable in normal operation - mainPlan was already validated above with the
      // identical, pure validator. Kept as a typed fallback rather than a non-null assertion.
      return { status: 'invalid_intersection', errors: mainExecution.errors };
    }
    const row = mainExecution.result.rows[0] ?? {};
    const matchingPopulation = coerceCount(row.matchingPopulation);

    // task Section 4/21: never average a NULL purchaseFrequencyDays as zero, and always make the
    // reduced sample size explicit. AVG() in the main query already skips NULLs correctly; this
    // second, small query (only run when there's at least one match) gets the exact non-null
    // count via COUNT(*) + an added IS NOT NULL filter - the only way to get that exact count
    // through T03's per-field aggregation model (task Section 9: "1-2 deterministic analytical
    // queries per request", never one query per metric - this is the "2" case, not a third).
    let purchaseFrequencyDaysSampleSize = 0;
    let queryCount: 1 | 2 = 1;
    if (matchingPopulation > 0) {
      queryCount = 2;
      const samplePlan: AnalyticalQueryPlan = {
        planVersion: CUSTOMER_INTELLIGENCE_QUERY_PLAN_VERSION,
        metrics: [{ aggregation: 'count', alias: 'n' }],
        filters: withIsNotNull(input.filters, PURCHASE_FREQUENCY_FIELD),
        limit: 1,
      };
      const sampleExecution = await deps.executeAnalyticalQueryWithResolvedContext({ plan: samplePlan, context, resolvedIds });
      if (sampleExecution.status === 'ok') {
        purchaseFrequencyDaysSampleSize = coerceCount(sampleExecution.result.rows[0]?.n);
      }
    }

    const metrics = buildMetrics(row, matchingPopulation, purchaseFrequencyDaysSampleSize);
    const population: IntersectionPopulation = {
      matchingPopulation,
      featurePopulation: context.population.featurePopulation,
      rfmMatchedPopulation: context.population.rfmMatched,
      clusterMatchedPopulation: context.population.clusterMatched,
      bothMatchedPopulation: context.population.bothMatched,
      rfmCoveragePct: context.population.rfmCoveragePct,
      clusterCoveragePct: context.population.clusterCoveragePct,
      requiredDimensions,
    };
    const definition: CustomerIntelligenceIntersectionDefinition = {
      contractVersion: CUSTOMER_INTELLIGENCE_INTERSECTION_CONTRACT_VERSION,
      filters: input.filters ?? null,
      resolvedContext: context,
      // task Section 10: T03's own hash, preserved verbatim - never a second dashboard-specific
      // hash over equivalent semantics.
      queryPlanHash: computeQueryPlanHash(validation.plan),
    };

    return { status: 'available', definition, population, metrics, execution: { queryCount, filterLeafCount, filterDepth } };
  };
}

function coerceCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`Invalid intersection count value: ${String(value)}`);
}

function buildMetrics(row: Readonly<Record<string, unknown>>, matchingPopulation: number, sampleSize: number): IntersectionMetrics {
  if (matchingPopulation === 0) {
    return {
      totalSpentTaxIncl: '0.000000',
      averageOrderValueTaxIncl: null,
      averageTotalSpentTaxIncl: null,
      averageValidOrders: null,
      averageOrders365d: null,
      averageDaysSinceLastOrder: null,
      averagePurchaseFrequencyDays: null,
      purchaseFrequencyDaysSampleSize: 0,
      averageEffectiveDiversity: null,
      averageRepeatProductRate: null,
    };
  }
  return {
    totalSpentTaxIncl: asDecimalStringOrZero(row.totalSpentTaxIncl),
    averageOrderValueTaxIncl: computeWeightedAverageOrderValue(row.totalSpentTaxIncl, row.sumValidOrders),
    averageTotalSpentTaxIncl: asDecimalStringOrNull(row.averageTotalSpentTaxIncl),
    averageValidOrders: asDecimalStringOrNull(row.averageValidOrders),
    averageOrders365d: asDecimalStringOrNull(row.averageOrders365d),
    averageDaysSinceLastOrder: asDecimalStringOrNull(row.averageDaysSinceLastOrder),
    averagePurchaseFrequencyDays: asDecimalStringOrNull(row.averagePurchaseFrequencyDays),
    purchaseFrequencyDaysSampleSize: sampleSize,
    averageEffectiveDiversity: asDecimalStringOrNull(row.averageEffectiveDiversity),
    averageRepeatProductRate: asDecimalStringOrNull(row.averageRepeatProductRate),
  };
}

function asDecimalStringOrZero(value: unknown): string {
  return value === null || value === undefined ? '0.000000' : String(value);
}

function asDecimalStringOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

// ponytail: order-weighted ratio computed here in JS from two already-summed DECIMAL strings -
// T03's metric compiler only ever aggregates one field per metric (no two-field expressions), so
// the SUM(spend)/NULLIF(SUM(orders),0) T06.2's dedicated reader does in SQL can't be pushed into
// a single T03 metric. Safe at realistic order-value/count magnitudes (float64 has 15-17 exact
// decimal digits; no customer segment gets remotely close). Upgrade path if exact SQL-side
// DECIMAL division is ever required: add a two-field ratio metric kind to compiler.ts.
function computeWeightedAverageOrderValue(totalSpentRaw: unknown, sumValidOrdersRaw: unknown): string | null {
  if (totalSpentRaw === null || totalSpentRaw === undefined) return null;
  const totalSpent = Number(totalSpentRaw);
  const sumValidOrders = Number(sumValidOrdersRaw);
  if (!Number.isFinite(totalSpent) || !Number.isFinite(sumValidOrders) || sumValidOrders <= 0) return null;
  return (totalSpent / sumValidOrders).toFixed(6);
}

function withIsNotNull(filters: AnalyticalFilterInput | undefined, field: string): AnalyticalFilterInput {
  const existing = filters === undefined ? [] : Array.isArray(filters) ? filters : [filters];
  return { and: [...existing, { field, operator: 'is_not_null' }] };
}
