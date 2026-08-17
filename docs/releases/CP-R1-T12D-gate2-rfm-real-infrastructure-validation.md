# CP-R1-T12D — Gate 2: Real RFM Infrastructure Validation

Date: 2026-08-17
Scope: `MS-pesaschile-customer-profile` only. `CRM-Customer-360` was not touched.
Restrictions honored: no destructive SQL, no data modification, no scheduler, no CRM flags, no commit, no push.

**Verdict: `GATE 2: BLOCKED`** at STEP 2 (environment presence check). This document records what was still verified with real infrastructure before stopping, per the brief's own instruction not to invent credentials and to halt cleanly when a required variable is missing.

---

## 1. Git state

Unchanged from the end of Gate 1 — confirmed at STEP 0, not assumed:

```text
HEAD: 638c6a5 (branch main)
```

```text
 M .gitignore
 M package.json
 M src/bootstrap.ts
?? docs/audits/CP-R1-T12B-technical-debt-readiness-audit.md
?? docs/releases/CP-R1-T12D-gate1-readiness-regression-fix.md
?? scripts/snapshots/rfm-window-comparison.ts
?? scripts/snapshots/rfm-year-over-year-comparison.ts
?? scripts/snapshots/rfm/window-comparison-outputs/
?? scripts/snapshots/rfm/year-over-year-outputs/
?? tests/unit/bootstrap-readiness.test.ts
```

All Gate 1 changes (`src/bootstrap.ts`, the new test, the Gate 1 doc) and all pre-existing unrelated local work (`.gitignore`, `package.json`, the ad-hoc RFM comparison scripts) are exactly as Gate 1 left them. Nothing discarded, nothing reset.

## 2. Environment presence matrix

`.env` exists (last modified 2026-07-29, i.e. **before** the RFM feature was merged on 2026-08-14/15) and was checked for variable *presence* only — no values printed.

```text
PRESTASHOP_DB_HOST: SET
PRESTASHOP_DB_PORT: SET
PRESTASHOP_DB_USER: SET
PRESTASHOP_DB_PASSWORD: SET
PRESTASHOP_DB_NAME: SET
PRESTASHOP_DB_PREFIX: SET

CRM_DB_HOST: SET
CRM_DB_PORT: SET
CRM_DB_USER: SET
CRM_DB_PASSWORD: SET
CRM_DB_NAME: SET

RFM_SNAPSHOT_DB_HOST: MISSING
RFM_SNAPSHOT_DB_PORT: MISSING
RFM_SNAPSHOT_DB_USER: MISSING
RFM_SNAPSHOT_DB_PASSWORD: MISSING
RFM_SNAPSHOT_DB_NAME: MISSING

RFM_CALCULATION_VERSION: MISSING
RFM_REFERENCE_TIME: MISSING (expected — only required for ad-hoc manual runs, not the scheduled/default path)
RFM_DRY_RUN: MISSING (expected — optional, defaults false)
```

Per the brief's own STEP 2 instruction ("Si alguna variable obligatoria falta, detener Gate 2 como BLOCKED"): `RFM_SNAPSHOT_DB_HOST/USER/PASSWORD/NAME` and `RFM_CALCULATION_VERSION` are all unconditionally required (confirmed in code, see §3) and none are present. **Gate 2 stops here per the brief's own rule.** No credentials were invented or borrowed from the `PRESTASHOP_DB_*`/`CRM_DB_*` families — confirmed in code that no such fallback exists (`src/config.ts`, `src/rfm-snapshot-config.ts` both declare these as independent, unrelated fields).

## 3. A finding bigger than "Gate 2 can't run": the service itself can't boot here

This was not anticipated by the brief and is reported as a bug, not worked around:

`src/config.ts:17-21` declares `RFM_SNAPSHOT_DB_HOST/USER/PASSWORD/NAME` as `z.string().min(1)` with **no `.optional()` and no `.default()`** — unconditional, at the top-level schema for the *entire* HTTP server's configuration, not scoped to the `/rfm` route alone. Confirmed by attempting to import `src/config.ts` in this environment:

```
Error: Invalid environment variables: [
  { path: ["RFM_SNAPSHOT_DB_HOST"], message: "Invalid input: expected string, received undefined" },
  { path: ["RFM_SNAPSHOT_DB_USER"], message: "Invalid input: expected string, received undefined" },
  { path: ["RFM_SNAPSHOT_DB_PASSWORD"], message: "Invalid input: expected string, received undefined" },
  { path: ["RFM_SNAPSHOT_DB_NAME"], message: "Invalid input: expected string, received undefined" }
]
    at src/config.ts:62
```

**Practical consequence**: in this environment right now, the whole service — including the five endpoints that have no RFM/CRM dependency at all (`profile`, `commercial-summary`, `purchased-products`, `purchase-behavior`, `orders/:reference/status`) and `/health`/`/health/ready` — cannot start, because `config.ts` throws at module load before any route exists. This is a boot-time coupling introduced when RFM's config fields were added to the main server schema (`e76a799`), not something Gate 1 touched. `src/rfm-snapshot-config.ts` (the separate CLI-only config used by `npm run snapshot:rfm`) does mark these same fields `.optional()` at the raw-parse level and only applies `requiredEnv()` conditionally — but `RFM_CALCULATION_VERSION` there is `z.string().min(1)` with no `.optional()` either, so the CLI config *also* fails to load, meaning **even a dry run cannot be attempted** (`RFM_DRY_RUN=true` never gets read, because parsing dies before that check).

This is reported as a genuine finding, not fixed: per the task's own constraint ("no corregir el bug salvo que sea estrictamente necesario para completar Gate 2 y el cambio sea mínimo y seguro"), fixing it would mean either fabricating credentials (explicitly forbidden) or loosening `config.ts`'s schema to make RFM optional at the main-server level — a real architectural change (does the server *start* degraded without RFM, or not?) that deserves a human decision, not a silent patch mid-Gate-2.

## 4. Connectivity — what could still be tested with real credentials

PrestaShop and CRM credentials are present, so real SQL-level connectivity was tested directly (bypassing `src/config.ts` for this probe only, via a temporary, non-repo-committed script using the exact same queries `checkPrestashopReadiness`/`checkCrmReadiness` run — deleted immediately after use, confirmed absent from `git status` at the end of this task).

| DB | DNS/TCP | SQL handshake | Authentication | Probe query | Result |
|---|---|---|---|---|---|
| PrestaShop (`pesas_productiva`) | OK | OK | OK | `SELECT 1` | **OK**, 635-677ms |
| CRM (`main_management`) | OK | OK | OK | `SELECT prestashop_customer_id FROM master_customer LIMIT 0` | **`ER_BAD_FIELD_ERROR`** — column does not exist |
| RFM Snapshot DB | — | — | — | — | **NOT_TESTABLE** — no credentials configured anywhere |

## 5. CRM schema state — confirmed, not new

Per user clarification during this task: `main_management` is the correct CRM database (`master_customer` lives there), and PrestaShop's `pesas_productiva.ps_customer` was always meant to be the real, primary identity/data source. This matches the architecture already documented since T12A — the finding below is a **confirmation of a previously "not verifiable from the repo" fact**, not a new surprise:

- `master_customer` table exists in `main_management` (`information_schema.tables` count = 1).
- Columns: `id` (PK), `firstname`, `lastname`, `email` (unique), `platform_origin`, `rut` — **no `prestashop_customer_id` column**. Migration 001 (`add_master_customer_prestashop_customer_id`) has **not been applied** to this database.
- Row count: **1**. This CRM instance holds essentially no real customer data.
- PrestaShop, by contrast, is real and substantially populated: `ps_customer` = **72,867** rows, `ps_orders` = **81,123** rows (plain `COUNT(*)`, no data extracted, per the brief's non-destructive read-only allowance).

**Implication for Gate 2, independent of the missing RFM_SNAPSHOT_DB_* credentials**: even with those credentials supplied, RFM snapshot generation would still fail during canonical-identity resolution — `mysql-rfm-canonical-identity-resolver.ts` reads exactly the missing `master_customer.prestashop_customer_id` column that produced the `ER_BAD_FIELD_ERROR` above — and `/rfm`'s live CRM lookup on its not-found branch would hit the same issue. This is the same root cause T12A's own doc names as its original motivating problem ("In the current environment that CRM column is not available"), now confirmed still true, months later, against this specific `main_management` instance.

## 6. Everything from STEP 5 onward: not attempted

Per the brief's explicit STOP instruction and the Definition of Done's "no maquillar un resultado parcial como DONE": no migration state check against the RFM Snapshot DB, no dry-run, no real snapshot execution, no publication check, no runtime `/rfm` test, no idempotency test, no run-log check, no failure-mode drills were attempted — there is no RFM Snapshot DB connection to check any of this against, and the server that would serve `/rfm` cannot even boot (§3).

## 7. TD-008 status

```text
TD-008: BLOCKED
```

Not `RESOLVED` (nothing was executed against real infra) and not meaningfully `PARTIALLY_RESOLVED` either — the one thing that *was* newly confirmed (CRM's `master_customer` schema/population state) upgrades an existing "not verifiable" finding to a confirmed fact, but doesn't touch any of TD-008's own definition of done (migrations/snapshot/publication/runtime-read/idempotence — none attempted).

## 8. What would unblock Gate 2

Two independent things are needed, not one:

1. **Real `RFM_SNAPSHOT_DB_HOST/PORT/USER/PASSWORD/NAME` and `RFM_CALCULATION_VERSION` values**, added to `.env` (or whatever the real target environment for this validation is — this local `.env` may not be the right place at all if the intent is to validate against a shared staging DB). This alone would unblock server boot and let a dry run be attempted.
2. **A `main_management` CRM environment with migration 001 applied and real `prestashop_customer_id` linkage populated** — without this, snapshot generation will fail at the canonical-identity-resolution step even once (1) is fixed. If the intended validation target is a different/staging CRM instance than the one this `.env` currently points at, that should be confirmed before retrying.

Neither of these can be supplied by continuing to work in this repo — they're environment/credential facts, not code.

---

**No code was changed in this task.** No migrations were run. No data was written, modified, or deleted in any database. `master_customer`, `ps_customer`, `ps_orders` were read with `COUNT(*)`/`information_schema` queries only — no rows, no PII, ever extracted.
