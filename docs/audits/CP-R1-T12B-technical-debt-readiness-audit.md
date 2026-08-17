# CP-R1-T12B — Technical Debt & Readiness Audit

Date: 2026-08-17
Scope: read-only, cross-repo (`MS-pesaschile-customer-profile`, `CRM-Customer-360`, secondary check in `MS-Stock/services`)
Restrictions honored: no code changes, no migrations created, no `.env` changes, no commits, no push, no PRs.

> Correction note: an earlier draft of this brief referenced "T23/T23A/T23B". The correct, evidence-backed task line is **T12 / T12A / T12B**. This document uses T12B throughout.

---

## 1. Executive Verdict

**`READY_FOR_T12B_WITH_KNOWN_DEBT`** — with a redefinition of what "T12B" actually means today. See §14 for full justification; short version:

- **T12B, as originally scoped ("Sales Agent Customer Profile HTTP Client"), already exists.** It was built and merged into `CRM-Customer-360` on 2026-08-05 (`lib/integrations/customer-profile/*`), is wired into the live commercial agent-loop call path (traced call-by-call, not just file presence), and passes its test suite (91/91 on independent re-run). This is not inferred from docs alone — it was verified directly in code.
- **It is currently inert in production**, not because it's unfinished, but because two independent feature flags default to `false` and neither is set in `CRM-Customer-360`'s actual `.env`: `CUSTOMER_PROFILE_ENABLED` and `CUSTOMER_PROFILE_CONTEXT_ENABLED`. The Sales Agent gets zero Customer Profile context today.
- **One P0/BLOCKER exists in Customer Profile itself**, independent of T12B: `GET /health/ready`'s `crm` field is wired to a second PrestaShop ping, not a real CRM probe (`src/bootstrap.ts:134-140`) — on every branch, on both the current local HEAD and the unpulled `origin/main`. This makes the readiness signal worthless exactly where RFM (T11H, layered on top of T12B/T12C) genuinely needs it.
- **Local `main` is two commits behind `origin/main`** (fast-forwardable, no conflict) — the entire RFM HTTP runtime (T11B–T11H) exists only on `origin/main` today. Any planning that treats RFM as "not yet in this repo" or "already in this repo" needs to first resolve which of those two states is being discussed.
- If "continue with T12B" means *build the client* — there is nothing left to build; the open work is activation, not development.
- If "continue with T12B" means *turn it on in production* — that is possible today only after fixing the P0 readiness bug and standing up the still-missing external scheduler (§13), because T11H's RFM path (which shares T12B/T12C's flags) depends on both.
- If "T12B" in your current task queue refers to something else entirely — **no evidence for a third definition was found in either repo.** Do not proceed assuming one; confirm scope before continuing.

---

## 2. Git / Repository State

### Customer Profile (`c:\Users\Goli\Pesas Chile\MS\MS-pesaschile-customer-profile`)

- Branch: `main`. `git status`: clean except previously-reviewed pending work — modified `.gitignore`/`package.json`, untracked `scripts/snapshots/rfm-window-comparison.ts`, `scripts/snapshots/rfm-year-over-year-comparison.ts` and their `*-outputs/` dirs (ad-hoc analysis scripts, typecheck/lint clean, not yet committed — separate decision from this audit).
- Local HEAD: `7f2d4f5` ("Merge pull request #13 ... feat(identity): accept direct prestashop customer input" — T12A).
- `origin/main` HEAD: `638c6a5`, two commits ahead, **fast-forwardable, no conflicts**:
  - `e76a799` — "feat(customer-rfm): complete post-RFM runtime and operations" (2026-08-14) — the entire RFM HTTP runtime, scheduler CLI, migrations 003/004, docs T11B–T11G.
  - `638c6a5` — "docs(customer-rfm): close T11 with cross-repo T11H reference" (2026-08-15) — pointer doc to CRM-side T11H work.
  - `git diff HEAD..origin/main --stat`: 61 files, +5919/-138, entirely RFM-scoped, nothing touching T12A's identity work.
- **RFM code, config, tests, and docs do not exist anywhere in the local working tree or local git history** — every RFM finding in this report from the Customer Profile side is sourced from `origin/main` via `git show`/`git diff` (never checked out) and is labeled `ORIGIN/MAIN PENDING` throughout.
- 11 local feature/audit branches, all already merged into history (`feat/cp-r1-t12a-...`, `audit/cp-r1-t11a4-...`, etc.) — no open/unmerged branch found for RFM or T12B work in this repo.

### CRM-Customer-360 (`C:\Users\Goli\Pesas Chile\CRM-Customer-360`)

- Checked-out branch: **`develop`**, HEAD `a6a8874` ("Merge pull request #95 ... sales-agent-r1-t3-create-quote-wiring"), clean, up to date with `origin/develop`.
- `develop` is 241 commits ahead of `origin/main` and 1 behind `origin/develop` — **`main` is stale relative to the real work.** All Customer Profile integration work (T12B, T12C, T11H) lives on `develop` and is only reachable from there (`git branch --all --contains 628f6e2` → `develop`/`origin/develop` only).
- **This is very likely the root cause of the T12A doc's internal contradiction** (§9): whoever wrote the "Next Task" line was almost certainly looking at `main` or an earlier snapshot, before the `develop`-only commits landed.
- Commits `628f6e2` (T11H adapter, 2026-08-14) and `59a74e2` (T11H.1 suite stabilization, 2026-08-14) confirmed as real ancestors of current HEAD (`git merge-base --is-ancestor` → true for both). PR #93 confirmed **merged** via `gh pr view 93`.

---

## 3. Current Architecture (as verified, not as assumed)

```
Customer Profile (this repo)
├── LOCAL HEAD (pulled): 5 endpoints, single identity model
│    GET /v1/customers/:customerId/{profile,commercial-summary,
│         purchased-products,purchase-behavior,orders/:ref/status}
│    → customerId = ps_customer.id_customer, direct PrestaShop read
│    → CRM (master_customer) not queried anywhere in this path
│
└── ORIGIN/MAIN (unpulled, 2 commits ahead): adds RFM runtime
     GET /v1/customers/:masterCustomerId/rfm
     → masterCustomerId = master_customer.id (CRM-space identity)
     → snapshot-row lookup denormalized at build time (no live CRM join
       on the "found" path) but a genuine live CRM query on the
       "not found" path (to distinguish customer-doesn't-exist from
       rfm-not-yet-calculated)
     → snapshot generation: external CLI only (npm run snapshot:rfm[:scheduled]),
       no in-process scheduler, no confirmed external scheduler either

CRM-Customer-360 (develop branch)
├── lib/customer-profile/httpCustomerProfileAdapter.ts   [DEAD — T10B1, masterCustomerId, zero call sites]
└── lib/integrations/customer-profile/*                  [LIVE CODE PATH — T12B/T12C, extended by T11H]
     ├── http-client.ts: customerId-based calls for profile/commercial-summary/
     │    purchased-products/purchase-behavior/order-status;
     │    masterCustomerId-based getRfm() (T11H addition)
     ├── customer-profile-context/loader.ts: parallel fetch + policy-gated extras
     └── agent-loop/runNativeAgentToolLoopCycle.ts: calls the loader every turn,
          unconditionally — GATED ONLY by two feature flags, both false today:
             CUSTOMER_PROFILE_ENABLED=false        (client-level; unset in .env)
             CUSTOMER_PROFILE_CONTEXT_ENABLED=false (loader-level; unset in .env)
```

---

## 4. Canonical Identity Audit

### Endpoint identity matrix

| Endpoint | Identity | Internal lookup | CRM dependency | State |
|---|---|---|---|---|
| `GET /v1/customers/:customerId/profile` | `customerId` | `ps_customer.id_customer` direct | No | LOCAL HEAD |
| `GET /v1/customers/:customerId/commercial-summary` | `customerId` | `ps_customer.id_customer` direct | No | LOCAL HEAD |
| `GET /v1/customers/:customerId/purchased-products` | `customerId` | `ps_customer.id_customer` direct | No | LOCAL HEAD |
| `GET /v1/customers/:customerId/purchase-behavior` | `customerId` | `ps_customer.id_customer` direct | No | LOCAL HEAD |
| `GET /v1/customers/:customerId/orders/:reference/status` | `customerId` + `reference` | `ps_customer.id_customer` direct | No | LOCAL HEAD |
| `GET /health`, `GET /health/ready` | n/a | n/a | Mislabeled — see BLOCKER below | LOCAL HEAD |
| `GET /v1/customers/:masterCustomerId/rfm` | `masterCustomerId` | denormalized snapshot row (found path); **live CRM read** (not-found path) | **Yes** | ORIGIN/MAIN PENDING |

Evidence: `src/http/routes/index.ts:92-280` (local); `origin/main:src/http/routes/index.ts:247`, `origin/main:src/application/customer-rfm/get-customer-rfm.ts:14-39`, `origin/main:src/infrastructure/crm/mysql-master-customer-reader.ts:40-46`.

### A. Does Customer Profile expose more than one public identity model?

- **LOCAL HEAD: No** — single model (`customerId`).
- **ORIGIN/MAIN (once pulled): Yes.** Explicitly self-acknowledged as a "deliberate exception" in `origin/main:docs/releases/CP-R1-T11F-rfm-runtime-exposure.md:47-49` and its "Limitaciones" section (`T11F.md:339-347`).
- **Classification: HIGH.** Two structurally identical positive-numeric-string ID spaces (`customerId` vs `masterCustomerId`) are format-indistinguishable, exactly as T12A's own doc warns for its five routes (`CP-R1-T12A...md:230-238`). A caller hitting `/rfm` with a `ps_customer.id_customer` value gets `customer_not_found` or, on collision, **a different customer's RFM data** — never a distinguishable error.

### B. Does RFM depend on `master_customer` at runtime?

**Yes, confirmed in code**, not just docs — `origin/main:src/application/customer-rfm/get-customer-rfm.ts:31-39` makes a live `masterCustomerReader.findById()` call (`origin/main:src/infrastructure/crm/mysql-master-customer-reader.ts:40-46`, a real `SELECT ... FROM master_customer WHERE id = ?`) whenever the snapshot-row lookup misses, specifically to distinguish "customer doesn't exist in CRM" from "customer exists but has no RFM row."

### C. Can RFM resolve entirely via `ps_customer.id_customer → prestashop_customer_id → customer_rfm_snapshot_row` without CRM?

**No.** The public parameter is `masterCustomerId`, not `customerId` — the premise doesn't hold for the endpoint's public contract at all. And even on the internal "found" path, `master_customer_id` was denormalized into the row at *snapshot-build* time by a resolver that itself reads CRM (`origin/main:src/infrastructure/crm/mysql-rfm-canonical-identity-resolver.ts`). The "not found" branch makes a live CRM call (finding B).

### D. Is `master_customer_id` still a functional key, or only traceability?

**Functional**, on `origin/main` — it's the literal `WHERE` predicate for `/rfm` lookups and the live-CRM disambiguation key. On LOCAL HEAD, it plays no functional role anywhere (per T12A's own "CRM Dependencies Removed" list, `CP-R1-T12A...md:126-133`).

### E. Circular dependency Customer Profile → CRM → Customer Profile?

No evidence of a cycle within Customer Profile's own codebase — CRM is a pure upstream read here. (Whether CRM-Customer-360 calls back into Customer Profile is the other direction of the graph, covered in §8 — it does, and that's the T12B/T11H wiring itself, not a cycle back into CRM.)

### Additional finding — readiness `crm` field is mislabeled (BLOCKER, not in original lead list)

`src/bootstrap.ts:134-140` (present unchanged on **both** LOCAL HEAD and ORIGIN/MAIN):

```ts
const checkReadiness: ReadinessCheck = async () => {
  const [prestashop, crm] = await Promise.all([
    checkPrestashopReadiness(config.prestashopDb.prefix),
    pingPrestashop().catch(() => false),   // <-- this is CRM's slot, but it pings PrestaShop again
  ]);
  return { prestashop, crm };
};
```

The `crm` field is populated by a **second PrestaShop ping** (`src/infrastructure/prestashop/prestashop-pool.ts:36-43`), not by `checkCrmReadiness()` (`src/infrastructure/crm/crm-pool.ts:53-60`), which exists, is exported, and does a real `SELECT prestashop_customer_id FROM master_customer LIMIT 0`. Confirmed by diffing against the pre-T12A version (`git show 841e8aa:src/bootstrap.ts:119-122`, which correctly called `checkCrmReadiness()`) — this is a **regression introduced during T12A's refactor**, not a pre-existing gap.

**Impact**: on `origin/main`, `/rfm` has a real, functional CRM dependency (finding B) — but `/health/ready`'s `crm: true/false` gives **zero real signal** about whether that dependency is healthy. **No test covers `bootstrap.ts`'s `checkReadiness` at all** — every route test stubs it out entirely. This bug would not be caught by the current suite.

**Classification: BLOCKER.**

---

## 5. RFM Audit (ORIGIN/MAIN only — does not exist on LOCAL HEAD)

### Pipeline (traced end to end in code)

```
scripts/snapshots/rfm-snapshot[-scheduled].ts
  → scripts/snapshots/lib/rfm-snapshot-command.ts:24-131
  → src/application/customer-rfm/run-rfm-snapshot-operation.ts:53-224
  → src/application/customer-rfm/create-rfm-snapshot.ts:75-179  (source read + dataset build + checksum)
  → src/infrastructure/rfm/mysql-rfm-snapshot-repository.ts:63-101  (transactional publish)
  → src/infrastructure/rfm/mysql-rfm-snapshot-reader.ts:117-165  (runtime read)
  → src/application/customer-rfm/get-customer-rfm.ts:18-76
  → src/http/routes/index.ts:247-280
```

### Schema

- `customer_rfm_snapshot`: `status ENUM('building','validated','published','failed','superseded')`, unique `snapshot_key`, `dataset_checksum CHAR(64)`, `DATETIME(6)` timestamps, `population_size`, `manifest_json`, `currency_code`; four indexes including a composite covering every policy-version dimension.
- `customer_rfm_snapshot_row`: FK `snapshot_id → customer_rfm_snapshot(id) ON DELETE CASCADE`, `UNIQUE (snapshot_id, prestashop_customer_id)`, `CHECK` constraints on the three RFM scores (1–5). `master_customer_id BIGINT UNSIGNED NULL`, **deliberately no FK** to `master_customer` (migration comment: "Additive only. No FK to master_customer: T11A uses provisional PrestaShop identity.").
- Migrations 003 (additive columns + index) and 004 (additive table with `ON DELETE SET NULL` FK) both have symmetric rollback files, no destructive default.

### Transactional / fail-closed / idempotent / reproducible — **YES, verified in code**

Single transaction in `mysql-rfm-snapshot-repository.ts:63-101`: insert as `building` → insert rows → verify row count → re-read rows `FOR UPDATE` and re-hash, throw on checksum mismatch → persist manifest (conditional on `status='building'`) → supersede previous published snapshot → `markValidated` (conditional) → `markPublished` (conditional) → commit; any failure at any of 9 explicit test-hook stages rolls back completely. Same `snapshotKey` + same checksum → `skipped_existing` (idempotent, no republish). Same key + different checksum → throws `RfmSnapshotKeyConflictError`, **never silently overwrites**.

**No code path found that allows an invalid/incomplete snapshot to reach `published`.**

### Runtime behavior by scenario

| Scenario | HTTP status | Body |
|---|---|---|
| Published snapshot, row exists | 200 | `status: 'available'` + payload |
| Published snapshot, no row, `master_customer` exists | 404 | `status: 'rfm_not_available'` |
| Published snapshot, no row, `master_customer` missing | 404 | `status: 'customer_not_found'` |
| No snapshot ever published | 503 | `status: 'degraded', reason: 'no_published_rfm_snapshot'` |
| Snapshot in `building`/`validated` | same as "no snapshot" (query filters `WHERE status='published'`) | — |
| Snapshot/row data corrupt (fails a parse guard) | 500 | `{error:'internal_error'}` |
| RFM DB or CRM (not-found branch) unreachable | **500** | `{error:'internal_error'}` — **not** 503 |

**Inconsistency (MEDIUM, documented not hidden)**: the five `customerId` endpoints map upstream-down to `503 degraded`. `/rfm`'s upstream-down case falls through to the generic `500`, indistinguishable from an actual bug — a documented design choice (`T11F.md:199-217`), but a real asymmetry between the two identity families' error taxonomies.

### "No real production DB validation was possible" — confirmed verbatim

`T11G.md:324-335`:
```
npm run snapshot:rfm with synthetic localhost DB envs ->
  failed cleanly at external infrastructure: {"errorCode":"PrestashopUnavailableError",...}
npm run snapshot:rfm:scheduled with synthetic localhost DB envs ->
  failed cleanly: {"errorCode":"ECONNREFUSED",...}
No real production DB validation was possible in this environment.
```

---

## 6. Scheduler Audit (ORIGIN/MAIN)

| Question | Answer | Classification |
|---|---|---|
| A. In-service scheduler exists? | **No** — no timer/interval anywhere in `src/index.ts`/`src/bootstrap.ts`; explicitly a deliberate choice (`T11G.md:116-120`: *"no in-process timer... no scheduler state inside HTTP readiness... no platform-specific cron expression baked into repo config"*) | FALTANTE (by design) |
| B. External scheduler configured in repo/infra config? | **No evidence found anywhere** — zero Dockerfile, CI/CD yaml, cron config, PM2/ecosystem file, or k8s manifest in the entire repo (`git ls-tree -r origin/main` search returned nothing). Self-documented open item (`T11G.md:339-341, 373-374`) | NO VERIFICABLE DESDE EL REPO |
| C. What happens if nobody runs it for 30 days? | No enforcement. `/health/ready` is explicitly not wired to snapshot freshness (`T11G.md:264-273`). No staleness cutoff on the read side either — a 30-day-old published snapshot still serves as `available` | FALTANTE |
| D. Protection against concurrent runs from two instances? | **Yes** — `SELECT GET_LOCK('customer_rfm_snapshot_execution_v1', 0)`, non-blocking, released in `finally`; losing worker records a `skipped` run rather than doing nothing silently | IMPLEMENTADO EN CÓDIGO |
| E. Observability for stuck/failed snapshots? | Partial — `customer_rfm_snapshot_run` table has real queryable history, but no dedicated monitoring endpoint and no auto-cleanup/auto-fail of abandoned `building`/`validated` rows from a crashed process | IMPLEMENTADO EN CÓDIGO (raw data) / FALTANTE (alerting layer) |

**Bottom line**: the worker is production-quality; nothing outside this repo has been confirmed to actually call it on a schedule.

---

## 7. Configuration / Environment Audit

Compared `src/config.ts`, `src/rfm-snapshot-config.ts` (origin/main only), `.env.example` (byte-identical on both trees), against real code usage.

| Variable family | Code uses it | Required | `.env.example` | Problem |
|---|---|---|---|---|
| `PRESTASHOP_DB_*`, `CRM_DB_*` (base) | Yes | Host/user/password required | Yes | — |
| `RFM_SNAPSHOT_DB_HOST/USER/PASSWORD/NAME` | Yes — **twice**, by two independent Zod schemas (`src/config.ts:78-83` for the HTTP process, `rfm-snapshot-config.ts:30-38` for the CLI) | Yes (non-dry-run) | **No — absent from `.env.example` on both trees** | used-but-undocumented, **dual-schema drift risk** |
| `RFM_SNAPSHOT_DB_PORT/CONNECTION_LIMIT/QUERY_TIMEOUT_MS` | Yes | No (defaults) | No | used-but-undocumented |
| `RFM_CALCULATION_VERSION` | Yes | Yes | No | used-but-undocumented |
| `RFM_DRY_RUN`, `RFM_REFERENCE_TIME` | Yes (CLI only) | Varies | No | used-but-undocumented |

**Dual-schema finding (MEDIUM)**: `origin/main:src/config.ts` independently re-validates the same `RFM_SNAPSHOT_DB_*` variable family that `rfm-snapshot-config.ts` already validates for the CLI, with different optionality rules between the two. A default added to one schema and not the other is a live drift risk.

**No silent fallbacks / dangerous defaults found** — the codebase enforces "no silent defaults for credentials or operationally-ambiguous IDs" consistently (`config.ts:7-8` and consistently applied).

---

## 8. CRM / Sales Agent Integration Audit

### 8.1 `lib/integrations/customer-profile/*` — real, read in full

Files: `index.ts`, `types.ts` (445 lines), `schemas.ts`, `http-client.ts` (684 lines).

**Identity split, by design, matching Customer Profile's actual contract**:
- `getProfile`, `getCommercialSummary`, `getPurchasedProducts`, `getPurchaseBehavior`, `getOrderStatus` → numeric **`customerId`** (`http-client.ts:508-578`).
- `getRfm` → string **`masterCustomerId`** (T11H addition, `http-client.ts:580-595`).

A real defensive HTTP client: `AbortController` timeout (default 3000ms, capped 30000ms), discriminated-union results (`AVAILABLE/NOT_FOUND/INVALID_REQUEST/UNAVAILABLE/CONTRACT_ERROR`), redacted error logging, structured observability events.

### 8.2 Live wiring — traced call-by-call

1. `http-client.ts` → `getSharedCustomerProfileClient()` singleton.
2. `lib/brain/commercial/capabilities/customer-profile/customerProfileCapabilities.ts:30-32` → thin passthrough wrapper (no gateway/registry indirection for this integration, unlike catalog).
3. `lib/brain/commercial/customer-profile-context/loader.ts` (405 lines) → `loadCustomerCommercialHistoryContext(...)` calls `getCommercialSummary` + `getRfm` in parallel, conditionally the rest, per policy.
4. `lib/brain/commercial/agent-loop/runNativeAgentToolLoopCycle.ts:270-314` (`defaultLoadCustomerProfileContext`) — the **real production wiring**, not a test stub.
5. `runNativeAgentToolLoopCycle.ts:432-457` — the live exported turn-cycle function calls this **unconditionally every turn**, deriving `customerId`/`masterCustomerId` from `input.trustedCustomerSession`.
6. Identity source: `resolveMasterCustomerIdentity.ts`, called from `resolveNativeCustomerSession.ts` — a real identity-resolution service through the Capability Gateway's `resolve_customer`, not a stub.

**Confirmed genuinely wired into the live agent-loop path** by reading actual call sites, not by name-matching.

### 8.3 Guard test — exists, real, passes

`tests/commercial/customerProfileLegacyImportGuard.test.ts`: asserts (via source regex) that none of the 7 files in the customer-profile-context wiring import the legacy `lib/customer-profile` path. Independently re-run together with the full T11H/T12C-scoped subset:

```
91 pass / 0 fail
```

Matches the CRM-side doc's claimed 90/90 (+ the guard test itself).

### 8.4 Feature flags — both OFF, confirmed in actual `.env`, not just `.env.example`

| Flag | Default | Set in actual `.env`? | Gates |
|---|---|---|---|
| `CUSTOMER_PROFILE_ENABLED` | `false` | **No** | HTTP client itself — when false, `createDisabledCustomerProfileClient()` never calls `fetch` |
| `CUSTOMER_PROFILE_CONTEXT_ENABLED` | `false` | **No** | Context loader — short-circuits to `DISABLED` before any capability call, independent of the flag above |
| `CUSTOMER_HISTORY_COMMERCIAL_POLICY_ENABLED` | `false` | **No** | Third, independent flag for the signals/policy layer on top |
| `CUSTOMER_PROFILE_SERVICE_BASE_URL` | (empty) | No | Belongs to the **legacy, dead** T10B1 adapter — different variable name than the live client's `CUSTOMER_PROFILE_BASE_URL` |

**Doc-drift caught in `.env.example` itself**: the T12B comment (line ~143-146) says *"internal capability only, not wired to the model/agent loop yet"*, while the T12C comment two lines below (line ~151-153) says *"Runtime-only, selective loading, fail-open"* (i.e., wired). **This is the exact same stale-comment pattern that produced the T12A doc contradiction being investigated** — the T12B comment was never updated after T12C wired it in.

### 8.5 Old adapter — confirmed dead code

`lib/customer-profile/httpCustomerProfileAdapter.ts` (T10B1, `masterCustomerId`-based, last touched 2026-07-30): **zero real call sites** anywhere in the repo outside its own barrel and its own test. One other file references it, but only in a code comment citing it as a pattern source, not an import. The guard test (8.3) actively prevents its reintroduction. **Genuinely dead — cannot silently misinterpret a `customerId` value, because nothing calls it.**

### 8.6 Commits 628f6e2, 59a74e2, PR #93 — verified real

- `628f6e2` — "CP-R1-T11H add sales agent RFM consumption adapter", 2026-08-14, 22 files, +1411/-19. **Extends** `http-client.ts`/`loader.ts`/`types.ts`/`schemas.ts` (adds RFM) rather than recreating them — confirms T11H built **on top of** an already-existing T12B/T12C client.
- `59a74e2` — "test(customer-profile): stabilize full suite validation for T11H", 2026-08-14, test-fixture-only + doc, +313/-3.
- Both confirmed ancestors of current HEAD, only reachable from `develop`. PR #93 confirmed **merged** (`gh pr view 93`): body states `typecheck: PASS`, `lint: PASS`, `T11H subset: 90/90 PASS`, `full suite: 2629 pass / 524 fail`.

**"Preexisting suite debt" resolved**: the 524 full-suite failures are **entirely pre-existing integration tests requiring a local MariaDB/Docker the sandbox doesn't have** (620 `ECONNREFUSED` occurrences, keyword-audited to confirm none touch T11H's files). The *actual* T11H regressions were 2 stale golden prompt-length assertions, both fixed in `59a74e2`. Independently re-verified: 91/91 pass on the T11H/T12C-scoped subset. **Not a euphemism for hidden breakage.**

### 8.7 Full end-to-end classification

| Link | Classification | Evidence |
|---|---|---|
| Identity resolution → `trustedCustomerSession` | WIRED | Real `CustomerIdentityResolutionService` via Capability Gateway |
| Session → agent-loop cycle | WIRED | `runNativeAgentToolLoopCycle.ts:449-450`, every turn |
| Agent-loop → Customer Profile context loader | WIRED | Called unconditionally every cycle |
| Context loader → `lib/integrations/customer-profile` client | WIRED | Production capabilities, not a stub |
| **HTTP client → real network call** | **FLAG_DISABLED** | `CUSTOMER_PROFILE_ENABLED` false/unset — never calls `fetch` |
| **Context loader activation** | **FLAG_DISABLED** (independently) | `CUSTOMER_PROFILE_CONTEXT_ENABLED` false/unset — short-circuits before any capability call |
| `customerRfm`/history → prompt package | WIRED (code exists, fed only by the two disabled flags above) | `runNativeAgentToolLoopCycle.ts:479-498`, `buildAgentStepPromptPackage.ts` |
| Old `httpCustomerProfileAdapter.ts` (T10B1) | DEAD | Zero real call sites |
| Catalog-service `httpCustomerAffinityEvidenceProvider.ts` (secondary check) | FLAG_DISABLED | `CUSTOMER_AFFINITY_PROVIDER_MODE` defaults `'unavailable'` |

### 8.8 Bottom line for §8

**T12B and T12C are code-complete, tested, and structurally wired** into the live agent-loop path — this is not "implemented but not wired," it is genuinely **"wired but flag-disabled."** T12C's own verdict string makes this explicit: `COMMERCIAL_CONTEXT_VALIDATED_WITH_RUNTIME_FLAG_REQUIRED`, with a stated next step of shadow/controlled activation before flipping the flag in production. **T11H is separate, later work layered on top** (adds `getRfm`, reuses the same flags — so it inherits the same disabled-by-default state), not a duplicate.

---

## 9. HTTP Contract Audit

| Endpoint | Identity | 200 | 404 | 503 | 500 | Auth |
|---|---|---|---|---|---|---|
| `GET /health` | — | `{status:'ok'}` | — | — | — | none |
| `GET /health/ready` | — | ready payload | — | not-ready payload | — | none — **`crm` field mislabeled, see §4 BLOCKER** |
| `.../profile`, `.../commercial-summary`, `.../purchased-products`, `.../purchase-behavior` | `customerId` | available | `customer_not_found` | `degraded` | `internal_error` | none |
| `.../orders/:reference/status` | `customerId`+`reference` | available | `customer_not_found`\|`order_not_found` (both 404, distinguished only in body) | degraded | internal_error | none |
| `.../rfm` (origin/main) | `masterCustomerId` | available | `customer_not_found`\|`rfm_not_available` (both 404, body-distinguished — consistent with the pattern above) | `degraded` (only for `no_published_rfm_snapshot`) | **internal_error, including any DB-down case** | none |

**Real collapse found**: RFM's "dependency down" and "unexpected bug" both resolve to `500 internal_error` — the five `customerId` endpoints treat dependency-down as a distinct `503 degraded`. Documented design choice, but a genuine inconsistency (MEDIUM, see §5).

**No service-to-service auth anywhere** on any endpoint, old or new — explicitly out of scope for this repo, must live externally.

---

## 10. DB Dependency Audit

Three logical connections, three separate pools, all read-only against PrestaShop/CRM (RFM snapshot DB is the only one this service *writes* to, and only from CLI scripts, never the HTTP process).

| Pool | Runtime or batch | Mandatory for HTTP server | What breaks if down |
|---|---|---|---|
| PrestaShop | Runtime + batch | **Yes**, always | Five endpoints → 503 degraded; `/health/ready` → not_ready |
| CRM | LOCAL HEAD: **unused at runtime** (dead code, only referenced by its own tests). ORIGIN/MAIN: runtime, scoped to `/rfm`'s miss-branch; batch, for canonical-identity resolution | LOCAL HEAD: No. ORIGIN/MAIN: Yes, but scoped | `/rfm`'s not-found branch → uncaught 500; snapshot build fails closed |
| RFM Snapshot DB | Runtime (`/rfm` reads) + batch (CLI writes) | ORIGIN/MAIN only, scoped to `/rfm` | `/rfm` → 500; CLI exits non-zero |

**Key architectural question — is CRM DB access still needed only to translate `prestashop_customer_id ↔ masterCustomerId`?**

On LOCAL HEAD: **yes, and it's currently dead code** — a legitimate architectural-removal candidate for the five-endpoint surface, though removing it would also delete the `checkCrmReadiness` implementation that the §4 BLOCKER fix should actually be using. **These two fixes are in tension and should be resolved together**, not independently.

On ORIGIN/MAIN: **no** — the CRM reader also returns `firstname, lastname, email, rut`, none of which `/rfm` actually uses (it only checks existence). Unnecessary PII-shaped read surface for that call site (LOW).

Whether migration 001 (`master_customer.prestashop_customer_id`, self-flagged "design artifact only, not executed yet") has actually been applied against the real production CRM DB is **not verifiable from either repo**.

---

## 11. Migration Audit

| # | File | Type | FK | Rollback | Destructive |
|---|---|---|---|---|---|
| 001 | `add_master_customer_prestashop_customer_id` | `ALTER TABLE ADD COLUMN + UNIQUE` | none | Yes | Rollback self-flags "NOT safe to run once Customer Profile depends on this column in production" |
| 002 | `create_customer_rfm_snapshot_tables` | 2× `CREATE TABLE` | `row → snapshot ON DELETE CASCADE` | Yes, correct drop order (tested) | No |
| 003 | `add_customer_rfm_snapshot_row_segments` | `ALTER TABLE ADD COLUMN×2 + KEY` | none new | Yes | No |
| 004 | `create_customer_rfm_snapshot_run_table` | `CREATE TABLE` | `snapshot_id → snapshot ON DELETE SET NULL` | Yes | No |

Sequential, no gaps, no duplicates. All explicitly "Additive only" by comment convention. `tests/unit/customer-rfm-migrations.test.ts` validates SQL *shape* (string-matching against the raw files) — **no test in either repo executes DDL against a live database**, and there is no migration-runner tooling in the repo at all (files are applied manually/externally). **Clean-install-to-HEAD is structurally plausible but not verified against real infra.**

---

## 12. Test Audit

### Customer Profile — actual run, this session

```
npm run typecheck  -> PASS
npm run lint       -> PASS
npm test           -> 93 files / 725 tests passed, 0 failed, 0 skipped, 16.05s
```

All 93 local test files are pure unit/mocked-integration — no live-DB test exists in this repo's current (LOCAL HEAD) suite.

### Customer Profile — origin/main documented (not independently re-run; checkout was disallowed)

- T11F: "typecheck PASS, lint PASS, tests PASS (101 files, 785 tests), RFM route smoke PASS (9 tests)".
- T11G: "typecheck PASS, lint PASS, tests PASS (103 files, 796 tests)".
- Delta from local's 93/725 to origin/main's 103/796 = 10 files / 71 tests, consistent with the diff-stat's RFM test additions.

### CRM-Customer-360 — actual run, this session (T11H/T12C-scoped subset)

```
91 pass / 0 fail
```

Full-suite (3153 tests) not independently re-run — would require a local MariaDB the sandbox lacks; PR #93's own claim (2629 pass / 524 fail, all DB-connection-shaped) was spot-checked and corroborated, not blindly trusted.

### Coverage gaps found despite green suites

- **No test exercises `src/bootstrap.ts`'s `checkReadiness` implementation at all** in Customer Profile — every route test stubs it out completely. This is the exact gap that let the §4 BLOCKER regression through.
- No test for the *duplicated* `RFM_SNAPSHOT_DB_*` schema in `src/config.ts` (only the CLI's copy in `rfm-snapshot-config.ts` is tested) — §7 dual-schema finding is untested overlap.
- No migration-runner / live-DDL test in either repo.

---

## 13. Documentation Drift

| Doc | Classification | Basis |
|---|---|---|
| Customer Profile `README.md` (local) | CURRENT | Matches T12A code; "No CRM lookup at runtime" is accurate at the local-HEAD query level |
| Customer Profile `README.md` (origin/main) | CURRENT | Explicitly reconciles the mixed-identity state once RFM is pulled |
| `docs/architecture/overview.md` | CURRENT | Matches T12A |
| `docs/releases/CP-R1-T12A-...md` | CURRENT, but **internally self-contradicting** | Main body accurate; "Next Task" footer stale relative to its own later addendum — see §14 |
| `docs/releases/CP-R1-T11F-...md`, `T11G-...md` | CURRENT | Self-flag their own gaps explicitly (identity split, no scheduler wiring) rather than hiding them |
| `docs/releases/CP-R1-T11H-cross-repo-reference.md` | CURRENT, pointer-only | Self-declared: content lives entirely in CRM-Customer-360 |
| `docs/design/CP-R1-T02-master-customer-population-and-prestashop-link-contract.md` | **STALE for 5/6 endpoints, CURRENT for `/rfm`** | Describes the pre-T12A CRM-mediated flow — superseded everywhere except the one endpoint that deliberately kept it |
| Older `docs/audits/rfm-population/*`, `CP-R1-T11A0/T11A2` | PARTIALLY_STALE | Superseded by later T11A.1/T11A3/T11A4 decisions; not contradicting current code but misleading if read in isolation |
| CRM `.env.example` T12B/T12C comments | **CONTRADICTS_CODE (itself)** | T12B comment says "not wired... yet"; T12C comment two lines below says "wired". Root cause of the very contradiction under investigation. |

**No doc anywhere still describes `masterCustomerId` as canonical for the five non-RFM endpoints** — every mention of the old model is explicitly framed as superseded. `masterCustomerId` is only "canonical" for `/rfm`, and that is consistently self-aware in every doc that touches it.

---

## 14. T12 / T12A / T12B Reconstruction

### T12

No separate "T12" document, commit, or branch exists in either repo. T12A appears to *be* the full T12 deliverable — no evidence it was ever a distinct parent task.

### T12A — objective / state / files / dependencies

- **Objective**: migrate the five customer-scoped endpoints from CRM-mediated `masterCustomerId` to direct `ps_customer.id_customer`-based `customerId`, removing the runtime CRM hard dependency that caused `GET /health/ready` to fail with `503 crm_schema_incompatible`.
- **State: DONE.** Merged to local `main` at `7f2d4f5` (PR #13), feature commit `a61b2b0`. Verdict `DIRECT_PRESTASHOP_CUSTOMER_INPUT_VALIDATED`.
- **Live verification performed**: real run against a technical customer id, all five endpoints returning `200 available` — genuine smoke-test evidence, not just unit tests.
- **Residual risk explicitly logged in the doc itself**: two `masterCustomerId`-based clients existed in sibling repos that would misinterpret `customerId` values if ever activated without migration. §8 resolves this: the old adapter is dead, and the live client already correctly uses `customerId` for the five endpoints.

### T12B — the contradiction, resolved

**This repo's evidence (three lines, one doc, zero commits, zero other mentions)**:
1. `CP-R1-T12A...md:252` — inline reference to T12B's "next task" pointer.
2. `CP-R1-T12A...md:262-269`, inside a **"Cross-repo consumer check (2026-08-06)"** addendum added one day after the doc's `August 5, 2026` header: *"`CP-R1-T12B`/`CP-R1-T12C` (2026-08-05) added the correct `customerId`-based client (`lib/integrations/customer-profile/*`) and wired it into the live commercial agent loop instead..."*
3. `CP-R1-T12A...md:333-335` — the doc's closing "Next Task" section: `CP-R1-T12B Sales Agent Customer Profile HTTP Client`, framed as future work.

`git log --all --oneline -i --grep="T12B\|T12C"` across every local and remote branch, in **both** repos: **zero commit-message hits** in Customer Profile (T12B/T12C work happened entirely in the other repo, unsurprisingly). The "Next Task" line was **never revised** after the addendum was added one day later, even though the addendum directly undercuts it.

**Resolved by the CRM-side audit (§8)**: `lib/integrations/customer-profile/*` and `tests/commercial/customerProfileLegacyImportGuard.test.ts` are real, dated to 2026-08-05 (`git log` on the relevant commits — matches the addendum's date, not the "Next Task" line's implied future), wired into the live agent loop, and tested. **The root cause of the contradiction, independently confirmed**: CRM-Customer-360's checked-out branch (`develop`) is 241 commits ahead of `origin/main`; whoever wrote the "Next Task" line was almost certainly working from `main` or a pre-T12B/T12C snapshot, and it was simply never updated once the addendum captured the real state one day later. **This is stale documentation, not an open task.**

### T12B — Definition of Done (as actually delivered, verified in code)

- A `customerId`-based HTTP client for the five direct-PrestaShop endpoints, living in `CRM-Customer-360`. ✅ Delivered.
- Wired into the live commercial agent loop (not just defined). ✅ Delivered, traced call-by-call.
- Guard-rail against reintroducing the legacy `masterCustomerId`-based adapter. ✅ Delivered and passing.
- **Not delivered / not part of T12B's original scope**: production activation. Both `CUSTOMER_PROFILE_ENABLED` and `CUSTOMER_PROFILE_CONTEXT_ENABLED` default false and are unset in the real `.env`. T12C's own verdict (`COMMERCIAL_CONTEXT_VALIDATED_WITH_RUNTIME_FLAG_REQUIRED`) treats this as a deliberate, separate next step, not an oversight.

### T11H vs T12B/T12C

**Different, and later.** T12B/T12C (2026-08-05) built the general-purpose client for the five `customerId` endpoints. T11H (2026-08-14/15, commits `628f6e2`/`59a74e2`, PR #93) is explicitly scoped to RFM only, consumes `masterCustomerId`-space data, and *extends* (not duplicates) the T12B/T12C client/loader files. Sequencing self-documented in `origin/main:docs/releases/CP-R1-T11F-...md:365-379`: T11H was "implemented and validated **after**" T11F, cross-repo.

---

## 15. Technical Debt Register

| ID | Severity | Debt | Evidence | Impact | Blocks T12B activation | Minimum action |
|---|---|---|---|---|---|---|
| TD-001 | **P0** | `/health/ready`'s `crm` field is a second PrestaShop ping, not a real CRM probe | `src/bootstrap.ts:134-140` (both trees), zero test coverage | Readiness signal for RFM's real CRM dependency is worthless | **Yes**, if activation includes RFM/T11H | Wire `checkCrmReadiness()` into the `crm` slot; add a `bootstrap.ts` readiness test |
| TD-002 | P1 | Local `main` is 2 commits behind `origin/main` — RFM runtime doesn't exist locally yet | `git status -sb` | Anyone working "in this repo" on RFM is working against a phantom state until pulled | Yes, prerequisite | `git pull` (clean fast-forward, already confirmed no conflict) |
| TD-003 | P1 | Split public identity model (`customerId` vs `masterCustomerId` for `/rfm`), format-indistinguishable | `T11F.md` Limitaciones; §4 | ID-collision risk returns wrong customer's RFM data, undetectable | No (current live CRM client already handles the split correctly) | Track for a future identity-unification task; not urgent given §8's finding that no live caller currently confuses the two |
| TD-004 | **P1** | No external scheduler confirmed anywhere for RFM snapshot generation | §6, exhaustive repo search found zero deploy/cron config | Without a scheduler, `/rfm` never gets a first published snapshot (permanent `503`) or goes stale forever | **Yes**, if activation includes RFM/T11H | Stand up and confirm an external scheduler (cron/container job) before relying on `/rfm` in production |
| TD-005 | **P1** | CRM/Sales Agent Customer Profile wiring is code-complete but flag-disabled (`CUSTOMER_PROFILE_ENABLED`, `CUSTOMER_PROFILE_CONTEXT_ENABLED` both false, unset in `.env`) | §8.4 | Sales Agent currently gets zero Customer Profile context in production | This **is** the activation task | Staged flag flip (shadow → controlled → production) per T12C's own stated next step |
| TD-006 | P2 | RFM dependency-down collapses to generic `500` instead of `503 degraded` (asymmetric with the other 5 endpoints) | §5, §9 | Client can't distinguish "infra down" from "code bug" for `/rfm` | No | Map RFM's infra-down errors to `503 degraded` for consistency |
| TD-007 | P2 | RFM config validated by two independent Zod schemas, entirely undocumented in `.env.example` | §7 | Latent drift risk — a default added to one schema and not the other | No | Consolidate to one schema or document both fully in `.env.example` |
| TD-008 | P2 | No real production/live-DB validation of RFM migrations or snapshot generation — only synthetic localhost failures observed | §5, §11 | Unknown whether clean-install-to-HEAD and snapshot generation actually work against real infra | Recommended before broad activation | Run migrations + one full snapshot cycle against a real staging DB |
| TD-009 | P3 | `.env.example` T12B/T12C comments contradict each other ("not wired yet" vs "wired") | §8.4, §13 | Directly caused the contradiction this audit had to resolve | No | One-line comment fix in CRM-Customer-360's `.env.example` |
| TD-010 | P3 | Legacy `lib/customer-profile/httpCustomerProfileAdapter.ts` (T10B1) confirmed dead code | §8.5 | None currently — pure cleanup opportunity | No | Delete, guarded by the existing legacy-import test |
| TD-011 | P3 | `mysql-master-customer-reader.ts` over-fetches PII columns for an existence-only check | §10 | Unnecessary PII-shaped read surface, no functional bug | No | Narrow the `SELECT` to just the existence check |
| TD-012 | P3 | No freshness/staleness alerting for RFM snapshots (30-day-old snapshot still serves as `available`) | §6 | Operational blind spot, not a correctness bug | No | Add a freshness check / alert on top of the existing run-log table |
| TD-013 | P2 | CRM infra code in Customer Profile is dead-at-runtime on LOCAL HEAD but becomes live-but-narrow on ORIGIN/MAIN — "remove CRM" and "fix TD-001" pull in opposite directions | §10 | Fixing TD-001 naively (just call `checkCrmReadiness()`) is fine short-term, but a later CRM-removal pass must not re-break it | No | Resolve TD-001 and any future CRM-removal decision in the same change, not independently |

No severities inflated: TD-003 downgraded from what a first read might suggest (HIGH-looking format collision) to non-blocking, because §8 independently confirmed no live caller today actually sends the wrong ID space — the risk is theoretical/future, not active.

---

## 16. Dependency Graph

```
TD-002 (git pull RFM runtime)
   │
   ├──> TD-001 (fix /health/ready crm field)  ──┐
   │                                              │
   ├──> TD-013 (resolve CRM-removal vs TD-001    │
   │            together, not independently) ────┤
   │                                              ▼
   └──> TD-004 (confirm/stand up external    T12B ACTIVATION
        scheduler, only if RFM is in scope)  (flip TD-005's flags)
                                                   │
        TD-006, TD-007, TD-008  (bundle-able,      │
        same activation change) ───────────────────┤
                                                     ▼
        TD-009 (one-line CRM doc fix,          Production-live
        do immediately, zero cost) ───────>    Customer Profile
                                               context in Sales Agent
        TD-003, TD-010, TD-011, TD-012
        (independent, no ordering constraint,
        safe to defer indefinitely)
```

---

## 17. MUST / SHOULD / CAN DEFER

### MUST FIX BEFORE activating T12B/T11H in production

- **TD-002** — pull `origin/main` first; nothing RFM-related can be reasoned about locally otherwise.
- **TD-001** — fix the `/health/ready` `crm` field before relying on it for anything RFM-adjacent; it currently lies.
- **TD-004** — confirm or stand up a real external scheduler *if* the activation scope includes RFM/T11H (`getRfm`); without it `/rfm` is either permanently 503 or silently stale forever.
- **TD-005** — the flag flip itself is the activation task; do it staged (shadow → controlled → production) per T12C's own documented plan, not as a single flip.

### SHOULD FIX WITH the activation change (cheap, same-blast-radius)

- **TD-009** — one-line comment fix, literally the source of the contradiction this audit resolved.
- **TD-006** — error-taxonomy consistency for RFM, small and localized.
- **TD-007** — document or consolidate the RFM config schema while touching that area anyway.
- **TD-013** — resolve alongside TD-001 since they touch the same CRM-readiness code.

### CAN DEFER AFTER T12B is live

- **TD-003** — identity-space split is real but currently harmless (no live caller confuses it); revisit if a new consumer is added.
- **TD-008** — real-DB validation matters, but can happen as part of a staged rollout rather than gating code that's already correct by construction (transactional/fail-closed, verified in §5).
- **TD-010, TD-011, TD-012** — pure cleanup / operational-maturity items, no correctness impact.

---

## 18. Recommended Execution Sequence

```
Step 1 — Pull origin/main into local Customer Profile main
Why: local main is missing the entire RFM runtime (TD-002); every subsequent
     step needs it present to be actionable in this repo.
Files/repos affected: MS-pesaschile-customer-profile (fast-forward only)
Risk: none — confirmed clean fast-forward, no conflicts.
Validation: git status shows "up to date"; npm run typecheck/lint/test green
     with the RFM files present.

Step 2 — Fix the /health/ready `crm` field (TD-001) and resolve it together
     with the CRM-dead-code question (TD-013)
Why: currently gives a false-positive CRM signal exactly where RFM (once
     activated) genuinely needs it; zero test coverage means it can regress
     silently again.
Files/repos affected: MS-pesaschile-customer-profile — src/bootstrap.ts,
     new tests/unit/bootstrap.test.ts (or equivalent).
Risk: low — swap one function call, but decide in the same change whether
     the CRM infra code stays (fixed) or the CRM-removal path is taken
     instead (in which case the fix looks different).
Validation: new test asserts `crm` reflects checkCrmReadiness()'s real
     result under a mocked CRM-down condition.

Step 3 — One-line CRM-Customer-360 .env.example comment fix (TD-009)
Why: trivial, and it's the literal root of the contradiction this audit
     was asked to resolve — leaving it creates the same confusion again
     for the next person who reads it.
Files/repos affected: CRM-Customer-360 — .env.example only.
Risk: none.
Validation: comment now matches the actual wired-in-code-since-T12C state.

Step 4 — Confirm or stand up the external RFM scheduler (TD-004)
Why: without this, activating T11H's getRfm() in production either 503s
     forever (no snapshot ever published) or serves an ever-staler snapshot
     (no freshness cutoff). This is an infrastructure/deploy task, not a
     code change in either repo.
Files/repos affected: deployment infra (outside both repos' version control
     as currently structured) — or, if preferred, add a minimal CI/cron
     config INTO this repo so it's no longer "NO VERIFICABLE DESDE EL REPO".
Risk: medium — this is the one step genuinely outside what either repo's
     code can guarantee; treat as a hard gate before RFM-inclusive activation.
Validation: one real scheduled run produces a `published` snapshot row and
     a successful customer_rfm_snapshot_run row against real infra.

Step 5 — Staged activation of CUSTOMER_PROFILE_ENABLED /
     CUSTOMER_PROFILE_CONTEXT_ENABLED (TD-005 — this IS "T12B going live")
Why: the client, loader, and agent-loop wiring are already built and
     tested (§8) — this step is turning it on, not building it.
Files/repos affected: CRM-Customer-360 — environment configuration only
     (shadow env first, per T12C's own documented plan).
Risk: medium — first real production traffic through a previously-inert
     path; T12C's plan already calls for shadow → controlled → full.
Validation: shadow-mode observability events (customer_profile_client_
     request, customer_rfm_lookup) show real traffic and real
     AVAILABLE/NOT_FOUND/UNAVAILABLE distribution before flipping fully on.

Step 6 — Bundle the cheap consistency fixes while the area is warm
     (TD-006 error taxonomy, TD-007 config consolidation/documentation)
Why: same files, same mental context as Steps 2 and 4; cheaper to do now
     than to reopen later.
Files/repos affected: MS-pesaschile-customer-profile.
Risk: low.
Validation: existing test suites extended to cover the new 503 mapping
     and the consolidated config schema.

Step 7 — Deploy readiness check
Why: confirm end-to-end before calling this "done".
Files/repos affected: both.
Risk: low if Steps 1-6 are complete.
Validation: full test suites green in both repos; a real customer's RFM
     data observably reaches a live agent-loop turn in a controlled/shadow
     environment; /health/ready's crm field independently verified against
     a real CRM outage drill.
```

---

## 19. Final T12B Readiness Verdict

```
READY_FOR_T12B_WITH_KNOWN_DEBT
```

**Justification**: T12B, as originally scoped, is done — built, tested, and structurally wired, verified directly in code rather than assumed from documentation. Nothing in either repo's evidence supports treating T12B as a build task anymore. The debt that remains (TD-001 through TD-013) is real, itemized, and none of it is severe enough to call the underlying work incorrect — TD-001 (the one P0) is a readiness-signal bug independent of T12B's own correctness, and TD-004/TD-005 are activation prerequisites, not implementation gaps. Proceeding means: pull, fix the readiness signal, confirm the scheduler, then flip the flags in stages — not writing a new HTTP client that already exists.

**Verify locally**: `git log --oneline -1 -- docs/audits/CP-R1-T12B-technical-debt-readiness-audit.md` after this file is committed (not done as part of this audit).
