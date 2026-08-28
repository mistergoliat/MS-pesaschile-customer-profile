# CUSTOMER-INTELLIGENCE-R2-A01.1 — Customer Commercial Affinity: Domain Contracts

Status: **IMPLEMENTED** (pure domain contracts only — no population, no scoring, no persistence).
Type: domain-contract slice, implementing
[`docs/design/CUSTOMER-INTELLIGENCE-R2-A01-customer-commercial-affinity-design.md`](../design/CUSTOMER-INTELLIGENCE-R2-A01-customer-commercial-affinity-design.md).

New module: `src/domain/customer-commercial-affinity/` — `contracts.ts`, `eligibility.ts`,
`snapshot.ts`, `validation.ts`, `index.ts`. Tests:
`tests/unit/customer-commercial-affinity-{contracts,eligibility,validation,snapshot,architecture-guard}.test.ts`
(46 tests).

## Implemented contracts

- `ProductSemanticFact` — the consumer-side product-semantic DTO (`productId`, `ontologyVersion`,
  `ontologyHash`, `classificationStatus`, `primaryProductFamily`, `secondaryProductFamilies`,
  `disciplines`, `useContexts`). Structurally independent from `catalog-service`: defined fresh
  in this repository, never imported or re-exported from there.
- `ProductSemanticFactTag` / `ProductSemanticFactConfidence` — opaque `{ code: string,
  confidence?: 'EXPLICIT' | 'STRONGLY_INFERRED' }`. `code` is a plain string on purpose — this
  repository does not enumerate the ontology's current 21/8/6 tag lists anywhere in code.
- `CustomerCommercialAffinityAxis` — the one closed union this module ships: `'PRODUCT_FAMILY' |
  'DISCIPLINE' | 'USE_CONTEXT'`, plus the `CUSTOMER_COMMERCIAL_AFFINITY_AXES` runtime array. This
  is deliberately the only enumerated vocabulary — it names the public semantic dimensions that
  cross the service boundary, not individual tag codes within them.
- `CustomerCommercialAffinityRow` — the normalized `(customerId, affinityAxis, affinityCode) →
  score` fact, plus `supportingOrderCount`, `supportingProductCount`, `supportingSpend`,
  `lastEvidenceAt`, `evidenceCoverage`. No raw product name, no classifier internals.
- `CustomerCommercialAffinityCoverage` — `customersEvaluated`, `customersWithAffinity`,
  `purchaseLinesEvaluated`, `purchaseLinesWithSemanticProduct`, and the six coverage percentages
  (`semanticPurchaseCoverage`, `semanticSpendCoverage`, `classifiedOrderCoverage`,
  `productFamilyCoverage`, `disciplineCoverage`, `useContextCoverage`).
- `CustomerCommercialAffinitySnapshotStatus` / `CustomerCommercialAffinitySnapshotHeader` — the
  snapshot lifecycle and header type, mirroring the RFM/clustering snapshot manifest shape.
- `CustomerCommercialAffinityEvidenceItem` / `CustomerCommercialAffinityEvidence` — the bounded,
  on-demand explainability sidecar from the design doc's Section 18. Typed now because the shape
  is already stable; nothing in this slice constructs, stores, or requires an instance of these
  types.

## Identity

`CUSTOMER_COMMERCIAL_AFFINITY_IDENTITY_AUTHORITY` / `customerCommercialAffinityIdentityAuthority`
= `'prestashop_customer'`. `CustomerCommercialAffinityRow.customerId` and
`CustomerCommercialAffinitySnapshotHeader.identityAuthority` are both typed against this literal.
`masterCustomerId` is not referenced anywhere in this module — matching how
`customer-analytics`/`customer-clustering` already key their own population/build rows by
`prestashopCustomerId`, and how RFM's `GetCustomerRfmByCustomerIdResult` exposes a
CRM-independent identity contract today.

## Snapshot lineage

`buildCustomerCommercialAffinitySnapshotKey` joins `calculationVersion`,
`productSemanticSnapshotVersion`, `ontologyHash`, `populationPolicyVersion`, and a
colon/period-sanitized `referenceTime` with `'__'` — the exact canonical-join convention already
running in production for RFM (`buildSnapshotKey`), clustering (`buildClusterSnapshotKey`), and
customer-analytics (`buildCustomerFeatureSnapshotKey`). No ad-hoc JSON serialization was
introduced. `customerCommercialAffinityCalculationVersion` is initialized to
`'customer-commercial-affinity-v1'`; any future scoring-formula change (A01.2+) requires a bump,
the same discipline `featureVersion`/`modelVersion`/`scoringPolicyVersion` already enforce
elsewhere in this repository.

`productSemanticSnapshotId`/`productSemanticSnapshotVersion` on the header are kept as
minimally-constrained opaque strings — A00.5 has not necessarily finalized its concrete artifact
contract yet. Concrete adapter compatibility with whatever it actually publishes is validated in
A01.3, not here.

## Score invariant

`isValidAffinityScore` / `assertValidAffinityScore` — finite, `>= 0`, `<= 1`. `Number.isFinite`
already excludes `NaN` and both infinities, so `NaN`/`Infinity`/`-Infinity`/negative/`>1` are all
rejected by the same single check. No scoring algorithm is implemented — this is bound
enforcement only, ready for A01.2's kernel to call.

## Coverage invariant

`isValidCoveragePercentage` / `assertValidCoveragePercentage` — finite, `0..100`, never silently
clamped or normalized. `assertValidCoverage` additionally enforces the inclusion-exclusion
invariants a real coverage computation must satisfy (`customersWithAffinity <=
customersEvaluated`, `purchaseLinesWithSemanticProduct <= purchaseLinesEvaluated`), mirroring the
validation style already used by `computeCoverageSummary` in
`src/domain/customer-intelligence/coverage.ts`.

## Status / classification-status eligibility

`CustomerCommercialAffinitySnapshotStatus` reuses RFM's exact lifecycle vocabulary verbatim:
`'building' | 'validated' | 'published' | 'failed' | 'superseded'` — no new vocabulary invented.

`eligibility.ts` implements the structural, semantic-input-only policy from the design doc's
Section 11/13:

| `classificationStatus` | `isProductFamilyEligible` | `isDisciplineEligible` | `isUseContextEligible` |
| --- | --- | --- | --- |
| `CLASSIFIED` / `PARTIALLY_CLASSIFIED` | true when `primaryProductFamily` is present and not `'OTHER'` | true when `disciplines` is non-empty | true when `useContexts` is non-empty |
| `OTHER` | **false** | false (no evidence present anyway) | false (no evidence present anyway) |
| `EXCLUDED_NON_PRODUCT` | **false** | **false** | **false** |
| `NEEDS_REVIEW` | **false** | **false** | **false** |

These functions answer "**can** this fact contribute on this axis" only — they never accumulate,
weigh, or score evidence (that begins in A01.2). No accumulation logic exists in this slice.

`OTHER` is recognized two ways, matching the design doc's Section 11 correction: either
`classificationStatus === 'OTHER'`, or `primaryProductFamily?.code === 'OTHER'` on an otherwise
`CLASSIFIED`/`PARTIALLY_CLASSIFIED` fact. Both are checked because the exact encoding is
`catalog-service`'s choice, not this module's to assume.

## Confidence optionality

`ProductSemanticFactTag.confidence` is `confidence?: 'EXPLICIT' | 'STRONGLY_INFERRED'` —
**optional**, not required, and no contract or helper in this module requires it to be present.
This is deliberate: A00.5 has not necessarily finalized whether `catalog-service` publishes
tag-level confidence in its stable consumer snapshot at all. A test constructs a
`ProductSemanticFactTag` with no `confidence` field and confirms it type-checks and behaves
correctly through every helper in this module. No `probability`, `relevanceScore`, classifier
rule ID, or raw classifier evidence field exists anywhere in this contract.

## Catalog Service boundary

`src/domain/customer-commercial-affinity/` contains zero imports from — and zero comment
references to — `commercial-product-ontology`, `product-semantic-classification`, or
`catalog-service` as an import source (a boundary explanation in a doc comment naming
`catalog-service` in prose is fine; an actual `import ... from '...catalog-service...'` is not,
and none exists). `tests/unit/customer-commercial-affinity-architecture-guard.test.ts` enforces
this by statically scanning every file in the module for forbidden substrings and forbidden
import sources, and additionally proves the string `positiveAffinitySignal` — deliberately removed
from Catalog Product Semantics — does not appear anywhere in this module, not even in a comment.

## What remains intentionally unimplemented

Per the task's explicit scope (Section 23) and the design doc's slice plan:

- No scoring weights, decay function, or monetary dampening (A01.2).
- No Product Semantic Snapshot reader/adapter (A01.3 — blocked on A00.5's artifact shape).
- No population builder, no join against real purchase data (A01.4 — blocked on A00.5).
- No DB schema/migration or snapshot repository (A01.5).
- No read model/API (A01.6).
- No evidence *persistence* — `CustomerCommercialAffinityEvidence`/`Item` are typed but never
  constructed or stored in this slice.
- No changes to RFM, clustering, Customer Intelligence, Copilot, or the dashboard.
- No LLM anywhere in this module.

## Validation

```
npm run typecheck   → clean, 0 errors
npm run lint         → clean, 0 errors
npm run build        → clean
npm test              → 194 test files, 1711 tests, all passing
                        (baseline before this slice: 189 files / 1665 tests;
                         +5 files / +46 tests, all new, none modified)
```
