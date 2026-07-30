# CP-R1-T10A Scoring Recommendation

## Facts

Scores are integers from 1 to 5 for each dimension. Higher is better for all public scores:

- R: lower `recencyDays` receives higher score.
- F: higher `frequencyOrders` receives higher score.
- M: higher `grossMonetaryTaxIncl` receives higher score.

Same metric value must receive the same score. `NTILE` must not split ties.

## Interpretations

R and M can use tie-safe percentile rank by distinct value. F should prefer explicit threshold rules because frequency usually has very few distinct values and strong ties around one order.

The RFM code is a compact technical code such as `555`; it is not a commercial segment name.

## Decisions

- R scoring: tie-safe percentile rank by `recencyDays`.
- F scoring: versioned discrete thresholds based on the real frequency table.
- M scoring: tie-safe percentile rank by raw gross spend.
- RFM code: concatenate R, F, and M after scores are assigned.
- No named `rfmSegment` is introduced in T10A.
- Lifecycle is calculated and exposed separately.

## Follow-up

- Use the first approved live distribution to freeze `rfm-v1` threshold constants.
- Re-run temporal stability at current, -30, -60, and -90 days before release.
