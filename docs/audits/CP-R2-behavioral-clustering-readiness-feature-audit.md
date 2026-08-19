# CP-R2 — Behavioral Clustering Readiness & Feature Audit

Status: **READY_WITH_CONSTRAINTS**
Date: 2026-08-18
Git HEAD audited: `8e9b73dece8fb6800426fe98d418821220095425` (branch `main`)
Type: read-only audit + technical design. No code, migrations, or HTTP contracts were changed. No RDS writes. No commits.

This audit determines whether Customer Profile is ready to add behavioral clustering as an
owned capability, and defines the minimum correct technical design before any algorithm is
implemented. It builds directly on the CP-R1 RFM track (all citations below reference real,
already-audited facts from `docs/audits/`, `docs/releases/`, and the current source tree — not
new claims). Where this audit adds new evidence (live read-only queries against the production
PrestaShop RDS on 2026-08-18, via the read-only `pc_consultor` account, `GRANT SELECT ON *.*`
confirmed before any query ran), it is marked **[LIVE 2026-08-18]**.

---

## Step 0 — Preflight

```
git status --short   -> (clean)
git branch --show-current -> main
git rev-parse HEAD    -> 8e9b73dece8fb6800426fe98d418821220095425
git log --oneline -5:
  8e9b73d Merge pull request #14 from mistergoliat/feat/cp-r1-track-a-production-ready
  5e3d0d8 feat(customer-profile): complete CP-R1 Track A production readiness
  638c6a5 docs(customer-rfm): close T11 with cross-repo T11H reference
  e76a799 feat(customer-rfm): complete post-RFM runtime and operations
  7f2d4f5 Merge pull request #13 from mistergoliat/feat/cp-r1-t12a-direct-prestashop-customer-input
```

No pending work found. No reset/clean performed.

---

## Step 1 — Current architecture map

`SOURCE TABLE(S) → REPOSITORY → APPLICATION USE CASE → EXISTING FEATURE`

| Source table(s) | Repository (infra) | Use case (application) | Feature(s) produced |
|---|---|---|---|
| `ps_customer` | `mysql-prestashop-customer-reader.ts`, `mysql-prestashop-customer-identity-repository.ts` | `resolve-customer-identity.ts`, `get-customer-profile.ts` | customer existence, `date_add` (tenure), `active` flag |
| `ps_orders` (+ `order_state`, `order_state_lang`) | `mysql-order-states-reader.ts` | `get-customer-profile.ts` (recent orders) | recent order list, translated state name |
| `ps_orders` | `mysql-commercial-orders-summary-reader.ts` | `get-customer-commercial-summary.ts` | `totalOrders`, `totalSpentTaxIncl`, `averageOrderValueTaxIncl`, `firstOrderAt`/`lastOrderAt`, `daysSinceLastOrder`, `purchaseFrequencyDays`, `cancelledOrderCount` (`current_state=6`), `refundedOrderCount` (`current_state=7`) |
| `ps_orders` + `ps_order_detail` | `mysql-customer-product-behavior-reader.ts` | `get-customer-purchase-behavior.ts` | `distinctProductCount`, `distinctVariantCount`, `repeatedProductCount`/`repeatedVariantCount`, `repeatProductRate`/`repeatVariantRate`, spend/order/quantity **HHI concentration** (`top1Share`, `top3Share`, `hhi`, `effectiveDiversity`) — this is the richest existing behavioral-shape signal in the codebase |
| `ps_orders` + `ps_order_detail` + `ps_product` | `mysql-purchased-products-reader.ts` | `get-customer-purchased-products.ts` | per-product purchase history, `catalogStatus` (`linked`/`deleted_or_unavailable`) |
| `ps_orders` (single row, by reference) + `ps_order_state*`, `ps_carrier*` | `mysql-customer-order-status-reader.ts`, `mysql-carriers-reader.ts` | `get-customer-order-status.ts` | single-order delivery method/estimate — **not population-scale, not a clustering feature source** |
| `ps_orders` + `ps_order_detail` + `ps_order_cart_rule` + `ps_cart_rule` + `ps_currency` (population-scoped, windowed) | `mysql-rfm-population-reader.ts` | `create-rfm-snapshot.ts`, `run-rfm-snapshot-operation.ts` | `recencyDays`, `frequencyOrders`, `grossOrderValueTaxIncl`, `averageOrderValueTaxIncl`, R/F/M scores, `rfmCode`, `segmentCode` (materialized, versioned) |
| `customer_rfm_snapshot*` (service-owned tables, migrations 002–004) | `mysql-rfm-snapshot-reader.ts`, `mysql-rfm-snapshot-repository.ts`, `mysql-rfm-snapshot-run-repository.ts` | `get-current-rfm-snapshot.ts`, `get-customer-rfm(-by-customer-id).ts` | published RFM read path — this is the exact persistence pattern this audit proposes mirroring for clustering (Step 13) |
| `master_customer` (CRM DB, `main_management`) | `mysql-master-customer-reader.ts` | `resolve-customer-identity.ts` (legacy/secondary path only) | `masterCustomerId` enrichment — **optional, nullable, never a gate** on any scoring |
| `ps_category_product`, `ps_manufacturer`, `ps_cart*` | none (no runtime reader exists) | none | Exists only in `scripts/audits/product-classification/*` (offline audit script) and, for `ps_cart*`, **nowhere at all** in prior code (new finding, Step 2) |

**Existing analytical/domain modules not wired into any runtime reader but directly reusable
for clustering feature engineering:**
- `src/domain/customer-orders/analytical-order.ts` — canonical order model with discount/shipping/wrapping decomposition, largest-remainder discount allocation, technical-line classification (`SELLER_SERVICE`/`LOGISTICS_ARTIFACT`/etc.). Built for RFM monetary-policy validation (T11A3.2/T11A3.3), never adopted into the production RFM reader (shipping-exclusion variant was explicitly not adopted — see `docs/releases/CP-R1-T11A4-approved-monetary-policy.md`), but its discount/shipping decomposition is exactly what feature candidates `discount_share` and `shipping_share` need.
- `src/domain/customer-rfm/order-monetary-composition.ts` — same lineage, order-level composition + reconciliation-status classification.

**Primary customer identity, confirmed unchanged:** `customerId = ps_customer.id_customer`.
RFM's primary path is CRM-independent (`docs/audits/CP-R1-RFM-data-ownership-crm-architecture-audit.md` §18); clustering must follow the same rule — `master_customer` currently has **1 row**, no `prestashop_customer_id` column, no backfill job (same audit, §3, §5). Any clustering design that required `master_customer` would be blocked; this audit's design does not.

**Prior mentions of clustering:** exhaustively searched (`grep -ri cluster` across the whole repo, 22 files). Every single match is a scope-boundary statement — clustering is named as explicitly **out of scope** in essentially every CP-R1 RFM task (T11A, T11A.1, T11A2, T11A3, T11A3.1, T11B, T11C, T11D, T11E, T11F, T11G, T07/T08/T09 base docs, all four product-classification docs). No clustering algorithm, feature-vector construction, or model exists anywhere in the codebase. The closest existing artifact is T11E's **deterministic, rule-based** 8-segment RFM taxonomy, which the team explicitly declared structurally distinct from any future statistical clustering:

> "RFM deterministic segment != statistical cluster ... Un clustering futuro, si alguna vez existe, debera convivir en un eje separado sin redefinir estos codigos." — `docs/releases/CP-R1-T11E-deterministic-rfm-commercial-segmentation.md`

**Current clustering implementation: NONE.**

---

## Step 2 — Data inventory: what's actually available today

| Field | Available? | Source / evidence |
|---|---|---|
| **CUSTOMER** | | |
| Customer age/tenure | ✅ | `ps_customer.date_add`. **[LIVE]** 72,924 rows, earliest `2022-09-02`, latest `2026-08-18` (today — DB is live/current). |
| Active status | ⚠️ available, not discriminating | `ps_customer.active`. **[LIVE]** 72,922 of 72,924 are active (99.997%) — not a useful segmentation signal on its own. |
| Shop | ✅ | Carried per-order (`ps_orders.id_shop`), not per-customer; RFM already tracks `distinctShopCount`/cross-shop diagnostics. |
| Creation date | ✅ | Same as tenure, `date_add`. |
| **ORDERS** | | |
| Order count / valid order count | ✅ | `ps_orders.valid=1`, already computed (`totalOrders`, `frequencyOrders`). |
| Cancelled orders | ✅ but scoped | `current_state=6`. Per T07A/T06A: **0%** of cancelled orders ever carry `valid=1` — i.e. cancellation is only visible outside the "valid order" population, so a per-customer cancellation ratio must be computed against *all* orders (valid + invalid), not just the valid-order population. |
| Refunded orders | ⚠️ label only, no amount | `current_state=7` exists (16 lifetime, per T06A), but PrestaShop's native refund mechanism is **entirely unused**: `product_quantity_refunded`, `total_refunded_tax_incl`, and `ps_order_slip` are all zero/empty across the whole dataset (`docs/audits/commercial-summary/CP-R1-T07A-monetary-semantics.md`). A "refunded ratio" feature can only be a state-label count, never a monetary refund signal. |
| Order dates | ✅ | `date_add`, already used for recency/frequency. |
| Total paid / total products / shipping / discounts / order states | ✅ | All present on `ps_orders`: `total_paid_tax_incl` (canonical monetary source — verified byte-identical to `total_paid` in every statistic), `total_products_wt`, `total_shipping_tax_incl`, `total_discounts_tax_incl`. 30 configured states, 21 in use (`docs/audits/order-state-semantics/CP-R1-T06A-state-catalog.md`). |
| **ORDER DETAILS** | | |
| Quantities, products, references, prices | ✅ | `ps_order_detail`, persisted historical line totals — canonical, never recomputed from current catalog prices. |
| Product names | ✅ | Persisted on the line itself (`product_name`), survives product deletion — `catalogStatus: 'deleted_or_unavailable'` already modeled. |
| Categories | ⚠️ resolvable, but **not** via the obvious column | See below — this is a real, newly-confirmed finding. |
| **PRODUCT / CATEGORY** | | |
| Categories purchased, category diversity | ⚠️ resolvable via `ps_category_product`, **not** `id_category_default` | **[LIVE]** `id_category_default` is **degenerate**: all 1,589 products default to the exact same `id_category_default = 2` ("CATEGORÍAS", a root-adjacent container). Per-customer distinct-category count computed via this column has `max = 1` across all 44,905 customers with ≥1 valid order — i.e. it carries **zero discriminating signal**. This exactly corroborates the CP-R1 product-classification finding: "the only observed classified category is categoryId 2 ... not a real commercial preference" (`docs/audits/product-classification/CP-R1-T09A-category-coverage.md`). **However**, the proper many-to-many table `ps_category_product` **is** rich and unused by any runtime reader: **[LIVE]** 7,957 rows, 236 distinct categories, avg 4.995 categories/product (max 18); `ps_category` has 253 rows across 6 depth levels, no orphans/cycles. Category-based features are technically feasible but require a **new join path** (`order_detail → category_product`, not `product.id_category_default`), and the prior team repeatedly cautioned that raw PrestaShop categories lack a curated commercial taxonomy (Step 3/Step 20 exclude this from V1). |
| Product diversity | ✅ | Already computed (`distinctProductCount`, HHI concentration). |
| Repeated product/category behavior | ✅ product-level / ❌ category-level | `repeatedProductCount`/`repeatProductRate` exist; no category-level equivalent exists anywhere. |
| **CART** | | |
| Abandoned carts | ⚠️ feasible, **newly discovered, not explored by any prior CP-R1 audit** | `grep -ri "ps_cart\|cart_abandon"` across `src/` and the entire CP-R1 doc corpus returns **zero** references — cart data was never evaluated before. **[LIVE]** `ps_cart` exists and is populated: 132,624 rows, `date_add` range `2025-01-01` → `2026-08-18` (≈19.5 months — shorter retention than `ps_customer`'s 2022 origin, so this feature source cannot cover a customer's full lifetime). |
| Cart-to-order conversion | ⚠️ feasible | **[LIVE]** `ps_orders.id_cart` links to `ps_cart`; 65,250 of the eligible valid-order population's orders carry a cart link — high linkage rate, so an abandonment/conversion ratio is computable, but this is genuinely new ground with **zero prior data-quality validation** (Step 21 defers it). |
| **SHIPPING** | | |
| Carrier | ✅ | `id_carrier`, `mysql-carriers-reader.ts` already exists (built for T06 order-status). |
| Geography | ❌ not currently available without new PII-adjacent work | No runtime reader touches `ps_address`. Exact address is PII (see Step 17); a comuna/región-only aggregated reader does not exist. Excluded from V1 (task instruction: "Evaluar geografía solo si existe una razón comercial legítima y agregada" — no such aggregated path exists yet). |

---

## Step 3 — Feature candidate matrix

Legend: Missingness/Outlier risk — Low/Med/High. "V1" = recommended for the first controlled experiment (Step 20).

| Feature | Source table(s) | Existing code support | Calc complexity | Missingness risk | Outlier risk | Scaling required | Commercial meaning | Redundancy w/ RFM | V1 |
|---|---|---|---|---|---|---|---|---|---|
| **VALUE** | | | | | | | | | |
| `total_spent` | `orders` | ✅ direct (`totalSpentTaxIncl`) | Low | Low | High (p95=912,036 CLP, max=726.8M CLP, T07A) | log1p + robust scale | Overall value | **High** — ≈ Monetary | Yes (log1p, Set B only) |
| `average_order_value` | `orders` | ✅ direct | Low | Low | High (p95=469,990, max=16.8M, T07A) | log1p + robust scale | Ticket size, independent of frequency | Med — AOV is a *ratio*, not a raw RFM axis | Yes |
| `median_order_value` | `orders` (per-customer) | ❌ not computed anywhere | Med (needs per-customer order-level query, not just aggregate SUM/COUNT) | Low | Med | log1p | More robust ticket-size signal than AOV under skew | Med | No — defer; AOV already captures this axis, added complexity not justified for V1 |
| `max_order_value` | `orders` | ❌ not computed | Low | Low | High | log1p | "Ever bought big" signal, distinct from average | Low | No — niche signal, revisit if AOV clusters look too coarse |
| **FREQUENCY** | | | | | | | | | |
| `total_orders` (lifetime) | `orders` | ✅ direct | Low | Low | High (one confirmed historical outlier, 14,331 orders lifetime — same account later excluded by the operational-account policy) | log1p | Loyalty depth | **High** — ≈ Frequency | Yes (log1p, Set B only) |
| `valid_orders` | `orders` | ✅ direct | Low | Low | Same as above | log1p | Same, cleaner definition | High | Use as the canonical frequency count (superset of `total_orders` here) |
| `orders_90d` / `orders_180d` / `orders_365d` | `orders` | ❌ not computed (RFM only computes a single 365d window aggregate, not sub-windows) | Med (three windowed COUNT queries or one CASE-WHEN pass) | Low | Med | log1p or binary "any order in window" | Recent-activity intensity, orthogonal to lifetime totals | Med — these are *windowed* frequencies, RFM's F is unwindowed lifetime-in-365d only | Yes, `orders_365d` only (as a recency-adjacent behavioral-intensity signal, not lifetime frequency) |
| `purchase_frequency_days` | `orders` | ✅ direct, **already explicitly undefined for <2 orders** (`purchaseFrequencyDays: totalOrders < 2 ? null : ...`, `commercial-summary-calculations.ts:53`) | Low | **High for single-order customers by construction** | Med | log1p | Purchase cadence | Med | Yes — but only for the ≥2-orders population (Step 5); this existing null-handling is direct precedent for that population choice |
| **RECENCY / TENURE** | | | | | | | | | |
| `days_since_last_order` | `orders` | ✅ direct | Low | Low | Low (bounded, T07A: median 581, p95 1,340, max 1,425) | log1p or leave raw (bounded range) | Reactivation urgency | **High** — literally Recency | Set B only (log-scaled), excluded from Set A |
| `customer_tenure_days` | `customer.date_add` | ❌ not computed anywhere | Low (`NOW() - date_add`) | Low | Low | raw or log1p | Relationship length, independent of purchase recency | Low — RFM never uses signup date | Yes |
| `days_between_first_last_order` | `orders` | ✅ direct (`firstOrderAt`/`lastOrderAt` diff is derivable) | Low | High for single-order customers (=0 by definition) | Med | log1p | "Purchase span" — wide vs. concentrated buying | Low | Yes, ≥2-orders population only |
| **PRODUCT BEHAVIOR** | | | | | | | | | |
| `distinct_products` | `order_detail` | ✅ direct (`distinctProductCount`) | Low | Low | High **[LIVE p50=2, p90=6, p95=10, p99=20, max=94]** | log1p | Catalog breadth | Low | Yes |
| `distinct_categories` | `order_detail` → `category_product` | ❌ not computed; **must NOT use `id_category_default`** (degenerate, Step 2) | Med (new join through the many-to-many table) | Low (table is populated) | Unknown — never measured | log1p | Category breadth | Low | **No for V1** — taxonomy not yet validated for clustering use (4 separate CP-R1 docs caution against this); candidate for V1.1 after a dedicated small quality pass |
| `average_units_per_order` | `order_detail` | ✅ derivable from existing totals | Low | Low | Med | log1p | Bulk-buying tendency | Low | Yes |
| Category concentration / top-category share | `order_detail` → `category_product` | ❌ not computed | Med-High (needs allocation policy for multi-category products, since avg 4.995 categories/product means naive joins double-count spend) | Low | Unknown | ratio, bounded [0,1] | "Focused vs. diversified buyer" | Low | No for V1 — same taxonomy caveat, plus the multi-category-per-product allocation problem is genuinely unsolved (RFM/product-classification explicitly avoided `category_product` for spend attribution "to avoid double counting") |
| Spend/order/quantity concentration (HHI, top1/top3 share, effective diversity) | `order_detail` | ✅ **already fully built** (`PurchaseBehaviorConcentration`) | None — reuse as-is | Low | Med (bounded HHI, but extreme for 1-2-product buyers) | none needed, already a bounded ratio | "How concentrated is this customer's buying" — the single richest existing behavioral-shape signal | **Low** — genuinely orthogonal to R/F/M | **Yes — highest-priority V1 feature** |
| `repeat_product_rate` | `order_detail` | ✅ direct | Low | Low | Low (bounded ratio) | none | Repeat-purchase tendency at the product level | Low | Yes |
| **ORDER BEHAVIOR** | | | | | | | | | |
| `cancelled_order_ratio` | `orders` (all orders, not just valid) | ⚠️ partial — `cancelledOrderCount` exists but ratio needs a denominator over *all* orders, which no reader currently exposes per-customer | Low | Low (956 lifetime cancellations, T06A) | Med | ratio [0,1], winsorize | Purchase-intent reliability | Low | Yes |
| `refunded_order_ratio` | `orders` | ⚠️ label-only (see Step 2 — no real refund mechanism in use) | Low | Low | Low (16 lifetime) | ratio | Weak signal given near-zero volume | Low | No — 16 lifetime occurrences across 72,924 customers is too sparse to carry cluster-level signal |
| `discount_share` | `orders` | ❌ not computed; `total_discounts_tax_incl / total_paid_tax_incl` | Low | Low (70,886/79,190 orders in T07A have zero discount) | **High — confirmed live** | winsorize hard, then ratio | Deal-seeking behavior | Low | Yes, **only after capping** (see Step 6 finding) |
| `shipping_share` | `orders` | ❌ not computed | Low | Low | Med **[LIVE avg 0.120, max 1.563 — >100% of paid total on some orders]** | winsorize, ratio | Delivery-cost sensitivity / order-size-vs-shipping tradeoff | Low | Yes, winsorized |
| **TREND** | | | | | | | | | |
| `recent_spend_vs_historical` | `orders` (two windows) | ❌ not computed | Med (two aggregates + ratio) | High for customers with short history | High (ratio-of-small-numbers blowup, same failure mode as `discount_share`) | winsorize hard or exclude near-zero denominators | Growing vs. shrinking customer | Low | No for V1 — same denominator-blowup risk as `discount_share`, but without that feature's prior validation; defer to V1.1 |
| `recent_frequency_vs_historical` | `orders` | ❌ not computed | Med | Same | Same | Same | Accelerating vs. decelerating engagement | Low | No for V1, same reason |

---

## Step 4 — Avoiding redundancy with RFM

Direct 1:1 overlaps, as flagged in the task:

- `days_since_last_order` ≈ **Recency**
- `total_orders` / `valid_orders` ≈ **Frequency**
- `total_spent` ≈ **Monetary**

Per the task's explicit instruction, these are **not** automatically excluded. Reasoning:

- **RFM's F is fixed-threshold, not continuous**: production F uses `frequencyBoundaries: [1, 2, 4, 9]` (F1=1, F2=2, F3=3–4, F4=5–9, F5=10+ — `docs/audits/rfm-population/CP-R1-T10A-3-rfm-method-finalization.md`). A clustering algorithm fed the *raw*, continuous, log-scaled order count can recover shape that a 5-bucket score destroys (e.g. the difference between a 10-order and a 200-order customer, both F5).
- **RFM's R/M are frozen percentile boundaries calibrated once** (`recencyBoundaries: [69, 147, 224, 290]`, monetary boundaries `[19990, 38295, 81233, 206188]`, same doc) — a snapshot of the population's shape as of 2026-07-29. Clustering on raw values re-derives structure independently and would surface drift the frozen boundaries can't.
- **Un-transformed, these three variables would dominate any distance-based algorithm** (K-Means/GMM) purely because of their scale and skew (Monetary alone spans 0 to 726.8M CLP, T07A) — this is the real risk the task is warning about, not conceptual redundancy.

**`rfmCode` and `segmentCode` are never used as training inputs**, per the task instruction and consistent with T11E's own explicit boundary ("un clustering futuro ... debera convivir en un eje separado sin redefinir estos codigos").

### Feature Set A — no RFM-dominant raw signals
Concentration/HHI (`hhi`, `top1Share`, `top3Share`, `effectiveDiversity`), `repeat_product_rate`, `average_units_per_order`, `distinct_products` (log1p), `customer_tenure_days`, `orders_365d` (windowed intensity, not lifetime frequency), `cancelled_order_ratio`, `discount_share` (winsorized), `shipping_share` (winsorized), `purchase_frequency_days` (log1p, ≥2-orders population only).

### Feature Set B — with R/F/M raw variables, controlled
Feature Set A **plus** `log1p(total_spent)`, `log1p(valid_orders)`, `log1p(days_since_last_order + 1)` — added as continuous, log-scaled, robust-scaled variables (never `rfmCode`/`segmentCode`).

Both sets are run in the V1 experiment (Step 20) and compared, exactly as the task requires — not decided a priori.

---

## Step 5 — Clustering population

Four candidate policies, with **[LIVE 2026-08-18]** counts against the production PrestaShop RDS, using the same eligibility base as RFM's production reader (`valid=1 AND total_paid_tax_incl > 0 AND id_customer > 0 AND id_customer NOT IN (85980, 39617, 90890, 86421)` — reusing `operationalAccountExclusionPolicyVersion` as-is, not re-deriving it):

| Population | Definition | Count (live, 2026-08-18) |
|---|---|---|
| A — all `ps_customer` | every row | 72,924 |
| B — ≥1 valid order, lifetime | ever placed an eligible order | 44,905 |
| C — active in trailing 365d | last eligible order within 365 days (**this is what RFM's production population actually is** — `windowStartInclusive = referenceTime − 365d`, `date-window.ts:26`) | 14,143 |
| D — dormant &gt;365d | in B but not in C | 30,762 |
| B′ — ≥2 valid orders, lifetime (**recommended**) | repeat purchasers only | **10,139** |

**Population A is rejected**: 72,924 − 44,905 = 28,019 customers have zero commercial history — a zero feature vector, meaningless for behavioral clustering (this is a data-availability fact, not a modeling choice).

**Population C (RFM-aligned) is rejected as the clustering population**, deliberately different from RFM, for three reasons:
1. Restricting clustering to the same 365-day activity window RFM already scores on would make *recency itself* a truncated, foregone dimension — duplicating RFM's own job instead of complementing it.
2. Marketing/Sales value in knowing a **dormant** customer's historical behavioral archetype (e.g. "this lapsed customer was historically a high-ticket, low-frequency buyer") is exactly the kind of reactivation context RFM's recency-gated population erases.
3. The task itself states the clustering population "no tiene por qué ser idéntica a RFM."

**Population B (all ≥1 order) is also rejected as-is**: of its 44,905 customers, **34,766 (77.4%)** have exactly one order. For this group, `purchase_frequency_days` and `days_between_first_last_order` are **undefined by construction** — and the codebase already encodes this exact judgment (`purchaseFrequencyDays: totalOrders < 2 ? null : ...`, `commercial-summary-calculations.ts:53`). Forcing single-order customers through interval-based behavioral features would either inject a mass of arbitrary zeros/nulls or let a 77%-majority undifferentiated cluster swamp the result.

**Recommended: Population B′ (≥2 valid orders lifetime), 10,139 customers.** Single-order customers are not discarded from the *system* — they are handled outside clustering:

- **New/one-time customers (34,766):** assigned no cluster. Reuse the existing, already-defined RFM lifecycle concept `new_customer` = "first valid order within 90 days AND lifetime valid order count = 1" (`docs/audits/rfm-population/CP-R1-T10A-rfm-population-audit.md`) as the served label instead of a cluster id — this is precedent already in the codebase's vocabulary, not a new concept.
- **Dormant customers:** included as long as they have ≥2 historical valid orders, regardless of recency — this is the actual value-add over RFM (Step 12).
- **Customers with zero orders (28,019):** excluded entirely, no commercial signal exists.

**Pre-existing loose end to flag, not fix here:** `docs/audits/rfm-population/CP-R1-T10A-3-multishop-decision.md` decided RFM scoring would use shop-1 only (P1); the production reader that actually shipped (`mysql-rfm-population-reader.ts`) uses `populationScope = all_valid_prestashop_shops` — all shops pooled, no exclusion. Clustering reuses the same order-eligibility base as the shipped RFM reader (all-shops-pooled), which is internally consistent for this audit's purposes, but the underlying T10A-3-vs-T11A inconsistency should be resolved by the team independently of clustering.

---

## Step 6 — Data quality

**Verdict: PASS WITH CONCERNS** (not blocked). Core monetary/frequency/recency data is high quality — reconciliation between `order_detail` line sums and `ps_orders` totals matches exactly for 99.71% of orders, within 0.5% for 99.98% (`docs/audits/order-state-semantics/CP-R1-T06A-order-state-semantics-audit.md`); currency is 100% clean CLP with `conversion_rate` always exactly 1.000000 (`docs/audits/commercial-summary/CP-R1-T07A-monetary-semantics.md`). Several specific candidate features need transformation before use — none are blocking, all are addressed in Step 7.

### Distributions (customers with ≥1 valid order; T07A, most recent full audit pass, corroborated live)
| Metric | min | p50 | p95 | max |
|---|---:|---:|---:|---:|
| Lifetime orders (frequency) | 1 | 1 | 3 | 14,331 *(single historical outlier, now covered by the operational-account exclusion)* |
| Lifetime spend, CLP (monetary) | 0 | 56,790.50 | 912,035.75 | 726,842,640.10 |
| Average order value, CLP | 0 | 48,956 | 469,989.50 | 16,846,580 |
| Days since last order (recency) | 0 | 581 | 1,340 | 1,425 |
| Days between first/last order (2+ orders) | 0 | 238 | 1,099 | 1,410 |

Source: `docs/audits/commercial-summary/CP-R1-T07A-customer-distribution.md`.

### New findings, **[LIVE 2026-08-18]**, population B′-equivalent (≥1 valid order, excluding operational accounts)
- **`distinct_products` per customer:** min 1, p50 2, p90 6, p95 10, p99 20, max 94 (n=44,905).
- **`distinct_categories` via `id_category_default`:** min 0, max **1** — confirms the column is non-discriminating (Step 2).
- **Discount-share denominator blowup — new, previously unflagged risk:** raw `total_discounts_tax_incl / total_paid_tax_incl` has average **8.71** and max **319,943** across 65,405 orders — nonsensical as a [0,1] ratio. Root cause: 31 orders have `total_discounts_tax_incl > total_paid_tax_incl` (a handful with near-zero paid totals), and 2 orders have `total_paid_tax_incl < 100 CLP`. This is exactly the same ratio-of-small-numbers failure mode the task's own STEP 3 "TREND" section warns about — `discount_share` needs hard capping/winsorization before use (Step 7); it is usable, not disqualifying.
- **`shipping_share`:** average 0.120, max 1.563 (i.e. some orders show shipping recorded as &gt;100% of `total_paid_tax_incl` — needs the same capping treatment).
- **Manufacturer coverage:** 253 of 1,589 products (15.9%) missing `id_manufacturer` — consistent with T09A's spend-weighted 85.05% coverage figure.
- **`ps_category_product` (the usable category source, Step 2):** 7,957 rows, 236 distinct categories, avg 4.995 categories/product — populated and structurally sound, but **never validated for commercial meaningfulness** by any prior audit (Step 20 defers it for exactly this reason).

### Known, already-documented data-quality facts relevant to feature choice
- Native refund mechanism entirely unused (`ps_order_slip` has 0 rows) — `refunded_order_ratio` carries almost no signal (16 lifetime label occurrences).
- `current_state` vs. `order_history` mismatch on 14.91% of orders, concentrated in 3 systematic transitions — order-state-derived features beyond the simple `cancelled`/`refunded` labels are not reliable enough for V1 (`docs/audits/order-state-semantics/CP-R1-T06A-order-state-semantics-audit.md`).
- One confirmed lifetime frequency outlier (14,331 orders) — the same account (`id_customer=85980`, "Ventas Pesas Chile") is already covered by the RFM operational-account exclusion list, reused as-is by this audit's population definition (Step 5).

---

## Step 7 — Transformations (V1 feature set only)

| Feature | Recommended transform | Justification |
|---|---|---|
| `total_spent`, `average_order_value` (Set B only) | log1p → robust scale (median/IQR) | Extreme right skew (max/median ratio &gt;12,000×); robust scale avoids the single largest customer dominating centroid placement |
| `valid_orders` (Set B only) | log1p → robust scale | Same skew pattern (max/p50 &gt;14,000×) |
| `days_since_last_order` (Set B only) | log1p(x+1) | Bounded but still right-skewed; +1 avoids log(0) for same-day orders |
| `distinct_products` | log1p | p99/p50 = 10× — moderate skew |
| `customer_tenure_days` | raw or standard scale | Roughly bounded (max ≈1,450 days across the observed customer base), no extreme tail |
| `purchase_frequency_days`, `days_between_first_last_order` | log1p, **≥2-orders population only** | Undefined for single-order customers by construction (Step 5); do not impute a synthetic 0 or population mean — the population exclusion already handles this |
| `hhi`, `top1Share`, `top3Share`, `effectiveDiversity`, `repeat_product_rate` | none (already bounded ratios) | Already [0,1]-scaled by construction — adding another scaler would distort an already-meaningful unit |
| `discount_share`, `shipping_share` | **winsorize at p99 first, then bound to [0,1], then leave as ratio** | Confirmed live outliers (max 319,943 and 1.563 respectively) — capping must happen before scaling, not after, or the cap itself gets rescaled away |
| `cancelled_order_ratio` | winsorize at p99, ratio | Low volume (956 lifetime) but same denominator-small-number risk as discount share for low-order customers |
| `orders_365d` | binary or log1p | Most customers in B′ will have 0–2 in this window; a binary "reactivated in the window" flag may carry more signal than the raw count — test both in V1 |
| Category/geography features | **excluded (not raw, not scaled — not in V1 at all)** | Step 2/3 — taxonomy not validated, no aggregated geography source exists |

No feature is imputed with a population mean/median to paper over missingness — every missingness case above is handled by population scoping (Step 5) or explicit exclusion, matching the codebase's existing convention of returning `null` rather than a synthetic value (`commercial-summary-calculations.ts`).

---

## Step 8 — Algorithm candidates

| Algorithm | Dataset fit (n≈10k, ~12 features) | Interpretability | Stability | Outlier sensitivity | Cluster shape assumption | Operational ease | Reproducibility | Serving complexity |
|---|---|---|---|---|---|---|---|---|
| **K-Means** | Trivial at this scale | High — centroids map directly to per-feature medians for interpretation (Step 11) | Good with fixed seeds + multiple restarts | High (unwinsorized outliers pull centroids) — mitigated by Step 7 transforms | Spherical, equal-variance | Simple, one hyperparameter (k) | Deterministic given fixed seed + init | Low — nearest-centroid at read time or precomputed assignment |
| **MiniBatch K-Means** | Unnecessary at this scale — full K-Means on 10k×12 completes in well under a second | Same as K-Means | Slightly noisier than full K-Means due to mini-batch sampling | Same as K-Means | Same | Same | Slightly less deterministic (batch sampling order) | Same |
| **Gaussian Mixture Model** | Comfortable at this scale | Medium — soft/probabilistic membership is richer but harder to explain to non-technical stakeholders than a centroid table | Sensitive to initialization; needs covariance regularization at n≈10k with correlated features (spend/frequency/diversity are not independent) | Medium — soft assignment absorbs some outlier effect | Elliptical, allows correlated features | Medium — more hyperparameters (covariance type) | Deterministic given fixed seed | Medium — needs the fitted covariance matrices at serving time, not just centroids |
| **HDBSCAN** | Comfortable at this scale | Low-medium — no fixed k, cluster count is a function of density parameters, harder to defend to business stakeholders as a stable taxonomy | Cluster count can vary between parameter choices/runs — the opposite of the deterministic, versioned philosophy RFM was built on | **Low** — explicitly designed to isolate noise/outliers instead of forcing them into a cluster (a genuine strength for a population with confirmed extreme outliers) | Arbitrary, density-based | Harder — requires `approximate_predict`-style logic to assign new customers, not simple nearest-centroid | Deterministic given fixed parameters, but no natural "same cluster across runs" guarantee without post-hoc label matching | High — no first-class Node/JS implementation exists |

**PRIMARY CANDIDATE: K-Means.** Best balance of simplicity, determinism, interpretability, and serving cost; matches the same deterministic/versioned/explainable philosophy the team already committed to for RFM segmentation (T11E's explicit preference for rule-based, auditable classification over opaque models is a strong signal for how this team wants to defend a "why is this customer in this cluster" question).

**SECONDARY CANDIDATE: Gaussian Mixture Model**, as a follow-up experiment once K-Means establishes a baseline k and cluster shapes — useful specifically to check whether K-Means's hard spherical boundaries are hiding real overlap between adjacent segments, and its probabilistic output is a natural fit for a future `membershipProbability` field in the persistence contract (Step 13).

**HDBSCAN: diagnostic-only**, used during EDA to identify how many customers are effectively noise/unclusterable before committing to a k — not a production candidate. This mirrors an existing, explicit precedent in the codebase: frequency winsorization was built and evaluated during RFM's outlier audit but the team explicitly ruled "Winsorization ... is explicitly diagnostic-only and must never become the published metric" (`docs/audits/rfm-population/CP-R1-T10A-frequency-outlier.md`) — the same diagnostic/production split applies here.

---

## Step 9 — Model/k selection methodology

Evaluate, per candidate k in the search range:
- **Silhouette score** (higher better, target &gt;0.25 as a working floor — behavioral data rarely reaches the &gt;0.5 seen in synthetic benchmarks)
- **Davies-Bouldin index** (lower better)
- **Calinski-Harabasz index** (higher better)
- **Cluster size balance** — flag any cluster &lt;3% of the population as a candidate for merging unless it is a business-meaningful, deliberately small niche (e.g. a genuine high-ticket-equipment segment)
- **Stability across seeds** — refit with ≥10 fixed seeds, measure pairwise Adjusted Rand Index (ARI) between runs; a k that only looks good under one seed is not a candidate
- **Stability across resampling** — refit on ≥10 bootstrap 80% subsamples of the population, ARI against the full-population clustering
- **Commercial interpretability** — a human review pass per Step 11; a numerically optimal k that produces clusters no one can explain in one sentence is not adopted

**Initial search range: k = 4 to k = 8.** Justification, offered only as a starting search space, not a fixed decision: RFM's own commercial layer already resolved to 8 named segments at a similar order of magnitude of population granularity (T11E); population B′ (10,139) supports up to k=8 with a minimum plausible cluster size (~3% ≈ 300 customers) still large enough to be commercially actionable, while k below 4 is unlikely to add resolution beyond what RFM's 5-level R/F/M axes already provide.

---

## Step 10 — Temporal stability (mandatory)

Directly reuses a methodology already built and validated for RFM (`docs/audits/rfm-population/CP-R1-T10A-temporal-stability.md`, `CP-R1-T10A-3-temporal-stability.md`) rather than inventing a new one:

- **Assignment stability:** re-run the identical extraction/preprocessing/model pipeline at the current reference time and at −30d/−60d/−90d (same pattern RFM used). Because raw K-Means cluster label indices are not stable across independent fits, match clusters across runs by nearest-centroid (or Hungarian algorithm on centroid distance) before comparing.
- **Centroid stability:** drift distance between matched centroids across time points.
- **Adjusted Rand Index (ARI)** between cluster assignments for the customer population that overlaps both time points.
- **Cluster transition matrix** (k×k), generalizing the 5×5 transition matrix RFM already produces per R/F/M dimension.
- **Drift over time:** trend of the above across successive quarters, not a single comparison.
- **Change attribution**, reusing RFM's exact three-way split (`docs/audits/rfm-population/CP-R1-T10A-3-temporal-stability.md`): a customer's cluster change must be attributed to (a) real behavioral change within the window, (b) population-change-only (other customers shifting, not this one), or (c) boundary/calendar-only effects — never left unattributed.

**Minimum criterion before Marketing/Sales consumption:** ARI ≥ 0.6 between adjacent-quarter runs on the overlapping population, and no more than ~10–15% of customers experiencing a "major" transition (low centroid similarity between old and new assigned cluster) attributable to anything other than real behavioral change. This mirrors RFM's own explicit caution that a single stability comparison is insufficient to certify long-run/seasonal stability — the RFM track itself still carries a "pending one more calibration cycle" qualifier after multiple stability passes (`docs/audits/rfm-population/CP-R1-T10A-3-temporal-stability.md`). Clustering should not claim a stronger guarantee than RFM did on its first pass: **at least 2–3 stability comparison cycles are required before this feeds any Sales/Marketing-facing decision**, not before the model can be fit at all.

---

## Step 11 — Commercial interpretability

Process (post-training only, never pre-assigned):

```
cluster_k
  → compute cluster profile (below)
  → compare each metric against population-wide median
  → a human assigns a commercial label from the profile
```

**Required per-cluster profile metrics:**
- size, % of population
- median `total_spent`, median `average_order_value`
- median `valid_orders` (frequency), median `days_since_last_order` (recency), median `customer_tenure_days`
- median `distinct_products`, median `repeat_product_rate`
- median `hhi` / `top1Share` (concentration)
- discount usage rate (`discount_share` distribution)
- **RFM segment cross-tab** — % of the cluster in each of the 8 existing `segmentCode` values (`CHAMPION`, `LOYAL`, ... `HIBERNATING`). This cross-tab is the actual evidence for whether clustering adds orthogonal value over RFM (Step 12) — if a cluster maps 1:1 onto an existing RFM segment, that cluster's business value is redundant and should be reconsidered, not published as-is.

No cluster is named before this profile is computed and reviewed; the task's own worked example (high AOV + low frequency + high equipment-category concentration → `HIGH_TICKET_EQUIPMENT`) is illustrative only, not a real finding from this repository's data.

---

## Step 12 — Relationship with RFM

```
customer
├── rfm
│   ├── code            (rfmCode, e.g. "R5F2M4")
│   └── segment          (segmentCode, e.g. "CHAMPION")
└── cluster
    ├── clusterId
    ├── modelVersion
    └── interpretation   (human-assigned business label, independently versioned)
```

Marketing/Sales query both dimensions jointly — e.g. `AT_RISK_HIGH_VALUE` (RFM segment) **AND** a cluster interpretation like `HIGH_TICKET_EQUIPMENT` (illustrative only, not a real result). The two axes are **never merged into one code and never allowed to redefine each other** — this restates, rather than invents, the boundary T11E already drew:

> "El segmento comercial define una semantica de negocio estable y versionada. Un clustering futuro ... debera convivir en un eje separado sin redefinir estos codigos."

`rfmCode`/`segmentCode` are read-only context for cluster interpretation (Step 11's cross-tab) and are never written to, derived from, or overwritten by the clustering pipeline.

---

## Step 13 — Persistence (design only — no migration created)

Directly mirrors the RFM snapshot pattern (`migrations/002-004`), which is explicitly the right template to reuse (confirmed via direct migration inspection, not assumption):

**`customer_cluster_model`** (registry, one row per trained model)
- `modelVersion`, `algorithm`, `featureVersion`, `preprocessingVersion`
- `trainingReferenceTime`, `hyperparameters JSON`, `metrics JSON` (silhouette/DB/CH/seed-ARI/resample-ARI)
- `trainedAt`, `status`

**`customer_cluster_snapshot`** (one per assignment materialization, mirrors `customer_rfm_snapshot`)
- `snapshotId`, `modelId` (FK to `customer_cluster_model`)
- `referenceTime`, `populationPolicyVersion`, `populationSize`
- `checksum`, `status ENUM('building','validated','published','failed','superseded')`, `publishedAt`

**`customer_cluster_snapshot_row`** (mirrors `customer_rfm_snapshot_row`)
- `snapshotId` (FK), `prestashopCustomerId` — **no FK to `master_customer`**, same reasoning as RFM ("T11A uses provisional PrestaShop identity" — migration 002 comment, directly reused)
- `clusterId`, `distanceToCentroid` or `membershipProbability` (nullable, algorithm-dependent)
- `assignedAt`
- `UNIQUE (snapshotId, prestashopCustomerId)`

Publication protocol, selection rule, and physical location are **not re-designed** — they are the same already-validated pattern:
- Publish protocol: insert header as `building` → insert rows → verify row count/checksum → supersede prior published snapshot → mark `validated` → mark `published`, single transaction, exactly as `docs/releases/CP-R1-T11G-rfm-snapshot-scheduling-and-publication-operations.md` documents.
- Current-snapshot selection: `status='published' ORDER BY published_at DESC, id DESC LIMIT 1` — identical rule to RFM.
- Physical location: the same dedicated schema on the existing PrestaShop RDS instance recommended for RFM (`docs/audits/CP-R1-RFM-data-ownership-crm-architecture-audit.md` §11) — not CRM's `main_management`, not a new RDS instance. Writers: Customer Profile's own CLI only. Readers: Customer Profile's HTTP process only.

---

## Step 14 — Versioning

Four independent version axes, all recorded together on `customer_cluster_model` so any historical snapshot is exactly reproducible — mirrors RFM's own multi-dimensional policy-version composite (`populationPolicyVersion` + `monetaryPolicyVersion` + `scoringPolicyVersion` + ... composed into `snapshotKey`):

- `featureVersion` — exact feature list + which of Set A/Set B + transform choices (Step 7)
- `preprocessingVersion` — scaler parameters, winsorization cutoffs, population policy version
- `modelVersion` — algorithm + hyperparameters (k, seed, init) + training data snapshot reference
- `interpretationVersion` — the human-assigned cluster→label mapping, independently revisable without retraining (a label can be corrected after review without invalidating the underlying model)

---

## Step 15 — Future HTTP contract (design only — no route created)

```
GET /v1/customers/:customerId/cluster
```

Mirrors the existing `/v1/customers/:customerId/rfm` route's exact status/shape conventions (`src/http/routes/index.ts`) rather than inventing a new pattern:

- `200` — `{ status: 'available', customerId, modelVersion, snapshot: { snapshotId, referenceTime }, cluster: { clusterId, distanceToCentroid | membershipProbability }, interpretation: { label, version }, provenance }`
- `404` — `customer_not_found`, or a `cluster_not_available` case (mirrors `rfm_not_available`) for customers in the excluded population (new/one-time customers, Step 5)
- `503` — `degraded` (`prestashop_unavailable`-equivalent: cluster snapshot store unreachable)

**Assignment is always the latest published snapshot**, identical to RFM's rule — the task explicitly asks whether this should match RFM's pattern, and it should, for the same operational-simplicity reasons RFM adopted it. No second `masterCustomerId`-keyed legacy route is proposed — there is no evidence any consumer needs the CRM-space identity for clustering, unlike RFM which inherited that path historically.

---

## Step 16 — Sales / Marketing / Analytics roles

- **Sales Agent:** cluster = secondary context alongside RFM segment and order history, surfaced read-only via the future HTTP contract. Not yet integrated anywhere — `docs/architecture/overview.md` lists Sales Agent only as a "future HTTP client."
- **Marketing:** cluster = a segmentation dimension, queried jointly with RFM segment (Step 12), never a replacement for RFM segment.
- **Analytics:** cluster = a lens for behavioral evolution over time, using the temporal-stability transition matrix (Step 10) as its primary artifact.

Customer Profile remains the sole source of truth for cluster assignment, mirroring RFM's ownership model — CRM-Customer-360 and Marketing consume via HTTP only, never compute or store their own clustering.

---

## Step 17 — Security / PII

**Explicitly excluded as clustering inputs**, reusing the exact, already-implemented PII field list from `scripts/audits/rfm-population/lib/pii-guard.ts` (`FORBIDDEN_RESULT_FIELD_NAMES`) rather than redefining one: `email`, `firstname`, `lastname`, `phone`, `phone_mobile`, `address1`, `address2`, `company`, `rut`, `passwd`, **`birthday`**, `ip_address`, `secure_key`, `reset_password_token`, and equivalents (`telefono`, `dni`, `document`, `card`, `payment*`) from the RFM manifest guard (`src/domain/customer-rfm/dataset.ts`, `isForbiddenManifestKey`/`isForbiddenManifestString`).

**Recommendation, concrete and directly actionable:** the clustering domain module should implement its own `assertNoPiiInClusterManifest`, structurally copying `assertRfmManifestHasNoPii`/`isForbiddenManifestKey` (`src/domain/customer-rfm/dataset.ts:537-601`) rather than writing a new guard from scratch — this pattern is already battle-tested across every CP-R1 audit output.

**Geography:** excluded from V1 — no aggregated (comuna/región-level), PII-safe reader exists today (Step 2); would require new work with an explicit review before any address-adjacent data enters a feature vector.

**Leakage:** `rfmCode`/`segmentCode` never used as training inputs (Step 4/12).

**Discrimination risk:** no protected-characteristic-adjacent field (gender, age/birthdate, ethnicity) is proposed as a feature; `birthday` is explicitly on the exclusion list above and is never referenced by any candidate feature in Step 3.

**PII leakage verdict: NO**, contingent on implementing the guard above before any manifest/report leaves this module — matching how every prior CP-R1 audit output was already gated.

---

## Step 18 — Performance / computational feasibility

Population B′ ≈ 10,139 customers × ~12 V1 features is trivial by any ML standard — full in-memory K-Means completes in well under a second in a mature numerical library, and even the broader population B (44,905) does not change this conclusion.

**Node/TypeScript is computationally sufficient for the data volume, but not the right tool for the model-fitting step itself.** The real constraint is ecosystem maturity, not compute: Python's `scikit-learn` provides tested, numerically robust K-Means/GMM/HDBSCAN plus silhouette/Davies-Bouldin/Calinski-Harabasz metrics as standard library calls; Node/TS has no comparable maintained equivalent — building and validating a hand-rolled K-Means plus all of Step 9's metrics in TS from scratch is real, unjustified engineering risk for a first experiment.

**Recommendation:** a **Python offline script, living inside this same repository** (not a separate service, not a separate deploy unit) does the actual model fitting — this satisfies the task's "no separar a otro microservicio sin justificación" constraint while accepting a narrowly-scoped, justified exception for the one step where Python's tooling is decisively better. The boundary is strict: Python never touches the database directly (avoiding a second DB-credential surface); it only reads a feature-matrix file that a TS extraction script produces, and only writes a JSON result file that a TS loader script (mirroring `scripts/snapshots/rfm-snapshot.ts`'s CLI pattern) consumes to publish. Everything else — extraction SQL, persistence, versioning, HTTP serving — stays entirely in TypeScript, consistent with the rest of the service.

**Separate microservice required: NO.**

---

## Step 19 — Proposed implementation boundary (proposal only — nothing created)

```
src/application/customer-clustering/
  get-customer-cluster.ts
  ports.ts

src/domain/customer-clustering/
  contracts.ts
  cluster-profile.ts
  pii-guard.ts               (mirrors customer-rfm/dataset.ts's assertNoPiiValue)

src/infrastructure/clustering/
  mysql-cluster-snapshot-reader.ts     (mirrors src/infrastructure/rfm/mysql-rfm-snapshot-reader.ts)
  mysql-cluster-snapshot-repository.ts

scripts/clustering/
  feature-extraction.ts       (TS — reuses existing readers, exports a feature-matrix file)
  fit-model.py                 (Python — offline, reads the feature-matrix file only, never the DB)
  load-cluster-snapshot.ts    (TS — mirrors scripts/snapshots/lib/rfm-snapshot-command.ts)
  outputs/                     (gitignored, local CSV/JSON results — Step 20)

migrations/
  005_create_customer_cluster_tables.sql   (future — NOT created by this audit)
```

---

## Step 20 — V1 experiment design

- **Population:** B′ — ≥2 valid orders lifetime, operational accounts excluded (10,139 customers, live 2026-08-18).
- **Feature sets:** both A and B (Step 4), run and compared in the same pass.
- **Preprocessing:** per Step 7 (log1p + robust scale on skewed monetary/frequency features; winsorize `discount_share`/`shipping_share` at p99 before scaling; category/geography excluded entirely).
- **Algorithms:** K-Means (primary), Gaussian Mixture (secondary comparison); HDBSCAN run once, diagnostic-only, to characterize noise/outlier volume before committing to k.
- **k range:** 4–8 (Step 9).
- **Seeds:** ≥10 fixed seeds (e.g. 42, 101, 202, ... ) for the seed-stability check; ≥10 bootstrap 80% resamples for the resampling-stability check.
- **Metrics:** silhouette, Davies-Bouldin, Calinski-Harabasz, cluster size balance, seed ARI, resample ARI (Step 9). Temporal stability (Step 10) is **explicitly deferred to a follow-up pass** — it requires a second time point 30+ days apart and cannot be produced in a single sitting, exactly as RFM's own temporal-stability work took two separate tasks (T10A-2, then T10A-3).
- **Outputs:** local CSV/JSON under `scripts/clustering/outputs/` (gitignored) — **no production DB writes**, matching the task's explicit constraint.
- **Interpretation workflow:** Step 11's profile-then-label process, applied to whichever (algorithm, k, feature set) combination wins on the metrics above.

---

## Step 21 — Definition of Ready

| Criterion | Status |
|---|---|
| Data sources sufficient | ✅ — commercial-summary, purchase-behavior (HHI concentration), purchased-products, RFM raw metrics all exist and are reusable as-is |
| Feature set V1 defined | ✅ — Sets A and B, Step 3/4 |
| Population defined | ✅ — B′, Step 5, with an explicit, justified exclusion policy |
| Data quality sufficient | ✅ with documented caveats — Step 6 (discount/shipping-share capping required; category excluded) |
| Preprocessing defined | ✅ — Step 7 |
| Candidate algorithm defined | ✅ — K-Means primary, GMM secondary, Step 8 |
| Experiment plan reproducible | ✅ — Step 20, fixed seeds, versioned features/preprocessing |
| No architectural blocker | ✅ — persistence/serving patterns are direct mirrors of an already-shipped, already-validated RFM pattern |
| No PII leakage | ✅ — contingent on implementing the guard specified in Step 17 before any manifest leaves the module |
| No CRM dependency | ✅ — `master_customer` is not required anywhere in this design, consistent with RFM's own CRM-independent primary path |

**Why not an unconditional READY:** every decision above (population, feature set, preprocessing, algorithm) is being made **for the first time by this document** — none of it has been validated against an actually-fitted model yet, and Step 10's temporal-stability requirement cannot be satisfied until a second time-separated run exists. Declaring unconditional readiness would overstate confidence beyond what a paper design can support. This mirrors exactly how RFM itself was never declared "done" after a single audit pass — it went through multiple finalization/validation tasks (T10A → T10A-3 → T11A → T11A3 → T11A4 → T11E) before commercial segmentation was adopted.

**Verdict: READY_WITH_CONSTRAINTS.**

### Constraints for CP-R2-T01
1. Exclude category/manufacturer/geography features from V1 entirely (Step 3/17).
2. Treat this strictly as a local/offline experiment — no HTTP endpoint, no scheduler, no production persistence until V1 results (including at least one repeat run for temporal-stability signal) are reviewed by the team.
3. Reuse the existing `operationalAccountExclusionPolicyVersion` exclusion list as-is; do not re-derive a new outlier policy for clustering.
4. Flag (do not silently inherit) the pre-existing T10A-3-vs-T11A shop-scope inconsistency (Step 5) to the team.
5. Cart-abandonment features (Step 2, newly discovered) require their own small feasibility/quality pass before entering any feature set — not part of V1.

---

## Deferred (explicitly out of scope for this audit and for CP-R2-T01)
- Category/manufacturer taxonomy curation (repeatedly flagged across 4 CP-R1 product-classification docs as a prerequisite for using categories in clustering).
- Aggregated, PII-safe geography features.
- Cart abandonment / cart-to-order conversion features (newly discovered feasible, never quality-audited).
- HTTP endpoint, scheduler, production persistence, Sales Agent / Marketing integration.
- Resolving the T10A-3-vs-T11A multishop-scope inconsistency (not clustering-specific).
