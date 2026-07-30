# CP-R1-T10A RFM Population Distribution Audit

## Facts

This audit defines a read-only, reproducible RFM population distribution process. It does not implement an RFM endpoint, does not modify runtime contracts, and does not create production snapshots, migrations, writes, or backfills.

`master_customer` migration and population are still not complete, so this audit cannot yet run under canonical identity. It now supports an explicit `RFM_IDENTITY_MODE` (`CP-R1-T10A-identity-mode.md`): `prestashop_customer` (provisional, no CRM required, used for this execution) or `master_customer` (canonical, unchanged from the original behavior, still blocked). Every output carries `identityMode`/`identityAuthority`/`identityCanonical`/`migrationPending` metadata, and the population-count field was renamed from `totalCanonicalCandidates` to `totalIdentityCandidates` because canonicality cannot be claimed in `prestashop_customer` mode.

This audit was extended (CP-R1-T10A-2) to determine whether `prestashop_customer`-based results are statistically and commercially valid as a *provisional* basis for `rfm-v1` — not whether `ps_customer` is canonical. That extension added:

- `CP-R1-T10A-prestashop-identity-quality.md` — section 2, `ps_customer` data quality (emails, duplicates, thresholds, test/internal patterns), aggregate only, no PII.
- `CP-R1-T10A-frequency-outlier.md` — section 3, the single highest-frequency customer, profiled in aggregate, never identified.
- `CP-R1-T10A-multishop.md` — section 4, per-shop population/order/spend/R-F-M facts across the three `id_shop` values present in valid orders.
- `CP-R1-T10A-frequency-threshold-simulation.md` — section 6, three candidate discrete F-score models (A/B/C), none using `NTILE`.
- `CP-R1-T10A-commercial-validity.md` — section 8, data-driven answers about whether candidate score groups are commercially distinguishable.
- `CP-R1-T10A-temporal-stability.md` — section 9, real re-runs at `asOfDate`/`-30d`/`-60d`/`-90d`, not a placeholder.
- `CP-R1-T10A-master-migration-plan.md` — section 10, a design-only future validation plan against `master_customer`; executes no query.

Required explicit inputs:

```text
RFM_AS_OF_DATE=YYYY-MM-DD
RFM_IDENTITY_MODE=prestashop_customer | master_customer
```

Timezone is UTC. The window is:

```text
windowStartInclusive = asOfDate minus 12 calendar months
windowEndExclusive = day after asOfDate
```

Commercial purchase evidence is `ps_orders.valid = 1`. RFM monetary uses `SUM(total_paid_tax_incl)` from valid orders, gross tax included, not net of external refunds.

Population states:

- active: at least one valid order inside the 12-month window.
- historical_inactive: at least one lifetime valid order and zero valid orders inside the window.
- no_valid_purchases: no valid order history.

Historical inactive customers do not enter active R/F/M percentile calculations with F=0 and M=0.

## Interpretations

RFM is a population model, not a per-request runtime read. The future runtime should read a versioned snapshot by `masterCustomerId`, because score boundaries depend on the full eligible population and must remain stable for a given `modelVersion` and `asOfDate`.

Identity is canonical only when `master_customer.prestashop_customer_id` is confirmed and unique. Unconsolidated PrestaShop history is measured as coverage pending and excluded from T10 v1 scoring.

That canonical-identity statement describes `RFM_IDENTITY_MODE=master_customer` only. In `prestashop_customer` mode, `ps_customer.id_customer` is used directly as a provisional population key: it is valid for building and stress-testing RFM mechanics (distributions, scoring, temporal stability) today, but every result it produces stays marked `identityCanonical: false` until validated against `master_customer` per `CP-R1-T10A-master-migration-plan.md`.

Lifecycle remains separate from RFM. `new_customer`, `active`, `historical_inactive`, and `no_purchase_history` describe customer lifecycle state; R/F/M scores describe relative population rank.

## Decisions

1. Active population: customers with at least one `ps_orders.valid = 1` order inside the 12-month window.
2. Historical inactive population: customers with lifetime valid purchases and no valid order inside the RFM window.
3. No RFM population: customers without any valid order history.
4. Exact window: `windowStartInclusive = asOfDate minus 12 calendar months`; `windowEndExclusive = day after asOfDate`.
5. asOfDate: explicit `RFM_AS_OF_DATE=YYYY-MM-DD`, UTC, never `CURRENT_DATE`, `NOW()` or server time.
6. R definition: complete days between `asOfDate` and the last valid order inside the window.
7. F definition: `COUNT(DISTINCT id_order)` inside the window.
8. M definition: gross `SUM(total_paid_tax_incl)` inside the window, tax included, not net of refunds.
9. R score method: tie-safe percentile rank by recency value; lower recency receives higher score.
10. F score method: versioned discrete thresholds selected from the observed frequency distribution; no `NTILE` over rows.
11. M score method: tie-safe percentile rank on raw gross monetary value.
12. Tie policy: identical metric values always receive the same score.
13. RFM/lifecycle separation: lifecycle is not collapsed into RFM score or RFM code.
14. Initial lifecycle rule: `new_customer` when first valid order is within 90 days and lifetime valid order count is 1.
15. Canonical identity: score only `masterCustomerId` records with one confirmed `prestashop_customer_id`.
16. Unconsolidated identity: exclude from T10 v1 snapshots and report as coverage pending.
17. Pipeline frequency: daily.
18. Model versioning: persist `modelVersion`, `asOfDate`, and window bounds with every snapshot row.
19. Snapshot structure: use `CustomerRfmSnapshot` fields documented in the snapshot architecture report.
20. Indexes and batches: verify with `EXPLAIN`; batch the population extraction if a live read-only run exceeds safe timeout or load guardrails.
21. Future endpoint fields: expose status, modelVersion, calculatedAt, asOfDate, window bounds, metrics, scores, percentiles, and lifecycleStage.
22. Out of T10: no named commercial RFM segment, no endpoint in T10A, no classification, no writes, no migrations, no backfill.
23. Identity mode: explicit `RFM_IDENTITY_MODE`, no default — see `CP-R1-T10A-identity-mode.md`.
24. Multishop treatment: not frozen — see `CP-R1-T10A-multishop.md`.
25. F cuts: not frozen — three models simulated, none chosen — see `CP-R1-T10A-frequency-threshold-simulation.md`.
26. Outlier treatment: diagnosed, not excluded from the published population — see `CP-R1-T10A-frequency-outlier.md`.
27. Conditions to freeze `rfm-v1`: not met by this run (multishop undecided, F cuts unfrozen, outlier treatment unresolved, identity still provisional) — see `decisionsClosed` in `audit-result.json`.

## Follow-up

- Execute the script only with approved read-only CRM and PrestaShop credentials.
- `RFM_IDENTITY_MODE=master_customer` remains blocked until `master_customer` migration and population are completed; execute `CP-R1-T10A-master-migration-plan.md`'s comparison once it is.
- This audit has now been executed for real under `RFM_IDENTITY_MODE=prestashop_customer`; every output under `outputs/` (ignored, non-productive) reflects that live run — see the extension docs listed in Facts for what each output means and what remains provisional.
- Review live `EXPLAIN FORMAT=JSON` before implementing the future snapshot job.
