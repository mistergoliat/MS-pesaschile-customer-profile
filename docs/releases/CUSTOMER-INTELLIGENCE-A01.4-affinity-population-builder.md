# CUSTOMER-INTELLIGENCE-A01.4 — Exact-Order-Grain Affinity Population Builder

Status: implemented as an offline deterministic builder. Production persistence, API exposure,
and Customer Commercial Profile integration remain out of scope.

## Contract and pipeline

The builder reads one bulk, read-only PrestaShop query at exact order-line grain:

`customerId × orderId × orderCreatedAt × productId × lineRevenueTaxIncl`.

It aggregates lines by customer/product only to feed the hardened A01.2.1 scorer. It then derives
`supportingOrderCount` from the exact set
`customerId × affinityAxis × affinityCode × orderId`, so two products with the same code in one
order count once. `supportingProductCount` remains the distinct product count and spend is summed
with the repository BigInt-backed decimal helper. Product-level `orderCount` is not a scoring
component; FREQUENCY and REPEAT remain absent from affinity v1.

The source policy is versioned as
`valid-positive-clp-order-before-reference-time-v1`: `o.valid = 1`, positive order total,
positive order-detail commercial revenue, positive customer id, and exclusion of the four
canonical operational accounts. `order.createdAt < referenceTime` is strict. Cancelled or
invalid orders therefore contribute nothing. The reader does not convert currencies; it consumes
the existing PesasChile CLP commercial source and records tax-inclusive line revenue.

The builder joins product IDs to one coherent A01.3 normalized Product Semantic Snapshot in
memory. Missing products are `NO_SEMANTIC_EVIDENCE`; they never become `OTHER` and never fail the
customer. `EXCLUDED_NON_PRODUCT` and `NEEDS_REVIEW` contribute nothing. `OTHER` contributes
discipline/use-context tags when present but never `PRODUCT_FAMILY / OTHER`. Classified and
partially classified facts contribute only the axes actually present.

## Artifact and diagnostics

The active snapshot consumed for this slice is `sha256:79cef493e4f3bfdc3dffef8471bcde41bc96cd1a86e7344c85e7113569d84b12`, schema version `1`, ontology `commercial-product-ontology-v3`, ontology hash `f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955`, source checksum `dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e`, and consumer checksum `576f3cef473268ad04875e0fdffeee40c48687da2a4a4920500c5d908c46815e`. It contains 2,011 normalized facts (1,281 classified, 400 partially classified, 317 other, 13 excluded, 0 needs review).

The CLI is:

```text
AFFINITY_REFERENCE_TIME=2026-09-01T00:00:00.000Z npm run customer:affinity:population
```

It writes the research artifact to the gitignored
`artifacts/customer-commercial-affinity/a01-4-population.json` by default. The manifest includes
lineage (`productSemanticSnapshotId`, schema version, ontology version/hash, source semantic
checksum, consumer normalized checksum), eligible population counts, exact order-line counts,
status diagnostics, customer/order-line/spend/product coverage, axis distributions, nearest-rank
score percentiles, top-code sanity lists, bounded numeric customer samples, unknown-product
coverage, and deterministic dataset/affinity checksums. No names, email addresses, or other PII is
included.

The retired `approximateSupportingOrderCount` field was replaced with exact
`supportingOrderCount` before any production affinity snapshot exists. A01.2.1's direct scorer
still returns its product-grain provisional value under that field; A01.4 is the authoritative
population boundary that replaces it with the exact order-ID set count.

## Validation

Focused A01.4 tests cover same-code products in one order, repeat purchases, multiple lines for
one product, strict cutoff, unknown products, semantic statuses, confidence coverage, money
aggregation, permutation determinism, and read-only SQL shape. Customer Commercial Profile remains
unchanged: `commercialAffinity = null` and `availability.commercialAffinity = NOT_IMPLEMENTED`.

The requested real-data run was attempted with the active A01.3 snapshot and the fixed reference
time above. The read-only grant check completed, but the historical PrestaShop bulk query did not
return within the five-minute offline timeout and was stopped. Consequently no real population
counts, checksum, artifact, or performance metrics are claimed in this release note. The query is
single-pass/read-only and should be rerun in an environment with an indexed/available replica;
its emitted manifest is the source of truth for those metrics.

## A01.5 handoff

Persist the validated artifact/header and rows only after reviewing the real-data coverage,
unknown-product report, and operational query performance. Keep the exact order count and both
semantic checksums as immutable lineage fields. Do not wire the population into runtime profile
responses as part of A01.5.
