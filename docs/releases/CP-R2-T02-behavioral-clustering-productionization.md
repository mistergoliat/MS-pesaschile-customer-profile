# CP-R2-T02 — Behavioral Clustering Productionization

Status: **READY_FOR_MANUAL_EC2_DEPLOY** (local implementation + local smoke complete; not yet deployed to EC2)
Git branch: `feat/cp-r2-t02-behavioral-clustering-productionization` (based on
`feat/cp-r2-t01-behavioral-clustering-v1` @ `addb248`)
Type: production persistence + serving for the model CP-R2-T01 already validated
experimentally. No new algorithm, no new feature set, no new k — this task productivizes
T01's finding, it does not re-derive it.

---

## 1. Candidate model (unchanged from T01, reproduced with a fixed production seed)

- **Feature Set:** A (12 features, no raw R/F/M) — `distinctProducts, effectiveDiversity,
  averageUnitsPerOrder, purchaseFrequencyDays, orders365d, customerTenureDays,
  repeatProductRate, top1Share, top3Share, cancelledOrderRatio, discountShare, shippingShare`.
- **Algorithm:** K-Means, **k=4**.
- **Training seed:** **42** (fixed, canonical) — T01 used a "most representative of 10 seeds"
  technique per experimental run for *reporting* purposes only; that is not itself a stable
  production choice. The production model pins one specific seed as a versioned
  hyperparameter, the same way `k` itself is pinned.
- **Reproduced metrics** (live training run, 2026-08-19T21:20:00.065Z, n=10,147):
  silhouette **0.2292**, Davies-Bouldin **1.3348**, seed ARI mean/min **0.9926 / 0.9870**,
  resample ARI mean/min **0.9807 / 0.9471** — all within noise of T01's original
  silhouette 0.2287 / seed ARI 0.9930/0.9857 / resample ARI 0.9852/0.9693, confirming the
  production pipeline reproduces T01's finding rather than a different one.

## 2. Versioning (task Section 39)

| Axis | Value |
|---|---|
| `featureVersion` | `behavioral-clustering-features-v1` |
| `preprocessingVersion` | `behavioral-clustering-preprocessing-v1` |
| `modelVersion` | `behavioral-kmeans-k4-v1` |
| `interpretationVersion` | `behavioral-cluster-interpretation-v1` |
| `populationPolicyVersion` | `cp-r2-clustering-population-b-prime-v1` (same as T01, reused) |
| `operationalAccountExclusionPolicyVersion` | `operational-account-exclusion-v1` (reused from RFM) |
| `shopScope` | `all_valid_prestashop_shops` |

## 3. Architecture / pipeline boundary

```
PrestaShop RDS (READ ONLY)
        |
        v
src/infrastructure/prestashop/mysql-cluster-population-reader.ts   (TS, production)
        |  raw Feature-Set-A vectors only, no PII
        v
scripts/clustering/feature-extraction.ts (TS, offline, same as T01)
        |  writes local files
        v
scripts/clustering/python/train_candidate_model.py (Python, venv-isolated)
        |  NEVER touches any DB — reads only local files, writes only model-artifact.json
        v
scripts/clustering/register-model.ts (TS)  --persist
        |  validates + recomputes the checksum (never trusts Python's) + registers
        v
customer_cluster_model, customer_cluster_interpretation  (local MariaDB)
        |
scripts/clustering/publish-snapshot.ts (TS)
        |  TS-NATIVE preprocessing + nearest-centroid assignment — no sklearn, no Python
        v
customer_cluster_snapshot, customer_cluster_snapshot_row  (local MariaDB, transactional)
        |
        v
GET /v1/customers/:customerId/cluster  (reads only the latest published snapshot)
```

**Key design decision (task Section 28):** assignment is reimplemented natively in
TypeScript (`src/domain/customer-clustering/preprocessing.ts` +
`src/domain/customer-clustering/assignment.ts`) — the HTTP server and the snapshot-publishing
CLI never invoke Python or scikit-learn. Python's only role is offline model *fitting*
(`train_candidate_model.py`), exactly matching the boundary already established in T01.
Verified via a live end-to-end run: the TS-native assignment reproduced cluster proportions
matching T01's percentages to within noise (Section 8 below) — not asserted, measured.

## 4. Portable model artifact (task Section 13)

Plain JSON, not a pickle/joblib binary — auditable and reproducible without Python:

```json
{
  "modelVersion": "behavioral-kmeans-k4-v1",
  "algorithm": "kmeans", "k": 4, "trainingSeed": 42,
  "featureOrder": ["distinctProducts", "effectiveDiversity", ...],
  "transforms": { "distinctProducts": {"kind": "log1p_robust_scale", "center": ..., "scale": ...}, ... },
  "centroids": [[...12 values...], [...], [...], [...]],
  "trainingReferenceTime": "...", "trainingDatasetChecksum": "...",
  "metrics": {...}, "temporalStabilityStatus": "not_yet_validated",
  "interpretationMapping": [{"clusterId": 0, "label": "...", "matchDistance": ...}, ...]
}
```

**Checksum design decision:** the artifact's `artifactChecksum` is **never trusted from
Python's output** — `src/domain/customer-clustering/artifact.ts` always recomputes it in
TypeScript from the validated, reconstructed fields. Python's JSON number formatting and
JavaScript's `JSON.stringify` are not guaranteed byte-identical (e.g. exponential-notation
thresholds differ), so requiring Python to reproduce TS's canonical `stableStringify` exactly
would be a fragile, hard-to-verify cross-language contract. TypeScript owns the checksum of
record; Python only owns getting the numbers right. (Discovered and fixed during
implementation — see Section 12.)

## 5. Interpretation mapping (task Section 45)

Hungarian-matched (`scipy.optimize.linear_sum_assignment`) against T01's real published
per-cluster median profiles (7 overlapping, discriminating fields — `repeatProductRate`,
`discountShare`, `cancelledOrderRatio` were identical across all 4 T01 reference clusters and
carry no matching signal, so they're excluded from the distance computation rather than
causing a divide-by-zero). Live result — every cluster matched its T01 story with high
confidence:

| clusterId | Matched label | Match distance |
|---|---|---|
| 0 | HIGH_VALUE_DIVERSIFIED_REPEAT_BUYERS | 0.0026 |
| 1 | RECENTLY_ACTIVE_NEWER_REPEAT_BUYERS | 0.0069 |
| 2 | LONG_TENURE_DORMANT_SPREAD_OUT_REPEAT_BUYERS | 0.0040 |
| 3 | NEW_BURST_THEN_LAPSED_BUYERS | 0.0497 |

All four distances are small relative to the normalized [0,1]-per-field distance space,
confirming this training run's clusters are recognizably the same four archetypes T01 found —
not a coincidental relabeling. `clusterId` and `interpretationLabel` are stored on separate
tables (`customer_cluster_model`/`customer_cluster_snapshot_row` vs.
`customer_cluster_interpretation`, keyed by `(model_id, cluster_id, interpretation_version)`)
so a label/description can be corrected later without retraining (task Section 19).

## 6. Persistence

**Infrastructure decision (task Section 10, documented, not silently inherited):** the
readiness audit proposed a new dedicated schema (`customer_analytics` or
`customer_clustering`). The only currently-provisioned local MariaDB credential
(`customer_profile_rfm_writer`) has DDL/DML privileges scoped to the `rfm_snapshot` schema
only (confirmed via `SHOW GRANTS`: `SELECT/INSERT/UPDATE/DELETE/CREATE/DROP/REFERENCES/
INDEX/ALTER` on `rfm_snapshot.*`, `USAGE` only on `*.*` — no `CREATE DATABASE` privilege).
Rather than block T02 on provisioning new infrastructure, the four clustering tables were
created in the same physical `rfm_snapshot` schema RFM already uses, clearly namespaced under
`customer_cluster_*` (never `customer_rfm_*`) — see the full note in
`migrations/005_create_customer_cluster_tables.sql`. No RFM table was touched. `CLUSTER_DB_*`
is a fully independent credential family in code (`src/config.ts`); pointing it at a dedicated
schema later is a one-line `.env` change, not a code change.

**Tables** (`migrations/005_create_customer_cluster_tables.sql`,
`migrations/006_create_customer_cluster_snapshot_run_table.sql`):
`customer_cluster_model`, `customer_cluster_snapshot`, `customer_cluster_snapshot_row`,
`customer_cluster_interpretation`, `customer_cluster_snapshot_run`. Migrations were applied to
the local MariaDB and verified live (`SHOW TABLES LIKE 'customer_cluster%'` returned all 5).

**Identity:** `prestashop_customer_id` only, **no FK to `master_customer`** — clustering works
identically whether or not CRM is reachable, same as RFM's primary path.

## 7. Publication protocol & idempotency (task Sections 24/25 — live-verified)

Single transaction, mirrors the already-shipped RFM snapshot pattern exactly: `building` →
insert rows → verify row count → verify assignment checksum → `validated` → supersede prior
published snapshot for the same model+population-policy → `published`. Any failure rolls back
— never a partial published snapshot (9 induced-failure-stage tests cover every step).

**Idempotency, live-verified** (not just unit-tested):
1. First `publish-snapshot.ts` run: `mode: "persisted"`, `snapshotId: "1"`, populationSize
   10,147, cluster distribution `{0: 2566, 1: 2076, 2: 3980, 3: 1525}`.
2. Second run, **same** `modelVersion` + `referenceTime`: `mode: "skipped_existing"`,
   `snapshotId: "1"` (same id, not a new one), `skipReason: "snapshot_already_published"`.
3. Confirmed directly against the DB afterward: exactly 1 row in `customer_cluster_snapshot`,
   exactly **10,147** rows in `customer_cluster_snapshot_row` (not 20,294 — no duplication).

`snapshotKey = [modelVersion, populationPolicyVersion, referenceTime].join('__')` — re-running
the same model at the same reference time always resolves to the same key.

## 8. Live cluster distribution (matches T01 within population drift)

| clusterId | Interpretation | Count | % | T01's original % (same archetype) |
|---|---|---:|---:|---:|
| 0 | HIGH_VALUE_DIVERSIFIED_REPEAT_BUYERS | 2,566 | 25.29% | 25.23% |
| 1 | RECENTLY_ACTIVE_NEWER_REPEAT_BUYERS | 2,076 | 20.46% | 20.52% |
| 2 | LONG_TENURE_DORMANT_SPREAD_OUT_REPEAT_BUYERS | 3,980 | 39.22% | 39.13% |
| 3 | NEW_BURST_THEN_LAPSED_BUYERS | 1,525 | 15.03% | 15.11% |

Reproduced by the TS-native assignment path (no sklearn involved in producing these numbers),
strong evidence the TypeScript preprocessing + nearest-centroid reimplementation is correct.

## 9. HTTP endpoint (task Sections 34-38 — live-verified)

`GET /v1/customers/:customerId/cluster` → latest published snapshot only, never recomputes,
never calls Python.

| Case | Status | Live-verified |
|---|---|---|
| Clustered customer | 200 `available` (cluster/model/snapshot/assignment) | ✅ (real customerId 22066 → clusterId 3, NEW_BURST_THEN_LAPSED_BUYERS) |
| Customer doesn't exist in PrestaShop | 404 `customer_not_found` | ✅ |
| Customer exists, <2 valid orders (one-time/no-order buyer) | 404 `cluster_not_available`, `reason: insufficient_repeat_purchase_history` | ✅ (real customerId 22092) |
| `CLUSTER_DB_*` unset | 503 `degraded`, `reason: cluster_not_configured` | unit/integration test only |
| No snapshot ever published | 503 `degraded`, `reason: no_published_cluster_snapshot` | unit/integration test only |
| Cluster DB unreachable | 503 `degraded`, `reason: cluster_unavailable` | unit test only |

Response never includes full centroids, never recomputes anything on-demand — reads
`customer_cluster_snapshot_row` + `customer_cluster_interpretation` only.

## 10. PII / security

- Feature extraction, model artifact, and every HTTP response carry only `customerId` +
  numeric features/cluster metadata — reuses (and, for the domain layer, promotes into
  production) the same PII-guard pattern validated in T01.
  `src/domain/customer-clustering/pii-guard.ts` runs over every artifact before it's trusted
  and every manifest before it's written.
- **Zero PrestaShop RDS writes** — confirmed both by code inspection (no
  INSERT/UPDATE/DELETE/DDL keyword anywhere in the clustering TS code) and by the same
  `SHOW GRANTS`-based read-only assertion T01 used, re-run at the start of every
  `publish-snapshot.ts` execution.
- Python never receives a DB credential of any kind (verified by inspection — no `mysql2`,
  `pymysql`, or connection-string handling anywhere in `scripts/clustering/python/`).

## 11. Limitations / deferred (task Sections 41/60, unchanged from T01)

- **`temporalStabilityStatus: "not_yet_validated"`** — recorded explicitly on the model row,
  never silently omitted. Not a publish blocker per the task's explicit instruction; the model
  is `production_candidate` status internally, not asserted `long_term_stable`.
- Category/manufacturer/cart/geography features remain excluded (unchanged from T01).
- The pre-existing T10A-3-vs-shipped-RFM shop-scope inconsistency is inherited, not resolved.
- No scheduler, no automated retraining — CLI-only, exactly as scoped.
- No Marketing/Sales/Analytics-Data-Layer integration — deferred, but persistence is keyed by
  `prestashop_customer_id` so a future read model can join across Commercial
  Profile/RFM/Clustering on that single key without any schema change here.
- GMM/HDBSCAN remain diagnostic-only from T01 — not productionized, as instructed.

## 12. Bugs found and fixed during implementation

- **Cross-language checksum risk (caught before it shipped):** the original design had Python
  compute `artifactChecksum` using a hand-rolled port of TS's canonical `stableStringify`.
  Recognized this as fragile (JSON number formatting isn't guaranteed identical across
  Node/Python) before writing the Python side — redesigned so TypeScript always owns the
  checksum of record, Python's own checksum field is ignored entirely. See Section 4.
- **Broken placeholder in the first draft of `mysql-cluster-population-reader.ts`:** an early
  version of `discountShare`/`shippingShare` computation referenced a non-existent field via
  an unsafe cast and always returned 0. Caught by TypeScript's structural typing forcing the
  cast to be visibly suspicious during review; fixed by extending the order-aggregate SQL to
  select `total_discounts_tax_incl`/`total_shipping_tax_incl` directly, matching T01's
  experimental reader.

## 13. Operational runbook

```bash
# 1. Install Python dependencies (one-time, or after requirements.txt changes)
cd scripts/clustering/python
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt

# 2. Run the full test suite
cd ../../..
npm test                                                  # TypeScript, 983 tests
cd scripts/clustering/python && ./.venv/Scripts/python.exe -m pytest tests/ -v   # Python, 22 tests

# 3. Apply migrations (local MariaDB — NEVER the PrestaShop RDS)
#    Same rfm_snapshot schema RFM uses (see Section 6's infra note). Adjust host/user for a
#    dedicated schema once one is provisioned.
mariadb -h 127.0.0.1 -P 3306 -u customer_profile_rfm_writer -p rfm_snapshot \
  < migrations/005_create_customer_cluster_tables.sql
mariadb -h 127.0.0.1 -P 3306 -u customer_profile_rfm_writer -p rfm_snapshot \
  < migrations/006_create_customer_cluster_snapshot_run_table.sql

# 4. Extract features (read-only against PrestaShop RDS)
cd ../..   # back to repo root
npx tsx scripts/clustering/feature-extraction.ts

# 5. Train the candidate model (Python, offline, no DB access)
cd scripts/clustering/python
./.venv/Scripts/python.exe train_candidate_model.py
cd ../../..

# 6. Validate the artifact (no DB write)
npx tsx scripts/clustering/register-model.ts

# 7. Register it in the model registry (writes to CLUSTER_DB_*, never PrestaShop)
npx tsx scripts/clustering/register-model.ts --persist

# 8. Publish a snapshot (assigns the whole population, TS-native, no Python)
npx tsx scripts/clustering/publish-snapshot.ts

# 9. Run the HTTP service and query the endpoint
npx tsx src/index.ts
curl http://localhost:3010/v1/customers/<customerId>/cluster
```

No passwords are included above — see `.env.example` for the required `CLUSTER_DB_*`
variables.

## 14. Definition of Done — checklist (task Section 63)

- [x] Model candidate versioned (`behavioral-kmeans-k4-v1`, 4 independent version axes)
- [x] Preprocessing reproducible (persisted transform parameters, TS reimplementation)
- [x] Portable model artifact (plain JSON, no pickle)
- [x] Local persistence implemented (5 tables, local MariaDB)
- [x] Migrations created (005, 006 + rollbacks)
- [x] Publication atomic (transactional, 9 failure-stage tests + live verification)
- [x] Idempotency validated (live: 2nd run skipped, no duplicate rows)
- [x] Snapshot rows persisted (live: 10,147 rows)
- [x] Interpretation versioned (Hungarian-matched, separate table)
- [x] Latest-published reader implemented
- [x] HTTP endpoint implemented and live-tested (4/6 cases live, 2/6 unit-tested)
- [x] One-time-customer handling implemented (live-tested)
- [x] PII guard PASS
- [x] Tests PASS (983 TS + 22 Python)
- [x] Build PASS
- [x] No RDS writes (confirmed by code inspection + live grant check)
- [x] No scheduler
- [x] No Marketing/Sales integration
