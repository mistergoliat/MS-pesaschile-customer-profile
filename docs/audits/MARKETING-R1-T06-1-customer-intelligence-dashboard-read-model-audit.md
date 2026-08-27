# MARKETING-R1-T06.1 — Customer Intelligence Dashboard Read Model Audit

Date: 2026-08-27
Type: architecture / data-contract audit (read-only). No production endpoints added.
Repos inspected: `MS-pesaschile-customer-profile` (this repo, branch `main`), `MS-Stock/services`
(catalog service, package `@ms-stock/catalog-service`), `CRM-Customer-360` (branch `develop`, plus
sibling worktrees).

---

## 1. Executive summary

The task's assumed pipeline (`PrestaShop → snapshots → customer-intelligence-read-model-v1 → T03
→ Copilot`) is **accurate** and already built, tested locally, and reused cleanly layer over layer.
A dashboard for **Overview / RFM / Clusters / Intersections** can be built directly on this stack
today with no new analytical engine.

**Commercial Affinity cannot.** It does not live in this repo at all — it is a live,
per-request, single-product-batch scoring engine ("T09") inside the **Catalog Service**
(`MS-Stock/services`), built to personalize product recommendations, not to describe a customer.
It has no snapshot, no population, no commercial-tag taxonomy (no "Home Gym" / "Crossfit" concept
exists anywhere in the ecosystem), and it identifies customers by `masterCustomerId` — the exact
CRM-linked identity path this repo's own RFM work already found unreliable and deliberately moved
away from. Reusing it as-is inside the dashboard would violate almost every constraint the task
sets out in §2 (shared truth) and §18 (deterministic identity). It needs to be **replaced**, not
wired in, and that replacement is out of scope for T06.1 by the task's own §9 instruction.

**Decision: `T06_1_READY_WITH_PREREQUISITES`.** Overview/RFM/Clusters/Intersections are ready to
build now. Commercial Affinity is not, and should not be forced into the same slice — see §22.

---

## 2. Current architecture (verified against code)

```
PrestaShop RDS (read-only)
        |
        v
customer-analytics-features-v1                 EXISTS
  tables: customer_feature_snapshot(_row/_run)  migrations/008,009
  identity: prestashopCustomerId only
  population: "Population B" >=1 valid order lifetime, operational accounts excluded
              44,935 policy count / 44,908 in the live snapshot run
        |
        +--> customer_rfm_snapshot(_row/_run)             EXISTS, PARTIAL
        |     migrations/002,003,004                       identity split (see P0-2)
        |     population: windowed, size stored per-snapshot
        |
        +--> customer_cluster_snapshot(_row/_run/_profile) EXISTS
              migrations/005,006,007
              identity: prestashopCustomerId only
              population: "Population B'" >=2 valid orders, 10,148 policy / 10,141 live run
        |
        v
customer-intelligence-read-model-v1             EXISTS
  src/domain/customer-intelligence/contracts.ts
  feature (base) LEFT JOIN rfm LEFT JOIN cluster, never INNER
  built-in population coverage object (rfmMatched/clusterMatched/bothMatched/neitherMatched)
        |
        v
customer-intelligence-query-v1 ("T03")          EXISTS — READY_WITH_CONSTRAINTS
  src/domain/customer-intelligence-query/*
  27-30 field registry (customer.*/commercial.*/rfm.*/cluster.*), bounded filter compiler,
  SELECT-only executor. Never run against a live/EC2 DB (deferred alongside T01/T02).
        |
        v
business-semantics.ts                           EXISTS, PARTIAL
  src/domain/customer-intelligence-copilot/business-semantics.ts
  Spanish labels + CLP/percent/decimal formatting for metrics and cluster labels.
  RFM segments have NO per-segment label (generic "Segmento RFM {code}" only) — gap.
        |
        v
Copilot (MARKETING-R1-T01/T02/T03/T05)          EXISTS — "implemented locally; EC2 live
  routes through T03's executeAnalyticalQuery    validation not run"
  population-level only, no customer identity in request
  session persistence: migrations/010

======================================================================================
Commercial Affinity — DOES NOT LIVE HERE. Lives in a different service entirely:
======================================================================================

Catalog Service (MS-Stock/services)
  T09 CustomerProductAffinityProvider              EXISTS, but architecturally incompatible
    src/domain/recommendation/customer-affinity/*   as a Customer Intelligence dimension — see §3
    - customer -> PRODUCT score (not customer -> tag/category)
    - computed LIVE per recommendation-search request, for one bounded candidate batch
    - NO persistence, NO snapshot, NO population, NO coverage concept
    - identity: masterCustomerId (CRM-space) — NOT prestashopCustomerId
    - default OFF (CUSTOMER_AFFINITY_PROVIDER_MODE=unavailable); only "ownership" signal
      has a real data source when enabled (calls THIS repo's
      GET /v1/customers/:masterCustomerId/purchased-products)
    - only reachable as a side effect of POST /api/v2/recommendations/search-products
      (single-seed recommendation search) — no standalone "get customer affinity" endpoint
    - consumed by CRM Sales Agent tool + CRM Catalog Console UI, not by anything in this repo

  Relationship engine (product-product, "same_order")   EXISTS — a DIFFERENT, unrelated concept
    src/domain/recommendation/relationship-engine/*      (confidence/lift/support/reliability,
    file-snapshot backed (data/relationship-snapshots/)   real association-rule statistics)
    Do not conflate with T09 customer affinity (task's own warning in §4) — verified distinct
    in both code and the engine's own doc.
```

EXISTS / PARTIAL / DEBT / MISSING markers used throughout below.

---

## 3. Commercial Affinity audit (task §3)

**A. Semantic meaning.** `T09` (`MS-Stock/services/src/domain/recommendation/customer-affinity/`)
computes, per candidate product in a fixed recommendation-search batch, a 0..1 score expressing
how much evidence favors recommending that specific product to that specific customer. It is
**not** a customer-level dimension at all — there is no operation that returns "this customer's
affinity profile" independent of a product search.

**B. What it actually is** — of the task's five options, it is **(b) customer → product
affinity**, computed live for whatever products happen to be candidates in one search request. It
is explicitly *not* (a) customer→tag, (c) customer→category (category/brand appear only as opaque
signal-input IDs, never as the scored unit), or generic (d) recommendation evidence in the
aggregate sense — it's evidence for one product at a time.

**C. Input sources.** A `CustomerProductEvidence` object per candidate product
(`contracts.ts:208-224`): direct/category/brand purchases, product/category interests, rejections,
owned-compatible products, repeat-purchase pattern, price context, ownership. In production, this
is sourced by an HTTP call from Catalog Service to **this repo's**
`GET /v1/customers/:masterCustomerId/purchased-products`
(`httpCustomerAffinityEvidenceProvider.ts:221`) — not from any local purchase-history store in
Catalog Service.

**D. Output contract.** `{ product, score: 0..1, confidence: none|low|medium|high,
scoringVersion: 'customer-affinity-v2', signals[], evidence[], warnings[], ownership? }`
(`contracts.ts:306-322`).

**E. Persistence.** **Calculated live, per request. No table, no file, no cache.** The engine's
own doc states it explicitly: "T09 does not use implicit clock access, random values, UUIDs, SQL,
runtime lookup, or hidden weights" (`docs/recommendation/customer-product-affinity-provider.md:536-538`).
This is a structural mismatch with every other Customer Intelligence dimension, which are all
snapshot-anchored.

**F/G. Identity.** Customer: `masterCustomerId` (CRM-space numeric string) —
`httpCustomerAffinityEvidenceProvider.ts:18-22`. Product: `productId::combinationId`.

**H/I. Score range/method.** 0..1, clamped. **Deterministic, hand-tuned weighted sum** — not
statistical, not ML, not predictive (`DEFAULT_CUSTOMER_AFFINITY_PARAMETERS`,
`contracts.ts:131-147`; doc: "does not implement ML, LLM, collaborative filtering, embeddings").

**J. Would "probability" be wrong?** Yes — and the engine already gets this right on its own:
"The score is normalized to 0..1. It is not a probability, not relationship reliability, not
commercial score, and not final personalization" (`customer-product-affinity-provider.md:202`).
Any dashboard exposing this score must preserve that same disclaimer language.

**K. Coverage/population.** **None.** Computed on-demand for whichever customer is in the current
recommendation request; there is no batch mode and no concept of "how many customers have this."
Practically, coverage is close to zero in any deployment that hasn't explicitly set
`CUSTOMER_AFFINITY_PROVIDER_MODE=http` (default is `unavailable`).

**L. Multi-label.** Yes on two axes: one score per product across an unbounded candidate batch,
and multiple signal types can co-occur within one product's score.

**M. Business labels.** **None exist.** Signal codes (`CATEGORY_PURCHASE`, `BRAND_PURCHASE`,
`RECENT_PRODUCT_INTEREST`, etc.) are structural/behavioral, not commercial tags. No "Home Gym" /
"Crossfit" / "Powerlifting" taxonomy exists anywhere in any of the three repos — confirmed by a
full-tree grep.

**N. Taxonomy contamination.** Product categories are a straight PrestaShop passthrough
(`ps_category`/`ps_category_lang`/`ps_category_product`) in Catalog Service, surfaced as a single
free-text string, not a structured taxonomy. No contamination was found in the category data
itself; the one known issue is a **performance** gap — a `topOrderedCategories` aggregation
documented as timing out (>15s) in a prior discovery audit
(`docs/audits/customer-profile-prestashop-source-audit.md:51,144-145`), never a data-quality
finding. Irrelevant to T06.1 unless a future affinity engine tries to aggregate categories inline.

**O. Queryable independently?** **No.** Only reachable as a side effect of
`POST /api/v2/recommendations/search-products`. There is no `GET /customers/:id/affinity` or
equivalent anywhere. Two consumers exist in CRM (a Sales Agent tool and a human-facing Catalog
Console screen), but both go through the same single recommendation-search endpoint.

---

## 4. Catalog Service relationship — the four concepts, kept separate

| # | Concept | Exists? | Where | Semantics |
|---|---|---|---|---|
| 1 | Product-product behavioral relationships | EXISTS | `relationship-engine/` (`same_order` calculator only; `next_purchase`/`technical_compatibility`/`manual` are schema-only, unimplemented) | Real statistics: `support`, `confidence`, `lift` (association-rule math), plus a derived `reliability` (0..1 heuristic blend). File-snapshot backed (`data/relationship-snapshots/`), loaded into memory at startup. |
| 2 | Product commercial semantics (tags/categories) | MISSING | — | No commercial tag/ontology exists. Only raw PrestaShop categories (opaque IDs/free text), no curated business taxonomy. |
| 3 | Customer-product affinity | EXISTS, but architecturally unusable for a dashboard | `customer-affinity/` (T09), §3 above | Live, per-request, single-batch, unsnapshotted, `masterCustomerId`-keyed. |
| 4 | Customer commercial (tag/category) affinity | MISSING | — | Only a *proposal* exists (`docs/audits/customer-profile-prestashop-source-audit.md:214-215`, this repo's own PrestaShop discovery audit), listing `product_affinity_*`/`category_affinity_*` as candidate future fields for a not-yet-built `CustomerProfileSnapshot v1`. Never implemented. |

**Dependency diagram (as code actually wires it, not as commonly assumed):**

```
CRM-Customer-360 (Sales Agent tool + Catalog Console UI)
        |  HTTP POST /api/v2/recommendations/search-products (single sourceProduct seed)
        v
Catalog Service (MS-Stock/services)
  search-products-v2 pipeline
    |-- relationship-engine (same_order stats)         [local, file-snapshot backed]
    |-- T09 customer-affinity provider ---------------> HTTP GET /v1/customers/:masterCustomerId
    |     (mode=http; default OFF)                       /purchased-products
    |                                                          |
    |                                                          v
    |                                                   THIS REPO (Customer Profile)
    |                                                   purchased-products endpoint
    |                                                   (unrelated to RFM/cluster/feature
    |                                                    snapshots, no snapshot pinning,
    |                                                    no masterCustomerId->prestashopCustomerId
    |                                                    identity contract shared with T02/T03)
    v
personalized-recommendation blend (0.7 commercial + 0.3 affinity, hardcoded weights)
```

Note the arrow direction: **Catalog Service calls Customer Profile**, live, per request, for
ownership facts only — there is no data flow today from Catalog Service into this repo's
analytics DB, and no batch/snapshot process anywhere that would let a dashboard join affinity data
the way it joins RFM/cluster data.

---

## 5. Current `customer-intelligence-read-model-v1` — full field inventory

Source: `src/domain/customer-intelligence/contracts.ts`, `mysql-customer-intelligence-reader.ts`.

| Field | Source table.column | Nullable | Type | In T03 registry? | In business-semantics.ts? |
|---|---|---|---|---|---|
| prestashopCustomerId | `customer_feature_snapshot_row.prestashop_customer_id` | no | int | yes (`customer.customerId`) | n/a (identity) |
| commercial.* (18 fields: validOrders, totalSpentTaxIncl, averageOrderValueTaxIncl, firstOrderAt, lastOrderAt, daysSinceLastOrder, customerTenureDays, distinctProducts, repeatProductRate, top1Share, top3Share, effectiveDiversity, averageUnitsPerOrder, purchaseFrequencyDays, orders365d, cancelledOrderRatio, discountShare, shippingShare) | `customer_feature_snapshot_row.*` | only `purchaseFrequencyDays` (null when <2 valid orders) | int/decimal/datetime | yes, all 18 | partial — only 7 of 18 have registered business labels (averageOrderValue, totalSpent, validOrderCount, orders365d, daysSinceLastOrder, effectiveDiversity, repeatProductRate); the rest fall back to `humanizeUnknownAlias` |
| rfm.rScore/fScore/mScore/rfmCode/segmentCode | `customer_rfm_snapshot_row.*` | entire `rfm` object nullable (no compatible snapshot match); `segmentCode` nullable even when `rfm` present (pre-migration-003 rows) | int/string | yes, all 5 | rScore/fScore/mScore yes, rfmCode yes, **segmentCode has no per-segment label** (P1-4) |
| cluster.clusterId/distanceToCentroid/label/description/interpretationVersion/modelVersion | `customer_cluster_snapshot_row.*` + `customer_cluster_interpretation.*` | entire `cluster` object nullable; label/description nullable if uninterpreted | int/decimal/string | yes, all 6 | yes, via `CLUSTER_BUSINESS_LABELS`/`CLUSTER_CODE_LABELS` |
| population coverage (featurePopulation, rfmMatched, clusterMatched, bothMatched, neitherMatched, rfmCoveragePct, clusterCoveragePct) | computed in reader, not a stored column | no | int/decimal | not a queryable field (context-level, always present) | n/a |

**Is Commercial Affinity represented here today?** No. **Cleanest way to add it**, once a real
snapshot-backed affinity dimension exists (see P0-1): a fourth `LEFT JOIN` exactly like `rfm`/
`cluster` are today, keyed on `prestashopCustomerId` — but because affinity is naturally
multi-row-per-customer (many tags), it cannot be a single flat `LEFT JOIN` the way RFM/cluster are
(one row per customer per snapshot). See §8 for the schema-shape recommendation this implies.

---

## 6. Snapshot alignment

| Source | Reference time | Version | Population | Identity |
|---|---|---|---|---|
| Feature snapshot | `reference_time` on `customer_feature_snapshot` | `featureVersion` + `populationPolicyVersion` | lifetime, >=1 valid order | prestashopCustomerId |
| RFM snapshot | `reference_time`, windowed `[windowStart, windowEnd)` | `calculationVersion` | windowed, size stored per-snapshot | prestashopCustomerId (primary) + legacy masterCustomerId route (secondary, see P0-2) |
| Cluster snapshot | `reference_time` | `modelVersion` | lifetime, >=2 valid orders (subset of feature population) | prestashopCustomerId |
| Commercial Affinity | **none — computed live, no reference time at all** | none | none | masterCustomerId |

The existing three sources already resolve correctly: `resolve-customer-intelligence-context.ts`
anchors on the feature snapshot and independently selects "latest published RFM/cluster snapshot
with `referenceTime <= anchor.referenceTime`" — this is the alignment rule already in production
and it is the right one.

**Recommended alignment rule for Commercial Affinity**, once it exists as a real dimension: it
must become **snapshot-anchored the same way** — a batch-computed
`customer_commercial_affinity_snapshot(_row)` pair with its own `reference_time`, selected via the
identical "latest published, `referenceTime <= anchor.referenceTime`" rule used for RFM/cluster.
**A live cross-service HTTP call at dashboard-read time is explicitly ruled out** — it cannot be
pinned to a snapshot, cannot be reproduced for a past dashboard view, and would silently mix
"right now" affinity with a fixed-in-time feature/RFM/cluster snapshot, which is exactly the
failure mode task §6 warns against.

---

## 7. Population / coverage semantics

The read model already solves most of this correctly for the three real dimensions:
`featurePopulation` (denominator = everyone with a feature row, ~44.9k), `rfmMatched`,
`clusterMatched`, `bothMatched` (RFM ∩ cluster), `neitherMatched`, plus coverage percentages —
all already computed in `mysql-customer-intelligence-reader.ts`. This is a solid, reusable pattern.

For the example question in the task ("Champions in Cluster 3 with Home Gym affinity >= 0.7"), the
unambiguous denominator, once affinity exists as a snapshot dimension, must be defined the same
way: **feature population is always the base**; RFM/cluster/affinity are each a coverage subset of
it via LEFT JOIN; an intersection's denominator is stated explicitly in the response alongside the
numerator — e.g. `{ matchingPopulation: N, context: { featurePopulation, rfmCoveragePct,
clusterCoveragePct, affinityCoveragePct } }`. No dashboard result should ever be returned as a bare
count without its coverage context, because "N Champions in Cluster 3" is meaningless without
knowing what fraction of Champions were even eligible to be in Cluster 3 (cluster population is a
strict subset of feature population, RFM is a windowed subset — the three populations are already
different sizes today, confirmed by the 42.49% RFM×cluster cross-tab coverage figure from the
CP-R2-T03 release).

---

## 8. Commercial Affinity as a dimension — schema recommendation

Given: multiple tag families are coming (§9), tags are multi-weighted per customer (not
mutually exclusive), new tags will be added over time, and T03's filter/aggregation model already
assumes registry-driven fields — **Option B (normalized rows) is correct for the source of
truth**, projected through a **hybrid (Option C)** for querying:

- **Source of truth**: `customer_commercial_affinity_snapshot_row(snapshot_id, prestashop_customer_id,
  affinity_type, score, ...)` — one row per (customer, tag). New tags are new rows, never a schema
  migration. This is exactly how the ecosystem already avoids schema churn elsewhere (RFM segments,
  cluster labels are also small enumerable code sets resolved through one lookup, not columns).
- **T03 integration, without exploding into wide columns**: add filter-only registry fields like
  `affinity.type` (string) and `affinity.score` (decimal) resolved via an `EXISTS` subquery against
  the affinity row table, parameterized the same bounded way every other filter is today — this
  lets `"commercialAffinity.affinityType = HOME_GYM AND commercialAffinity.score >= 0.7"` compile
  safely without ever needing one column per tag.
- **Wide columns are explicitly rejected** for the persisted schema: with an open-ended future tag
  ontology (discipline × environment × functional family × objective × investment level ×
  commercial characteristics, task §9), a wide table would need a migration per new tag and would
  make "does this customer have ANY affinity >= 0.7" an N-column OR instead of one row scan.
  Normalized rows are also cheaper to aggregate (`GROUP BY affinity_type`) and to version
  (add a `scoringVersion` column once, not per tag-column).

---

## 9. Future commercial product ontology — compatibility check

**Today's T09 engine is not compatible with this direction and is not a starting point to evolve
from — it needs replacement.** Reasons: it has no persistence to build a snapshot on top of, no
tag/ontology concept at all (only opaque category/brand IDs as inputs), it's scoped to whatever
products happen to be in one recommendation-search batch rather than a customer's full profile,
and it uses the wrong customer identity for this ecosystem's analytics stack. The task is correct
not to build the ontology in T06.1 — but T06.1's job is to make sure the *boundary* is right, and
it is: model affinity as `customer_id × affinity_type × score`-shaped snapshot rows (§8), keyed by
`prestashopCustomerId`, versioned by `scoringVersion` the same way T09 already versions its own
score (`customer-affinity-v2`) — whatever computes those rows later (a rebuilt engine reading
purchase history × product semantic weights × recency × quantity, per the task's own future
formula) can change freely without touching the dashboard/T03 contract, as long as it keeps writing
that row shape.

---

## 10. Dashboard API recommendation

**Hybrid (task's option C).** One lightweight pinned-context resource plus modular bounded
endpoints reading it — this is not a new pattern, it is the pattern already in production:
`resolve-customer-intelligence-context.ts` + Copilot's `pinned_feature_snapshot_id/
pinned_rfm_snapshot_id/pinned_cluster_snapshot_id` (migration 010) already do exactly this for
conversations. Concretely:

- `GET /v1/customer-intelligence/dashboard/context` — resolves and returns the pinned snapshot
  triple (feature/RFM/cluster, + affinity once it exists) and population coverage. Cheap, cacheable,
  called once per dashboard load.
- `GET /v1/customer-intelligence/dashboard/overview|rfm|clusters|affinities` — each takes the
  resolved snapshot ids from the context call (or resolves "latest" itself if none given) and
  returns its section's data. Small, independently cacheable payloads; a slow affinity cross-tab
  never blocks the overview KPIs from rendering.
- `POST /v1/customer-intelligence/dashboard/intersections` — takes a bounded filter tree (task
  §14's `uiContext.filters` shape) and returns matching population + denominator + common metrics.

A single giant snapshot endpoint was rejected: it couples unrelated latencies (a cheap KPI count
next to a heavier cross-tab), forces the whole payload to invalidate on any one section's cache
miss, and doesn't match how the Copilot's `uiContext` needs to submit partial, incremental filter
state — that's inherently a bounded-endpoint (intersections) operation, not a snapshot fetch.

---

## 11. Minimum T06 dashboard read model

All of the following are buildable **today**, without Commercial Affinity, directly on the
existing read model + T03 registry:

- **Overview**: `featurePopulation`, `rfmMatched`/`rfmCoveragePct`, `clusterMatched`/
  `clusterCoveragePct`, `bothMatched` — all already computed by the existing reader. Spend/AOV/
  frequency/recency — already registered T03 metrics (`commercial.totalSpentTaxIncl`,
  `averageOrderValueTaxIncl`, `orders365d`, `daysSinceLastOrder`).
- **RFM**: distribution by `segmentCode`/`rfmCode`, avg R/F/M scores — all registered T03 fields;
  needs the segment-label gap closed first (P1-4) or the dashboard will show raw codes.
- **Clusters**: distribution by `clusterId`, business labels (already in `business-semantics.ts`),
  RFM cross-tab — `CP-R2-T03`'s `latest/rfm-cross-tab` endpoint already does this exact join live.
- **Commercial Affinity section**: **cannot be built in this slice** — there is no coverage,
  distribution, or cross-tab to expose because no snapshot-backed affinity data exists anywhere
  (§3K). The section should ship as an explicit "not yet available" state, not silently omitted.
- **Intersections**: directly reusable via the T03 compiler for any combination of
  `customer.*/commercial.*/rfm.*/cluster.*` fields today; affinity predicates can only be added
  once §8's registry fields exist.

---

## 12. Physical combinatorial cube — rejected

Materializing `RFM × Cluster × Affinity × ...` as one physical table was evaluated and rejected.
Current populations are small enough (44.9k feature rows, 10.1k cluster rows, RFM windowed subset)
that MariaDB resolves the existing 3-way LEFT JOIN live in the 8-184ms range already measured for
the CP-R2-T03 cross-tab endpoint — there's no latency problem a cube would solve. A physical cube
would also immediately violate task §9's own future-ontology direction: every new affinity tag
would require re-materializing the entire cube, exactly the schema-churn problem §8's normalized-row
design exists to avoid. The composable read-model + bounded-query-runtime approach already in
production is correct and should stay the architecture.

---

## 13. T03 reuse — recommended split

**Dedicated dashboard reads for known, high-frequency tiles; T03 only for open-ended
filtering.** This mirrors what's already in production: CP-R2-T03 built dedicated summary/
cross-tab endpoints reading the local DB directly for known questions (8-184ms), while T03's
generic compiler exists specifically for the Copilot's open-ended natural-language questions. The
dashboard's Overview/RFM/Clusters tiles are known, fixed shapes — they should be dedicated reader
endpoints for the same reason CP-R2-T03's were, not routed through the generic LLM-facing plan
compiler for every page load. The **Intersections** endpoint (and anything persisted as a future
Audience) is exactly the open-ended, arbitrary-filter-combination case T03 was built for — that
one should call the T03 compiler/executor directly, unmodified, rather than growing a second filter
language. Both paths must still read `business-semantics.ts` for labels/formatting — that's the
one place semantic truth is allowed to live (task §16), regardless of which query path produced
the numbers.

---

## 14. Copilot `uiContext` translation

The example filter shape in the task maps directly onto T03's existing
`AnalyticalFilterCondition` tree using registered `logicalName`s — `rfm.segmentCode`/
`cluster.clusterId` already exist and need no new code. `commercialAffinity.affinityType`/
`commercialAffinity.score` do not exist yet and cannot be wired until §8's registry fields exist.
No implementation needed now beyond noting the mapping is 1:1 once those fields land — this is
correctly deferred per task §14's own instruction.

---

## 15. Audience Engine (R2-A01) compatibility

No redesign needed if the affinity dimension is added as registry fields rather than a bespoke
filter language (§8/§14). The reusable contract already exists: T03's
`NormalizedAnalyticalQueryPlan` (filter tree + resolved snapshot ids) plus its `queryPlanHash` are
already deterministic and persistable — the Copilot conversation tables (migration 010) already
persist validated plans, resolved snapshot ids, and plan hashes today. "Save as Audience" should
literally persist that same triple (validated filter tree + snapshot ids + resulting population
size) rather than inventing a new saved-filter format.

---

## 16. Business semantics centralization

`business-semantics.ts` is already the correct single source for metric labels, CLP/percent/decimal
formatting, and cluster labels — the dashboard must consume it exactly as the Copilot does, never
duplicate a label dictionary in the frontend (task §16's own instruction, already the file's stated
purpose per its header comment). Two gaps to close, not architecture problems:

- RFM segments have no per-segment Spanish label (`businessEntityLabel` falls back to
  `'Segmento RFM {code}'`, `business-semantics.ts:130`) — the 8 codes already exist in
  `src/domain/customer-rfm/segmentation.ts:5-24` and just need labels added, same pattern as
  `CLUSTER_BUSINESS_LABELS`. This is the one "trivial fix" candidate this audit recommends
  actually making (see P1-4) since it's a pure data addition to an existing file, not a new
  capability.
- Only 7 of 18 commercial fields have registered business labels — the rest silently fall back to
  `humanizeUnknownAlias` (e.g. `"Discount Share"` instead of a proper Spanish label). Not blocking,
  but should be filled in as dashboard tiles start using those fields.

---

## 17. Performance

Current scale (44.9k feature rows / 10.1k cluster rows / RFM windowed subset) is well within
MariaDB's comfort zone for the existing join topology — already measured at 8-184ms for a live
3-way cross-tab. A normalized affinity table at, say, 10 tags/customer average would add ~450k
rows at full population — still small. No caching/materialization is needed at this data volume;
the one **unverified** item is whether `(snapshot_id, prestashop_customer_id)` is indexed on every
snapshot row table — not visible from source alone, flagged as P1 to confirm via `SHOW INDEX`
before adding dashboard-driven cross-tab load on top of Copilot's existing load.

---

## 18. Security / data boundaries

All verified intact: PrestaShop is read-only everywhere (feature/RFM/cluster derivation only
reads it; Copilot/T03 never touch it). No dashboard-shaped write path exists or is proposed. T03's
compiler never accepts raw SQL or interpolated identifiers — every SQL fragment comes from the
static registry (`compiler.ts` header comment, verified). Bounded query dimensions (`MAX_FILTER_
LEAVES=20`, `MAX_FILTER_DEPTH=5`, `MAX_DIMENSIONS=5`, `MAX_METRICS=10`) already enforced and reused
by the recommended Intersections endpoint. One boundary note for whoever builds the affinity engine
later: Catalog Service's HTTP call to this repo's `purchased-products` endpoint currently sends
**no auth header** (documented as a known caveat in the T09 doc itself) — irrelevant to T06.1's
scope but worth flagging since it's the same identity surface any future affinity ingestion would
need to harden.

---

## 19. Gaps, classified

**P0 — blocks safe T06 implementation of Commercial Affinity specifically (not of Overview/RFM/
Clusters/Intersections, which have none):**

1. Commercial Affinity has no snapshot, no population, and lives in a different service, computed
   live per product-search request — structurally incompatible with the read model's
   snapshot-anchored join pattern. A dashboard cannot join it in as-is.
2. It uses `masterCustomerId`, an identity path this repo's own RFM work already found unreliable
   (`master_customer_id` nullable, `identity_resolution_status` hardcoded `'provisional'`,
   migration 001 marked "design artifact only — not executed") and deliberately dropped in favor
   of `prestashopCustomerId` everywhere else in T02/T03/Copilot. Reusing it would reintroduce a
   problem already solved elsewhere in this same codebase.
3. No commercial tag taxonomy exists anywhere — the Commercial Affinity dashboard section has
   literally nothing to render regardless of API shape, and building that taxonomy is explicitly
   out of scope for T06.1 (task §9).

**P1 — should fix during T06 (not blocking, but will visibly hurt the dashboard if skipped):**

4. RFM's legacy `masterCustomerId` route must be explicitly excluded from the dashboard contract —
   only the primary `prestashopCustomerId`-anchored path (already what T02/T03/Copilot use) should
   ever back a dashboard number.
5. Add RFM segment Spanish labels to `business-semantics.ts` (§16) — small, contained, matches the
   existing pattern exactly. Recommended as the one trivial fix worth making now.
6. Confirm `(snapshot_id, prestashop_customer_id)` indexing on the snapshot row tables before
   adding dashboard query load (§17).
7. When Commercial Affinity fields are eventually added to the T03 registry, follow the exact
   existing `{logicalName, type, nullable, source, sqlExpression, description}` pattern (§8/§14) —
   do not invent a parallel filter language for the dashboard.

**P2 — documented debt, no action needed for T06:**

8. Catalog Service's 9 other affinity signal types (category/brand/interest/rejection/spend-fit)
   are contract-defined but have no live data source — relevant only to whoever eventually builds
   the replacement affinity engine (§9), not to T06.1.
9. Product category taxonomy has a known aggregation-timeout performance gap, not a contamination
   issue — irrelevant unless a future affinity engine aggregates categories inline.
10. The product-product relationship engine (confidence/lift/support/reliability) is a real,
    well-tested, unrelated subsystem — correctly out of scope for Commercial Affinity as a customer
    dimension.
11. Full commercial-field label coverage in `business-semantics.ts` (11 of 18 fields still fall
    back to auto-humanized names) — fill in incrementally as dashboard tiles need them.

---

## 20. Decision

**T06_1_READY_WITH_PREREQUISITES**

Minimum prerequisite work before implementation, in order:
1. None required to start Overview/RFM/Clusters/Intersections — build directly on the existing
   read model + T03 registry (§13).
2. P1-5 (RFM segment labels) should land alongside, since Overview/RFM tiles need it immediately.
3. P1-6 (index confirmation) should be checked before the Intersections endpoint goes live under
   real dashboard traffic.
4. Commercial Affinity is **not a T06 prerequisite to fix** — it is a separate, larger initiative
   (new engine, new snapshot, new identity contract, eventually a tag taxonomy) that T06 should
   design *around* (§8's schema boundary) rather than wait for.

---

## 21. Next implementation sequence

Renumbered from what the audit actually found, not the task's placeholder sequence:

- **T06.2** — Dashboard Overview + RFM + Clusters dedicated read endpoints, reusing
  `customer-intelligence-read-model-v1` and `business-semantics.ts` directly (CP-R2-T03 pattern).
  Bundle P1-5 (RFM segment labels) into this slice.
- **T06.3** — Dashboard Intersections endpoint, wired directly to the existing T03
  compiler/executor/validator (no new compiler). Persist the validated plan + snapshot ids +
  population size in the same shape a future Audience already needs (§15), even though "save as
  Audience" itself is out of scope here.
- **T06.4** — Copilot `uiContext.filters` → T03 filter-tree adapter, using T06.3's endpoint as the
  translation target (trivial once T06.3 exists, since it's the same compiler).
- **T06.5 (separate track, not a T06.x polish task)** — Commercial Affinity v0: a net-new,
  Customer-Profile-owned, `prestashopCustomerId`-keyed, snapshot-anchored, normalized-row affinity
  table (§8), sourced independently of Catalog Service's live T09 engine. This requires its own
  scoping task (product/commercial decisions the task explicitly excludes from T06.1) before any
  code is written — flag to product/marketing stakeholders rather than sequencing it as T06.6.
