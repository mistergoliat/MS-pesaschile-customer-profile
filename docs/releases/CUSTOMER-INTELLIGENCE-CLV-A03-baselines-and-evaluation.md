# CUSTOMER-INTELLIGENCE-CLV-A03 CLV Baselines And Evaluation

Status: **READY WITH DOCUMENTED DEBT**.

Type: deterministic CLV baselines, rolling-origin out-of-time evaluation harness, read-only offline artifact generation, and empirical model-selection evidence for A04. No CLV persistence, no Customer Intelligence integration, no migrations, no RFM/clustering/affinity changes, and no production DB writes.

## 1. Architecture

New A03 path:

```text
CLV-A02 cutoff-safe datasets
  -> src/domain/customer-clv/baselines.ts
  -> CustomerClvBacktestPrediction[]
  -> rolling-origin evaluation report
  -> scripts/clv/baselines-evaluate.ts
  -> JSON artifact + console summary
```

Prediction, evaluation, and reporting remain separate. The harness is pure at the domain layer and the CLI is read-only against PrestaShop.

## 2. Baseline Set

Implemented deterministic baselines:

- `global-mean-v1`: equal-cutoff mean future 12-month revenue.
- `global-activity-x-conditional-mean-v1`: equal-cutoff `P(active)` x `E(revenue | active)`.
- `historical-12m-revenue-v1`: `revenue365d`.
- `lifetime-monthly-rate-shrunk-v1`: annualized lifetime revenue rate with a `6`-month prior shrinkage toward the global historical monthly revenue.
- `aov-x-order-rate-v1`: historical AOV x annualized order rate with a `1`-year shrinkage toward the global annual order rate.
- `recency-adjusted-projection-v1`: shrunk annualized lifetime revenue x deterministic recency decay.
- `cutoff-safe-rfm-bucket-median-v1`: cutoff-safe R/F/M bucket median with fallback to R/F then global median.
- `simple-cohort-prior-v1`: order-depth x recency x tenure cohort mean with fallback to order-depth x recency, then recency only, then global mean.

Blocked baseline:

- `rfm-segment-median-v1`: `BLOCKED_BY_HISTORICAL_RFM_RECONSTRUCTION`.

Minimum-support policies:

- cohort minimum support: `25`
- cutoff-safe R/F/M bucket minimum support: `25`

## 3. Training Protocol

Version:

```text
customer-clv-training-label-window-known-by-eval-cutoff-v1
```

Rules:

- evaluation is cutoff-based only; no random split exists in v1;
- for evaluation cutoff `T`, only training cutoffs with `labelWindowEndExclusive <= T` are allowed;
- training cutoffs are equally weighted at the cutoff level;
- customer duplication across cutoffs is allowed and expected;
- deterministic tie-break policy is `customer-clv-prediction-desc-customerid-asc-v1`.

## 4. Rolling-Origin Plan

Observed on **Sunday, August 30, 2026** from the real read-only evaluation run:

- evaluate `2024-01-01T00:00:00.000Z` using training cutoff `2023-01-01T00:00:00.000Z`
- evaluate `2024-07-01T00:00:00.000Z` using training cutoffs `2023-01-01T00:00:00.000Z`, `2023-07-01T00:00:00.000Z`
- evaluate `2025-01-01T00:00:00.000Z` using training cutoffs `2023-01-01T00:00:00.000Z`, `2023-07-01T00:00:00.000Z`, `2024-01-01T00:00:00.000Z`
- evaluate `2025-07-01T00:00:00.000Z` using training cutoffs `2023-01-01T00:00:00.000Z`, `2023-07-01T00:00:00.000Z`, `2024-01-01T00:00:00.000Z`, `2024-07-01T00:00:00.000Z`

The first two mature candidate cutoffs, `2023-01-01` and `2023-07-01`, are not valid evaluation targets because they lack earlier fully-known 12-month label windows for training under the chosen protocol.

## 5. Zero Inflation And Revenue Concentration

Real-data zero-future-order rates by cutoff:

- `2023-01-01T00:00:00.000Z`: `0.786902`
- `2023-07-01T00:00:00.000Z`: `0.840227`
- `2024-01-01T00:00:00.000Z`: `0.868283`
- `2024-07-01T00:00:00.000Z`: `0.878557`
- `2025-01-01T00:00:00.000Z`: `0.893934`
- `2025-07-01T00:00:00.000Z`: `0.909316`

The target becomes sparser over time. Mean revenue among active customers stays comparatively stable, from `333166.234927` CLP at `2023-01-01T00:00:00.000Z` to `331865.611650` CLP at `2025-07-01T00:00:00.000Z`, while the activity rate falls from `0.213098` to `0.090684`.

Revenue concentration is extreme:

- top `1%` actual customers capture `0.396813` to `0.636835` of revenue by cutoff;
- top `5%` capture `0.766010` to `0.954539`;
- top `10%` reach `0.911115` to `1.000000`;
- by the latest cutoff, the top `10%` of actual customers capture all future revenue because at least `90%` of the population has zero realized revenue.

## 6. Baseline Results

Overall rolling-origin results across `93,373` evaluated customer-cutoff rows:

- `global-mean-v1`: calibration `1.614528`, MAE `86205.072280`, Spearman `0.050459`, top-10 capture `0.150560`
- `global-activity-x-conditional-mean-v1`: calibration `1.620463`, MAE `86396.859352`, Spearman `0.050459`, top-10 capture `0.150560`
- `historical-12m-revenue-v1`: calibration `2.922393`, MAE `113328.735242`, Spearman `0.199856`, top-10 capture `0.563822`
- `lifetime-monthly-rate-shrunk-v1`: calibration `14.480211`, MAE `523935.687877`, Spearman `0.112089`, top-10 capture `0.408795`
- `aov-x-order-rate-v1`: calibration `11.421386`, MAE `410107.528667`, Spearman `0.157299`, top-10 capture `0.503952`
- `recency-adjusted-projection-v1`: calibration `8.956849`, MAE `327959.962858`, Spearman `0.154159`, top-10 capture `0.356422`
- `cutoff-safe-rfm-bucket-median-v1`: calibration `0.052801`, MAE `37101.696963`, Spearman `0.196925`, top-10 capture `0.290217`
- `simple-cohort-prior-v1`: calibration `1.627739`, MAE `80925.696195`, Spearman `0.174754`, top-10 capture `0.437340`

Interpretation:

- global priors are the least useful for prioritization;
- `historical-12m-revenue-v1` is the strongest ranking baseline;
- `simple-cohort-prior-v1` materially improves over global priors on ranking while keeping calibration close to the global-mean family;
- several rate-projection baselines substantially overpredict nominal CLP revenue.

## 7. Activity And Conditional Value Diagnostics

Sparse activity is a first-order problem. On the aggregated rolling-origin population:

- actual future activity rate: `0.108297`
- active-customer mean future revenue: `342477.105222` CLP
- active-customer median future revenue: `98641.000000` CLP

Baselines with explicit activity probabilities:

- `cutoff-safe-rfm-bucket-median-v1`: ROC-AUC `0.675925`, PR-AUC `0.260043`, Brier `0.094100`
- `simple-cohort-prior-v1`: ROC-AUC `0.669261`, PR-AUC `0.258145`, Brier `0.093579`
- `global-activity-x-conditional-mean-v1`: ROC-AUC `0.544118`, PR-AUC `0.119749`, Brier `0.100891`

Conditional-value ranking among active customers is strongest for:

- `aov-x-order-rate-v1`: Spearman `0.522350`, but it badly overpredicts value with conditional calibration `2.144133`
- `historical-12m-revenue-v1`: conditional Spearman `0.363426`, conditional calibration `0.880432`

This supports a two-stage framing. Activity detection is difficult and economically important, while conditional spend among actives remains separately rankable.

## 8. Deciles And Top-N Capture

Overall top-decile revenue lift:

- `historical-12m-revenue-v1`: `5.883256`
- `aov-x-order-rate-v1`: `5.388389`
- `simple-cohort-prior-v1`: `5.294998`

Overall top-N revenue capture:

- `historical-12m-revenue-v1`: top `1%` `0.204199`, top `5%` `0.418503`, top `10%` `0.563822`, top `20%` `0.686192`
- `simple-cohort-prior-v1`: top `1%` `0.134895`, top `5%` `0.320829`, top `10%` `0.437340`, top `20%` `0.562536`
- `global-mean-v1`: top `1%` `0.017567`, top `5%` `0.100346`, top `10%` `0.150560`, top `20%` `0.279239`

The decile tables are deterministic per cutoff and are included in the artifact.

## 9. History-Depth Findings

Sparse customers dominate the population. For `historical-12m-revenue-v1`:

- `1` historical order: `74,014` rows, calibration `3.571071`, MAE `69722.527476`, Spearman `0.104603`
- `2` historical orders: `12,063` rows, calibration `2.877590`, MAE `180996.214021`, Spearman `0.174994`
- `3-4` historical orders: `5,352` rows, calibration `2.751273`, MAE `353280.646543`, Spearman `0.238671`
- `5+` historical orders: `1,944` rows, calibration `2.017665`, MAE `693048.095216`, Spearman `0.368563`

For `simple-cohort-prior-v1`:

- `1` historical order: calibration `2.255595`, MAE `51956.041794`, Spearman `0.033303`
- `5+` historical orders: calibration `0.921542`, MAE `512044.118812`, Spearman `0.236683`

Conclusion: ranking gets better with depth, but most customers have only one historical order. A04 must earn its value on sparse histories, not just on deep repeat-buyer segments.

## 10. Recency Findings

For `historical-12m-revenue-v1`, recency behavior is brittle:

- `>730d`: predicted total revenue `0`, calibration `0.000000`, Spearman `0.000000`
- `366-730d`: predicted total revenue `0`, calibration `0.000000`, Spearman `0.000000`
- `0-90d`: calibration `2.756299`, Spearman `0.298657`

For `simple-cohort-prior-v1`, every recency bucket remains economically live:

- `0-90d`: calibration `1.319925`, Spearman `0.300347`
- `91-180d`: calibration `1.102960`, Spearman `0.247035`
- `181-365d`: calibration `1.478939`, Spearman `0.156160`
- `366-730d`: calibration `2.317378`, Spearman `0.071467`
- `>730d`: calibration `5.923031`, Spearman `0.019657`

Conclusion: crude cohorts handle stale customers more realistically than pure trailing-12-month revenue, but long-recency segments remain hard.

## 11. Outlier Sensitivity

Outliers matter, but they do not invert the main ranking conclusion.

For `historical-12m-revenue-v1`:

- raw calibration `2.922393`, raw MAE `113328.735242`, raw RMSE `471491.621397`
- winsorized at actual `p99 = 840667.000000` CLP: calibration `3.300807`, MAE `77882.756359`, RMSE `181204.030649`

The heavy tail inflates RMSE sharply, which confirms that RMSE should remain secondary.

## 12. Price Drift

Across mature cutoffs, nominal future revenue per customer declines materially:

- mean future revenue falls from `70996.962744` CLP at `2023-01-01T00:00:00.000Z` to `30094.824342` CLP at `2025-07-01T00:00:00.000Z`
- activity rate falls from `0.213098` to `0.090684`
- active-customer mean future revenue stays in a narrower band around `332k` to `353k` CLP

This looks more like activity-rate drift than strong spend-per-active inflation. A04 should treat nominal drift as a modeling concern but should not inflation-adjust labels inside A03.

## 13. Temporal-State Debt

A02 temporal debt carries forward unchanged:

- historical orders observed cancelled by current state rise from `53` at `2023-01-01T00:00:00.000Z` to `597` at `2025-07-01T00:00:00.000Z`
- affected customers rise from `49` to `536`
- affected-order share stays near `0.94%` to `1.33%` of historical orders by cutoff

This is measurable but not large enough, from A03 evidence alone, to justify a large point-in-time state reconstruction before A04.

## 14. Artifact And CLI

Command:

```text
npm run clv:baselines:evaluate
```

Optional arguments:

```text
--evaluation-cutoff
--model
--out
--max-cutoffs
```

Real-data artifact written on **Sunday, August 30, 2026**:

```text
artifacts/clv/a03-baselines-report.json
```

## 15. A04 Recommendation

The evidence does not support declaring a final CLV model in A03.

It does support the following:

- a two-stage structure is justified by the zero-heavy target and the explicit activity diagnostics;
- direct expected revenue remains defensible as a cohort-EV family because `simple-cohort-prior-v1` is competitive on MAE and calibration;
- `historical-12m-revenue-v1` is the main ranking baseline that A04 must beat;
- A04 should focus on a cutoff-safe cohort expected-value model that explicitly models sparse activity and preserves strong ranking for the highest-value deciles.

## 16. Files

Primary A03 additions:

- `src/domain/customer-clv/baselines.ts`
- `scripts/clv/baselines-evaluate.ts`
- `tests/unit/customer-clv-baselines-evaluation.test.ts`
- `docs/releases/CUSTOMER-INTELLIGENCE-CLV-A03-baselines-and-evaluation.md`

Updated exports and supporting code:

- `src/domain/customer-clv/index.ts`
- `src/domain/customer-clv/dataset.ts`
- `package.json`
