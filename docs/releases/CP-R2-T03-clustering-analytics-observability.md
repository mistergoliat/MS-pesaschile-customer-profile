# CP-R2-T03 — Behavioral Clustering Analytics & Observability

Status: **READY_WITH_CONSTRAINTS** (local implementation + local smoke complete; T02 itself is
still uncommitted, so this branch state is likewise uncommitted — see Section 0)
Git branch: `feat/cp-r2-t02-behavioral-clustering-productionization` (T03 was **not** given its
own branch — see Section 0 for why)
Type: read-only analytical serving over the clustering CP-R2-T02 already productivized. No
retraining, no algorithm/k/feature/preprocessing/population-policy change, no reinterpretation of
existing labels.

---

## 0. Branching (task Section 8 — read before anything else)

The task's own instructions anticipated this: *"Si T02 todavía está sin commit: NO crear una rama
incorrectamente encima de estado ambiguo. Primero registrar exactamente el estado Git."*

Preflight result at the start of T03:

```
git branch --show-current  ->  feat/cp-r2-t02-behavioral-clustering-productionization
git rev-parse HEAD         ->  addb2483c8ca71efe8b5a0980851734908b819af
git log --oneline -5       ->  addb248 feat(customer-clustering): CP-R2-T01 ... (HEAD)
                                2b86fbd Merge pull request #15 ...
                                ...
git status --short         ->  T02's entire implementation (domain/application/infrastructure/
                                migrations 005-006/scripts/tests) is still untracked/modified,
                                never committed.
```

T02 is **not** committed or merged. Per the explicit contingency instruction above, T03 did
**not** create `feat/cp-r2-t03-clustering-analytics-observability` on top of that ambiguous
state — all T03 work was made directly on the existing
`feat/cp-r2-t02-behavioral-clustering-productionization` branch, in the same working tree as
T02's own uncommitted changes. Nothing has been committed for either task. This is a state
report, not a design choice — resolve T02's commit status first, then decide whether T03 becomes
its own branch/PR or folds into T02's.

---

## 1. Scope boundary (unchanged from clustering itself)

**Not reopened, not touched:** algorithm choice, k, Feature Set A, preprocessing, population
policy (`cp-r2-clustering-population-b-prime-v1`), operational-account exclusion policy, existing
interpretation labels. `behavioral-kmeans-k4-v1` is read, never retrained. No new model version
was registered; no new snapshot was published.

**What T03 adds:** a local-only, read-only analytical layer over the already-published snapshot —
population distribution, per-cluster feature/commercial/distance profiles, model provenance, and
an RFM x cluster cross-tab — plus the batch job that computes those profiles once and persists
them, so HTTP reads never touch PrestaShop or recompute anything.

## 2. The core design decision (task Section 11/15)

`customer_cluster_snapshot_row` only stores `(customerId, clusterId, distanceToCentroid)` — not
enough to answer "what characterizes cluster 2?" without re-querying PrestaShop per request. The
task listed four options (A-D); T03 implements **option D**: recompute once, at
profile-generation/backfill time, and persist the aggregate. Concretely:

- **Heavy work** (re-extracting Feature-Set-A vectors + commercial aggregates from PrestaShop,
  computing mean/median/p25/p75 per feature per cluster) happens in
  `scripts/clustering/generate-cluster-profile.ts` — a CLI, run once per snapshot, never from an
  HTTP request.
- **Light work** (assembling the summary/cross-tab response from already-persisted rows) happens
  in the three new HTTP endpoints — local MariaDB reads only, no PrestaShop connection at all.

### Known limitation discovered during implementation (not anticipated by the task text)

Profile generation re-derives Feature-Set-A vectors by re-running the same
`valid=1 AND total_paid_tax_incl>0 AND date_add<referenceTime` extraction the original snapshot
used, but against PrestaShop's **current** row state, not a point-in-time copy. If an order's
`valid`/`total_paid_tax_incl` changed *after* the snapshot was published (e.g. a retroactive
refund), re-extraction can produce a population that no longer exactly matches
`customer_cluster_snapshot_row`. `generateClusterProfiles()`
(`src/application/customer-clustering/generate-cluster-profiles.ts`) detects this explicitly — if
any customer present in the published snapshot is missing from the re-extraction, it throws
rather than silently generating a partial/inconsistent profile (task Section 43: "Fail if
mismatch"). Not hit in the live run (population reproduced exactly, see Section 8), but it is a
real, documented risk of the "recompute from current PrestaShop state" approach the task itself
recommended, and should be weighed if this pattern is reused for a general Analytics Data Layer.

## 3. Schema (task Section 12/39/40)

One new table, `migrations/007_create_customer_cluster_snapshot_profile_table.sql` (+ rollback),
in the same `rfm_snapshot` physical schema T02's tables already use (same infra constraint T02
documented — the only provisioned credential has DDL/DML on `rfm_snapshot` only). Namespaced
`customer_cluster_snapshot_profile`, FK to `customer_cluster_snapshot(id) ON DELETE CASCADE`,
`UNIQUE (snapshot_id, cluster_id)`.

**JSON, not 64 explicit columns** (task Section 12 explicitly required evaluating this, not
assuming it): `feature_profile_json`, `commercial_profile_json`, `distance_profile_json`. This
data is always written and read as one whole per-cluster document — 12 features x 4 stats + 4
commercial metrics x 4 stats is 64 fields with no independent SQL filter/sort need, the same
tradeoff `customer_cluster_model` already made for `artifact_json`/`metrics_json`. Indexing is on
`(snapshot_id, cluster_id)`, the only axis anything actually queries by.

## 4. Profile generation lifecycle (task Section 16/41/42)

`buildClusterSnapshotProfiles()` (`src/domain/customer-clustering/profile.ts`) is a pure function
enforcing every invariant the task listed *before* a profile is considered valid:

- `SUM(profile.customerCount) === snapshot.populationSize` — throws otherwise.
- Every stat (mean/median/p25/p75) computed from real, finite values — throws on NaN/Inf.
- `p25 <= median <= p75` asserted per stat block.
- `distanceToCentroid >= 0` asserted per row.
- Deterministic ordering (sorted by `prestashopCustomerId` within each cluster, mirroring
  `buildClusterSnapshot`'s own convention) and a checksum
  (`sha256Stable({snapshotId, clusterId, customerCount, featureProfile, commercialProfile,
  distanceProfile})`, no `generatedAt`) so re-generating an unchanged snapshot always reproduces
  the same checksum — verified live (Section 8).

`ClusterSnapshotProfileRepository.upsertProfiles()`
(`src/infrastructure/clustering/mysql-cluster-snapshot-profile-repository.ts`) is the idempotency
gate: it reads what's currently stored, compares `profile_checksum` per cluster, and only issues
an `INSERT ... ON DUPLICATE KEY UPDATE` when the checksum actually differs — an unchanged cluster
is a pure skip, never rewritten.

## 5. Commercial post-hoc metrics (task Section 14)

`totalSpentTaxIncl`, `averageOrderValueTaxIncl`, `validOrders`, `daysSinceLastOrder` — never a
training input, computed only at profile-generation time (never on-demand from HTTP, task Section
15). Implemented as `createMysqlClusterCommercialAggregateReader()` in the *same* file as the
production population reader (`src/infrastructure/prestashop/mysql-cluster-population-reader.ts`)
— it reuses the exact same tested `readOrderAggregates()` SQL (same `eligible_orders` CTE, same
operational-account exclusion, same >=2-valid-orders population) the feature reader already
relies on, rather than writing a second query that could silently drift from the model's own
population definition.

## 6. Contracts (task Section 17/18/26)

New domain types in `src/domain/customer-clustering/analytics-contracts.ts`
(`CLUSTER_ANALYTICS_CONTRACT_VERSION = 'customer-cluster-analytics-v1'`):

- `ClusterSnapshotSummary` — `{ snapshot, model, clusters[] }`. Each cluster entry carries
  `population.{count,percentage}`, `interpretation` (nullable), and `featureProfile` /
  `commercialProfile` / `distanceProfile` (each nullable — see Section 7). **Never a customer
  list** (task Section 18).
- `ClusterRfmCrossTab` — `{ clusterSnapshot, rfmSnapshot, coverage, rows[] }`. Both snapshot refs
  (id + referenceTime) are always explicit, never hidden (task Section 23/26), and `coverage`
  always reports `clusterPopulation` / `comparablePopulation` / `unmatchedPopulation` /
  `coveragePct` rather than presenting the cross-tab as if it covered 100%.

## 7. `cluster_profile_not_available` is per-cluster, not whole-response (design decision)

The task's error taxonomy (Section 46) lists `cluster_profile_not_available` as a possible state.
T03 does **not** implement it as a top-level failure: population `count`/`percentage` and model
provenance come straight from `customer_cluster_snapshot_row` / `customer_cluster_model` and never
depend on the profile table, so a summary is still genuinely useful even before a profile has been
backfilled for that snapshot. Instead, `featureProfile`/`commercialProfile`/`distanceProfile` are
individually `null` for any cluster whose profile hasn't been generated yet — documented directly
on the `ClusterSummaryEntry` type, never fabricated.

## 8. Live local smoke (task Section 56 — real data, not illustrative)

Ran against snapshot id=1 (T02's live-published snapshot, population 10,147,
`behavioral-kmeans-k4-v1`):

```
$ npx tsx scripts/clustering/generate-cluster-profile.ts --snapshot-id=1
[generate-cluster-profile] READ_ONLY_CONFIRMED
{ "mode": "generated", "snapshotId": "1", "upserted": 4, "skipped": 0,
  "clusterCount": 4, "populationConsistency": 10147 }

$ npx tsx scripts/clustering/generate-cluster-profile.ts --snapshot-id=1   # re-run
{ "mode": "skipped_unchanged", "snapshotId": "1", "upserted": 0, "skipped": 4,
  "clusterCount": 4, "populationConsistency": 10147 }
```

Confirmed directly against the DB: exactly 4 rows in `customer_cluster_snapshot_profile` (no
duplication on re-run), all four `profile_checksum` values stable across both runs, all four
64-hex-char SHA-256 digests. `SUM(customer_count) = 10147 = snapshot.populationSize`.

HTTP (`npx tsx src/index.ts`, local server on :3010, real requests):

| Endpoint | Result | Latency (server-side `durationMs`) |
|---|---|---:|
| `GET /v1/clustering/snapshots/latest/summary` | 200, 4 clusters, full profiles | 93ms (cold) |
| `GET /v1/clustering/snapshots/1/summary` | 200, identical content by explicit id | 17ms |
| `GET /v1/clustering/snapshots/999/summary` | 404 `cluster_snapshot_not_found` | 8ms |
| `GET /v1/clustering/snapshots/abc/summary` | 400 `invalid_snapshot_id` | — |
| `GET /v1/clustering/snapshots/latest/summary?foo=bar` | 400 `unsupported_query_params` | — |
| `GET /v1/clustering/snapshots/latest/rfm-cross-tab` | 200, partial coverage reported honestly | 184ms |

All local-MariaDB-only — zero PrestaShop RDS connections during any HTTP request (only the
`generate-cluster-profile.ts` CLI touches PrestaShop, and only read-only, re-confirmed via
`SHOW GRANTS` at the start of the run, same guardrail T02 established).

### Live cluster distribution + profile highlights

| clusterId | Interpretation | Count | % | totalSpentTaxIncl (median) | medianDistance |
|---|---|---:|---:|---:|---:|
| 0 | HIGH_VALUE_DIVERSIFIED_REPEAT_BUYERS | 2,566 | 25.29% | 777,636 | 1.421 |
| 1 | RECENTLY_ACTIVE_NEWER_REPEAT_BUYERS | 2,076 | 20.46% | (lower spend, newer tenure) | — |
| 2 | LONG_TENURE_DORMANT_SPREAD_OUT_REPEAT_BUYERS | 3,980 | 39.23% | — | — |
| 3 | NEW_BURST_THEN_LAPSED_BUYERS | 1,525 | 15.03% | — | — |

(Matches T02's documented live distribution exactly — T03 never recomputed clustering, only
observed it.)

### Live RFM x cluster cross-tab

RFM snapshot used: id `3`, `referenceTime` `2026-08-17T00:00:00.000Z` (latest published RFM
snapshot — see Section 9 for selection policy). Cluster snapshot `referenceTime`
`2026-08-19T21:23:24.000Z`.

```
clusterPopulation:     10,147
comparablePopulation:   4,311
unmatchedPopulation:    5,836
coveragePct:            42.49%
```

Consistent with T01's earlier finding (see project memory) that RFM cross-tab coverage is
genuinely partial against the clustering population — T03 surfaces that honestly rather than
hiding it, and the cluster summary itself is entirely unaffected by this gap (task Section 45).

## 9. RFM snapshot selection policy (task Section 24/45 — decided, documented)

**Chosen: option B — "latest published RFM snapshot independientemente"** of the cluster
snapshot's own `referenceTime`. Simpler than option A (RFM snapshot with
`referenceTime <= clusterReferenceTime`), and never hides a mismatch: both `clusterSnapshot.
referenceTime` and `rfmSnapshot.referenceTime` are always both present in the response (Section
23/26), so a caller always sees exactly how far apart the two are — here, ~2 days
(2026-08-17 vs. 2026-08-19). If no RFM snapshot is published at all, the cross-tab returns
`no_compatible_rfm_snapshot` (404) while the cluster summary endpoint stays completely unaffected
(task Section 45) — verified by dedicated unit + integration tests (see Section 12).

## 10. HTTP endpoints (task Section 19/20/21/22/27)

```
GET /v1/clustering/snapshots/latest/summary
GET /v1/clustering/snapshots/:snapshotId/summary       (400 invalid_snapshot_id for non-numeric/"0";
                                                          404 cluster_snapshot_not_found otherwise unknown;
                                                          historical: a superseded-but-once-published
                                                          snapshot is still viewable by id)
GET /v1/clustering/snapshots/latest/rfm-cross-tab
```

`GET /v1/clustering/snapshots/:snapshotId/rfm-cross-tab` (by-id cross-tab) was **not** added —
`snapshotId: null` vs. an explicit id is already handled by the same application function
(`createGetRfmClusterCrossTab`), but only the `latest` HTTP route was wired, per the task's
explicit preference for endpoint minimalism (Section 22/27) and because the by-id cross-tab has no
concrete consumer yet. Wiring the second route is a route-only, zero-logic addition if needed
later.

**Single-cluster-profile endpoint (`GET /v1/clustering/snapshots/:snapshotId/clusters/:clusterId`,
task Section 21): NOT implemented.** A snapshot's full summary is 4 clusters — small — and
already contains every cluster's profile; a dedicated single-cluster route would be pure endpoint
explosion for no established use case, matching the task's own stated preference (Section 22:
"mantener API simple").

Building/failed/validated snapshots are never exposed to `:snapshotId/summary` — only
`published`/`superseded` (task Section 20).

## 11. Error taxonomy actually implemented (task Section 46)

| Task-listed reason | Where it appears |
|---|---|
| `cluster_analytics_not_configured` | `degraded`, when `CLUSTER_DB_*` is absent — mirrors `cluster_not_configured` from T02 |
| `no_published_cluster_snapshot` | `snapshotId: null` request, nothing ever published |
| `cluster_snapshot_not_found` | explicit `:snapshotId` that doesn't exist or was never published |
| `cluster_profile_not_available` | represented as per-cluster `null` fields, not a top-level status — see Section 7 |
| `cluster_analytics_unavailable` | `ClusterUnavailableError`/`ClusterTimeoutError`/`ClusterSchemaIncompatibleError` from the cluster DB |
| `no_compatible_rfm_snapshot` | cross-tab only, when no RFM snapshot is published |
| (new) `rfm_not_configured` | cross-tab only, when clustering IS configured but `RFM_SNAPSHOT_DB_*` isn't |
| (new) `rfm_unavailable` | cross-tab only, RFM DB reachable-but-erroring |

## 12. Tests

59 new tests across 8 new/extended files, all passing alongside the pre-existing 983 (1042 total):

- `tests/unit/customer-clustering-profile.test.ts` — stat correctness (mean/median/p25/p75),
  distance stats, checksum determinism/order-independence, population-consistency failure,
  missing-feature/missing-commercial-aggregate failure, negative-distance failure, NaN/Inf guard.
- `tests/unit/mysql-cluster-population-reader.test.ts` (extended) — commercial aggregate reader
  correctness, unsafe-prefix rejection.
- `tests/unit/mysql-cluster-analytics-reader.test.ts` — snapshot assembly, superseded-snapshot
  historical access, building/validated/failed never exposed, latest-interpretation-wins,
  connection-error mapping.
- `tests/unit/mysql-cluster-snapshot-profile-repository.test.ts` — JSON round-trip, idempotent
  skip-on-matching-checksum, write-on-differing-checksum, empty-input short-circuit.
- `tests/unit/mysql-rfm-segment-bulk-reader.test.ts` — null-segment preservation, no-snapshot
  null, connection-error mapping.
- `tests/unit/get-cluster-snapshot-summary.test.ts` — available/no-profile-yet/not-found/degraded.
- `tests/unit/get-rfm-cluster-cross-tab.test.ts` — full cross-tab math against a hand-computed
  fixture (partial overlap, null segment, unmatched customer), no-RFM-snapshot,
  not-found/degraded paths for both DBs independently.
- `tests/unit/generate-cluster-profiles.test.ts` — end-to-end orchestration, idempotent
  skip-reporting, not-published rejection, population-drift-detection rejection, row-count
  mismatch rejection.
- `tests/integration/customer-cluster-analytics-route.test.ts` — all three HTTP endpoints, status
  codes, query/body rejection, `"latest"` never captured by the `:snapshotId` route.

## 13. Performance

No prematurely-optimized indexing beyond what queries actually use (task Section 47/48): all reads
go through `(snapshot_id, cluster_id)`/`(snapshot_id)` primary/unique keys already defined in
migrations 005-007. Live latencies (Section 8) are all local-DB-read-bound — tens to low hundreds
of milliseconds, no PrestaShop round trip on any HTTP path.

## 14. Limitations / deferred

- Snapshot-to-snapshot comparison (task Section 31/32: population/cluster-count/share deltas,
  transition matrix) — **read model not implemented**, only designed for conceptually (a second
  snapshot with the same `modelVersion` would let `listSnapshotRows()` be called twice and joined
  by `prestashopCustomerId` in the application layer, the same join pattern the cross-tab already
  uses). Not required for T03's DoD (only one production snapshot currently exists) and explicitly
  marked optional-with-fixtures by the task (Section 32). **DEFERRED**, not built.
  Cross-model comparison guardrail (never compare raw `clusterId` across `modelVersion`s, task
  Section 33) is naturally satisfied by construction — nothing in T03 ever compares two different
  models' `clusterId`s.
- CLI analytical summary (`npm run cluster:summary`) implemented per task Section 36 — prints
  JSON + a human table, supports `--snapshot-id=` and `--json=<path>`, no PII (no customerId in
  any aggregate output).
- Commercial post-hoc metrics are read from PrestaShop's *current* row state at generation time
  (Section 2's documented limitation) — acceptable per the task's own instruction, but worth
  flagging for a future Analytics Data Layer that wants a truer point-in-time guarantee.
- No new dedicated `customer_analytics` schema (task Section 39) — same infra constraint T02
  documented, unchanged.
- Analytics Data Layer, Customer Intelligence read model, Copilot/LLM layer, temporal-stability
  validation, Marketing/Brevo integration — all explicitly out of scope (task Sections 53/54),
  not built.

## 15. Future Copilot/Data-Layer integration point (task Section 60)

`GetClusterSnapshotSummaryResult` (available branch) and `GetRfmClusterCrossTabResult` (available
branch) are already exactly the `{model, snapshot, clusters, rfmCrossTab}`-shaped payload the task
described as the eventual Copilot input — no additional transformation layer needed, just a caller
that fetches both and hands them to an LLM. Every payload always carries `modelVersion`,
`snapshotId`, `referenceTime`, and `interpretationVersion` so any downstream consumer (Copilot or
otherwise) can never present a result as more than "according to this model and this snapshot."
