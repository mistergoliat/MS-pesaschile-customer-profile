import type { ClusterFeatureName } from './model-version.js';

export const CUSTOMER_CLUSTER_RUNTIME_CONTRACT_VERSION = 'customer-cluster-runtime-v1';

// Log1p then RobustScaler(median, IQR) fit on the training population — used for the five
// skewed, unbounded-positive count features.
export type Log1pRobustScaleTransform = {
  readonly kind: 'log1p_robust_scale';
  readonly center: number;
  readonly scale: number;
};

// RobustScaler only, no log1p — customerTenureDays is roughly bounded, log1p would needlessly
// compress an already-modest range (CP-R2-T01 Section 7).
export type RobustScaleTransform = {
  readonly kind: 'robust_scale';
  readonly center: number;
  readonly scale: number;
};

// Already a meaningful [0,1] ratio — clip absorbs decimal-rounding drift only, never rescaled.
export type Clip01Transform = {
  readonly kind: 'clip01';
};

// Confirmed live denominator-blowup outliers (CP-R2-T01 Section 8) — capped at the training
// population's own data-derived p99, left as a raw ratio (not rescaled).
export type WinsorizeP99Transform = {
  readonly kind: 'winsorize_p99';
  readonly cap: number;
};

export type FeatureTransform = Log1pRobustScaleTransform | RobustScaleTransform | Clip01Transform | WinsorizeP99Transform;

export type ClusterModelMetrics = {
  readonly silhouette: number;
  readonly daviesBouldin: number;
  readonly calinskiHarabasz: number;
  readonly seedAriMean: number;
  readonly seedAriMin: number;
  readonly resampleAriMean: number;
  readonly resampleAriMin: number;
};

export type TemporalStabilityStatus = 'not_yet_validated' | 'preliminary' | 'validated';

export type ClusterInterpretationMapping = {
  readonly clusterId: number;
  readonly label: string;
  readonly matchedReferenceLabel: string;
  readonly matchDistance: number;
};

// The portable, auditable training output (task Section 13). No pickle/joblib — plain JSON so
// TypeScript can reproduce preprocessing + assignment without ever invoking Python at serving
// time (task Section 28).
export type ClusterModelArtifact = {
  readonly artifactVersion: string;
  readonly modelVersion: string;
  readonly algorithm: 'kmeans';
  readonly k: number;
  readonly trainingSeed: number;
  readonly featureVersion: string;
  readonly preprocessingVersion: string;
  readonly populationPolicyVersion: string;
  readonly operationalAccountExclusionPolicyVersion: string;
  readonly shopScope: string;
  readonly featureOrder: readonly ClusterFeatureName[];
  readonly transforms: Readonly<Record<ClusterFeatureName, FeatureTransform>>;
  // centroids[clusterId][featureIndex], in transformed (post-preprocessing) space, ordered by
  // featureOrder.
  readonly centroids: readonly (readonly number[])[];
  readonly trainingReferenceTime: string;
  readonly trainingPopulationSize: number;
  readonly trainingDatasetChecksum: string;
  readonly metrics: ClusterModelMetrics;
  readonly temporalStabilityStatus: TemporalStabilityStatus;
  readonly interpretationMapping: readonly ClusterInterpretationMapping[];
  readonly trainedAt: string;
  readonly artifactChecksum: string;
};

export type RawClusterFeatureVector = Readonly<Record<ClusterFeatureName, number>>;

export type ClusterAssignment = {
  readonly clusterId: number;
  readonly distanceToCentroid: number;
};

export type ClusterSnapshotRow = {
  readonly prestashopCustomerId: number;
  readonly clusterId: number;
  readonly distanceToCentroid: number;
};

export type ClusterSnapshotManifest = {
  readonly snapshotKey: string;
  readonly modelVersion: string;
  readonly referenceTime: string;
  readonly populationPolicyVersion: string;
  readonly populationSize: number;
  readonly datasetChecksum: string;
  readonly assignmentChecksum: string;
  readonly generatedAt: string;
  readonly clusterSizeDistribution: Readonly<Record<string, number>>;
};

export type CurrentClusterSnapshotMetadata = {
  readonly snapshotId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly algorithm: string;
  readonly k: number;
  readonly featureVersion: string;
  readonly preprocessingVersion: string;
  readonly referenceTime: Date;
  readonly publishedAt: Date;
  readonly populationSize: number;
};

export type CurrentClusterCustomerRecord = {
  readonly prestashopCustomerId: number;
  readonly clusterId: number;
  readonly distanceToCentroid: number;
  readonly interpretationLabel: string | null;
  readonly interpretationDescription: string | null;
  readonly interpretationVersion: string | null;
  readonly snapshot: CurrentClusterSnapshotMetadata;
};

export type CurrentClusterCustomerLookup = {
  readonly snapshot: CurrentClusterSnapshotMetadata | null;
  readonly record: CurrentClusterCustomerRecord | null;
};

export type GetCustomerClusterNotAvailableReason = 'insufficient_repeat_purchase_history';
export type GetCustomerClusterDegradedReason = 'cluster_not_configured' | 'cluster_unavailable' | 'no_published_cluster_snapshot';

export type GetCustomerClusterResult =
  | {
      readonly status: 'available';
      readonly customerId: number;
      readonly cluster: {
        readonly clusterId: number;
        readonly label: string | null;
        readonly description: string | null;
      };
      readonly model: {
        readonly modelVersion: string;
        readonly algorithm: string;
        readonly k: number;
        readonly featureVersion: string;
        readonly preprocessingVersion: string;
      };
      readonly snapshot: {
        readonly snapshotId: string;
        readonly referenceTime: string;
      };
      readonly assignment: {
        readonly distanceToCentroid: number;
      };
      readonly contractVersion: typeof CUSTOMER_CLUSTER_RUNTIME_CONTRACT_VERSION;
    }
  | {
      readonly status: 'customer_not_found';
      readonly customerId: number;
      readonly contractVersion: typeof CUSTOMER_CLUSTER_RUNTIME_CONTRACT_VERSION;
    }
  | {
      readonly status: 'cluster_not_available';
      readonly customerId: number;
      readonly reason: GetCustomerClusterNotAvailableReason;
      readonly contractVersion: typeof CUSTOMER_CLUSTER_RUNTIME_CONTRACT_VERSION;
    }
  | {
      readonly status: 'degraded';
      readonly customerId: number;
      readonly reason: GetCustomerClusterDegradedReason;
      readonly contractVersion: typeof CUSTOMER_CLUSTER_RUNTIME_CONTRACT_VERSION;
    };
