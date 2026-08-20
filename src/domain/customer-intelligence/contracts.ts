import type { CustomerFeatureRow } from '../customer-analytics/contracts.js';

export const CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION = 'customer-intelligence-read-model-v1';

// Same 18 derived commercial fields the Data Layer already owns (task Section 27: never
// redefine, only compose) — every field except the identity column, which lives on the row
// envelope instead.
export type CustomerIntelligenceCommercialFeatures = Omit<CustomerFeatureRow, 'prestashopCustomerId'>;

export type CustomerIntelligenceFeatureSnapshotRef = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly featureVersion: string;
  readonly populationPolicyVersion: string;
};

export type CustomerIntelligenceRfmSnapshotRef = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly calculationVersion: string;
};

export type CustomerIntelligenceClusterSnapshotRef = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly modelId: string;
  readonly modelVersion: string;
};

// Composed, never recomputed (task Section 50): read directly from the persisted RFM
// snapshot row. rScore/fScore/mScore/rfmCode always present on a matched row; segmentCode is
// nullable because historical rows predating migration 003 carry no segment (task Section 25
// in CP-R2-T03, same caveat inherited here).
export type CustomerIntelligenceRfm = {
  readonly snapshot: CustomerIntelligenceRfmSnapshotRef;
  readonly rScore: number;
  readonly fScore: number;
  readonly mScore: number;
  readonly rfmCode: string;
  readonly segmentCode: string | null;
};

// Composed, never recomputed (task Section 51): read directly from the persisted cluster
// assignment + interpretation tables. label/description/interpretationVersion are null when
// no interpretation has been backfilled for this model/cluster yet (mirrors CP-R2-T03's own
// per-cluster-nullable convention) — never a whole-row failure.
export type CustomerIntelligenceCluster = {
  readonly snapshot: CustomerIntelligenceClusterSnapshotRef;
  readonly clusterId: number;
  readonly distanceToCentroid: number;
  readonly interpretationVersion: string | null;
  readonly label: string | null;
  readonly description: string | null;
};

export type CustomerIntelligenceRow = {
  readonly prestashopCustomerId: number;
  readonly featureSnapshot: CustomerIntelligenceFeatureSnapshotRef;
  readonly commercial: CustomerIntelligenceCommercialFeatures;
  // null when no compatible RFM snapshot was resolved for this context, OR the customer is
  // simply absent from that snapshot (task Section 13) — never an error either way.
  readonly rfm: CustomerIntelligenceRfm | null;
  readonly cluster: CustomerIntelligenceCluster | null;
  readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION;
};

export type CustomerIntelligencePopulationCoverage = {
  readonly featurePopulation: number;
  readonly rfmMatched: number;
  readonly clusterMatched: number;
  readonly bothMatched: number;
  readonly neitherMatched: number;
  readonly rfmCoveragePct: number;
  readonly clusterCoveragePct: number;
};

// The full "what universe is this read model built from" context (task Section 14) — always
// carries every snapshot ref explicitly, even when RFM/cluster are null, so a caller (or the
// future Copilot) can never mistake a partial-coverage answer for a complete one.
export type CustomerIntelligenceSnapshotContext = {
  readonly featureSnapshot: CustomerIntelligenceFeatureSnapshotRef;
  readonly rfmSnapshot: CustomerIntelligenceRfmSnapshotRef | null;
  readonly clusterSnapshot: CustomerIntelligenceClusterSnapshotRef | null;
  readonly population: CustomerIntelligencePopulationCoverage;
  readonly contractVersion: typeof CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION;
};
