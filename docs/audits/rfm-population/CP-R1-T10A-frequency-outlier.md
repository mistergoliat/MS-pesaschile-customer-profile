# CP-R1-T10A Frequency Outlier

## Facts

Output: `frequency-outlier-analysis.json`. The customer with the highest window-scoped valid order count is located implicitly, through a scalar subquery predicate (`o.id_customer = (SELECT id_customer FROM ... ORDER BY COUNT(*) DESC LIMIT 1)`); `id_customer` is never present in any query's outer, published `SELECT` list — see `lib/outlier-sql.ts` and the SQL test that asserts this structurally.

The audit reports, about that single customer, without ever publishing which customer it is:

- lifetime and window valid order counts, distinct order shops, distinct order days;
- lifetime and window gross monetary, and window average ticket;
- window recency relative to `asOfDate`;
- non-identifying account-state flags (`is_guest`, `active`, `deleted`, has-a-company-name, account creation date);
- per-shop lifetime order split.

It then compares five population variants built from the already-fetched active population (no extra queries needed):

- **A** — full active population;
- **B** — excluding every customer with window frequency over 100;
- **C** — excluding every customer with window frequency over 500;
- **D** — window frequency winsorized (capped) at the population's own p99, **diagnostic only**, never applied to a published score;
- **E** — excluding only the single top-frequency customer.

## Interpretations

A window order count in the low thousands, concentrated almost entirely in a single non-primary shop, spread across hundreds of distinct order days, on an account with no company name on file, is a pattern more consistent with a point-of-sale or wholesale-style account than an individual retail shopper making that many separate purchase decisions in a year. This audit cannot confirm that from the data available to it (no session, device, or till/register linkage is queried) — it reports the pattern and leaves the operational classification to whoever owns the PrestaShop back office.

Whatever this account turns out to be, its presence alone is proof that pooling every `ps_customer` row into one Frequency distribution lets a single account dominate the top percentile bucket, which is exactly why variants B/C/D/E exist: to make that dominance visible and quantifiable rather than silently baked into `p95`/`p99`/`max`.

Excluding it (variant E) versus excluding by threshold (B/C) answer different questions: E isolates the effect of *this one account*; B/C test whether a general operational-account threshold would be a defensible standing rule.

## Decisions

1. The outlier's identity is never published, logged, or persisted outside the live DB session — every profiling query returns aggregates about it, never its `id_customer`.
2. Population variants A/B/C/D/E are diagnostic; this audit does not modify the published population or scores based on them.
3. Winsorization (variant D) is explicitly diagnostic-only and must never become the published Frequency metric — the published metric remains the raw `COUNT(DISTINCT id_order)` (see `CP-R1-T10A-scoring-recommendation.md`).
4. A standing operational-account exclusion rule (if any) must be a deliberate, documented decision made after reviewing variant B/C impact across more than one asOfDate — not something this audit freezes.

## Follow-up

- Have PrestaShop back-office access confirm whether this account (and any others matched by the shared-account heuristic in `CP-R1-T10A-prestashop-identity-quality.md`) is operational, wholesale, or a legitimate high-frequency customer.
- Re-run this section at `-30`/`-60`/`-90` days (see `CP-R1-T10A-temporal-stability.md`) to check whether the same account is the top outlier at every asOfDate or whether it rotates.
