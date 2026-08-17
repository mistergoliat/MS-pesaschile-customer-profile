# CP-R1-T12D — Gate 1: Customer Profile Sync + Readiness Regression Fix

Date: 2026-08-17
Scope: `MS-pesaschile-customer-profile` only. `CRM-Customer-360` was not touched.
Restrictions honored: no commit, no push, no destructive git operations, no scope beyond Gate 1.

This document does not restate `docs/audits/CP-R1-T12B-technical-debt-readiness-audit.md` — it records what Gate 1 of `CP-R1-T12D — Customer Profile Production Activation Readiness` actually did, verified with real command output.

---

## 1. Initial HEAD

`7f2d4f5` — "Merge pull request #13 ... feat(identity): accept direct prestashop customer input" (T12A). This was the state at the start of the session that produced the audit; RFM (T11B–T11H) did not exist anywhere in the local working tree or local git history at that point.

## 2. HEAD after sync

`638c6a5` — "docs(customer-rfm): close T11 with cross-repo T11H reference", identical to `origin/main`. Confirmed at STEP 0 preflight (this task) via `git rev-parse HEAD` / `git rev-parse origin/main` / `git log --oneline HEAD..origin/main` (empty) — the sync had already been performed in the prior session and remained intact; STEP 0 verified it was still true rather than assuming it.

## 3. Commits incorporated by fast-forward

```
e76a799 feat(customer-rfm): complete post-RFM runtime and operations   (2026-08-14)
638c6a5 docs(customer-rfm): close T11 with cross-repo T11H reference   (2026-08-15)
```

`git pull --ff-only origin main` — pure fast-forward, no merge commit. One conflict surfaced during reconciliation with pre-existing local work (see §11) and was resolved without discarding anything.

## 4. Baseline (pre-change validation)

Captured immediately after the fast-forward, before any Gate 1 code change:

```text
typecheck: PASS (tsc -p tsconfig.json --noEmit, no output)
lint:      PASS (eslint . --ext .ts, no output)
test files: 103 passed (103)
tests passed: 796
tests failed: 0
tests skipped: 0
```

`npm ci` was not run — blocked by this environment's auto-mode classifier (a permission restriction on this machine/session, not a repo problem). `node_modules` was already present and consistent from prior work in this repo; `typecheck`/`lint`/`test` are what actually exercise the dependency tree and all passed, so this did not block Gate 1. No preexisting failure was found or worked around.

## 5. TD-001 confirmation

Confirmed present in the pulled HEAD (`638c6a5`), not assumed from the audit:

```ts
// src/bootstrap.ts:146-152, as pulled
const checkReadiness: ReadinessCheck = async () => {
  const [prestashop, crm] = await Promise.all([
    checkPrestashopReadiness(config.prestashopDb.prefix),
    pingPrestashop().catch(() => false),
  ]);
  return { prestashop, crm };
};
```

`checkCrmReadiness()` (`src/infrastructure/crm/crm-pool.ts:53`) existed, was exported (`src/infrastructure/crm/index.ts:2`), and had its own passing unit coverage (`tests/unit/crm-pool.test.ts`) — but had zero call sites in `src/bootstrap.ts`. Confirmed via `grep -rn "checkCrmReadiness"` across `src/` and `tests/` before the fix.

## 6. Root cause

Pinned to the exact commit and exact diff hunk, not inferred:

```
git diff 841e8aa a61b2b0 -- src/bootstrap.ts
```

Pre-T12A (`841e8aa`):
```ts
const checkReadiness: ReadinessCheck = async () => {
  const [crm, prestashop] = await Promise.all([checkCrmReadiness(), pingPrestashop()]);
  return { crm, prestashop };
};
```

T12A (`a61b2b0`) rewrote this block (reordering fields, switching PrestaShop's own check to the newer `checkPrestashopReadiness(prefix)`) and, in the same edit, replaced the `checkCrmReadiness()` call with a second `pingPrestashop()` call — almost certainly a copy/adapt mistake made while restructuring the two probes side by side, not a deliberate architectural change (T12A's own doc never proposes removing the CRM readiness signal, only the CRM *data* dependency from the five main endpoints). The same commit also dropped `closeCrmPool()` from `shutdown()`, which is directly related — see §8.

## 7. Change made

`src/bootstrap.ts`:

```ts
import {
  checkCrmReadiness,
  closeCrmPool,
  createMysqlMasterCustomerReader,
  getCrmQueryExecutor,
  type CrmReadinessResult,
} from './infrastructure/crm/index.js';
import {
  checkPrestashopReadiness,
  closePrestashopPool,
  getPrestashopQueryExecutor,
} from './infrastructure/prestashop/prestashop-pool.js';   // pingPrestashop import removed — no longer used here

// ...

const checkReadiness: ReadinessCheck = async () => {
  const [prestashop, crmResult] = await Promise.all([
    checkPrestashopReadiness(config.prestashopDb.prefix),
    checkCrmReadiness().catch((): CrmReadinessResult => ({ status: 'not_ready', reason: 'crm_unavailable' })),
  ]);
  return { prestashop, crm: crmResult.status === 'ready' };
};

// ...
shutdown: async () => {
  await Promise.all([closePrestashopPool(), closeCrmPool(), closeRfmSnapshotPool()]);
},
```

Notes on scope discipline:
- `ReadinessResult`/`ReadinessCheck` (`src/http/routes/index.ts`) were **not touched** — `crm` stays a `boolean`, computed here from `crmResult.status === 'ready'` to preserve the exact existing HTTP contract. See §9.
- `checkCrmReadiness()`'s own `.catch()` mirrors the same fail-closed pattern already used for `pingPrestashop()` in the old code (`.catch(() => false)`), just mapped through `CrmReadinessResult` so the boolean coercion happens in one place.
- **TD-013 decision applied as instructed**: CRM infrastructure (pool, reader, readiness check) was kept, not removed. This Gate does not touch the CRM-removal question.
- **One additional, in-scope fix beyond the literal audit line item**: `shutdown()` was missing `closeCrmPool()`. This gap predates this Gate (introduced by the same `a61b2b0` commit, and already latent since `e76a799` wired `masterCustomerReader` to the same CRM pool for RFM) — but STEP 5's own checklist ("Revisar: ... shutdown; pools") called for checking exactly this, and leaving it while making `checkCrmReadiness()` genuinely live on every `/health/ready` call would mean the CRM pool now backs a per-request-adjacent path without ever being closed on graceful shutdown. Fixed in the same, minimal diff.

## 8. Tests added

`tests/unit/bootstrap-readiness.test.ts` (new file — no prior test exercised `bootstrap()`'s `checkReadiness` wiring at all; every route test stubbed it out completely, which is why TD-001 shipped undetected).

- **Case A** — PrestaShop ready + CRM ready → `{ prestashop: {status:'ready'}, crm: true }`.
- **Case B (critical)** — PrestaShop ready + CRM not_ready → `{ prestashop: {status:'ready'}, crm: false }`, asserted without the overall `status` flipping (per the confirmed decision to keep `/health/ready` gated on PrestaShop only — see §9).
- **Case C** — PrestaShop not_ready + CRM ready → `{ prestashop: {status:'not_ready',...}, crm: true }`, proving the two signals are independent in both directions, not just one.
- **Case D** — `checkCrmReadiness()` itself throws → `crm: false`, fail-closed.

**Empirical proof the tests actually detect the regression** (not just replicate the fix's own logic): the test file mocks `pingPrestashop` (always resolving `true`) alongside `checkCrmReadiness`, specifically so it can be run unmodified against the pre-fix `bootstrap.ts`. Verified by temporarily stashing only the `bootstrap.ts` change (`git stash push -- src/bootstrap.ts`) and re-running the suite:

```
FAIL  reports crm=false when PrestaShop is up but CRM is down...
  expected true to be false   (crm mirrored PrestaShop's health, exactly the TD-001 bug)
FAIL  reports crm=false when the CRM probe itself throws
  crm: true (received) vs crm: false (expected)
Test Files  1 failed (1)
     Tests  2 failed | 2 passed (4)
```

Then restored (`git stash pop`) and re-confirmed 4/4 green against the fix. Cases A and C do not discriminate old vs. new code (by design — `pingPrestashop`'s mocked value happens to coincide with the expected result there), which is expected and fine; Cases B and D are the ones that matter for TD-001, and both fail with a real semantic mismatch (wrong *value*, not a crash from an incomplete mock) against the old code.

## 9. Test results, in full

Post-change (final):

```text
typecheck: PASS
lint:      PASS
test files: 104 passed (104)
tests passed: 800
tests failed: 0
tests skipped: 0
```

Delta from baseline: +1 file, +4 tests, 0 regressions.

`/health/ready`'s HTTP contract was independently re-verified as unchanged: `git diff -- src/http/routes/index.ts` is empty. `ReadinessResult`/`ReadinessCheck` types, JSON field names, and status-code logic (`prestashop.status !== 'ready'` is still the only thing that flips the endpoint to `503`) are untouched. `crm` was, and remains, an informational field in the response body — it does not gate the HTTP status. This matches the explicit decision made before writing any test: **keep the current documented policy** ("CRM incompatibility must not block readiness", per `README.md` and `docs/releases/CP-R1-T11F-rfm-runtime-exposure.md`'s stated non-scope for `/health/ready`) rather than reinterpreting the user's Gate-1 brief's test description as a request to change the gating logic. Only the *truthfulness* of the `crm` field's data source was fixed.

## 10. RFM state after pull (static verification only — no DB execution)

All components the audit listed as part of the T11B–T11H runtime are present and wired:

| Component | Verified as |
|---|---|
| `GET /v1/customers/:masterCustomerId/rfm` | `src/http/routes/index.ts:247` |
| Snapshot repository (transactional publish) | `src/infrastructure/rfm/mysql-rfm-snapshot-repository.ts` |
| Snapshot reader (runtime `/rfm` reads) | `src/infrastructure/rfm/mysql-rfm-snapshot-reader.ts` |
| Snapshot run log / lock repository | `src/infrastructure/rfm/mysql-rfm-snapshot-run-repository.ts` (`SELECT GET_LOCK(...)`, confirmed at line 61) |
| Scheduler CLI entrypoint | `scripts/snapshots/rfm-snapshot-scheduled.ts` → `runRfmSnapshotCommand(..., { triggerSource: 'scheduled' })` |
| Manual CLI entrypoint | `scripts/snapshots/rfm-snapshot.ts` |
| Migrations | `migrations/001` through `migrations/004`, each with a `.rollback.sql` |
| CRM existence reader used by RFM | `masterCustomerReader.findById(masterCustomerId)`, `src/application/customer-rfm/get-customer-rfm.ts:32` |
| Docs T11B–T11H | present under `docs/releases/` |
| Tests | included in the 104-file / 800-test suite above |

**Exact npm scripts available for Gate 2** (read from `package.json`, not assumed):

```json
"snapshot:rfm": "tsx scripts/snapshots/rfm-snapshot.ts",
"snapshot:rfm:scheduled": "tsx scripts/snapshots/rfm-snapshot-scheduled.ts",
"snapshot:rfm:window-comparison": "tsx scripts/snapshots/rfm-window-comparison.ts",
"snapshot:rfm:year-over-year": "tsx scripts/snapshots/rfm-year-over-year-comparison.ts",
"snapshot:rfm:source-drift": "tsx scripts/snapshots/rfm-source-drift.ts",
"snapshot:rfm:compare-source": "tsx scripts/snapshots/rfm-compare-source-artifacts.ts"
```

`snapshot:rfm` and `snapshot:rfm:scheduled` are the two Gate 2 needs; the `window-comparison`/`year-over-year`/`source-drift`/`compare-source` scripts are unrelated ad-hoc analysis tooling (pre-existing local work, not part of RFM's production path).

No RFM script was executed against any database in this task — this was a static/read-only check of presence and wiring only, per the explicit "no ejecutar RFM contra DB real todavía" restriction.

## 11. Unrelated local work — preserved, not touched

Confirmed still present and untouched, exactly as reported in the audit:

- `.gitignore`, `package.json` — modified (adds `snapshot:rfm:window-comparison` / `snapshot:rfm:year-over-year` scripts and their `.gitignore` rules).
- `scripts/snapshots/rfm-window-comparison.ts`, `scripts/snapshots/rfm-year-over-year-comparison.ts` — untracked, ad-hoc analysis scripts.
- `scripts/snapshots/rfm/window-comparison-outputs/`, `scripts/snapshots/rfm/year-over-year-outputs/` — untracked output directories.
- `docs/audits/CP-R1-T12B-technical-debt-readiness-audit.md` — untracked, the audit itself.

**One real conflict occurred and was resolved, not discarded**: `git pull --ff-only` aborted cleanly on its first attempt (`error: Your local changes to the following files would be overwritten by merge: package.json` — no data lost, git's own safety check). Both the incoming commit and the local uncommitted change inserted a new `npm run` script at the same anchor line in `package.json`. Resolved via `git stash push -u` → `git pull --ff-only` (succeeded) → `git stash pop` (surfaced the expected conflict marker in `package.json` only) → manually kept both lines (`snapshot:rfm:scheduled` from upstream, `snapshot:rfm:window-comparison` + `snapshot:rfm:year-over-year` from local) → `git add package.json` → `git stash drop`. No `git reset --hard`, no `git clean -fd`, nothing discarded. `.gitignore` merged automatically with no conflict.

No destructive git command was used at any point in this task.

## 12. Deliberately not addressed (per explicit Gate 1 scope)

TD-003 (RFM identity unification), TD-004 (production scheduler), TD-005 (CRM-Customer-360 flags), TD-006 (RFM 500→503), TD-007 (RFM config schema consolidation), TD-008 (RFM execution against real DB), TD-010 (legacy adapter deletion), TD-011 (PII over-fetch), TD-012 (freshness alerting). None of these were touched, in `MS-pesaschile-customer-profile` or `CRM-Customer-360`. `CRM-Customer-360` was not opened or modified in this task.

## 13. Gate 2 readiness

**READY.** Gate 1's own Definition of Done is met (see final report block in the task response). Gate 2's exact next action, per the audit's own sequencing: validate the full RFM `migrations → snapshot(building→validated→published) → runtime-read` path against real infrastructure, using `npm run snapshot:rfm` (manual) as the entrypoint, not `snapshot:rfm:scheduled` (that's Gate 3).
