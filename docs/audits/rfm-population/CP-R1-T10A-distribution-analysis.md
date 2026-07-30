# CP-R1-T10A Distribution Analysis

## Facts

Active customers are the only denominator for R, F, and M distributions.

Recency distribution records min, median, average, p10, p20, p25, p40, p50, p60, p75, p80, p90, p95, max, frequent recency values, tie counts, customers per recency day, and candidate score cuts.

Frequency distribution records min, median, average, percentiles, max, exact frequent values, 1/2/3/4/5+/10+ order shares, tie concentration, empty score risk, and group sizes.

Monetary distribution records min, median, average, p95, p99, max, zero orders, outliers, top 1/5/10 percent spend concentration, tie counts, and extreme-value diagnostics.

## Interpretations

Frequency is expected to be highly discrete and tie-heavy, so row-based quintiles can produce empty or misleading buckets. Monetary may be long-tailed, so log and winsorized views are diagnostics only; the published score remains based on raw gross spend.

## Decisions

- Recency: use tie-safe percentile rank by value, lower is better.
- Frequency: use versioned discrete thresholds informed by live distribution, not `NTILE`.
- Monetary: use tie-safe percentile rank over raw gross monetary tax-incl.
- Outliers: diagnose but do not automatically winsorize the score.
- Same exact value always gets the same score.

## Follow-up

- Populate the report with real aggregate outputs after the approved read-only run.
- Review p95/p99 and top spend concentration before freezing the first `rfm-v1` cuts.
