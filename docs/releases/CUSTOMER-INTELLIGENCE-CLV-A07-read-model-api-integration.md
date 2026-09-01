# CUSTOMER-INTELLIGENCE-CLV-A07 — CLV Read Model + API Integration

## Status

`CLV_READ_MODEL_API_READY_WITH_DOCUMENTED_DEBT`

A07 adds read-only serving of the active published CLV snapshot. It does not
train, recalculate, build, publish, or mutate CLV snapshots.

## API contract

`GET /v1/customers/:customerId/clv` returns the existing runtime envelope with
`status: "available"`, `customerId`, `clv`, and `contractVersion:
"customer-clv-runtime-v1"`.

The bounded `clv` object contains:

- `horizonMonths: 12`
- `expectedRevenueTaxIncl` and, when persisted, `expectedOrders` as decimal strings
- `currencyIsoCode: "CLP"`
- `estimateSupportLevel: "SPARSE" | "SUPPORTED"`
- `modelVersion`, `estimatorPolicyVersion`, `referenceTime`, `generatedAt`
- `snapshotId`, `snapshotKey`, and `sourceAvailableDataThrough`

`GET /v1/clv/snapshot` exposes bounded active-snapshot metadata only. It does
not expose checksums, manifest internals, training metadata, or database
details.

## Customer Intelligence composition

`GET /v1/customers/:customerId/intelligence` is the single-customer HTTP
surface for the existing Customer Intelligence read model. Its `row.clv`
field is nullable. The existing feature/RFM/cluster SQL composition remains
the composition point; A07 adds one bounded A06 store lookup after that row
resolves. This keeps the separate database boundaries intact. Bulk internal
traversal uses the store's bounded batch lookup.

The read-model version remains `customer-intelligence-read-model-v1` because
the repository permits additive nullable fields for this contract. The
decision is explicit: existing consumers continue to parse the v1 envelope,
while new consumers can opt into `row.clv`.

## Nullability and identity

RFM, cluster, and CLV have independent coverage. Any of them may be absent
without making the other blocks invalid. Missing CLV is `null`, never a zero
estimate. CLV `customerId` is `prestashop_customer` and is joined to the
existing `prestashopCustomerId`; it is never implicitly mapped through
`master_customer.id`.

## Snapshot resolution and provenance

Runtime CLV reads use `CustomerClvSnapshotStore.getActiveSnapshotMetadata()`
and therefore select only the most recently published CLV snapshot. Building,
validated-but-unpublished, failed, and superseded snapshots are not served.
The CLV reference time and generated time remain separate:

- `referenceTime`: forecast origin
- `generatedAt`: snapshot computation time

Customer Intelligence preserves CLV provenance under `row.clv.snapshot` and
`row.clv.model`, independently of feature/RFM/cluster provenance.

## Error semantics and degradation

- no active snapshot: HTTP 404, `NO_ACTIVE_CLV_SNAPSHOT`
- customer absent from active snapshot: HTTP 404, `CUSTOMER_CLV_NOT_FOUND`
- analytics DB unavailable/timeout: HTTP 503/504
- malformed persisted CLV snapshot/row: HTTP 500, `MALFORMED_CLV_SNAPSHOT`

Customer Intelligence degrades the CLV block to `null` when CLV is absent or
unavailable, while preserving successful feature/RFM/cluster data. The direct
CLV endpoint reports the explicit availability error.

## Performance and query plan

The per-customer Customer Intelligence read uses the existing feature snapshot
key plus indexed snapshot/customer keys. CLV is looked up by
`(snapshot_id, customer_id)`, supported by A06's unique key
`uq_customer_clv_snapshot_row_customer`. Active metadata is one bounded
`published ... LIMIT 1` query. No full CLV population is loaded for a single
customer, and no distributed cache was introduced.

Local latency and `EXPLAIN` measurements remain environment-dependent and are
reported with the A07 validation run; the repository has no committed DB
integration harness in this checkout.

## Known debt

The local A06 fixture and migration are retained unchanged. The application
trusts the A06 manifest for production-only lineage fields and validates the
bounded fields before serialization. A future migration may normalize selected
manifest metadata into dedicated columns; that is outside A07.

## A08 handoff

The next consumer is Customer Commercial Profile / CLV consumer integration.
Copilot interpretation, dashboard UX, audiences, segments, affinity, and
budget policy remain out of scope.
