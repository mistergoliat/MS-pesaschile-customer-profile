import type { CustomerCommercialAffinityRow } from '../../domain/customer-commercial-affinity/index.js';
import type { ProductSemanticSnapshotConsumerMetadata } from '../product-semantic-snapshot/consumer.js';
import { sha256Stable } from '../../shared/stable-checksum.js';

export type CustomerCommercialAffinityCanonicalSemanticMetadata = Pick<
  ProductSemanticSnapshotConsumerMetadata,
  | 'snapshotId'
  | 'schemaVersion'
  | 'generatedAt'
  | 'ontologyVersion'
  | 'ontologyHash'
  | 'classifierVersion'
  | 'sourceProductCount'
  | 'recordCount'
  | 'classificationCounts'
  | 'sourceSemanticChecksum'
  | 'consumerNormalizedChecksum'
>;

export type CustomerCommercialAffinitySemanticSnapshotInput = Pick<
  CustomerCommercialAffinityCanonicalSemanticMetadata,
  'snapshotId' | 'schemaVersion' | 'ontologyVersion' | 'ontologyHash' | 'sourceSemanticChecksum' | 'consumerNormalizedChecksum'
> & Partial<Omit<CustomerCommercialAffinityCanonicalSemanticMetadata, 'snapshotId' | 'schemaVersion' | 'ontologyVersion' | 'ontologyHash' | 'sourceSemanticChecksum' | 'consumerNormalizedChecksum'>>;

export function calculateCustomerCommercialAffinityDatasetChecksum<TSemanticSnapshot extends CustomerCommercialAffinitySemanticSnapshotInput>(input: {
  readonly referenceTime: string;
  readonly semanticSnapshot: TSemanticSnapshot;
  readonly rows: readonly CustomerCommercialAffinityRow[];
}): string {
  const canonicalSemanticMetadata: CustomerCommercialAffinitySemanticSnapshotInput = {
    snapshotId: input.semanticSnapshot.snapshotId,
    schemaVersion: input.semanticSnapshot.schemaVersion,
    generatedAt: input.semanticSnapshot.generatedAt,
    ontologyVersion: input.semanticSnapshot.ontologyVersion,
    ontologyHash: input.semanticSnapshot.ontologyHash,
    classifierVersion: input.semanticSnapshot.classifierVersion,
    sourceProductCount: input.semanticSnapshot.sourceProductCount,
    recordCount: input.semanticSnapshot.recordCount,
    classificationCounts: input.semanticSnapshot.classificationCounts,
    sourceSemanticChecksum: input.semanticSnapshot.sourceSemanticChecksum,
    consumerNormalizedChecksum: input.semanticSnapshot.consumerNormalizedChecksum,
  };

  return sha256Stable({
    referenceTime: input.referenceTime,
    semanticSnapshot: canonicalSemanticMetadata,
    rows: [...input.rows].sort(compareRows),
  });
}

function compareRows(left: CustomerCommercialAffinityRow, right: CustomerCommercialAffinityRow): number {
  return left.customerId - right.customerId || left.affinityAxis.localeCompare(right.affinityAxis) || left.affinityCode.localeCompare(right.affinityCode);
}
