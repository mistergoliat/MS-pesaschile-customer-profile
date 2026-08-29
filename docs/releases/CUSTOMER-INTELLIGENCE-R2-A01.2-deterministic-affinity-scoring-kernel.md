# CUSTOMER-INTELLIGENCE-R2-A01.2 — Deterministic Customer Commercial Affinity Scoring Kernel

Status: **IMPLEMENTED, then hardened in A01.2.1 — see the correction notice below.** Type: pure
domain computation, implementing the scoring formula the A01.0 design doc deferred and the A01.1
contracts left unimplemented.

> **Superseded by [`CUSTOMER-INTELLIGENCE-R2-A01.2.1-affinity-scoring-semantic-hardening.md`](CUSTOMER-INTELLIGENCE-R2-A01.2.1-affinity-scoring-semantic-hardening.md)
> on four points** — do not treat the sections below as the current formula:
>
> 1. **FREQUENCY and REPEAT were removed**, not merely documented as an approximation.
>    `PurchaseBehaviorProduct.orderCount` is `COUNT(DISTINCT id_order)` scoped to a single
>    product (confirmed against the actual SQL); summing it across products supporting the same
>    code overcounts distinct purchase occasions. `isRepeated` is literally `orderCount >= 2`, so
>    it inherited the same problem. Both `frequencyWeight`/`FREQUENCY_WEIGHT` and
>    `repeatBonus`/`REPEAT_WEIGHT` no longer exist in `scoring-policy.ts`.
> 2. **Monetary evidence is now summed at code level before dampening**, not dampened per product
>    then summed — the old order caused `sqrt(a) + sqrt(b) > sqrt(a + b)` to reward splitting the
>    same spend across more products, on top of the separate diversity bonus.
> 3. **`evidenceCoverage` (defaulting an untagged group to `1`) was replaced by
>    `explicitEvidenceCoverage: number | null`** — `null` when no contributing fact carries
>    confidence metadata at all, never encoded as `1`.
> 4. **`addRfmDecimals` was replaced by `addDecimals` from `src/shared/decimal.ts`** — Customer
>    Commercial Affinity no longer depends on the RFM domain for generic decimal arithmetic.
>
> The API shape (`scoreCustomerCommercialAffinity`, `expandSemanticEvidence`,
> `aggregateAffinityEvidence`, `scoreAffinityEvidence`), the saturation function, recency
> half-life, role/confidence multipliers, and diversity bonus described below are still accurate.

New files in `src/domain/customer-commercial-affinity/`: `scoring-policy.ts` (constants + pure
component transforms), `scoring.ts` (the kernel). Tests:
`tests/unit/customer-commercial-affinity-scoring-policy.test.ts` (20 tests),
`tests/unit/customer-commercial-affinity-scoring.test.ts` (19 tests) — 39 new tests total.

## API

```ts
scoreCustomerCommercialAffinity({ customerId, purchases }) -> readonly CustomerCommercialAffinityRow[]
```

where each `purchases[i]` is `{ purchase: PurchaseBehaviorProduct, semanticFact: ProductSemanticFact }`
— already joined by `productId` by the caller; the kernel does no I/O and no snapshot lookup.
Internally composed from three exported pure stages (also directly testable/reusable by A01.4):

1. `expandSemanticEvidence(purchase, semanticFact)` — one product → zero or more per-axis
   evidence items (`PRODUCT_FAMILY` primary + secondary, each eligible `DISCIPLINE`, each
   eligible `USE_CONTEXT`), gated entirely by A01.1's `isProductFamilyEligible` /
   `isDisciplineEligible` / `isUseContextEligible` — no classification-status policy is
   reimplemented here.
2. `computeProductAffinityContribution(item)` — one evidence item → one bounded raw contribution
   (recency + frequency + repeat + monetary, role- and confidence-weighted). Excludes diversity,
   which is cross-product.
3. `aggregateAffinityEvidence(items)` → `scoreAffinityEvidence(aggregate, customerId)` — groups by
   `(axis, code)`, applies the diversity bonus and final saturation, and assembles the
   `CustomerCommercialAffinityRow`.

The internal per-item type (`SemanticEvidenceItem`) is not exported — only the functions that use
it are, per the design's "keep this type internal if possible."

## Formula

For one evidence item (one product's contribution to one axis/code):

```
componentSum   = RECENCY_WEIGHT   * recencyWeight(daysSinceLastPurchase)
               + FREQUENCY_WEIGHT * frequencyWeight(orderCount)
               + REPEAT_WEIGHT    * repeatBonus(isRepeated)
               + MONETARY_WEIGHT  * monetaryWeight(spendShare)

rawContribution = componentSum * roleMultiplier(role) * confidenceMultiplier(confidence)
```

Per `(customerId, axis, code)`, summed over every contributing product (sorted by `productId` for
determinism):

```
rawEvidence       = sum(rawContribution)
compositeEvidence = rawEvidence + diversityBonus(distinctProductCount)
score             = round6(saturate(compositeEvidence))
```

## Constants (all part of `customer-commercial-affinity-v1`)

`customerCommercialAffinityCalculationVersion` was **not** bumped for this slice — A01.1's
`'customer-commercial-affinity-v1'` already anticipated the scoring formula belonging to it, and
nothing about the A01.1 contract shape changed.

| Constant | Value | Role |
| --- | --- | --- |
| `RECENCY_HALF_LIFE_DAYS` | 180 | Recency decay half-life |
| `RECENCY_WEIGHT` | 0.35 | Component budget share |
| `FREQUENCY_SATURATION_SCALE` | 3 | Frequency saturation scale |
| `FREQUENCY_WEIGHT` | 0.30 | Component budget share |
| `REPEAT_WEIGHT` | 0.10 | Component budget share |
| `MONETARY_WEIGHT` | 0.25 | Component budget share |
| `PRIMARY_FAMILY_ROLE_MULTIPLIER` | 1.0 | Primary-family role weight |
| `SECONDARY_FAMILY_ROLE_MULTIPLIER` | 0.6 | Secondary-family role weight |
| `STANDARD_ROLE_MULTIPLIER` | 1.0 | DISCIPLINE/USE_CONTEXT role weight |
| `EXPLICIT_CONFIDENCE_MULTIPLIER` | 1.0 | Confidence discount |
| `MISSING_CONFIDENCE_MULTIPLIER` | 1.0 | Confidence discount (neutral) |
| `STRONGLY_INFERRED_CONFIDENCE_MULTIPLIER` | 0.85 | Confidence discount |
| `DIVERSITY_WEIGHT` | 0.30 | Diversity bonus scale |
| `DIVERSITY_SATURATION_SCALE` | 3 | Diversity saturation scale |
| `AFFINITY_SATURATION_SCALE` | 1.5 | Final saturation scale |
| `AFFINITY_SCORE_PRECISION` | 6 decimals | Output rounding |

None of these are learned from data — all are documented v1 heuristics, explicit named exports
(no magic numbers inside formulas), not runtime-mutable in v1 (task Section 7).

## Score semantics

Bounded `[0,1]`, deterministic, monotonic with more qualifying evidence, computed **independently
per `(axis, code)`** — never softmax, never normalized so a customer's codes sum to 1, never
described as a probability. A customer can simultaneously hold strong scores for `BENCH`,
`BARBELL`, `HOME_GYM`, and `POWERLIFTING` at once (proven by test: multi-affinity independence).

## Half-life (task Section 7)

`RECENCY_HALF_LIFE_DAYS = 180` (~6 months). Chosen for a durable-goods gym-equipment catalog, not
a consumables catalog: equipment purchases are naturally infrequent, so a short half-life (e.g. 30
days) would unfairly discount legitimate interest in categories customers buy into rarely. This is
an explicit, versioned v1 heuristic — not learned from data, not exposed as environment-driven
runtime config.

## Frequency transform

`1 - exp(-orderCount / 3)`. `orderCount = 20` does not produce 20x the evidence of `orderCount =
1`: 1 order reaches ~28% of the maximum frequency weight, 5 orders reach ~81%, 20 orders barely
adds beyond that. Diminishing returns by construction.

## Monetary dampening

`sqrt(spendShare)`, where `spendShare` is already a share of the customer's *own* total spend
(never absolute currency). `sqrt(0.01) = 0.1` — a 1% share is boosted 10x above its linear value;
`sqrt(1.0) = 1.0` caps a single all-of-wallet purchase at the same ceiling as any other product's
full monetary weight. Bounded structurally by `MONETARY_WEIGHT` (0.25): monetary evidence can
never exceed 25% of one product's raw contribution, regardless of price.

## Repeat bonus

A flat 0/1 bonus gated on `isRepeated`, weighted at only `REPEAT_WEIGHT = 0.10` — deliberately not
a function of `orderCount`, so it never compounds with the frequency component (no double-counting
of multi-order behavior).

## Primary/secondary multiplier

`PRIMARY_FAMILY_ROLE_MULTIPLIER = 1.0`, `SECONDARY_FAMILY_ROLE_MULTIPLIER = 0.6` — within the A01.0
design doc's suggested 0.5-0.8 range. `DISCIPLINE`/`USE_CONTEXT` always use
`STANDARD_ROLE_MULTIPLIER = 1.0`; no primary/secondary distinction is invented for axes whose
contract carries none (`ProductSemanticFact.disciplines`/`useContexts` are plain arrays).

## Confidence handling

`EXPLICIT` and a **missing** confidence both receive full weight (`1.0`) — a missing field is
never treated as low confidence, per A01.1's contract policy. `STRONGLY_INFERRED` receives a
small, bounded discount (`0.85`). Required ordering `EXPLICIT >= missing >= STRONGLY_INFERRED`
holds by construction and is regression-tested. The kernel produces fully valid, deterministic
output when confidence is absent everywhere (every constructor test that omits `confidence`
passes without special-casing).

## Diversity

Same saturating shape as frequency (`0.3 * (1 - exp(-distinctProductCount / 3))`), applied once
per `(axis, code)` group during aggregation — never per product, never inferred from quantity. 3
distinct supporting products is materially stronger evidence than 1, not 3x stronger.

## Saturation function

`score = 1 - exp(-compositeEvidence / 1.5)`. Chosen because: `score(0) = 0` exactly; strictly
increasing in `compositeEvidence` (more evidence never decreases score — guaranteed structurally,
since `compositeEvidence` is a sum of non-negative terms); asymptotic to 1; never reaches or
exceeds 1 for any finite input. Scale `1.5` was chosen so one single strong product lands around
`~0.4` (clearly positive, not near-maximal from one data point) while 3+ similarly strong distinct
products climb past `~0.75`.

## Determinism / precision policy

- Every summation (`rawEvidence`, `explicitEvidenceMass`, `totalEvidenceMass`,
  `supportingOrderCount`, `supportingSpend`, `lastEvidenceAt`) is computed over items **sorted by
  `productId`** before reducing, so the floating-point operation sequence — and therefore the bit
  pattern of the result — is identical regardless of the caller's input array order. Proven by a
  permutation test (`toEqual` on the full row array after shuffling input order).
- `score` and `evidenceCoverage` are rounded to 6 decimal places on the way out (matching this
  repository's existing decimal `SCALE` convention in `customer-rfm/decimal.ts`) so the persisted
  value itself is checksum-stable. Intermediate values (`rawEvidence`, evidence masses) are left
  at full float precision — determinism there comes from the fixed sort order, not rounding.
- `supportingSpend` is summed via `addRfmDecimals` (reused from `customer-rfm/decimal.ts`, per
  task Section 30's instruction to use existing decimal-safe helpers rather than floating-point
  currency addition) — the result inherits that helper's 6-decimal formatting convention.
- Duplicate `productId` in the input purchases array throws immediately rather than silently
  double-counting (mirrors the `assertNoDuplicateCustomers` pattern already used by RFM/clustering
  snapshot builders).

## `evidenceCoverage` formula

```
totalEvidenceMass = sum(rawContribution) over items whose confidence IS defined (EXPLICIT or STRONGLY_INFERRED)
explicitEvidenceMass = sum(rawContribution) over items with confidence === 'EXPLICIT'

evidenceCoverage = totalEvidenceMass === 0 ? 1 : explicitEvidenceMass / totalEvidenceMass
```

Matches the task's suggested policy exactly, validated against A01.1's contract comment: when no
contributing item for a code carries confidence metadata at all, `totalEvidenceMass` is `0` and
`evidenceCoverage` defaults to `1` (neutral — absence of confidence is never interpreted as low
confidence). Note `totalEvidenceMass` here is scoped to confidence-*tagged* evidence only, not the
same value as `rawEvidence` (which includes untagged items too) — documented explicitly in
`scoring.ts` to avoid ambiguity with the field's name.

## `supportingOrderCount` — documented approximation (task Section 29)

The kernel only has access to `PurchaseBehaviorProduct` (already aggregated to customer × product
grain), not order-line data. `supportingOrderCount` is computed as the sum of `orderCount` across
the *distinct products* contributing to a code — this is an **approximate upper bound**, not an
exact distinct-order count: if two different products supporting the same code were bought
together in one physical order, that order is counted once per product here. Exact distinct-order
counting is deferred to A01.4, which can join against `AnalyticalOrder` line-level data. This is
documented inline in `scoring.ts` and in the row-level test
`supportingOrderCount is an aggregated sum across distinct contributing products`.

## Spend-dominance regression (task Section 21)

A dedicated test constructs Customer A (one $2,000,000 machine purchase, 1 order, 1 product, not
repeated) and Customer B (3 distinct products, 2-4 orders each, all repeated, each a modest
fraction of spend) for the same `PRODUCT_FAMILY` code, and asserts `scoreB > scoreA`. This holds
because: monetary evidence is capped at 25% of a product's contribution regardless of price, one
product's frequency/repeat/diversity terms stay low with only 1 order and no repeat, while B's
richer behavioral evidence (frequency, repeat bonus, and the diversity bonus across 3 distinct
products) accumulates a materially larger `rawEvidence` sum despite far lower absolute spend.

## Known limitations

- Constants are v1 heuristics, not calibrated against real purchase/affinity outcome data — this
  is explicit and intentional (task Section 7), not an oversight.
- `supportingOrderCount` is an approximate upper bound, not an exact distinct-order count (above).
- A product whose `primaryProductFamily` and `secondaryProductFamilies` both name the same code
  (a source-data quality issue, not something this kernel prevents) would have that product's
  contribution summed twice for that code — an edge case the kernel does not special-case, since
  well-formed `ProductSemanticFact`s should never produce it.
- No real Product Semantic Snapshot has been consumed — every fixture in this slice's tests is
  synthetic, per task Section 37.

## What remains deferred to A01.3/A01.4

- Consuming a real Product Semantic Snapshot from `catalog-service` (A01.3 — still blocked on
  A00.5's artifact shape).
- Building the actual customer population and joining real `PurchaseBehaviorProduct` /
  `AnalyticalOrder` data (A01.4).
- Exact distinct-order counting for `supportingOrderCount`, using `AnalyticalOrder` line data
  (A01.4).
- Any DB schema, snapshot repository, or persistence (A01.5).
- Any read model or API (A01.6).

## Validation

```
npm run typecheck   → clean, 0 errors
npm run lint          → clean, 0 errors
npm run build          → clean
npm test                → 196 test files, 1754 tests, all passing
                          (baseline before this slice: 194 files / 1711 tests;
                           +39 new kernel/policy tests, +4 tests from A01.1's own
                           architecture-guard test automatically scaling to cover
                           the 2 new source files — 0 modified, 0 removed)
```
