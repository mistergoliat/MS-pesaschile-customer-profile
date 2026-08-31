# Customer Intelligence CLV A04.3

**Release date:** Monday, August 31, 2026
**Status:** Ready for acceptance validation
**Decision:** `CLV_MODEL_V1_READY_FOR_ACCEPTANCE_VALIDATION`

## Scope

A04.3 is the final targeted correction before candidate freeze. It corrects far-stale activity overprediction and replaces the public reliability terminology with evidence-based estimate support semantics. Stage B, top-N ranking behavior, model family, and feature families remain unchanged.

## Correction

The training-only activity correction applies a bounded multiplicative factor to stale customers using recency x order-depth support, then recency support, then a neutral fallback. Unsupported far-stale rows use the nearest supported stale parent factor as a conservative bounded fallback. Recent customers are protected from this adjustment, and adjusted probabilities remain positive and deterministic.

The public field is now `estimateSupportLevel` with values `SPARSE` and `SUPPORTED`. `reliabilityBucket` is historical terminology only and is not part of the public CLV contract.

## Rolling-origin result

The complete evaluation used cutoffs `2024-01-01`, `2024-07-01`, `2025-01-01`, and `2025-07-01`. The selected candidate is `two-stage-cohort-a04-3-far-stale-adjustment-recent2-v1`.

| Metric | A04.2 | A04.3 |
| --- | ---: | ---: |
| Overall calibration ratio | 1.165486 | 1.067109 |
| Overall MAE | 65276.447529 | 61954.164038 |
| Overall Spearman | 0.204876 | 0.220134 |
| Stale activity distance | 2.824541 | 0.754924 |
| 731-1095d activity calibration | 3.088634 | 1.377167 |
| Far-stale revenue calibration | 2.598071 | 1.146971 |

All acceptance checks passed, including temporal correctness, Stage B freeze, calibration and ranking stability, stale activity and revenue improvement, recent activity stability, activity Brier/PR-AUC stability, and estimate-support semantics validity.

## Frozen lineage

- Model: `customer-clv-two-stage-cohort-v1`
- Activity window: `recent_2_eligible_cutoffs`
- Stale adjustment policy: `customer-clv-two-stage-stale-activity-adjustment-v1`
- Estimate support policy: `customer-clv-estimate-support-v1`
- Training-time policy: `customer-clv-training-label-window-known-by-eval-cutoff-v1`
- Dataset: `customer-clv-backtest-dataset-v1`
- Frozen artifact: `artifacts/clv/a04-3-frozen-candidate.json`
- Evaluation report: `artifacts/clv/a04-3-final-correction-report.json`

No production runtime behavior is changed by this release artifact; the change is limited to the training/evaluation model path and its contracts, tests, reports, and documentation.
