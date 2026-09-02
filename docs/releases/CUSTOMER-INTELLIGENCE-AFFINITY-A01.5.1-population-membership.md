# CUSTOMER-INTELLIGENCE-AFFINITY-A01.5.1 - Eligible Population Membership

Status: implemented. This release closes the Audience A01 population-membership block in the
affinity persistence contract. It does not implement Audience runtime, filters, HTTP endpoints,
contactability, exports, Brevo integration, or R3 integration.

## Root cause

A01.5 persisted affinity counts and normalized affinity rows, but not the complete eligible
customer identity set. A customer with no affinity rows could therefore not be distinguished from a
customer outside the eligible population. The builder is the authority for this set; affinity rows
are not used to reconstruct it.

## Schema and lifecycle

Migration [`014_add_customer_commercial_affinity_snapshot_population.sql`](../../migrations/014_add_customer_commercial_affinity_snapshot_population.sql)
adds `eligible_population_checksum` to the existing snapshot header and creates
`customer_commercial_affinity_snapshot_population` with only:

```text
snapshot_id BIGINT UNSIGNED NOT NULL
customer_id INT UNSIGNED NOT NULL
PRIMARY KEY (snapshot_id, customer_id)
FOREIGN KEY (snapshot_id) REFERENCES customer_commercial_affinity_snapshot(id) ON DELETE CASCADE
```

There is no duplicated customer metadata and no speculative secondary index. The checksum column
is nullable solely so pre-migration snapshots remain readable; every new snapshot requires it.

The atomic store path is:

```text
BUILDING -> insert population batches -> verify population -> insert affinity rows
          -> verify row subset/counts/checksums -> VALIDATED -> PUBLISHED
```

The header, population rows, affinity rows, validation, supersession, and publication are one
transaction in `publishSnapshot`. Any insert or validation error rolls back the transaction and
records a bounded failed-build reason when a header id was allocated. The staged lifecycle methods
also write population membership and refuse validation until the population is complete.

## Population source and checksums

`buildCustomerCommercialAffinityPopulation` now returns `eligibleCustomerIds`, sorted ascending,
alongside the existing rows and manifest. It includes customers whose eligible purchases produce no
semantic evidence and therefore no affinity rows. The same set is passed unchanged to snapshot
validation and persistence.

`eligiblePopulationChecksum` is `sha256Stable(sorted eligible customer IDs)`. It excludes timestamps,
database auto-increment ids, and environment metadata. Input ids must be positive safe integers and
unique. The checksum is included in the snapshot key, so a changed eligible set cannot reuse the
same immutable snapshot identity.

`affinityDatasetChecksum` remains the scoring-result checksum and is unchanged semantically. The
eligible-population checksum is a separate lineage value; the validated A01.5 affinity checksum
`e2d82e000357c9d9c25c9e8014e8219af5f7db49d8ad9d757d2fe353828cbd55` is not changed by this release.

## Validation invariants

Before publication, application and persistence validation require:

- persisted population row count equals `eligible_customer_count`;
- `customers_with_affinity + customers_without_affinity` equals `eligible_customer_count`;
- every affinity-row customer is present in the population table;
- all population ids are positive, safe, and unique;
- persisted ordered population checksum equals the header checksum;
- affinity row count and persisted affinity checksum match the header;
- duplicate snapshot row identity and invalid fixed-point values remain rejected.

## Idempotency and historical snapshots

The build script compares dataset, affinity, and eligible-population checksums before reusing a
validated or published key. An identical rebuild skips insertion, returns `idempotent=true`, and
cannot duplicate membership rows. The database id is not part of snapshot identity.

`HISTORICAL_SNAPSHOT_POLICY: REBUILD_NEW_SNAPSHOT`. Existing canonical snapshot id 3 is not
mutated and is not treated as Audience-compatible because its membership set was never persisted.
The established A01.5 source/build pipeline can reproduce the historical reference-time population,
policy, semantic lineage, and scoring version; the next persisted build therefore receives a new key
containing the eligible-population checksum and supersedes the old published snapshot atomically.

## Reader contract

The MySQL store exposes:

- `isCustomerInAffinityPopulation(snapshotId, customerId)`;
- `getAffinityPopulationMembershipBatch(snapshotId, customerIds)`.

Both require a published snapshot, use the persisted membership table, and have a 5,000-customer
batch bound. The batch method performs one bounded query and returns sorted matching ids; neither
reader queries PrestaShop or infers membership from affinity rows.

## Performance and operational validation

Population inserts use batches of 500 ids within the snapshot transaction, which is bounded by
batch size rather than one round trip per customer. The persisted result and manifest performance
metadata record population insert duration, population checksum duration, and total persistence
duration, together with the population row count.

The controlled real dry-run/persistence environment was not available in this checkout because
`RFM_SNAPSHOT_DB_*` credentials are absent. Required commands after configuring the approved local
analytics database are:

```text
npm run customer:affinity:migrate
AFFINITY_REFERENCE_TIME=2026-09-01T00:00:00.000Z npm run customer:affinity:snapshot:build -- --dry-run
AFFINITY_REFERENCE_TIME=2026-09-01T00:00:00.000Z npm run customer:affinity:snapshot:build
AFFINITY_REFERENCE_TIME=2026-09-01T00:00:00.000Z npm run customer:affinity:snapshot:build
```

The previously recorded A01.5 controlled dry run was approximately 45,197 eligible customers,
43,284 with affinity, and 1,913 without affinity. These values remain evidence targets, not
hard-coded validation values.

## Audience handoff and rollback

`AUDIENCE_A01_UNBLOCKED: YES` for the previously blocked affinity-membership contract. Audience
runtime remains out of scope and must consume the published snapshot metadata plus these readers.

Rollback uses [`014_add_customer_commercial_affinity_snapshot_population.rollback.sql`](../../migrations/014_add_customer_commercial_affinity_snapshot_population.rollback.sql):
it drops the membership table first, then removes the header checksum column. Existing snapshot
headers remain otherwise untouched.

Decision: `CUSTOMER_COMMERCIAL_AFFINITY_POPULATION_MEMBERSHIP_READY_WITH_DEBT` until the controlled
analytics migration and real persisted build are executed with the approved credentials.
