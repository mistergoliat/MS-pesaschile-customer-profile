# CUSTOMER-INTELLIGENCE-A01.6 — Published Affinity Read Model + Runtime Integration

Status: implemented and locally validated. No database was mutated and no commit was created.

## Runtime contract

The application reads only the latest logical row from `status='published'` affinity snapshots.
The runtime model exposes snapshot lineage plus normalized affinity rows. Rows preserve
`PRODUCT_FAMILY`, `DISCIPLINE`, and `USE_CONTEXT` independently, retain nullable
`explicitEvidenceCoverage`, and are ordered by `affinityAxis ASC, affinityCode ASC`.

The application batch operation accepts at most 5,000 customer IDs, de-duplicates IDs, and uses
one bounded metadata read plus one bounded `IN` query. It never recomputes affinity or calls
PrestaShop, catalog-service, product semantic files, or an LLM.

## Availability

- `AVAILABLE`: a published snapshot exists and the customer has one or more rows.
- `NOT_IN_POPULATION`: a published snapshot exists and the customer has no rows; no synthetic
  zero-valued rows are returned.
- `UNAVAILABLE`: no published snapshot exists, the analytics database is unavailable, or the
  snapshot is malformed/unsafe to read.

## HTTP

- `GET /v1/customers/:customerId/affinity`
- `GET /v1/customer-commercial-affinity/snapshot`

Customer rows with no affinity return HTTP 200 with `availability=NOT_IN_POPULATION` and
`affinity=null`. Missing or unsafe snapshot infrastructure returns HTTP 503.

## Profile integration and version decision

`customer-commercial-profile-v1` now composes the affinity read model. Affinity degradation is
isolated with `Promise.allSettled`; RFM, behavioral cluster, and CLV remain independently usable.
The profile version remains `customer-commercial-profile-v1`: this is an additive implementation
of the already-published `commercialAffinity` placeholder contract, with no field removal or
semantic change to existing dimensions.

## Migration 013 index audit

- Active published snapshot lookup: `idx_customer_commercial_affinity_snapshot_published`
  (`status, published_at, id`) supports the ordered latest-published lookup.
- Snapshot/customer row lookup: `idx_customer_commercial_affinity_snapshot_row_customer`
  (`snapshot_id, customer_id`) supports single-customer reads.
- Bounded customer batch lookup: the same `(snapshot_id, customer_id)` index supports the bounded
  `IN` lookup.

No index was added.
