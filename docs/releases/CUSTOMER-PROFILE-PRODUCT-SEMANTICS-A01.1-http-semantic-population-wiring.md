# CUSTOMER-PROFILE-PRODUCT-SEMANTICS-A01.1 — HTTP Semantic Population Wiring

Status: `READY_WITH_DOCUMENTED_OPERATIONAL_VALIDATION`

Decision: `HTTP_SEMANTIC_POPULATION_WIRING_READY`

## CURRENT_PIPELINE

The operational entrypoints are:

```text
scripts/customer-commercial-affinity/a01-4-population.ts
scripts/customer-commercial-affinity/a01-5-snapshot-build.ts
```

Both read the PrestaShop purchase population with
`createMysqlCustomerAffinityPurchaseReader`, acquire Product Semantics, call
`buildCustomerCommercialAffinityPopulation`, and then (for A01.5) build, validate, and publish
through `createMysqlCustomerCommercialAffinitySnapshotStore.publishSnapshot`.

Before A01.1, Product Semantics came from `FileProductSemanticSnapshotSource` through the complete
filesystem snapshot consumer. A01.1 changes only that operational source and leaves the affinity
domain, eligibility, scoring, population builder, and snapshot persistence contracts unchanged.

## IMPLEMENTED_WIRING

The runners now execute this chain:

```text
PrestaShop purchase reader
  -> distinct productIds, numeric ascending
  -> HttpProductSemanticFactsSource
  -> Catalog POST /v1/products/semantics/batch
  -> first response pins one Product Semantic Snapshot
  -> later batches send expectedSnapshotId
  -> normalized ProductSemanticFact[]
  -> existing affinity population builder
  -> existing scoring and snapshot validation
  -> existing atomic snapshot persistence/publication
```

The loader is `loadProductSemanticSnapshotFromFactsSource`. It reuses the existing batch
contracts and HTTP source, splits requests at the Catalog limit of 500, rejects cross-batch
duplicates or incomplete coverage, and validates the complete lineage before returning facts.
Product identity remains the existing numeric product-level identity:
`Catalog productId = ps_product.id_product = ps_order_detail.product_id`.

## DEFAULT_OPERATIONAL_SOURCE

`AFFINITY_SEMANTIC_SOURCE` defaults to `http`. HTTP requires both
`CATALOG_SERVICE_BASE_URL` and `CATALOG_SERVICE_API_KEY`.

Filesystem execution remains available only through the explicit
`AFFINITY_SEMANTIC_SOURCE=file` selection and `PRODUCT_SEMANTIC_SNAPSHOT_DIR`. There is no
production fallback from HTTP to filesystem; a Catalog failure aborts the run.

## BATCHING

Product IDs are collected once from purchase rows, deduplicated, and sorted numerically. No request
is made per purchase row or per customer. Metrics record `requestedDistinctProductIds`,
`requestedProductIds`, `semanticBatches`, `matchedSemanticFacts`, and `missingProductIds`.

## SNAPSHOT_PINNING

The first batch is sent without `expectedSnapshotId`. Its `snapshotId` becomes the run's pinned
identity. Every subsequent batch sends that exact ID. A `409 PRODUCT_SEMANTIC_SNAPSHOT_MISMATCH`,
or any returned snapshot/lineage mismatch, aborts the entire load. The loader never continues with
a newly published Catalog snapshot and never returns a mixed fact set.

## LINEAGE

All batches must agree on:

- `productSemanticSnapshotId` / `snapshotId`;
- `productSemanticSchemaVersion` / `schemaVersion`;
- `ontologyVersion`;
- `ontologyHash`;
- `classifierVersion`; and
- `semanticChecksum`.

The existing affinity manifest/header receives the pinned snapshot and lineage through the existing
`ProductSemanticSnapshotConsumerMetadata` shape. No redundant checksum or ontology representation
was introduced.

## FAILURE_POLICY

The Catalog HTTP client owns retries. It retries timeout, network/connection failures, and
retryable 5xx/503 failures up to `CATALOG_SERVICE_MAX_RETRIES` (default `2`). It does not retry
400-level validation failures, authentication/authorization failures, snapshot mismatch (409),
malformed responses, or lineage incompatibility. The population loader does not add a second retry
loop, so transient requests do not create nested retry storms.

## PUBLICATION_SAFETY

Semantic acquisition, population build, header construction, and validation all complete before
`publishSnapshot` is called. Any semantic or lineage failure therefore makes no publication call.
The existing snapshot store performs building-row writes and publication in its existing transaction;
rollback leaves the previous published snapshot untouched. A01.1 does not run a production
publication locally.

## FILESYSTEM_SOURCE

`FileProductSemanticSnapshotSource` and the complete-snapshot consumer remain available for tests,
offline validation, and explicit local execution. The operational runners no longer instantiate the
filesystem source directly, and no silent fallback exists.

## METRICS

The A01.4 artifact log and A01.5 report now include bounded evidence for purchase rows, distinct
products, semantic batches, requested IDs, matched facts, missing IDs, classification counts for
`CLASSIFIED`, `PARTIALLY_CLASSIFIED`, `OTHER`, `EXCLUDED_NON_PRODUCT`, and `NEEDS_REVIEW`, plus the
pinned `productSemanticSnapshotId`, `ontologyVersion`, and `ontologyHash`.

`OTHER` and `EXCLUDED_NON_PRODUCT` are returned semantic facts and remain distinct from
`missingProductIds`. Existing eligibility and scoring semantics are unchanged.

## TESTS

Focused coverage was added for single and multi-batch loading, deterministic ordering, first-batch
unpinned requests, later-batch pinning, snapshot/lineage mismatch aborts, cross-batch duplication,
missing-ID separation, explicit filesystem selection, and Catalog retry/auth behavior. Existing
consumer and affinity-builder tests continue to cover status semantics and score invariance.

## A01_2_DEBT

The purchase reader still omits quantity/evidence quantity. This remains deferred to
`A01.2 — Commercial Evidence Field Closure`; A01.1 does not alter affinity scoring or evidence
semantics.

## OPERATIONAL_VALIDATION_PLAN

This local slice does not mutate EC2 or publish against production data. Later validation should:

1. Confirm Catalog has an active immutable Product Semantic Snapshot for
   `commercial-product-ontology-v3`, with its canonical `ontologyHash` and batch endpoint
   available to the Customer Profile service account.
2. Configure Customer Profile with the Catalog base URL, service key, timeout, retry limit, and
   `AFFINITY_SEMANTIC_SOURCE=http`; verify no filesystem path is selected.
3. Run a bounded non-publishing affinity population/dry-run against the live Catalog and
   PrestaShop sources.
4. Verify the report has one pinned `productSemanticSnapshotId`, consistent ontology/classifier/
   checksum lineage, deterministic batch counts, and separate missing/status counts.
5. Repeat with more than 500 distinct purchased products and inspect Catalog request bodies:
   batch one has no `expectedSnapshotId`; all later batches carry the first snapshot ID.
6. Exercise or observe a snapshot publication during a multi-batch run; the Customer Profile run
   must fail with the typed mismatch and must not build/publish a mixed affinity snapshot.
7. Only after the dry-run evidence is approved, execute the existing snapshot build/publication
   procedure under its normal operational controls and verify the resulting affinity header
   lineage matches the pinned Catalog snapshot.

Required proof is the end-to-end chain:

```text
Customer Profile
  -> live Catalog batch
  -> one pinned semantic snapshot
  -> affinity population
  -> validated snapshot build
  -> publication with no mixed lineage
```

## DECISION

`HTTP_SEMANTIC_POPULATION_WIRING_READY`
