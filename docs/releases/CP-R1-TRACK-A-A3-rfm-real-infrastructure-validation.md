# CP-R1 Track A — A3: RFM Snapshot DB Provisioning + Real Infrastructure Validation

Date: 2026-08-17
Scope: `MS-pesaschile-customer-profile` only. `CRM-Customer-360` was not touched.
Builds on: A1/A2 (`docs/releases/CP-R1-TRACK-A-A1A2-rfm-customerid-optional-runtime.md`), the architecture audit (`docs/audits/CP-R1-RFM-data-ownership-crm-architecture-audit.md`), and the prior Gate 2 validation (`docs/releases/CP-R1-T12D-gate2-rfm-real-infrastructure-validation.md`).

**Verdict: `BLOCKED_INFRA_PROVISIONING`.** The credentials available in this environment are read-only across the entire shared database server — there is no technical path to creating a schema, a user, or any table from here. This is not a partial effort or a cautious stop-early call: it's a hard permission wall, confirmed directly (§5). Everything in this Gate that does *not* require write/DDL access was completed, including a real defect found and fixed in the CRM-enrichment path (§7).

---

## 1. Physical DB architecture (confirmed, read-only)

The credentials in `.env` for both `PRESTASHOP_DB_*` and `CRM_DB_*` connect to the **same physical server**: MariaDB `10.6.25-MariaDB-log`, reached via the PrestaShop RDS hostname (`pesas-productiva...rds.amazonaws.com`, matching the architecture audit's §2 finding). `information_schema.SCHEMATA` on that server lists (among others): `pesas_productiva` (PrestaShop, the intended RFM population source), `main_management` (CRM), `pc_pos`, `pc_pos_dev`, `intranet`, `hwm`, `pch_ps_web`, `pch_ps_web_DEVELOP`, `pc_ventas_en_verde`, `pos_coloborador`, `matri_pipe_maira`, `vm_develop` — this is a shared, multi-application production/dev server, not a PrestaShop-only instance. No `rfm_snapshot`-named (or similarly named) schema exists on it today.

This confirms the architecture audit's §11 recommendation is technically viable in principle (a dedicated schema on this instance is a well-established pattern here — a dozen schemas already coexist) — but confirming viability is different from having the access to act on it.

## 2. Schema name

No prior code or doc fixes a normative name (checked `.env.example`, every `docs/releases/CP-R1-T11*`/`T12*` file, and the architecture audit — only table names inside a schema, `customer_rfm_snapshot*`, are fixed by the migrations). Per the architecture audit's own §11 example and STEP 5's fallback rule, the recommended name is:

```
rfm_snapshot
```

## 3. Permissions model (design, not yet applied)

```
Writer (CLI: npm run snapshot:rfm[:scheduled])
  GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES
    ON rfm_snapshot.* TO 'rfm_writer'@'%'
  (CREATE/ALTER/INDEX/DROP/REFERENCES only needed if this same user also applies
   migrations; an operator may revoke those after migrations 002-004 are applied and
   re-grant only when a new migration ships)

Reader (HTTP process)
  GRANT SELECT ON rfm_snapshot.* TO 'rfm_reader'@'%'
```

**Known limitation, documented as operational debt per STEP 4's own allowance, not a blocker**: `src/config.ts` and `src/rfm-snapshot-config.ts` both read a single `RFM_SNAPSHOT_DB_USER`/`RFM_SNAPSHOT_DB_PASSWORD` pair — the code has no built-in split between a writer identity (CLI process) and a reader identity (HTTP process). Two separate credentials are still achievable operationally (the CLI and the HTTP server can be deployed with different `.env` files pointing at `rfm_writer` and `rfm_reader` respectively), just not enforced by a single shared config file. Schema-level isolation (a dedicated `rfm_snapshot` schema untouchable from `ps_*`/`main_management`) is the real, load-bearing isolation boundary here, and that part of the design is unaffected by this limitation.

**Never**: grant write access to `ps_*`/`pesas_productiva` or `main_management` to either RFM credential.

## 4. Environment presence matrix (no secrets)

```
PRESTASHOP_DB_HOST: SET (real RDS hostname, matches architecture audit §2)
PRESTASHOP_DB_USER: SET (pc_consultor — confirmed read-only, SELECT ON *.* only)
PRESTASHOP_DB_PASSWORD: SET
CRM_DB_HOST: SET (same host as PRESTASHOP_DB_HOST)
CRM_DB_USER: SET (same pc_consultor account, same global SELECT-only grant)
CRM_DB_PASSWORD: SET

RFM_SNAPSHOT_DB_HOST: MISSING
RFM_SNAPSHOT_DB_PORT: MISSING
RFM_SNAPSHOT_DB_USER: MISSING
RFM_SNAPSHOT_DB_PASSWORD: MISSING
RFM_SNAPSHOT_DB_NAME: MISSING
RFM_CALCULATION_VERSION: MISSING (documented current value across every T11A*/T11H doc: rfm-population-v1 — no newer version string found anywhere)
```

Unchanged from Gate 2 (2026-07-29 `.env`, still not touched since).

## 5. Connectivity — and the permission wall

Real, non-destructive connectivity check (temporary script, `SELECT 1` / `VERSION()` / `SHOW GRANTS FOR CURRENT_USER()` / `information_schema.SCHEMATA` only — no data extracted, no writes attempted, deleted immediately after use, confirmed absent from `git status`):

```
PRESTASHOP_DB_* credentials -> SELECT 1: OK. SHOW GRANTS: GRANT SELECT ON *.* TO 'pc_consultor'@'%'
CRM_DB_* credentials        -> SELECT 1: OK. SHOW GRANTS: GRANT SELECT ON *.* TO 'pc_consultor'@'%'
```

**Both env-configured credential pairs resolve to the exact same MySQL account (`pc_consultor`), with a single, global, read-only grant.** There is no `CREATE`, no `GRANT`, no `INSERT` anywhere in this account's privileges. This means:

- I cannot create the `rfm_snapshot` schema.
- I cannot create `rfm_writer`/`rfm_reader` users.
- I cannot apply migrations 002-004 (all DDL).
- Even if a schema existed, this account couldn't write rows to it.

This is the exact scenario the task brief's STEP 3 anticipated and pre-authorized as a valid outcome: *"Si no existen permisos para crear schema/users, reportar exactamente qué DDL/credenciales debe ejecutar el operador y dejar Gate A3 como `BLOCKED_INFRA_PROVISIONING`."* No alternative infrastructure (a different RDS, a local substitute DB) was provisioned instead — the brief explicitly forbids provisioning another RDS, and substituting a fake/local target would misrepresent what "real infrastructure validation" means for a Definition of Done that explicitly requires "RFM Snapshot DB real existe."

### DDL/credentials an operator needs to run

```sql
-- 1. Schema (charset/collation matching migrations/002-004)
CREATE DATABASE IF NOT EXISTS rfm_snapshot
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 2. Writer (CLI)
CREATE USER 'rfm_writer'@'%' IDENTIFIED BY '<strong password, generated by the operator>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES
  ON rfm_snapshot.* TO 'rfm_writer'@'%';

-- 3. Reader (HTTP process)
CREATE USER 'rfm_reader'@'%' IDENTIFIED BY '<different strong password>';
GRANT SELECT ON rfm_snapshot.* TO 'rfm_reader'@'%';

FLUSH PRIVILEGES;
```

Then, using the `rfm_writer` credentials:

```bash
mysql -h <prestashop-rds-host> -P 3306 -u rfm_writer -p rfm_snapshot < migrations/002_create_customer_rfm_snapshot_tables.sql
mysql -h <prestashop-rds-host> -P 3306 -u rfm_writer -p rfm_snapshot < migrations/003_add_customer_rfm_snapshot_row_segments.sql
mysql -h <prestashop-rds-host> -P 3306 -u rfm_writer -p rfm_snapshot < migrations/004_create_customer_rfm_snapshot_run_table.sql
```

`migrations/001_add_master_customer_prestashop_customer_id.sql` was **not** included — it belongs to the CRM identity track and is out of scope here, per the task's own explicit instruction and the architecture audit's §19 verdict (`REWORK_BEFORE_APPLY`, and against `main_management`, not `rfm_snapshot`).

Then populate `.env` (or the equivalent secret store):

```
RFM_SNAPSHOT_DB_HOST=<same host as PRESTASHOP_DB_HOST>
RFM_SNAPSHOT_DB_PORT=3306
RFM_SNAPSHOT_DB_USER=rfm_writer   (CLI context) / rfm_reader (HTTP context, if split — see §3)
RFM_SNAPSHOT_DB_PASSWORD=<...>
RFM_SNAPSHOT_DB_NAME=rfm_snapshot
RFM_CALCULATION_VERSION=rfm-population-v1
```

## 6. Migrations — classification

| Migration | Status |
|---|---|
| 001 (`master_customer.prestashop_customer_id`) | Out of scope for A3 (CRM track) — not applied, not attempted |
| 002 (`customer_rfm_snapshot`, `customer_rfm_snapshot_row`) | `NOT_APPLIED` — no `rfm_snapshot` schema exists to apply it to |
| 003 (segment columns) | `NOT_APPLIED`, same reason |
| 004 (`customer_rfm_snapshot_run`) | `NOT_APPLIED`, same reason |

Not asserted from filenames alone — confirmed by the `information_schema.SCHEMATA` read in §5, which shows no schema by this or any RFM-shaped name exists anywhere on the reachable server.

## 7. CRM enrichment behavior — defect found and fixed

This was the one part of STEP 12 answerable without real infrastructure, and it surfaced a real, previously-undetected bug.

**Classification before this fix: effectively `REQUIRED`, fails closed.** Traced the full call chain (`rfm-snapshot-command.ts:76-78` → `run-rfm-snapshot-operation.ts:57,167` → `create-rfm-snapshot.ts:99-108`, old code): `canonicalIdentityResolver` is **unconditionally constructed and passed** by the CLI wiring — never omitted, regardless of dry-run mode or `RFM_SNAPSHOT_DB_*` configuration. `create-rfm-snapshot.ts`'s old code only fell back to "everyone unmatched" when the resolver was entirely absent (`undefined`) — a state the real CLI never produces. When the resolver was present and its `resolvePrestashopCustomerIds()` call threw (exactly what happens today: `main_management.master_customer` has no `prestashop_customer_id` column, so the query fails `ER_BAD_FIELD_ERROR` → `CrmSchemaIncompatibleError`, confirmed directly by Gate 2), the error propagated uncaught through `createRfmSnapshot` and `runRfmSnapshotOperation`, **aborting the entire snapshot — even a pure dry run that writes nowhere.**

This directly contradicts the approved architecture (`master_customer_id` is optional enrichment, never a precondition — audit §7/§14/§15) and means: **no RFM snapshot, dry-run or real, could have completed successfully against the actual current CRM schema state, independent of whether `RFM_SNAPSHOT_DB_*` was ever configured.**

**Fix applied** (`src/application/customer-rfm/create-rfm-snapshot.ts`): the resolver call is now wrapped; `CrmUnavailableError`, `CrmTimeoutError`, and `CrmSchemaIncompatibleError` specifically degrade to the same "everyone unmatched" fallback the code already used for a missing resolver — reusing that exact fallback shape, not inventing a new one. Any other, unclassified error still propagates and aborts (a real bug should still fail loudly — mirrors the existing `degradedOrThrow` pattern in `get-customer-commercial-summary.ts`).

**Classification after fix: `OPTIONAL_AND_FAIL_OPEN`.**

**Tests added**:
- `tests/unit/create-rfm-snapshot.test.ts` — renamed the test that previously locked in the old behavior (it used a plain untyped `Error`, which correctly still propagates — that assertion was already right, just misleadingly titled); added one case per classified CRM error type proving the snapshot still completes with `masterCustomerId: null` and untouched R/F/M metrics; added a test proving the "resolver absent" and "resolver fails open" paths produce byte-identical fallback output.
- `tests/unit/run-rfm-snapshot-operation.test.ts` — added an end-to-end case: a `CrmSchemaIncompatibleError` from the resolver now results in `status: 'succeeded'`, `mode: 'persisted'`, and a real `publishSnapshot` call — not a failed run.

## 8-16. First snapshot, publication, checksum, runtime endpoint tests, idempotency, run log, performance baseline

**NOT_ATTEMPTED — blocked by §5.** None of these can be executed without a writable `RFM_SNAPSHOT_DB_*` target, which does not exist and cannot be created with the credentials available in this environment. No values are fabricated or estimated for these sections.

## 17. Defects found/fixed

| Defect | Severity | Status |
|---|---|---|
| CRM canonical-identity-resolver failures aborted the entire RFM snapshot (dry-run or real), contradicting the approved "optional enrichment" architecture | High — would have blocked A3's own eventual snapshot run, and every future run, against the real CRM schema state as it exists today | **Fixed** in this Gate, tests added (§7) |
| RFM Snapshot DB provisioning is blocked by an infrastructure permission wall, not a code issue | Blocking for A3's DB-dependent steps only | Reported, not fixable from this environment — needs operator action (§5) |

## 18. A4 readiness

**Not ready — A3 must be re-run once an operator provisions the schema/users in §5.** Once that happens, re-running A3's STEP 6 onward should now succeed on the *first* attempt at the CRM-enrichment step specifically (§7's fix removes what would otherwise have been a second, code-level blocker discovered only after the infra blocker was cleared). No scheduler was configured (out of scope, unchanged). No CRM-Customer-360 flags were touched (out of scope, unchanged).
