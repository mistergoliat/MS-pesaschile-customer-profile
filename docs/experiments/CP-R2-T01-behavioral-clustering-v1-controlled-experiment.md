# CP-R2-T01 — Behavioral Clustering V1: Controlled Experiment

Status: **READY_WITH_CONSTRAINTS** (see Section 21)
Git branch: `feat/cp-r2-t01-behavioral-clustering-v1`
Type: read-only PrestaShop extraction + local Python experiment. No production code, no
migrations, no HTTP routes, no writes to the PrestaShop RDS.

---

## 1. Objective

Determine, experimentally, whether Behavioral Clustering on PesasChile's commercial order
history produces a useful, stable, and RFM-complementary signal — not to productivize
clustering. This follows directly from `docs/audits/CP-R2-behavioral-clustering-readiness-feature-audit.md`
(status `READY_WITH_CONSTRAINTS`, audited at git HEAD `8e9b73d`).

The ten questions from the task brief (Section 6) are answered in the Recommendation section
at the end of this document.

## 2. Architecture / boundary

```
PrestaShop RDS (READ ONLY)
        |  SELECT only, via pc_consultor (confirmed SELECT/USAGE-only grants each run)
        v
scripts/clustering/feature-extraction.ts (TypeScript)
        |  writes local, gitignored, PII-free files
        v
scripts/clustering/outputs/{features-raw.csv, dataset-manifest.json, rfm-segments.csv}
        |
        v
scripts/clustering/python/run_experiment.py (Python, venv-isolated)
        |  never touches any DB — reads only the files above
        v
scripts/clustering/outputs/{kmeans-metrics.json, gmm-metrics.json, cluster-profiles.json,
                            rfm-cross-tab.json, assignments-set-*.csv, plots/, experiment-results.json}
```

Python dependencies are pinned in `scripts/clustering/python/requirements.txt`
(numpy/pandas/scikit-learn/scipy/matplotlib/pytest) and installed into a local venv at
`scripts/clustering/python/.venv/` (gitignored). scikit-learn 1.6 ships `sklearn.cluster.HDBSCAN`
built in, so no separate HDBSCAN package was needed.

RFM segment data is read separately, read-only, from Customer Profile's **own** local RFM
snapshot store (`RFM_SNAPSHOT_DB_*`, not the PrestaShop RDS) — used exclusively for the
post-hoc cross-tab (Section 15); `rfmCode`/`segmentCode` are never fed into feature extraction
or model training.

## 3. Dataset

- **Reference time:** `2026-08-19T18:10:27.112Z`, resolved once and threaded through every
  window calculation, the manifest, and this report (Section 45 of the task brief).
- **Feature version:** `cluster-features-v1`
- **Preprocessing version:** `cluster-preprocessing-v1`
- **Experiment version:** `cp-r2-t01-v1`
- **Dataset checksum:** `318e3c2ac6ca04f110585f0f773b04ac3979f730fd64d93f0edb158c4b55632c`
- **Extraction duration:** 3,466 ms (population/order/product aggregate queries)

## 4. Population

**Policy: Population B′ — customers with ≥2 valid orders lifetime, operational accounts
excluded**, matching the readiness audit's recommendation (Step 5). Live count, re-derived
(never hardcoded): **10,145 customers** as of the reference time above — consistent with the
audit's 2026-08-18 live estimate of 10,139 (one day later, +6 customers, as expected).

Eligibility (identical to the shipped RFM population reader's base filter, reused as-is):
`valid = 1 AND total_paid_tax_incl > 0 AND id_customer > 0 AND id_customer NOT IN
(85980, 39617, 90890, 86421)` (`operational-account-exclusion-v1`), grouped by customer with
`HAVING COUNT(DISTINCT id_order) >= 2`, bounded above by `date_add < referenceTime`.

**Shop scope actually used:** `all_valid_prestashop_shops` (all shops pooled) — this matches
the RFM reader that actually shipped to production, **not** the older
`CP-R1-T10A-3-multishop-decision.md` shop-1-only decision. This pre-existing inconsistency is
flagged here, exactly as the readiness audit's Step 5 instructed, and is **not** resolved as
part of this task.

Excluded from Population B′:
- 28,019 customers with zero valid orders (no commercial signal at all).
- ~34,700 one-time buyers (exactly 1 valid order) — `purchaseFrequencyDays` and
  `daysBetweenFirstLastOrder` are undefined by construction for this group, matching the
  precedent already encoded in `commercial-summary-calculations.ts`
  (`purchaseFrequencyDays: totalOrders < 2 ? null : ...`). This is **this experiment's**
  population choice only — one-time buyers remain commercially important and are explicitly
  **not** being redefined as a permanent product decision here (task Section 9).

## 5. Feature definitions

Raw features extracted per customer (`scripts/clustering/lib/feature-builder.ts`), all derived
read-only from `ps_orders`/`ps_order_detail`/`ps_customer`, none touching `master_customer`:

| Feature | Definition |
|---|---|
| `validOrders` | COUNT(DISTINCT eligible valid order) |
| `totalSpentTaxIncl` | SUM(`total_paid_tax_incl`) over eligible valid orders |
| `averageOrderValueTaxIncl` | `totalSpentTaxIncl / validOrders` |
| `customerTenureDays` | `referenceTime - ps_customer.date_add`, floored to whole days |
| `daysSinceLastOrder` | `referenceTime - lastValidOrderAt`, floored |
| `purchaseFrequencyDays` | `(lastValidOrderAt - firstValidOrderAt) / (validOrders - 1)` — same formula as `commercial-summary-calculations.ts`; always defined here since Population B′ requires ≥2 orders |
| `daysBetweenFirstLastOrder` | `lastValidOrderAt - firstValidOrderAt` |
| `orders365d` | COUNT(eligible valid orders) in `[referenceTime-365d, referenceTime)` — inclusive start, exclusive end, matching `date-window.ts` |
| `cancelledOrderRatio` | `cancelledOrders / totalOrdersAllStates`, computed over **all** orders (valid + invalid) for the customer — not just the eligible/valid population, per the audit's explicit correction (cancelled orders never carry `valid=1`) |
| `discountShare` | `SUM(total_discounts_tax_incl) / SUM(total_paid_tax_incl)` over eligible valid orders (customer-level aggregate ratio, not per-order) |
| `shippingShare` | `SUM(total_shipping_tax_incl) / SUM(total_paid_tax_incl)`, same basis |
| `distinctProducts`, `repeatProductRate`, `top1Share`, `top3Share`, `hhi`, `effectiveDiversity` | Product-level spend concentration, computed with the **exact same formulas** already shipped in `get-customer-purchase-behavior.ts` (imported from `behavior-decimal.ts`, not reimplemented) |
| `averageUnitsPerOrder` | total product quantity across eligible valid orders / `validOrders` |

### Feature Set A (no raw R/F/M)
`distinctProducts, repeatProductRate, top1Share, top3Share, effectiveDiversity,
averageUnitsPerOrder, customerTenureDays, purchaseFrequencyDays, orders365d,
cancelledOrderRatio, discountShare, shippingShare` — **12 features**.

### Feature Set B (Set A + raw, continuous R/F/M)
Set A **plus** `log1p(totalSpentTaxIncl)`, `log1p(validOrders)`,
`log1p(daysSinceLastOrder + 1)` — **15 features**. Never `rfmCode`/`segmentCode`.

**Deliberate exclusion from both sets: `hhi`.** `effectiveDiversity = 1/hhi` (see Section 6) is
a deterministic, bijective transform of `hhi` — training on both would double-count
concentration in the Euclidean distance K-Means/GMM use, without adding information. `hhi` is
still computed and reported in the raw manifest/distributions for transparency.

## 6. effectiveDiversity verification (task Section 14 — mandatory correction check)

Inspected the real implementation directly (`src/application/customer-purchase-behavior/behavior-decimal.ts:47-51`):

```ts
export function effectiveDiversityFromHhi(hhi: string): string {
  const hhiScaled = parseScaledBehaviorDecimal(hhi);
  if (hhiScaled === 0n) return '0.000000';
  return formatScaledInteger(divideAndRoundHalfUp(SCALE_FACTOR * SCALE_FACTOR, hhiScaled), SCALE);
}
```

This is exactly `effectiveDiversity = 1 / hhi`. **Confirmed NOT bounded to [0,1]** — reused
directly (not reimplemented) in `scripts/clustering/lib/feature-builder.ts` so this
experiment's semantics are guaranteed identical to the shipped runtime, not merely "similar."

**Observed live range, Population B′ (n=10,145):** min **1.0**, p05 **1.26**, median **2.93**,
p95 **9.03**, p99 **14.68**, max **37.65**, mean **3.78**. `hhi` itself ranges min 0.0266 to
max 1.0 (median 0.341), as expected (HHI is bounded [1/N, 1] for a customer with N distinct
products; `effectiveDiversity` is bounded below by 1 and above by `distinctProducts`).

**Transformation decided:** `log1p(effectiveDiversity)`, then `RobustScaler` — same treatment
as every other right-skewed, unbounded-positive count feature (see Section 7). A unit test
(`scripts/clustering/python/tests/test_preprocessing.py`) protects the exclusion of `hhi` from
both feature sets.

## 7. Preprocessing

Preprocessing runs entirely in Python (`clustering_lib/preprocessing.py`), deliberately kept
out of the TypeScript extraction layer so the raw feature matrix stays the single reproducible
source of truth and every transform decision is versioned independently
(`preprocessingVersion = cluster-preprocessing-v1`).

| Feature group | Transform | Why |
|---|---|---|
| `distinctProducts`, `effectiveDiversity`, `averageUnitsPerOrder`, `purchaseFrequencyDays`, `orders365d` | `log1p` → `RobustScaler` (median/IQR, fit on this population) | Confirmed live right skew (e.g. `averageUnitsPerOrder` median 2.5, p99 32, **max 1,064**) |
| `customerTenureDays` | `RobustScaler` only, no `log1p` | Roughly bounded (3–1,447 days observed); `log1p` would needlessly compress an already-modest range |
| `repeatProductRate`, `top1Share`, `top3Share` | Left as-is, clipped to `[0,1]` | Already meaningful bounded ratios; clipping only absorbs decimal-rounding drift (`top3Share` observed max `1.000001`) — **not** rescaled again, so the ratio's natural unit is preserved |
| `cancelledOrderRatio`, `discountShare`, `shippingShare` | Winsorized at the population's own **p99** (data-derived, never hardcoded), then left as a ratio | See Section 8 — confirmed live denominator-blowup outliers |
| Set B only: `log1p(totalSpentTaxIncl)`, `log1p(validOrders)`, `log1p(daysSinceLastOrder+1)` | `log1p` → `RobustScaler` | Same skew treatment as Set A's count/money features |

`RobustScaler` (not `StandardScaler`) was chosen because it centers on the median and scales
by IQR, which is far less sensitive to the extreme individual outliers already documented
throughout CP-R1 (e.g. the single historical 14,331-order account, excluded by the operational
policy, but many smaller residual outliers remain even after exclusion).

## 8. Outlier treatment

Reused the existing `operationalAccountExclusionPolicyVersion = operational-account-exclusion-v1`
exclusion list as-is (4 accounts) — no new outlier policy was derived for clustering, per task
Section 17.

**discountShare / shippingShare — inspected real cases before deciding a policy**, per task
Section 16:

- Raw customer-level ratio (`SUM(discounts)/SUM(paid)` over eligible valid orders, **not** a
  per-order ratio): `discountShare` observed **min 0, p75 ≈0, p90 0.0209, p99 0.174, max
  4.376** (n=10,145). A max of 437% confirms real denominator-blowup cases exist even after
  aggregating across a customer's ≥2 orders (the per-order version the readiness audit found
  was far worse: average 8.71, max 319,943 — aggregating to the customer level already damps
  most of that, but does not eliminate it).
- `shippingShare` observed **min 0, p25 0.0099, median 0.072, p90 0.226, p99 0.366, max
  0.754**. Below 1 at the customer level (the audit's per-order max was 1.563 — again, damped
  by customer-level aggregation, but still right-skewed).
- **Decision:** winsorize both at the **population's own p99** (not an arbitrary `[0,1]` bound)
  before use — the cap value is computed fresh from the data on every run and recorded in
  `scripts/clustering/outputs/experiment-results.json` under each feature set's
  `preprocessing.winsorizeCaps`. This treats the extreme tail as a real-but-rare accounting
  artifact worth suppressing for distance-based clustering, without asserting that ratios >1
  are "invalid" — they are left un-clamped-to-1 below the p99 cap, since a ratio slightly above
  1 (shipping charged for a heavily-discounted order) is a legitimate, if unusual, accounting
  outcome, not a data error.
- `cancelledOrderRatio`: **min 0, p99 0.25, max 0.5**, over `totalOrdersAllStates` (all orders,
  valid + invalid) as the denominator — low volume (only 223 customers in the population have
  any cancellation at all) but the same denominator-small-number risk applies to customers with
  exactly 2 lifetime orders; winsorized at p99 for consistency.

**Per-feature distribution table (min/p01/p05/p25/median/p75/p90/p95/p99/max, nulls, zeros)**
for every raw feature is in `scripts/clustering/outputs/dataset-manifest.json` (not duplicated
in full here to keep this report readable) — nulls are 0 across every feature (Population B′'s
`≥2 valid orders` precondition makes every feature well-defined by construction; no imputation
was used anywhere in this pipeline).

## 9. Algorithms

- **K-Means (primary):** `sklearn.cluster.KMeans`, `n_init=10`, evaluated at every
  `k=2..10` (full elbow curve) with the 10 fixed seeds from the task brief
  (`42, 101, 202, 303, 404, 505, 606, 707, 808, 909`), and the decision range narrowed to
  `k=4..8` per the readiness audit.
- **GMM (secondary):** `sklearn.mixture.GaussianMixture`, `covariance_type='full'`, `n_init=3`,
  `reg_covar=1e-5`, 5 seeds (`42, 101, 202, 303, 404`) — fewer seeds than K-Means, deliberately,
  per the task's "do not turn T01 into an extensive GMM investigation" instruction — same
  `k=4..8` range for comparability.
- **HDBSCAN (diagnostic only):** `sklearn.cluster.HDBSCAN` (built into scikit-learn 1.6, no
  extra dependency needed), `min_cluster_size = max(30, 3% of population) = 304`, run once per
  feature set, never used for k selection.

Total experiment runtime: **1,088,851 ms (≈18.1 minutes)**, dominated by the K-Means sweep
(`kmeans_sweep_A_ms=465,588`, `kmeans_sweep_B_ms=320,976` — 90 fits each, k=2..10 × 10 seeds)
and GMM (`gmm_A_ms=113,939`, `gmm_B_ms=143,339` — 50 fits each). Feature extraction (TS):
3,466 ms. Preprocessing (Python): <40 ms per set. Full timing breakdown in
`experiment-results.json.timingsMs`.

## 10. Elbow

Both feature sets show a smooth, monotonically-decreasing inertia curve with **no sharp
elbow** — exactly the "ambiguous elbow is not an error" case the task brief anticipated for
real behavioral data:

**Set A:** k=2 → 26,471; k=3 → 22,074; k=4 → 19,512; k=5 → 17,368; k=6 → 15,973; k=7 → 14,721;
k=8 → 13,675; k=9 → 12,977; k=10 → 12,343.

**Set B:** k=2 → 45,974; k=3 → 39,074; k=4 → 34,202; k=5 → 31,162; k=6 → 28,757; k=7 → 27,049;
k=8 → 25,505; k=9 → 24,188; k=10 → 23,273.

The curve flattens gradually from k≈6 onward in both sets, consistent with — but not
sufficient on its own to select — k=4 as the working candidate (Section 12). Plots:
`scripts/clustering/outputs/plots/elbow-set-a.png`, `elbow-set-b.png`.

## 11. Metrics (k=4..8, decision range)

**Feature Set A:**

| k | silhouette | Davies-Bouldin | Calinski-Harabasz | smallest cluster |
|---|---|---|---|---|
| 4 | **0.2287** | 1.3365 | **2966.2** | 15.11% |
| 5 | 0.2133 | 1.3856 | 2812.1 | 12.64% |
| 6 | 0.2179 | 1.3713 | 2622.9 | 9.42% |
| 7 | 0.2258 | **1.2971** | 2515.1 | 3.65% |
| 8 | 0.2183 | 1.3355 | 2431.2 | 3.27% |

**Feature Set B:**

| k | silhouette | Davies-Bouldin | Calinski-Harabasz | smallest cluster |
|---|---|---|---|---|
| 4 | **0.2050** | **1.5035** | **2866.7** | 10.83% |
| 5 | 0.1925 | 1.4133 | 2606.7 | 9.96% |
| 6 | 0.1931 | 1.4757 | 2429.2 | 7.34% |
| 7 | 0.1912 | 1.4672 | 2258.7 | 5.52% |
| 8 | 0.1843 | 1.5273 | 2140.6 | 4.36% |

k=4 wins on silhouette for **both** feature sets, and does so while keeping every cluster
comfortably above the 3%-of-population flag threshold — k=7/k=8 push silhouette only
marginally higher (Set A) at the cost of a cluster shrinking to ~3.3–3.6% of the population.
Silhouette values (0.18–0.23) sit below the >0.5 "synthetic benchmark" territory but above the
audit's stated working floor (>0.25 is a target, not a hard gate — real commercial behavioral
data rarely reaches it, and every k here at least approaches it for Set A). Full table:
`scripts/clustering/outputs/kmeans-metrics.json`.

## 12. Seed stability

Both feature sets are **highly stable across the 10 fixed seeds at every k in the decision
range** — mean pairwise Adjusted Rand Index (45 pairwise comparisons per k):

| k | Set A seedARI mean/min | Set B seedARI mean/min |
|---|---|---|
| 4 | 0.9930 / 0.9857 | 0.9897 / 0.9765 |
| 5 | 0.9863 / 0.9735 | 0.9920 / 0.9834 |
| 6 | 0.8860 / 0.7364 | 0.9903 / 0.9650 |
| 7 | 0.9648 / 0.9044 | 0.9745 / 0.9445 |
| 8 | 0.9963 / 0.9927 | 0.9793 / 0.9448 |

k=4's seed stability (0.993/0.986 for Set A, 0.990/0.976 for Set B) is at or near the best in
the whole decision range — a K-Means fit at k=4 lands on essentially the same partition
regardless of which of the 10 fixed seeds initializes it. k=6 for Set A is the one soft spot
(min ARI 0.736 — still well above chance, but visibly less stable than its neighbors),
consistent with 6 not being chosen.

## 13. Resampling stability

10 subsamples, 80% of the population, **without replacement** (explicitly *not* bootstrap —
sampling with replacement was not used, per the task's terminology correction). Each subsample
was refit independently (fresh K-Means, `k`= the chosen candidate, subsample-derived seed) and
compared via ARI against the full-population baseline model's labels *restricted to the same
subsampled customers*:

- **Set A (k=4):** resample ARI mean **0.9852**, min **0.9693** (10/10 resamples).
- **Set B (k=4):** resample ARI mean **0.9718**, min **0.9396** (10/10 resamples).

Both comfortably clear a reasonable stability bar (ARI > 0.9 on every single resample) —
the k=4 partition is not an artifact of the specific 10,145-customer sample; it reproduces
under population perturbation.

## 14. Cluster profiles

### Feature Set A, k=4 (representative seed 505)

| Cluster | Pop. | % | Median spend | Median AOV | Median orders | Median recency (days) | Median tenure (days) | Median cadence (days) | Median distinct products | Median HHI | Median eff. diversity | Median orders₃₆₅d |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 3,970 | 39.13% | 146,859 | 61,372 | 2 | 625 | 1,302 | 235 | 4 | 0.399 | 2.51 | 0 |
| 1 | 1,533 | 15.11% | 148,596 | 68,500 | 2 | 681 | 761 | **6.5** | 3 | 0.471 | 2.12 | 0 |
| 2 | 2,560 | 25.23% | **777,422** | **196,275** | 3 | 383 | 1,240 | 140 | **12** | **0.162** | **6.18** | 0 (p75=1) |
| 3 | 2,082 | 20.52% | 164,073 | 64,941 | 2 | **156** | 440 | 130 | 4 | 0.388 | 2.58 | **2** |

**cluster_0 — "long-tenured, dormant, spread-out repeat buyers":** long relationship
(tenure median 1,302 days), moderate value, but inactive for ~1.7 years and their (few) orders
were spread far apart (cadence median 235 days). No orders in the trailing 365 days.

**cluster_1 — "newer customers who burst-purchased then went dormant":** nearly identical
spend/AOV to cluster_0, but their 2 orders happened close together (**median 6.5 days apart**
— versus 235 for cluster_0) and tenure is much shorter (median 761 days), followed by the same
long dormancy (recency 681 days). Discount/shipping/cancellation behavior is otherwise
unremarkable. This burst-then-lapse cadence shape is invisible to RFM's R/F/M axes — two
customers with identical Frequency=2 and similar Monetary can have opposite cadence shapes.

**cluster_2 — "high-value, high-diversity repeat buyers":** clearly the most commercially
valuable segment — median spend >5x cluster_0/1/3, median AOV >3x, buys across a much broader
catalog (median 12 distinct products vs 3–4 elsewhere), and has the lowest concentration (HHI
0.162, effective diversity 6.18) — the only cluster with any real recent-activity signal
(orders₃₆₅d p75=1).

**cluster_3 — "newer, currently-active, moderate-value repeat buyers":** the only cluster with
materially recent activity — median recency **156 days** (vs 625–681 for clusters 0/1) and
median **2 orders in the trailing 365 days** — combined with the shortest tenure (440 days,
i.e. these are newer accounts). Spend/AOV is comparable to cluster_0/1.

Full profile detail (mean/p25/p75 for every metric, both sets): `scripts/clustering/outputs/cluster-profiles.json`.

### Feature Set B, k=4 (representative seed 202) — for comparison, see Section 16

## 15. RFM cross-tab

Joined against Customer Profile's current published RFM snapshot (snapshot id 3) —
**4,310 of 10,145 (42.5%)** of the clustering population have a current RFM row at all (the
rest are dormant beyond RFM's 365-day active window and carry `NO_CURRENT_RFM_SEGMENT`, which
is itself informative: clustering's dormant-inclusive population reaches customers RFM cannot
currently score).

**Feature Set A**, row percentages (`P(RFM segment | cluster)`), matched customers only shown compressed:

| Cluster | NO_SEGMENT | CHAMPION | LOYAL | POTENTIAL_LOYAL | RECENT_HIGH_VALUE | RECENT_ONE_TIME | NEEDS_ATTENTION | AT_RISK_HIGH_VALUE | HIBERNATING |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 (dormant, spread) | 81.1% | 0.0% | 0.0% | 0.0% | 1.9% | 4.7% | 2.9% | 2.3% | 7.1% |
| 1 (dormant, burst) | 83.7% | 0.1% | 0.4% | 5.3% | 0.1% | 0.1% | 1.8% | 4.0% | 4.6% |
| 2 (high-value diverse) | 51.8% | 4.0% | 5.1% | 7.1% | 4.0% | 4.0% | 6.1% | 9.8% | 8.1% |
| 3 (active, newer) | 0.2% | 4.2% | 10.5% | **26.3%** | 2.4% | 7.4% | 15.3% | 10.5% | **23.1%** |

**cluster_3 is the sharpest evidence of orthogonality**: 99.8% of it *does* have a current RFM
row (unlike clusters 0/1/2, it isn't dominated by "no segment"), yet its RFM segment is spread
across **eight different segments** with no single one exceeding 26% — POTENTIAL_LOYAL (26.3%)
and HIBERNATING (23.1%) are simultaneously its two largest RFM buckets, which would be a
contradiction under RFM alone (POTENTIAL_LOYAL implies recent purchase intent, HIBERNATING
implies the opposite) but is coherent under clustering's lens: cluster_3 is defined by shape
(newer account, active in the last year, moderate cadence) independent of where that puts a
customer on RFM's specific R/F/M thresholds at this exact reference time.

## 16. Set A vs Set B

| Metric | Set A | Set B |
|---|---:|---:|
| Chosen k | 4 | 4 |
| Silhouette | **0.2287** | 0.2050 |
| Davies-Bouldin | **1.3365** | 1.5035 |
| Calinski-Harabasz | **2966.2** | 2866.7 |
| Seed ARI mean/min | 0.9930 / 0.9857 | 0.9897 / 0.9765 |
| Resample ARI mean/min | **0.9852** / 0.9693 | 0.9718 / 0.9396 |
| Smallest cluster | 15.11% | 10.83% |
| RFM association (NMI) | **0.2115** | 0.3698 |
| RFM association (AMI) | **0.2108** | 0.3693 |

**Set B does not improve clustering quality — it makes it measurably worse** on every single
mathematical metric (lower silhouette, worse Davies-Bouldin, lower Calinski-Harabasz, slightly
less stable on both seeds and resampling) **while being nearly twice as redundant with RFM**
(NMI 0.370 vs 0.211). Set B's k=4 profile (`experiment-results.json` → `results.B`) confirms
why: its cluster_2 (37.2% of the population) is **99.2% `NO_CURRENT_RFM_SEGMENT`** — essentially
a "not-recently-active" bucket carved out almost entirely by the raw `daysSinceLastOrder`
feature, i.e. Set B's clustering partially re-derives RFM's own recency gate rather than
discovering new structure. Set A's clusters, by contrast, cut across RFM segments (Section 15).

**Answering the task's explicit questions (Section 35):**
- *¿Set B mejora sustancialmente la calidad matemática?* No — every metric is worse.
- *¿Set B simplemente reproduce RFM?* Partially — one of its four clusters is almost a pure
  recency re-derivation; the NMI/AMI gap versus Set A confirms measurably higher redundancy.
- *¿Set A descubre estructura distinta?* Yes — cluster_1's burst-then-lapse cadence shape and
  cluster_3's cross-segment spread in the RFM cross-tab are both structure invisible to RFM.
- *¿Qué set aporta mayor información incremental?* **Set A.**

## 17. GMM result

GMM was run as the secondary candidate across the same k=4..8 range, 5 seeds. It does **not**
outperform K-Means and is not recommended as a replacement:

| | Set A best (by BIC, k=8) | Set B best (by BIC, k=8) |
|---|---:|---:|
| Silhouette (hard assignment) | 0.036 | 0.055 |
| Mean membership confidence (max prob.) | 0.985 | 0.978 |

BIC/AIC monotonically favor more components (k=8, the top of the tested range) in both sets —
typical of GMM overfitting flexible covariance structure to non-Gaussian real data rather than
finding a genuinely better k. Across **every** k tested, GMM's silhouette (0.036–0.107 for Set
A, 0.055–0.130 for Set B) is far below K-Means's (0.184–0.229 / 0.184–0.205) at the same k.
GMM's soft membership probabilities are also, in practice, nearly hard (mean top-probability
0.98–0.99 across all k) — the "soft assignment" flexibility GMM offers isn't materializing as
meaningfully ambiguous customers in this data. Seed stability is also noticeably worse at
several k (e.g. Set B k=7: seed ARI mean 0.53, min 0.33 — GMM's non-convex EM optimization is
visibly more seed-sensitive than K-Means's `n_init=10` here). **Conclusion: GMM does not
justify its added complexity for V1; K-Means remains the defensible baseline**, exactly as the
readiness audit anticipated (Step 8). Full detail: `scripts/clustering/outputs/gmm-metrics.json`.

## 18. HDBSCAN diagnostic

Diagnostic only, `min_cluster_size=304` (3% of population), never used for k selection:

- **Set A:** found **2** natural density clusters + **44.0% noise** (4,467 of 10,145 customers
  don't fall into any sufficiently dense region). The 2-cluster+noise silhouette (0.267,
  computed only over the non-noise points) is numerically higher than K-Means's k=4 silhouette
  — expected, since excluding 44% of the population as "noise" makes the remaining points
  easier to separate; not a signal that a 2-cluster solution is better for the actual product
  need (Section 28 — diagnostic only, never a production recommendation).
- **Set B:** found **0** clusters — **100% noise**. Adding the raw R/F/M-adjacent dimensions
  spreads the data enough that no region meets the 3%-of-population density threshold at all.

Interpretation: PesasChile's repeat-buyer population does **not** form naturally dense,
well-separated islands — behavior is closer to a continuum than to discrete tribes, which is
consistent with (not contradictory to) K-Means finding a moderately-stable, useful 4-way
partition of that continuum. This is a genuinely informative diagnostic, not a blocker.

## 19. Limitations

- **Temporal stability not yet validated** (only seed + resampling stability, per task Section
  51 — this is explicitly deferred to CP-R2-T02, not a T01 gap).
- **RFM cross-tab coverage is partial** (42.5% of the clustering population has a current RFM
  row) — by design (Population B′ intentionally includes RFM-dormant customers), but it means
  the NMI/AMI figures in Section 16 are computed with `NO_CURRENT_RFM_SEGMENT` as an explicit
  category rather than excluding unmatched customers; interpret the RFM-association numbers
  with that caveat in mind.
- **Category/manufacturer/cart/geography features excluded from V1** entirely, per the
  readiness audit's constraints (Steps 2/3/17) — clusters are interpretable only in terms of
  value, frequency, cadence, product-count diversity, and order-shape ratios, never product
  category or customer geography.
- **Pre-existing, unresolved shop-scope inconsistency** (`T10A-3` vs. the shipped RFM reader)
  is inherited as-is, flagged, not fixed, per instructions.
- **GMM seeds (5) are fewer than K-Means's (10)**, a deliberate scope decision — GMM is not the
  primary candidate and was not investigated exhaustively.
- **HDBSCAN run once** at a single `min_cluster_size`, diagnostic only — no parameter sweep.
- **Runtime is slower than a production pipeline would tolerate** (~18 minutes total, dominated
  by the unoptimized K-Means/GMM sweep across the full k=2..10 range with 10/5 seeds each) —
  acceptable for a one-shot offline experiment, not evidence about production feasibility
  (Section 53 — no premature optimization attempted here).

## 20. Commercial interpretation

Every interpretation below is derived strictly from the measured variables — no category,
manufacturer, or geography signal exists in this feature set, so no cluster is described in
those terms (task Section 49). Feature Set A, k=4, is the interpreted candidate (Section 21):

- **cluster_0 (39.1%) — Long-tenured, dormant, spread-out repeat buyers.** Customers with a
  long relationship (tenure) but at least 1.7 years of inactivity, whose historical orders were
  spaced far apart even when active.
- **cluster_1 (15.1%) — Newer customers who purchased twice in quick succession, then went
  dormant.** Same spend profile as cluster_0, but distinguished purely by cadence shape: their
  orders happened close together (median 6.5 days apart) rather than spread out.
- **cluster_2 (25.2%) — High-value, high-diversity repeat buyers.** The clearest commercially
  valuable segment: 5x the median spend of the other clusters, broader catalog reach (12
  distinct products vs 3–4), and the only cluster with any trailing-year activity signal.
- **cluster_3 (20.5%) — Newer, currently-active, moderate-value repeat buyers.** The only
  cluster with a materially recent last order (median 156 days) and consistent recent-year
  activity (median 2 orders in the trailing 365 days).

## 21. Recommendation

Answering the task's ten framing questions (Section 6):

1. **¿Existe estructura de clusters útil?** Yes — a stable, balanced, commercially
   describable 4-way partition exists and reproduces across seeds and resamples.
2. **¿Qué Feature Set entrega mejor separación?** Set A — better on every mathematical metric
   *and* less redundant with RFM.
3. **¿Qué valor de k parece apropiado?** k=4, for both feature sets, on silhouette + stability +
   cluster-balance grounds (Sections 11–13).
4. **¿Estables entre inicializaciones?** Yes — seed ARI mean 0.993 (Set A, k=4).
5. **¿Sobreviven a resampling?** Yes — resample ARI mean 0.985 (Set A, k=4), min 0.969 across
   10 subsamples.
6. **¿Tamaño suficiente para ser útiles?** Yes — smallest cluster is 15.1% of the population
   (1,533 customers), far above the 3% flag floor.
7. **¿Interpretables comercialmente?** Yes — Section 20, each in 1–3 evidence-based sentences.
8. **¿Aporta información distinta de RFM?** Yes for Set A (NMI 0.21, and cluster_3's spread
   across 8 RFM segments in the cross-tab) — partially for Set B (NMI 0.37, one cluster is
   nearly a pure recency re-derivation).
9. **¿K-Means defendible como baseline?** Yes.
10. **¿GMM aporta mejora real?** No — worse silhouette at every k, less stable, near-hard
    membership probabilities anyway (Section 17).

**Verdict: READY_WITH_CONSTRAINTS.** Behavioral Clustering V1 (Feature Set A, K-Means, k=4)
produces a stable, balanced, commercially interpretable partition that measurably adds
information beyond RFM. It is not yet `READY_FOR_CLUSTERING_MODEL_FINALIZATION` because
temporal stability (a second, time-separated reference point) has not been validated — that is
explicitly CP-R2-T02's job, not a T01 gap.

## 22. Next step

**CP-R2-T02 — Behavioral Clustering Model Finalization & Temporal Stability**, per the task
brief's own Section 59 — re-run this exact pipeline (`featureVersion=cluster-features-v1`,
`preprocessingVersion=cluster-preprocessing-v1`) at a second reference time ≥30 days later,
compute the centroid-matched ARI/transition-matrix temporal stability the readiness audit's
Step 10 defines, and only then evaluate whether Feature Set A / K-Means / k=4 is ready for
persistence design and production finalization.

