# CUSTOMER-INTELLIGENCE-A01.5 — Affinity Snapshot Persistence

Status: implemented and dry-run validated. The controlled MariaDB persistence run is pending
because this checkout has no `RFM_SNAPSHOT_DB_*` analytics credentials configured. No production
runtime or HTTP response was changed.

## Database model

Migration `013_create_customer_commercial_affinity_snapshot_tables.sql` creates two dedicated
InnoDB tables in the local Customer Profile analytics database:

- `customer_commercial_affinity_snapshot`: lifecycle header, immutable lineage, population counts,
  checksums, source watermark, semantic coverage, performance metadata, and full manifest JSON.
- `customer_commercial_affinity_snapshot_row`: one normalized row per
  `snapshot_id × customer_id × affinity_axis × affinity_code`.

The migration includes a unique snapshot key, unique row identity, active/customer lookup indexes,
foreign-key cascade from rows to headers, and database checks for the three allowed axes, score
bounds, positive support counts, non-negative spend, and nullable evidence coverage. It is the next
number after the existing CLV migration 012. No PrestaShop table or database is modified.

Scores use `DECIMAL(12,9)` and `supportingSpend` uses `DECIMAL(20,6)`, matching the repository's
fixed-point CLP convention. `explicitEvidenceCoverage` uses nullable `DECIMAL(12,9)`; null remains
null and is never converted to zero.

## Header and row contracts

The header preserves calculation version, reference time, generated time, population and order
policies, identity authority, source watermark, all validated population counts, both population
checksums, and the complete Product Semantic Snapshot metadata. The required semantic lineage is:

```text
productSemanticSnapshotId = sha256:79cef493e4f3bfdc3dffef8471bcde41bc96cd1a86e7344c85e7113569d84b12
productSemanticSchemaVersion = 1
ontologyVersion = commercial-product-ontology-v3
ontologyHash = f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955
sourceSemanticChecksum = dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e
consumerSemanticChecksum = 576f3cef473268ad04875e0fdffeee40c48687da2a4a4920500c5d908c46815e
```

Rows preserve `customerId`, opaque `affinityAxis` and `affinityCode`, fixed-point score, exact
`supportingOrderCount`, exact `supportingProductCount`, decimal spend, UTC `lastEvidenceAt`, and
nullable explicit-evidence coverage. No `approximateSupportingOrderCount` exists.

`supportingOrderCount` is the exact distinct count over
`customerId × affinityAxis × affinityCode × orderId`; multiple products or detail lines from one
order count once. The 1,913 customers without affinity evidence are absent from the row table and
remain represented only by `customersWithoutAffinity` in the header.

## Snapshot key and lifecycle

The deterministic key contains calculation version, Product Semantic Snapshot ID and schema
version, ontology hash, population policy, reference time, consumer normalized checksum, and
dataset checksum. The same semantic output therefore resolves to the same key.

The production store lifecycle is:

```text
BUILDING → row insert → row-count/checksum validation → VALIDATED
         → supersede previous published affinity snapshot → PUBLISHED
```

The entire production path is one transaction. A failure rolls back row/header publication and
records a bounded `FAILED` reason when a header was already allocated. The previous published
snapshot remains active until the new transaction commits. Published snapshots are never updated
in place; subsequent populations create new immutable headers and rows. Existing validated or
published snapshots with matching key, dataset checksum, and affinity checksum are idempotently
reused; conflicting checksums fail closed.

The store also exposes explicit `createBuilding`, `writeRows`, `markValidated`, `publish`, and
`markFailed` lifecycle methods for future orchestration. `publishSnapshot` is the atomic production
convenience path used by the CLI.

## Validation and active reader

Before any database write, application validation checks complete header lineage, expected row
count, unique customer/axis/code identity, allowed axes, non-empty codes, score bounds, positive
support counts, decimal storage precision, strict `lastEvidenceAt < referenceTime`, nullable
coverage bounds, population checksum lineage, and the exact affinity checksum. The store repeats
this validation at its persistence boundary and re-computes the affinity checksum from rows read
back from MariaDB before publication.

`getActiveSnapshotMetadata()` selects only `status='published'`. `getCustomerAffinity(customerId)`
uses an active-snapshot join and customer predicate, so it does not scan the full population.
`getCustomerAffinities(customerIds)` is bounded to 5,000 IDs and preserves no artificial zero rows.
These methods are available for A01.6; they are not wired into HTTP in A01.5.

## Generator and validated dry run

The offline command is:

```text
AFFINITY_REFERENCE_TIME=2026-09-01T00:00:00.000Z npm run customer:affinity:snapshot:build -- --dry-run
```

It rebuilds from the hardened A01.4.1 PrestaShop reader plus the active A01.3 semantic snapshot,
rather than treating the gitignored A01.4 JSON artifact as the production source. It verifies the
same fixed reference time and outputs a bounded report to
`artifacts/customer-commercial-affinity/a01-5-snapshot-report.json` without opening an analytics
database or persisting anything.

The real dry run completed with:

```text
eligible customers = 45,197
eligible orders = 65,909
eligible lines = 144,487
affinity rows = 102,971
customers with affinity = 43,284
customers without affinity = 1,913
PRODUCT_FAMILY / DISCIPLINE / USE_CONTEXT = 81,853 / 7,841 / 13,277
datasetChecksum = 6cb645ea5c78890f433943c8e4f2f7505579295b7388326939bb502b962e1520
affinityDatasetChecksum = 9fa39ad2655c368c0515067cea522aeef18a516c64d206211691d30414d73c4e
```

The dry run also reproduced source watermark `id_order=81685`, 133 source queries, 66 batches,
and zero retries. Source extraction was approximately 41 seconds; population build was 7 seconds
and validation approximately 1.1 seconds.

## Controlled persistence status

The selected physical database is the same local analytics database/configuration family already
used by the CLV snapshot implementation: `RFM_SNAPSHOT_DB_*`. This avoids introducing a new
credential family and follows existing migration/pool conventions. In the current environment
those variables are absent, so `npm run customer:affinity:migrate` and a persisted snapshot build
were intentionally not attempted against an unknown database. This is an environment validation
debt, not a source or semantic block.

Once configured, the controlled sequence is:

```text
npm run customer:affinity:migrate
AFFINITY_REFERENCE_TIME=2026-09-01T00:00:00.000Z npm run customer:affinity:snapshot:build
AFFINITY_REFERENCE_TIME=2026-09-01T00:00:00.000Z npm run customer:affinity:snapshot:build
```

The first persisted run must verify active metadata, all three axis counts, bounded lookups for
customers with each axis and multiple axes, a no-row lookup for a customer without affinity, and
the same-key idempotent second run. Any checksum or row-count mismatch must stop publication.

## A01.6 handoff

A01.6 may consume the active reader and snapshot metadata, then integrate the read model with
Customer Commercial Profile. A01.5 deliberately leaves `commercialAffinity=null` and
`availability.commercialAffinity=NOT_IMPLEMENTED`; it does not add HTTP, Audience Engine,
Explorer, Copilot, scheduling, or runtime persistence wiring.
