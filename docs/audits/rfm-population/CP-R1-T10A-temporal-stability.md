# CP-R1-T10A Temporal Stability

## Facts

Output: `temporal-stability-real.json` (full detail) and `temporal-stability.json` (short pointer/summary — no longer a placeholder). The audit re-runs the same deterministic active-population extraction (`activePopulationSql`) at `asOfDate`, `asOfDate-30d`, `asOfDate-60d`, and `asOfDate-90d`, builds a per-customer R/F/M score snapshot at each date (R and M via tie-safe percentile rank, F via Model B as the single reference model — see `CP-R1-T10A-frequency-threshold-simulation.md`), and compares the current snapshot against each of the three earlier ones.

Per comparison, the audit reports: customers present in both snapshots, customers only in one, percent with an identical RFM code, percent where each of R/F/M moved by at most 1, and percent with an "extreme" change (any dimension moving by 3 or more score points). No per-customer identity or score pair is published — every field is a count or percentage over the compared population.

## Interpretations

A 90-day lookback cannot separate genuine model instability from calendar seasonality (promotions, seasonal demand) — this audit reports that limitation explicitly rather than presenting a stability verdict as more conclusive than it is. Confirming seasonality would require comparing the same calendar window across multiple years, which is out of scope here.

Because R and M are rank-based over the *current* population at each date, a customer's score can shift even with no change in their own behavior, purely because the population around them changed (churn, new customers, the frequency outlier entering/leaving the active window). That is expected and is exactly what this measurement is for — a stable model should show that shift staying small (`identicalCodePercent` high, `extremeChangeCount` low) even as the population turns over.

## Decisions

1. Model B is the single reference F model for migration measurement; Models A and C are not carried into this comparison (see `CP-R1-T10A-frequency-threshold-simulation.md` Decisions).
2. Stability is measured, not assumed: `rfm-v1` cuts are not frozen from this run — `stabilityVerdict` in the JSON output states explicitly whether this single run's `-90d` comparison clears a reasonable bar, and even a clear bar here is not sufficient on its own (see Follow-up).
3. Seasonality is called out as an unresolved caveat rather than silently ignored.
4. No individual customer's score history is written to any output file.

## Follow-up

- Repeat this measurement across at least one more `asOfDate` a few weeks apart (not just `-30/-60/-90` from a single anchor) before treating any model as stable enough to freeze.
- Once `master_customer` mode is viable, repeat temporal stability under canonical identity — merges/splits during migration are themselves a source of apparent score instability that provisional `prestashop_customer` mode cannot distinguish from real behavioral change.
