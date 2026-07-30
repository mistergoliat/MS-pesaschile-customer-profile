# CP-R1-T10A Multishop

## Facts

Output: `multishop-analysis.json`. Valid orders in this PrestaShop instance span three `id_shop` values. The audit measures, per shop: lifetime customers, lifetime valid orders, lifetime gross spend, and — inside the RFM window — a full per-shop R/F/M distribution (recency/frequency/monetary), built from one shop-scoped query (`shopScopedActivePopulationSql`) grouped in memory, no per-shop round trip needed. It also measures how many customers have a valid order in more than one shop lifetime. Shop display names are read from `ps_shop` (store name only, non-PII) when that table exists; the audit falls back to bare `shopId` otherwise — `ps_shop` is probed, not assumed, and is not part of the required RFM table set.

T10A's current population dataset (`populationDatasetSql`) pools all three shops into one customer-level aggregate with no shop filter and no shop dimension published in `population-summary.json`.

## Interpretations

The frequency-outlier account (`CP-R1-T10A-frequency-outlier.md`) is concentrated almost entirely in one non-primary shop. That alone is evidence against assuming the three shops represent statistically equivalent commercial activity: if order cadence, ticket size, or customer overlap differ structurally by shop, a single pooled `rfm-v1` model risks scoring a customer against the wrong reference population for their actual purchasing channel (e.g., a wholesale/POS-heavy shop's typical customer read against a webstore's typical customer).

Cross-shop customer overlap (`lifetime.multiShopSharePercent`) matters for a different reason: if very few customers ever cross shops, per-shop models are cheap to justify (disjoint populations); if overlap is high, per-shop models fragment the same customer's history and pooling becomes the more defensible default. Neither directionality can be assumed without the number.

## Decisions

1. T10A does not yet freeze whether `rfm-v1` aggregates all shops, filters to a primary shop, or publishes a shop dimension — this section provides the evidence, not the decision.
2. `population-summary.json` continues to pool all shops for this run, unchanged from the original T10A behavior, so the provisional distributions remain comparable to the earlier committed run.
3. Per-shop R/F/M (`window.perShop`) is published as a comparison tool, not as a competing set of scores — no customer receives a shop-scoped score from this audit.
4. `ps_shop` names are read (non-PII) only to make shop-level output readable; nothing about shop naming affects scoring.

## Follow-up

- Decide, with commercial input, whether shop 2/3-style channels (see `window.perShop` volumes) should be treated as distinct commercial operations before `rfm-v1` is frozen.
- If per-shop models are chosen, redesign the snapshot contract (`CP-R1-T10A-snapshot-architecture.md`) to carry a shop dimension; this audit does not propose that schema change.
