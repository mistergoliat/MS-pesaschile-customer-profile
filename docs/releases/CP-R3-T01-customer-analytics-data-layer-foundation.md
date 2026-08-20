# CP-R3-T01 — Customer Analytics Data Layer Foundation

Status: **READY_WITH_CONSTRAINTS** (local implementation + full local test suite + live
read-only dry-run smoke complete; live migration-apply/publish/idempotency verification is
deferred to the EC2 deployment step per explicit instruction — this dev machine has no local
MariaDB reachable)
Git branch: `feat/cp-r3-t01-customer-analytics-data-layer` (based on `main` @ `662af29`)
Type: new, additive analytics infrastructure layer. No RFM/clustering/Commercial Profile
behavior changed.

---

## 1. Purpose and scope

Introduces a local, versioned, point-in-time materialized customer feature store —
`customer_feature_snapshot` / `customer_feature_snapshot_row` — that decouples RFM,
Behavioral Clustering, and future Customer Intelligence/Copilot work from repeated analytical
queries against the PrestaShop RDS. PrestaShop remains the sole operational source of truth;
this layer is a periodically-materialized, reproducible representation of it, not a
replacement (task Sections 0-2).

**Not built in T01** (explicitly out of scope, task Section "NO implementar todavía"):
Copilot/LLM layer, generic SQL executor, Segment Engine, Brevo, abandoned-cart features,
Marketing UI, Sales Agent integration, automatic scheduler. None of these were touched.

## 2. Architecture

```
PrestaShop RDS (READ ONLY, pc_consultor: GRANT SELECT ON *.* only)
        |
        v
src/infrastructure/prestashop/mysql-customer-feature-reader.ts   (raw aggregate extraction)
        |  Population B (>=1 valid order lifetime), no computed features yet
        v
src/domain/customer-analytics/feature-derivation.ts               (pure, DB-free)
        |  raw source row -> CustomerFeatureRow (18 derived fields)
        v
src/domain/customer-analytics/snapshot.ts                         (pure)
        |  rows -> manifest + sourceDatasetChecksum + featureDatasetChecksum
        v
src/application/customer-analytics/{create,run}-customer-feature-snapshot*.ts
        |  idempotency guard, execution lock, run log
        v
src/infrastructure/customer-analytics/mysql-customer-feature-snapshot-repository.ts
        |  transactional publish (local MariaDB only, ANALYTICS_DB_*)
        v
customer_feature_snapshot, customer_feature_snapshot_row  (local MariaDB)
        |
        v
src/infrastructure/customer-analytics/mysql-customer-feature-snapshot-reader.ts
        |  latest / by-id / single-row reads (application/customer-analytics/get-*.ts)
        v
(future) RFM / Clustering / Customer Intelligence / Copilot
```

CLI entry point: `npm run analytics:snapshot [-- --reference-time=ISO] [-- --dry-run]`
(`scripts/analytics/snapshot-features.ts`). Unlike clustering, there is no separate
model-training step — a feature snapshot is a materialized extraction, not a fitted model, so
extraction and publication collapse into one CLI (task Section 29).

## 3. Population policy (task Section 12 — audited live, not assumed)

Live PrestaShop audit, 2026-08-20 (`pc_consultor`, read-only):

| Population | Definition | Live count |
|---|---:|---:|
| A — all `ps_customer` rows | `id_customer > 0` | 72,983 |
| **B — this layer's population** | **>=1 valid order lifetime, operational accounts excluded** | **44,935** (44,908–44,936 across smoke runs at slightly different referenceTimes) |
| B′ — clustering's population | >=2 valid orders lifetime, operational accounts excluded | 10,148 |
| exactly 1 valid order | (B minus B′) | 34,787 |

**Chosen: Population B.** Task Section 12 explicitly required the Data Layer not be limited
by default to clustering's narrower B′, and listed ">=1 valid order" as the first-preference
option. Population A was rejected for the same reason the CP-R2 clustering readiness audit
already rejected it for clustering: a zero-order customer produces an all-empty commercial
feature vector — a data-availability fact, not a modeling choice
(`docs/audits/CP-R2-behavioral-clustering-readiness-feature-audit.md` Step 5). Verified live
that every Population-B customer has both a resolvable `ps_customer.date_add` (0 NULLs) and
at least one `ps_order_detail` line (0 customers with valid orders but no product rows), so
every commercial/product feature is computable for the whole population without imputation.

`populationPolicyVersion = 'customer-analytics-population-b-v1'`.

## 4. Valid order semantics (task Section 17 — reused, not redefined)

Identical eligibility to `mysql-cluster-population-reader.ts`: `valid = 1 AND
total_paid_tax_incl > 0 AND id_customer > 0 AND id_customer NOT IN (<4 excluded operational
accounts>) AND date_add < referenceTime`. Deliberately **not** RFM's seller-service-subtracted
monetary policy — that subtraction is RFM's own Monetary-metric business rule, not part of the
general "valid order" definition every other capability shares (confirmed by re-reading
`mysql-rfm-population-reader.ts` vs. `mysql-cluster-population-reader.ts` side by side before
writing the new reader).

`operationalExclusionPolicyVersion = 'operational-account-exclusion-v1'` (reused import from
`src/domain/customer-rfm/operational-account-exclusion-policy.ts`, never re-declared).
`shopScope = 'all_valid_prestashop_shops'` — same as RFM's shipped reader and clustering; the
pre-existing T10A-3-vs-shipped-RFM shop-scope inconsistency is inherited, not resolved here
(task Section 18).

## 5. Feature definitions (`featureVersion = 'customer-analytics-features-v1'`)

19 columns on `customer_feature_snapshot_row`: `prestashop_customer_id` (identity) + 18
derived commercial fields. 12 of them are byte-for-byte the same formulas as clustering's
Feature Set A (`distinctProducts, effectiveDiversity, averageUnitsPerOrder,
purchaseFrequencyDays, orders365d, customerTenureDays, repeatProductRate, top1Share,
top3Share, cancelledOrderRatio, discountShare, shippingShare`); 6 are commercial post-hoc
fields (`validOrders, totalSpentTaxIncl, averageOrderValueTaxIncl, firstOrderAt, lastOrderAt,
daysSinceLastOrder`).

| Field | Definition | Denominator note |
|---|---|---|
| `validOrders` | count of valid orders before `referenceTime` | |
| `totalSpentTaxIncl` | `SUM(orders.total_paid_tax_incl)` over valid orders | order-level, includes shipping |
| `averageOrderValueTaxIncl` | `totalSpentTaxIncl / validOrders` | |
| `firstOrderAt` / `lastOrderAt` | min/max valid `orders.date_add` | |
| `daysSinceLastOrder` | `floor((referenceTime - lastOrderAt) / 1 day)` | |
| `customerTenureDays` | `floor((referenceTime - ps_customer.date_add) / 1 day)` | independent of order count |
| `distinctProducts` | count of distinct `product_id` across valid orders' `order_detail` | |
| `repeatProductRate` | share of products purchased in >=2 distinct orders | product-level |
| `top1Share` / `top3Share` | HHI-style spend concentration shares | **product-level** spend (`SUM(order_detail.total_price_tax_incl)` per product), not order-level |
| `effectiveDiversity` | `1 / HHI` of the same product-level spend distribution | >=1, unbounded above |
| `averageUnitsPerOrder` | `SUM(order_detail.product_quantity) / validOrders` | |
| `purchaseFrequencyDays` | `(lastOrderAt - firstOrderAt) / (validOrders - 1)` days | **NULL when validOrders < 2** |
| `orders365d` | count of valid orders inside `(referenceTime - 365d, referenceTime]` | |
| `cancelledOrderRatio` | `cancelledOrders / totalOrdersAllStates` (`current_state = 6`) | denominator is **all** orders (any state), not just valid ones — cancelled orders never carry `valid=1` |
| `discountShare` / `shippingShare` | `totalDiscounts` / `totalShipping` over `totalSpentTaxIncl` | **order-level** total, not product-level (this differs from top1Share/top3Share's denominator — verified in `feature-derivation.ts`'s own header comment and covered by a dedicated unit test) |

**Deliberately excluded** (task Section 11): `rScore/fScore/mScore/rfmCode/rfmSegment` and
`clusterId/clusterLabel` — those are model/policy outputs, never persisted here.

No winsorization is applied here (unlike clustering's model-time transform) — the Data Layer
stores raw ratios; winsorization remains a downstream, model-specific preprocessing concern.

## 6. NULL semantics (task Section 13)

Only `purchaseFrequencyDays` is nullable, and only when `validOrders < 2` — a single-order
customer has no purchase interval to measure, matching the pre-existing
`commercial-summary-calculations.ts` precedent (`totalOrders < 2 ? null : ...`) rather than a
new convention. `repeatProductRate` is `0` (not null) for a one-time buyer — a genuinely
correct ratio (zero of one product repeated), not a missingness case. Verified live: real
customer 22092 (validOrders=1) — `purchaseFrequencyDays: null`, every other field populated.

## 7. Reference time / point-in-time guarantee (task Section 14/15)

Every temporal feature is computed against `snapshot.reference_time`, threaded explicitly from
the CLI through the reader and the pure domain builder — never `NOW()` inside a reader or a
consumer. Verified live: two independent CLI runs at the identical fixed
`--reference-time=2026-08-19T00:00:00.000Z`, several minutes apart, produced byte-identical
`sourceDatasetChecksum`/`featureDatasetChecksum`/`populationSize` (44,908 both times) — see
Section 13.

Once published, `customer_feature_snapshot_row` is never recomputed on read — the row IS the
answer to "what did the Data Layer derive for referenceTime X", independent of what PrestaShop
looks like later (task Section 15, the layer's core reason for existing).

## 8. Schema (migrations 008/009)

`customer_feature_snapshot` (header: `snapshot_key` unique, `status` enum
building/validated/published/failed/superseded, `reference_time`, `feature_version`,
`population_policy_version`, `operational_exclusion_policy_version`, `shop_scope`,
`population_size`, `source_dataset_checksum`, `feature_dataset_checksum`, `manifest_json`,
`generated_at`/`validated_at`/`published_at`).

`customer_feature_snapshot_row` (19 explicit typed columns, task Section 23 — no giant JSON
blob; every feature is directly `WHERE`/`GROUP BY`/`AVG`/`ORDER BY`-queryable). Money:
`DECIMAL(20,6)`. Ratios/derived floats: `DECIMAL(12,6)` (same 6-decimal convention
`behavior-decimal.ts`/RFM's `decimal.ts` already use throughout the codebase — chosen so this
reuses existing, already-tested exact-decimal arithmetic rather than introducing a new
precision convention). IDs: `INT UNSIGNED`/`BIGINT UNSIGNED`. Dates: `DATETIME(6)`.
`UNIQUE(snapshot_id, prestashop_customer_id)` + one index each on `snapshot_id` (via that same
unique key's leading column) and `prestashop_customer_id` alone — no per-feature indexes
(task Section 24).

`customer_feature_snapshot_run` (migration 009) — operational run log, mirrors
`customer_cluster_snapshot_run`, with a `GET_LOCK`-based execution lock preventing two
concurrent manual runs.

### Infrastructure note (task Section 7, per explicit instruction)

Per the user's explicit direction for this task: reuse the same physical local MariaDB
instance/schema RFM and clustering already use in EC2 (no new `CREATE DATABASE` privilege has
been provisioned there either — see `migrations/005_create_customer_cluster_tables.sql` for
the identical constraint T02 hit). Tables are namespaced `customer_feature_*` (never
`customer_rfm_*`/`customer_cluster_*`). `ANALYTICS_DB_*` is a fully independent credential
family in `src/config.ts` — pointing it at a dedicated `customer_analytics` schema later is a
one-line `.env` change, not a code change. **No RFM or clustering table was touched.**

## 9. Config (task Section 7/48)

`ANALYTICS_DB_HOST/PORT/USER/PASSWORD/NAME/CONNECTION_LIMIT/QUERY_TIMEOUT_MS` — optional,
all-or-nothing (same pattern as `CLUSTER_DB_*`/`RFM_SNAPSHOT_DB_*`, enforced by a Zod
`superRefine`). Absent entirely: the HTTP server still boots, every existing capability is
unaffected, only the Data Layer itself is unavailable (`analytics_not_configured`). Never
silently falls back to `CLUSTER_DB_*`/`RFM_SNAPSHOT_DB_*`/`PRESTASHOP_DB_*` — verified by a
dedicated config test asserting all three stay independently null/non-null.

## 10. Lifecycle / idempotency / source drift (task Sections 25-28)

`building -> insert rows (batched) -> verify row count -> verify checksum (recomputed from a
fresh, `FOR UPDATE`-locked read of what was actually persisted) -> validated -> supersede any
prior published snapshot for the same `feature_version` + `population_policy_version` ->
published`, single transaction, rollback on any failure. 9 induced-failure-stage unit tests
cover every step (mirrors clustering's own 9-stage coverage) — never a partial published
snapshot.

`snapshotKey = [featureVersion, populationPolicyVersion, referenceTime].join('__')`. Re-run
behavior:

| Condition | Result |
|---|---|
| No published snapshot for this key | `mode: 'persisted'`, new row set written |
| Published snapshot exists, `featureDatasetChecksum` matches | `mode: 'skipped_existing'` — same `snapshotId`, no duplicate rows |
| Published snapshot exists, `featureDatasetChecksum` differs | **`mode: 'source_drift_detected'`** — see below |

**Deliberate divergence from clustering** (task Section 28): clustering throws a hard
`ClusterSnapshotKeyConflictError` on any checksum mismatch under the same key, because
clustering has no notion of a source that can drift retroactively out from under an
already-published `referenceTime`. The Data Layer's entire reason for existing is to survive
exactly that (PrestaShop changing retroactively under a fixed `referenceTime`) — so the same
situation here is a named, auditable, non-throwing outcome. The prior published snapshot is
**never overwritten** either way; `source_drift_detected` carries `priorSnapshotId`,
`priorSourceDatasetChecksum`, and `priorFeatureDatasetChecksum` for audit. The run log records
this as a `skipped` run with `skipReason: 'source_drift_detected'`, not a failure.

## 11. Checksums (task Section 27/58 — verified live, not just unit-tested)

Two independent checksums, both `sha256Stable` (canonical, key-sorted JSON — the same utility
RFM/clustering already use), neither containing `generatedAt` or any other variable timestamp:

- **`sourceDatasetChecksum`** — over the raw, pre-derivation PrestaShop extraction (sorted by
  customer id, product rows sorted by product id within each customer). Changes if PrestaShop's
  underlying rows change retroactively for this `referenceTime`, independent of whether the
  derivation formulas changed.
- **`featureDatasetChecksum`** — over the final derived, canonical rows. What idempotency
  comparison uses.

Live-verified determinism: two independent CLI runs at `referenceTime =
2026-08-19T00:00:00.000Z`, several minutes apart —

```
populationSize:          44908  (both runs)
sourceDatasetChecksum:   44315395c3507c42dfb692267b167741d5d41028c74941411a8911311c2a6d0d (both runs)
featureDatasetChecksum:  0eace106832895abdbbfcf88339d5fc5d30cee29134bc4124119af3378962560 (both runs)
```

## 12. Parity validation (task Section 37/38/53 — live, against real PrestaShop data)

Ran a controlled comparison script (extraction only, not committed — ad hoc verification per
task Section 37's instruction to validate before productionizing) against real PrestaShop data
at `referenceTime = 2026-08-19T00:00:00.000Z`, `pc_consultor` read-only:

```
Data Layer population (>=1 order):            44,908
Clustering population (>=2 orders):            10,141
Commercial-aggregate population (>=2 orders):  10,141

Clustering Feature Set A parity  (500-customer sample): 0 mismatches, max abs diff 5.0e-7
Commercial metric parity          (500-customer sample): 0 mismatches (exact)
```

The 5e-7 max diff is the expected 6-decimal-place quantization from storing ratios as
fixed-point decimals (`behavior-decimal.ts` convention) rather than full-precision JS floats —
not a formula discrepancy; a dedicated unit test
(`tests/unit/customer-analytics-clustering-parity.test.ts`) calls clustering's actual
production formula (`buildFeatureVector`, exported from `mysql-cluster-population-reader.ts`
specifically for this purpose) against the same fixture and asserts equality to 5 decimal
places, so any real semantic drift between the two definitions would fail this test.

Sample rows confirm the intended behavior end-to-end on real data: customer `22092` — the same
one-time buyer T02/T03 documented as `404 cluster_not_available` for clustering — is present
in the Data Layer with `validOrders: 1`, `purchaseFrequencyDays: null`, every other field
populated. Customer `22066` — T02/T03's own worked example (`clusterId 3`) — has a Data Layer
row whose Feature-Set-A-equivalent values matched clustering's own extraction to the tolerance
above.

## 13. Clustering / RFM future integration (task Sections 39/40/46)

**Clustering (implemented, testable, not wired):** `src/domain/customer-analytics/
clustering-adapter.ts`'s `toClusteringFeatureVector(row)` maps a `CustomerFeatureRow` to
clustering's exact `RawClusterFeatureVector` (12/12 Feature Set A fields), returning `null`
for a customer below clustering's own `>=2`-orders requirement. Clustering itself is **not**
changed to consume this (task Section 6: no premature refactor) — it still calls
`mysql-cluster-population-reader.ts` directly. A future migration task would swap that call
for a read of the latest published `customer_feature_snapshot_row` set plus this adapter.

**RFM (documented mapping only, task Section 39 — no code change, RFM not migrated):**

| RFM concept | Data Layer field |
|---|---|
| Recency (R) | `daysSinceLastOrder` |
| Frequency (F) | `validOrders` |
| Monetary (M) | `totalSpentTaxIncl` |

Caveat, verified by reading `mysql-rfm-population-reader.ts` directly rather than assumed: RFM's
shipped Monetary metric subtracts confirmed seller-service line values from
`total_paid_tax_incl` (`monetary-policy-version gross-order-value-tax-incl-minus-seller-
service-v2`) and uses a windowed (`[windowStart, windowEnd)`) population, not a lifetime one.
`totalSpentTaxIncl` here is the unwindowed, non-seller-service-adjusted lifetime total — a
future RFM migration to this layer would need either a second Data Layer field or to keep that
adjustment as an RFM-side post-processing step over the shared `totalSpentTaxIncl`/`validOrders`
base.

## 14. Readers (task Section 34/35/36 — internal only, no HTTP)

`src/application/customer-analytics/{get-latest-customer-feature-snapshot,
get-customer-feature-snapshot-by-id, get-customer-feature-row}.ts` wrap
`CustomerFeatureSnapshotReader` (latest published / by id, including a superseded one for
historical reads / single row by `snapshotId + prestashopCustomerId`). No HTTP route was
added — task Section 35 explicitly forbids a bulk `GET /features/all`-shaped endpoint, and
Section 34 only requires the contracts to exist, not be exposed yet.
`scripts/analytics/print-snapshot-summary.ts` (`npm run analytics:snapshot:summary`) is the
lightweight CLI summary task Section 36 asked for (snapshotId, referenceTime, featureVersion,
populationSize, both checksums, status) — no dashboard.

## 15. PII (task Section 32 — PASS)

`src/domain/customer-analytics/pii-guard.ts` (own copy of the RFM/clustering pattern, same
precedent each capability already follows) runs over every manifest and row set before it's
trusted. Live sample rows (Section 12) contain only `prestashopCustomerId` + numeric/temporal
fields — no email/name/phone/address/RUT/birthday, confirmed both structurally (the type
system) and by the guard's own regex/field-name checks (12 dedicated unit tests).

## 16. Performance (task Section 54 — measured, live)

| Stage | Duration |
|---|---:|
| PrestaShop extraction + feature derivation + checksum (dry run, 44,908–44,936 customers) | ~10.6–10.9s |
| DB publication | not measured — no local MariaDB reachable from this dev machine (see Section 18) |

Batch inserts (task Section 55): up to 500 rows per `INSERT` statement (not one row per round
trip, a deliberate improvement over clustering's own row-by-row loop — worth carrying back to
clustering separately if useful, not done here to avoid touching a shipped capability).

**Storage estimate** (not measured — no live DB): ~150–250 bytes/row raw
(20 typed columns, mostly `DECIMAL(12,6)`/`INT`/`DATETIME(6)`) plus typical InnoDB per-row
overhead, so roughly 10–20 MB for the full 44,935-row population. To be confirmed once
migrations are applied on EC2.

## 17. Tests

18 new test files, 125 new tests, alongside the pre-existing 1042 (1167 total, all passing):

- `customer-analytics-feature-derivation.test.ts` — formulas, NULL semantics, NaN/Inf guard,
  reference-time semantics, denominator distinctions (order-level vs. product-level spend).
- `customer-analytics-snapshot.test.ts` — checksum determinism/independence/order-invariance,
  duplicate rejection, empty-population rejection, PII guard.
- `customer-analytics-pii-guard.test.ts` — 8 cases (field-name/email/RUT/phone/allowlist).
- `customer-analytics-clustering-adapter.test.ts` — 12/12 coverage, null-for-ineligible.
- `customer-analytics-clustering-parity.test.ts` — real production formula vs. Data Layer
  formula on a shared fixture, all 12 Feature Set A fields.
- `mysql-customer-feature-reader.test.ts` — SQL construction (no `>=2` `HAVING`, no
  seller-service), unsafe-prefix rejection, raw (non-derived) row shape, missing-product/
  duplicate-customer failure modes.
- `create-customer-feature-snapshot.test.ts` / `run-customer-feature-snapshot-operation.test.ts`
  — dry_run/persisted/skipped_existing/**source_drift_detected** modes, execution lock,
  run-log status mapping.
- `mysql-customer-feature-snapshot-repository.test.ts` — 9 induced-failure-stage rollback
  tests, batch-insert verification, checksum-corruption detection.
- `mysql-customer-feature-snapshot-run-repository.test.ts` — `GET_LOCK` concurrency, no
  secrets in persisted run rows.
- `mysql-customer-feature-snapshot-reader.test.ts` — latest/by-id (including superseded)/row,
  error mapping.
- `get-latest-customer-feature-snapshot.test.ts` / `get-customer-feature-snapshot-by-id.test.ts`
  / `get-customer-feature-row.test.ts` — application-layer wrapping, degraded mapping.
- `config.test.ts` (extended) — `ANALYTICS_DB_*` all-or-nothing, independence from
  `CLUSTER_DB_*`/`RFM_SNAPSHOT_DB_*`.

`typecheck`: PASS. `lint`: PASS. `build`: PASS (`tsc -p tsconfig.json`).

## 18. Known limitations / what's deferred

- **Live migration-apply/publish/idempotency verification not performed** — this development
  machine has no MariaDB service reachable (confirmed: no local MySQL/MariaDB Windows service,
  `127.0.0.1:3306` unreachable, `.env` has no `CLUSTER_DB_*`/`RFM_SNAPSHOT_DB_*`/
  `ANALYTICS_DB_*` credentials). Per explicit instruction, this is deferred to the EC2
  deployment step, where RFM/clustering's own local MariaDB is reachable. Everything
  independent of that — schema design, migrations, domain/application/infrastructure code,
  the full test suite (mocked-DB, including 9 induced-failure-stage transaction tests), and a
  live read-only dry-run against the real PrestaShop RDS — is complete and verified.
- RFM/clustering are **not** migrated to consume this layer (task Section 6/39/40 — explicitly
  deferred; only the clustering adapter + RFM mapping documentation exist).
- No `customer_intelligence_current` read model (deferred to CP-R3-T02).
- No dedicated `customer_analytics` schema — same infra constraint clustering already
  documented; `ANALYTICS_DB_*` points at the shared schema today, config-only to change later.
- No HTTP endpoint (deliberately out of scope, task Section 35/42).
- Storage footprint is an estimate, not measured (Section 16).

## 19. Definition of Done — checklist (task Section 61)

- [x] Source extraction is read-only (`SHOW GRANTS` re-confirmed at every CLI run; live-verified `GRANT SELECT ON *.*` only)
- [x] Feature schema defined (19 columns, explicit types, no giant JSON blob)
- [x] Population policy explicit and audited live (Population B, 44,935 customers)
- [x] `referenceTime` deterministic (never `NOW()` in readers; live-verified identical checksums across two runs)
- [x] Feature snapshot can be generated (live dry-run: 44,908–44,936 customers, ~10.6–10.9s)
- [ ] Rows persisted locally — code + 9-stage transactional tests complete; live persistence deferred to EC2 (Section 18)
- [x] Features are SQL-queryable columns (no JSON feature blob)
- [x] No PII (guard + live sample verification)
- [x] Checksums deterministic (live-verified byte-identical across 2 independent runs)
- [x] Lifecycle atomic (transactional, 9 induced-failure-stage tests)
- [ ] Idempotency live-verified — unit-tested only pending EC2 DB access
- [x] Source drift behavior defined and tested (`source_drift_detected` mode, never overwrites)
- [x] Clustering Feature Set A parity: 12/12 fields, 0 mismatches on a 500-customer live sample
- [x] Commercial metric parity: 0 mismatches on a 500-customer live sample
- [ ] Latest/historical readers — implemented + unit-tested; live-verified against a real published snapshot deferred to EC2
- [x] Tests pass (1167/1167)
- [x] Build passes
- [x] No RDS writes (code inspection: no INSERT/UPDATE/DELETE/DDL keyword anywhere in the PrestaShop reader; live `SHOW GRANTS` confirms SELECT-only)
