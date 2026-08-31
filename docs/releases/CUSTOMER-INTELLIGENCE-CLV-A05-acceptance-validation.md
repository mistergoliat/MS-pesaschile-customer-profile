# Customer Intelligence CLV A05

**Validation date:** Monday, August 31, 2026
**Status:** Accepted with documented debt
**Decision:** `CLV_MODEL_V1_ACCEPTED_WITH_DOCUMENTED_DEBT`

## Frozen candidate

A05 evaluated only `two-stage-cohort-a04-3-far-stale-adjustment-recent2-v1` from `artifacts/clv/a04-3-frozen-candidate.json`. The model family is `customer-clv-two-stage-cohort-v1`, with expected 12-month tax-included CLP revenue defined as activity probability multiplied by conditional active revenue.

The descriptor matched exactly, including model checksum `370abc53fd566dbe9ea72db7666a83bcf3230f83becad540cfb678aab1b4941d`. No candidate retuning, alternative CLV fitting, schema change, snapshot persistence, or production runtime integration was performed.

## Protocol and holdout

The read-only rolling-origin protocol evaluated `2024-01-01`, `2024-07-01`, `2025-01-01`, and `2025-07-01`, using only mature prior training cutoffs and the frozen `recent_2_eligible_cutoffs` activity window.

`NO_UNTOUCHED_HOLDOUT_AVAILABLE`: every mature cutoff participated in A04 selection. Robustness compensation included bounded leave-one-training-cutoff-out analysis, repeated deterministic evaluation, stale segment checks, support checks, and p99 evaluation-only winsorization.

## Results

Aggregate frozen-candidate results:

- Predicted revenue: `3695536207.916255` CLP
- Actual revenue: `3463128488.000000` CLP
- Calibration ratio: `1.067109`
- MAE: `61954.164038` CLP
- Spearman: `0.220134`
- Revenue capture: top 1% `0.185445`, top 5% `0.364948`, top 10% `0.511373`, top 20% `0.643768`
- Activity: ROC-AUC `0.687213`, PR-AUC `0.244590`, Brier `0.091318`
- Conditional active revenue calibration: `0.957110`

The stale correction remained useful across cutoffs. Aggregate stale activity distance was `0.754924`; the `731-1095d` activity calibration was `1.377167`, and far-stale revenue calibration was `1.146971`. Recent customers remained protected.

Estimate support semantics remained structural: `SPARSE` represented `56975` customers (`61.0187%`) and `SUPPORTED` represented `36398` (`38.9813%`). Support levels describe evidence depth, fallback depth, cohort support, and cutoff coverage; they are not interpreted as realized-error rankings.

Zero-future and positive-future behavior, prediction bands, history-depth segments, probability bands, drift, outlier sensitivity, temporal-state debt, commercial examples, and performance measurements are recorded in the machine-readable report.

## Robustness and debt

The p99 evaluation-only sensitivity used an actual-revenue cap of `840667.000000` CLP. Its calibration ratio was `1.653336`; canonical labels and training remained unchanged.

Leave-one-cutoff-out calibration ratios ranged from `0.984008` to `1.144184`, with stale activity distance from `0.158675` to `0.293523`. Repeated runs produced identical model and evaluation checksums.

The known temporal-state debt remains `customer-clv-current-valid-observed-with-documented-drift-v1`. A bounded exclusion sensitivity removed `880` current-state-cancelled historical orders from the latest cutoff: canonical calibration was `0.995341` and excluded calibration remained `0.995341`. The debt is therefore non-decision-reversing, but remains a documented limitation requiring monitoring in productionization.

Operational measurement recorded approximately `359` seconds elapsed, approximately `1003 MB` peak RSS, and a `98455` byte report artifact. This is considered feasible for scheduled offline generation on the current analytics infrastructure, subject to normal resource monitoring.

## Lineage and handoff

Seller-service product `444` and configured non-product IDs remain excluded from commercial revenue/features. Eligible currency remains CLP-only with no FX conversion. The output semantics remain monetary expected future revenue, optional expected orders, and evidence-only `estimateSupportLevel`.

Report: `artifacts/clv/a05-acceptance-validation-report.json`
Next step: `CLV-A06 Snapshot Persistence`. Acceptance authorizes productionization work only; it does not publish snapshots, create migrations, or enable runtime APIs.
