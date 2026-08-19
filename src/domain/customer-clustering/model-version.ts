// Canonical version identifiers for the CP-R2 behavioral clustering capability (task Section
// 39). Never use "latest" as a version value — every axis is an explicit, immutable string so
// a historical snapshot/model stays exactly reproducible.

// Reuses the exact population definition validated in CP-R2-T01 (>=2 valid orders lifetime,
// operational accounts excluded) — not re-derived.
export { operationalAccountExclusionPolicyVersion } from '../customer-rfm/operational-account-exclusion-policy.js';

export const populationPolicyVersion = 'cp-r2-clustering-population-b-prime-v1';
export const populationScope = 'all_valid_prestashop_shops';

// Feature Set A only (CP-R2-T01 finding: better quality AND less RFM-redundant than Set B).
// totalSpent/validOrders/daysSinceLastOrder and any RFM score/code are never trained inputs.
export const featureVersion = 'behavioral-clustering-features-v1';
export const preprocessingVersion = 'behavioral-clustering-preprocessing-v1';
export const modelVersion = 'behavioral-kmeans-k4-v1';
export const interpretationVersion = 'behavioral-cluster-interpretation-v1';

export const algorithm = 'kmeans';
export const k = 4;
// Fixed, canonical training seed for the production candidate — CP-R2-T01 selected a
// "most representative of its 10 seeds" seed per experimental run for reporting purposes only;
// that technique is not itself a stable production choice. The production model instead pins
// one specific seed as part of its versioned hyperparameters, exactly like k itself.
export const trainingSeed = 42;

// Canonical feature order — training (Python) and serving (TS assignment) must both read this
// from the persisted model artifact, never redeclare their own order, or a mismatched column
// order would silently corrupt every distance calculation.
export const featureOrder = [
  'distinctProducts',
  'effectiveDiversity',
  'averageUnitsPerOrder',
  'purchaseFrequencyDays',
  'orders365d',
  'customerTenureDays',
  'repeatProductRate',
  'top1Share',
  'top3Share',
  'cancelledOrderRatio',
  'discountShare',
  'shippingShare',
] as const;

export type ClusterFeatureName = (typeof featureOrder)[number];

export const checksumVersion = 'clustering-checksum-canonical-json-v1';
export const artifactVersion = 'clustering-model-artifact-v1';
