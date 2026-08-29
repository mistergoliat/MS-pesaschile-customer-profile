# CUSTOMER-INTELLIGENCE-R2-A01.2.1 — Affinity Scoring Kernel: Semantic Hardening

Status: **IMPLEMENTED**. Type: pure-domain correctness hardening of the A01.2 kernel, before any
real population, snapshot consumption, or persistence exists. `customer-commercial-affinity-v1`
is unchanged (see [Calculation version](#calculation-version)) — this is a pre-publication
correction, not a new version.

## 1. Purchase behavior grain audit

Read directly (not assumed) from `src/application/customer-purchase-behavior/get-customer-purchase-behavior.ts`
and `src/infrastructure/prestashop/mysql-customer-product-behavior-reader.ts`:

| Field | How it is actually computed | Classification |
| --- | --- | --- |
| `orderCount` | SQL: `COUNT(DISTINCT id_order)` **`GROUP BY product_id`** — distinct orders containing *this specific product*. | `SAFE_AT_PRODUCT_GRAIN`, `REQUIRES_DISTINCT_ORDER_GRAIN` for code-level use |
| `isRepeated` | `product.orderCount >= 2` — a boolean threshold on the exact same field above, computed in `rollupProducts()`. | Same grain as `orderCount`; not independent evidence (Section 4 below) |
| `spendShare` | `divideDecimalToBehaviorDecimal(product.totalSpentTaxIncl, totals.totalSpent)` — share of the customer's *entire* spend across all products; individual products' shares sum to ≤ 1 by construction. | `SAFE_AT_PRODUCT_GRAIN`; `SAFE_ONLY_AFTER_CODE_AGGREGATION` when the aggregation is sum-then-dampen, not dampen-then-sum (Section 3) |
| `daysSinceLastPurchase` | `daysSince(calculatedAt, product.lastPurchasedAt)` — calendar days since this product's own most recent order. | `SAFE_AT_PRODUCT_GRAIN`; requires an explicit code-level combination rule to avoid double-counting against diversity (Section 5) |
| `firstPurchasedAt` / `lastPurchasedAt` | `MIN`/`MAX(date_add)` over this product's own order-detail lines. | `SAFE_AT_PRODUCT_GRAIN` |

**Conclusion:** `orderCount` and `isRepeated` are the only two signals that were unsafe to use at
code grain as A01.2 used them (summed/OR'd across multiple products). `spendShare` and
`daysSinceLastPurchase` are safe at product grain but needed a different *aggregation rule* at
code grain than A01.2 used (sum-then-dampen for spend; strongest-evidence for recency) — not a
removal, a re-derivation.

## 2. Frequency policy — Option B (deferred)

`FREQUENCY_WEIGHT`, `FREQUENCY_SATURATION_SCALE`, and `frequencyWeight()` are **removed** from
`scoring-policy.ts`, not merely documented as approximate.

Why Option B over A or C: Option A (pass exact affinity-code distinct-order evidence into the
kernel) would require order-line data — `PurchaseBehaviorProduct` carries no `orderId`s, only a
pre-aggregated per-product count. Building a speculative "richer" input DTO now, with nothing able
to construct it except a synthetic test, would guess at A01.4's actual `AnalyticalOrder` join
shape rather than design against it. Option C does not apply: no other existing signal represents
independent purchase occasions at code grain. The kernel now **never reads `orderCount` for
scoring** — proven by a test that varies `orderCount` from 1 to 50 with everything else held
constant and asserts the score is byte-identical.

## 3. `approximateSupportingOrderCount` (renamed)

`CustomerCommercialAffinityRow.supportingOrderCount` → `approximateSupportingOrderCount` (Option
B from the task's three choices — an exact-sounding name is worse than a slightly less convenient
one). Still populated for descriptive/explainability purposes (summed `orderCount` across distinct
contributing products), still documented inline as an upper bound, but the name itself now carries
the caveat so a future reader cannot mistake it for an exact count without reading a comment.

## 4. Repeat policy — `REMOVE_REPEAT_COMPONENT`

`isRepeated` is literally `orderCount >= 2` (Section 1). Once `orderCount` was found unsafe to use
at code grain and removed from scoring, keeping `isRepeated` — a coarser view of the *exact same*
underlying quantity — would have reintroduced the same unreliable-at-code-grain information under
a different name, exactly the outcome Section 5's "do not retain known overcounting merely as a
documented limitation" was warning against. `REPEAT_WEIGHT` and `repeatBonus()` are removed. No
information is meaningfully lost: `DIVERSITY` already rewards a customer touching a code through
multiple distinct products, which is the closest thing to "breadth of behavior" that remains
measurable at this grain.

## 5. Monetary fragmentation audit and fix

**The bug, mathematically:** A01.2 computed `MONETARY_WEIGHT * sqrt(spendShare)` **per product**,
then summed across products contributing to a code. Because `sqrt` is concave, `sqrt(a) + sqrt(b)
> sqrt(a + b)` for positive `a, b` — a customer whose spend was split across more products received
*more* monetary evidence than a customer with the identical total spend concentrated in one
product, purely from the split. This double-rewarded diversity (which already has its own explicit
bonus) under the "monetary" label.

**The fix:** spend share is now summed **first**, across all contributing products for a code
(role- and confidence-weighted, see Section 6), capped to `[0,1]`, and `sqrt` is applied **once**,
at code level, in `scoreAffinityEvidence`. Verified two ways in
`tests/unit/customer-commercial-affinity-scoring.test.ts`:

- `aggregateAffinityEvidence` on 1 product at 40% spend share vs. 4 products at 10% each produces
  the exact same `aggregateSpendShare` (0.4 either way).
- The resulting `score` for both scenarios is proven, by direct formula reconstruction from the
  exported constants, to differ by *exactly* `diversityBonus(4) - diversityBonus(1)` and nothing
  else — i.e. the only source of the score difference is the diversity bonus, never hidden
  monetary inflation.

## 6. Primary/secondary monetary allocation — Option A (full copy, role-weighted within each code)

For a hybrid product (primary family X, secondary family Y), its full spend-share evidence is
counted toward **both** X's aggregation and Y's aggregation independently — scores across
different codes are independent and need not sum to 1 (unchanged from A01.0), so this cross-code
"double counting" is expected, not a bug. **Within** a single code's own aggregation, each
contributing product's spend share is multiplied by that product's role for *that* code
(`PRIMARY_FAMILY_ROLE_MULTIPLIER = 1.0`, `SECONDARY_FAMILY_ROLE_MULTIPLIER = 0.6`) before being
summed with any other product's contribution to the same code.

The `[0,1]` cap on `aggregateSpendShare` is a **documented defensive safety net**, not expected to
bind in normal operation: since every individual `spendShare` is already a share of the customer's
single total spend (so all of a customer's shares sum to ≤ 1), and role multipliers only ever scale
a contribution *down* (never above 1), a well-formed customer's role-weighted aggregate for one
code cannot realistically exceed 1 — the cap only guards against upstream rounding drift.

## 7. Recency aggregation — strongest evidence, not per-product accumulation

A01.2 summed each contributing product's own `recencyWeight` into the code's raw evidence — a code
supported by 3 recent products was rewarded 3x on recency, on top of the separate diversity bonus
for having 3 products. A01.2.1 uses the **maximum** role/confidence-weighted recency strength among
contributing products (`Math.max` reduction, not `Array.reduce` sum) — the code's recency answers
"how fresh is the freshest evidence for this code," a single, non-accumulating question, while
`DIVERSITY` remains the only signal that rewards *breadth* of supporting products. This directly
prevents double-rewarding recency and diversity together for the same evidence.

## 8. `explicitEvidenceCoverage` contract

`CustomerCommercialAffinityRow.evidenceCoverage: number` → `explicitEvidenceCoverage: number |
null`. A01.2's `evidenceCoverage` defaulted an entirely-untagged group to `1`, conflating "all
evidence is EXPLICIT" with "confidence metadata is simply unavailable" — a real correctness bug
once a downstream consumer might read `1` as an assertion of certainty. New semantics:

```
confidenceTaggedEvidenceMass = sum(itemEvidenceWeight) over items whose confidence IS defined
explicitEvidenceMass         = sum(itemEvidenceWeight) over items with confidence === 'EXPLICIT'

explicitEvidenceCoverage =
  confidenceTaggedEvidenceMass === 0 ? null
  : explicitEvidenceMass / confidenceTaggedEvidenceMass
```

`null` = no contributing fact carried confidence metadata at all. `0` = confidence metadata exists
but none of its mass is EXPLICIT. `1` = all confidence-tagged mass is EXPLICIT. A value strictly
between `0` and `1` = a genuine mix. `itemEvidenceWeight` (`recencyWeight * roleMultiplier`) is
deliberately confidence-*independent*, so the ratio is never circularly biased by the very quantity
it measures. Regression-tested for all four cases (null / 0 / 1 / fractional).

## 9. Confidence score multiplier — unchanged, and explicitly distinct from coverage

`EXPLICIT_CONFIDENCE_MULTIPLIER = 1.0`, `MISSING_CONFIDENCE_MULTIPLIER = 1.0`,
`STRONGLY_INFERRED_CONFIDENCE_MULTIPLIER = 0.85` are unchanged from A01.2 — this audit found no
reason to discount a missing confidence field, and the task's own framing agrees ("Missing
confidence must remain neutral unless there is evidence it should be discounted" — none was
found). This multiplier answers "how much should this specific tag's evidence be discounted when
computing the score," a completely different question from `explicitEvidenceCoverage`, which
answers "what fraction of this row's evidence had confidence metadata we could even discount."
The two are computed from different (though related) inputs and are never conflated in code.

## 10. Decimal dependency — extracted to `src/shared/decimal.ts`

Audited `src/domain/customer-rfm/decimal.ts`: every exported function
(`formatRfmDecimal`/`addRfmDecimals`/`divideRfmDecimal`/`compareRfmDecimalAsc`) is `GENERIC_DECIMAL`
— none of them reference RFM policy, RFM types, or anything RFM-specific; they are BigInt-backed,
6-decimal-scale, round-half-up string arithmetic that happens to live in the RFM domain folder for
historical reasons (this repository independently duplicates the same algorithm at least twice
more, in `customer-purchase-behavior/behavior-decimal.ts` and
`customer-commercial-summary/decimal-money.ts` — both left untouched, out of this slice's scope).

**Extraction, done as a zero-risk delegation, not a rewrite:**

- `src/shared/decimal.ts` — new file, the exact same algorithm (byte-for-byte), generically named
  (`formatDecimal`, `addDecimals`, `divideDecimal`, `compareDecimalAsc`).
- `src/domain/customer-rfm/decimal.ts` — reduced to four `export { x as y } from
  '../../shared/decimal.js'` lines. Every RFM call site keeps importing `formatRfmDecimal` etc.
  from the exact same path as before; **zero call sites changed**.
- `src/domain/customer-commercial-affinity/scoring.ts` now imports `addDecimals` from
  `../../shared/decimal.js` directly — no RFM dependency anywhere in this domain anymore.

**Safety verification:** `npm run typecheck` clean; the full RFM test suite (49 test files, 319
tests, matched by filename) passes unchanged, confirming byte-identical arithmetic behavior,
precision, and — since nothing in the computed decimal strings changed — no checksum drift.

## 11. Semantic-fact duplicate policy — `REJECT_MALFORMED_FACT`

`assertValidProductSemanticFact` (new, in `validation.ts`) rejects, at the point `expandSemanticEvidence`
consumes a fact:

- `productId` not a positive integer; `ontologyVersion`/`ontologyHash` empty; any tag `code` empty.
- The primary `PRODUCT_FAMILY` code repeating anywhere in `secondaryProductFamilies`.
- A duplicate code within `secondaryProductFamilies`, `disciplines`, or `useContexts`.

Chosen over silent deduplication because catalog-service should publish canonical facts, and
silently repairing a malformed one here would hide an upstream defect rather than surface it (the
task's own stated preference). Deliberately does **not** validate whether a code exists in any
ontology — codes remain opaque strings owned entirely by catalog-service; a fact with an
unrecognized code is accepted without complaint.

## 12. Final v1 scoring components (orthogonality)

| Component | Grain | Measures | Removed/changed in A01.2.1? |
| --- | --- | --- | --- |
| RECENCY | Code-level (max of per-product role/confidence-weighted strength) | How fresh the strongest evidence for this code is | Aggregation changed: max, not sum |
| MONETARY | Code-level (sum of per-product role/confidence-weighted spend share, dampened once) | How much of the customer's spend is associated with this code | Aggregation changed: sum-then-dampen, not dampen-then-sum |
| DIVERSITY | Code-level (distinct product count) | How many distinct products support this code | Unchanged |
| ROLE | Per-product, applied within recency and monetary | Primary vs. secondary semantic strength | Unchanged values; now scoped explicitly to recency+monetary, not a blanket per-product multiplier |
| CONFIDENCE | Per-product, applied within recency and monetary | Semantic-fact reliability discount | Unchanged values; multiplier role clarified vs. coverage (Section 9) |
| FREQUENCY | — | Distinct purchase occasions | **Removed** — unmeasurable at code grain from this input (Section 2) |
| REPEAT | — | Confirmed repeat purchase | **Removed** — redundant with FREQUENCY (Section 4) |

### Weight budget

| Constant | A01.2 value | A01.2.1 value | Note |
| --- | --- | --- | --- |
| `RECENCY_WEIGHT` | 0.35 | **0.6** | Redistributed after FREQUENCY/REPEAT removal, preserving recency's dominance over monetary |
| `MONETARY_WEIGHT` | 0.25 | **0.4** | Redistributed; still capped/dampened, never dominant |
| `FREQUENCY_WEIGHT` | 0.30 | *(removed)* | — |
| `REPEAT_WEIGHT` | 0.10 | *(removed)* | — |
| `DIVERSITY_WEIGHT` | 0.30 | 0.30 (unchanged) | Independent bonus, not part of the component-sum-to-1 budget |
| Role/confidence multipliers | as A01.2 | unchanged | See Sections 6 and 9 |
| `AFFINITY_SATURATION_SCALE` | 1.5 | 1.5 (unchanged) | Re-verified against the new formula via the full regression suite |

## Calculation version

`customer-commercial-affinity-v1` is **unchanged**. Per the task's default (and this repository's
own precedent): no affinity snapshot has ever been published, no production consumer exists, and
this slice is explicitly a pre-publication semantic correction — the same class of change A01.1's
contract renames already made under the same reasoning. A version bump is reserved for a change
that could invalidate an already-persisted, already-consumed artifact; none exists yet.

## Determinism

Unchanged discipline from A01.2: every aggregation reduces over items sorted by `productId` first,
so floating-point operation order — and therefore the result — is identical regardless of the
caller's input array order (re-verified by the existing permutation test, still passing
byte-for-byte with the new formula). `score` and `explicitEvidenceCoverage` remain rounded to 6
decimals on output.

## Regression tests (task Section 22)

All ten required cases implemented in `tests/unit/customer-commercial-affinity-scoring.test.ts`
(CASE 1/2 combined into one direct, stronger proof — see below) and
`tests/unit/customer-commercial-affinity-validation.test.ts` (CASE 8-10):

| Case | Proof |
| --- | --- |
| 1 & 2 | `orderCount` varied 1→50 with everything else fixed produces a byte-identical score; the same 3-product input scored twice is `toEqual` — nothing in the formula can express "distinct orders" |
| 3 | `aggregateSpendShare` equality (1 vs. 4 products, same total) verified directly via the exported `aggregateAffinityEvidence`; the resulting score difference is proven, by reconstructing the formula from exported constants, to equal exactly `diversityBonus(4) - diversityBonus(1)` |
| 4 | `explicitEvidenceCoverage` is `null` with no confidence metadata anywhere |
| 5 | `1` when all confidence-tagged evidence is EXPLICIT |
| 6 | `0` when all confidence-tagged evidence is STRONGLY_INFERRED |
| 7 | Strictly between 0 and 1 for a genuine EXPLICIT/STRONGLY_INFERRED mix across two products |
| 8 | Primary/secondary `PRODUCT_FAMILY` duplicate code → throws |
| 9 | Duplicate `DISCIPLINE` code → throws |
| 10 | Duplicate `USE_CONTEXT` code → throws |

All prior invariants (Section 23 of the task) re-verified under the new formula: recency, primary
> secondary, confidence ordering, OTHER/EXCLUDED_NON_PRODUCT/NEEDS_REVIEW exclusion,
PARTIALLY_CLASSIFIED per-axis eligibility, multi-affinity independence, permutation determinism,
duplicate-`productId` rejection, empty input, and score bounds.

## RFM regression

`npx vitest run` filtered to every test file matching `rfm` in its name: **49 files, 319 tests, all
passing**, confirming the decimal extraction (Section 10) changed no RFM behavior.

## Files changed

- **Modified:** `src/domain/customer-commercial-affinity/{contracts,validation,scoring-policy,scoring}.ts`,
  `src/domain/customer-rfm/decimal.ts` (now a 4-line delegation).
- **New:** `src/shared/decimal.ts`.
- **Modified tests:** `tests/unit/customer-commercial-affinity-{contracts,scoring-policy,scoring,validation}.test.ts`.
- **Docs:** this file; superseded-notice corrections added to the A01.0 design doc and the A01.1/A01.2
  release docs (Section 26 of the task).

## What remains deferred (unchanged scope boundary)

Exact distinct-order frequency evidence, real Product Semantic Snapshot consumption, real
population building, DB schema/persistence, and any read model/API all remain out of scope for
this slice, same as A01.2 — this hardening pass corrects v1's semantics, it does not advance the
slice plan.
