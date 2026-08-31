# CUSTOMER-INTELLIGENCE-CLV-A04.1 Ranking & Calibration Correction

Status: **NEEDS FIXES**.

Type: targeted deterministic correction on top of the A04 two-stage CLV family. No production CLV snapshot, no Customer Intelligence integration, no migrations, and no production DB writes.

## 1. Model Lineage

Model family version remains:

```text
customer-clv-two-stage-cohort-v1
```

That version now unambiguously refers to the explicit two-stage expected-value family:

```text
expectedRevenue12m =
P(active within next 12 months | history)
*
E(revenue within next 12 months | active, history)
```

A04.1 changes the estimator policy, not the family semantics.

Selected A04.1 estimator:

```text
two-stage-cohort-a04-band-recency-rank50-refined-v1
```

## 2. Root Cause Diagnosis

A04 improved calibration and error materially, but it still failed acceptance on Monday, August 31, 2026 because ranking was being lost in three specific places:

1. Stage A still overpredicted low-probability and stale populations.
2. Stage B conditional value had useful rank inside active customers, but that signal collapsed into repeated cohort-level predictions.
3. Final expected revenue inherited extreme tie density, especially at the top of the list.

A04 original diagnostics:

- Stage A revenue Spearman: `0.191000`
- Stage B conditional Spearman among active customers: `0.356830`
- final expected revenue Spearman: `0.173843`
- historical `revenue365d` Spearman: `0.199856`
- top-1% tie rate: `0.995717`
- top-decile tie rate: `0.997965`
- stale calibration distance (`366-730d` + `>730d`): `5.220476`

Interpretation: Stage B already contained useful ordering, but the final product lost it through stale Stage A inflation and heavy cohort ties.

## 3. Correction Candidate Set

Evaluated candidates:

- `two-stage-cohort-a04-original-v1`
- `two-stage-cohort-a04-band-calibrated-v1`
- `two-stage-cohort-a04-band-recency-rank25-v1`
- `two-stage-cohort-a04-band-recency-rank50-refined-v1`

Selection rule version:

```text
customer-clv-two-stage-selection-temporal-calibration-ranking-stale-ties-v1
```

Ordered priorities:

1. temporal correctness
2. calibration
3. top-N capture
4. Spearman / ranking
5. stale-customer behavior
6. tie reduction
7. reliability validity
8. interpretability

## 4. Training Time Policy

Temporal protocol is unchanged:

```text
customer-clv-training-label-window-known-by-eval-cutoff-v1
```

For evaluation cutoff `T`, training labels remain constrained to:

```text
labelWindowEndExclusive <= T
```

Rolling-origin evaluation cutoffs:

- `2024-01-01T00:00:00.000Z`
- `2024-07-01T00:00:00.000Z`
- `2025-01-01T00:00:00.000Z`
- `2025-07-01T00:00:00.000Z`

## 5. Activity Recalibration

Policy version:

```text
customer-clv-two-stage-activity-recalibration-band-recency-v1
```

Selected strategy:

```text
probability_band_broad_recency
```

Calibration surface:

```text
predicted probability band
-> broad recency class
-> shrunk observed activity rate from training only
```

Broad recency classes:

- `0-180d`
- `181-730d`
- `>730d`

Activity calibration remains deterministic, bounded to `[0,1]`, monotonic across probability bands inside each broad recency class, and fitted from training datasets only.

Observed selected-candidate activity bands:

| Band | Customers | Mean Predicted | Actual Activity | Calibration |
| --- | ---: | ---: | ---: | ---: |
| `(0.05,0.10]` | `32,205` | `0.077264` | `0.059711` | `1.293961` |
| `(0.10,0.20]` | `40,437` | `0.150597` | `0.092539` | `1.627390` |
| `(0.20,0.35]` | `16,464` | `0.232758` | `0.158771` | `1.465999` |
| `(0.35,1.00]` | `4,267` | `0.494813` | `0.429576` | `1.151864` |

This is still imperfect, but stale overprediction dropped materially versus A04.

## 6. Conditional Value Rank Refinement

Policy version:

```text
customer-clv-two-stage-value-rank-refinement-log1p-revenue365d-v1
```

Selected signal:

```text
log1p(revenue365d)
```

Selected lambda:

```text
0.500000
```

Factor bounds:

- min: `0.500000`
- max: `2.000000`

Refinement formula:

```text
base conditional cohort expectation
*
normalized individual multiplier
```

with:

```text
multiplier =
1 + lambda * (normalizedSignal - 1)
```

and a training-derived cohort normalization step so the mean multiplier within the resolved value cohort stays approximately `1`.

This preserved expected-value semantics while breaking the A04 top-end tie collapse.

## 7. High-Value Cohort Refinement

Selected value cohort strategy:

```text
order_depth_recency_revenue365d_refined
```

Refined upper monetary buckets:

- `(400k,800k]`
- `(800k,1.5m]`
- `>1.5m`

Fallback hierarchy remains:

```text
exact
-> orderDepth x recency
-> recency
-> global
```

Stage B still trains only on customers with `futureRevenueTaxIncl > 0`.

## 8. Tie Diagnostics

Selected candidate tie diagnostics:

- unique predictions: `37,452`
- shared-prediction customers: `59,792`
- shared-prediction rate: `0.640356`
- top-decile tie rate: `0.121761`
- top-1% tie rate: `0.002141`

Against A04 original:

- shared-prediction rate improved from `0.999764` to `0.640356`
- top-decile tie rate improved from `0.997965` to `0.121761`
- top-1% tie rate improved from `0.995717` to `0.002141`

This is the clearest empirical correction in A04.1.

## 9. Selected Candidate Results

Overall revenue metrics across `93,373` evaluated customer-cutoff rows:

- calibration ratio: `1.183603`
- MAE: `65734.115907`
- median absolute error: `24426.725690`
- RMSE: `317751.184996`
- Spearman: `0.204888`
- top `1%`: `0.187249`
- top `5%`: `0.367523`
- top `10%`: `0.502482`
- top `20%`: `0.646143`

Stage A activity metrics:

- actual activity rate: `0.108297`
- predicted activity rate: `0.155521`
- ROC-AUC: `0.673678`
- PR-AUC: `0.241514`
- Brier: `0.092689`

Stage B conditional value metrics among active customers:

- active customers: `10,112`
- calibration ratio: `0.957110`
- MAE: `342131.674020`
- median absolute error: `175295.898870`
- RMSE: `896732.407219`
- Spearman: `0.386708`
- predicted active mean revenue: `327788.243424` CLP
- actual active mean revenue: `342477.105222` CLP

## 10. Comparison Against Baselines and A04

| Model | Calibration | MAE | Median AE | Spearman | Top1 | Top5 | Top10 | Top20 | Activity PR-AUC | Activity Brier |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `historical-12m-revenue-v1` | `2.922393` | `113328.735242` | `n/a` | `0.199856` | `0.204199` | `0.418503` | `0.563822` | `0.686192` | `n/a` | `n/a` |
| `simple-cohort-prior-v1` | `1.627739` | `80925.696195` | `n/a` | `0.174754` | `0.134895` | `0.320829` | `0.437340` | `0.562536` | `0.258145` | `0.093579` |
| `two-stage-cohort-a04-original-v1` | `1.417496` | `73623.743413` | `43124.345437` | `0.173843` | `0.151451` | `0.384389` | `0.488771` | `0.572499` | `0.256496` | `0.092366` |
| `two-stage-cohort-a04-band-recency-rank50-refined-v1` | `1.183603` | `65734.115907` | `24426.725690` | `0.204888` | `0.187249` | `0.367523` | `0.502482` | `0.646143` | `0.241514` | `0.092689` |

Interpretation:

- A04.1 materially improved calibration, MAE, median AE, Spearman, top-1, top-10, and top-20 versus A04.
- A04.1 now beats both A04 and the historical-12m baseline on overall Spearman.
- A04.1 still does not recover enough top-10 capture against `historical-12m-revenue-v1`; gap remains `0.061340`.
- Top-5 capture regressed versus both A04 and `historical-12m-revenue-v1`, which is another sign that the ranking repair is incomplete.

## 11. One-Order and Stale Customers

History-depth results:

- `1` order: calibration `1.531102`, MAE `40104.608648`, Spearman `0.065764`
- `2` orders: calibration `1.228965`, MAE `108558.585336`, Spearman `0.124024`
- `3-4` orders: calibration `1.063982`, MAE `191536.832300`, Spearman `0.210356`
- `5+` orders: calibration `0.657936`, MAE `429445.349151`, Spearman `0.290863`

Recency results:

- `0-90d`: calibration `1.008637`, Spearman `0.334083`
- `91-180d`: calibration `0.937433`, Spearman `0.260764`
- `181-365d`: calibration `1.252879`, Spearman `0.155794`
- `366-730d`: calibration `1.515698`, Spearman `0.096613`
- `>730d`: calibration `2.580546`, Spearman `0.019657`

Interpretation:

- one-order ranking improved from A04 `0.038497` to `0.065764`, but it remains weak and should not be overinterpreted.
- stale customers are no longer forced to zero and are materially better calibrated than A04.
- stale overprediction is still too high, especially for `>730d`.

## 12. Reliability Policy

Policy version remains:

```text
customer-clv-two-stage-reliability-history-support-fallback-v1
```

Scale-aware validation was added through:

```text
customer-clv-two-stage-reliability-scale-aware-v1
```

Observed results:

| Bucket | Customers | Activity Calibration | Revenue Calibration | Normalized AE | Spearman |
| --- | ---: | ---: | ---: | ---: | ---: |
| `LOW` | `83,645` | `1.494562` | `1.190308` | `0.963022` | `0.161931` |
| `MEDIUM` | `9,401` | `1.227904` | `1.130758` | `0.902145` | `0.234746` |
| `HIGH` | `327` | `1.242568` | `1.720211` | `0.796380` | `0.034445` |

Interpretation:

- relative error improves from `LOW` to `HIGH`
- calibration and ranking do not improve consistently into `HIGH`
- `HIGH` is too narrow and too unstable to treat as a valid downstream reliability promise

This failed the A04.1 acceptance gate.

## 13. Top-Customer Sanity Check

The selected candidate no longer emits the A04-style identical top predictions.

Observed top predictions are now differentiated inside the same high-value cohort, but the top list still contains occasional future-zero customers, which is acceptable under uncertainty for an expected-value model.

The largest selected predictions remain around `1.06m` to `1.09m` CLP expected 12m revenue. They are high, but not explosively disconnected from the customers' historical spend and activity estimates.

## 14. Temporal Debt

A02 / A03 temporal order-state debt is carried unchanged:

- historical order validity still relies on observed `ps_orders.valid`
- `ps_orders.current_state` is not reconstructed point-in-time from `ps_order_history`
- the affected population remains around the documented `~1%` historical-order slice

No further scope expansion was introduced in A04.1.

## 15. Acceptance Decision

Decision:

```text
CLV_MODEL_V1_NEEDS_FIXES
```

Why it is not accepted yet:

1. top-10 capture is still materially below the `historical-12m-revenue-v1` benchmark
2. stale overprediction, while much better, remains elevated in `>730d`
3. `HIGH` reliability is not yet a trustworthy quality bucket

Why it is not rejected:

1. calibration improved sharply versus every prior revenue baseline
2. MAE and median AE improved materially versus A04
3. final revenue Spearman now exceeds the historical-12m baseline
4. tie collapse was corrected decisively

The model family remains viable. The next work item is hardening, not replacement.
