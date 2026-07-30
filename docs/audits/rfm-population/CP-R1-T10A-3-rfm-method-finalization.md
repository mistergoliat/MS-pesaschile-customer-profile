# CP-R1-T10A-3 RFM Method Finalization

## Facts

Computed on P1 (shop 1, rolling 12 months). Outputs: `recency-method-comparison.json`, `frequency-final-comparison.json`, `monetary-method-comparison.json`, `commercial-score-validity.json`.

**R** — two methods compared: R-Dynamic (tie-safe percentile rank, re-ranked every run — unchanged mechanism from T10A/T10A-2) vs R-Frozen (boundaries calibrated once from P1's `p20`/`p40`/`p60`/`p80` recencyDays, then applied as fixed cut points via `lib/recency-methods.ts` `classifyByFrozenRecencyBoundaries`). **Closed: R-Frozen**, boundaries published in `rfm-v1-provisional-manifest.json` (`recencyBoundaries`).

The classifier compares with `<=`, so the boundary value itself always resolves to the **higher** (more recent) score. As calibrated in the 2026-07-29 run (`recencyBoundaries: [69, 147, 224, 290]`):

```text
R5 = 0–69 días     (recencyDays <= 69)
R4 = 70–147 días   (69 < recencyDays <= 147)
R3 = 148–224 días  (147 < recencyDays <= 224)
R2 = 225–290 días  (224 < recencyDays <= 290)
R1 = 291+ días     (recencyDays > 290)
```

These four cut points are recalibrated periodically (see Decisions) — the current values always live in `rfm-v1-provisional-manifest.json`'s `recencyBoundaries`, and the ranges above must be read as "as calibrated at that manifest's `asOfDate`", not as permanent constants.

`historical_inactive` customers never receive an R score — `commercial-score-validity.json` and `temporal-stability-final.json` are built exclusively from P1's window-active population (`mainShopActivePopulationSql`, which only returns customers with >=1 shop-1 order inside the rolling window). A `historical_inactive` identity's snapshot is `{ status: "historical_inactive", scores: null, lifecycleStage: "historical_inactive" }` (see `historical-inactive-analysis.json`) — it is structurally impossible for such a customer to be scored R1, because R1 is only assigned to members of the *active* population whose recency is the least recent among them. **R1 is a statement about recency within the active population, not a synonym for `historical_inactive`.**

**F** — four models compared, all discrete thresholds, none using `NTILE`:

```text
Model A: F1=1 F2=2 F3=3   F4=4-5 F5=6+
Model B: F1=1 F2=2 F3=3-4 F4=5-9 F5=10+
Model D: F1=1 F2=2 F3=3   F4=4-6 F5=7+
Model E: tie-safe rank over P1's own distinct frequency values
```

**Closed: Model B**, published as `frequencyThresholdVersion: "rfm-v1-f1"`.

**M** — same Dynamic-vs-Frozen comparison as R, using `compareAuditDecimalAsc` (no float parsing) via `lib/monetary-methods.ts` `classifyByFrozenMonetaryBoundaries`. **Closed: M-Frozen**, boundaries published in the manifest (`monetaryBoundaries`).

The classifier compares with `>=`, so the boundary value itself always resolves to the **higher** (higher-spend) score — the mirror-image convention of R above, both inclusive on the side of the boundary that earns the better score. As calibrated in the 2026-07-29 run (`monetaryBoundaries: ["19990.000000", "38295.000000", "81233.000000", "206188.000000"]`):

```text
M1 <  19.990                        (grossMonetaryTaxIncl < 19.990)
M2 >= 19.990  y  <  38.295          (19.990 <= grossMonetaryTaxIncl < 38.295)
M3 >= 38.295  y  <  81.233          (38.295 <= grossMonetaryTaxIncl < 81.233)
M4 >= 81.233  y  < 206.188          (81.233 <= grossMonetaryTaxIncl < 206.188)
M5 >= 206.188                       (grossMonetaryTaxIncl >= 206.188)
```

As with R, these are the cut points calibrated at the 2026-07-29 run's `asOfDate` — the authoritative current values are always `rfm-v1-provisional-manifest.json`'s `monetaryBoundaries`, refreshed on each recalibration cycle.

Tie policy unchanged: identical metric value always receives the same score; ties are never split by row order or `NTILE`.

## Interpretations

CP-R1-T10A-2 measured Dynamic (rank-based) RFM codes collapsing to roughly 0.4% identical after a 90-day gap — almost entirely from population turnover shifting everyone's rank, not from any real change in most customers' own behavior. Frozen boundaries remove that specific failure mode: a customer whose orders and spend have not changed keeps the same R and M score until the calibration itself is refreshed, regardless of how many other customers churn in or out. `temporal-stability-final.json`'s `changeAttribution` field is the direct evidence for this — it separates score changes caused by the customer's own new activity from changes caused purely by the surrounding population.

Frozen boundaries are not free of cost: they can drift out of date (inflation, seasonality, genuine growth in the customer base) if never recalibrated, which is why this closure pairs "frozen" with an explicit recalibration cadence rather than "frozen forever." F does not have a Dynamic/Frozen choice to make — a discrete-threshold model is inherently frozen already, which is part of why the audit brief asked to finalize it as thresholds, not as a rank.

## Decisions

1. R method: **frozen boundaries**, `p20`/`p40`/`p60`/`p80` of P1's recencyDays, recalibrated periodically (proposed quarterly), not daily.
2. F model: **Model B**, `frequencyThresholdVersion: "rfm-v1-f1"`.
3. M method: **frozen boundaries**, same cadence and rationale as R.
4. Tie policy: unchanged, `same_value_same_score`, never `NTILE`.
5. Published M metric remains raw `grossMonetaryTaxIncl`; log/winsorized views stay diagnostic-only, never the scored value.
6. Recalibration cadence is proposed, not yet operationalized as a scheduled job — that remains future work.

## Follow-up

- Build the recalibration job (proposed quarterly) once `rfm-v1-provisional` moves toward an implementation task; this audit does not implement it.
- Re-evaluate Model B against Models A/D/E after at least one recalibration cycle, once real drift data exists.
