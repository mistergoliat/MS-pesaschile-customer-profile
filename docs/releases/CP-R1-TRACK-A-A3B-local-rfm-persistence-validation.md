# CP-R1 Track A — A3B: Local EC2 RFM Snapshot Persistence + Real End-to-End Validation

Date: 2026-08-17
Scope: `MS-pesaschile-customer-profile` only. `CRM-Customer-360` was not modified — its local MariaDB deployment was only inspected to locate the shared instance.
Builds on: A1/A2, A3 (`BLOCKED_INFRA_PROVISIONING`), the architecture audit.

**Verdict: `DONE`.** RFM persistence is real, provisioned locally, migrated, populated from real PrestaShop data, published, checksum-verified, cross-validated against independently-queried source data, served correctly by the primary `customerId` runtime endpoint, and proven idempotent. Two real, previously-undetected bugs were found and fixed along the way — this is exactly the value of testing against real infrastructure rather than mocks.

---

## 1. Architecture

```
PrestaShop RDS (read-only, pc_consultor account — SELECT ON *.* only)
        |
        v  SELECT-only: ps_customer, ps_orders, ps_order_detail, ...
Customer Profile (this machine)
        |
        v  writer credential
Local EC2 MariaDB (crm-customer-360-mariadb, Docker, port 127.0.0.1:3306)
  main_management   <- CRM-Customer-360 (untouched)
  rfm_snapshot       <- Customer Profile (new, this Gate)
```

Zero writes were made to PrestaShop or `main_management` at any point (see §6, RDS write audit).

## 2. MariaDB deployment

```
Deployment: DOCKER (container crm-customer-360-mariadb, image mariadb:11.4, actual running
            version 11.4.12-MariaDB-ubu2404)
Listening:  127.0.0.1:3306 (host-bound, matches CRM-Customer-360's own .env expectations)
Persistent storage: YES — named Docker volume infra_main_management_mariadb_data mounted at
            /var/lib/mysql (confirmed via `docker inspect`, not assumed from the container
            being "Up" — a bind mount for /docker-entrypoint-initdb.d is separate and only
            runs once against an empty data directory, standard MariaDB image behavior)
main_management exists: YES (pre-existing, CRM-Customer-360's own schema, untouched)
Isolation from RDS: unambiguous — @@hostname/VERSION() differ completely
  (local: a41c5425dbc3 / 11.4.12-MariaDB-ubu2404; RDS: ip-10-1-3-115 / 10.6.25-MariaDB-log)
Backup tooling: mariadb-dump present in the container image, confirmed available (not
            exercised — out of scope for this Gate per its own instruction)
```

## 3. Schema provisioning

```
Schema: rfm_snapshot (no prior normative name existed; matches the architecture audit's own
        §11 recommendation)
Charset/collation: utf8mb4 / utf8mb4_unicode_ci (matches migrations/002-004 exactly)
```

## 4. Grants (isolation)

```
customer_profile_rfm_writer@%
  GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, REFERENCES, INDEX, ALTER
    ON rfm_snapshot.* — nothing else, confirmed via SHOW GRANTS

customer_profile_rfm_reader@%
  GRANT SELECT ON rfm_snapshot.* — nothing else

Isolation: PASS, verified two ways —
  1. SHOW GRANTS shows only `GRANT USAGE ON *.*` (login only) plus the scoped grant above
  2. Empirically: the writer account attempting
     `SELECT COUNT(*) FROM main_management.master_customer` was denied —
     `ERROR 1142 (42000): SELECT command denied to user 'customer_profile_rfm_writer'@
     'localhost' for table 'main_management'.'master_customer'`
```

**Known operational debt, per this Gate's own explicit allowance**: `config.ts` and `rfm-snapshot-config.ts` share a single `RFM_SNAPSHOT_DB_USER`/`PASSWORD` pair — the writer credential is used for both the CLI and (if the HTTP server were pointed at this same `.env`) the HTTP reader path today. Schema-level isolation (the real load-bearing boundary) is unaffected. Splitting credentials per-process is a future config-layer change, not attempted here.

## 5. RDS read-only guarantee

`.env`'s `PRESTASHOP_DB_*`/`CRM_DB_*` both resolve to the same account, `pc_consultor@%`, confirmed via `SHOW GRANTS FOR CURRENT_USER()`: `GRANT SELECT ON *.* TO 'pc_consultor'@'%'` — no CREATE, no INSERT, no UPDATE, no DELETE, no GRANT, anywhere. Every read against PrestaShop in this Gate (population read, diagnostics, connectivity checks, sample cross-validation) went through this same account, which is structurally incapable of writing — confirmed by design (every PrestaShop/CRM reader in this codebase only issues `SELECT`, verified across `mysql-rfm-population-reader.ts`, `mysql-rfm-canonical-identity-resolver.ts`, and the ad-hoc validation scripts) and by database-enforced privilege (any accidental write attempt would have thrown a permission error, which never happened anywhere in this session's logs).

## 6. RDS write audit

```
RDS DDL operations:    0
RDS INSERT operations: 0
RDS UPDATE operations: 0
RDS DELETE operations: 0
```

## 7. Migrations

| Migration | Status |
|---|---|
| 001 (`master_customer.prestashop_customer_id`) | Not applied — out of scope (CRM identity track) |
| 002 (`customer_rfm_snapshot`, `customer_rfm_snapshot_row`) | `APPLIED` to `rfm_snapshot` (local) |
| 003 (segment columns) | `APPLIED` |
| 004 (`customer_rfm_snapshot_run`) | `APPLIED` |

Verified against `information_schema.COLUMNS`/`TABLE_CONSTRAINTS`/`KEY_COLUMN_USAGE`, not asserted from filenames: all columns, types, nullability, PKs, the two `UNIQUE` constraints, all three `CHECK` constraints (recency/frequency/monetary score bounds 1-5), and both `FOREIGN KEY`s (`row→snapshot ON DELETE CASCADE`, `run→snapshot ON DELETE SET NULL`) match the migration files exactly.

## 8. Two real defects found and fixed

Neither of these was visible from unit tests (which mock the query executor directly and never exercise real mysql2 driver behavior or real connection-pool contention) — both only surfaced once the pipeline ran against genuinely real, concurrent, typed infrastructure. This is the entire reason A3B exists as a distinct gate from A1-A3.

### 8.1 Connection pool deadlock (found first, blocked every real run)

`tryAcquireExecutionLock()` (`mysql-rfm-snapshot-run-repository.ts`) checks out a dedicated pool connection and holds it (via `GET_LOCK`) for the *entire* run — that's how the lock's session-scoped hold works. `createRun()`/`completeRun()` each need their *own* connection from the same pool via `pool.execute()`. `RFM_SNAPSHOT_DB_CONNECTION_LIMIT` defaulted to `1` in `rfm-snapshot-config.ts` (unset in `.env`), so the pool had exactly one connection — permanently held by the lock, leaving zero available for `createRun()`, which then waited forever. Confirmed directly, not inferred: `SELECT IS_USED_LOCK('customer_rfm_snapshot_execution_v1')` returned the stalled process's own connection ID while `customer_rfm_snapshot_run` still had zero rows.

**Fix**: default raised to `5` (matches `config.ts`'s own default for the same variable), documented inline with the exact mechanism. **Test added**: `tests/unit/rfm-snapshot-config.test.ts` asserts the default is never less than 2 (the structural minimum to avoid this exact deadlock).

### 8.2 Checksum verification failure on every real (non-empty) snapshot

After the deadlock fix, every real run still failed at `publishSnapshot`'s re-read-and-verify step: `Error: RFM persisted checksum verification failed`. Root cause: the snapshot pool in `rfm-snapshot-command.ts` never set `dateStrings: true` (present on the PrestaShop pool, absent here) — so mysql2 returned `datetime(6)` columns as JS `Date` objects on re-read instead of strings. `toPersistedChecksumRow()` did `String(dateObject)`, producing a locale-formatted string completely different from the MySQL-format string the original (pre-persist) checksum was computed from. `normalizePersistedMysqlDateTime()`'s entire purpose (stripping a `.000000` suffix) only makes sense assuming `dateStrings: true` — clear evidence this was an oversight in the pool wiring, not a deliberate design choice.

**Fix, two parts**: (1) added `dateStrings: true` to the snapshot pool in `rfm-snapshot-command.ts` — the direct fix. (2) Hardened `toPersistedChecksumRow()` itself to tolerate *either* a `Date` or a string (mirroring `mysql-rfm-snapshot-reader.ts`'s existing `parseRequiredUtcDateTime` pattern on the read side) — defense-in-depth so a future pool-config regression (e.g. TD-007's planned `config.ts`/`rfm-snapshot-config.ts` consolidation) can't silently reintroduce this exact failure with zero test coverage. **Test added**: `tests/unit/mysql-rfm-snapshot-repository.test.ts` proves the checksum matches identically whether the driver hands back a string or a `Date` object.

Both fixes: 108/848 tests passing (up from the 108/846 baseline), typecheck/lint clean.

## 9. First real snapshot

```
Run 1: FAILED (deadlock, before the fix — process manually terminated, lock released
       automatically on disconnect, zero state left behind)
Run 2: FAILED (checksum mismatch, after the deadlock fix but before the dateStrings fix)
Run 3: SUCCEEDED

Snapshot ID:         3
Snapshot key:        rfm-population-v1__prestashop-customer-v1__active-365-valid-
                      prestashop-customer-v2__gross-order-value-tax-incl-minus-seller-
                      service-v2__gross-valid-orders-v1__r-tie-safe-percent-rank-v1__
                      frequency-thresholds-candidate-v1__m-tie-safe-percent-rank-v1__
                      2026-08-17T00-00-00-000Z
Reference time:       2026-08-17T00:00:00.000Z
Calculation version:  rfm-population-v1
Population:           14,109 customers
Valid order count:    17,426
Gross order value:    2,894,268,316.10 CLP
Persisted rows:       14,109 (matches population_size exactly)
Checksum:             c3d4dff188335bb85fe817d987ba0fd4fece99aca1300d94cc8b0970797abc39
Status:               published
Duration:             44,502 ms (~44.5s) — real total, not the earlier deadlock-inflated
                      estimate; confirms the "far AWS RDS" latency theory floated mid-
                      investigation was wrong — the deadlock was the entire cause of the
                      earlier multi-minute stalls, not network distance
```

Runs 1 and 2 left **zero** trace in `customer_rfm_snapshot`/`customer_rfm_snapshot_row` (transactional rollback confirmed working correctly) — only their own `customer_rfm_snapshot_run` entries (`status: failed`), which is the correct, intended behavior for the run log.

## 10. CRM enrichment result

```
canonicalMatchedCount:    0
canonicalUnmatchedCount:  14,109
canonicalAmbiguousCount:  0
canonicalCoveragePct:     0.000000
```

Expected and correct: local `main_management.master_customer` lacks `prestashop_customer_id` (confirmed via `SHOW COLUMNS`, same gap as the real RDS CRM instance) — migration 001 out of scope here. Per the A1/A2 fail-open fix, this did **not** block the snapshot: every row has `prestashop_customer_id NOT NULL` and `master_customer_id NULL`, exactly the approved architecture (§7/§14/§15 of the ownership audit).

## 11. Population

`operationalCustomerCount` for this reference time (2026-08-17, 365-day trailing window) = **14,109** — close to, but not identical to, the earlier T11A3 measurement of 14,173 for a different reference time (2026-08-03); the difference is expected (different trailing windows naturally include/exclude different customers as time moves forward), not a discrepancy.

## 12. Checksum

The internal verification (`publishSnapshot`: insert → re-read `FOR UPDATE` → recompute canonical hash → compare against the pre-persist checksum → only then mark `validated`/`published`) is exactly what caught defect 8.2 in the first place — direct, real evidence it executes and enforces correctly, not just code that exists unexercised. No parallel/duplicate checksum implementation was written for this Gate, per its own instruction.

## 13. Primary `customerId` runtime tests

Server started with the real, now-fully-configured `.env` (`RFM_SNAPSHOT_DB_*` pointed at `rfm_snapshot` locally).

| Check | Result |
|---|---|
| `GET /health` | `200 {"status":"ok"}` |
| `GET /health/ready` | `200`, `prestashop: true`, `crm: false` (expected — local `main_management` also lacks `prestashop_customer_id`) |
| `GET /v1/customers/22281/rfm` (known snapshot row) | `200 available` — response matched the persisted DB row field-for-field |
| `GET /v1/customers/999999999/rfm` (nonexistent PrestaShop id) | `404 customer_not_found` |
| `GET /v1/customers/22066/rfm` (real PrestaShop customer confirmed via `/profile` → `200`, but zero valid orders in the RFM window) | `404 rfm_not_available`, `reason: no_current_rfm_record` |
| `GET /v1/master-customers/1/rfm` (legacy path) | `500 internal_error` — expected, pre-existing: the legacy not-found branch reads `main_management.master_customer.prestashop_customer_id`, which doesn't exist locally either (same gap as the RDS CRM instance). Not a new regression; the primary path is this Gate's success criterion, per its own instruction. |

### Sample cross-validation against real PrestaShop data (3 customers, independently queried, not read from the snapshot)

| customerId | Real orders (window) | Real gross total | Snapshot gross | Real recency (days) | Snapshot recency |
|---|---|---|---|---|---|
| 22281 | 1 | 296,941.00 | 296,941.000000 | 306 | 306 |
| 22526 | 4 (7,293 + 167,679 + 39,992 + 27,431) | 242,395.00 | 242,395.000000 | 33 | 33 |
| 22558 | 1 | 34,248.00 | 34,248.000000 | 41 | 41 |

Exact match on every field for all three, computed independently of the snapshot pipeline (fresh `SELECT` against `ps_orders`, no PII beyond order totals/dates, none logged).

## 14. Idempotency

```
PASS
Second run (same referenceTime, same calculationVersion): mode=skipped_existing,
  status=skipped, skipReason=snapshot_already_published, same snapshotId (3), same
  snapshotKey, duration 7,659ms (shorter — skips the transactional persist/verify/publish
  round-trips, still recomputes the dataset to compare checksums)
Duplicate snapshot: NO (total_snapshots = 1, confirmed via COUNT after the second run)
Duplicate rows: NO (total_rows = 14,109, unchanged)
Checksum: SAME (verified via direct row-level comparison, not just re-trusting the log)
```

## 15. Run log

All four attempts recorded accurately and completely:

| id | status | note |
|---|---|---|
| 1 | failed | deadlock discovery run (terminated manually; DB-side lock released automatically on disconnect) |
| 2 | failed | checksum-mismatch discovery run |
| 3 | succeeded | first real publish |
| 4 | skipped | idempotent re-run, `snapshot_already_published` |

## 16. Performance baseline

```
Source population (PrestaShop, full ps_customer): 72,867 (unchanged from earlier Gate 2 read)
RFM operational population (365-day window): 14,109
Valid orders in window: 17,426
First real run duration: 44,502 ms
Idempotent re-run duration: 7,659 ms
Rows written: 14,109
```

**Not implemented, flagged for A4**: per-phase structured logging (source read / calculate / CRM enrichment / persist / verify / publish, each with explicit start/done timestamps). This Gate's own investigation only recovered real timing by killing a deadlocked process and writing a one-off diagnostic script — that reactive process is exactly what per-phase logging would have made unnecessary, and it will be needed for A4's scheduler/observability work regardless (the same instrumentation doubles as production monitoring). Not added here to keep this Gate's diff scoped to the two real defects found; recommended as A4's first task, not deferred indefinitely.

## 17. Known debt

- Single shared `RFM_SNAPSHOT_DB_USER` credential for both CLI (writer-shaped access) and HTTP (should be reader-only) — schema isolation is the real boundary today; credential-level separation is a future config change (§4).
- Legacy `masterCustomerId` path's `500` on CRM schema gaps — pre-existing (TD-006), not touched, not blocking.
- No per-phase pipeline observability yet (§16) — recommended as A4's first task.
- Migration 001 still not applied anywhere real (RDS or local) — unaffected by and unnecessary for this Gate's success, per the approved architecture.

## 18. A4 readiness

**Ready.** Real persistence exists, is migrated, isolated, populated from real data, checksum-verified, cross-validated, served correctly by the primary endpoint, and proven idempotent — end to end, against real infrastructure, not mocks. A4's scope (external scheduler + observability) can now target this real `rfm_snapshot` store directly. Recommended first task for A4: add the per-phase structured logging named in §16, both for scheduler-run observability and to avoid a repeat of this Gate's reactive, kill-and-diagnose investigation process.
