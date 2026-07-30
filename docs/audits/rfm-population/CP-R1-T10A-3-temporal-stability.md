# CP-R1-T10A-3 Temporal Stability (Final)

## Facts

Output: `temporal-stability-final.json`. Re-runs P1 (shop 1, rolling 12 months) at four fixed dates: `asOfDate`, `asOfDate` minus 1/2/3 calendar months (same day-of-month, e.g. 2026-07-29 → 2026-06-29 → 2026-05-29 → 2026-04-29 — see `lib/dates.ts` `subtractCalendarMonths`, distinct from CP-R1-T10A-2's fixed 30/60/90-day shifts). For every comparison against the current date, both the Dynamic and the Frozen scoring streams (`CP-R1-T10A-3-rfm-method-finalization.md`) are measured:

- per dimension (R, F, M): identical-score count/percent, within-±1 count/percent, over-±1 count/percent, average absolute change, and a full 5×5 transition matrix;
- per RFM code: identical-code count/percent, a Manhattan-distance histogram (`|ΔR| + |ΔF| + |ΔM|`), and a count of how many of the three dimensions changed (0/1/2/3);
- a change-attribution split into exactly one of: window-activity change (the customer's own `frequencyOrders`/`grossMonetaryTaxIncl` differ — a real new order or one aging out of the window), time-passing-only (raw metrics identical, but a Frozen boundary was crossed purely because the calendar date moved), or population-change-only (raw metrics identical, Frozen score identical, but the Dynamic rank still moved because other customers changed).

No individual customer id, score, or score history is written to any output — every field above is a count, percentage, or matrix of counts.

## Interpretations

The attribution split is the key addition over CP-R1-T10A-2's temporal-stability-real.json: it turns "the code changed" into "the code changed *because of X*." A large `explainedByPopulationChangeOnly` share is direct evidence that Dynamic scoring is fragile for reasons that have nothing to do with the customer being measured — which is exactly the failure Frozen boundaries are meant to fix. If Frozen still shows a large `explainedByTimePassingOnly` share, that says something different and useful: the boundaries themselves may need a shorter recalibration cadence, not that the frozen approach is wrong.

The four fixed dates test three consecutive month-long slides of the same shop-1 population, not an arbitrary sample — that is enough to establish a trend (is Frozen materially better than Dynamic and by how much) but not enough on its own to certify long-run stability across seasons; see `stabilityVerdict` and its explicit caveat.

## Decisions

1. Reference F model for this comparison: **Model B** (`rfm-v1-f1`) — Models A/D/E are compared only in `frequency-final-comparison.json`, not carried into this migration analysis.
2. Both Dynamic and Frozen streams are measured side by side in every run, not just the chosen (Frozen) method, so the improvement is demonstrated rather than assumed.
3. `stabilityVerdict` in the output is the closing statement for this run — read together with `decisionsClosed` item 17 in `t10a3-audit-result.json`, not overridden by this document.
4. A single 3-month lookback is not treated as sufficient to certify long-run/seasonal stability — see Follow-up.

## Follow-up

- Repeat this measurement across a wider date spread (multiple quarters, ideally spanning at least one full seasonal cycle) before removing the "pending one more calibration cycle" qualifier from a `VALID_FOR_PROVISIONAL_RFM_V1` verdict.
- Re-run under `RFM_IDENTITY_MODE=master_customer` once available, to separate identity-migration noise from genuine behavioral/population change.
