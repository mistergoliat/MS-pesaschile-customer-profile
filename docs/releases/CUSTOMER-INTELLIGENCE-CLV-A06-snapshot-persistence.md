# Customer Intelligence CLV A06

**Date:** Monday, August 31, 2026
**Decision:** `CLV_SNAPSHOT_PERSISTENCE_READY_WITH_DOCUMENTED_DEBT`

## Persistence

CLV v1 now has a dedicated immutable snapshot store in the local Customer Profile analytics MariaDB schema configured by `RFM_SNAPSHOT_DB_*`. PrestaShop remains read-only. Migration `012_create_customer_clv_snapshot_tables.sql` creates `customer_clv_snapshot` and `customer_clv_snapshot_row`; no PrestaShop table is modified.

The lifecycle is transactional: `building` header, batched row insert, row-count and output-checksum verification, `validated`, supersession of the previous published stream, `published`, and commit. Any failure rolls the transaction back and leaves the previous published snapshot active. Historical superseded snapshots are retained.

## Contract and lineage

Rows persist `customerId`, non-negative `expectedRevenueTaxIncl` as `DECIMAL(20,6)`, optional non-negative `expectedOrders`, and `estimateSupportLevel` (`SPARSE` or `SUPPORTED`). Deprecated `reliabilityBucket`, profit, margin, budget, RFM, clustering, affinity, and campaign fields are not persisted.

The snapshot key includes model version, horizon, population policy, monetary policy, reference time, and the frozen model checksum. `referenceTime` is the forecast origin; `generatedAt` is the computation timestamp; `sourceAvailableDataThrough` is the source watermark. They are persisted separately.

The generator loads and verifies the A05 accepted descriptor before fitting. It uses only the frozen estimator and policies, records effective Stage A/Stage B training cutoffs and dataset checksums, and refuses descriptor/checksum mismatches. The public reader/store exposes active metadata, customer lookup, existence checks, and bounded bulk reads for A07.

## First run

The real dry-run generated and validated `45194` production rows without persistence. The controlled local persisted run published snapshot `1` with `45194` rows. A second identical run returned `snapshot already published: 1`, confirming semantic idempotency without duplicate output. Active reader verification returned status `published`, population `45194`, and a valid first page row.

The production population remains `customer-clv-population-valid-order-ge1-operational-excluded-v1`; currency is CLP-only; seller-service product `444` and configured non-product IDs retain their accepted exclusions; no FX conversion is used.

## Validation and operations

Snapshot validation covers complete header lineage, population/row count, unique positive customer IDs, decimal non-negativity, support enum values, checksum reproducibility, and fixed reference time. The dry-run report is `artifacts/clv/a06-dry-run-report.json`.

Measured dry-run generation used the accepted frozen model and current source population; the A05 observed baseline remains approximately 359 seconds and 1003 MB peak RSS. A06 records fit/prediction, validation, total duration, and peak RSS in the dry-run report for operational monitoring.

The accepted temporal-state debt `customer-clv-current-valid-observed-with-documented-drift-v1` is carried into snapshot training metadata. A06 does not reconstruct historical order state and does not change the model.

## Handoff

Migration: `migrations/012_create_customer_clv_snapshot_tables.sql`
Store: `src/infrastructure/clv/mysql-customer-clv-snapshot-store.ts`
Generator: `scripts/clv/snapshot-build.ts`
Next step: `CLV-A07 Read Model / API Integration`.

A06 does not create HTTP endpoints, integrate Customer Intelligence, publish runtime APIs, or schedule recurring generation.
