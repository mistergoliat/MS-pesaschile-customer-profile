# CP-R1 Track A — Final Production Readiness Audit

Date: 2026-08-17
Scope: `MS-pesaschile-customer-profile` only, read/test/document/prepare-handoff. No EC2 access was attempted at any point — no remote connection, no remote DB, no remote process management. Everything in this document was confirmed locally.

---

## Verdict

```
READY_FOR_MANUAL_EC2_DEPLOY_WITH_DEFERRED_DEBT
```

The code, contract, config semantics, migrations, and snapshot worker are all confirmed production-safe by direct evidence (not assumption) — including a real, cross-validated, idempotent snapshot run against real PrestaShop data (A3B). Real, acknowledged debt remains (§9), none of it blocking. "Ready" here means an operator can deploy Customer Profile to EC2 by following `docs/runbooks/CP-R1-customer-profile-ec2-production-deployment.md` alone — it does not mean CRM-Customer-360 activation is ready (§8, deliberately separate).

---

## 1. Git state inventory (STEP 0)

```
HEAD: 638c6a5834a45fab6e6e16e45afa0c0aa707bf65 (branch main, unchanged through all of Track A)
```

| Category | Files |
|---|---|
| **TRACK A REQUIRED** | 13 modified `src/`+`scripts/` files, 3 new `src/` files, 15 modified test files, 5 new test files (full list in the companion runbook §M and in `git diff --stat`) |
| **PREVIOUS AUDIT/DOCS** (pre-Track-A, from Gate 1/Gate 2) | `docs/audits/CP-R1-T12B-technical-debt-readiness-audit.md`, `docs/releases/CP-R1-T12D-gate1-readiness-regression-fix.md`, `docs/releases/CP-R1-T12D-gate2-rfm-real-infrastructure-validation.md`, `tests/unit/bootstrap-readiness.test.ts` (Gate 1's own test) |
| **TRACK A'S OWN DOCS** | `docs/audits/CP-R1-RFM-data-ownership-crm-architecture-audit.md` (the design doc Track A implements), `docs/releases/CP-R1-TRACK-A-A1A2-...md`, `...-A3-...md`, `...-A3B-...md`, this document, the runbook |
| **AD-HOC ANALYSIS — unrelated to Track A** | `.gitignore`, `package.json` (both modified only to register `rfm-window-comparison`/`rfm-year-over-year-comparison` scripts — confirmed via `git diff`, zero Track A content in either), `scripts/snapshots/rfm-window-comparison.ts`, `scripts/snapshots/rfm-year-over-year-comparison.ts`, their output directories |

No UNRELATED category beyond the ad-hoc analysis bucket above.

## 2. Final validation (STEP 1, re-run at STEP 19)

```
typecheck: PASS
lint:      PASS
tests:     108 files / 848 passed / 0 failed / 0 skipped
build:     PASS — dist/src/**/*.js confirmed present, including every new Track A file
```

## 3. Diff audit (STEP 2)

Scanned every Track A source file for: TODO/FIXME/XXX, `console.log`/`debugger`, hardcoded `localhost`/`127.0.0.1`, password/secret-shaped literals. **Zero matches.** Test fixtures use only obviously-fake placeholder credentials (`'crm-password'`, `'secret'`, etc.) — none match real values. `.env` confirmed gitignored, absent from every diff. No leftover references anywhere in `src/`/`scripts/`/`tests/` to any of this session's temporary diagnostic scripts (all were deleted immediately after use, per the A3B doc's own account). Zero RDS writes — confirmed independently in A3B §5-6 (account-enforced: `pc_consultor` is globally `SELECT`-only) and re-confirmed here by re-reading every reader in the Track A diff (all `SELECT`-only, no write capability exists in any of them).

## 4. Final Customer Profile contract (STEP 3)

Confirmed directly from `src/http/routes/index.ts` (`grep 'router.get('`), not from docs:

```
GET /health
GET /health/ready
GET /v1/customers/:customerId/profile
GET /v1/customers/:customerId/commercial-summary
GET /v1/customers/:customerId/purchased-products
GET /v1/customers/:customerId/purchase-behavior
GET /v1/customers/:customerId/rfm                        <- PRIMARY, customerId = ps_customer.id_customer
GET /v1/master-customers/:masterCustomerId/rfm            <- LEGACY/SECONDARY, distinct path prefix
GET /v1/customers/:customerId/orders/:reference/status
```

The legacy path cannot be confused with the primary contract by shape — different URL prefix, deliberately (see A1/A2 doc).

## 5. Dependency matrix (STEP 4)

Confirmed from each use case's own dependency-injection signature (`grep -A5 'export function create...'`), not inferred:

| Capability | PrestaShop | CRM | RFM DB |
|---|---|---|---|
| profile | required | no | no |
| commercial-summary | required | no | no |
| purchased-products | required | no | no |
| purchase-behavior | required | no | no |
| order-status | required | no | no |
| **rfm (primary, customerId)** | required (existence check) | **no** | required to answer `available`/`rfm_not_available`; absent → `503 rfm_not_configured` |
| **rfm (legacy, masterCustomerId)** | **no** (confirmed: `createGetCustomerRfm`'s deps type has no PrestaShop slot at all) | required (existence check + readiness probe) | same as above |

## 6. Configuration inventory (STEP 5)

### HTTP server (`src/config.ts`) — what the deployed process itself needs

```
Always required (server refuses to boot without these):
  PRESTASHOP_DB_HOST, PRESTASHOP_DB_USER, PRESTASHOP_DB_PASSWORD
  CRM_DB_HOST, CRM_DB_USER, CRM_DB_PASSWORD
  PRESTASHOP_ORDER_STATE_LANG_ID, PRESTASHOP_CARRIER_LANG_ID, PRESTASHOP_CARRIER_SHOP_ID
  (no silent defaults — a misconfigured value must fail loudly, by this file's own design)

Have safe defaults (override only if the deployment differs):
  PORT=3010, {PRESTASHOP,CRM,RFM_SNAPSHOT}_DB_PORT=3306,
  {PRESTASHOP,CRM,RFM_SNAPSHOT}_DB_CONNECTION_LIMIT=5, *_QUERY_TIMEOUT_MS=3000,
  PRESTASHOP_DB_NAME=pesas_productiva, PRESTASHOP_DB_PREFIX=ps_, CRM_DB_NAME=main_management,
  CUSTOMER_PROFILE_RECENT_ORDERS_LIMIT=10

Optional, all-or-nothing (enables /rfm's primary+legacy paths when fully set; absent ->
/rfm returns 503 rfm_not_configured, everything else works normally; partially set -> the
whole server fails to boot, by design):
  RFM_SNAPSHOT_DB_HOST, RFM_SNAPSHOT_DB_USER, RFM_SNAPSHOT_DB_PASSWORD, RFM_SNAPSHOT_DB_NAME
```

`RFM_CALCULATION_VERSION` is **not** read by the HTTP server at all — confirmed absent from `config.ts`'s schema.

### Snapshot CLI (`src/rfm-snapshot-config.ts`) — a separate process, separate (superset) requirements

```
npm run snapshot:rfm (manual):
  Always required: PRESTASHOP_DB_HOST/USER/PASSWORD, CRM_DB_HOST/USER/PASSWORD,
                    RFM_CALCULATION_VERSION, RFM_REFERENCE_TIME
  Required unless RFM_DRY_RUN=true: RFM_SNAPSHOT_DB_HOST/USER/PASSWORD/NAME

npm run snapshot:rfm:scheduled:
  Same as above minus RFM_DRY_RUN/RFM_REFERENCE_TIME (computes referenceTime automatically
  at UTC start-of-day) — RFM_SNAPSHOT_DB_* is unconditionally required here (no dry-run mode)
```

Both confirmed directly from `rfm-snapshot-config.ts`'s zod schemas, not assumed.

## 7. `.env.example` readiness (STEP 6)

**Was STALE — fixed in this Gate.** `RFM_SNAPSHOT_DB_*` and `RFM_CALCULATION_VERSION` were entirely undocumented (predates all of Track A, confirmed by `git log` showing the file untouched since before the RFM feature existed). Updated to document: the HTTP-optional/all-or-nothing semantics, that the CLI's requirements are a strict superset, `RFM_SNAPSHOT_DB_CONNECTION_LIMIT`'s safe minimum (with the deadlock rationale inline), and the current `RFM_CALCULATION_VERSION` value in use. No secrets added — every value is either a safe default or left blank, matching the file's existing convention. No stale T12B/T12C-style comments were found in this repo's `.env.example` (that finding was specific to `CRM-Customer-360`'s own file, a different repo, not applicable here).

## 8. Migration readiness (STEP 7)

```
002_create_customer_rfm_snapshot_tables.sql
003_add_customer_rfm_snapshot_row_segments.sql
004_create_customer_rfm_snapshot_run_table.sql
```

Exact order confirmed by filename prefix and by direct execution in A3B (applied successfully, in this order, against a real MariaDB instance — not just theoretically reproducible).

**`001_add_master_customer_prestashop_customer_id.sql` — DO NOT APPLY for Track A.** Belongs to the future CRM/Identity track (TD-015 in the architecture audit: it alters a table `CRM-Customer-360` owns and migrates independently, untracked in that repo's own migration history). Confirmed, not assumed: zero references to `master_customer` or migration 001 anywhere in the primary `customerId` RFM path (§5's dependency matrix already shows CRM isn't touched at all by that path).

## 9. Technical debt, reclassified against current (not historical) architecture (STEP 17)

| ID | Debt | Status |
|---|---|---|
| TD-001 | `/health/ready` `crm` field mislabeled | `RESOLVED` (Gate 1) |
| TD-003 | `customerId`/`masterCustomerId` collision risk | `RESOLVED` — the two are now on structurally distinct paths (`/v1/customers/...` vs `/v1/master-customers/...`), not just documented as risky |
| TD-004 | No scheduler | Command-level: `RESOLVED` (`SCHEDULER_COMMAND_READY`, §11). Cron/systemd wiring: manual operator step, part of this deployment's runbook §K — not deferred to a later track, just not automatable by Claude |
| TD-006 | RFM 500-vs-503 asymmetry | Primary path: `RESOLVED` (`rfm_unavailable`/`rfm_not_configured` added in A1/A2). Legacy path: `DEFERRED_POST_DEPLOY` — deliberately untouched, low priority given legacy is secondary |
| TD-007 | Dual RFM config schema (`config.ts` vs `rfm-snapshot-config.ts`) | `DEFERRED_POST_DEPLOY` — connection-limit defaults are now aligned (both 5) as an A3B side effect, but the schemas remain genuinely separate |
| TD-008 | No real-DB validation | `RESOLVED` (A3B: real snapshot, cross-validated, checksum-verified, idempotent) |
| TD-009 | CRM `.env.example` T12B/T12C stale comments | `OUT_OF_SCOPE_TRACK_B` — lives in `CRM-Customer-360`, a different repo, never touched here. (This repo's own `.env.example` staleness, a related but separate issue, was fixed in §7.) |
| TD-010 | Legacy `httpCustomerProfileAdapter.ts` | `OUT_OF_SCOPE_TRACK_B` — lives in `CRM-Customer-360` |
| TD-011 | PII over-fetch in `mysql-master-customer-reader.ts` | `DEFERRED_POST_DEPLOY` — no functional bug, pure hardening, untouched |
| TD-012 | No freshness/staleness signal for RFM | `DEFERRED_POST_DEPLOY` — not inflated to a blocker (§10 below); manual SQL freshness checks now documented in the runbook instead of building `/health/rfm` |
| TD-013 | CRM coupling on `/rfm`'s not-found branch | Primary path: `RESOLVED` (zero CRM dependency, confirmed §5). Legacy path: unchanged, secondary, not blocking |
| TD-014 | `masterCustomerId`-only RFM excludes CRM-absent customers | `RESOLVED` (A1/A2: primary path is now `customerId`-keyed) |
| TD-015 | Migration 001 cross-repo ownership mismatch | `OUT_OF_SCOPE_TRACK_B` (CRM/Identity track), confirmed not a prerequisite for this track (§8) |
| TD-016 | `main_management` host discrepancy (RDS vs CRM-Customer-360's own `.env`) | `OUT_OF_SCOPE_TRACK_B` — irrelevant to deploying Customer Profile itself; only matters if/when CRM activation work begins |
| **NEW** | Connection pool deadlock (`RFM_SNAPSHOT_DB_CONNECTION_LIMIT` default) | `RESOLVED` (A3B, with regression test) |
| **NEW** | Checksum verification `Date`-vs-string fragility | `RESOLVED` (A3B, pool config fix + defensive hardening + regression test) |
| **NEW** | No per-phase snapshot pipeline logging | See §10 — `SAFE_TO_DEFER`, recommended as A4's first task |
| **NEW** | Shared `RFM_SNAPSHOT_DB_USER` for CLI-writer and HTTP-reader contexts | `DEFERRED_POST_DEPLOY` — schema isolation (§4 of the A3B doc) is the real security boundary and is already correct; credential-level separation is additional hardening |

**Nothing in this table blocks production deployment.**

## 10. Structured logging decision (STEP 9)

**`SAFE_TO_DEFER`.** Reasoning against the brief's own stated criteria: the run log already creates a `'started'` row *before* any PrestaShop/CRM work begins (confirmed: `tryAcquireExecutionLock()` → `createRun()` both happen first, ahead of any source read — `run-rfm-snapshot-operation.ts:141-157`), so an operator querying the run table mid-execution already sees genuine signal (a live `started` row with a timestamp), not silence. The actual defect that caused indefinite, truly-silent blocking — the connection pool deadlock — is fixed (A3B). Total real runtime is ~45 seconds end-to-end (A3B measurement against the real population), not the "minutes" threshold the brief itself sets as the bar for requiring phase logging. Recommended as A4's explicit first task regardless (§9), since A4's scheduler work will want the same instrumentation for its own monitoring — not deferred indefinitely, deferred to the track that needs it for a second reason anyway.

## 11. Scheduler command readiness (STEP 10)

```
SCHEDULER_COMMAND_READY
```

`npm run snapshot:rfm:scheduled`, confirmed via code (not re-executed against EC2, per this task's own restriction) and via the equivalent manual command already proven safe for repeat/concurrent invocation in A3B:

- Distributed lock: `SELECT GET_LOCK('customer_rfm_snapshot_execution_v1', 0)`, non-blocking — a second concurrent invocation gets `skipReason: 'execution_lock_not_acquired'` and exits cleanly, never blocks or corrupts state.
- Skip when already published: `mode: 'skipped_existing'` for a matching `snapshotKey` + checksum — proven directly in A3B (§14 of that doc), not just by reading the code.
- Run log: every invocation (success, failure, or skip) gets a row — proven directly in A3B, 4/4 real attempts accurately recorded.
- Non-zero exit on failure: confirmed in `rfm-snapshot-command.ts`'s outer catch (`process.exitCode = 1`) — exactly what cron/systemd need to detect a failed run.
- No overlapping publication: the lock is held for the *entire* operation including the final `publishSnapshot` transaction, not released until the whole run completes.

## 12. Freshness — manual operator queries (STEP 11)

No `/health/rfm` endpoint was built (correctly not required per the brief's own criteria — see §9's TD-012 entry). An operator can check freshness manually at any time:

```sql
-- Last published snapshot + its age
SELECT id, snapshot_key, status, population_size, generated_at, published_at,
       TIMESTAMPDIFF(HOUR, published_at, UTC_TIMESTAMP()) AS age_hours
FROM customer_rfm_snapshot
WHERE status = 'published'
ORDER BY published_at DESC, id DESC
LIMIT 1;

-- Most recent execution, any outcome
SELECT id, trigger_source, status, started_at, completed_at, skip_reason, error_type, error_code
FROM customer_rfm_snapshot_run
ORDER BY id DESC
LIMIT 1;

-- Most recent failure specifically
SELECT id, trigger_source, started_at, completed_at, error_type, error_code
FROM customer_rfm_snapshot_run
WHERE status = 'failed'
ORDER BY id DESC
LIMIT 1;
```

Silently serving a stale snapshot is real, pre-existing, deliberate design (no staleness cutoff on the read side) — **not inflated to a blocker**: on first deploy there is no staleness risk yet (the first snapshot is fresh by construction), and the risk only accumulates later if the scheduler silently stops running, which is exactly A4's monitoring scope.

## 13. Security audit (STEP 12)

```
PrestaShop connection:  READ_ONLY expected and confirmed (pc_consultor account, A3B §5)
RFM DB:                 own schema (rfm_snapshot), isolated from main_management (A3B §4)
RFM HTTP process:       no DDL — confirmed, mysql-rfm-snapshot-reader.ts is SELECT-only
Secrets:                .env only, gitignored, confirmed absent from every diff (§3)
Secret values in source/docs/tests/git diff: NONE (§3's scan)
```

## 14. Production process readiness (STEP 13)

No `Dockerfile`, `docker-compose`, or PM2 ecosystem file exists in this repo (checked directly — absent). This repo is a plain Node process with its own `build`/`start` scripts; process supervision (systemd, PM2, or otherwise) is an EC2-host-level operator decision this repo does not dictate or assume.

```
Recommended production start command:
  npm ci --omit=dev && npm run build && npm start
  (equivalently: npm run build && node dist/src/index.js)
```

## 15. CRM activation boundary (STEP 16)

**Customer Profile deployment ≠ CRM activation.** `CUSTOMER_PROFILE_ENABLED` and `CUSTOMER_PROFILE_CONTEXT_ENABLED` in `CRM-Customer-360` are untouched by this track and remain exactly as they were found (both `false`/unset in that repo's production config, per the earlier `CP-R1-T12B` audit) — this deployment does not flip them, does not require flipping them, and flipping them is explicitly a separate future track's decision, not a step in this runbook.

---

## Restrictions honored

No EC2 connection attempted. No remote database created or modified. No remote process management. No commit. No push. `.env` and its RFM credentials were not modified in this Gate (already configured by A3B, correctly gitignored, unchanged here).
