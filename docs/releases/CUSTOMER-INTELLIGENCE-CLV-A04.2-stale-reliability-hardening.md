# CUSTOMER-INTELLIGENCE-CLV-A04.2 Stale Activity Calibration + Reliability Semantics Hardening

Supersession note from A04.3 on Monday, August 31, 2026:

- A04.2 remains the historical baseline candidate for stale-handling comparison
- its `LOW`/`MEDIUM` reliability semantics were superseded after empirical validation failed
- the public contract field is now `estimateSupportLevel`, which describes evidence support rather than predictive reliability

Status: **HARDENING NEEDS FIXES**.

Date of evaluation: **Monday, August 31, 2026**.

Type: final pre-acceptance hardening pass for the deterministic two-stage CLV family. No production CLV snapshot, no Customer Intelligence integration, no DB migrations, and no production DB writes.

## 1. Outcome

Decision:

```text
CLV_MODEL_V1_HARDENING_NEEDS_FIXES
```

Selected A04.2 candidate:

```text
two-stage-cohort-a04-2-stale-support-recent2-v1
```

Model family version remains:

```text
customer-clv-two-stage-cohort-v1
```

The hardening pass improves overall revenue calibration and MAE versus A04.1, but it does not fix the far-stale activity inflation enough to freeze the model for independent A05 acceptance validation.

## 2. Frozen Family Semantics

The family semantics are unchanged:

```text
expectedRevenue12m =
P(active within next 12 months | history)
*
E(revenue within next 12 months | active, history)
```

Stage B stayed frozen during A04.2:

- conditional value rank signal: `log1p_revenue365d`
- lambda: `0.500000`
- factor bounds: `[0.500000, 2.000000]`
- value training window: `all_eligible_cutoffs`
- value cohort strategy: `order_depth_recency_revenue365d_refined`

The only intended A04.2 movement was on Stage A stale handling and reliability semantics.

## 3. Root Cause Audit

Observed stale support across evaluation populations:

| Bucket | Customers | Actual activity | Mean actual revenue |
| --- | ---: | ---: | ---: |
| `366-730d` | `32,011` | `0.068695` | `18,141.882478` |
| `731-1095d` | `11,671` | `0.045240` | `9,308.616314` |

This confirms the stale population is large enough to matter commercially and low enough in activity that an overly warm prior produces systematic inflation.

The main A04.1 failure mode remained the same on Monday, August 31, 2026:

- `366-730d` activity calibration: `1.916260`
- `731-1095d` activity calibration: `2.978400`

A04.2 introduced a stale-parent recalibration policy:

```text
customer-clv-two-stage-activity-recalibration-stale-parent-v1
```

with recalibration hierarchy:

```text
probability band x stale-recency bucket
-> stale-recency parent
-> probability band
-> global
```

stale recalibration buckets:

- `0-180d`
- `181-365d`
- `366-730d`
- `731-1095d`
- `>1095d`

## 4. Selected A04.2 Policy

Stage A activity cohort model:

- exact dimensions: `orderDepth x recency x tenure`
- fallback hierarchy: `exact -> order_recency -> recency -> global`
- shrinkage strengths:
  - exact: `30`
  - order-recency: `45`
  - recency: `60`
- activity training window: `recent_2_eligible_cutoffs`

Stage B conditional value model:

- exact dimensions: `orderDepth x recency x revenue365dBucket`
- estimator: `shrunk_arithmetic_mean`
- fallback hierarchy: `exact -> order_recency -> recency -> global`
- shrinkage strengths:
  - exact: `20`
  - order-recency: `30`
  - recency: `45`

Reliability policy stayed support-based, not score-magnitude-based:

```text
customer-clv-two-stage-reliability-history-support-fallback-v1
customer-clv-two-stage-reliability-scale-aware-v1
```

Current rule:

- `LOW` if deep fallback, weak activity support, weak value support, low cutoff coverage, or `daysSinceLastOrder > 730`
- otherwise `MEDIUM`
- no `HIGH` bucket emitted

## 5. Evaluation Result

Overall revenue metrics for the selected A04.2 candidate:

| Metric | Value |
| --- | ---: |
| calibration | `1.165486` |
| MAE | `65,276.447529` |
| median AE | `24,325.361306` |
| RMSE | `317,840.722373` |
| Spearman | `0.204876` |
| top 1% capture | `0.185445` |
| top 5% capture | `0.364948` |
| top 10% capture | `0.498747` |
| top 20% capture | `0.643768` |

Stage A activity metrics:

| Metric | Value |
| --- | ---: |
| actual activity rate | `0.108297` |
| predicted activity rate | `0.153312` |
| ROC-AUC | `0.673471` |
| PR-AUC | `0.242120` |
| Brier | `0.092455` |

Stage B conditional value metrics among active customers:

| Metric | Value |
| --- | ---: |
| calibration | `0.957110` |
| MAE | `342,131.674020` |
| median AE | `175,295.898870` |
| RMSE | `896,732.407219` |
| Spearman | `0.386708` |

## 6. What Improved

Against A04.1 selected candidate `two-stage-cohort-a04-band-recency-rank50-refined-v1`:

- calibration improved from `1.183603` to `1.165486`
- MAE improved from `65,734.115907` to `65,276.447529`
- median AE improved from `24,426.725690` to `24,325.361306`
- activity PR-AUC improved from `0.241514` to `0.242120`
- activity Brier improved from `0.092689` to `0.092455`

Recent-population behavior stayed effectively stable:

- recent activity distance A04.1: `0.000000`
- recent activity distance A04.2: `0.000000`

## 7. Why Acceptance Still Fails

The acceptance rule version was:

```text
customer-clv-two-stage-acceptance-a04-2-v1
```

Passed checks:

- temporal correctness
- Stage B frozen
- calibration improves over historical
- calibration remains competitive with simple cohort prior
- no material MAE regression versus A04.1
- no material Spearman regression versus A04.1
- still beats historical baseline on overall Spearman
- recent activity stable
- activity Brier stable
- activity PR-AUC stable
- top-10 capture remains above simple cohort prior

Failed checks:

- `staleActivityImproves = false`
- `farStaleActivityAcceptable = false`
- `reliabilitySupportSemanticsValid = false`

The stale issue is explicit in the recency audit:

| Bucket | A04.1 activity cal | A04.2 activity cal |
| --- | ---: | ---: |
| `366-730d` | `1.916260` | `1.868337` |
| `731-1095d` | `2.978400` | `2.978400` |

This is only a small mid-stale improvement and no far-stale improvement at all.

Stale distance summary:

- A04.1: `2.894660`
- A04.2: `2.846737`

That is directionally better, but not acceptance-grade.

## 8. Reliability Audit

Observed A04.2 reliability buckets:

| Bucket | Customers | Pred activity | Actual activity | Activity cal | Revenue cal | NAE | Median NAE | Spearman | Cutoff coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `LOW` | `56,975` | `0.170360` | `0.109048` | `1.562255` | `1.186222` | `0.956162` | `1.000000` | `0.221961` | `4` |
| `MEDIUM` | `36,398` | `0.126625` | `0.107121` | `1.182074` | `1.122406` | `0.956792` | `1.000000` | `0.194321` | `3` |

Why the reliability audit fails:

1. `MEDIUM` cutoff coverage is only `3`, below the hardening requirement.
2. `MEDIUM` normalized absolute error is not better than `LOW`.
3. `MEDIUM` Spearman is not stronger than `LOW`.

Suppressing `HIGH` avoided the previous invalid semantics, but the remaining `LOW` and `MEDIUM` split is still not evidence-based enough to freeze.

## 9. Baseline Comparison

| Model | Calibration | MAE | Spearman | Top 1% | Top 5% | Top 10% | Top 20% | Activity PR-AUC | Activity Brier |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `historical-12m-revenue-v1` | `2.922393` | `113,328.735242` | `0.199856` | `0.204199` | `0.418503` | `0.563822` | `0.686192` | `n/a` | `n/a` |
| `simple-cohort-prior-v1` | `1.627739` | `80,925.696195` | `0.174754` | `0.134895` | `0.320829` | `0.437340` | `0.562536` | `0.258145` | `0.093579` |
| `two-stage-cohort-a04-original-v1` | `1.417496` | `73,623.743413` | `0.173843` | `0.151451` | `0.384389` | `0.488771` | `0.572499` | `0.256496` | `0.092366` |
| `two-stage-cohort-a04-band-recency-rank50-refined-v1` | `1.183603` | `65,734.115907` | `0.204888` | `0.187249` | `0.367523` | `0.502482` | `0.646143` | `0.241514` | `0.092689` |
| `two-stage-cohort-a04-2-stale-support-recent2-v1` | `1.165486` | `65,276.447529` | `0.204876` | `0.185445` | `0.364948` | `0.498747` | `0.643768` | `0.242120` | `0.092455` |

Interpretation:

- A04.2 still materially beats the simple cohort prior on error and ranking.
- A04.2 still materially corrects the historical-12m baseline's gross overprediction.
- A04.2 does not yet solve the stale tail strongly enough to justify freezing the estimator.

## 10. Segment-Level Result

History-depth calibration remains uneven:

| History depth | Customers | Calibration | MAE | Spearman |
| --- | ---: | ---: | ---: | ---: |
| `1` | `74,014` | `1.517404` | `39,885.452150` | `0.067293` |
| `2` | `12,063` | `1.216062` | `108,006.028481` | `0.123043` |
| `3-4` | `5,352` | `1.038615` | `189,400.442940` | `0.210864` |
| `5+` | `1,944` | `0.633830` | `425,117.277532` | `0.292648` |

Recency remains the main acceptance blocker:

| Recency | Customers | Calibration | MAE | Spearman |
| --- | ---: | ---: | ---: | ---: |
| `0-90d` | `15,723` | `0.993376` | `127,162.943921` | `0.334077` |
| `91-180d` | `11,529` | `0.932928` | `83,043.671052` | `0.260825` |
| `181-365d` | `22,439` | `1.231747` | `64,955.390026` | `0.151860` |
| `366-730d` | `32,011` | `1.476795` | `41,090.146894` | `0.095968` |
| `>730d` | `11,671` | `2.580546` | `31,307.822401` | `0.019657` |

## 11. Sanity Check

Top predicted customers were all high-spend repeat customers inside the same strong cohort:

- top activity probability: `0.539704`
- top expected active revenue range: about `1.93m` to `1.96m`
- top expected CLV12m range: about `1.04m` to `1.06m`
- all top 5 shown in the artifact were `MEDIUM`, not `HIGH`

No absurd negative or zeroed stale predictions were observed, but the far-stale group still receives too much mass in aggregate.

## 12. Temporal State Debt

The A02/A03 temporal debt remains unchanged:

- order-state temporal policy version: `customer-clv-current-valid-observed-with-documented-drift-v1`
- historical orders observed cancelled by current state:
  - `2023-01-01`: `53`
  - `2023-07-01`: `145`
  - `2024-01-01`: `258`
  - `2024-07-01`: `349`
  - `2025-01-01`: `483`
  - `2025-07-01`: `597`

This debt is documented but was not treated as the blocking cause for A04.2. The blocking cause is model-side stale overprediction plus non-valid reliability semantics.

## 13. Artifacts

Produced:

- `artifacts/clv/a04-2-final-hardening-report.json`

Not produced because the model was not accepted:

- `artifacts/clv/a04-2-frozen-candidate.json`

## 14. Next Step

Proceed to:

```text
CLV-A05 formal independent out-of-time acceptance validation
```

only after another correction pass specifically addresses:

1. far-stale activity prior inflation
2. one-order stale calibration
3. evidence-based separation between `LOW` and `MEDIUM`
