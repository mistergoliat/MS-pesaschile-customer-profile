// Customer Commercial Affinity (CUSTOMER-INTELLIGENCE-R2-A01) — pure domain contracts.
// See docs/design/CUSTOMER-INTELLIGENCE-R2-A01-customer-commercial-affinity-design.md for the
// full design this implements. This file declares TYPES ONLY; no scoring, no accumulation, no
// catalog-service call. See ../../../docs/releases/CUSTOMER-INTELLIGENCE-R2-A01.1-affinity-domain-contracts.md
// for what this slice deliberately does and does not implement.

// ── Product Semantic consumer DTO ──────────────────────────────────────────────────────────
//
// Structurally independent from catalog-service: never an import of a catalog-service module,
// never a re-export of its ontology tag registry. `code` is an opaque string on purpose —
// customer-profile does not enumerate the current PRODUCT_FAMILY/DISCIPLINE/USE_CONTEXT tag
// lists in code (design doc Section 2). The one exception is the literal `'OTHER'` code, which
// customer-profile is explicitly allowed to recognize (design doc Section 11): it is the
// residual PRODUCT_FAMILY outcome catalog-service emits, and customer-profile independently
// decides — as its own downstream policy, not as ontology metadata — that it contributes no
// PRODUCT_FAMILY-specific affinity. See eligibility.ts.

// Optional, not required: A00.5 has not necessarily finalized whether it publishes tag-level
// confidence in its stable consumer snapshot (design doc Section 2/3). Every A01 contract and
// helper must stay correct whether or not a fact carries this field.
export type ProductSemanticFactConfidence = 'EXPLICIT' | 'STRONGLY_INFERRED';

export type ProductSemanticFactTag = {
  readonly code: string;
  readonly confidence?: ProductSemanticFactConfidence;
};

export type ProductSemanticClassificationStatus = 'CLASSIFIED' | 'PARTIALLY_CLASSIFIED' | 'OTHER' | 'EXCLUDED_NON_PRODUCT' | 'NEEDS_REVIEW';

export type ProductSemanticFact = {
  readonly productId: number;
  readonly ontologyVersion: string;
  readonly ontologyHash: string;
  readonly classificationStatus: ProductSemanticClassificationStatus;
  readonly primaryProductFamily: ProductSemanticFactTag | null;
  readonly secondaryProductFamilies: readonly ProductSemanticFactTag[];
  readonly disciplines: readonly ProductSemanticFactTag[];
  readonly useContexts: readonly ProductSemanticFactTag[];
};

// ── Affinity axis ───────────────────────────────────────────────────────────────────────────
//
// The axis vocabulary itself crosses the service boundary (it names the public semantic
// dimensions catalog-service exposes) and is therefore a closed union here. Individual tag
// codes within an axis are never enumerated (see ProductSemanticFactTag.code above).
export type CustomerCommercialAffinityAxis = 'PRODUCT_FAMILY' | 'DISCIPLINE' | 'USE_CONTEXT';

export const CUSTOMER_COMMERCIAL_AFFINITY_AXES: readonly CustomerCommercialAffinityAxis[] = ['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT'];

// ── Affinity row ────────────────────────────────────────────────────────────────────────────
//
// Normalized: one row per (customerId, affinityAxis, affinityCode) with qualifying evidence.
// No evidence, no row (design doc Section 10/16) — this slice never builds rows, but every
// later slice that does must preserve that invariant structurally, not by convention.
export type CustomerCommercialAffinityRow = {
  readonly customerId: number; // prestashop_customer id_customer — see snapshot.ts identityAuthority
  readonly affinityAxis: CustomerCommercialAffinityAxis;
  readonly affinityCode: string; // opaque, semantically owned by the catalog ontology
  readonly score: number; // bounded [0,1] — see validation.ts assertValidAffinityScore
  readonly supportingOrderCount: number;
  readonly supportingProductCount: number;
  readonly supportingSpend: string; // decimal string, never a JS float
  readonly lastEvidenceAt: string; // ISO timestamp
  readonly evidenceCoverage: number; // bounded [0,1] — share of evidence mass with EXPLICIT confidence; 1 when the snapshot carries no confidence field at all
};

// ── Coverage ────────────────────────────────────────────────────────────────────────────────
export type CustomerCommercialAffinityCoverage = {
  readonly customersEvaluated: number;
  readonly customersWithAffinity: number;
  readonly purchaseLinesEvaluated: number;
  readonly purchaseLinesWithSemanticProduct: number;
  readonly semanticPurchaseCoverage: number; // percent, [0,100]
  readonly semanticSpendCoverage: number; // percent, [0,100]
  readonly classifiedOrderCoverage: number; // percent, [0,100]
  readonly productFamilyCoverage: number; // percent, [0,100]
  readonly disciplineCoverage: number; // percent, [0,100] — expected low; never hidden or defaulted away
  readonly useContextCoverage: number; // percent, [0,100]
};

// ── Snapshot lifecycle / header ─────────────────────────────────────────────────────────────
//
// Same status vocabulary already running in production for RFM (RfmSnapshotStatus) — reused
// verbatim, not reinvented (design doc Section 9 / task Section 9).
export type CustomerCommercialAffinitySnapshotStatus = 'building' | 'validated' | 'published' | 'failed' | 'superseded';

export const CUSTOMER_COMMERCIAL_AFFINITY_IDENTITY_AUTHORITY = 'prestashop_customer';

export type CustomerCommercialAffinitySnapshotHeader = {
  readonly snapshotId: string | null; // DB-assigned; null pre-persist, mirrors RfmSnapshotManifest.snapshotId
  readonly snapshotKey: string; // see snapshot.ts buildCustomerCommercialAffinitySnapshotKey
  readonly status: CustomerCommercialAffinitySnapshotStatus;
  readonly referenceTime: string;
  readonly generatedAt: string;
  readonly calculationVersion: string;
  readonly identityAuthority: typeof CUSTOMER_COMMERCIAL_AFFINITY_IDENTITY_AUTHORITY;
  readonly populationPolicyVersion: string;

  // Opaque lineage identifiers for the Product Semantic Snapshot this affinity snapshot was
  // built from. A00.5 has not necessarily finalized its concrete artifact contract yet (design
  // doc Section 11) — kept as plain, minimally-constrained strings on purpose. Concrete adapter
  // compatibility with whatever A00.5 actually publishes is validated in A01.3, not here.
  readonly productSemanticSnapshotId: string;
  readonly productSemanticSnapshotVersion: string;
  readonly ontologyVersion: string;
  readonly ontologyHash: string;

  readonly populationSize: number;
  readonly datasetChecksum: string;
  readonly affinityDatasetChecksum: string;

  // Mirrors RFM's exclusion-diagnostics pattern (e.g. SellerServiceDiagnostics) — accounted for
  // before evidence accumulation begins, not reconstructed from a local exclusion policy
  // (design doc Section 12; task Section 15 EXCLUDED_NON_PRODUCT policy).
  readonly excludedNonProductLineCount: number;
  readonly excludedNonProductSpend: string; // decimal string

  readonly coverage: CustomerCommercialAffinityCoverage;
};

// ── Explainability sidecar (optional; not persisted or built in this slice) ────────────────
//
// Bounded, on-demand evidence for "why does this customer have this affinity code" (design doc
// Section 18). Typed now because the shape is already stable, but nothing in A01.1 constructs,
// stores, or requires an instance of these types — that begins in A01.4 at the earliest.
export type CustomerCommercialAffinityEvidenceItem = {
  readonly productId: number;
  readonly orderId: number | null;
  readonly purchasedAt: string;
  readonly spendContribution: string;
  readonly quantityContribution: number;
  readonly consumedTag: {
    readonly axis: CustomerCommercialAffinityAxis;
    readonly code: string;
    readonly confidence?: ProductSemanticFactConfidence;
  };
};

export type CustomerCommercialAffinityEvidence = {
  readonly customerId: number;
  readonly affinityAxis: CustomerCommercialAffinityAxis;
  readonly affinityCode: string;
  readonly items: readonly CustomerCommercialAffinityEvidenceItem[];
};
