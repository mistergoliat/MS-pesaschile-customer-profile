# CUSTOMER-INTELLIGENCE-A01.4.1 — Real Affinity Population Source Hardening and Validation

Status: validated with documented query-plan debt. This release validates the offline real-data
population for `customer-commercial-affinity-v1`; it does not persist the population, expose it
through runtime profile responses, or change the scorer, semantic snapshot, or Customer Commercial
Profile contracts.

## Decision

`CUSTOMER_COMMERCIAL_AFFINITY_POPULATION_VALIDATED_WITH_DOCUMENTED_DEBT`

The original monolithic joined read exceeded the five-minute offline timeout. The hardened reader
now establishes one immutable `MAX(id_order)` watermark, pages eligible order headers by ascending
`id_order`, and fetches all eligible detail rows for each complete order-id page. It uses a fixed
reference timestamp in every query, never splits an order across batches, emits progress, and
retries only bounded transient failures. The real run completed successfully with zero retries.

## Source contract and query-plan audit

The source is read-only PrestaShop data from `ps_orders`, `ps_customer`, `ps_currency`, and
`ps_order_detail`. The eligibility policy is
`valid-positive-clp-order-before-reference-time-v1`:

- `o.valid = 1`;
- `o.total_paid_tax_incl > 0`;
- `o.id_customer > 0` and not one of `85980, 39617, 90890, 86421`;
- `cur.iso_code = 'CLP'`;
- strict `o.date_add < referenceTime`;
- `od.total_price_tax_incl > 0`.

The selected grain is exactly `customerId × orderId × orderDetailId × orderCreatedAt × productId ×
lineRevenueTaxIncl`. The reader converts MySQL `DATETIME` text explicitly to UTC ISO before the
pure builder applies its defensive cutoff. No DDL or write query was issued.

The read-only grant check returned `safe=true`, no disallowed privileges, no `GRANT OPTION`, and
one grant statement. `SHOW INDEX` found `PRIMARY` on `ps_orders.id_order`, `idx_orders_idorder_shop`
and related order indexes, plus `order_detail_order` and
`id_order_id_order_detail` on `ps_order_detail`. The observed plans used `id_currency` for the
currency-constrained header access, `idx_orders_idorder_shop` for the keyset range, and
`order_detail_order` for detail lookup. Header-page and line-batch plans still report
`Using temporary; Using filesort`; this is the documented debt. The bounded keyset strategy keeps
that plan cost finite per page and completed the full population.

Boundary diagnostics at the fixed UTC reference returned 144,508 lines before the reference,
58 at or after it, 0 positive lines below the six-decimal monetary precision, 21 non-positive
lines, and 144,487 eligible positive lines. The reader and builder now agree on the 144,487-line
count; the prior eight-line discrepancy was caused by interpreting zone-less MySQL `DATETIME`
text in the local timezone and is fixed in the adapter.

## Final reader strategy and run

`REFERENCE_TIME`: `2026-09-01T00:00:00.000Z`

`SOURCE_WATERMARK`: `id_order=81685`

`BATCH_SIZE`: `1000` (bounded configuration range 1–2500), `66` complete-order batches,
`133` source queries, `0` retries. The source read completed in `40,391.845 ms`; semantic join
was `106.086 ms`; aggregation/scoring was `7,222.764 ms`; total CLI runtime was `48,607.686 ms`.
The original monolithic query exceeded five minutes before it was stopped.

A second full run with `batchSize=2500` completed in `21,779.554 ms`, using 27 batches and 55
source queries. It produced the same 102,971 rows and identical dataset and affinity checksums,
confirming batch-size determinism and no order splitting/duplication.

## Real population manifest

| Metric | Result |
|---|---:|
| Source customers | 45,197 |
| Eligible customers | 45,197 |
| Eligible orders | 65,909 |
| Eligible order lines | 144,487 |
| Distinct purchased products | 1,688 |
| Products with semantic fact | 1,688 |
| Products without semantic fact | 0 |
| Affinity rows | 102,971 |
| Customers with affinity | 43,284 |
| Customers without affinity | 1,913 |

Semantic coverage is `customer=95.767418%`, `orderLine=88.106889%`, `spend=93.915000%`, and
`product=100%`. Unknown product coverage is zero: `NO_SEMANTIC_EVIDENCE` has 0 lines, 0
customers, 0 products, and `0.000000` spend.

Status distribution by line/customer/product/spend:

| Status | Lines | Customers | Products | Spend |
|---|---:|---:|---:|---:|
| CLASSIFIED | 123,747 | 42,654 | 1,076 | 8,909,760,746.337100 |
| PARTIALLY_CLASSIFIED | 3,144 | 1,772 | 396 | 397,590,125.000000 |
| OTHER | 12,865 | 8,974 | 206 | 655,270,622.338000 |
| EXCLUDED_NON_PRODUCT | 4,731 | 3,100 | 10 | 30,391,303.000000 |
| NEEDS_REVIEW | 0 | 0 | 0 | 0.000000 |

Rows by axis are `PRODUCT_FAMILY=81,853`, `DISCIPLINE=7,841`, and `USE_CONTEXT=13,277`.
Distinct code counts are `21`, `8`, and `6`; customers represented by axis are `43,063`,
`6,987`, and `9,841`, respectively.

Rows per customer: min/median/p75/p90/p95/p99/max/mean =
`1 / 2 / 3 / 5 / 7 / 12 / 25 / 2.378962`.

Score distributions (min/median/p75/p90/p95/p99/max/mean):

- `PRODUCT_FAMILY`: `0.062458 / 0.273492 / 0.323751 / 0.394819 / 0.437489 / 0.497405 / 0.570758 / 0.267022`.
- `DISCIPLINE`: `0.065889 / 0.262600 / 0.321951 / 0.406420 / 0.451047 / 0.504589 / 0.554871 / 0.261711`.
- `USE_CONTEXT`: `0.069425 / 0.292049 / 0.357726 / 0.426883 / 0.455177 / 0.498860 / 0.566230 / 0.295645`.

The exact `supportingOrderCount` audit is min/median/p75/p90/p95/p99/max/mean =
`1 / 1 / 1 / 2 / 2 / 3 / 23 / 1.158365`. Counts are derived from the distinct
`customerId × affinityAxis × affinityCode × orderId` set, so multiple products or detail lines
from one order count once.

Top customer-coverage codes are `PROTECTIVE_GEAR (13,337)`, `DUMBBELL (10,976)`,
`WEIGHT_PLATE (9,406)`, `BARBELL (8,257)`, and `FLOORING (6,075)`; the highest-spend code is
`COMMERCIAL_GYM` with `2,189,665,315.500000` supporting spend. No unknown-product report rows
were emitted.

## Lineage, checksums, and artifact

The active A01.3 semantic snapshot is
`sha256:79cef493e4f3bfdc3dffef8471bcde41bc96cd1a86e7344c85e7113569d84b12`, schema `1`, ontology
`commercial-product-ontology-v3`, ontology hash
`f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955`, source semantic checksum
`dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e`, and consumer normalized
checksum `576f3cef473268ad04875e0fdffeee40c48687da2a4a4920500c5d908c46815e`.

The gitignored artifact is `artifacts/customer-commercial-affinity/a01-4-population.json`;
size `34,947,509` bytes. `datasetChecksum` is
`6cb645ea5c78890f433943c8e4f2f7505579295b7388326939bb502b962e1520` and
`affinityDatasetChecksum`/`checksum` is
`9fa39ad2655c368c0515067cea522aeef18a516c64d206211691d30414d73c4e`.

## Validation gates and handoff

Focused tests cover keyset boundaries, complete-order batching, no duplicates, bounded retries,
empty exclusion policy, batch-size determinism, exact order counts, semantic status handling,
unknown products, money aggregation, permutation determinism, and read-only SQL shape. The
Customer Commercial Profile runtime remains unchanged (`commercialAffinity=null`,
`availability.commercialAffinity=NOT_IMPLEMENTED`).

Final gates passed: TypeScript typecheck, full test suite, lint, build, A01.4 population-builder
regressions, scorer regressions, A01.3 semantic-snapshot consumer/compatibility checks, and A02
Customer Commercial Profile regressions.

Next step: A01.5 may persist the validated artifact/header and rows after reviewing the documented
temporary/filesort plan debt. It must preserve the exact order-count and semantic lineage fields
and must not wire this population into runtime profile responses as part of A01.5.
