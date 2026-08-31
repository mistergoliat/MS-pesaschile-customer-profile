# CUSTOMER-INTELLIGENCE-CLV-A04 Two-Stage Cohort Model

Supersession note from A04.3 on Monday, August 31, 2026:

- references below to `reliability` or `reliabilityBucket` are historical A04 terminology
- the public external field is now `estimateSupportLevel`
- these historical sections should not be interpreted as a forecast-confidence claim

Status: **NEEDS FIXES**.

Type: deterministic two-stage cohort CLV experiment, rolling-origin evaluation, baseline comparison, and acceptance gate. No production CLV persistence, no Customer Intelligence integration, no migrations, and no production DB writes.

## 1. Model Version

The reserved A01 model version is now updated to:

```text
customer-clv-two-stage-cohort-v1
```

This better matches the empirical A03 finding that future activity is the dominant problem and must be modeled explicitly.

## 2. Model Formula

The candidate predicts:

```text
expectedRevenue12m =
P(active within next 12 months | history)
*
E(revenue within next 12 months | active, history)
```

Optional expected orders are also emitted as:

```text
expectedOrders12m =
P(active)
*
E(orderCount | active, history)
```

## 3. Candidate Set

Evaluated candidates:

- `two-stage-cohort-all-cutoffs-order-recency-value-v1`
- `two-stage-cohort-recent-activity-order-recency-value-v1`
- `two-stage-cohort-recent-activity-monetary-value-v1`

Selection rule version:

```text
customer-clv-two-stage-selection-calibration-then-ranking-v1
```

Ordered priorities:

1. reasonable combined calibration;
2. ranking and top-10 capture;
3. one-order customer utility;
4. cutoff stability;
5. deterministic interpretability.

The selected candidate was:

```text
two-stage-cohort-recent-activity-monetary-value-v1
```

## 4. Training Time Policy

Temporal protocol remained unchanged from A03:

```text
customer-clv-training-label-window-known-by-eval-cutoff-v1
```

For evaluation cutoff `T`, only training cutoffs with:

```text
labelWindowEndExclusive <= T
```

are allowed.

Rolling-origin evaluation cutoffs:

- `2024-01-01T00:00:00.000Z`
- `2024-07-01T00:00:00.000Z`
- `2025-01-01T00:00:00.000Z`
- `2025-07-01T00:00:00.000Z`

## 5. Activity Model

Stage A exact cohort dimensions:

- order-depth bucket
- recency bucket
- tenure bucket

Buckets:

- order depth: `1`, `2`, `3-4`, `5+`
- recency: `0-90d`, `91-180d`, `181-365d`, `366-730d`, `>730d`
- tenure: `0-180d`, `181-365d`, `366-730d`, `>730d`

Fallback hierarchy:

```text
orderDepth x recency x tenure
-> orderDepth x recency
-> recency
-> global activity prior
```

Shrinkage strengths:

- exact: `30`
- order-recency parent: `45`
- recency parent: `60`

The selected candidate used a drift-aware activity window:

```text
recent_2_eligible_cutoffs
```

This was chosen because A03 showed persistent activity decline across cutoffs.

## 6. Conditional Value Model

Stage B trains only on customers with:

```text
futureRevenueTaxIncl > 0
```

Selected exact cohort dimensions:

- order-depth bucket
- recency bucket
- `revenue365d` bucket

`revenue365d` buckets:

- `0`
- `(0,50k]`
- `(50k,150k]`
- `(150k,400k]`
- `>400k`

Fallback hierarchy:

```text
orderDepth x recency x revenue365dBucket
-> orderDepth x recency
-> recency
-> global active-customer mean
```

Estimator:

```text
shrunk_arithmetic_mean
```

Shrinkage strengths:

- exact: `20`
- order-recency parent: `30`
- recency parent: `45`

Value training window remained:

```text
all_eligible_cutoffs
```

because active-customer spend was much more stable than activity rate.

## 7. Reliability Policy

Policy version:

```text
customer-clv-two-stage-reliability-history-support-fallback-v1
```

Inputs:

- historical order depth
- recency
- activity support
- value support
- fallback depth

Implemented rule:

- `HIGH`: repeat-customer history, recent behavior, shallow fallback, and strong cohort support
- `LOW`: one-order history, stale recency, deep fallback, or weak cohort support
- `MEDIUM`: everything between those two cases

This policy is deterministic, but the final validation evidence is mixed and is one reason A04 is not accepted yet.

## 8. Selected Candidate Results

Overall combined revenue metrics across `93,373` evaluated customer-cutoff rows:

- calibration ratio: `1.417496`
- MAE: `73623.743413`
- median absolute error: `43124.345437`
- RMSE: `321558.196995`
- Spearman: `0.173843`
- top `1%`: `0.151451`
- top `5%`: `0.384389`
- top `10%`: `0.488771`
- top `20%`: `0.572499`

Stage A activity metrics:

- actual activity rate: `0.108297`
- predicted activity rate: `0.155349`
- ROC-AUC: `0.673260`
- PR-AUC: `0.256496`
- Brier: `0.092366`

Stage B conditional value metrics among active customers:

- active customers: `10,112`
- calibration ratio: `1.056613`
- MAE: `366437.725467`
- median absolute error: `218279.101130`
- RMSE: `917657.982071`
- Spearman: `0.356830`
- predicted active mean revenue: `361865.747687` CLP
- actual active mean revenue: `342477.105222` CLP

## 9. Comparison Against A03 Benchmarks

Comparison table:

| Model | Calibration | MAE | Spearman | Top1 | Top5 | Top10 | Top20 | Activity PR-AUC | Activity Brier |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `historical-12m-revenue-v1` | `2.922393` | `113328.735242` | `0.199856` | `0.204199` | `0.418503` | `0.563822` | `0.686192` | `n/a` | `n/a` |
| `simple-cohort-prior-v1` | `1.627739` | `80925.696195` | `0.174754` | `0.134895` | `0.320829` | `0.437340` | `0.562536` | `0.258145` | `0.093579` |
| `two-stage-cohort-recent-activity-monetary-value-v1` | `1.417496` | `73623.743413` | `0.173843` | `0.151451` | `0.384389` | `0.488771` | `0.572499` | `0.256496` | `0.092366` |

Interpretation:

- A04 materially improved calibration versus `historical-12m-revenue-v1`.
- A04 also improved MAE and top-N capture over `simple-cohort-prior-v1`.
- A04 did **not** challenge the `historical-12m-revenue-v1` ranking benchmark closely enough; top-10 capture remained `0.075051` lower.

## 10. Drift Handling

A03 drift evidence persisted:

- activity rate declined from `0.213098` at `2023-01-01` to `0.090684` at `2025-07-01`
- active-customer mean revenue stayed much more stable, roughly `332k` to `353k` CLP

That justified different temporal pooling policies:

- activity: recent `2` eligible cutoffs
- conditional value: all eligible cutoffs

The recent-activity candidates outperformed the all-history activity candidate on calibration and one-order MAE, which validates the drift split.

## 11. Sparse And Stale Customers

One-order segment:

- selected candidate calibration: `2.019656`
- selected candidate MAE: `47964.888887`
- selected candidate Spearman: `0.038497`

This is materially better MAE than `historical-12m-revenue-v1` for the dominant one-order population, but the ranking signal remains weak.

Stale segments:

- `366-730d`: mean prediction `41710.290624` CLP, calibration `2.299116`
- `>730d`: mean prediction `45811.050167` CLP, calibration `4.921360`

This is an improvement over the A03 pathological forced-zero behavior, but the stale-customer tail is still overpredicted.

## 12. Cohort Diagnostics

Largest activity cohorts show sensible monotonic structure. Examples from the selected latest fit:

- `orders:1|recency:366-730d|tenure:366-730d`: support `11173`, raw activity `0.068807`, shrunk `0.068807`
- `orders:1|recency:0-90d|tenure:0-180d`: support `4155`, raw `0.119877`, shrunk `0.119993`
- `orders:3-4|recency:0-90d|tenure:366-730d`: support `403`, raw `0.481630`, shrunk `0.478621`

Largest value cohorts also reflect meaningful monetary separation:

- `orders:1|recency:0-90d|revenue365d:(0,50k]`: support `617`, shrunk active revenue `125120.102849`
- `orders:1|recency:0-90d|revenue365d:(150k,400k]`: support `337`, shrunk active revenue `420409.898333`
- `orders:5+|recency:0-90d|revenue365d:>400k`: support `205`, shrunk active revenue `1046325.027822`

Fallback usage remained interpretable:

- activity exact / order-recency / recency / global: `48718 / 14549 / 39 / 30067`
- value exact / order-recency / recency / global: `62719 / 394 / 193 / 30067`

The large global-fallback share is driven by the earliest evaluated cutoff being trained from only one prior cutoff.

## 13. Reliability Validation

Observed reliability buckets:

- `LOW`: `82,604` customers, activity calibration `1.527752`, revenue calibration `1.612121`, MAE `59042.670630`, Spearman `0.113564`
- `MEDIUM`: `9,981` customers, activity calibration `1.198733`, revenue calibration `1.139154`, MAE `155200.510930`, Spearman `0.219676`
- `HIGH`: `788` customers, activity calibration `1.018516`, revenue calibration `0.994592`, MAE `568848.641324`, Spearman `0.259631`

Interpretation:

- calibration and ranking improve with reliability;
- raw MAE does not, because `HIGH` is concentrated in materially larger-value customers;
- this means the current bucket semantics are directionally useful but not yet fully validated as a clean quality label.

## 14. Top-Customer Sanity Check

Top predicted rows in the latest cutoff are plausible but repetitive because a strong exact cohort shares the same activity and value estimates:

- customer `101634`: predicted `751689.316913`, actual `1057998.000000`, activity `0.718409`, value-given-active `1046325.027822`
- customer `103237`: predicted `751689.316913`, actual `4811490.000000`, activity `0.718409`, value-given-active `1046325.027822`
- customer `104114`: predicted `751689.316913`, actual `6207920.000000`, activity `0.718409`, value-given-active `1046325.027822`

This is not absurd, but it shows the current cohort granularity is still too coarse at the very top end.

## 15. Acceptance Decision

Observed acceptance checks:

- calibration improves over `historical-12m-revenue-v1`: `true`
- calibration remains competitive with `simple-cohort-prior-v1`: `true`
- ranking challenges `historical-12m-revenue-v1`: `false`
- ranking beats `simple-cohort-prior-v1`: `true`
- one-order MAE improves over `historical-12m-revenue-v1`: `true`
- stale customers receive non-zero estimates: `true`
- reliability ordering looks fully valid: `false`

Decision:

```text
CLV_MODEL_V1_NEEDS_FIXES
```

The main blocker is ranking. The selected two-stage candidate is a better calibrated and more commercially sensible general model than the simple cohort prior, but it does not yet beat or sufficiently pressure the strongest A03 ranking baseline.

## 16. Artifact And Runtime

CLI:

```text
npm run clv:model:evaluate
```

Artifact:

```text
artifacts/clv/a04-two-stage-cohort-report.json
```

Observed file timestamp from the real read-only run: **Sunday, August 30, 2026 22:08:45** in the workspace local time.

## 17. Known Debt

Carried forward:

- current-state order validity is still observed at extraction time, not reconstructed exactly as-of cutoff;
- historical orders observed cancelled by current state still range from `53` to `597` by cutoff;
- stale-customer calibration remains too high;
- reliability semantics need another pass before they can be treated as a stable external label.

## 18. Next Step

The next slice should be **A05 acceptance hardening or targeted correction**, with focus on:

- improving top-decile/top-10 ranking without giving up calibration;
- refining the high-end value cohorts for repeat recent customers;
- reducing stale-segment overprediction;
- revalidating reliability with a scale-aware error view rather than raw MAE alone.
