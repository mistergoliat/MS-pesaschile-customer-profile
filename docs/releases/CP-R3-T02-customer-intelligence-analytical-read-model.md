# CP-R3-T02 — Customer Intelligence Analytical Read Model

Status: **READY_WITH_CONSTRAINTS** (local implementation + full local test suite complete;
live DB verification deferred alongside CP-R3-T01's own pending EC2 persistence smoke — same
root cause, this dev machine has no reachable MariaDB)
Git branch: `feat/cp-r3-t01-customer-analytics-data-layer` (T02 was **not** given its own
branch — see Section 0)
Type: new, read-only composition layer over three already-shipped capabilities. No RFM,
clustering, or Customer Analytics Data Layer behavior changed.

---

## 0. Branching (read before anything else)

Preflight at the start of T02:

```
git branch --show-current  ->  feat/cp-r3-t01-customer-analytics-data-layer
git rev-parse HEAD         ->  662af299621217c4c293d939a2d449497ffcfbe3
git status --short         ->  T01's entire implementation (domain/application/infrastructure/
                                migrations 008-009/scripts/tests/docs) is still untracked/
                                modified, never committed.
```

Same situation CP-R2-T03 documented for CP-R2-T02: T01 is not committed or merged. Per that
established precedent (`docs/releases/CP-R2-T03-clustering-analytics-observability.md`
Section 0), T02 did **not** create `feat/cp-r3-t02-customer-intelligence-read-model` on top of
ambiguous state — all T02 work was made directly on the existing
`feat/cp-r3-t01-customer-analytics-data-layer` branch, in the same working tree as T01's own
uncommitted changes. This is a state report, not a design choice.

## 1. Objective

A read-only composition layer — `CustomerIntelligenceRow` /
`CustomerIntelligenceSnapshotContext` — that joins, for each analytically-available customer:
Customer Analytics Data Layer commercial features + RFM (persisted, never recomputed) +
Behavioral Clustering (persisted, never recomputed) + full snapshot provenance. This is the
direct foundation for CP-R3-T03's Analytical Query Runtime and, eventually, the Marketing
Copilot — neither of which is built here.

**Not built in T02** (explicit non-goals): LLM, generic arbitrary SQL executor, Segment
Engine, Brevo, cart abandonment, campaign execution, Sales Agent integration, scheduler,
Marketing UI, bulk HTTP endpoint.

## 2. Architecture decision: logical composition, not materialization (task Section 4/54/55)

**No new persistence table was created.** The read model is a query composition over three
already-persisted stores, resolved through explicit snapshot ids and one JOIN-backed reader.
At ~44,935 feature rows (T01's live-audited population), a well-indexed local-MariaDB join is
expected to be comfortably fast — this was a design decision based on the existing schema's
indexes (every join key is `(snapshot_id, prestashop_customer_id)`, already a `UNIQUE`/`KEY`
on all three `*_snapshot_row` tables per migrations 002/005/008), not a live `EXPLAIN`
measurement (no local MariaDB reachable from this dev machine — same constraint T01
documented). Materializing a `customer_intelligence_snapshot` table remains available as a
follow-up if a live measurement on EC2 shows it's actually needed (task Section 55) — nothing
here forecloses that path.

## 3. Source snapshot anchor policy (task Section 7/8 — evaluated, decided)

Two options were weighed:

- **A (rejected as the default): unconditional "latest of everything"** — latest feature +
  latest RFM + latest cluster snapshot, independently. Simple, but can silently present RFM or
  clustering *"from the future"* relative to the feature snapshot being described — the same
  risk CP-R2-T03 accepted deliberately for its RFM×cluster cross-tab (option B there, "latest
  published RFM snapshot independientemente"), but that is a narrower, always-honestly-labeled
  comparison tool, not this task's general-purpose read model.
- **B (chosen): feature-snapshot-anchored.** `F` = latest published feature snapshot. `R` =
  latest published RFM snapshot with `referenceTime <= F.referenceTime`. `C` = latest
  published cluster snapshot with `referenceTime <= F.referenceTime`. Never selects a
  "future" RFM/cluster output relative to the anchor. If no compatible snapshot exists, the
  field is `null` — never a fallback to a future one.

Implemented as a pure, unit-tested function,
`selectLatestSnapshotAtOrBefore()` (`src/domain/customer-intelligence/snapshot-selection.ts`),
used identically for both RFM and cluster resolution so the policy is stated exactly once.

## 4. Population semantics (task Section 9)

Feature population (T01's Population B, >=1 valid order) is the **base/outer** population —
every query is `customer_feature_snapshot_row LEFT JOIN customer_rfm_snapshot_row LEFT JOIN
customer_cluster_snapshot_row`, never an `INNER JOIN`. A one-time buyer (in Population B, not
in clustering's narrower Population B′) stays visible with `commercial` populated and
`cluster: null` — exactly the real, live-verified case from T01 (customer `22092`).

## 5. Contracts (task Section 10-14, 28-29)

`CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION = 'customer-intelligence-read-model-v1'`
(`src/domain/customer-intelligence/contracts.ts`).

`CustomerIntelligenceRow.commercial` is `Omit<CustomerFeatureRow, 'prestashopCustomerId'>` —
the exact same 18 fields T01 already owns, imported, never redeclared (task Section 27).

`rfm: CustomerIntelligenceRfm | null` — `{ snapshot: {snapshotId, referenceTime,
calculationVersion}, rScore, fScore, mScore, rfmCode, segmentCode }`, read verbatim from
`customer_rfm_snapshot_row`'s existing columns (`recency_score`/`frequency_score`/
`monetary_score`/`rfm_code`/`segment_code`) — no new field invented.

`cluster: CustomerIntelligenceCluster | null` — `{ snapshot: {snapshotId, referenceTime,
modelId, modelVersion}, clusterId, distanceToCentroid, interpretationVersion, label,
description }`, read verbatim from `customer_cluster_snapshot_row` +
`customer_cluster_interpretation`.

Every row and every context always carries full snapshot provenance (task Section 29) — never
a bare model output without its originating snapshot id/referenceTime attached.

## 6. NULL semantics (task Section 13) — never an error

`rfm`/`cluster` are `null` for two independent reasons, both valid: (a) no compatible snapshot
was resolved for the whole context at all, or (b) a compatible snapshot was resolved but this
specific customer isn't a member of it (absent from `customer_rfm_snapshot_row`/
`customer_cluster_snapshot_row` for that `snapshot_id`). Both surface as `null`, never a thrown
error or a missing row.

## 7. Coverage metadata (task Section 14/25/46)

`CustomerIntelligencePopulationCoverage = { featurePopulation, rfmMatched, clusterMatched,
bothMatched, neitherMatched, rfmCoveragePct, clusterCoveragePct }`
(`src/domain/customer-intelligence/coverage.ts`, pure, inclusion-exclusion arithmetic,
guarded against inconsistent inputs). Verified against the task's own worked fixture (10
feature / 7 RFM / 4 cluster / 3 both → `neitherMatched: 2`, `rfmCoveragePct: 70`,
`clusterCoveragePct: 40`).

## 8. Reuse, not redefinition (task Section 27 — the single most important constraint)

| What | Reused from | Never redefined |
|---|---|---|
| Feature snapshot resolution (latest/by-id) | `CustomerFeatureSnapshotReader` (CP-R3-T01, `src/application/customer-analytics/ports.js`) | RFM/feature formulas |
| Cluster interpretation scoping ("latest `interpretation_version` wins per `clusterId`", task Section 48) | `createMysqlClusterAnalyticsReader(pool).getInterpretations(modelId)` (CP-R2-T03, `src/infrastructure/clustering/mysql-cluster-analytics-reader.js`) — called verbatim, not reimplemented | Interpretation label/description assignment |
| `ANALYTICS_DB_*` error taxonomy | `mapAnalyticsReadError`, `AnalyticsUnavailableError`/`AnalyticsTimeoutError`/`AnalyticsSchemaIncompatibleError` (CP-R3-T01) | A fourth, `INTELLIGENCE_DB_*`-flavored error taxonomy |
| RFM/clustering scoring/assignment | Read directly from `customer_rfm_snapshot_row`/`customer_cluster_snapshot_row` (task Section 50/51) | R/F/M scoring, nearest-centroid assignment — **never recomputed** |

**What genuinely had no existing home and was built new** (task Section 6/44, documented so
this isn't mistaken for undisciplined duplication): "every published RFM/cluster snapshot
header" and "latest snapshot at-or-before an external reference time" — neither RFM's
`CurrentRfmSnapshotReader` (unconditional latest only) nor clustering's
`ClusterAnalyticsReader` (unconditional latest, or by explicit id) expose a temporal filter,
because neither capability has ever needed one internally. This is a genuinely new,
cross-capability composition concern (`src/infrastructure/customer-intelligence/
mysql-snapshot-header-reader.ts`), not a second definition of anything that already existed.

## 9. Query architecture (task Section 16-18, 33, 40-42)

**Chosen: option B, direct SQL joins behind a port interface**
(`CustomerIntelligenceReader`, `src/application/customer-intelligence/ports.ts`), resolved
with explicit snapshot ids first (`resolveCustomerIntelligenceContext*` in
`resolve-customer-intelligence-context.ts`), then a single JOIN query per row/batch
(`src/infrastructure/customer-intelligence/mysql-customer-intelligence-reader.ts`). No SQL
`VIEW` — a "current" view would have to embed the same latest-compatible-snapshot resolution
logic that already lives in, and is unit-tested in, `snapshot-selection.ts`; keeping that
logic in application code (not SQL) avoids a second, SQL-dialect-specific restatement of the
same policy (task Section 17).

**Physical co-location tradeoff (task Section 40-42), stated explicitly**: today's single JOIN
query is only correct because `ANALYTICS_DB_*`, `RFM_SNAPSHOT_DB_*`, and `CLUSTER_DB_*` all
point at the same physical MariaDB schema (T01/T02/T03's own documented infrastructure
constraint — no dedicated `customer_analytics` schema has been provisioned). The
`CustomerIntelligenceReader` **interface** itself carries no assumption about this — it is
three async methods returning domain objects. A future deployment with genuinely separate
databases would require a different *implementation* of the same interface (e.g., one query
against the feature DB plus a batched cross-DB lookup against RFM/cluster), not a
domain/application-layer change. This is the documented tradeoff task Section 40 asked for.

## 10. Config (task Section 42-43)

**No new credential family was added.** `INTELLIGENCE_DB_*` was evaluated and rejected: since
`ANALYTICS_DB_*` (CP-R3-T01) already points at the schema holding all three
`customer_feature_*`/`customer_rfm_*`/`customer_cluster_*` table families under one grant, the
Customer Intelligence reader reuses the existing `ANALYTICS_DB_*` pool exactly as-is — same
pool-construction code pattern as every T01 CLI. If `ANALYTICS_DB_*` is absent, every Customer
Intelligence capability is unavailable (`analytics_not_configured`); it never falls back to
`CLUSTER_DB_*`/`RFM_SNAPSHOT_DB_*` even though those currently point at the same place.
Hardening this to a dedicated **read-only** analytics credential (task Section 43,
future-Copilot-facing) is documented as a deferred recommendation, not provisioned here.

## 11. Readers (task Section 20-24, 30)

- `resolveCurrentCustomerIntelligenceContext()` / `resolveCustomerIntelligenceContextForFeatureSnapshot(id)`
  — the two context resolvers (current vs. historical, task Section 30/49).
- `getCustomerIntelligenceRow({featureSnapshotId, prestashopCustomerId})` — single-row lookup.
- `listCustomerIntelligenceRows({featureSnapshotId, limit, afterCustomerId})` — one page,
  keyset-paginated (never `OFFSET`, task Section 21/36).
- `iterateCustomerIntelligenceRows(deps, resolvedIds, batchSize)` — an `async function*`
  wrapping repeated `listRows` calls, so a future full-population consumer (CP-R3-T03) never
  needs to hold more than one batch (default 1,000, max 5,000 rows) in memory at once.

No HTTP route was added (task Section 22/23 — bulk HTTP explicitly forbidden; single-customer
HTTP was evaluated as optional and skipped since it has no concrete consumer yet, same
reasoning CP-R2-T03 used to skip its own optional by-id cross-tab route). CLI-only:
`npm run intelligence:summary` and `npm run intelligence:sample -- --limit=10` (task Section
24/52/53).

## 12. Cluster interpretation scoping (task Section 48 — tested)

Interpretation lookup is always scoped to the **resolved cluster snapshot's own `modelId`**
(never a global "latest interpretation across all models" query) — verified by a dedicated
test asserting `getInterpretations` is called with exactly the context's `clusterModelId`, and
that a `clusterId` with no matching row in the fetched interpretation map degrades to
`label: null, description: null, interpretationVersion: null` per-row, never a thrown error or
a cross-model mismatch.

## 13. PII (task Section 37 — PASS)

`src/domain/customer-intelligence/pii-guard.ts` (own copy of the established RFM/clustering/
customer-analytics pattern) is run over sample output in `scripts/intelligence/
print-sample.ts` before printing. Every contract field is `prestashopCustomerId` +
numeric/temporal/version data — no email/name/phone/address/RUT anywhere in the type graph.

## 14. No PrestaShop dependency (task Section 38 — tested, not just asserted)

A dedicated structural test
(`tests/unit/customer-intelligence-no-prestashop-dependency.test.ts`) reads every `.ts` file
under `src/domain/customer-intelligence/`, `src/application/customer-intelligence/`,
`src/infrastructure/customer-intelligence/`, and `scripts/intelligence/` and asserts none of
them reference `prestashop-pool`, `PRESTASHOP_DB_*`, `createPrestashopPool`, or import from any
`.../prestashop/...` module. This makes "Customer Intelligence never touches PrestaShop" an
enforced invariant, not just a design intention — any future accidental import fails this test
immediately.

## 15. Tests (task Section 56)

12 new test files, 63 new tests, alongside the pre-existing 1167 (1230 total, all passing):

- `customer-intelligence-snapshot-selection.test.ts` — task Section 44's exact worked fixture
  (anchor 100, RFM 90/110 → 90; cluster 80/95/120 → 95), future-snapshot exclusion,
  inclusive-at-anchor, tie-break, invalid-date guards.
- `customer-intelligence-coverage.test.ts` — task Section 46's exact worked fixture (10/7/4/3
  → `neitherMatched: 2`), zero-population, full-coverage, inconsistent-count rejection.
- `customer-intelligence-pii-guard.test.ts` — 6 cases.
- `resolve-customer-intelligence-context.test.ts` — no-feature-snapshot, null-RFM/null-cluster
  (never an error), the future-snapshot guard end-to-end, coverage propagation, degraded
  mapping, historical anchoring (task Section 49: an RFM snapshot published *after* the
  historical anchor is correctly excluded).
- `get-customer-intelligence-row.test.ts` — task Section 47's exact five cases (commercial+RFM
  +cluster / +RFM only / +cluster only / commercial only / not-in-feature-snapshot), context
  propagation, degraded mapping.
- `list-customer-intelligence-rows.test.ts` + the `iterateCustomerIntelligenceRows` async
  generator — limit validation, `hasMore` true/false, keyset cursor propagation, empty-page
  termination.
- `mysql-snapshot-header-reader.test.ts` — SQL shape (published-only, header-only, never the
  `*_row` tables), error mapping.
- `mysql-customer-intelligence-reader.test.ts` — full-match row composition, sentinel-bypass
  when a snapshot side is unresolved, per-customer null on the LEFT JOIN, interpretation
  scoping/merging (task Section 48), keyset pagination's N+1-row `hasMore` trick, coverage
  count short-circuiting.
- `customer-intelligence-no-prestashop-dependency.test.ts` — task Section 38.

`typecheck`: PASS. `lint`: PASS. `build`: PASS.

## 16. Live validation status (task Section 57/58)

Same root cause T01 already documented: no MariaDB reachable from this development machine.
Both new CLIs (`npm run intelligence:summary`, `npm run intelligence:sample`) were smoke-run
locally and confirmed to fail closed correctly with `ANALYTICS_DB_* is not configured` — the
exact same fail-closed message shape T01's own CLI produces, confirming the config wiring is
correct end-to-end even without a live connection. `EXPLAIN`/live join-latency measurement
(task Section 35) could not be performed; deferred alongside T01's own pending EC2 persistence
smoke (task Section 58 — explicitly not a T01 status regression, unchanged: **PENDING**).

## 17. Known limitations / deferred

- Live join performance (`EXPLAIN`, single-customer/1k-batch/full-scan/coverage-summary
  latency) not measured — no local MariaDB. Everything DB-shape-dependent was instead verified
  via mocked-pool infrastructure tests asserting the actual SQL text (joins, indexes used,
  sentinel behavior, pagination clause).
- No dedicated read-only analytics credential provisioned (task Section 43) — documented as a
  future hardening step, same `ANALYTICS_DB_*` writer-capable credential is used for now
  (Customer Intelligence itself never writes, but the credential it borrows can).
- No single-customer HTTP endpoint (evaluated, skipped — no concrete consumer yet).
- No materialized `customer_intelligence_snapshot` table (deliberate — task Section 4/54/55;
  revisit only with live evidence).
- CP-R3-T03 Analytical Query Runtime, Copilot LLM layer, Segment Engine, Brevo, cart features,
  Marketing UI, Sales Agent integration — all out of scope, none built.

## 18. Definition of Done — checklist (task Section 61)

- [x] Feature snapshot is anchor
- [x] Compatible RFM snapshot resolution works (unit-tested, incl. the exact task-fixture)
- [x] Compatible cluster snapshot resolution works (unit-tested, incl. the exact task-fixture)
- [x] Future snapshots are never selected (dedicated guard test)
- [x] Feature population preserved with LEFT JOIN semantics (never INNER)
- [x] RFM can be null (never an error)
- [x] Cluster can be null (never an error)
- [x] Commercial features exposed (reused verbatim from CP-R3-T01)
- [x] RFM outputs exposed (read-only, never recomputed)
- [x] Cluster outputs exposed (read-only, never recomputed)
- [x] Provenance included on every row and every context
- [x] Coverage summary works (exact task fixture verified)
- [x] Historical context supported (`resolveCustomerIntelligenceContextForFeatureSnapshot`)
- [x] Bulk internal reader supports batching (keyset pagination + async generator)
- [x] No bulk HTTP
- [x] No PrestaShop dependency (structurally tested, not just asserted)
- [x] PII guard passes
- [x] Tests pass (1230/1230)
- [x] typecheck/lint/build pass
