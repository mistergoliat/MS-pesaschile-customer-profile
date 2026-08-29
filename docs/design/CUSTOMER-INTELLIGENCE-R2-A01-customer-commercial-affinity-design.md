# CUSTOMER-INTELLIGENCE-R2-A01 — Customer Commercial Affinity: Domain Contract & Architecture Design

Status: **DESIGN — no runtime code added in this slice.**
Type: architecture/domain-design (A01.0). Precedes any implementation slice (A01.1+).

This document designs, but does not implement, the domain that will combine customer purchase
behavior (owned here) with normalized product semantic facts (owned by `catalog-service`, current
ontology `commercial-product-ontology-v3`) into a **customer commercial affinity** signal. Every
existing contract cited below was read directly from this repository's current code — see
[Section 0](#0-method--what-was-verified) for exactly what was checked and where.

## 0. Method — what was verified

Read directly from the current repository (no assumptions):

- `src/domain/customer-purchased-products/contracts.ts`, `src/domain/customer-purchase-behavior/contracts.ts`,
  `src/domain/customer-commercial-summary/contracts.ts`, `src/domain/customer-orders/analytical-order.ts`
  — existing purchase-side facts.
- `src/domain/customer-identity/contracts.ts`, `src/domain/customer-rfm/contracts.ts` (identity fields),
  `src/domain/master-customer-population/contracts.ts` — the two live identity spaces.
- `src/domain/customer-rfm/{contracts,dataset}.ts`, `src/domain/customer-clustering/snapshot.ts`,
  `src/domain/customer-analytics/snapshot.ts`, `src/domain/customer-intelligence/{contracts,coverage}.ts`
  — every existing snapshot-building and read-model-composition pattern in this repo.
- `src/infrastructure/rfm/mysql-rfm-snapshot-repository.ts` — the actual transactional
  publish/checksum-verify/supersede pattern already running for RFM snapshots.
- `docs/audits/CUSTOMER-PROFILE-ARCHITECTURE-SEPARATION-AUDIT.md` — the prior read-only audit that
  first sketched a `ProductSemanticFact` shape (Section 6 there); this document supersedes that sketch
  with a fuller design, not a contradictory one.
- `src/domain/order-classification/index.ts` — confirmed to be an unrelated, unimplemented
  order-*state* placeholder, not a product-classification module (no boundary overlap risk).

No file in `src/domain/commercial-product-ontology/` or `src/domain/product-semantic-classification/`
was consulted — those were removed from this repository in the prior cleanup slice and must stay
removed; this design deliberately does not reopen them even for reference.

## 1. Architectural boundary

```
catalog-service            customer-profile
──────────────              ─────────────────
owns product truth          owns customer truth
  ontology                    RFM
  classifier                  clustering
  non-product exclusion       customer analytics
  semantic provenance         Customer Intelligence
  (future) Semantic Snapshot  Copilot / dashboard
                               purchase behavior
                               (future) Commercial Affinity ← this design
```

Customer Profile must never parse product names, classify categories, inspect semantic regexes,
interpret raw product features, reproduce ontology rules, or decide a product's family from raw
catalog data. It consumes **normalized semantic facts only** — the same discipline the two now-removed
migrated modules already enforced internally, inherited here by construction: A01 code will never see
a raw product row, only the [`ProductSemanticFact`](#2-productsemanticfact--the-consumer-contract) DTO.

## 2. `ProductSemanticFact` — the consumer contract

```ts
export type ProductSemanticFactConfidence = 'EXPLICIT' | 'STRONGLY_INFERRED';

export type ProductSemanticFactTag = {
  readonly code: string;                          // e.g. "BENCH", "POWERLIFTING", "HOME_GYM"
  readonly confidence?: ProductSemanticFactConfidence; // optional — see note below
};

export type ProductSemanticClassificationStatus =
  | 'CLASSIFIED'
  | 'PARTIALLY_CLASSIFIED'
  | 'OTHER'
  | 'EXCLUDED_NON_PRODUCT'
  | 'NEEDS_REVIEW';

export type ProductSemanticFact = {
  readonly productId: number;
  readonly ontologyVersion: string;                // e.g. "commercial-product-ontology-v3"
  readonly ontologyHash: string;
  readonly classificationStatus: ProductSemanticClassificationStatus;
  readonly primaryProductFamily: ProductSemanticFactTag | null;
  readonly secondaryProductFamilies: readonly ProductSemanticFactTag[];
  readonly disciplines: readonly ProductSemanticFactTag[];
  readonly useContexts: readonly ProductSemanticFactTag[];
};
```

This is a **structurally independent type defined inside `customer-profile`** — never an import of a
`catalog-service` TypeScript module, and never a re-export of one. It is transport/read-model safe by
construction: nothing in it depends on how `catalog-service` computed it, only on what it means.

**Deliberately excluded** (classifier internals, not consumer inputs): `ruleId`, raw evidence strings,
free-text match spans, category-trust internals, regex/rule provenance. If full auditability of a
*specific* classification is ever needed, it should be fetched on demand from `catalog-service` by
`productId` — never baked into every fact this repository stores.

**Confidence is kept, bounded, categorical, and optional** — `EXPLICIT` vs `STRONGLY_INFERRED`, not a
continuous classifier probability. Per the task's default preference (semantic facts yes, bounded
confidence if commercially useful, classifier internals no), confidence is used in
[Section 7](#7-signal-inventory) as a small evidence-reliability discount, never merged into the
affinity score itself — see the [Section 4](#4-invariant-affinity-is-not-classifier-confidence)
invariant.

**Provisional, pending A00.5**: whether `catalog-service` publishes tag-level confidence at all in its
stable consumer snapshot is A00.5's decision, not this design's. This contract therefore does not
require it: `confidence` is optional on `ProductSemanticFactTag`, so A01 does not obligate
`catalog-service` to expose it. Rule for the scoring kernel: **use it if A00.5 exposes bounded tag
confidence as a public semantic fact; otherwise, A01 scoring must remain fully valid without it** — a
missing `confidence` is treated as neutral (no discount applied), never as an error and never as a
reason to skip a fact. A01.1's contracts and A01.2's kernel must not be built to *require* this field.

## 3. Purchase input — what already exists, reused as-is

No purchase-domain redesign. A01 is a **consumer** of existing, already-correct customer-domain facts:

| Contract | File | Grain | What A01 reads from it |
| --- | --- | --- | --- |
| `PurchaseBehaviorProduct` | `src/domain/customer-purchase-behavior/contracts.ts` | customer × productId | `productId`, `orderCount`, `totalQuantityPurchased`, `totalSpentTaxIncl`, `spendShare`, `orderShare`, `firstPurchasedAt`, `lastPurchasedAt`, `daysSinceLastPurchase`, `isRepeated` |
| `PurchaseBehaviorVariant` | same file | customer × productId × productAttributeId | Same shape at variant grain — A01 rolls variants up to `productId` before joining semantics (the ontology classifies at product grain, not variant grain) |
| `PurchasedProduct` | `src/domain/customer-purchased-products/contracts.ts` | customer × productId | `catalogStatus: 'linked' \| 'deleted_or_unavailable'` — a purchase whose product is `deleted_or_unavailable` in PrestaShop today can still carry a valid historical `ProductSemanticFact` by `productId`; this field is orthogonal to `classificationStatus` and both are respected independently |
| `CustomerCommercialSummary` | `src/domain/customer-commercial-summary/contracts.ts` | customer (whole) | `totalOrders`, `totalSpentTaxIncl`, `distinctProductsPurchased` — used only as coverage **denominators** (Section 11), never as scoring input directly |
| `AnalyticalOrder` (order/order-line, `orderId` present) | `src/domain/customer-orders/analytical-order.ts` | order line | Deeper source if a future slice needs literal `orderId`s for the evidence sidecar (Section 18) beyond what `orderCount` already aggregates — not required for the v1 kernel |

`PurchaseBehaviorProduct` is the **primary join input**: it is already shaped almost exactly for
deterministic scoring (per-product spend share, order share, recency, repeat flag, all pre-aggregated
per customer). A01's only new work on the purchase side is joining it to `ProductSemanticFact` by
`productId` — no new purchase aggregation is designed or needed.

## 4. Invariant: affinity is not classifier confidence

```
Product semantic confidence          Customer commercial affinity
──────────────────────────           ─────────────────────────────
"How strongly is this tag            "How strongly does this customer's
 evidenced for the PRODUCT?"          observed BUYING BEHAVIOR support
                                       this semantic dimension?"

Computed once, by catalog-service,   Computed per customer, by
from product text/category data.     customer-profile, from purchase history.

A property of the product.           A property of the customer.
```

These are never combined into one probability. When present, `ProductSemanticFactConfidence` is used
only as a bounded per-fact evidence-reliability discount when *accumulating* purchase evidence
(Section 7) — conceptually identical to how RFM already treats data-quality diagnostics (refunds,
currency, seller-service exclusions) as inputs to the computation without being folded into the RFM
score itself. When absent (Section 2's "provisional, pending A00.5" note), the affinity computation
proceeds unmodified — confidence is an optional refinement to the evidence-accumulation step, never a
precondition for it.

## 5. Affinity dimensions

Computed **independently** per axis — a customer's `PRODUCT_FAMILY` affinities never influence their
`DISCIPLINE` or `USE_CONTEXT` affinities, and vice versa:

- `PRODUCT_FAMILY` (21 real codes + `OTHER` as of ontology v3)
- `DISCIPLINE` (8 codes as of v3)
- `USE_CONTEXT` (6 codes as of v3)

Each `(customerId, axis, code)` triple that has qualifying evidence produces exactly one row
([Section 15](#15-snapshot-model)). The illustrative numbers in the task prompt are not a scoring
model and are not reproduced as defaults anywhere in this design.

## 6. Score semantics

**Never called a probability** — there is no calibrated supervised model in v1. Defined as:

> A normalized, deterministic **affinity score**, bounded `[0, 1]`, computed independently per
> `(customerId, axis, code)` from that customer's own purchase evidence for that code.
>
> `0` = no qualifying observed affinity evidence for this code.
> `1` = the strongest affinity the scoring model's saturation curve can express (an asymptotic
> ceiling, not "customer's #1 favorite family").

**Explicit shape decision (Section 9's "do not decide implicitly" applies equally here):** the score
is a **saturating, monotonic transform of a composite weighted-evidence value**, computed per code —
**not** a softmax/sum-normalization across codes within the same axis.

Why this matters and was not left implicit: sum-normalizing across codes (so a customer's
`PRODUCT_FAMILY` scores sum to 1) would make affinity **mutually exclusive by construction** — a
customer who only ever bought one `BENCH` would trivially score `1.0` there, and any customer who
diversifies across `BENCH` + `BARBELL` would necessarily score lower on both than a single-family
buyer, even with identical `BENCH` behavior. Commercial affinity is not mutually exclusive (a customer
can be strongly into both powerlifting and home cardio), and — critically for
[Section 21](#21-a03-audience-engine-compatibility) — a softmax score is not comparable across
customers, which breaks `score >= X` audience queries. A per-code saturating score (e.g. a bounded
function of accumulated weighted evidence, asymptotic to 1) keeps codes independent and keeps `X`
meaningful across the whole customer population.

**Documented limitations:**

- Not comparable to a different `calculationVersion`'s scores (the saturation curve/weights can change
  between versions — always compare within one `calculationVersion`).
- Not a forecast or propensity-to-buy-next prediction — it summarizes **observed history** only.
- A customer with very little purchase history in general will have low scores everywhere, not because
  they lack affinity but because little evidence exists yet — this is a coverage question
  ([Section 11](#11-other-products), [Section 17](#17-coverage-model)), not a scoring defect, and must
  be surfaced via coverage metrics rather than hidden.

## 7. Signal inventory

> **A01.2.1 finding, not yet known when this table was written:** `PurchaseBehaviorProduct.orderCount`
> is `COUNT(DISTINCT id_order)` scoped to a *single product*, not to an affinity code. Summing it
> across multiple products supporting the same code overcounts distinct purchase occasions
> whenever those products were bought together in one order — and `isRepeated` is literally
> `orderCount >= 2`, so it inherits the same problem. Both signals were **removed from v1 scoring**
> (not merely dampened) in
> [`CUSTOMER-INTELLIGENCE-R2-A01.2.1-affinity-scoring-semantic-hardening.md`](../releases/CUSTOMER-INTELLIGENCE-R2-A01.2.1-affinity-scoring-semantic-hardening.md),
> deferred until A01.4 can supply exact distinct-order evidence from `AnalyticalOrder` line data.
> The classification below (`USE`) was this design's original, and reasonable, expectation before
> that grain issue was found by implementation-time auditing — kept here for history, not as
> current guidance.

| Signal | Classification | Rationale |
| --- | --- | --- |
| Recency (`daysSinceLastPurchase` / `lastPurchasedAt`) | **USE** | Decayed contribution — recent evidence should count more than a single purchase from years ago; folds "historical decay" into one signal rather than treating it separately. |
| Frequency (`orderCount`, i.e. `supportingOrderCount`) | **USE** *(reversed in A01.2.1 — see note above)* | Independent of spend; a customer with 5 separate `BARBELL` orders shows a real behavioral pattern regardless of unit price. |
| Repeat purchase (`isRepeated`) | **USE** *(reversed in A01.2.1 — see note above)* | A bonus weight on top of frequency — repeat-buy behavior is stronger evidence than the same order count spread across first-time purchases only. |
| Monetary contribution (`spendShare`, dampened `totalSpentTaxIncl`) | **USE, dampened** | See [Section 8](#8-avoiding-spend-dominance) — never linear, never the dominant term. |
| Diversity of supporting products (distinct `productId` count per code) | **USE** | Distinguishes "one $2M multi-gym" from "3 different barbells from 3 different orders" — see Section 8. |
| Primary vs. secondary family evidence | **USE** | Bounded lower weight for secondary — see [Section 9](#9-primary-vs-secondary-product-family). |
| Classifier confidence (`EXPLICIT` vs `STRONGLY_INFERRED`), when the consumed fact carries it | **USE if available, small and bounded; otherwise no-op** | A modest per-fact reliability discount on `STRONGLY_INFERRED` evidence when accumulating — never large enough to let confidence alone move a customer between meaningfully different score bands; must never be described as part of the "score" narrative (Section 4). Optional per Section 2 — A00.5 may not publish it, and the kernel must score correctly without it (no discount applied, not an error). |
| Quantity (`totalQuantityPurchased`) | **REJECT as a scoring weight** | Fitness equipment is typically qty=1 per line; where quantity does vary (chalk, small accessories), including it raw reintroduces exactly the spend-dominance failure mode (Section 8) applied to units instead of currency — one bulk order of 50 units of chalk must not outweigh 5 separate barbell orders. Kept as descriptive/diagnostic metadata only, never a weight input. |
| Historical decay as a separate signal | **REJECT (folded into recency)** | Treating "recency" and "historical decay" as two signals double-counts the same underlying fact (time since purchase); one decay function on recency covers both. |
| Order recency spread / decay half-life as a *tunable constant* | **DEFER** | The decay function's shape (e.g. its half-life) is a calibration parameter, not a structural decision — belongs to A01.2's kernel implementation once there is real data to sanity-check it against, not hardcoded in this design. |

## 8. Avoiding spend dominance

The risk stated explicitly by the task: one very large single purchase must not automatically outrank
genuine repeated behavior in a different category. Principles, all already implied by Section 7's
classifications:

1. **Use `spendShare` (share of the customer's own total spend), never absolute currency.** This is
   already self-normalized per customer — `PurchaseBehaviorProduct.spendShare` is exactly this field,
   reused as-is (Section 3).
2. **Apply a concave (e.g. logarithmic) transform to monetary evidence** before combining it with
   frequency/diversity/repeat signals, so doubling spend does not double the monetary contribution —
   this is what keeps a single outsized purchase from linearly overwhelming the composite.
3. **Cap the maximum evidence contribution any single order can make** to a given code — an evidence
   ceiling per order, not per dollar, so one exceptionally large order behaves like "one strong data
   point," not "N strong data points" proportional to its price.
4. **Weight frequency, diversity, and repeat-behavior at least as heavily as monetary evidence** in the
   default composite — monetary is corroborating evidence, not the primary driver.

Worked through the task's own example: a single $2M machine purchase contributes 1 order, 1 supporting
product, no repeat-purchase bonus, and a capped (not linear) monetary term — its composite stays
moderate. Multiple repeated purchases in another category accumulate frequency + diversity + a repeat
bonus + a dampened-but-nonzero monetary term across several orders — its composite ends up higher
despite far lower absolute spend. This is the intended outcome, not an edge case to special-case away.

## 9. Primary vs. secondary product family

**Decision (made explicitly, not left implicit): secondary families receive a bounded lower
contribution than primary — not equal weight.**

Rationale: `primaryProductFamily` is where the classifier places its strongest, most direct evidence.
`secondaryProductFamilies` represent genuine structural hybridity (task's example: product 2134,
primary `PLATE_LOADED_MACHINE`, secondary `CABLE_MACHINE`) — real but weaker signal. Giving secondary
families equal weight would mean a single hybrid-product purchase inflates two families exactly as if
the customer had bought two separate dedicated products, which overstates the evidence. A bounded
fractional multiplier (< 1, exact value a kernel calibration constant for A01.2, not fixed here) is
applied to a code's contribution when it comes from a fact's `secondaryProductFamilies` rather than its
`primaryProductFamily`.

## 10. `DISCIPLINE` and `USE_CONTEXT` — sparse-by-design handling

These axes are intentionally sparse in the ontology itself (8 and 6 codes respectively, and per the
prior migration's reported classification mix, only a subset of products carry any tag on these axes
at all). The rule, stated explicitly:

> **Missing `DISCIPLINE` or `USE_CONTEXT` evidence for a purchase means "no reliable product-level
> semantic evidence exists from that purchase" — never "customer has no affinity for that dimension."**

This is enforced structurally, not by convention: because rows are emitted only for
`(customerId, axis, code)` triples that have qualifying evidence ([Section 15](#15-snapshot-model)
uses **normalized rows, not wide columns with defaulted zeros**), there is no code path that could
ever emit a `0`-scored `DISCIPLINE` row for a customer who simply has no discipline evidence yet — the
row for that axis/customer combination just does not exist. A wide-column design would have forced an
explicit default value into every unclassified cell, which is exactly the "missing = negative" trap
the task warns against; the normalized-row shape avoids it by construction, and this is a second,
independent reason (beyond A03 query ergonomics) the row-per-fact model was chosen in
[Section 15](#15-snapshot-model). Sparse-axis coverage is tracked explicitly instead
([Section 17](#17-coverage-model): `disciplineCoverage`, `useContextCoverage`) so sparsity stays
visible rather than silently hidden.

## 11. `OTHER` products

`OTHER` is the residual `PRODUCT_FAMILY` outcome emitted by `catalog-service` — a real code on that
axis, not a separate status. Its ontology-side semantics belong entirely to `catalog-service` and are
out of scope here (as of A00.3.3, the ontology no longer exposes an affinity-flavored field like
`positiveAffinitySignal` on its tags — that was product-domain vocabulary and has been removed from the
tag model). **Customer-profile independently defines**, on the consumer side only, that `OTHER`
contributes no `PRODUCT_FAMILY`-specific affinity. This is a `customer-profile` scoring decision about
a residual code it receives, not a property `catalog-service` declares about the tag. Rule:

- A `ProductSemanticFact` whose `primaryProductFamily.code === 'OTHER'` (or `classificationStatus ===
  'OTHER'`) contributes **zero `PRODUCT_FAMILY`-specific affinity** — no row is emitted for it on that
  axis.
- It **does not invalidate the customer or the run.** The customer's other purchases still produce
  valid affinity rows on all axes independently; a purchase of an `OTHER` product simply contributes no
  evidence, the same as any other product with no qualifying tag on a given axis (Section 10's rule
  extends naturally to this case).
- It **is** counted in coverage denominators, distinctly from unresolved/excluded lines, so the "how
  much of this customer's purchase history could we say anything commercial about" question stays
  answerable. Coverage metrics (mirroring `CustomerIntelligencePopulationCoverage`'s
  inclusion-exclusion style in `src/domain/customer-intelligence/coverage.ts`):
  - `semanticPurchaseCoverage` — share of purchase lines with *any* resolvable, non-excluded
    `ProductSemanticFact` (includes `OTHER`; excludes `EXCLUDED_NON_PRODUCT`).
  - `semanticSpendCoverage` — same, weighted by spend rather than line count.
  - `classifiedOrderCoverage` — share of orders containing at least one line that actually
    contributed a `PRODUCT_FAMILY` row (i.e. excludes `OTHER`-only orders, unlike the two metrics
    above).

## 12. Excluded non-products

The 13 `EXCLUDED_NON_PRODUCT` rows (repairs, assembly, `Servicio vendedor`, `Costo logístico`, etc.)
contribute **zero commercial product affinity on every axis** — not just `PRODUCT_FAMILY`. They are
removed from the purchase-line population **before** evidence accumulation begins, the same stage at
which RFM already removes seller-service and operational-account lines
(`SellerServiceDiagnostics`/`PopulationExclusionDiagnostics` in `src/domain/customer-rfm/contracts.ts`)
— this design adds an analogous `excludedNonProductLineCount` / `excludedNonProductSpend` diagnostic
pair to the affinity snapshot header, mirroring that existing pattern exactly rather than inventing a
new one.

Customer-profile **never reconstructs which productIds are excluded** — it trusts
`classificationStatus === 'EXCLUDED_NON_PRODUCT'` verbatim from the consumed fact. Recreating that
policy locally would be exactly the ownership violation this whole boundary exists to prevent.

## 13. Historical / `PARTIALLY_CLASSIFIED` products

**Default hypothesis confirmed: yes, they may contribute affinity — when they carry valid evidence for
that specific axis.**

The rule ends up being uniform across `CLASSIFIED` and `PARTIALLY_CLASSIFIED` rather than needing a
special case: any fact with a non-null `primaryProductFamily` contributes to `PRODUCT_FAMILY`
regardless of overall `classificationStatus`; any fact with a non-empty `disciplines` array contributes
to `DISCIPLINE`; same for `useContexts`. "Partially classified" already means "some axes resolved,
others didn't" at the catalog-service level — Section 10's per-axis, evidence-presence rule handles
that correctly with no extra logic, it just naturally yields fewer rows on the unresolved axes.

`NEEDS_REVIEW` facts (currently `0` in the reported v3 classification mix, but not guaranteed to stay
`0`) are treated as **non-contributing**, the same as `OTHER` — a catalog-service `NEEDS_REVIEW` flag
is an explicit "we do not have a defensible answer yet," and consuming it as certain evidence in a
deterministic pipeline would reintroduce the exact classifier-instability risk the ownership boundary
was built to keep out of this repository.

## 14. Customer identity

**Canonical join/population key: `customerId` (PrestaShop `id_customer`, i.e. `prestashopCustomerId`)
— the same key `customer-analytics` and `customer-clustering` already use as their build-time
population key** (`ClusterPopulationRow.prestashopCustomerId`, `CustomerFeatureSourceRow` in
`snapshot.ts`), and the same "primary, CRM-independent" identity RFM itself exposes via
`GetCustomerRfmByCustomerIdResult` (`src/domain/customer-rfm/contracts.ts`, explicitly commented there
as "independent of CRM/master_customer").

`masterCustomerId` is **not** used as the population/build key. Per the task's explicit instruction and
matching current repo convention, it stays available only where RFM's existing dual-lookup pattern
already carries it (`CurrentPrestashopCustomerRfmRecord.masterCustomerId: string | null`) — an optional
resolved reference on a row, never a requirement to build one. This keeps the affinity snapshot
buildable directly against `prestashop_customer_id`/`ps_orders`, with no dependency on identity
resolution having run first — the same independence RFM and clustering already have today.

## 15. Snapshot model

Mirrors the existing RFM/clustering snapshot shape (`RfmSnapshotManifest`, `ClusterSnapshotManifest`)
exactly, adapted for normalized affinity rows instead of one-row-per-customer wide facts.

```ts
export type CustomerCommercialAffinitySnapshotStatus =
  | 'building' | 'validated' | 'published' | 'failed' | 'superseded'; // same lifecycle as RfmSnapshotStatus

export type CustomerCommercialAffinitySnapshotHeader = {
  readonly snapshotId: string | null;         // DB-assigned; null pre-persist, mirrors RfmSnapshotManifest.snapshotId
  readonly snapshotKey: string;                // [calculationVersion, ontologyHash, populationPolicyVersion, referenceTime].join('__')
  readonly status: CustomerCommercialAffinitySnapshotStatus;
  readonly referenceTime: string;
  readonly generatedAt: string;
  readonly calculationVersion: string;
  readonly identityAuthority: 'prestashop_customer';   // mirrors RfmSnapshotManifest.identityAuthority
  readonly populationPolicyVersion: string;
  readonly productSemanticSnapshotId: string;   // exact shape pending catalog-service's A00.5 design
  readonly productSemanticSnapshotVersion: string;
  readonly ontologyVersion: string;             // e.g. "commercial-product-ontology-v3"
  readonly ontologyHash: string;
  readonly populationSize: number;
  readonly datasetChecksum: string;             // over raw purchase input + consumed semantic facts
  readonly affinityDatasetChecksum: string;      // over the derived, canonical rows — mirrors clustering's dual-checksum split
  readonly excludedNonProductLineCount: number;  // mirrors RfmSnapshotDiagnostics-style exclusion accounting
  readonly excludedNonProductSpend: string;
  readonly coverage: CustomerCommercialAffinityCoverage; // Section 17
};

export type CustomerCommercialAffinityAxis = 'PRODUCT_FAMILY' | 'DISCIPLINE' | 'USE_CONTEXT';

export type CustomerCommercialAffinityRow = {
  readonly customerId: number;                  // prestashopCustomerId, Section 14
  readonly affinityAxis: CustomerCommercialAffinityAxis;
  readonly affinityCode: string;                 // e.g. "BENCH" — not enumerated here; owned by the ontology, not duplicated
  readonly score: number;                        // bounded [0,1], Section 6 — fixed precision per calculationVersion
  readonly supportingOrderCount: number;
  readonly supportingProductCount: number;       // distinct productIds contributing
  readonly supportingSpend: string;               // decimal string, same convention as totalSpentTaxIncl
  readonly lastEvidenceAt: string;
  readonly evidenceCoverage: number;              // share of this row's evidence mass from EXPLICIT-confidence facts, [0,1]; 1.0 if the consumed snapshot carries no confidence field at all (Section 2)
};
```

Row example (illustrative shape only, not a scoring model — same caveat as the task prompt's example):

```
customerId | axis           | code       | score | supportingOrderCount | ...
123        | PRODUCT_FAMILY | BENCH      | 0.72  | 4                     | ...
123        | USE_CONTEXT    | HOME_GYM   | 0.81  | 9                     | ...
```

No row exists for a `(customerId, axis, code)` with no qualifying evidence — the absence *is* the
"unknown," per Sections 10 and 11.

## 16. Version lineage

The header carries `productSemanticSnapshotId` + `productSemanticSnapshotVersion` +
`ontologyVersion` + `ontologyHash` + `calculationVersion` together. A change in **any** of these forces
a new `snapshotKey`, hence a new immutable snapshot — the same "one key, one immutable snapshot,
supersede don't mutate" discipline `mysql-rfm-snapshot-repository.ts` already implements for RFM
(`findPublishedSnapshot` / `publishSnapshot` with checksum verification and explicit `'superseded'`
status transition).

Concretely: when the catalog ontology moves `v3 → v4`, customer-profile does not need to re-derive or
re-interpret anything about what `v3` meant. It simply builds a new affinity snapshot against the new
`productSemanticSnapshotId`; every prior affinity snapshot remains queryable, immutable, and traceable
to the exact `ontologyVersion`/`ontologyHash` it was computed from — full reproducibility "for free"
from a pattern this repository already runs in production for RFM and clustering, not a new mechanism.

## 17. Coverage model

```ts
export type CustomerCommercialAffinityCoverage = {
  readonly customersEvaluated: number;
  readonly customersWithAffinity: number;        // >= 1 row on any axis
  readonly purchaseLinesEvaluated: number;
  readonly purchaseLinesWithSemanticProduct: number; // resolvable, non-EXCLUDED_NON_PRODUCT fact
  readonly semanticPurchaseCoverage: number;      // pct, Section 11
  readonly semanticSpendCoverage: number;         // pct, Section 11
  readonly classifiedOrderCoverage: number;       // pct, Section 11
  readonly productFamilyCoverage: number;         // pct of customersEvaluated with >= 1 PRODUCT_FAMILY row
  readonly disciplineCoverage: number;             // expected low — must not be hidden or defaulted away
  readonly useContextCoverage: number;
};
```

Computed with the same inclusion-exclusion validation and 2-decimal percentage rounding as
`computeCoverageSummary` in `src/domain/customer-intelligence/coverage.ts` — that function's invariants
(matched counts non-negative, matched ≤ population, `bothMatched` ≤ each individual matched count)
apply directly to the per-axis coverage counts here, and the eventual A01 coverage function should be
written to the same shape, not a new convention.

## 18. Provenance / explainability

To answer "why does customer 123 have `HOME_GYM` affinity?" without exposing classifier internals or
storing unbounded evidence in every row, provenance is a **separate, bounded sidecar**, not embedded in
`CustomerCommercialAffinityRow`:

```ts
export type CustomerCommercialAffinityEvidenceItem = {
  readonly productId: number;
  readonly orderId: number | null;               // when line-level linkage is available (Section 3)
  readonly purchasedAt: string;
  readonly spendContribution: string;
  readonly quantityContribution: number;
  readonly consumedTag: { readonly axis: CustomerCommercialAffinityAxis; readonly code: string; readonly confidence?: ProductSemanticFactConfidence };
};

export type CustomerCommercialAffinityEvidence = {
  readonly customerId: number;
  readonly affinityAxis: CustomerCommercialAffinityAxis;
  readonly affinityCode: string;
  readonly items: readonly CustomerCommercialAffinityEvidenceItem[]; // bounded, e.g. top-N by contribution
};
```

Bounded explicitly (a fixed top-N by contribution, e.g. capped similarly to how
`GetPurchasedProductsInput` already paginates with `limit`/`offset` rather than returning unbounded
lists) and fetched on demand for a specific `(customerId, axis, code)` — never joined into the bulk
snapshot row read. No raw product names, descriptions, or classifier evidence strings appear anywhere
in this sidecar — only `productId`s, dates, and the consumed tag code/confidence, consistent with
Section 2's exclusion of classifier internals.

## 19. Determinism

Same customer purchase input + same Product Semantic Snapshot + same `calculationVersion` → same
output, always. No LLM anywhere in the calculation. No probabilistic or trained model in v1 — every
transform (decay curve, monetary dampening, primary/secondary weighting, confidence discount) is a
fixed, versioned pure function. Any change to a formula requires a `calculationVersion` bump, the same
discipline `featureVersion`/`modelVersion`/`scoringPolicyVersion` already enforce for analytics,
clustering, and RFM respectively. Idempotency follows the same pattern already implemented in
`mysql-rfm-snapshot-repository.ts`: re-running the same key must reproduce the same
`affinityDatasetChecksum`, verified before a publish is accepted.

## 20. Future `A02` compatibility

Because rows are normalized `(customerId, axis, code, score)` facts with a stable snapshot reference,
A02 can compose them exactly the way `src/domain/customer-intelligence/contracts.ts` already composes
RFM and cluster today — `CustomerIntelligenceRow` currently carries `rfm: CustomerIntelligenceRfm |
null` and `cluster: CustomerIntelligenceCluster | null`, each referencing its own snapshot via a
`*SnapshotRef` type (`CustomerIntelligenceRfmSnapshotRef`, `CustomerIntelligenceClusterSnapshotRef`).
A02 would add, following the identical convention:

```ts
type CustomerIntelligenceAffinitySnapshotRef = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly calculationVersion: string;
  readonly productSemanticSnapshotVersion: string;
};

// on CustomerIntelligenceRow:
readonly affinity: {
  readonly snapshot: CustomerIntelligenceAffinitySnapshotRef;
  readonly rows: readonly CustomerCommercialAffinityRow[]; // this customer's rows only
} | null;
```

`null` when no compatible affinity snapshot was resolved or the customer has no rows — the same
nullable-when-unmatched convention `rfm`/`cluster` already use, never a partial-result error. This is
not implemented now; it is designed so A02 is additive to `CustomerIntelligenceRow`, not a redesign.

## 21. `A03` audience-engine compatibility

Normalized rows support `WHERE affinityAxis = 'PRODUCT_FAMILY' AND affinityCode = 'BENCH' AND score >=
X` directly as a relational predicate over the rows table — the direct payoff of the
[Section 6](#6-score-semantics) decision to keep scores per-code and non-softmax: thresholds are stable
and comparable across the whole customer population, not just within one customer's own distribution.
This mirrors how RFM segment codes and cluster assignments already support predicate queries today (no
new query pattern introduced). Not implemented now.

## 22. Storage recommendation (logical only — no schema/migration in this slice)

Two logical tables, mirroring the `customer_rfm_snapshot` / row-table split already running in
`src/infrastructure/rfm/mysql-rfm-snapshot-repository.ts`:

- **`customer_commercial_affinity_snapshot`** — header, one row per snapshot, `status` lifecycle
  identical to RFM's, checksums, full version lineage (Section 16).
- **`customer_commercial_affinity_score`** — rows, `snapshotId` FK, indexed on
  `(snapshotId, customerId)` for per-customer reads and `(snapshotId, affinityAxis, affinityCode,
  score)` for the A03-style predicate queries in Section 21.
- **`customer_commercial_affinity_evidence`** (optional, later) — the bounded sidecar from Section 18,
  keyed by `(snapshotId, customerId, affinityAxis, affinityCode)`, row-capped per key.

No PrestaShop write, ever. No schema/migration file is added in this slice — this is a logical
recommendation for A01.5 to implement against, chosen for consistency with the transactional
publish/checksum-verify/supersede pattern this repository already runs in production, not a new
storage paradigm.

## 23. What can be implemented now

| Component | Classification | Why |
| --- | --- | --- |
| `ProductSemanticFact` consumer contract (Section 2) | **IMPLEMENT_NOW** | Pure type, structurally independent of catalog-service; no live data needed. |
| Affinity domain types (`CustomerCommercialAffinityRow`/`Header`/`Coverage`, axis literal) | **IMPLEMENT_NOW** | Pure types. |
| Score bounds/invariants (`0 <= score <= 1` guards) | **IMPLEMENT_NOW** | Pure validation logic. |
| Deterministic scoring primitives (decay, monetary dampening, primary/secondary weighting) | **IMPLEMENT_NOW, against synthetic fixtures** | Pure functions, unit-testable with fabricated `PurchaseBehaviorProduct` + `ProductSemanticFact` fixtures — exactly how A01.2 should be built and tested before any real catalog data exists. |
| Coverage computation function (Section 17) | **IMPLEMENT_NOW** | Pure math, mirrors `computeCoverageSummary`, testable with synthetic counts. |
| `snapshotKey` builder + `calculationVersion` constant | **IMPLEMENT_NOW** | Pure, mirrors `buildClusterSnapshotKey`/`buildCustomerFeatureSnapshotKey`. |
| Product Semantic Snapshot consumer **interface/port shape** | **DESIGN_ONLY** | The port shape can be sketched, but its final adapter depends on A00.5's actual published artifact shape. |
| DB schema/migrations for the affinity tables | **DESIGN_ONLY** | Logical design done (Section 22); no migration authored yet. |
| Evidence sidecar concrete contract | **DESIGN_ONLY** | Shape sketched (Section 18); not needed until A01.4+. |
| Real population builder run | **BLOCKED_BY_A00_5** | Needs actual catalog-service Product Semantic Snapshot data to join against. |
| Real semantic join against live purchase data | **BLOCKED_BY_A00_5** | Same reason. |
| Publishing any real affinity snapshot | **BLOCKED_BY_A00_5** | Same reason. |
| Any integration/network call to catalog-service | **BLOCKED_BY_A00_5** (and out of scope for A01 generally per Section 24) | No cross-repo runtime coupling in this slice, and the target artifact shape doesn't exist yet. |

## 24. Architecture options for consuming the future Product Semantic Snapshot

| Option | Verdict | Why |
| --- | --- | --- |
| A. HTTP API per product | **REJECT** | N+1-style calls across a full customer × product population for a scheduled batch job is operationally heavy and introduces live runtime coupling at population-build time — exactly what this slice is told to avoid. |
| B. Batch API (bulk paginated endpoint) | **REJECT for this use case** | Better than A, but still requires catalog-service to be live and reachable at build time, plus this repository would own pagination/retry/versioning logic for a live dependency rather than reading a static, checksummed artifact. |
| C. Immutable snapshot artifact (versioned, checksummed) | **RECOMMENDED** | See below. |
| D. DB-backed read model replicated locally (reading catalog-service's DB or a replica) | **REJECT** | Couples customer-profile to catalog-service's internal schema — the exact ownership violation the whole cleanup preceding this task was designed to eliminate structurally. |
| E. Existing internal pattern | **This is what C already is** | Customer-profile already runs exactly this shape today for RFM and clustering: a versioned, checksummed, immutable snapshot (header + rows), published via a repository, consumed by dedicated readers — never a live per-row API call at read time. |

**Recommendation: C, in the shape of E.** Scored against the task's criteria:

- **Batch analytics efficiency** — one bulk read per snapshot build, no per-row network calls.
- **Reproducibility** — versioned + checksummed, directly satisfies [Section 19](#19-determinism).
- **Service coupling** — decoupled at query time; catalog-service does not need to be "up" when
  customer-profile reads an already-published artifact, only when that artifact was produced.
- **Snapshot versioning** — `productSemanticSnapshotId`/`Version` travel with the affinity header
  natively (Section 16); this is the same versioning discipline already proven in production.
- **Operational complexity** — matches this repository's existing operational model exactly (MySQL-
  backed snapshot tables, `tsx` scripts, no new infrastructure category introduced).
- **EC2 environment** — consistent with how `scripts/snapshots/*` and `scripts/clustering/*` already
  run today.
- **Customer population size** — batch-friendly regardless of population size, unlike per-product HTTP.
- **Future scheduled recomputation** — a natural fit for a cron/script-triggered rebuild, exactly like
  `npm run snapshot:rfm:scheduled` already does.

The precise transport of the artifact (shared MySQL table catalog-service publishes into vs. an
exported file consumed by a reader) is intentionally left for A01.3/A00.5 to settle jointly — the
category decision (immutable snapshot, not a live API, not a shared-schema DB read) is the call this
design makes now.

## 25. Implementation plan

| Slice | Scope | Classification |
| --- | --- | --- |
| **A01.1** Affinity Domain Contracts | `ProductSemanticFact`, `CustomerCommercialAffinityRow`/`Header`/`Coverage` types, axis literals, `snapshotKey` builder, `calculationVersion` constant | IMPLEMENT_NOW |
| **A01.2** Deterministic Affinity Scoring Kernel | Pure scoring functions (decay, monetary dampening, primary/secondary weighting, optional confidence discount applied only when present, per-code accumulation), unit-tested against synthetic fixtures — including fixtures with no `confidence` field, to prove the kernel never requires it | IMPLEMENT_NOW |
| **A01.3** Product Semantic Snapshot Consumer | Reader port/interface now (DESIGN_ONLY); concrete adapter once A00.5 ships its artifact shape | DESIGN_ONLY → BLOCKED_BY_A00_5 for the adapter |
| **A01.4** Affinity Population Builder | Joins real `PurchaseBehaviorProduct` population against the real Product Semantic Snapshot, runs A01.2's kernel at scale, produces rows + coverage + manifest | BLOCKED_BY_A00_5 |
| **A01.5** DB-backed Affinity Snapshot | Header/rows tables + repository, mirroring `mysql-rfm-snapshot-repository.ts`'s transactional publish/checksum-verify/supersede pattern | Schema/repository against synthetic data: IMPLEMENT_NOW-able; real publish: BLOCKED_BY_A00_5 |
| **A01.6** Read Model / API | Customer-facing read (mirrors `GetCustomerRfmByCustomerIdResult`'s shape) + the `CustomerIntelligenceRow` composition point from Section 20 | Contract: DESIGN_ONLY now; real data: BLOCKED_BY_A00_5 |

This is proposed, not fixed — if A00.5's eventual shape suggests a better split (e.g. merging A01.3
into A01.4), that should be revisited when A00.5 actually ships, not forced to match this list.

## 26. Do not do (restated as this design's own guardrails)

This slice adds no runtime code, so none of these were at risk here — restated because every
subsequent A01.x slice inherits them unchanged: do not classify products; do not copy ontology code
from catalog-service; do not add product semantic regexes; do not query catalog-service per purchase
line; do not implement the Product Semantic Snapshot itself (that is catalog-service's A00.5); do not
implement A02 or A03; do not modify RFM, clustering, Copilot, or the dashboard; no LLM in the
calculation; never write to PrestaShop.

## 27. Validation

No code or contracts were added in this slice (see Section 0's method and Section 23's classification
of this slice as design-only). Every existing contract cited above was read directly from current
repository files, not assumed — file paths are given inline throughout. `npm run typecheck` and
`npm test` were re-run after writing this document to confirm the repository is unaffected: both remain
green at the same counts as before this slice (see the final report).
