// Canonical version identifiers for CP-R3-T01 (Customer Analytics Data Layer Foundation).
// Never use "latest" as a version value — every axis is an explicit, immutable string so a
// historical snapshot stays exactly reproducible (task Section 21).

// Reuses the exact same exclusion list RFM/clustering already validated — never re-derived.
export { operationalAccountExclusionPolicyVersion } from '../customer-rfm/operational-account-exclusion-policy.js';

// Population B (>=1 valid order lifetime, operational accounts excluded) — deliberately
// broader than clustering's Population B' (>=2 valid orders): task Section 12 requires the
// Data Layer not be limited by default to clustering's own population. Live-audited against
// PrestaShop RDS 2026-08-20: 72,983 total ps_customer rows; 44,935 with >=1 valid order
// (this population); 10,148 with >=2 valid orders (clustering's narrower population, a
// strict subset). Population A (all customers, including zero-order accounts) was rejected
// for the same reason the clustering readiness audit rejected it: a zero-order customer
// produces an all-null/all-zero feature vector with no commercial signal to materialize —
// see docs/audits/CP-R2-behavioral-clustering-readiness-feature-audit.md Step 5.
export const populationPolicyVersion = 'customer-analytics-population-b-v1';
export const shopScope = 'all_valid_prestashop_shops';

// V1 feature set: 12 Feature-Set-A-equivalent behavioral fields (same semantics as
// behavioral-clustering-features-v1, task Section 40) plus 6 commercial post-hoc fields
// (task Section 10/38). Never includes RFM scores/segments or cluster ids — those are model
// outputs, not source features (task Section 11).
export const featureVersion = 'customer-analytics-features-v1';

export const checksumVersion = 'customer-analytics-checksum-canonical-json-v1';

export type CustomerFeatureSnapshotStatus = 'building' | 'validated' | 'published' | 'failed' | 'superseded';
