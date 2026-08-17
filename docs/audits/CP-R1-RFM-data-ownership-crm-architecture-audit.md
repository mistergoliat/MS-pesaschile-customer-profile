# CP-R1 — RFM Data Ownership & CRM Architecture Audit

Date: 2026-08-17
Scope: read-only, cross-repo (`MS-pesaschile-customer-profile`, `CRM-Customer-360`). No implementation, no DB provisioning, no migration execution, no `.env` changes, no code changes, no commits, no push, no PRs.
Predecessor documents (read in full before this audit): `docs/audits/CP-R1-T12B-technical-debt-readiness-audit.md`, `docs/releases/CP-R1-T12D-gate1-readiness-regression-fix.md`, `docs/releases/CP-R1-T12D-gate2-rfm-real-infrastructure-validation.md`.

---

## Headline finding (read this first)

Gate 2 validated CRM connectivity against a `main_management` instance with 1 row in `master_customer` and no `prestashop_customer_id` column. This audit cannot confirm that instance is the one the live Sales Agent actually writes to in production.

- Customer Profile's own `CP-R1-T01` audit (2026-07-27), querying with `PRESTASHOP_DB_*`/`CRM_DB_*` credentials, found `main_management` **visible on the same physical host as PrestaShop**: `pesas-productiva.cz0wkq9tvrby.us-east-1.rds.amazonaws.com` (`docs/audits/CP-R1-T01-customer-account-identity-audit.md:30-32`).
- CRM-Customer-360's own committed `.env` (labeled `APP_ENV=production`) points its `main_management` connection at `DB_HOST=127.0.0.1` — a local/self-hosted address, structurally different from that RDS host (`CRM-Customer-360/.env:1,23-27`, per the CRM-side agent's direct read).

Both facts are independently sourced, real, and hard to reconcile from either repo alone. If they describe two different physical databases, then every "1 row, no `prestashop_customer_id`" finding in Gate 2 — and this audit's own reasoning about `master_customer`'s real population — may describe the wrong database. This is called out again in §2, §8E, and the final blockers list. It is the single most consequential open question this audit surfaces, and it is an infra/ops question, not a code question — neither repo's source can settle it.

---

## 1. Data map

| Logical DB | Physical host/schema | Owner service | Read by | Written by | Purpose |
|---|---|---|---|---|---|
| PrestaShop transactional DB | `pesas_productiva` schema, AWS RDS `pesas-productiva.cz0wkq9tvrby.us-east-1.rds.amazonaws.com` | PrestaShop / ecommerce platform (external to both repos) | Customer Profile (`PRESTASHOP_DB_*`, all 5 direct endpoints + RFM population/calculation source); CRM-Customer-360 only via `LOGISTICS_DB_*` scoped to the unrelated `pc_pos` schema, currently `LOGISTICS_DB_ENABLED=false` | PrestaShop application only | Source of truth: 72,867 `ps_customer` rows, 81,123 `ps_orders` rows (Gate 2 live counts) |
| CRM DB (`main_management`) | **Unresolved** — same RDS host as PrestaShop per Customer Profile's `CRM_DB_*`-based audit (T01), vs. `127.0.0.1` per CRM-Customer-360's own committed `.env` (`APP_ENV=production`) — see headline finding | CRM-Customer-360 (creates/migrates every table in this schema, its own `migrations/006` through `/024`) | Customer Profile (`CRM_DB_*`: `checkCrmReadiness()`, `/rfm`'s not-found branch, RFM canonical-identity resolver at snapshot-build time); CRM-Customer-360 (own app) | CRM-Customer-360 only — `createMasterCustomer()` and all its own table writers. Customer Profile never writes here. | CRM's own canonical customer / conversation / opportunity domain |
| RFM Snapshot DB | **Unprovisioned** — no host, credentials, or schema exist anywhere today (`RFM_SNAPSHOT_DB_*` entirely absent from `.env`, per Gate 2) | Customer Profile (exclusively) | Customer Profile HTTP process (`/rfm` route) only | Customer Profile's own CLI (`snapshot:rfm[:scheduled]`) only — never the HTTP process, never any other service | Durable, versioned, service-owned RFM snapshot store |
| Logistics DB (`pc_pos`) | Same AWS RDS host as PrestaShop, different schema, per `CRM-Customer-360/.env:112` (`LOGISTICS_DB_HOST`) | External POS system | CRM-Customer-360 (`lib/integrations/logistics/*`), feature-flagged off | External POS system | Point-of-sale data — out of scope for RFM, mentioned because the brief named `pc_pos` explicitly |
| `crm_dev` / `crm_test` / `crm_legacy_fixture` | Same local MariaDB instance as CRM-Customer-360's dev `main_management` (`infra/docker-compose.dev.yml`) | CRM-Customer-360 (dev/test tooling) | Dev/test only | Dev/test only | Local development and migration-runner test isolation — not production, mentioned only to confirm they were checked and ruled out |

**Logical vs. physical, explicitly**: "different schema name" does not imply "different server" (PrestaShop and CRM already share one physical RDS instance per T01's own finding — this is documented, not assumed) — but "same schema name" (`main_management`) does not imply "same server" either, which is exactly the ambiguity in the headline finding. Neither can be resolved by variable-name inspection alone; both were checked against real connection evidence (T01's `information_schema` walk, and a direct read of CRM-Customer-360's committed `.env`), and they still disagree.

---

## 2. What `main_management` actually is

### A. Is `main_management` the real DB of CRM-Customer-360?

Yes, structurally — it is CRM-Customer-360's own hardcoded application database name, not a name Customer Profile invented. Evidence: `infra/mariadb/init/001-create-databases-and-users.sql:1` (`CREATE DATABASE IF NOT EXISTS main_management`), `lib/database-config.ts:223` (`assertAllowedLocalDatabaseName` allowlist), `infra/docker-compose.dev.yml:10` (`MARIADB_DATABASE: main_management`), and CRM-Customer-360's own `.env:23-27` (`DATABASE_NAME=main_management`). Every table CRM-Customer-360 owns (§4) is migrated into this one schema — there is no second, separate CRM schema anywhere in that repo.

*Which physical instance backs it in production* is exactly the open question in the headline finding — structurally it's the right database, but which server hosts it cannot be confirmed from either repo.

### B. Production, staging, dev, legacy, or partial?

CRM-Customer-360's committed `.env` self-labels `APP_ENV=production`, but its `DB_HOST=127.0.0.1` is not distinguishable from a local/co-located database by inspection alone — there is no separate `.env.staging`, no Terraform/IaC under `infra/` (that folder contains only a local MariaDB dev bootstrap: `docker-compose.dev.yml` + init SQL), and no CI/CD pipeline that injects a different production value (`.github/` does not exist in that repo; `docker-compose.hub.yml` loads `./.env` verbatim). There is a second, different local config (`.env.local`, `APP_ENV=development`) pointing the same variable names at `crm_dev` on port 3307 — i.e. two different dev-shaped configs already coexist in the same checkout, which is itself evidence of how easily this environment drifts. Verdict: **cannot be classified as production/staging/dev with confidence from the repo alone** — the `APP_ENV=production` label is self-reported, not independently verified against infra.

### C. Main tables it contains

Confirmed in `main_management` via CRM-Customer-360's own migrations (all applied to the single `"app"`/`"migration"` connection target — same schema, different DB users): `master_customer` (`006`), `conversation` + `conversation_message` + `ai_agent_execution` + `ai_agent_decision` + `ai_tool_execution` + `ai_conversation_state` (`008`), `ai_orchestrator_shadow_log` (`002`), `brain_message_outbox` (`003`), `crm_opportunities` + `crm_agent_decisions` (`004`), `crm_customer_onboarding` + `customer_conversation_link` (`007`), `customer_external_identity` (`010`), `customer_addresses` (`018`), `crm_customer_onboarding_state` (`023`), `crm_conversation_requests` + `crm_request_events` + `crm_request_message_links` (`015`).

### D. Where do `conversation`, `crm_opportunities`, `customer_conversation_link`, `ai_*`, `brain_message_outbox` live?

All confirmed to exist and all confirmed to live in this **same** `main_management` schema as `master_customer` (§4 above) — no cross-database FK, no separate connection pool, single migration runner target for the whole domain. (One naming correction versus the brief: the actual table is `n8n_conversation_messages`, discovered independently on the Customer Profile side by the 2026-07-27 T01 audit as a real dependent of `master_customer.customer_master_id`, not `conversation_message` — both `conversation_message` (CRM-Customer-360's own AI-runtime table, migration `008`) and `n8n_conversation_messages` (an older/legacy table CRM-Customer-360's migrations don't create, seen only from the outside by Customer Profile's audit) appear to exist; this audit did not chase the second one further since it is out of scope for RFM.)

### E. Is the instance Gate 2 connected to the same one the Sales Agent uses today?

**Cannot be confirmed — see the headline finding.** This is not a "probably yes, minor risk" situation: the two pieces of evidence (RDS host vs. `127.0.0.1`) come from independent, credible sources on each side, and nothing in either repo resolves the conflict. Do not assume identity resolution based on the shared `main_management` name alone, per the brief's own instruction.

---

## 3. `master_customer` ownership

### Flow: source → creation → enrichment → linking → consumers

```
source: a human hub operator, authenticated (requireOperator), acting through the CRM web UI
  -> POST /api/customers  (app/api/customers/route.ts:18-46)
  -> createCustomer()  (lib/domains/customers/repository.ts:96)
  -> createMasterCustomer()  (lib/integrations/customer-master/customer-repository.ts:79-106)
     INSERT INTO master_customer (firstname, lastname, email, platform_origin) VALUES (...)
     gated by isDbWriteEnabled()
  -> row exists, id assigned (AUTO_INCREMENT)
  -> (design-only, unwired) enrichment via "Customer Service" microservice
     (lib/integrations/customer-service/http-adapter.ts) -- see below
  -> linking: FK references from crm_customer_onboarding_state.customer_id (migration 023,
     ON DELETE RESTRICT, deliberately not SET NULL)
  -> consumers: CRM-Customer-360's own agent-loop / hub UI; Customer Profile (read-only, via
     CRM_DB_*, for RFM's canonical-identity resolver and the /rfm not-found branch)
```

**Who creates rows**: exclusively `createMasterCustomer()`, one row per call, never a loop or batch insert. **No `UPDATE master_customer` exists anywhere in production code** — the repo's only `UPDATE master_customer` is a permissions smoke-test probe (`scripts/db-permissions.ts:14`), unrelated to real data.

**Structurally enforced, not just observed**: `tests/commercial/customerMasterProjectionGate.test.ts:195-209` asserts that WhatsApp onboarding code (`onboardingTransitions.ts`, `resolveNativeCustomerSession.ts`, `runCustomerOnboardingPostPlanStage.ts`, `customerIdentityCapabilities.ts`) contains **zero** `INSERT`/`UPDATE`/`createMasterCustomer(` references. `lib/domains/customer-service/customerMasterProjection.ts:1-9` states outright: *"Customer Service remains the sole authority for creation/linking — this module never inserts or updates `master_customer`, and never falls back to PrestaShop or any other source."*

That "Customer Service" is a **third**, separate external HTTP microservice, distinct from both Customer Profile and CRM-Customer-360, configured via `CUSTOMER_SERVICE_BASE_URL`/`CUSTOMER_SERVICE_API_KEY` — both empty by default, and the adapter fails closed (`temporarily_unavailable`) when unconfigured (`lib/integrations/customer-service/http-adapter.ts:264-284`). Its own env comment states it is **"Not registered in the Capability Gateway and not connected to the runtime yet"** (`.env.example:123-127`). So the system's *designed* sole authority for automatic creation/linking is itself unbuilt-into-runtime — leaving the manual hub-UI POST as the only path that actually functions today.

**Is it populated lazily/on-demand?** Yes, unambiguously — one row per authenticated human action, never bulk. **Is there a backfill process?** No executable one exists in either repo. Grep across both repos for "backfill"/"sync"/"import" near `master_customer`/`prestashop` turns up only prose (design docs, code comments) — never a runnable job. Customer Profile's own `docs/design/CP-R1-T02-...md` defines the *shape* of a future population job (`classifyIdentityMatch`, a `PopulationCheckpoint` type) but explicitly states: *"No se implementa el job todavía... la ejecución es tarea posterior"* — it has never been built, let alone run. **Is there a PrestaShop → CRM sync?** No — confirmed independently from both sides. CRM-Customer-360's own `lib/domains/customer-identity/local-adapter.ts:14-18` states: *"`ps_customer` (PrestaShop) phone/mobile fields have no verified bridge into `master_customer.id` in this codebase (no writer ever creates a `customer_external_identity` row with provider `"prestashop"`)."* Its "prestashop" identity source reader (`lib/customer-identity/sourceReaders.ts:228`) queries the **wrong database** — it runs `DESCRIBE ps_customer` against the single `main_management` pool (`lib/db.ts:13-28`), not against the real PrestaShop RDS instance; a real `ps_customer` table only exists as a local test fixture in `crm_legacy_fixture` (`database/fixtures/legacy-n8n-schema.sql:267`). This "PrestaShop identity source" is effectively dead against production data.

### Is ~14,000 rows architecturally correct for `master_customer`?

**No — this expectation conflates two unrelated population concepts.** The ~14,000 figure traces to a specific, identifiable source: `docs/releases/CP-R1-T11A3-rfm-analytical-use-case-validation.md:74` records a live read-only measurement, `operationalCustomerCount = 14.173`, for RFM's **365-day trailing active-buyer window** (`RFM_REFERENCE_TIME=2026-08-03T00:00:00.000Z`). That is RFM's own rolling operational population of PrestaShop buyers — a completely different concept from "customers who have interacted with CRM/WhatsApp," which is `master_customer`'s actual, designed population model (§3 above: lazy, human-gated, one row per verified interaction). Expecting `master_customer` to converge toward 14,173 rows would mean building the backfill job that was explicitly designed-but-never-built (T02A) or reviving the unwired Customer Service auto-linking flow — neither is a natural consequence of the system as it exists today, and nothing in either repo's roadmap commits to building it. **A population of 1 row is architecturally coherent for a freshly-initialized, lazily-populated CRM table** — it is not evidence of a broken pipeline, it is evidence of a pipeline that has correctly never been triggered at scale, exactly as designed.

---

## 4. Canonical identity inventory

| Identity | Source of truth | Unique? | Stable? | Used by |
|---|---|---|---|---|
| `ps_customer.id_customer` (`customerId`/`prestashopCustomerId`) | PrestaShop (`pesas_productiva`) | Yes, PK | Yes | Customer Profile's 5 direct endpoints; RFM population + calculation (functional key on every `customer_rfm_snapshot_row`, hardcoded `identityAuthority = 'prestashop_customer'` in `src/domain/customer-rfm/dataset.ts:39`); CRM-Customer-360's client sends a same-named `customerId` for the same 5 endpoints (see caveat below) |
| `master_customer.id` (`masterCustomerId`) | CRM-Customer-360 (`main_management`) | Yes, PK, `AUTO_INCREMENT` | Yes once created, but the row itself is rare (1 row today) | Customer Profile's `/rfm` route (sole public key today) + not-found disambiguation; CRM-Customer-360's own FK target (`crm_customer_onboarding_state.customer_id`) |
| `master_customer.prestashop_customer_id` | Designed in Customer Profile's `migrations/001` — **not applied, and not tracked in CRM-Customer-360's own migration history at all** (§5) | Would be unique if applied (`UNIQUE` constraint in the migration) | N/A — column does not exist in the schema CRM-Customer-360 actually owns/migrates | Intended as the deterministic link RFM's canonical-identity resolver batch-queries at snapshot-build time; currently absent |
| `wa_id` / phone | CRM-Customer-360 (`customer_external_identity`, nullable `customer_id` FK per migration `024`) | Unique-ish per WhatsApp identity | Yes | CRM-Customer-360 onboarding/identity resolution only — never reaches Customer Profile or RFM |
| `email` | Both `master_customer.email` (unique) and `ps_customer.email` (**not** unique — 385 duplicates, 373 cross-shop, per T01) | Unique on CRM side only | Fragile on the PrestaShop side | Basis for T02A's designed-but-never-executed backfill classifier only; not used at runtime anywhere today |
| `rut` | Recognized identity type in both repos' type systems, but **no working data source in either**: CRM's `sourceReaders.ts` never reads a `rut` column; Customer Profile's current PrestaShop-direct contract hardcodes `customer.rut = null` (`README.md:84-91`) | N/A | N/A | Defined in both contracts, functionally dead in both repos today |
| CRM's session-local `identity.customerId` | CRM-Customer-360's own identity resolution (`identityService.resolveIdentity` or CRM `resolve_customer` capability) | Not guaranteed | **Not guaranteed to equal `ps_customer.id_customer`** — CRM-Customer-360's own type doc calls this out explicitly: *"a separate identity space from... `masterCustomerIdentity`... this turn's local/CRM identity (whatever space `identityService`/Customer Service produced)... The two commonly agree but are never assumed to"* (`customer-session/types.ts:59-70`) | Already sent today, as-is, to Customer Profile's 5 `customerId` endpoints — this is a real, pre-existing risk (mirrors Customer Profile's own `CP-R1-T10B8A` "Caso D: equivalencia no demostrable" verdict) that is not introduced or worsened by anything recommended in this audit |

**No single ID should dominate every domain.** PrestaShop-rooted data (ecommerce history, RFM) is already correctly and consistently keyed by `ps_customer.id_customer` across both repos. CRM-rooted data (conversations, opportunities, onboarding state) is correctly keyed by `master_customer.id`. The two domains already cross this boundary successfully for 5 of 6 endpoints today, using `customerId` as the explicit, working contract — RFM is the one place this pattern was not followed (§7, §18).

---

## 5. Migration 001

`migrations/001_add_master_customer_prestashop_customer_id.sql` in Customer Profile. Single commit in its history (`1fce664`, "feat(customer-profile): define master customer population and lookup contracts"), never touched since.

### A/B. Why created, what problem it solves

Created alongside `docs/design/CP-R1-T02-master-customer-population-and-prestashop-link-contract.md` (2026-07-27) to give `master_customer` a deterministic link to `ps_customer` so a future population/backfill job (T02A) and a future runtime lookup (T02B) could resolve `masterCustomerId → prestashopCustomerId` without email-matching heuristics at read time. Chosen deliberately over a generic `customer_source_link` table (Alternative B, `docs/audits/CP-R1-T01-customer-account-identity-audit.md:210-227`) because a direct column was judged the minimal correct model given no second external identity source existed at the time.

### C. What system expected to populate `prestashop_customer_id`

Customer Profile's own, never-built T02A population job (§3). The migration's comment is explicit that referential integrity is enforced by *"the Identity Resolver and the population job, not the database"* (`migrations/001...sql`, comment) — i.e. the column was designed assuming a population job that Customer Profile itself would own and run.

### D/E/F. Does it fill the column, and does that process exist?

The migration is additive-only (`ALTER TABLE ADD COLUMN` + `UNIQUE` index) — it does not populate data. The intended backfill process (T02A) was fully **designed** (population rules, idempotency, batching, checkpoint/resume contract — `docs/design/CP-R1-T02-...md` §§2-5) but its executable job was never implemented; only pure, unit-tested classification functions exist (`src/domain/master-customer-population/classify-match.ts`), with no runner, no CLI entrypoint, no schedule.

### G. Executed anywhere?

No. Confirmed not applied in the one real environment this audit has direct evidence for (Gate 2's `ER_BAD_FIELD_ERROR` when probing the column). Git history shows no second commit, no environment-specific apply script, no migration-runner tooling in Customer Profile at all (migrations are applied manually/externally, per the earlier T12B audit's §11).

### H. Does the current architecture still need it after T12A? — **This is the critical finding of this section.**

**Migration 001 is not owned, tracked, or even known by the repo that owns `master_customer`'s real schema.** CRM-Customer-360 creates `master_customer` via its own `migrations/006_master_customer_platform_origin.sql` and has never added a `prestashop_customer_id` column in any of its own 6 migrations that touch that table (`006`, `007`, `008`, `010`, `018`, `023`, `024`). CRM-Customer-360's own migration-runner tracks applied migrations in a `schema_migrations` table with a `UNIQUE KEY` on `version` (evidenced by migration `024`'s own commentary about a real numbering collision it had to resolve) — Customer Profile's `001` has no corresponding entry there and never could, because it lives in a different repo's `migrations/` folder entirely.

This means: if migration 001 were applied directly against the real `main_management` (once the host-identity question in the headline finding is resolved), it would alter a table whose lifecycle CRM-Customer-360 believes it fully owns and tracks, **without CRM-Customer-360's own tooling ever knowing the change happened.** That is exactly the kind of untracked schema drift CRM-Customer-360's own team is evidently wary of — migration `024`'s explicit design choice (make `customer_id` nullable rather than *"fabricating a provisional `master_customer`"*) shows a team actively protecting this table's integrity from exactly this kind of out-of-band change.

T12A did remove the *runtime* CRM dependency from the 5 direct endpoints, but that is orthogonal to whether migration 001 is still needed — RFM (added after T12A, in T11D) is the one remaining consumer that would benefit from this column, for the *optional* `master_customer_id` enrichment at snapshot-build time (§7). Given §18's recommendation to make that enrichment optional rather than load-bearing for `/rfm`'s public contract, migration 001's urgency drops substantially — but it is not made obsolete outright; it becomes a lower-priority, cross-repo-coordinated task rather than a blocking one. See §19 for the formal verdict.

---

## 6. How RFM is generated (traced in code)

```
input customer population
  ps_orders (valid=1, id_customer>0, date_add in [referenceTime-365d, referenceTime))
  joined to ps_customer -- NOT master_customer, NOT any CRM table
  (docs/releases/CP-R1-T11A-population-rfm-dataset.md; src/domain/customer-rfm/dataset.ts:39
   hardcodes identityAuthority = 'prestashop_customer')
    -> recency: calendar days since last valid order
    -> frequency: COUNT(DISTINCT id_order)
    -> monetary: SUM(total_paid_tax_incl), gross, no refund netting (v1 policy)
    -> scoring: R/M tie-safe percent rank 1-5; F via versioned thresholds (not NTILE)
    -> identity resolution (T11D, added AFTER the calculation, at snapshot-BUILD time only):
       batched SELECT id, prestashop_customer_id FROM master_customer
       WHERE prestashop_customer_id IN (...)   [src/infrastructure/crm/mysql-rfm-canonical-identity-resolver.ts]
       matched    -> persist master_customer_id
       unmatched  -> persist master_customer_id = NULL   (explicit, tested)
       ambiguous  -> persist master_customer_id = NULL, audited in coverage
    -> snapshot row: prestashop_customer_id (NOT NULL, functional key)
                     + master_customer_id (NULLABLE, no FK to master_customer)
```

### Population source

`ps_customer`/`ps_orders` directly — never `master_customer`. Confirmed by the domain code itself (`dataset.ts:39-40`), not just docs.

### Identity resolution — why CRM is touched at all

CRM is read **only** to denormalize an optional `master_customer_id` foreign key onto each already-computed row, once, at snapshot-build time — never to gate which customers get scored. RFM is calculated for **every** PrestaShop buyer in the window (14,173 as of the 2026-08-03 measurement), regardless of whether they have a `master_customer` row. There is no code path where a customer is excluded from RFM for lacking CRM presence.

### Exclusions

A PrestaShop customer with no `master_customer` row: still gets a full snapshot row, still gets scored, `master_customer_id` is persisted as `NULL` (`unmatched`, T11D's explicit, tested behavior — not an error, not an abort). The snapshot only aborts on infrastructure/schema errors, never on identity-resolution misses (`docs/releases/CP-R1-T11D-...md`, "Tratamiento operativo" table).

---

## 7. Does RFM truly need `masterCustomerId`?

### A. Does any calculation need it?

**No.** R/F/M metrics, scores, and `rfmCode` are computed entirely from `ps_orders`/`ps_customer`, with zero reference to `master_customer` anywhere in `src/domain/customer-rfm/*` (`scoring.ts`, `dataset.ts`, `segmentation.ts`).

### B. Is it only a lookup key for `/rfm`?

Yes, and even that is a choice, not a necessity — see finding below.

### C. Could the snapshot be fully valid keyed by `prestashop_customer_id` alone?

**Yes, and the capability to serve it that way already exists, fully built, and is simply never wired to an HTTP route.** `src/application/customer-rfm/get-current-prestashop-customer-rfm.ts` and `CurrentRfmSnapshotReader.getCurrentPrestashopCustomerRfm()` (`src/infrastructure/rfm/mysql-rfm-snapshot-reader.ts:124`) are fully implemented, individually unit-tested (`tests/unit/get-current-prestashop-customer-rfm.test.ts`, listed in T11D's own test inventory), and structurally identical to the `masterCustomerId` path — but a repo-wide grep of `src/http/` and `src/bootstrap.ts` confirms **zero references** to this function outside the application/infrastructure layers. This is the single strongest piece of evidence in this audit: the "PrestaShop-keyed RFM" alternative this brief asks about is not hypothetical — it is dead, unexposed capability sitting right next to the live path.

### D. Does CRM already know both IDs when it calls Customer Profile?

Re-verified directly, not just re-cited from the earlier audit: CRM-Customer-360's `trustedCustomerSession` does carry both, but via **independent** resolution paths with different guarantees. `customerId` comes from `resolveNativeCustomerSession.ts:271-277` (local phone/external-id match, or CRM's own `resolve_customer` capability). `masterCustomerId` is computed separately (`resolveNativeCustomerSession.ts:284-287` → `resolveMasterCustomerIdentity.ts:72-85`) and is **only** populated when identity resolution traces to a `customer_service`-sourced, projection-verified match to an *existing* `master_customer` row — every other source yields `identity_unresolved` → `null`. Given `master_customer` has 1 row today, `masterCustomerId` is `null` for effectively the entire real customer population at the moment CRM would want to call `/rfm`, while `customerId` is independently and much more often available.

### E. What value does requiring `masterCustomerId` actually add?

Today: none that outweighs its cost. It buys internal consistency with T11D's snapshot-time wiring choice (a real, but purely aesthetic, reason — see T11F's own stated rationale below) and nothing else; it costs RFM's reachability for the ~14,173-buyer active population that `master_customer`'s own lazy, human-gated design will not populate at matching scale (§3). Customer Profile's own `docs/releases/CP-R1-T11F-rfm-runtime-exposure.md:47-49` frames the choice honestly: *"T11F needed a deliberate exception... [because] persisted RFM snapshots are materialized and consumed against `master_customer.id`"* — i.e. the reason was "we'd already wired it that way in T11D," not a hard technical requirement discovered independently.

---

## 8. The `/rfm` endpoint

`GET /v1/customers/:masterCustomerId/rfm`, contrasted with the five `GET /v1/customers/:customerId/...` endpoints.

**Classification: B — deliberate, but self-admittedly a consistency choice, not a requirement discovered from first principles (deuda histórica dressed as a deliberate decision).** It was made in good faith and is internally coherent with T11D's earlier choice to denormalize `master_customer_id` at snapshot time — but that earlier choice was itself optional (§7), so the "deliberateness" here doesn't establish necessity, only sequencing (T11D happened before anyone asked whether `masterCustomerId` needed to be public at all). The technically-equivalent alternative (`getCurrentPrestashopCustomerRfm`) already existed in the codebase when T11F was written and was not chosen for the public contract — T11F's own doc doesn't mention or rule it out, suggesting it wasn't evaluated as an alternative at the time, not that it was rejected on merit.

Behavior otherwise (re-confirmed by direct read of `src/http/routes/index.ts:247-280,410-420`): `400` invalid id/unsupported query/body, `404` for `customer_not_found`/`rfm_not_available`, `503` only for `no_published_rfm_snapshot`, and — the one real inconsistency versus the other five endpoints — **any infrastructure failure (RFM DB down, CRM DB down on the not-found branch) falls through to a generic `500`**, where the other five endpoints map the same class of failure to `503 degraded`. Confirmed unchanged from the prior audit.

---

## 9. RFM consumers

| Consumer | Why it needs RFM | ID available | Call frequency | Required freshness |
|---|---|---|---|---|
| CRM-Customer-360 Sales Agent (`runNativeAgentToolLoopCycle.ts`) | One-shot LLM prompt evidence for the current commercial conversation turn — **contractually forbidden** from anything beyond that | `customerId` almost always available when a session exists; `masterCustomerId` only when independently, verifiably linked (currently ≈never, given 1 row) | Once per inbound customer message, fresh, uncached (no TTL/memoization anywhere in the path — confirmed by direct grep of `customer-profile-context/`) | Daily batch freshness is explicitly sufficient — no code or doc anywhere asks for tighter |

**No other consumer exists.** Confirmed independently by a full-repo grep across `app/`, `components/`, and `lib/` in CRM-Customer-360: zero UI dashboards, admin panels, or API routes reference RFM or any customer-profile field. `docs/CAPABILITY_MATRIX.md` has zero RFM mentions.

**What's consumed, precisely**: `recencyDays`, `frequencyOrders`, `grossOrderValueTaxIncl`, `averageOrderValueTaxIncl`, `recencyScore`, `frequencyScore`, `monetaryScore`, `rfmCode`, `segment.code`/`version`, snapshot metadata — all passed through verbatim into `commercialContextSummary.customerRfm` and injected into the LLM prompt (`buildAgentStepPromptPackage.ts:137-145`), which explicitly instructs the model: *"Never generate discounts, campaigns, promotions, follow-up rules, or other commercial policies solely from `customerRfm`"* and *"Never tell the customer an internal RFM segment name unless a human-designed policy explicitly requires it."* `constraints.mayAlterCatalogRanking`/`mayAutoExcludePurchasedProducts` are hardcoded `false`. A repo-wide grep of `followup/runFollowupTick.ts` and `followUpWorkerPolicy.ts` found **zero** RFM references — follow-up scheduling is entirely independent of RFM today, contrary to what a "future feature" reading of the brief might assume (§16).

---

## 10. Function of the RFM Snapshot DB

**Combination of: cache + immutable snapshot store + (nascent) feature store.** It exists to avoid recomputing R/F/M from 81,123 raw orders on every `/rfm` request, and to preserve a versioned, auditable, historically-comparable record (superseded snapshots are retained with `status='superseded'`, never deleted — `migrations/002`).

**Why snapshot instead of per-request calculation?** Cost and determinism: `create-rfm-snapshot.ts` does a full-population scan with checksum verification; doing that per HTTP request would be both slow and would make "current RFM value" a moving target within a single conversation. The daily-batch model is explicit (`docs/releases/CP-R1-T11G-...md`: *"expected snapshot frequency = daily"*).

**Why a separate DB?** Documented as a first-class, deliberate decision, not incidental: *"No se reutiliza `CRM_DB_*` para escribir snapshots"* (`docs/releases/CP-R1-T11A-population-rfm-dataset.md:55`). The reasoning (service-owned write boundary — Customer Profile should never need write credentials to CRM's database) is sound and this audit does not recommend changing it.

**Should it retain history?** Yes — already designed to (`superseded` status is retained, not deleted), and T11A3's own "analytical use-case validation" work explicitly wanted historical cohorts, so superseded snapshots already have identified future analytical value. No retention/pruning policy is defined yet — worth setting once volume grows, not currently blocking.

**Who should write?** Customer Profile's CLI only — already true, and correctly enforced (the HTTP process never writes to this DB; confirmed by re-reading `mysql-rfm-snapshot-repository.ts`, used only from `scripts/snapshots/`).

**Who should read?** Customer Profile's HTTP process only, directly. External consumers (CRM-Customer-360) should continue to read exclusively via the `/rfm` HTTP contract, never via direct DB access — already true, no counter-evidence found.

**Should Customer Profile HTTP ever write?** No — no evidence anywhere suggests it should, and doing so would blur the CLI/HTTP boundary that's currently clean.

---

## 11. Where the RFM Snapshot DB should physically live

| Option | Coupling | Permissions | Blast radius | Backup/Ops | Latency | Deployment | Ownership |
|---|---|---|---|---|---|---|---|
| 1. Schema inside CRM-Customer-360's RDS/`main_management` | High — ties RFM's lifecycle to CRM's, reintroducing exactly the coupling §13 flags as removable | Would require Customer Profile to hold write creds to a CRM-owned database | High — a bad RFM migration could affect CRM's schema surface | Unclear/unproven maturity given the `127.0.0.1` finding in §2 | N/A | Adds a dependency Customer Profile doesn't need | Ambiguous | **Rejected** |
| 2. Schema inside PrestaShop's RDS instance | Low — separate schema, separate credentials; PrestaShop's instance already hosts a sibling schema (`main_management`, per T01's own finding, so multi-schema-per-instance is an established pattern here) | Clean — new schema, scoped credentials, zero risk to `ps_*` tables | Low — isolated by schema/user | Inherits an already-real, managed RDS instance's backup/HA "for free" | Lowest — same instance as the population source (`ps_customer`/`ps_orders`), minimizing cross-instance hops for the batch job | No new infra to provision, just a schema + user | Unambiguous — Customer Profile's own instance-adjacent schema | **Recommended** |
| 3. Separate, dedicated RDS instance | Lowest possible — zero blast radius to either PrestaShop or CRM | Cleanest | Lowest | Full independent control | Slightly higher (new network path) | Real new operational cost (provision/monitor/patch a new instance) | Fully independent | Premature — current load (tens of thousands of rows, daily batch, single flag-disabled consumer) doesn't justify the cost yet; revisit if §16's future consumers materialize |
| 4. "Own schema on an existing instance" (generic) | Same as Option 2 in practice — there is no other existing instance with the right ownership/access profile besides PrestaShop's | — | — | — | — | — | — | Equivalent to Option 2; treated as the same recommendation |

**Recommendation: Option 2/4 — a dedicated schema (e.g. `rfm_snapshot`) on the existing PrestaShop RDS instance, with its own scoped credentials.** This is a technical recommendation, not a financial estimate, per the brief's own instruction.

---

## 12. Boundary between Customer Profile and CRM

| Responsibility | PrestaShop | Customer Profile | CRM 360 | RFM Store |
|---|---|---|---|---|
| Customer master identity | Source data (`ps_customer`) | Consumes directly (`customerId`) | Owns `master_customer` (CRM-space identity) | Stores `prestashop_customer_id` as functional key + optional `master_customer_id` |
| Order history | Source of truth | Reads directly, serves via 4 endpoints | None | Reads via Customer Profile's population job only |
| Commercial summary | — | Computes & serves | Consumes via HTTP | — |
| RFM calculation | — | Owns (batch CLI) | None | — |
| RFM persistence | — | Owns (writes via CLI only) | None | Is the datastore |
| RFM serving | — | Owns (`/rfm` route) | None — consumer only | Read-only source for Customer Profile's HTTP process |
| Conversation state | — | None | Owns (`conversation`, `conversation_message`, `ai_*`) | — |
| Sales opportunities | — | None | Owns (`crm_opportunities`) | — |
| Sales Agent context | — | Supplies raw materials via HTTP | Owns (agent-loop, prompt building) | — |

This matrix already matches what's built for 8 of 9 rows — the codebase is not confused about boundaries in general. RFM serving is the one row where the public contract (§7, §8) doesn't yet match the calculation's actual PrestaShop-rooted nature.

---

## 13. Circular / cross-service dependency

The apparent cycle — `CRM → Customer Profile API → RFM → CRM DB` — **is a real, narrow coupling, not a deadlock-style architectural cycle.** There is no bidirectional data flow and no mutual writes: it is a single upstream read (Customer Profile → CRM, on `/rfm`'s not-found branch only, to disambiguate `customer_not_found` vs `rfm_not_available`) triggered by a downstream caller (CRM's Sales Agent) that happens to be the same organization's own database on the other end.

**Given `master_customer`'s current near-zero population, this "not-found" branch is not a rare edge case today — it is close to the common case**, since almost no `masterCustomerId` will resolve to a snapshot row. That makes this coupling more operationally significant right now than its design intent suggests.

**If CRM DB is down**: `Sales Agent → Customer Profile → RFM miss on snapshot table → live CRM query → CRM DB unreachable → exception → 500 internal_error` (not the `503` the other five endpoints would produce for an equivalent upstream failure, per §8). In practice this is low-severity today only because CRM-Customer-360's own loader wraps the entire profile-context fetch in a try/catch (`runNativeAgentToolLoopCycle.ts:447-477`) and fails open regardless — but the underlying dependency is real, and it is architecturally odd for a service CRM itself consumes to need to read back into CRM's own datastore to answer CRM's own agent. **Verdict: unnecessary coupling, not a hard requirement** — and it disappears as a side effect of §18's recommendation, since Customer Profile already has its own reliable, CRM-independent way to check customer existence (its PrestaShop pool) for the other five endpoints.

---

## 14. Architecture without a CRM dependency in RFM

```
PrestaShop customerId
        |
        v
RFM snapshot (population, calculation: already independent of CRM today)
        |
        v
GET /v1/customers/:customerId/rfm   (new/alternate route, reusing existing
                                      getCurrentPrestashopCustomerRfm)
        |
        v
CRM already knows customerId (sends it today for the other 5 endpoints)
```

**What would be lost, evaluated concretely:**

- `customer_not_found` semantics: nothing lost. Customer Profile already validates `ps_customer` existence directly (its own PrestaShop pool) for the other five endpoints — the identical check extends to `/rfm` without needing CRM at all, and arguably becomes *more* reliable, since PrestaShop has ~100% of the real population versus CRM's ~1 row.
- Identity linking: nothing lost. The optional `master_customer_id` enrichment column stays exactly as-is at snapshot-build time; it just stops being a public HTTP requirement.
- Sales Agent compatibility: improves. CRM already sends `customerId` for the other five endpoints today — this is zero new integration surface, not new work, and removes CRM's current burden of independently verifying a `masterCustomerId` link before it's even allowed to ask for RFM.
- Historical snapshots: no impact — rows already carry both ids.
- Migration requirements: removes urgency from migration 001 specifically for RFM's sake (§5H, §19) — it becomes optional enrichment infrastructure, not a blocker.

---

## 15. Customers PrestaShop knows but CRM doesn't (yet)

Case: a real PrestaShop customer, real purchase history, meaningful RFM, never interacted via WhatsApp/CRM, no `master_customer` row.

- **Should RFM exist for them?** Yes — and it already does. RFM's population is PrestaShop-rooted with no CRM gate (§6); this customer already has a computed snapshot row today, with `master_customer_id = NULL`. The only thing preventing Customer Profile from *returning* it is the arbitrary choice of public key (§7C, §8).
- **Should Customer Profile be able to return it?** Yes, per the above — this is purely a routing/contract decision, not a data-availability one.
- **Should `master_customer` be created ahead-of-time for ~14,000 customers?** No — this would contradict the system's own designed, test-enforced lazy/on-demand population model (§3), and would require either reviving the never-built T02A backfill job or writing a new bulk-insert path the codebase was explicitly designed against (migration `024`'s philosophy of never *"fabricating a provisional `master_customer`"*).
- **Should `master_customer` be created only on real CRM entry?** Yes — this is already the correct, working design; RFM simply should not be gated behind it.

This section's answer is the load-bearing conclusion of the whole audit: **RFM's identity model and `master_customer`'s population model are fundamentally different in shape** (RFM: complete, PrestaShop-rooted, daily-batch, every buyer; `master_customer`: sparse, CRM-rooted, lazy, human-gated), and forcing RFM's public contract through the sparse model is the root cause of RFM's current unreachability for real customers — not a DB provisioning problem, not a CRM population problem.

---

## 16. RFM as a future feature — evidence, not speculation

Evidence found (not invented): Customer Profile's own docs name only Sales Agent evidence as a validated use case (`docs/releases/CP-R1-T11H-cross-repo-reference.md`: *"RFM usado solo como evidencia interna del agente (no como policy comercial automatica, ranking o descuento)"*). CRM-Customer-360's T11H doc has exactly one forward-looking sentence, and it is explicitly undecided: *"Continuar con la exposicion controlada/consumo operacional del bloque RFM solo despues de estabilizar la suite ajena del repo y definir si el siguiente paso es un consumer adicional del CRM o rollout operacional del Sales Agent"* — no concrete campaign, segmentation, retention-scoring, or follow-up-prioritization design exists in either repo today, confirmed by a full grep of both `docs/` trees.

**Designing RFM exclusively around `masterCustomerId`/Sales Agent access patterns would be too narrow**, independent of current scope: RFM's calculation is already PrestaShop-rooted and covers the *entire* buyer population, most of whom will likely never have CRM presence. Any plausible future consumer named even implicitly in the ecosystem (campaign segmentation, retention analytics) would need to operate over that full population, not the CRM-linked subset — reinforcing §18's recommendation independent of today's single-consumer pragmatics.

---

## 17. Architecture recommendation

```
MODEL_A_CUSTOMER_PROFILE_OWNED
```

**Justification**: this is already what is built, not a proposed migration. Customer Profile owns calculation (`src/domain/customer-rfm`), persistence (`RFM_SNAPSHOT_DB`, migrations 002-004), and serving (`/rfm` route) — all in one deployable, with CRM-Customer-360 as a pure HTTP consumer via `lib/integrations/customer-profile/*`. Model B is ruled out (CRM has zero RFM tables, zero calculation code, zero persistence of raw R/F/M — confirmed by both agents' full-repo greps). Model C would apply if RFM's calculation/persistence lived in a service distinct from Customer Profile's other five endpoints; it does not — same repo, same Express app, same deployable. The corrective this audit recommends is not a change of ownership, it is a fix to the **public identity contract** (§18) and finishing what was already designed but left unprovisioned (RFM DB, §11) or unwired (`getCurrentPrestashopCustomerRfm`, §7C).

```
SOURCE OF TRUTH        PrestaShop (ps_customer, ps_orders)
       |
CALCULATION OWNER      Customer Profile (batch CLI, src/domain/customer-rfm)
       |
PERSISTENCE OWNER      Customer Profile (RFM Snapshot DB, own schema — §11)
       |
SERVING OWNER          Customer Profile (/v1/customers/:customerId/rfm — recommended
                        primary key; masterCustomerId kept as optional secondary lookup)
       |
CONSUMERS               CRM-Customer-360 Sales Agent (HTTP only, never direct DB access);
                        future consumers (campaign/analytics, if they materialize) via the
                        same HTTP contract, keyed by customerId
```

---

## 18. RFM identity decision

```
DUAL_ID_WITH_EXPLICIT_CONTRACT
```

With `customerId`/`prestashopCustomerId` promoted to **primary/required** (the inverse of today's exclusive `masterCustomerId`-only contract) and `masterCustomerId` demoted to **optional/secondary**, reusing the already-built, already-tested `getCurrentPrestashopCustomerRfm` path.

**Benefits**: makes `/rfm` reachable for the real, complete PrestaShop population immediately, with zero new backend work (the read path already exists); removes the CRM DB round-trip on the not-found branch (§13); unifies `/rfm`'s contract with the other five endpoints, which CRM-Customer-360 already calls successfully with `customerId` today — this is not new integration risk, it's reuse of an existing, working call pattern; keeps `masterCustomerId` available for CRM to use once/if it independently has a verified link, at no ongoing cost since the capability already exists.

**Risks**: `/rfm`'s public contract changes (breaking change for any hypothetical external consumer of the current `masterCustomerId`-only shape — but the only real consumer, CRM-Customer-360, is flag-disabled and would need a coordinated update regardless, per §9). Note explicitly: this recommendation does **not** touch the pre-existing, separate risk that CRM's own internal `identity.customerId` session value isn't formally verified to equal `ps_customer.id_customer` (§4) — that risk already exists for the other five endpoints today and is out of this audit's scope to resolve, only to flag as adjacent.

**Migration path**: additive, not destructive — add a `customerId`-keyed route alongside the existing `masterCustomerId`-keyed one (or make `masterCustomerId` an optional alternate parameter on the same route), update CRM-Customer-360's `http-client.ts` to call it, keep the old path live during transition. No data migration needed — both keys already exist on every snapshot row today.

**Compatibility**: full — nothing about the snapshot schema needs to change; this is purely an HTTP-layer and cross-repo client-wiring change.

---

## 19. Migration 001 decision

```
REWORK_BEFORE_APPLY
```

Not obsolete: the optional `master_customer_id` enrichment (§7, §18) still benefits from this column existing, and CRM-Customer-360's own onboarding/linking flows could plausibly want it in the future. Not ready to apply as designed: §5H's finding is decisive, not speculative — this migration currently lives in a repo that does not own `master_customer`'s schema history, untracked by the schema owner's own migration runner, which is a concrete, demonstrated drift risk (not a hypothetical one — CRM-Customer-360's own `024` migration shows this team has already hit and had to resolve a real migration-tracking collision). Not "needs more evidence" — the ownership mismatch is fully evidenced, not uncertain. **Rework = port/renumber this migration into CRM-Customer-360's own `migrations/` folder, tracked in its own `schema_migrations`, coordinated with that team, and only then applied** — and only against the confirmed real production `main_management` instance, which requires resolving the headline finding first.

---

## 20. RFM Snapshot DB definition

```
Purpose:      Durable, versioned, point-lookup-optimized snapshot of a periodically
              (daily) computed RFM score per PrestaShop customer — avoids recomputing
              from ~81k raw orders per request, preserves history for future analytics.
Owner:        Customer Profile (calculation + persistence + serving — Model A).
Writers:      Customer Profile's own CLI (npm run snapshot:rfm[:scheduled]) only.
              Never the HTTP process, never CRM, never PrestaShop.
Readers:      Customer Profile's HTTP process (/rfm route) only. External consumers
              read exclusively via HTTP, never direct DB access.
Required data: prestashop_customer_id (functional key, NOT NULL), R/F/M raw metrics,
              scores, rfmCode, snapshot metadata (window, calculation version, checksums),
              optional nullable master_customer_id enrichment.
Forbidden data: PII (name, email, rut, phone) — already correctly excluded by design.
              Migrations 002-004 contain zero PII columns; T11A's own guardrails abort
              the snapshot if the manifest contains PII fields. Recommend keeping this
              invariant explicit and enforced as the identity contract evolves (§18) —
              a customerId-primary model changes nothing here, since customerId is
              already a bare technical identifier, not PII.
Retention:    Keep superseded snapshots (already the design) — real analytical value
              per T11A3's own stated goals. Define an explicit retention/pruning window
              once volume grows; not currently blocking.
Recommended physical location: Dedicated schema on the existing PrestaShop RDS instance
              (§11, Option 2/4).
Required credentials/permissions: Recommend splitting CLI (read/write + DDL) from the
              HTTP server (read-only) — currently likely sharing one credential; worth
              tightening, not currently blocking.
```

---

## 21. `config.ts` policy decision

```
OPTIONAL
```

**Política B.** The evidence is unambiguous: RFM is a narrow, single-consumer (Sales Agent, currently flag-disabled) capability, not core to the other five endpoints or to basic service health — yet `src/config.ts:17-23` currently requires `RFM_SNAPSHOT_DB_*` unconditionally at the top-level schema, which means **the entire server, including all five unrelated endpoints and `/health`/`/health/ready`, cannot boot at all in this environment right now**, confirmed by direct import and by Gate 2's own reproduction. This is a boot-time coupling with no architectural justification once RFM is understood as a bounded, optional capability rather than a core one. Recommend: mark `RFM_SNAPSHOT_DB_*`/`RFM_CALCULATION_VERSION` `.optional()`, boot the server in an "RFM disabled" mode when absent, and have `/rfm` return an explicit `503 { status: 'degraded', reason: 'rfm_not_configured' }` (distinct from the existing `no_published_rfm_snapshot` reason) rather than crashing the whole process at import time.

---

## 22. Architecture diagrams

### CURRENT (verified)

```
PrestaShop RDS (pesas_productiva)
  ps_customer, ps_orders  ---read (direct)--->  Customer Profile
                                                     |  5 endpoints: customerId
                                                     |  RFM calc: ps_customer/ps_orders,
                                                     |    identityAuthority=prestashop_customer
                                                     v
                                              RFM Snapshot DB  [UNPROVISIONED]
                                                     |  write: CLI only
                                                     |  read: HTTP /rfm only
                                                     v
"main_management" (host UNRESOLVED -- see headline finding)
  master_customer (1 row, no prestashop_customer_id)
  conversation, ai_*, crm_opportunities, customer_external_identity, ...
       ^                                             ^
       | write (createMasterCustomer, manual         | read: checkCrmReadiness(),
       |   hub-UI action only)                        |   /rfm not-found branch,
       |                                               |   canonical identity resolver
  CRM-Customer-360 <--- HTTP: 5 endpoints (customerId) + /rfm (masterCustomerId, ~never
  (Sales Agent,               resolves given 1-row master_customer) --- Customer Profile
   agent-loop,
   flag-disabled)
```

### RECOMMENDED

```
PrestaShop RDS (pesas_productiva)
  ps_customer, ps_orders  ---read (direct)--->  Customer Profile
       |                                            |  5 endpoints: customerId
       |  (same instance,                           |  RFM calc: unchanged, PrestaShop-rooted
       |   new schema)                               |
       v                                             v
  rfm_snapshot (dedicated schema, own creds)  <--write (CLI only)-- Customer Profile
       |                                             |
       +----------------- read (HTTP /rfm) ----------+
                                                       |
                                          GET /v1/customers/:customerId/rfm  [PRIMARY]
                                          GET /v1/customers/:masterCustomerId/rfm  [optional,
                                                                                    unchanged]
                                                       |
"main_management" (real production host CONFIRMED     |
 via infra/ops -- resolves headline finding first)     |
  master_customer (populated lazily, on real CRM entry)|
       ^                                                |
       | write: unchanged (manual hub-UI / eventual     | read: only for the OPTIONAL
       |   Customer Service linkage, once wired)          masterCustomerId path;
       |                                                   no longer required for
  CRM-Customer-360 <---------- HTTP: same customerId ------  /rfm to function
  (Sales Agent)                 for all 6 endpoints now
```

---

## 23. Technical debt reclassification

| ID | Prior status | New status | Reason |
|---|---|---|---|
| TD-001 (`/health/ready` `crm` field) | Fixed (Gate 1) | **Resolved**, unchanged | Not touched by this audit's findings |
| TD-003 (identity split, `customerId` vs `masterCustomerId`) | CAN DEFER | **Raised to MUST FIX** | This audit shows a concrete fix (§18) and a concrete user-facing cost (RFM effectively unreachable for the real customer population under the current model) that the prior audit could not see without the ownership investigation done here |
| TD-004 (scheduler) | MUST FIX before RFM activation | Unchanged | Independent of everything found here |
| TD-005 (CRM flags) | MUST FIX (activation task) | Unchanged, but now sequenced after TD-003/new blockers | Flipping flags before the identity fix would activate a path that can't reach real customers |
| TD-007 (RFM config schema drift) | SHOULD FIX | Unchanged | Independent |
| TD-008 (real DB validation) | CAN DEFER / BLOCKED | Unchanged, still blocked, but now unblockable without CRM population as a co-requirement (see §24) | RFM no longer needs CRM population to function once TD-003 lands |
| TD-013 (CRM dependency in bootstrap) | P2, narrowly scoped to the readiness bug | **Superseded/broadened** | The literal bootstrap bug is fixed (Gate 1); the broader concept — an unnecessary live CRM read on `/rfm`'s not-found path — is now understood as removable, not just tolerable (§13) |
| **NEW: TD-014** | — | New, HIGH | `/rfm`'s `masterCustomerId`-only public contract structurally excludes the ~72k-customer real population with no CRM presence, inconsistent with the other 5 endpoints' `customerId` model (§7, §8, §18) |
| **NEW: TD-015** | — | New, MEDIUM | Migration 001 lives in Customer Profile's repo but alters a table CRM-Customer-360 owns and migrates independently — untracked in CRM's own `schema_migrations`, real drift risk (§5H, §19) |
| **NEW: TD-016 (BLOCKER)** | — | New, **highest priority of all** | Unresolved discrepancy between the RDS host Customer Profile's `CRM_DB_*` config implies (same instance as PrestaShop, per T01) and CRM-Customer-360's committed `.env` (`DB_HOST=127.0.0.1`) — cannot confirm Gate 2 validated against the actual production Sales Agent database (headline finding, §2E) |

**Technical debts made obsolete**: none outright. TD-003 and TD-013 are upgraded/broadened, not dropped.

---

## 24. Recommended sequence from here

```
Step 1 — Resolve TD-016 (infra/ops question, not code)
  Confirm with whoever operates CRM-Customer-360's production deployment which physical
  host DB_HOST actually resolves to at runtime, and whether it is the same instance
  Customer Profile's CRM_DB_* points at. Nothing CRM-derived (readiness, RFM not-found
  disambiguation, migration 001's real target) can be trusted until this is answered.

Step 2 — Architecture correction: identity contract decision (§18)
  Decide and document (design doc, no code) the customerId-primary / masterCustomerId-
  optional model for /rfm. Needs sign-off since it changes a committed T11F contract.

Step 3 — Re-home migration 001 (§19), only after Step 1
  Port it into CRM-Customer-360's own migrations/ folder, coordinated with that team,
  tracked in its own schema_migrations. Apply only against the confirmed real instance.

Step 4 — Implement the customerId-keyed /rfm route
  Wire the already-built getCurrentPrestashopCustomerRfm path to HTTP; keep the existing
  masterCustomerId route as secondary. Update CRM-Customer-360's http-client.ts to call
  the new contract (coordinated cross-repo change, both repos' tests updated).

Step 5 — Fix config.ts (§21)
  Make RFM_SNAPSHOT_DB_*/RFM_CALCULATION_VERSION optional; server boots without RFM
  configured; /rfm returns an explicit rfm_not_configured degraded response instead of
  crashing the whole process.

Step 6 — Provision the RFM Snapshot DB (§11)
  Dedicated schema on the existing PrestaShop RDS instance, scoped credentials.

Step 7 — Re-run real-infrastructure validation (old Gate 2, reworked)
  Now unblocked by Steps 1/5/6 WITHOUT needing CRM/master_customer population at all —
  population is entirely PrestaShop-rooted (§6, §15). The old Gate 2's "CRM env with
  migration 001 applied and populated" co-requirement is no longer a blocker for RFM to
  function; it only matters for the now-optional masterCustomerId enrichment path.

Step 8 — Scheduler (old TD-004)
  Stand up the external cron for snapshot:rfm:scheduled. Independent, can run in
  parallel with Steps 2-7.

Step 9 — Flip CRM-Customer-360's feature flags (old Gate 4)
  Now safe: RFM is reachable for the real customer population, not gated behind
  master_customer's near-empty state.
```

---

## Restrictions honored

No implementation. No DB provisioned. No migration applied. No `.env` modified. No code modified. No commit, no push, no PR. Only this document was created; no other file was touched.
