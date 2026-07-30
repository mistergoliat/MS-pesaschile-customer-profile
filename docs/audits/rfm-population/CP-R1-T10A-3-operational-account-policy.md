# CP-R1-T10A-3 Operational Account Policy

## Facts

Policy version `operational-account-v1` (`lib/operational-signals.ts`, output `operational-account-policy.json`). It never excludes an account on `frequencyOrders > N` alone. Three aggregate, explainable signals are computed per account from lifetime, per-shop data:

- `operational_shop_concentration_gte_95pct` — at least 95% of the account's lifetime valid orders fall in shop 2 or shop 3.
- `lifetime_orders_gt_100` — lifetime valid order count exceeds 100.
- `order_density_gt_2_per_distinct_day` — lifetime valid orders divided by distinct order days exceeds 2.

Exclusion requires **all three simultaneously** (AND, not OR). `operational-account-sensitivity.json` compares scoring with the flagged account(s) included vs excluded, and P1 (shop-1-only) vs P0/P3, to check whether restricting to shop 1 already makes individual exclusion unnecessary.

## Interpretations

Any single one of these signals alone is too weak to justify exclusion: a customer could plausibly have 95%+ of their orders in a physical-location shop without being operational (a loyal walk-in customer), or exceed 100 lifetime orders over several years without unusual density, or have dense order days from a short burst of legitimate activity (e.g. a small business owner restocking). Requiring all three at once — concentrated in a non-primary shop, extreme in volume, and dense in cadence — is what makes this an explainable, defensible signal rather than an arbitrary cutoff, consistent with the audit brief's explicit instruction not to exclude on a bare frequency threshold.

Because P1 already restricts scoring to shop-1 orders, an account whose activity is almost entirely in shops 2/3 may simply not appear in P1's window population at all — `operational-account-sensitivity.json`'s `doesRestrictingToShop1MakeIndividualExclusionUnnecessary` field reports whether that turned out to be true for the accounts observed in this run. If so, the policy stays defined (for future accounts or a future population change) even though it currently has little or nothing left to exclude within P1.

## Decisions

1. Policy version `operational-account-v1` is adopted, with the three-signal AND rule above.
2. No account identity is ever published — only aggregate counts of accounts evaluated and flagged.
3. Flagged accounts are not merged, deleted, or silently dropped by this audit — they remain visible in lifetime/lifecycle context and are excluded only from the P3 scoring variant.
4. Manual back-office review is required before this policy becomes a standing production rule; this audit has no write capability to record such a review.
5. Future treatment of confirmed operational accounts: a dedicated operational/B2B model, not folded into `rfm-v1` B2C scoring and not silently dropped from all reporting.

## Follow-up

- Route flagged accounts (count only, from `operational-account-policy.json`) to PrestaShop back-office review.
- Revisit the three thresholds (95%, 100, 2) if the population grows and produces materially more borderline cases; they are versioned (`operational-account-v1`) specifically so they can change without ambiguity about which rule produced a given historical result.
