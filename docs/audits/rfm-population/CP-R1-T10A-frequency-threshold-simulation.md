# CP-R1-T10A Frequency Threshold Simulation

## Facts

Output: `frequency-threshold-simulation.json`. Three candidate discrete Frequency-score models are simulated against the same active population, none using `NTILE`:

```text
Model A: F1=1  F2=2  F3=3  F4=4-5  F5=6+
Model B: F1=1  F2=2  F3=3-4 F4=5-9  F5=10+
Model C: tie-safe rank over distinct observed frequency values (same method as R and M)
```

For every model and every score 1-5, the audit reports: customer count, percent of active population, total spend, percent of active spend, average and median recency, and average frequency. Model B is also recomputed excluding the single top frequency-outlier account (`CP-R1-T10A-frequency-outlier.md`), to show sensitivity.

## Interpretations

Model A's top bucket ("6+") collapses everything from 6 orders to the frequency-outlier's window count into a single score — the coarsest option, and the one most likely to hide a dominant account inside "F5" without any visible signal. Model B narrows that top bucket to "10+", trading some coarseness for a slightly larger F5 population, still vulnerable to the same masking at a higher threshold. Model C maximizes statistical separation by construction, but because it ranks over whatever distinct values are currently observed, its bucket boundaries move whenever the population changes — which works against a *versioned, stable* `rfm-v1` threshold that Sales/CRM/Campaign consumers can rely on release over release.

None of the three is asserted as "correct" by this audit; the choice is a commercial trade-off between interpretability (A/B) and statistical tightness (C), which is why `CP-R1-T10A-commercial-validity.md` evaluates them against real group separability rather than this document declaring a winner.

## Decisions

1. No model uses `NTILE` over rows — Models A/B are fixed thresholds, Model C reuses the existing tie-safe rank-by-distinct-value method already used for R and M.
2. Model B is used as the single **reference** model for real temporal-stability measurement (`CP-R1-T10A-temporal-stability.md`) so that migration percentages are comparable across dates; Models A and C are compared only at a single point in time here.
3. None of the three models is frozen as `rfm-v1`'s F method by this audit — see `CP-R1-T10A-rfm-population-audit.md` Decisions for the closing status.

## Follow-up

- Re-run this simulation at `-30`/`-60`/`-90` days for all three models (not just the Model B reference) before choosing one to freeze.
- Pair this with `CP-R1-T10A-multishop.md`: if shops are ultimately modeled separately, thresholds may need to be re-derived per shop rather than globally.
