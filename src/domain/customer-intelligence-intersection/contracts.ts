import type { AnalyticalFilterInput } from '../customer-intelligence-query/contracts.js';
import type { CustomerIntelligenceSnapshotContext } from '../customer-intelligence/contracts.js';

// task MARKETING-R1-T06.3 Section 22: a canonical, reusable analytical-subset definition - NOT
// dashboard-specific naming, because T06.4 (Copilot uiContext) and the future Audience Engine
// both need to produce/consume this exact shape without a transformation redesign (task Section
// 23/24). Lives alongside customer-intelligence-query (T03) the same way
// customer-intelligence-copilot and customer-intelligence-dashboard both sit downstream of it -
// this module is a peer of those two, consumed by both, never nested under either.
export const CUSTOMER_INTELLIGENCE_INTERSECTION_CONTRACT_VERSION = 'customer-intelligence-intersection-v1';

// Only rfm/cluster can ever be "required but unavailable" - customer/commercial fields are
// always resolvable whenever a feature snapshot exists at all (task Section 7/16).
export type IntersectionRequiredDimension = 'rfm' | 'cluster';

// The reusable definition (task Section 22): filters + resolved snapshot context + T03's own
// queryPlanHash, preserved verbatim (task Section 10 - never a second, dashboard-specific hash
// over equivalent semantics). A future Audience persists exactly this triple, unchanged (task
// Section 12/24).
export type CustomerIntelligenceIntersectionDefinition = {
  readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_INTERSECTION_CONTRACT_VERSION;
  // null = no filters, whole population - a legitimate, valid intersection (task Section 14).
  readonly filters: AnalyticalFilterInput | null;
  readonly resolvedContext: CustomerIntelligenceSnapshotContext;
  readonly queryPlanHash: string;
};

// task Section 21 - a stable common metric set. averageOrderValueTaxIncl stays order-weighted
// (task Section 21's explicit "do not silently change semantics from T06.2"), distinct from
// averageTotalSpentTaxIncl (a simple per-customer mean). Every "average" field is null (never a
// fabricated 0) when matchingPopulation is 0 or the underlying sample is empty - see
// execute-intersection.ts. totalSpentTaxIncl is the one SUM-based field and is legitimately
// '0.000000' (not null) for a zero-population intersection, since a sum of nothing is zero.
export type IntersectionMetrics = {
  readonly totalSpentTaxIncl: string;
  readonly averageOrderValueTaxIncl: string | null;
  readonly averageTotalSpentTaxIncl: string | null;
  readonly averageValidOrders: string | null;
  readonly averageOrders365d: string | null;
  readonly averageDaysSinceLastOrder: string | null;
  readonly averagePurchaseFrequencyDays: string | null;
  readonly purchaseFrequencyDaysSampleSize: number;
  readonly averageEffectiveDiversity: string | null;
  readonly averageRepeatProductRate: string | null;
};

// task Section 6 - never a single fabricated "coverage percentage". featurePopulation/
// rfmMatchedPopulation/clusterMatchedPopulation/bothMatchedPopulation/rfmCoveragePct/
// clusterCoveragePct all come straight from the resolved context's own population coverage
// (task Section 1's "reuse... existing population coverage semantics") - they describe the
// addressable universe for this snapshot context, independent of the caller's own filters.
// matchingPopulation is the one number that IS filtered. requiredDimensions is derived
// deterministically from the validated filter tree's registered field sources (task Section 7:
// "Do NOT phrase-match the user").
export type IntersectionPopulation = {
  readonly matchingPopulation: number;
  readonly featurePopulation: number;
  readonly rfmMatchedPopulation: number;
  readonly clusterMatchedPopulation: number;
  readonly bothMatchedPopulation: number;
  readonly rfmCoveragePct: number;
  readonly clusterCoveragePct: number;
  readonly requiredDimensions: readonly IntersectionRequiredDimension[];
};

export type IntersectionDegradedReason = 'analytics_not_configured' | 'analytics_unavailable';

// task Section 19 - safe execution diagnostics, mirroring AnalyticalQueryResult's own
// `execution: {durationMs, truncated}` precedent (customer-intelligence-query/contracts.ts) -
// counts only, never filter values. queryCount is 1 (main aggregate only) or 2 (main + the
// purchaseFrequencyDays non-null sample-size query, only run when matchingPopulation > 0).
export type IntersectionExecution = {
  readonly queryCount: 1 | 2;
  readonly filterLeafCount: number;
  readonly filterDepth: number;
};

export type CustomerIntelligenceIntersectionResult =
  | {
      readonly status: 'available';
      readonly definition: CustomerIntelligenceIntersectionDefinition;
      readonly population: IntersectionPopulation;
      readonly metrics: IntersectionMetrics;
      readonly execution: IntersectionExecution;
    }
  | { readonly status: 'no_published_feature_snapshot' }
  | { readonly status: 'feature_snapshot_not_found'; readonly featureSnapshotId: string }
  // task Section 16/17: the requested filter references rfm.*/cluster.* fields but no
  // compatible snapshot resolved for this context - a distinct, expected state, never a bare
  // 500 or a silently-wrong matchingPopulation: 0 (task Section 16's own warning: "0 champions"
  // would be misleading when RFM data isn't available at all).
  | { readonly status: 'required_rfm_snapshot_unavailable'; readonly resolvedContext: CustomerIntelligenceSnapshotContext }
  | { readonly status: 'required_cluster_snapshot_unavailable'; readonly resolvedContext: CustomerIntelligenceSnapshotContext }
  | { readonly status: 'invalid_intersection'; readonly errors: readonly string[] }
  | { readonly status: 'degraded'; readonly reason: IntersectionDegradedReason };
