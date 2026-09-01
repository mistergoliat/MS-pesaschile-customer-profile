import type { CustomerCommercialAffinityAxis } from './contracts.js';

/** Stable, read-only lineage exposed by the published affinity runtime. */
export type CustomerCommercialAffinityRuntimeSnapshot = {
  readonly snapshotId: string;
  readonly calculationVersion: string;
  readonly referenceTime: string;
  readonly productSemanticSnapshotId: string;
  readonly productSemanticSchemaVersion: string;
  readonly ontologyVersion: string;
  readonly ontologyHash: string;
  readonly sourceSemanticChecksum: string;
  readonly consumerSemanticChecksum: string;
  readonly affinityDatasetChecksum: string;
};

export type CustomerCommercialAffinityRuntimeRow = {
  readonly affinityAxis: CustomerCommercialAffinityAxis;
  readonly affinityCode: string;
  readonly score: number;
  readonly supportingOrderCount: number;
  readonly supportingProductCount: number;
  readonly supportingSpend: string;
  readonly lastEvidenceAt: string;
  readonly explicitEvidenceCoverage: number | null;
};

export type CustomerCommercialAffinityReadModel = {
  readonly customerId: number;
  readonly snapshot: CustomerCommercialAffinityRuntimeSnapshot;
  readonly affinities: readonly CustomerCommercialAffinityRuntimeRow[];
};
