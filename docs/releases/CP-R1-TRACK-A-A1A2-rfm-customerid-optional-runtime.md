# CP-R1 Track A — A1/A2: RFM customerId Contract + Optional Runtime Configuration

Date: 2026-08-17
Scope: `MS-pesaschile-customer-profile` only. `CRM-Customer-360` was not touched.
Builds on: `docs/audits/CP-R1-T12B-technical-debt-readiness-audit.md`, `docs/audits/CP-R1-RFM-data-ownership-crm-architecture-audit.md`, `docs/releases/CP-R1-T12D-gate1-readiness-regression-fix.md`, `docs/releases/CP-R1-T12D-gate2-rfm-real-infrastructure-validation.md`.

---

## 1. Architecture before this change

- RFM was exposed exclusively at `GET /v1/customers/:masterCustomerId/rfm`, keyed by CRM's `master_customer.id` — format-indistinguishable from the five PrestaShop-direct endpoints' `customerId`, despite being a different identity space.
- `src/config.ts` required `RFM_SNAPSHOT_DB_HOST/USER/PASSWORD/NAME` unconditionally at the top-level server schema. In an environment without those variables, the **entire** HTTP process failed to boot — including the five endpoints and `/health`/`/health/ready`, which have no RFM dependency at all (confirmed directly, `CP-R1-T12D` Gate 2).
- `getCurrentPrestashopCustomerRfm(prestashopCustomerId)` already existed end-to-end (application layer + infrastructure reader), fully unit-tested, but was never wired to any HTTP route — the read capability this task needed already existed; it was simply unexposed.
- RFM infra failures (RFM DB down) fell through to a generic `500 internal_error`, unlike the other five endpoints, which map the same failure class to `503 degraded`.

## 2. Architecture after this change

- RFM is now exposed at two, non-ambiguous paths:
  - **`GET /v1/customers/:customerId/rfm`** — PRIMARY. `customerId = ps_customer.id_customer`, identical identity contract to the other five endpoints. Reuses the existing `getCurrentPrestashopCustomerRfm`/`getCurrentPrestashopCustomerRfmLookup` reader path. Never queries CRM.
  - **`GET /v1/master-customers/:masterCustomerId/rfm`** — LEGACY/SECONDARY. Same behavior as before, moved off the `/v1/customers/...` prefix so it can never be confused with the primary path by shape alone (both accept format-identical positive numeric strings).
- `RFM_SNAPSHOT_DB_*` is now an optional, all-or-nothing capability in `src/config.ts`. Absent entirely → server boots, `rfmSnapshotDb: null`. Fully present → server boots with RFM wired. Partially present → fails fast at startup (same fail-fast philosophy the rest of `config.ts` already uses for credentials).
- `bootstrap.ts` never creates an RFM pool or attempts a connection when `config.rfmSnapshotDb` is `null` — both `getCustomerRfm` and `getCustomerRfmByCustomerId` fall back to a constant `503 { status: 'degraded', reason: 'rfm_not_configured' }` response with zero I/O.
- RFM DB infrastructure failures (on the primary path) now map to `503 { status: 'degraded', reason: 'rfm_unavailable' }` instead of a generic `500`, closing part of the pre-existing 500-vs-503 asymmetry (TD-006) — for the new path only; the legacy path's error mapping was deliberately left untouched (see §6).

## 3. New HTTP contract

`GET /v1/customers/:customerId/rfm`

| Case | HTTP | `status` | `reason` |
|---|---|---|---|
| Snapshot published, customer has a row | 200 | `available` | — |
| Snapshot published, no row, PrestaShop has the customer | 404 | `rfm_not_available` | `no_current_rfm_record` |
| Snapshot published, no row, PrestaShop does not have the customer | 404 | `customer_not_found` | — |
| No snapshot ever published | 503 | `degraded` | `no_published_rfm_snapshot` |
| RFM DB not configured | 503 | `degraded` | `rfm_not_configured` |
| RFM DB configured but unreachable/timed out/schema-incompatible | 503 | `degraded` | `rfm_unavailable` |
| Invalid `customerId`, unsupported query params or body | 400 | — | — |
| Unexpected error | 500 | — | — |

Response body shape is identical to the legacy contract (`snapshot`/`rfm`/`segment`/`contractVersion`), with `customerId: number` replacing `masterCustomerId: string` as the identity field. No `masterCustomerId` is echoed back — kept minimal, matching the other five endpoints' convention of not leaking internal foreign ids.

## 4. Legacy contract, preserved

`GET /v1/master-customers/:masterCustomerId/rfm` — byte-identical behavior to the prior `GET /v1/customers/:masterCustomerId/rfm`, only the path prefix changed. `RFM_SNAPSHOT_DB_*` unconfigured now also yields `503 { status: 'degraded', reason: 'rfm_not_configured' }` here (previously this state simply couldn't occur, because the server couldn't boot at all without full RFM config). Everything else — the `masterCustomerId`-keyed lookup, the CRM not-found disambiguation, the `500` fallback for infra errors — is unchanged.

**MOVED, not duplicated.** Old path: `/v1/customers/:masterCustomerId/rfm`. New legacy path: `/v1/master-customers/:masterCustomerId/rfm`. This is a breaking change to the old path — acceptable now because CRM-Customer-360's only caller of this endpoint is gated behind `CUSTOMER_PROFILE_ENABLED`/`CUSTOMER_PROFILE_CONTEXT_ENABLED`, both `false` and unset in production (confirmed in the architecture audit, §9). CRM-Customer-360 was not modified in this task; its client still points at the old path and must be updated in a follow-up gate before either RFM path is activated there.

## 5. Primary/secondary identity separation

```
customerId path  (/v1/customers/:customerId/rfm)
  -> PRIMARY
  -> ps_customer.id_customer
  -> CRM-independent (no master_customer read anywhere in this path)

masterCustomerId path  (/v1/master-customers/:masterCustomerId/rfm)
  -> LEGACY / SECONDARY
  -> master_customer.id
  -> unchanged CRM dependency on the not-found branch
```

Kept as two structurally distinct path prefixes rather than one path inferring the ID space, per the audit's explicit non-ambiguity requirement (§18 of the architecture audit): both identity spaces are format-identical positive numeric strings, so a single shared path could silently return one customer's RFM data for a different customer's id.

## 6. CRM dependency removed from the primary path

`get-customer-rfm-by-customer-id.ts`'s dependency type is `{ resolveCustomerIdentity, currentRfmSnapshotReader }` — no CRM reader, no CRM pool, structurally. Existence checks for `customer_not_found` reuse `resolveCustomerIdentity`, the exact same PrestaShop-backed identity check the other five endpoints already use — no new query logic was written for this.

Deliberately **not** touched: the legacy `masterCustomerId` path's not-found branch still reads CRM (`masterCustomerReader.findById`), and its infra-failure mapping still falls through to a generic `500`. Both are pre-existing, known, separately-tracked debt (identity-split coupling and the 500-vs-503 asymmetry) — fixing them for the legacy path was out of this task's scope and would have reopened a decision the audit already made deliberately (§13/§18: the coupling is removed by adopting the primary path, not by patching the legacy one).

## 7. Behavior without RFM configuration

```
RFM_SNAPSHOT_DB_* entirely absent
  -> config.ts: rfmSnapshotDb = null (no error)
  -> bootstrap.ts: no pool created, no connection attempted
  -> HTTP server boots normally
  -> /profile, /commercial-summary, /purchased-products, /purchase-behavior,
     /orders/:reference/status, /health, /health/ready — all work exactly as before
  -> /v1/customers/:customerId/rfm            -> 503 degraded rfm_not_configured
  -> /v1/master-customers/:masterCustomerId/rfm -> 503 degraded rfm_not_configured
```

## 8. Behavior with partial configuration

Any subset of `RFM_SNAPSHOT_DB_HOST/USER/PASSWORD/NAME` set without all four present fails `config.ts`'s `envSchema` parse at process startup, the same fail-fast pattern already used for every other required credential in this file — never a silent partial boot. `RFM_SNAPSHOT_DB_PORT/CONNECTION_LIMIT/QUERY_TIMEOUT_MS` keep their existing defaults regardless (they're meaningless when unconfigured, harmless either way).

## 9. CLI configuration — unchanged

`src/rfm-snapshot-config.ts` (used by `npm run snapshot:rfm[:scheduled]`) was **not modified**. It already required full RFM snapshot DB configuration outside dry-run mode, and continues to. `RFM_CALCULATION_VERSION` is not part of `src/config.ts` at all (confirmed — only the CLI's own schema uses it), so it was never part of this task's optionality scope. The pre-existing dual-schema drift between `config.ts` and `rfm-snapshot-config.ts` (TD-007) is unchanged; a larger consolidation was judged out of scope for this task per its own explicit instruction not to widen it into a big refactor.

## 10. Tests

New files:
- `tests/unit/config.test.ts` — no RFM vars → `rfmSnapshotDb: null`; all four vars → fully populated config; each of the four vars set alone → fails fast with a message naming the missing field.
- `tests/unit/get-customer-rfm-by-customer-id.test.ts` — available, available-with-null-segment, `no_published_rfm_snapshot` (without ever calling `resolveCustomerIdentity`), `customer_not_found`, `rfm_not_available`, `rfm_unavailable` for each of the three RFM error types, unrecognized-error passthrough (for the route's generic 500), and a CRM-independence check (structural: no CRM import in the file at all; runtime: `getCurrentMasterCustomerRfm*` never called).
- `tests/unit/bootstrap-rfm-config.test.ts` — RFM unconfigured never creates a pool/reader and both use cases return `rfm_not_configured` with zero I/O; shutdown is clean with no RFM pool; RFM configured wires a real reader against the configured pool (verified by reaching into a controllable fake reader, not the constant fallback).
- `tests/integration/customer-rfm-by-customer-id-route.test.ts` — full HTTP-level contract coverage for the new primary route (all six status/reason combinations, 400s, 500, auth-is-a-no-op, safe logging, and confirms the legacy path's use case is never invoked).

Modified:
- `tests/integration/customer-rfm-route.test.ts` — all URLs moved from `/v1/customers/...` to `/v1/master-customers/...`; behavior assertions unchanged.
- `tests/unit/mysql-rfm-snapshot-reader.test.ts` — new `getCurrentPrestashopCustomerRfmLookup` coverage (mirrors the existing master-customer lookup tests) + two tests proving RFM DB driver errors are wrapped into `RfmUnavailableError`.
- `tests/unit/classify-error-for-log.test.ts` — three new cases for the RFM error types.
- Five other integration route test files (`customer-profile-route`, `customer-commercial-summary-route`, `customer-order-status-route`, `customer-purchase-behavior-route`, `customer-purchased-products-route`) and two other unit test files (`get-current-prestashop-customer-rfm.test.ts`, `get-current-rfm-snapshot.test.ts`, `get-customer-rfm.test.ts`) — mechanical updates only, adding the new `getCustomerRfmByCustomerId`/`getCurrentPrestashopCustomerRfmLookup` fields to existing fakes/`RouteDependencies` object literals so they keep satisfying their (now-larger) interfaces. No behavioral changes.

## 11. Deliberately out of scope

- Provisioning the RFM Snapshot DB, applying real RFM migrations, or configuring a scheduler.
- Any change to `CRM-Customer-360` (its client still targets the pre-move path; a follow-up gate must update it before either RFM path is activated there).
- Flipping `CUSTOMER_PROFILE_ENABLED`/`CUSTOMER_PROFILE_CONTEXT_ENABLED`.
- Modifying `master_customer` or applying migration 001.
- Fixing the legacy `masterCustomerId` path's CRM not-found dependency or its 500-vs-503 asymmetry (tracked, deliberately not reopened here — see §6).
- Consolidating `config.ts`/`rfm-snapshot-config.ts`'s dual RFM schema (TD-007) — the CLI's own validation was left untouched per this task's explicit instruction not to widen scope into a larger refactor.
- Any `/health/ready` contract change — it never included an `rfm` field before this task and still doesn't; RFM's own degradation is fully expressed by `/rfm` and `/v1/master-customers/.../rfm` themselves, so there's nothing to add there without inventing a new, undocumented readiness dimension.

## 12. Next gate

**Track A — A3**: provision the RFM Snapshot DB (recommended location: a dedicated schema on the existing PrestaShop RDS instance, per the architecture audit §11) and validate the real `migration → snapshot(building→validated→published) → runtime-read` path against it, using the now-primary `customerId` route as the runtime-read target — this no longer requires CRM population as a co-requirement, since the primary path never reads CRM.
