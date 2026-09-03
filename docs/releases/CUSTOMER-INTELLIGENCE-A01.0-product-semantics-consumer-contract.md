# CUSTOMER-INTELLIGENCE-A01.0 — Product Semantics Consumer Contract

## Decision

`PRODUCT_SEMANTICS_CROSS_SERVICE_CONTRACT_READY_WITH_DEBT`

Customer Profile now has an independent consumer-side projection and HTTP
source for Catalog's Product Semantics Batch contract. Catalog Service owns
semantic truth; Customer Profile owns customer truth, eligibility, and future
affinity interpretation.

## Delivered

- Added the consumer-side `ProductSemanticFactsSource` port with a batch input
  and lineage-bearing result.
- Added `HttpProductSemanticFactsSource` for
  `POST /v1/products/semantics/batch`.
- Added minimal response validation without importing Catalog types,
  ontology registries, classifier code, or filesystem internals.
- Preserved all five classification statuses and distinguished missing product
  IDs from `OTHER` and `EXCLUDED_NON_PRODUCT`.
- Added deterministic request de-duplication, exact response coverage/order
  validation, schema-version gating, lineage validation, and snapshot pinning.
- Classified timeout, network, `503`, authentication, `409`, and malformed
  responses with explicit retryability.
- Kept `FileProductSemanticSnapshotSource` intact for tests, offline
  validation, and compatibility tooling. No production bootstrap was changed
  to depend on a shared Catalog filesystem.

## Operational configuration

The service configuration surface is ready for the production wiring:

- `CATALOG_SERVICE_BASE_URL`
- `CATALOG_SERVICE_API_KEY`
- a bounded internal HTTP timeout (initial expectation: 2500 ms)

The API key must not reach frontend/browser code. Wiring the existing
population runner end to end is intentionally left for the next implementation
slice, where it can apply the pinned-snapshot lifecycle across multiple
500-ID calls.

## Compatibility policy

Schema version `1` is a hard gate. Ontology version/hash and classifier
version are preserved as lineage evidence and are not interpreted by this
adapter. A multi-batch population run must use one `snapshotId`; a mismatch
aborts the run and must not produce a mixed-lineage published affinity
snapshot.

## Scope exclusions

No population run, affinity scoring change, ontology/classifier change,
quantity model change, CRM change, or frontend integration was made.
