import type { CustomerIntelligencePopulationCoverage } from '../customer-intelligence/contracts.js';
import type { AnalyticalFilterInput } from '../customer-intelligence-query/contracts.js';
import type {
  IntersectionExecution,
  IntersectionMetrics,
  IntersectionRequiredDimension,
} from '../customer-intelligence-intersection/contracts.js';

// task MARKETING-R1-T06.2: dedicated, deterministic dashboard read model — composed directly
// from customer-intelligence-read-model-v1's snapshot-resolution/population/business-semantics
// rules (task Section 1: "do NOT create a second analytical model"). Commercial Affinity is
// out of scope for this slice (see docs/audits/MARKETING-R1-T06-1-...md) - none of these
// contracts carry any affinity field.
export const CUSTOMER_INTELLIGENCE_DASHBOARD_CONTEXT_VERSION = 'customer-intelligence-dashboard-context-v1';
export const CUSTOMER_INTELLIGENCE_DASHBOARD_OVERVIEW_VERSION = 'customer-intelligence-dashboard-overview-v1';
export const CUSTOMER_INTELLIGENCE_DASHBOARD_RFM_VERSION = 'customer-intelligence-dashboard-rfm-v1';
export const CUSTOMER_INTELLIGENCE_DASHBOARD_CLUSTERS_VERSION = 'customer-intelligence-dashboard-clusters-v1';
export const CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_REQUEST_VERSION = 'customer-intelligence-dashboard-intersection-request-v1';
export const CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION = 'customer-intelligence-dashboard-intersection-response-v1';

export type DashboardDegradedReason = 'dashboard_not_configured' | 'analytics_unavailable';

// Flat, UI-safe metadata (task Section 3) - no physical table/column names. Reuses the exact
// resolution the Copilot/T02/T03 already use: feature snapshot as anchor, RFM/cluster each
// independently "latest published, referenceTime <= anchor" (never recomputed here).
export type DashboardContext = {
  readonly featureSnapshotId: string;
  readonly featureReferenceTime: string;
  readonly featureVersion: string;
  readonly populationPolicyVersion: string;
  readonly rfmSnapshotId: string | null;
  readonly rfmReferenceTime: string | null;
  readonly rfmCalculationVersion: string | null;
  readonly clusterSnapshotId: string | null;
  readonly clusterReferenceTime: string | null;
  readonly clusterModelVersion: string | null;
  // null when no cluster snapshot resolved, OR when the interpreted clusters for this model
  // do not all share one interpretation_version yet (task Section 3 asks for one flat version;
  // this is the honest value rather than an assumed one - see get-dashboard-context.ts).
  readonly clusterInterpretationVersion: string | null;
};

export type DashboardContextResult =
  | { readonly status: 'available'; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_CONTEXT_VERSION; readonly context: DashboardContext; readonly population: CustomerIntelligencePopulationCoverage }
  | { readonly status: 'no_published_feature_snapshot'; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_CONTEXT_VERSION }
  | { readonly status: 'feature_snapshot_not_found'; readonly featureSnapshotId: string; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_CONTEXT_VERSION }
  | { readonly status: 'degraded'; readonly reason: DashboardDegradedReason; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_CONTEXT_VERSION };

// Commercial KPIs, aggregated over the FULL feature population (task Section 4: never the
// RFM/cluster-covered subset - every feature row has commercial data regardless of RFM/cluster
// match). averageOrderValueTaxIncl is order-weighted (totalSpent/totalValidOrders), the
// standard AOV definition - distinct from averageTotalSpentTaxIncl-per-customer, which the RFM/
// cluster sections expose separately. null only when totalValidOrders is 0 (never a fabricated
// zero). purchaseFrequencyDays is averaged over its own non-null sample only (task Section 4:
// "do not average null purchaseFrequencyDays as zero") - sampleSize makes that denominator
// explicit rather than leaving it ambiguous.
export type DashboardOverviewCommercial = {
  readonly totalSpentTaxIncl: string;
  readonly totalValidOrders: number;
  readonly averageOrderValueTaxIncl: string | null;
  readonly averageValidOrders: string;
  readonly averageOrders365d: string;
  readonly averageDaysSinceLastOrder: string;
  readonly averagePurchaseFrequencyDays: string | null;
  readonly purchaseFrequencyDaysSampleSize: number;
};

export type DashboardOverview = {
  readonly context: DashboardContext;
  readonly population: CustomerIntelligencePopulationCoverage;
  readonly commercial: DashboardOverviewCommercial;
};

export type DashboardOverviewResult =
  | ({ readonly status: 'available'; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_OVERVIEW_VERSION } & DashboardOverview)
  | { readonly status: 'no_published_feature_snapshot'; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_OVERVIEW_VERSION }
  | { readonly status: 'feature_snapshot_not_found'; readonly featureSnapshotId: string; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_OVERVIEW_VERSION }
  | { readonly status: 'degraded'; readonly reason: DashboardDegradedReason; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_OVERVIEW_VERSION };

// Every metric here is computed over the RFM-matched population only (rr INNER JOIN fr on the
// resolved RFM snapshot) - never the full feature population (task Section 5/10: "do not
// silently treat RFM population as full customer population"). segmentCode is null only for
// historical rows predating migration 003 (a matched RFM row with no segment - task Section 19
// test S), never confused with "not in RFM at all" (those customers are simply absent from
// `segments`, reflected only in the top-level coverage numbers).
export type DashboardRfmSegment = {
  readonly segmentCode: string | null;
  readonly businessLabel: string;
  readonly customerCount: number;
  readonly percentageOfRfmPopulation: number;
  readonly percentageOfFeaturePopulation: number;
  readonly averageRScore: string;
  readonly averageFScore: string;
  readonly averageMScore: string;
  readonly averageOrderValueTaxIncl: string | null;
  readonly averageTotalSpentTaxIncl: string;
  readonly averageValidOrders: string;
  readonly averageDaysSinceLastOrder: string;
};

export type DashboardRfm = {
  readonly context: DashboardContext;
  readonly analyzedPopulation: number;
  readonly fullFeaturePopulation: number;
  readonly coveragePct: number;
  readonly segments: readonly DashboardRfmSegment[];
};

export type DashboardRfmResult =
  | ({ readonly status: 'available'; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_RFM_VERSION } & DashboardRfm)
  | { readonly status: 'no_published_feature_snapshot'; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_RFM_VERSION }
  | { readonly status: 'feature_snapshot_not_found'; readonly featureSnapshotId: string; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_RFM_VERSION }
  | { readonly status: 'no_compatible_rfm_snapshot'; readonly context: DashboardContext; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_RFM_VERSION }
  | { readonly status: 'degraded'; readonly reason: DashboardDegradedReason; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_RFM_VERSION };

// One cell of the cluster's RFM cross-section (task Section 7's example). segmentCode null =
// UNSEGMENTED (a matched RFM row with no segment, same convention as
// get-rfm-cluster-cross-tab.ts's UNSEGMENTED bucket) - never conflated with "not in RFM at
// all" (tracked separately as notInRfmPopulation on the parent DashboardClusterRfmCrossSection).
export type DashboardClusterRfmCrossSectionSegment = {
  readonly segmentCode: string | null;
  readonly businessLabel: string;
  readonly customerCount: number;
  readonly percentageOfComparablePopulation: number;
};

export type DashboardClusterRfmCrossSection = {
  readonly comparablePopulation: number;
  readonly notInRfmPopulation: number;
  readonly coveragePct: number;
  readonly segments: readonly DashboardClusterRfmCrossSectionSegment[];
};

// Every metric here is computed over the cluster-matched population only (cr INNER JOIN fr on
// the resolved cluster snapshot) - a customer with no cluster assignment never appears as a
// row here and is never mislabeled into a cluster bucket (task Section 20 test Y); they are
// reflected only in the top-level coverage numbers.
export type DashboardCluster = {
  readonly clusterId: number;
  readonly businessLabel: string | null;
  readonly interpretationVersion: string | null;
  readonly customerCount: number;
  readonly percentageOfClusterPopulation: number;
  readonly percentageOfFeaturePopulation: number;
  readonly averageOrderValueTaxIncl: string | null;
  readonly averageTotalSpentTaxIncl: string;
  readonly averageValidOrders: string;
  readonly averageOrders365d: string;
  readonly averageDaysSinceLastOrder: string;
  readonly averageEffectiveDiversity: string;
  readonly averageRepeatProductRate: string;
  // null when no compatible RFM snapshot resolved for this context at all (task Section 16:
  // RFM absence never degrades the cluster distribution itself) - see rfmCrossSectionAvailable.
  readonly rfmCrossSection: DashboardClusterRfmCrossSection | null;
};

export type DashboardClusters = {
  readonly context: DashboardContext;
  readonly analyzedPopulation: number;
  readonly fullFeaturePopulation: number;
  readonly coveragePct: number;
  readonly rfmCrossSectionAvailable: boolean;
  readonly clusters: readonly DashboardCluster[];
};

export type DashboardClustersResult =
  | ({ readonly status: 'available'; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_CLUSTERS_VERSION } & DashboardClusters)
  | { readonly status: 'no_published_feature_snapshot'; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_CLUSTERS_VERSION }
  | { readonly status: 'feature_snapshot_not_found'; readonly featureSnapshotId: string; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_CLUSTERS_VERSION }
  | { readonly status: 'no_compatible_cluster_snapshot'; readonly context: DashboardContext; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_CLUSTERS_VERSION }
  | { readonly status: 'degraded'; readonly reason: DashboardDegradedReason; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_CLUSTERS_VERSION };

// task MARKETING-R1-T06.3 Section 2/3: the public request envelope. `filters` reuses T03's own
// AnalyticalFilterInput shape verbatim (task Section 3: "do NOT invent dashboardFilter/
// dashboardOperator/dashboardCondition") - no dashboard-specific filter type exists anywhere in
// this codebase, by design.
export type DashboardIntersectionRequest = {
  readonly contractVersion?: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_REQUEST_VERSION;
  readonly featureSnapshotId?: string;
  readonly filters?: AnalyticalFilterInput;
};

// task Section 6/7 - reshaped from IntersectionPopulation (customer-intelligence-intersection),
// field names adapted to the task's own suggested response shape (task Section 5).
export type DashboardIntersection = {
  readonly matchingPopulation: number;
  readonly featurePopulation: number;
  readonly rfmMatchedPopulation: number;
  readonly clusterMatchedPopulation: number;
  readonly bothMatchedPopulation: number;
  readonly rfmCoveragePct: number;
  readonly clusterCoveragePct: number;
  readonly requiredDimensions: readonly IntersectionRequiredDimension[];
};

// task Section 5/10/22: the reusable analytical definition, dashboard-response-shaped - carries
// only what a caller needs to replay/persist this exact intersection (queryPlanHash + the
// canonical filters), never the full resolvedContext again (already on the response's own
// `context` field, task Section 13: no duplicated provenance structures).
export type DashboardIntersectionAnalyticalDefinition = {
  readonly queryPlanHash: string;
  readonly filters: AnalyticalFilterInput | null;
};

export type DashboardIntersectionResult =
  | {
      readonly status: 'available';
      readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION;
      readonly context: DashboardContext;
      readonly intersection: DashboardIntersection;
      readonly metrics: IntersectionMetrics;
      readonly analyticalDefinition: DashboardIntersectionAnalyticalDefinition;
      readonly execution: IntersectionExecution;
    }
  | { readonly status: 'no_published_feature_snapshot'; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION }
  | {
      readonly status: 'feature_snapshot_not_found';
      readonly featureSnapshotId: string;
      readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION;
    }
  | {
      readonly status: 'required_rfm_snapshot_unavailable';
      readonly context: DashboardContext;
      readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION;
    }
  | {
      readonly status: 'required_cluster_snapshot_unavailable';
      readonly context: DashboardContext;
      readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION;
    }
  | {
      readonly status: 'invalid_intersection';
      readonly errors: readonly string[];
      readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION;
    }
  | { readonly status: 'degraded'; readonly reason: DashboardDegradedReason; readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION };
