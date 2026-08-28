# Customer-Profile Architecture Separation Audit

Status: **Audit complete — no files deleted or modified.**
Type: read-only audit. Confirms whether `customer-profile` still needs to own product
ontology/classification logic after CUSTOMER-INTELLIGENCE-R2-A00.3.2 (ownership migration to
`catalog-service`), and separates the customer domain's forward roadmap from that migration.

## 0. Method

Every finding below is grounded in an actual search or file read against the current repo state, not
assumed from memory:

- Full-repo `grep` for `commercial-product-ontology` / `product-semantic-classification` across
  `src/`, `scripts/`, `tests/`.
- A second, independent `grep` for the specific exported identifiers a caller would actually use
  (`getCommercialProductOntologyRegistry`, `classifyProduct`, `computeClassificationChecksum`,
  `ProductSemanticClassificationResult`, `registryHash`, `ontologyVersion`, etc.) — in case something
  imported these without the module path appearing literally in the same file.
- Direct inspection of `src/index.ts`'s import chain (the actual server entry point) — no CI/CD
  workflow files or Dockerfile exist in this repo to check separately.
- Full listing of every `src/domain/*`, `src/application/*`, `src/infrastructure/*` directory.
- Direct reads of the two purchase-facing contract files most relevant to a future A01.
- `npm run typecheck` and the full `vitest` suite (196 files / 1889 tests), as a baseline — confirming
  the audit itself introduced zero changes.

## 1. Duplicated product-domain code

| Path | Classification | Reason |
| --- | --- | --- |
| `src/domain/commercial-product-ontology/` (11 files) | `DUPLICATE_RUNTIME_TO_DELETE` | Byte-for-byte migrated to `catalog-service` in A00.3.2 (only `hash.ts`'s import of the shared checksum helper differs at the destination). Registry hash verified identical (`cbf363d3...` for v2, `df58006b...` for v1) between both copies. |
| `src/domain/product-semantic-classification/` (10 files) | `DUPLICATE_RUNTIME_TO_DELETE` | Same migration; full-catalog classification checksum (`f1a4ffb8...`) verified identical between both copies. |
| `scripts/product-semantic-classification/` (3 CLI entrypoints + `lib/{csv,load-input,summary}.ts` + gitignored `outputs/`) | `DUPLICATE_RUNTIME_TO_DELETE` | Migrated unchanged; `catalog-service` now has its own `npm run product:semantic:classify` / `product:semantic:v2-migration-audit`. |
| `tests/unit/commercial-product-ontology-registry.test.ts` | `DUPLICATE_RUNTIME_TO_DELETE` | Tests the duplicated registry; an identical copy runs in `catalog-service` (95 tests, all passing there). |
| `tests/unit/product-semantic-classification-{classifier,discipline,use-context,product-family,golden-set-regression,v2-non-product-policy}.test.ts` (6 files) | `DUPLICATE_RUNTIME_TO_DELETE` | Tests the duplicated classifier; identical copies run in `catalog-service` (129 tests, all passing there). |
| `docs/releases/CUSTOMER-INTELLIGENCE-R2-A00.2-commercial-product-ontology-registry.md` | `DUPLICATE_RUNTIME_TO_DELETE` (documentation) | Describes runtime that no longer lives here; an identical copy was carried to `catalog-service/docs/releases/` during A00.3.2. |
| `docs/releases/CUSTOMER-INTELLIGENCE-R2-A00.3-product-semantic-classification-pipeline.md` | `DUPLICATE_RUNTIME_TO_DELETE` (documentation) | Same reasoning. |
| `docs/releases/CUSTOMER-INTELLIGENCE-R2-A00.3.1-non-product-universe-policy-correction.md` | `DUPLICATE_RUNTIME_TO_DELETE` (documentation) | Same reasoning. |

No `SHARED_CONTRACT` or `UNKNOWN` findings in this list — every file in it is either wholly duplicated
runtime code, its tests, or a release doc describing that runtime, with a confirmed live counterpart in
`catalog-service`.

**Adjacent observation, out of this audit's explicit scope but worth flagging:**
`scripts/audits/product-intelligence-exploration/export-product-catalog.ts` (+ `lib/model.ts`) is the
PrestaShop product-data *extraction* tool that originally produced A00's dataset. It contains no
ontology/classification logic and was not part of the A00.3.2 migration, so it is not a duplicate today.
But it is a PrestaShop **product** reader, and `catalog-service` is the correct long-term owner of
reading PrestaShop product data too — this is a separate, future decision, not a duplication finding.

## 2. Hidden dependency search

| Search target | Result | Classification |
| --- | --- | --- |
| `commercial-product-ontology` / `product-semantic-classification` (path or comment) anywhere in `src/` | 10 matches, all inside the two module directories themselves | `NO_DEPENDENCY` (self-references only) |
| Same search in `scripts/` | 8 matches, all inside `scripts/product-semantic-classification/` (including its own gitignored output artifacts) | `NO_DEPENDENCY` |
| Same search in `tests/` | 7 matches — exactly the 7 test files that test these two modules | `TEST_ONLY` |
| Exported identifiers (`getCommercialProductOntologyRegistry`, `classifyProduct`, `computeClassificationChecksum`, `ProductSemanticClassificationResult`, `primaryProductFamily`, `secondaryProductFamilies`, `registryHash`, `ontologyVersion`, `CommercialProductOntologyRegistry`, ...) anywhere in `src/` | Same 10 files as above — no additional call sites | `NO_DEPENDENCY` |
| `src/index.ts` → `app.ts` / `bootstrap.ts` / `config.ts` / `observability/log-shutdown-failure.ts` entry chain | Zero references | `NO_DEPENDENCY` |
| CI/CD workflow files, Dockerfile | None exist in this repo | N/A — nothing to check |
| Every other domain (`customer-analytics`, `customer-clustering`, `customer-commercial-summary`, `customer-identity`, `customer-intelligence*`, `customer-order-status`, `customer-orders`, `customer-profile`, `customer-purchase-behavior`, `customer-purchased-products`, `customer-rfm`, `identity-resolution`, `master-customer-population`, `order-classification`) | Zero references to either module, in either direction | `NO_DEPENDENCY` |

**No `RUNTIME_DEPENDENCY` and no `BLOCKER` was found anywhere.** Every reference to these two modules
in the entire repository is either the modules' own internal files or a test that exercises them
directly. Nothing in `customer-profile`'s actual runtime (the Fastify-style app boot chain, or any
other domain) imports, calls, or otherwise depends on `commercial-product-ontology` or
`product-semantic-classification` today.

## 3. Customer domain boundary — validated

Everything `customer-profile` currently owns is scoped correctly and contains zero product-semantic
logic (confirmed by the same search in Section 2 turning up nothing in these directories):

| Present today | Domain dirs |
| --- | --- |
| RFM | `customer-rfm` (domain + application + infra) |
| Behavioral clustering | `customer-clustering` (application + infra) |
| Customer analytics feature snapshots | `customer-analytics` (domain + application + infra) |
| Customer intelligence read model | `customer-intelligence`, `customer-intelligence-query` |
| Analytical query runtime | `customer-intelligence-query` (application + infra) |
| Copilot | `customer-intelligence-copilot`, `customer-intelligence-copilot-session` |
| Dashboard | `customer-intelligence-dashboard` |
| (not explicitly listed, but present and in-boundary) | `customer-intelligence-intersection`, `customer-commercial-summary`, `customer-purchase-behavior`, `customer-purchased-products`, `customer-identity`, `identity-resolution`, `master-customer-population`, `customer-orders`, `customer-order-status`, `order-classification` |

Future customer-commercial affinity, customer-commercial profile, audience engine, and customer
explorer have no code yet — nothing to audit there today, only the contract they'll need (Section 6).

Confirmed **NOT** owned here (matches the task's exclusion list exactly, and matches Section 1's
findings): product family rules, category/feature trust interpretation, product semantic regexes, the
product semantic registry, the product classifier, and non-product catalog-service filtering — all of
which are precisely `commercial-product-ontology`/`product-semantic-classification`, i.e. the two
directories already migrated out.

Two existing contracts are directly relevant to the future affinity boundary and already model it
correctly — worth calling out because they show the boundary was *already* being respected before this
audit, not just in the two migrated modules:

- `src/domain/customer-purchased-products/contracts.ts` — `PurchasedProduct` carries `productId`,
  `productName`, `productReference`, purchase stats, and `catalogStatus: 'linked' | 'deleted_or_unavailable'`.
  No family/discipline/context field anywhere — it does not attempt to interpret what was bought.
- `src/domain/customer-purchase-behavior/contracts.ts` — `PurchaseBehaviorProduct`/`PurchaseBehaviorVariant`
  aggregate spend/order/quantity share **by `productId`**, again with zero semantic interpretation.

Both are exactly the shape a future A01 would join against catalog-service's per-`productId` semantic
facts — this is the customer-side half of that join, and it already exists.

## 4. Historical audit material — keep in customer-profile

These document *why* the ontology exists and *how* it was discovered/validated — origin story and
methodology, not runtime — and should remain regardless of where the runtime now lives:

| Path | Why it stays |
| --- | --- |
| `docs/audits/CUSTOMER-INTELLIGENCE-R2-A00-product-dataset-exploration.md` | Documents why commercial affinity/product semantics was needed in the first place and how the raw PrestaShop export was scoped. |
| `docs/audits/CUSTOMER-INTELLIGENCE-R2-A00.1-commercial-product-ontology-discovery.md` | The original 62-tag/6-family ontology discovery pass — the origin of the ontology, before simplification. |
| `docs/audits/CUSTOMER-INTELLIGENCE-R2-A00.1B-golden-set-simplified-ontology-review.md` | Golden-set methodology: how the 200-product review was built, the rule-engine approach, and the false-positive findings (free-text description, `LEGACY` categories) that shaped the final evidence policy. |
| `docs/audits/CUSTOMER-INTELLIGENCE-R2-A00.1C-ontology-review-closure.md` | The human-style spot-audit and full-catalog validation that closed the ontology design and produced the `SIMPLIFIED_ONTOLOGY_READY` decision — the direct precursor to the registry now living in `catalog-service`. |
| `docs/audits/product-intelligence-exploration/inputs/*` (category/feature trust maps, the 2011-product export, the golden-set CSV, `products.xlsx`, raw JSON, sample CSV) | The actual source dataset every A00.1/A00.1B/A00.1C finding is computed from — cited by file name throughout those reports. |
| `docs/audits/product-intelligence-exploration/outputs/product-intelligence-ontology-review/*` (`ontology_registry_candidate_v1.json`, `ontology_golden_set_reviewed.csv`, `ontology_review_issues.csv`, `ontology_full_catalog_tag_counts.csv`, `ontology_review_closure.csv`) | The literal required-output artifacts of A00.1B/A00.1C, referenced by name in those reports' "Required Output Files" sections. |

None of this is runtime and none of it duplicates anything in `catalog-service` (which received only
the *later* release docs — A00.2/A00.3/A00.3.1 — and the raw fixture CSVs it needed to run its own
copy of the migrated tests, not these audit narratives).

## 5. Delete readiness — exact candidate list

Every path below was verified to have **zero** live dependents (Section 2) and a **verified-identical**
counterpart already running in `catalog-service` (registry hash, classification checksum, and
golden-set regression all matched exactly during A00.3.2). `safeToDeleteAfterCatalogValidation` records
whether that verification already happened — it does not mean "delete now": this task explicitly asked
for a candidate list, not deletion, and the decision to actually delete is a separate, later step.

| Path | Classification | Reason | safeToDeleteAfterCatalogValidation |
| --- | --- | --- | --- |
| `src/domain/commercial-product-ontology/` | `DUPLICATE_RUNTIME_TO_DELETE` | Verified-identical copy in `catalog-service`; zero dependents here | **true** (already validated in A00.3.2) |
| `src/domain/product-semantic-classification/` | `DUPLICATE_RUNTIME_TO_DELETE` | Same | **true** |
| `scripts/product-semantic-classification/` | `DUPLICATE_RUNTIME_TO_DELETE` | Same; its gitignored `outputs/` never held anything but regenerable artifacts | **true** |
| `tests/unit/commercial-product-ontology-registry.test.ts` | `DUPLICATE_RUNTIME_TO_DELETE` | Duplicate of a test now passing in `catalog-service` | **true** |
| `tests/unit/product-semantic-classification-classifier.test.ts` | `DUPLICATE_RUNTIME_TO_DELETE` | Same | **true** |
| `tests/unit/product-semantic-classification-discipline.test.ts` | `DUPLICATE_RUNTIME_TO_DELETE` | Same | **true** |
| `tests/unit/product-semantic-classification-use-context.test.ts` | `DUPLICATE_RUNTIME_TO_DELETE` | Same | **true** |
| `tests/unit/product-semantic-classification-product-family.test.ts` | `DUPLICATE_RUNTIME_TO_DELETE` | Same | **true** |
| `tests/unit/product-semantic-classification-golden-set-regression.test.ts` | `DUPLICATE_RUNTIME_TO_DELETE` | Same; also depends on the input fixtures in Section 4, which must stay regardless | **true** |
| `tests/unit/product-semantic-classification-v2-non-product-policy.test.ts` | `DUPLICATE_RUNTIME_TO_DELETE` | Same | **true** |
| `docs/releases/CUSTOMER-INTELLIGENCE-R2-A00.2-commercial-product-ontology-registry.md` | `DUPLICATE_RUNTIME_TO_DELETE` | Full duplicate now in `catalog-service/docs/releases/` | **conditional — see note** |
| `docs/releases/CUSTOMER-INTELLIGENCE-R2-A00.3-product-semantic-classification-pipeline.md` | `DUPLICATE_RUNTIME_TO_DELETE` | Same | **conditional — see note** |
| `docs/releases/CUSTOMER-INTELLIGENCE-R2-A00.3.1-non-product-universe-policy-correction.md` | `DUPLICATE_RUNTIME_TO_DELETE` | Same | **conditional — see note** |

**Note on the three release docs**: unlike the code and tests, deleting these three with nothing left
behind would erase a future reader's ability to discover, from inside `customer-profile`, that this
capability ever lived here and where it went. Recommend that whenever these are actually removed, they
are replaced with a short pointer stub (2-3 lines: "this moved to `catalog-service` in A00.3.2, see
[link]") rather than a bare deletion — that is a documentation-quality recommendation, not a blocker to
deletion readiness.

**Nothing in this table is `CUSTOMER_DOMAIN_DEPENDENCY` or `SHARED_CONTRACT`.** No customer-domain code
anywhere reaches into either module (Section 2), and no other module imports a type or contract from
them that would need to be re-homed first.

## 6. Future catalog-service contract — what customer-profile should consume

`customer-profile` should consume **semantic facts**, never classification logic. The minimum shape A01
needs, derived directly from `catalog-service`'s already-migrated
`ProductSemanticClassificationResult` (only the fields a *consumer* needs — not `ruleId`/`evidence`
internals used for the classifier's own explainability):

```ts
type ProductSemanticFact = {
  readonly productId: string;
  readonly ontologyVersion: string;   // e.g. "commercial-product-ontology-v2"
  readonly ontologyHash: string;      // e.g. "cbf363d3..." — pins exactly which registry produced this
  readonly classificationStatus: 'CLASSIFIED' | 'PARTIALLY_CLASSIFIED' | 'OTHER' | 'EXCLUDED_NON_PRODUCT' | 'NEEDS_REVIEW';
  readonly primaryProductFamily: { readonly code: string; readonly confidence: 'EXPLICIT' | 'STRONGLY_INFERRED' } | null;
  readonly secondaryProductFamilies: readonly { readonly code: string; readonly confidence: 'EXPLICIT' | 'STRONGLY_INFERRED' }[];
  readonly disciplines: readonly { readonly code: string; readonly confidence: 'EXPLICIT' | 'STRONGLY_INFERRED' }[];
  readonly useContexts: readonly { readonly code: string; readonly confidence: 'EXPLICIT' | 'STRONGLY_INFERRED' }[];
};
```

Why each field earns its place in a *consumer* contract (not just an implementation detail):

- **`classificationStatus` is not optional.** A01 must be able to skip `EXCLUDED_NON_PRODUCT` rows
  entirely (they are not commercial signal at all) and treat `OTHER` differently from a real family
  (no positive affinity signal — this mirrors the registry's own `positiveAffinitySignal: false` on the
  `OTHER` tag). Without this field, affinity code would have to *infer* exclusion from an absent family,
  which silently reintroduces classification-adjacent logic on the consumer side.
- **`ontologyVersion`/`ontologyHash` travel with every fact**, not just with a snapshot header, so a
  future affinity score can always be traced to the exact registry that produced its inputs — the same
  discipline `computeCommercialProductOntologyRegistryHash` already established for the registry
  itself.
- **Confidence stays per-tag**, never collapsed into a single number. This is a direct carry-over of
  A00.3's own decision not to reintroduce a combined `semanticRelevance` score — affinity scoring is a
  *different* number, computed downstream from purchase behavior, and must not be confused with
  classification confidence.
- **`evidence`/`ruleId` are deliberately left out of the consumer contract.** They are the classifier's
  explainability mechanism for *auditing the classifier*, not inputs an affinity calculation needs. If a
  future need for full provenance emerges (e.g. "explain this affinity score down to the product name
  match"), it should be fetched on demand from `catalog-service` by `productId`, not baked into every
  fact record `customer-profile` stores.

This is a contract to **design**, not implement, in this slice — no HTTP client, snapshot reader, or
persistence for it should be built yet.

## 7. What can advance now vs. what's blocked

| Slice | Status | Why |
| --- | --- | --- |
| A01 Customer Commercial Affinity — **contract design** (Section 8) | `CAN_ADVANCE_NOW` | Pure domain-contract work; needs no live product data. |
| A01 Customer Commercial Affinity — **actual affinity computation** | `BLOCKED_BY_PRODUCT_SEMANTICS` | Needs a real product-semantic snapshot/feed from `catalog-service` (A00.4 acceptance + A00.5 publication haven't happened yet). |
| A02 Customer Commercial Profile | `SHOULD_WAIT` | Its natural inputs are A01's affinity output plus existing RFM/clustering data. Its *contract shape* could be sketched once A01's contract is settled, but starting real design now risks coupling to an unstable upstream shape. |
| A03 Audience Engine | `SHOULD_WAIT` | Depends on A02. Two layers removed from anything available today. |
| A04 Customer Explorer | `SHOULD_WAIT` | Likely a read/query surface spanning RFM + clustering + (eventually) affinity. The RFM/clustering portions could start now, but scoping it fully before A01/A02 land risks designing around a fact shape that doesn't exist yet. |
| T07 richer Copilot memory/context | `CAN_ADVANCE_NOW` | `customer-intelligence-copilot`/`customer-intelligence-copilot-session` (session store, session context, UI context, xlsx export) are pure conversational-state infrastructure — confirmed to contain zero product-semantic references (Section 2's search covered these directories too). Genuinely independent of catalog-service's timeline. |

## 8. A01 preparation — safe to design now

The following can be designed as domain contracts today, entirely against `customer-profile`'s own
existing purchase data (Section 3) plus the *shape* in Section 6 — never against the local classifier:

- **Affinity domain contract**: what an "affinity fact" looks like per customer × product-family (or ×
  discipline, × use-context) — likely `{ customerId, axis, code, affinityScore, evidenceBasis }`.
- **Affinity score semantics**: a documented, bounded definition (e.g. a 0-1 normalized weight derived
  from spend/order share within a family) — explicitly *not* the classifier's `confidence`, per Section 6.
- **Product semantic input contract**: exactly the `ProductSemanticFact` shape in Section 6 — the join
  key (`productId`) and fields A01 is allowed to read.
- **Customer purchase aggregation contract**: already exists (`PurchasedProduct`,
  `PurchaseBehaviorProduct`/`Variant` — Section 3) and needs no new design, only a join plan against
  `ProductSemanticFact.productId`.
- **Snapshot/versioning shape**: how an affinity snapshot records which `ontologyVersion`/`ontologyHash`
  and which purchase-data cutoff it was computed from — mirroring the versioning discipline already
  established by the registry and the classification checksum.
- **Confidence vs. affinity-score distinction**: documented explicitly (Section 6) so it isn't
  re-litigated once real data arrives.
- **Historical product handling**: `catalog-service` will report `historical_order_detail_only` rows
  as `PARTIALLY_CLASSIFIED` or `OTHER` per the historical policy already encoded in the registry; A01's
  design should decide up front whether a historical purchase still contributes affinity weight even
  when the product's family is `OTHER`/unknown (recommendation: it should not contribute
  *family-specific* affinity, since `OTHER` carries no positive signal — same principle as
  `positiveAffinitySignal: false` on the registry's own `OTHER` tag).
- **Weighting principles**: recency, spend share, repeat-purchase rate — all already computable today
  from `PurchaseBehaviorProduct` without touching product semantics at all.
- **Evidence/provenance model**: whether an affinity fact should cite which purchased `productId`(s)
  contributed to it (recommended: yes, bounded to ids/dates, never raw product names or descriptions —
  consistent with Section 9).

**Do not** implement actual affinity calculations against the local (duplicate) classifier in this repo
— any real computation must source product semantics from `catalog-service`, once that becomes
available, not from `src/domain/product-semantic-classification/` here.

## 9. No cross-domain leakage — guardrail for future affinity code

Future customer affinity code must never re-derive product semantics itself. Concretely, it must not:

- Parse product names.
- Inspect raw PrestaShop category assignments or trust classes.
- Interpret structured product features (e.g. "Clasificación de Uso").
- Contain any product-semantic regex (family/discipline/use-context name patterns).
- Call anything resembling `classifyProduct`/`voteProductFamilyByCategory` locally.

It must consume only the normalized `ProductSemanticFact` shape (Section 6) from `catalog-service`. This
is the same boundary the two migrated modules already enforce internally (e.g. the classifier never
uses `FREE_TEXT_DESCRIPTION` evidence) — future affinity code inherits that discipline by construction
if it only ever reads the published fact, never the source product row.

## 10. Validation run

```
npm run typecheck                 → clean, 0 errors
npx vitest run (full suite)       → 196 test files, 1889 tests, all passing (audit made no code changes)
grep-based dependency search       → 0 RUNTIME_DEPENDENCY, 0 BLOCKER found anywhere in the repo
```

No files were deleted or modified as part of this audit.
