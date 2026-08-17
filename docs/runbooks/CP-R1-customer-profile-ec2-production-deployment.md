# CP-R1 — Customer Profile EC2 Production Deployment Runbook

Audience: the human operator performing this deployment manually on the EC2 host. Claude has no EC2 access and did not execute any step in this document against EC2 — every command below was validated either against real infrastructure locally (A3B, using the exact same local-MariaDB pattern this runbook adapts for EC2) or by direct code/config inspection (this document's companion audit, `docs/audits/CP-R1-TRACK-A-final-production-readiness-audit.md`).

Read the audit doc first if anything here is unclear about *why* a step exists.

**Placeholders used throughout**: `<...>` marks a value you must supply. Never paste a real password into a copy-pasted command history you don't control — prefer an interactive prompt or a secrets manager where your EC2 setup supports it.

---

## A. Update code

```bash
cd <customer-profile-path-on-ec2>
git status --short          # confirm no uncommitted local changes you'd lose
git fetch origin
git checkout main
git pull --ff-only origin main
npm ci --omit=dev
npm run build
```

If `git pull --ff-only` refuses (diverged history), stop and resolve manually — do not force-push or reset without understanding why the branches diverged.

## B. Configure environment

Edit (or create) `.env` in the repo root on EC2. Do not commit it — it's gitignored by design.

```bash
# Core (always required)
PORT=3010

CRM_DB_HOST=<prestashop/crm RDS host — same instance as PRESTASHOP_DB_HOST>
CRM_DB_PORT=3306
CRM_DB_USER=<read-only account, e.g. pc_consultor>
CRM_DB_PASSWORD=<...>
CRM_DB_NAME=main_management

PRESTASHOP_DB_HOST=<prestashop RDS host>
PRESTASHOP_DB_PORT=3306
PRESTASHOP_DB_USER=<read-only account>
PRESTASHOP_DB_PASSWORD=<...>
PRESTASHOP_DB_NAME=pesas_productiva
PRESTASHOP_DB_PREFIX=ps_

PRESTASHOP_ORDER_STATE_LANG_ID=<confirm the real operational language id — do not guess>
PRESTASHOP_CARRIER_LANG_ID=<confirm — may differ from the above>
PRESTASHOP_CARRIER_SHOP_ID=<confirm>

# RFM — optional for the HTTP server (all-or-nothing: set all four or none)
RFM_SNAPSHOT_DB_HOST=127.0.0.1
RFM_SNAPSHOT_DB_PORT=3306
RFM_SNAPSHOT_DB_USER=customer_profile_rfm_writer
RFM_SNAPSHOT_DB_PASSWORD=<...>
RFM_SNAPSHOT_DB_NAME=rfm_snapshot
RFM_SNAPSHOT_DB_CONNECTION_LIMIT=5

# RFM — required by the snapshot CLI only (not read by the HTTP server)
RFM_CALCULATION_VERSION=rfm-population-v1
```

**Do not skip the PrestaShop language/shop IDs** — `config.ts` has no silent default for these on purpose; guessing wrong silently mistranslates order states.

## C. Validate PrestaShop read-only connectivity

```bash
mariadb -h <PRESTASHOP_DB_HOST> -P 3306 -u <PRESTASHOP_DB_USER> -p -e "SELECT 1;"
mariadb -h <PRESTASHOP_DB_HOST> -P 3306 -u <PRESTASHOP_DB_USER> -p -e "SHOW GRANTS FOR CURRENT_USER();"
```

Confirm the grants show **`SELECT` only** — if this account has write privileges, stop and get a read-only one issued before proceeding; nothing in Customer Profile should ever need write access to PrestaShop.

## D. Create local `rfm_snapshot` schema

**First, confirm you are on the local EC2 MariaDB, not the PrestaShop RDS** — this is the one step in this runbook where connecting to the wrong host would be a real mistake:

```bash
mariadb -h 127.0.0.1 -P 3306 -u root -p -e "SELECT @@hostname, VERSION();"
```

Compare the output against the PrestaShop RDS identity from step C — they must be **different**. If your local MariaDB runs in Docker (matching the `crm-customer-360-mariadb` pattern validated in A3B), use `docker exec -it <container> mariadb -u root -p` instead of a direct host connection.

Once confirmed distinct:

```sql
CREATE DATABASE IF NOT EXISTS rfm_snapshot
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

## E. Create RFM user/grants

Using the isolation model validated directly in A3B (writer denied access to `main_management`, confirmed via `ERROR 1142`, not just via `SHOW GRANTS`):

```sql
CREATE USER IF NOT EXISTS 'customer_profile_rfm_writer'@'%' IDENTIFIED BY '<strong-password-here>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES
  ON rfm_snapshot.* TO 'customer_profile_rfm_writer'@'%';

CREATE USER IF NOT EXISTS 'customer_profile_rfm_reader'@'%' IDENTIFIED BY '<different-strong-password>';
GRANT SELECT ON rfm_snapshot.* TO 'customer_profile_rfm_reader'@'%';

FLUSH PRIVILEGES;
```

Verify isolation before moving on:

```bash
mariadb -h 127.0.0.1 -P 3306 -u customer_profile_rfm_writer -p -e "SELECT 1 FROM main_management.master_customer LIMIT 1;"
# MUST fail with "SELECT command denied" — if it succeeds, the grants above were not applied
# correctly; do not proceed to step F until this fails as expected.
```

Use `customer_profile_rfm_writer` for `RFM_SNAPSHOT_DB_USER` in `.env` (the CLI needs write access; the HTTP server would ideally use the reader credential instead — see the audit doc §9's noted deferred hardening item on this).

## F. Apply migrations 002/003/004

```bash
mariadb -h 127.0.0.1 -P 3306 -u customer_profile_rfm_writer -p rfm_snapshot < migrations/002_create_customer_rfm_snapshot_tables.sql
mariadb -h 127.0.0.1 -P 3306 -u customer_profile_rfm_writer -p rfm_snapshot < migrations/003_add_customer_rfm_snapshot_row_segments.sql
mariadb -h 127.0.0.1 -P 3306 -u customer_profile_rfm_writer -p rfm_snapshot < migrations/004_create_customer_rfm_snapshot_run_table.sql
```

**Do NOT apply `migrations/001_add_master_customer_prestashop_customer_id.sql`.** It belongs to a future CRM/Identity track, is not a prerequisite for RFM, and alters a table (`master_customer`) that this schema does not own.

Verify:

```sql
SHOW TABLES FROM rfm_snapshot;
-- expect exactly: customer_rfm_snapshot, customer_rfm_snapshot_row, customer_rfm_snapshot_run
```

## G. First snapshot

```bash
RFM_REFERENCE_TIME="$(date -u +%Y-%m-%dT00:00:00.000Z)" npm run snapshot:rfm
```

Expect a single-line JSON summary ending in `"status":"succeeded","mode":"persisted"`. If you see `"status":"failed"`, do **not** retry blindly — check `error_type`/`error_code` in the run log (step H) first; if both are `Error`/`Error` (unclassified), the safe messages are deliberately stripped of detail, so you'll need to inspect logs/stack traces on the host directly.

## H. Verify DB

```sql
-- Latest published snapshot
SELECT id, snapshot_key, status, population_size, generated_at, published_at, dataset_checksum
FROM rfm_snapshot.customer_rfm_snapshot
ORDER BY id DESC LIMIT 1;

-- Row count must equal population_size above
SELECT COUNT(*) FROM rfm_snapshot.customer_rfm_snapshot_row;

-- Run log — should show one 'succeeded' row for this run
SELECT id, trigger_source, status, started_at, completed_at, error_type, error_code
FROM rfm_snapshot.customer_rfm_snapshot_run
ORDER BY id DESC LIMIT 3;
```

## I. Start/restart Customer Profile

```bash
npm start
# or, equivalently: node dist/src/index.js
```

Wrap this in whatever process supervisor your EC2 host already uses (systemd/PM2/other) for crash-restart and boot-start — this repo does not include or assume a specific one.

## J. Smoke HTTP

```bash
curl -s http://localhost:3010/health
curl -s http://localhost:3010/health/ready
curl -s http://localhost:3010/v1/customers/<a-known-real-customerId>/profile
curl -s http://localhost:3010/v1/customers/<same-customerId>/rfm
```

Expect `200` on all four if that `customerId` has both a PrestaShop profile and an RFM row. `/rfm` returning `404 rfm_not_available` for a real customer with no orders in the trailing 365-day window is correct, not a failure.

## K. Configure scheduler manually

**OPERATOR STEP — NOT EXECUTED BY CLAUDE.**

```bash
npm run snapshot:rfm:scheduled
```

is the command to schedule. It computes `referenceTime` automatically (UTC start-of-day) — do not pass `RFM_REFERENCE_TIME` for scheduled runs. It is safe for periodic/cron use: distributed-locked, idempotent, always exits non-zero on failure, always writes a run-log row (all four properties proven directly against real infrastructure in A3B, not just read from code).

Example cron entry (adjust the path and confirm your EC2 host's timezone before trusting "daily" — cron typically runs in the host's local timezone, while the snapshot's own `referenceTime` is always UTC start-of-day regardless of when cron fires it):

```cron
# Runs once daily. Confirm host timezone with `timedatectl` before picking the hour —
# this example assumes a UTC host and targets just after UTC midnight.
5 0 * * * cd <customer-profile-path> && /usr/bin/npm run snapshot:rfm:scheduled >> /var/log/customer-profile/rfm-snapshot.log 2>&1
```

No specific cadence is mandated by this codebase beyond the initial "daily" SLO noted in `docs/releases/CP-R1-T11G-...md` — confirm with whoever owns the operational calendar before finalizing.

## L. Rollback

If Customer Profile fails after deploy:

1. Stop the process (`npm start`'s supervisor: stop/disable it).
2. `git checkout <previous-known-good-commit>`, `npm ci --omit=dev`, `npm run build`, restart.
3. **Never** touch PrestaShop data as part of rollback — this service has never had write access to it, and rollback doesn't change that.
4. If the failure is RFM-specific (not the whole server), you do not need to roll back the whole service: unset all four `RFM_SNAPSHOT_DB_*` variables in `.env` and restart — the server boots fine without them, and only `/rfm` degrades to `503 rfm_not_configured` while you investigate. This is the fastest safe mitigation for an RFM-only problem.
5. The `rfm_snapshot` schema is disposable and separate from `main_management`/PrestaShop — if it's ever in a bad state, it can be dropped and rebuilt from steps D-G without touching anything else.

---

## Deployment verification checklist

```
[ ] code updated (git pull --ff-only succeeded, correct commit)
[ ] npm ci
[ ] build PASS
[ ] env configured (all core vars set; RFM vars set as a complete group or not at all)
[ ] local MariaDB confirmed (hostname/version differ from the PrestaShop RDS)
[ ] rfm_snapshot exists
[ ] rfm_writer denied access to main_management (isolation verified, not assumed)
[ ] migrations 002/003/004 applied (001 NOT applied)
[ ] first snapshot published
[ ] population == rows
[ ] RFM endpoint 200 (or a correct, expected 404)
[ ] scheduler installed
[ ] scheduler smoke executed (one manual `npm run snapshot:rfm:scheduled` run, check the run log)
[ ] run log verified
[ ] CRM flags still OFF (CUSTOMER_PROFILE_ENABLED / CUSTOMER_PROFILE_CONTEXT_ENABLED
    in CRM-Customer-360 — this deployment does not touch them)
```
