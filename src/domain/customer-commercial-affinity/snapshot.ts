// Deterministic versioning primitives for Customer Commercial Affinity snapshots (task
// Section 12/13/14). No population building, no scoring, no persistence here.

import { CUSTOMER_COMMERCIAL_AFFINITY_IDENTITY_AUTHORITY } from './contracts.js';

// Bump on any change to the scoring formula (decay curve, monetary dampening, primary/secondary
// weighting, confidence discount) once A01.2 defines them — never silently reused across a
// formula change (design doc Section 19: determinism).
export const customerCommercialAffinityCalculationVersion = 'customer-commercial-affinity-v1';

// prestashop_customer id_customer is the population/build key — never masterCustomerId (design
// doc Section 14; task Section 14). Re-exported here alongside the version constants because
// both are the versioning/identity primitives this slice is responsible for.
export const customerCommercialAffinityIdentityAuthority = CUSTOMER_COMMERCIAL_AFFINITY_IDENTITY_AUTHORITY;

export type CustomerCommercialAffinitySnapshotKeyInput = {
  readonly calculationVersion: string;
  readonly productSemanticSnapshotVersion: string;
  readonly ontologyHash: string;
  readonly populationPolicyVersion: string;
  readonly referenceTime: string;
};

// Mirrors the exact canonical join convention already running in production for RFM
// (buildSnapshotKey in customer-rfm/dataset.ts), clustering (buildClusterSnapshotKey) and
// customer-analytics (buildCustomerFeatureSnapshotKey): an explicit, order-fixed '__'-joined
// string over the fields that determine lineage — not ad-hoc JSON serialization. Lineage per
// the design doc (Section 12): calculationVersion, product-semantic identity/version,
// ontologyHash, populationPolicyVersion, referenceTime. Any one of these changing must resolve
// to a different key, which is what makes the immutable-snapshot-per-key discipline (design doc
// Section 16) enforceable once A01.5 adds a repository.
export function buildCustomerCommercialAffinitySnapshotKey(input: CustomerCommercialAffinitySnapshotKeyInput): string {
  return [
    input.calculationVersion,
    input.productSemanticSnapshotVersion,
    input.ontologyHash,
    input.populationPolicyVersion,
    input.referenceTime.replace(/[:.]/g, '-'),
  ].join('__');
}
