# CP-R1-T10A-3 Multishop Decision

## Facts

Output: `multishop-final-decision.json`. Per shop (id, non-PII display name from `ps_shop` when available, lifetime customers/orders/spend, rolling-12-month R/F/M summary) plus lifetime cross-shop customer counts. This closes CP-R1-T10A-2's multishop analysis, which explicitly left the shop treatment open.

Cross-shop customer handling for the chosen population (P1) is closed separately in `CP-R1-T10A-3-commercial-population-finalization.md`'s referenced `cross-shop-customer-policy.json` — Simulation A (shop-1-only eligibility and metrics) is adopted; see that file's `decision.rule`.

## Interpretations

Shop 1 (the e-commerce storefront) holds the overwhelming majority of lifetime customers and orders; shops 2 and 3 have far fewer customers but, per customer, materially different order cadence and ticket size (see CP-R1-T10A-2's `multishop-analysis.json` window statistics: shop 2 in particular shows a much higher average window frequency than shop 1, driven by a small number of accounts). That combination — low customer count, high per-customer frequency, name suggestive of a physical location or event channel rather than the online storefront — is evidence a name alone could not provide, and it is the basis for treating shops 2/3 as a different commercial operation rather than assuming so from their names.

## Decisions

1. Included shop for `rfm-v1-provisional`: **shop 1** only.
2. Excluded shops: **2 and 3** — retained for lifetime/lifecycle context, analyzed separately, never mixed into B2C scoring.
3. This decision is evidence-based (lifetime volume, window R/F/M shape, cross-shop overlap), not based on shop names alone.
4. A dedicated operational/wholesale model for shops 2/3 is proposed as future work, not designed in this task.
5. This closes the "Open" status left by CP-R1-T10A-2's `multishop-analysis.json`.

## Follow-up

- If shop 2/3 volume grows, revisit whether a dedicated model is warranted sooner than currently planned.
- Re-validate this split after any operational change to how shops 2/3 are used (e.g., if the physical location starts taking real e-commerce orders through the same shop id).
