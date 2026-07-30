# CP-R1-T10A RFM Population Distribution Audit

## Facts

This audit defines a read-only, reproducible RFM population distribution process. It does not implement an RFM endpoint, does not modify runtime contracts, and does not create production snapshots, migrations, writes, or backfills.

The real execution is currently blocked until `master_customer` migration and population are completed. The framework can be committed now; the live aggregate audit remains pending.

Required explicit cutoff:

```text
RFM_AS_OF_DATE=YYYY-MM-DD
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

## Follow-up

- Execute the script only with approved read-only CRM and PrestaShop credentials.
- Unblock real execution after `master_customer` migration and population are completed.
- Fill the aggregate output files under ignored `outputs/`.
- Review live `EXPLAIN FORMAT=JSON` before implementing the future snapshot job.
