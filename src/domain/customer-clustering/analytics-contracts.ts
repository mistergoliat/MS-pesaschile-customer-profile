import type { ClusterFeatureName } from './model-version.js';
import type { ClusterModelMetrics, TemporalStabilityStatus } from './contracts.js';

export const CLUSTER_ANALYTICS_CONTRACT_VERSION = 'customer-cluster-analytics-v1';

// task Section 13/29: every stat block is {mean, median, p25, p75} (or the distance-specific
// trio below) — never mean alone (task Section 13: "No usar únicamente mean").
export type FeatureStatSummary = {
  readonly mean: number;
  readonly median: number;
  readonly p25: number;
  readonly p75: number;
};

export type ClusterFeatureProfile = Readonly<Record<ClusterFeatureName, FeatureStatSummary>>;

// Post-hoc only (task Section 14) — never a training input, never recomputed on-demand from
// HTTP (task Section 15).
export type CommercialProfileMetricName =
  | 'totalSpentTaxIncl'
  | 'averageOrderValueTaxIncl'
  | 'validOrders'
  | 'daysSinceLastOrder';

export const commercialProfileMetricNames: readonly CommercialProfileMetricName[] = [
  'totalSpentTaxIncl',
  'averageOrderValueTaxIncl',
  'validOrders',
  'daysSinceLastOrder',
];

export type ClusterCommercialProfile = Readonly<Record<CommercialProfileMetricName, FeatureStatSummary>>;

// Distance is never converted into a membership probability (task Section 29).
export type ClusterDistanceProfile = {
  readonly medianDistance: number;
  readonly p95Distance: number;
  readonly maxDistance: number;
};

export type ClusterSnapshotProfile = {
  readonly snapshotId: string;
  readonly clusterId: number;
  readonly customerCount: number;
  readonly featureProfile: ClusterFeatureProfile;
  readonly commercialProfile: ClusterCommercialProfile;
  readonly distanceProfile: ClusterDistanceProfile;
  readonly profileChecksum: string;
  readonly generatedAt: string;
};

export type ClusterInterpretationSummary = {
  readonly label: string;
  readonly description: string;
  readonly interpretationVersion: string;
};

export type ClusterSummaryEntry = {
  readonly clusterId: number;
  readonly interpretation: ClusterInterpretationSummary | null;
  readonly population: { readonly count: number; readonly percentage: number };
  // null only when a snapshot was published before a profile was backfilled for it (task
  // Section 46: cluster_profile_not_available) — never fabricated.
  readonly featureProfile: ClusterFeatureProfile | null;
  readonly commercialProfile: ClusterCommercialProfile | null;
  readonly distanceProfile: ClusterDistanceProfile | null;
};

export type ClusterSnapshotSummaryModel = {
  readonly modelVersion: string;
  readonly algorithm: string;
  readonly k: number;
  readonly featureVersion: string;
  readonly preprocessingVersion: string;
  readonly temporalStabilityStatus: TemporalStabilityStatus;
  readonly metrics: ClusterModelMetrics;
};

export type ClusterSnapshotSummarySnapshot = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly publishedAt: string;
  readonly populationSize: number;
  // 'superseded' only appears when a specific historical snapshotId is requested by id (task
  // Section 20: "reproducibilidad histórica") — the latest-summary path only ever returns
  // 'published'.
  readonly status: 'published' | 'superseded';
};

export type ClusterSnapshotSummary = {
  readonly snapshot: ClusterSnapshotSummarySnapshot;
  readonly model: ClusterSnapshotSummaryModel;
  readonly clusters: readonly ClusterSummaryEntry[];
};

export type GetClusterSnapshotSummaryDegradedReason = 'cluster_analytics_not_configured' | 'cluster_analytics_unavailable';

export type GetClusterSnapshotSummaryResult =
  | ({ readonly status: 'available'; readonly contractVersion: typeof CLUSTER_ANALYTICS_CONTRACT_VERSION } & ClusterSnapshotSummary)
  | {
      readonly status: 'no_published_cluster_snapshot';
      readonly contractVersion: typeof CLUSTER_ANALYTICS_CONTRACT_VERSION;
    }
  | {
      readonly status: 'cluster_snapshot_not_found';
      readonly snapshotId: string;
      readonly contractVersion: typeof CLUSTER_ANALYTICS_CONTRACT_VERSION;
    }
  | {
      readonly status: 'degraded';
      readonly reason: GetClusterSnapshotSummaryDegradedReason;
      readonly contractVersion: typeof CLUSTER_ANALYTICS_CONTRACT_VERSION;
    };

// task Section 23/26: which two snapshots were compared is always explicit in the response,
// never hidden.
export type ClusterRfmCrossTabSnapshotRef = {
  readonly snapshotId: string;
  readonly referenceTime: string;
};

export type ClusterRfmCrossTabCoverage = {
  readonly clusterPopulation: number;
  readonly comparablePopulation: number;
  readonly unmatchedPopulation: number;
  readonly coveragePct: number;
};

export type ClusterRfmCrossTabRow = {
  readonly clusterId: number;
  readonly rfmSegment: string;
  readonly customerCount: number;
  readonly pctWithinCluster: number;
  readonly pctWithinRfmSegment: number;
};

export type ClusterRfmCrossTab = {
  readonly clusterSnapshot: ClusterRfmCrossTabSnapshotRef;
  readonly rfmSnapshot: ClusterRfmCrossTabSnapshotRef;
  readonly coverage: ClusterRfmCrossTabCoverage;
  readonly rows: readonly ClusterRfmCrossTabRow[];
};

export type GetRfmClusterCrossTabDegradedReason =
  | 'cluster_analytics_not_configured'
  | 'cluster_analytics_unavailable'
  | 'rfm_not_configured'
  | 'rfm_unavailable';

export type GetRfmClusterCrossTabResult =
  | ({ readonly status: 'available'; readonly contractVersion: typeof CLUSTER_ANALYTICS_CONTRACT_VERSION } & ClusterRfmCrossTab)
  | {
      readonly status: 'no_published_cluster_snapshot';
      readonly contractVersion: typeof CLUSTER_ANALYTICS_CONTRACT_VERSION;
    }
  | {
      readonly status: 'cluster_snapshot_not_found';
      readonly snapshotId: string;
      readonly contractVersion: typeof CLUSTER_ANALYTICS_CONTRACT_VERSION;
    }
  // Cluster analytics itself is healthy; only the RFM side is unavailable/absent (task Section
  // 45: "Si no hay RFM: cluster summary sigue funcionando... No degradar clustering completo").
  | {
      readonly status: 'no_compatible_rfm_snapshot';
      readonly clusterSnapshot: ClusterRfmCrossTabSnapshotRef;
      readonly contractVersion: typeof CLUSTER_ANALYTICS_CONTRACT_VERSION;
    }
  | {
      readonly status: 'degraded';
      readonly reason: GetRfmClusterCrossTabDegradedReason;
      readonly contractVersion: typeof CLUSTER_ANALYTICS_CONTRACT_VERSION;
    };
