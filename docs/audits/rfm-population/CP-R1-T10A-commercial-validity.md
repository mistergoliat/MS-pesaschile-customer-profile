# CP-R1-T10A Commercial Validity

## Facts

Output: `commercial-validity-analysis.json`. For R, M, and each of the three Frequency models (`CP-R1-T10A-frequency-threshold-simulation.md`), the audit builds a per-score table (customer count, total/average/median spend, average frequency, average recency, percent of population, percent of spend) and evaluates whether adjacent scores are "distinguishable" — defined strictly as the higher score's average spend being at least 1.2x the lower score's, a data-driven signal, not a commercial label.

The audit then answers, from the computed numbers rather than from assumption:

- whether F=2 is a useful recurrence signal (Model B score 1 vs 2 average-spend comparison);
- whether F>=6 (Model A's F5) represents high recurrence;
- whether M5 customers are legitimate or dominated by the frequency-outlier account (share of M5's total spend contributed by that one account);
- whether low R identifies real inactivity (R=1 is still an *active* customer — at least one order inside the window — and is a different population from `historical_inactive`, which has zero);
- whether the historical-inactive base has reactivation value (its count and aggregate lifetime spend, entirely outside the current window);
- whether B2B/B2C should be split (checked against `company`-field usage from `CP-R1-T10A-prestashop-identity-quality.md` — company is essentially unused in this dataset, so it is not a usable signal on its own).

## Interpretations

"Distinguishable" here is a floor, not a target — a 1.2x average-spend gap between adjacent scores is a low bar chosen to catch groups that are *not even weakly* separated, not to certify that a gap above it is commercially meaningful on its own. Any group whose average spend is inflated by a small number of extreme accounts (see the M5/outlier-share answer) needs that caveat attached before it is used to justify a campaign or segment definition.

R=1 vs `historical_inactive` is a distinction worth keeping explicit: `historical_inactive` customers are excluded from RFM scoring entirely (F=0/M=0, no score), while R=1 customers are still counted, still have a live F/M score, and are simply the least-recent slice of an otherwise-active base. Conflating the two would understate how many customers are truly disengaged.

## Decisions

1. No named commercial segment (e.g., "champion", "at risk") is introduced by this audit — `answers` are data points, not segment definitions.
2. Distinguishability is measured pairwise between *adjacent* scores only; non-adjacent comparisons are not computed here.
3. The M5/outlier-share figure must be reviewed before M5 is used in any commercial communication — a high share means M5 is not describing five distinct "high-value customers" but one dominant account plus a smaller group.
4. B2B/B2C separation is not implemented — `company` is not a usable signal in this dataset; a future signal (shop channel, frequency heuristic) would need its own dedicated evaluation.

## Follow-up

- Re-run after the operational review of the frequency-outlier account (`CP-R1-T10A-frequency-outlier.md` Follow-up) to see how much the M5/F5 answers change once that account's classification is resolved.
- If a shop-based B2B signal is adopted (`CP-R1-T10A-multishop.md`), re-evaluate `shouldB2BB2CBeSeparated` against it instead of `company`.
