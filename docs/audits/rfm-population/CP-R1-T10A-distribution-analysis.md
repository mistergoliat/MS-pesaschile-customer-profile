# CP-R1-T10A Distribution Analysis

## Facts

Active customers are the only denominator for R, F, and M distributions.

Recency distribution records min, median, average, p10, p20, p25, p40, p50, p60, p75, p80, p90, p95, max, frequent recency values, tie counts, customers per recency day, and candidate score cuts.

Frequency distribution records min, median, average, percentiles, max, exact frequent values, 1/2/3/4/5+/10+ order shares, tie concentration, empty score risk, and group sizes.

Monetary distribution records min, median, average, p95, p99, max, zero orders, outliers, top 1/5/10 percent spend concentration, tie counts, and extreme-value diagnostics. `p99` was added to the shared distribution helper (`describeNumericDistribution`) and now appears in all three dimensions' outputs, not only monetary.

Recency and monetary distributions now also carry cross-reference pointers: `recency-distribution.json.stabilityReference` points at `temporal-stability-real.json` (do not treat any candidate recency cut as frozen without checking it); `frequency-distribution.json.modelsReference` and `monetary-distribution.json.shopReference` point at `frequency-threshold-simulation.json` and `multishop-analysis.json` respectively.

## Interpretations

Frequency is expected to be highly discrete and tie-heavy, so row-based quintiles can produce empty or misleading buckets — confirmed by `CP-R1-T10A-frequency-threshold-simulation.md`'s three-model comparison. Monetary may be long-tailed, so log and winsorized views are diagnostics only; the published score remains based on raw gross spend. The frequency outlier investigation (`CP-R1-T10A-frequency-outlier.md`) shows concretely how a single account can distort the tail of both the frequency and monetary distributions when every shop is pooled — see `CP-R1-T10A-multishop.md` for the per-shop breakdown.

## Decisions

- Recency: use tie-safe percentile rank by value, lower is better.
- Frequency: use versioned discrete thresholds informed by live distribution, not `NTILE`.
- Monetary: use tie-safe percentile rank over raw gross monetary tax-incl.
- Outliers: diagnose but do not automatically winsorize the score.
- Same exact value always gets the same score.

## Follow-up

- Populate the report with real aggregate outputs after the approved read-only run — done for `RFM_IDENTITY_MODE=prestashop_customer`; repeat for `master_customer` mode once available.
- Review p95/p99 and top spend concentration before freezing the first `rfm-v1` cuts — cross-check against `CP-R1-T10A-frequency-outlier.md` population variants B/C/D/E before trusting the pooled p95/p99/max at face value.
