import type { CustomerCommercialAffinityRow } from '../../domain/customer-commercial-affinity/index.js';
import type { ProductSemanticSnapshotConsumerMetadata } from '../product-semantic-snapshot/consumer.js';
import { sha256Stable } from '../../shared/stable-checksum.js';

export type CustomerCommercialAffinityCanonicalSemanticMetadata = Pick<
  ProductSemanticSnapshotConsumerMetadata,
  | 'snapshotId'
  | 'schemaVersion'
  | 'ontologyVersion'
  | 'ontologyHash'
  | 'classifierVersion'
  | 'sourceSemanticChecksum'
  | 'consumerNormalizedChecksum'
>;

export type CustomerCommercialAffinitySemanticSnapshotInput = CustomerCommercialAffinityCanonicalSemanticMetadata;

export function calculateCustomerCommercialAffinityDatasetChecksum<TSemanticSnapshot extends CustomerCommercialAffinitySemanticSnapshotInput>(input: {
  readonly referenceTime: string;
  readonly semanticSnapshot: TSemanticSnapshot;
  readonly rows: readonly CustomerCommercialAffinityRow[];
}): string {
  const canonicalSemanticMetadata: CustomerCommercialAffinityCanonicalSemanticMetadata = {
    snapshotId: input.semanticSnapshot.snapshotId,
    schemaVersion: input.semanticSnapshot.schemaVersion,
    ontologyVersion: input.semanticSnapshot.ontologyVersion,
    ontologyHash: input.semanticSnapshot.ontologyHash,
    classifierVersion: input.semanticSnapshot.classifierVersion,
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
