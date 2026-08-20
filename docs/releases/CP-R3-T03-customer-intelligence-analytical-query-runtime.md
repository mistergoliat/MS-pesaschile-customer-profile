# CP-R3-T03 — Customer Intelligence Analytical Query Runtime

Status: **READY_WITH_CONSTRAINTS** (local implementation + full local test suite complete; SQL
shape verified by 105 new tests including a full example-plan compile smoke; live
`EXPLAIN`/latency measurement deferred alongside CP-R3-T01/T02's own pending EC2 persistence
smoke — same root cause, this dev machine has no reachable MariaDB)
Git branch: `feat/cp-r3-t03-analytical-query-runtime` (based on `main` @ `c4fa1f1`, which already
carries CP-R3-T01+T02 merged via PR #17)
Type: new, read-only, bounded query-compilation layer over the CP-R3-T02 Customer Intelligence
Read Model. No RFM, clustering, Customer Analytics Data Layer, or Customer Intelligence T02
behavior changed — additive only.

---

## 1. Objective

A deterministic, bounded analytical query engine — schema registry + plan validator + SQL
compiler + executor — that lets a future Copilot LLM express "how many customers per cluster",
"which cluster has the highest AOV", "what % of AT_RISK_HIGH_VALUE falls in each cluster" and
similar questions as one structured `AnalyticalQueryPlan`, without a growing catalog of
hand-written per-question functions (task Section 1) and without ever accepting raw SQL (task
Section 3). **No LLM is built here** — T03 is the deterministic engine a future LLM will call
after turning natural language into a plan (task Section 73).

**Not built in T03** (explicit non-goals): LLM/Copilot, generic arbitrary SQL executor, Segment
Engine, Brevo, cart abandonment, campaign execution, Sales Agent integration, scheduler,
Marketing UI, bulk/generic-query HTTP endpoint, multi-turn conversation state, saved segments,
PII activation/export.

## 2. Architecture

```
Analytical Schema Registry (domain, pure — schema-registry.ts)
        |  30 fields: customer.* / commercial.* / rfm.* / cluster.*
        v
AnalyticalQueryPlan (untrusted JSON — a future LLM's output, or a CLI --file=)
        |
        v
Query Validator (domain, pure — validator.ts)
        |  rejects unknown fields/operators/aggregations, unsafe limits, injection-shaped
        |  aliases, mode ambiguity, complexity overruns — BEFORE any DB call
        v
SQL Compiler (domain, pure — compiler.ts)
        |  NormalizedAnalyticalQueryPlan + resolved snapshot ids -> {sql, params}
        |  every identifier from the static registry; every value a `?` placeholder
        v
CustomerIntelligenceQuery Executor (application + infrastructure)
        |  application/execute-analytical-query.ts: reuses T02's context resolvers verbatim,
        |  never re-derives a snapshot id
        |  infrastructure/mysql-analytical-query-executor.ts: SELECT-only guard,
        |  ANALYTICS_DB_QUERY_TIMEOUT_MS via the shared QueryExecutor seam
        v
customer_feature_snapshot_row LEFT JOIN customer_rfm_snapshot_row
                               LEFT JOIN customer_cluster_snapshot_row
                               LEFT JOIN customer_cluster_model
                               LEFT JOIN customer_cluster_interpretation   (local MariaDB only)
        v
AnalyticalQueryResult  (provenance + columns + rows + execution stats + queryPlanHash)
```

CLI entry point: `npm run intelligence:query -- --file=<plan.json> [--feature-snapshot-id=17]`
(`scripts/intelligence/query.ts`). Five example plans live in
`scripts/intelligence/examples/*.json` (task Section 49).

## 3. Reuse, not redefinition (task Section 27/31/32 — the load-bearing constraint)

| What | Reused from | Never redefined |
|---|---|---|
| Snapshot context resolution (feature-anchored, RFM/cluster at-or-before) | `createCustomerIntelligenceContextResolvers()` (CP-R3-T02) — called verbatim, both `resolveCurrent`/`resolveForFeatureSnapshot` | The future-snapshot guard, `selectLatestSnapshotAtOrBefore()` |
| FROM/JOIN population shape (feature = base, LEFT JOIN RFM, LEFT JOIN cluster, never INNER) | CP-R3-T02's `mysql-customer-intelligence-reader.ts` topology, reproduced identically in `compiler.ts` | RFM/clustering scoring or assignment — never recomputed (task Section 50/51) |
| Cluster interpretation "latest `interpretation_version` wins per `(model_id, cluster_id)`" | `customer_cluster_interpretation`'s own `id`-ordering rule (CP-R2-T03's `getInterpretations()`), reproduced as a correlated-subquery JOIN condition so `cluster.label`/`description` can be a SQL-groupable column (T02's reader merges it in application code instead, since it never needed GROUP BY) | Interpretation label/description assignment |
| `ANALYTICS_DB_*` config, error taxonomy, query-timeout seam | `mapAnalyticsReadError`, `createQueryExecutor`/`getAnalyticsQueryExecutor()` (CP-R3-T01) | A fourth, `INTELLIGENCE_DB_*`-flavored error type or timeout mechanism |
| PII guard pattern | Own copy, matching `customer-intelligence/pii-guard.ts`'s explicit precedent of never sharing this cross-capability (see that file's own header comment) | — |

**What genuinely had no existing home and was built new**: the schema registry, plan validator,
SQL compiler, and plan hash — a bounded, LLM-facing query surface is a new capability by
definition (task Section 1), not a second definition of anything RFM/clustering/T01/T02 already
had.

## 4. Analytical Schema Registry (task Section 8/9/34)

30 fields — `customer.customerId` (1) + `commercial.*` (18, identical to CP-R3-T01's
`CustomerFeatureRow`) + `rfm.*` (5) + `cluster.*` (6) — each with `{logicalName, type, nullable,
source, allowedOperators, allowedAggregations, description}`. Descriptions reuse the task's own
exact wording where given (`commercial.totalSpentTaxIncl`, `rfm.segmentCode`,
`cluster.clusterId`) rather than inventing new semantics (task Section 35).

**Never exposed as a queryable field** (task Section 8, documented decision, not an oversight):
`rfm.calculationVersion` / any snapshot id. These are constants for the whole result — already
guaranteed present on every `AnalyticalQueryResult.context` (task Section 20/36). `cluster.
modelVersion` is intentionally queryable too because the task's schema contract asks for it and
because it reinforces the model-scoped meaning of `cluster.clusterId`.

**Public vs. internal split** (task Section 8's explicit instruction — "do NOT expose physical DB
identifiers"): each registry entry also carries an internal `sqlExpression` (e.g.
`fr.valid_orders`, `ci.label`) used only by the compiler. `getAnalyticalSchema()` (application
layer) strips it before returning — verified by a dedicated test asserting no field in the public
schema payload has an `sqlExpression` key or contains any physical table/column text.

Type-driven operator/aggregation sets (task Section 14/16/58) — one shared rule per data type,
not hand-curated per field:

| Type | Operators | Aggregations |
|---|---|---|
| integer / decimal | eq, neq, gt, gte, lt, lte, between, in, not_in, is_null, is_not_null | count, count_distinct, sum, avg, min, max |
| string | eq, neq, in, not_in, is_null, is_not_null | count, count_distinct, min, max |
| datetime | eq, neq, gt, gte, lt, lte, between, is_null, is_not_null | count, count_distinct, min, max |

This is exactly why `SUM(cluster.label)` and `AVG(rfm.segmentCode)` fail (task Section 58's exact
test cases) — a structural consequence of the type rule, not a special case.

## 5. Query Plan contract and Boolean logic (task Section 10/15)

`customer-intelligence-query-plan-v1`. Row mode (`select`, no `metrics`) and aggregate mode
(`dimensions`?/`metrics`, no `select`) are mutually exclusive — a plan with both, or with
`dimensions` but no `metrics` (ambiguous grouping without aggregation, task Section 40), is
rejected before compilation.

Filters: a bare top-level array is sugar for an implicit AND (task Section 11's own examples);
`{and:[...]}` / `{or:[...]}` nest to a bounded depth (`MAX_FILTER_DEPTH = 5`). No full expression
language, no regex, no raw SQL fragments (task Section 14/15) — a safe, bounded tree, per the
task's own explicit preference.

## 6. Query Validator (task Section 25/26/56-58/63)

Rejects, before any DB call: unknown fields (including an injection-shaped field name — it can
only ever fail a registry `Map.get`, never reach SQL text), unsupported operators, operators not
allowed for a field's type, unsupported aggregations, wrong-type/wrong-arity filter values
(`between` != 2 elements, `in`/`not_in` empty or >500 elements, a `null` value with `eq` instead
of `is_null`), duplicate aliases, an unsafe metric alias (see Section 8 below), invalid `orderBy`
references, mixed row/aggregate mode, and every complexity limit:

| Limit | Value |
|---|---|
| Max filter conditions | 20 |
| Max filter nesting depth | 5 |
| Max dimensions | 5 |
| Max metrics | 10 |
| Max `IN`/`NOT IN` values | 500 |
| Default `limit` | 100 |
| Max `limit` (row and aggregate mode alike) | 1,000 |

An out-of-range `limit` is **rejected, never silently clamped** (task Section 26) — a validator
that quietly rewrites an "unsafe" plan into a smaller one would misrepresent what actually ran.

**Median** (task Section 16): **deferred**, not faked. No local MariaDB was reachable to confirm
this deployment's version supports `PERCENTILE_CONT` (MariaDB-specific, added 10.3.3+); the task
explicitly says not to fake it if awkward. `min`/`max`/`avg` remain available today; median is a
clean additive extension once a version check (or an application-side computation over a
small, already-grouped result set) is confirmed safe — not built speculatively.

## 7. SQL Compiler (task Section 24/29/32/33/40-42)

Pure, deterministic, no I/O (`src/domain/customer-intelligence-query/compiler.ts`) — a distinct,
independently-testable stage from execution, kept in `domain/` alongside the registry/validator
for the same reason `schema-registry.ts`'s `sqlExpression` lives there: it is pure data/string
composition, never a DB call (see that file's own header comment for the full reasoning).

Reproduces CP-R3-T02's exact FROM/JOIN topology — `customer_feature_snapshot_row` as the base
population, `LEFT JOIN` RFM, `LEFT JOIN` cluster, same `'0'` no-snapshot sentinel — plus two
additions: `LEFT JOIN customer_cluster_model` for `cluster.modelVersion`, and `LEFT JOIN
customer_cluster_interpretation` (correlated-subquery "latest id wins per model+cluster") so
`cluster.label`/`description` can be a `GROUP BY`/`SELECT` column, which T02's reader never needed
since it merges interpretation in application code instead.

**Read-only by construction** (task Section 28): the compiler has no code path that can emit
anything but one `SELECT ... FROM ... [WHERE ...] [GROUP BY ...] [ORDER BY ...] LIMIT ?`
statement — verified by a dedicated test compiling several representative plans and asserting the
output starts with `SELECT` and contains no `INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/CALL/SET/…`
keyword anywhere. The infrastructure executor adds one more assertion of the same invariant as
defense in depth (task Section 22/28), not the primary control.

**Parameterization** (task Section 23/57): every value is a `?` placeholder; every identifier
(table, column, alias) comes exclusively from the static registry or a validator-checked safe
alias pattern (`^[A-Za-z_][A-Za-z0-9_]*$`) — a user-supplied metric alias is the one place a
plan-controlled string is ever embedded as SQL text (inside `` `backticks` `` for `AS`/`GROUP
BY`/`ORDER BY`, since SQL cannot parameterize an identifier), so the validator enforces that
pattern specifically to prevent an alias like `` x` ; DROP TABLE -- `` from breaking out of the
quoting. A dedicated compiler test proves a malicious filter *value* (`' OR 1=1 --`) never appears
in the compiled SQL text, only in the bound `params` array.

**No arbitrary joins** (task Section 29): the compiler's join topology is fixed; a plan can only
ever select fields from the registry, never influence which tables are joined or how.

## 8. Execution and the three Copilot-facing capabilities (task Section 46/74)

`src/application/customer-intelligence-query/`:

- `getAnalyticalSchema()` — the machine-readable dictionary (task Section 34).
- `validateAnalyticalQueryPlan(plan)` — thin re-export of the domain validator (task Section 27
  precedent applied here too: no second definition).
- `createExecuteAnalyticalQuery({resolveCurrent, resolveForFeatureSnapshot, queryExecutor})` —
  validates, resolves context through T02's own resolvers (current or historical, task Section
  19/30/31), compiles, executes, and maps the raw DB rows into `AnalyticalQueryResult`. Never
  computes a snapshot id itself — a dedicated test asserts the exact `resolvedIds` T02's resolver
  returned are what the compiled SQL is parameterized with (task Section 59).

`AnalyticalQueryExecutor` (`ports.ts`) is a one-method port —
`execute(compiled): Promise<Record<string,unknown>[]>` — implemented by
`infrastructure/customer-intelligence-query/mysql-analytical-query-executor.ts`, which wraps the
already-existing `QueryExecutor` seam (`infrastructure/shared/query-executor.ts`) rather than a
raw `Pool`, so `ANALYTICS_DB_QUERY_TIMEOUT_MS` (task Section 27) is enforced by code that already
exists (`getAnalyticsQueryExecutor()`, CP-R3-T01), not a second timeout mechanism. Errors map
through the same `mapAnalyticsReadError` taxonomy CP-R3-T01/T02 already established — never a
fourth, `INTELLIGENCE_DB_*`-flavored error type (task Section 64).

## 9. Result contract and provenance (task Section 20/21/29/60/68/69)

`customer-intelligence-query-v1`. Every successful result carries: `queryPlanHash` (canonical
SHA-256 over the defaults-filled, physical-identifier-free plan — task Section 69, reuses
`sha256Stable` from `customer-rfm/checksum.ts`, the same cross-domain import every other checksum
in this codebase already uses), the full `CustomerIntelligenceSnapshotContext` from T02
(feature/RFM/cluster snapshot refs + population coverage, never a bare model output without its
snapshot, task Section 29), typed `columns`, `rows`, `rowCount`, and `execution: {durationMs,
truncated}`. **No SQL string or bound parameters on this contract** (task Section 21/22) — those
exist only as the internal `CompiledAnalyticalQuery` a test can inspect directly.

**Type conversion policy** (task Section 70, tested): this service's `mysql2` pool is configured
`bigNumberStrings: true` — `DECIMAL` columns (and `SUM`/`AVG` results, which MariaDB returns as
`DECIMAL`) arrive as exact strings and are returned as-is, never parsed to a lossy `float`.
`COUNT()`/`COUNT(DISTINCT)` return `BIGINT` (also a string under this config) and are parsed back
to a JS number — safe because the whole population (~45k) is far below
`Number.MAX_SAFE_INTEGER`. Plain `INT` columns and `MIN`/`MAX` over an integer field stay JS
numbers. `datetime` cells normalize to ISO 8601. All four paths are unit-tested.

**Truncation** (task Section 21/43): the compiler always requests `limit + 1` rows (the same
trick T02's own `listRows` uses); the application layer slices to `limit` and sets
`execution.truncated` — never a second `COUNT` query, never unbounded output in either row or
aggregate mode.

## 10. Population/NULL semantics (task Section 9/18/54 — unchanged from T02)

`LEFT JOIN` throughout — a filter is the only thing that can exclude a row; the base population
is never implicitly narrowed to "has RFM" or "has cluster". `cluster.clusterId IS NULL` correctly
selects customers outside the clustering population (e.g. one-time buyers) — this is a real,
tested query shape (task Section 18/54), not an edge case that silently drops rows.

## 11. Complexity/security tests (task Section 56-58/63)

- Unknown field (including an injection-shaped field name) → rejected pre-DB.
- Injection-shaped filter *value* → validated as an ordinary string, then proven (compiler test)
  to remain a bound `?` parameter, never SQL text.
- `SUM(cluster.label)`, `AVG(rfm.segmentCode)` → rejected (type-based aggregation rule).
- Every complexity limit (filters/dimensions/metrics/nesting depth/`IN` values/`limit`) has a
  dedicated boundary test.
- A malicious metric alias (`` x` ; DROP TABLE -- ``) is rejected by the safe-alias pattern before
  it could ever reach SQL text.

## 12. Tests (task Section 56 — full list)

105 new tests across 8 new files, alongside the pre-existing 1230 (1335 total, all passing):

- `customer-intelligence-query-validator.test.ts` (50) — mode resolution, unknown fields,
  operators, aggregations, aliases, `orderBy`, limits, boolean logic, every complexity limit.
- `customer-intelligence-query-compiler.test.ts` (15) — FROM/JOIN topology, the task's own
  worked examples (cluster distribution, RFM distribution, cross-tab, AOV-by-cluster), numeric
  AND filter, `IS NULL` filter, `IN`/`BETWEEN`, nested OR, row-mode top-100, read-only-by-
  construction across representative plans, injection stays bound.
- `customer-intelligence-query-plan-hash.test.ts` (6) — determinism, defaults-filled equivalence,
  alias/value/mode sensitivity.
- `customer-intelligence-query-schema-registry.test.ts` (9) — field count/shape, nullable
  fields, exact task-provided descriptions, type-based operator/aggregation sets, no PII
  substrings.
- `get-analytical-schema.test.ts` (4) — version stamps, no physical identifier leak, PII guard.
- `execute-analytical-query.test.ts` (16) — validation gate (DB never touched on an invalid
  plan), snapshot-context passthrough (all four T02 statuses), the resolvedIds-reuse guarantee
  (task Section 59), provenance, `queryPlanHash`, the cluster-distribution/RFM×cluster-cross-tab
  worked fixtures (task Section 50-52, hand-computed — see Section 13 below), numeric/null
  filters reaching the compiled SQL, row-mode truncation, decimal/datetime conversion.
- `mysql-analytical-query-executor.test.ts` (4) — pass-through, SELECT-only guard, timeout/
  unavailable error mapping.
- `customer-intelligence-query-no-prestashop-dependency.test.ts` (1) — task Section 6/38/62,
  structurally identical to T02's own test, scoped to the three new `src/` directories
  (`scripts/intelligence/query.ts` is already covered by T02's existing scan of the whole
  `scripts/intelligence` directory — not re-scanned a second time).

`typecheck`: PASS. `lint`: PASS. `build`: PASS. All 5 example plans
(`scripts/intelligence/examples/*.json`) independently verified to validate and compile against a
representative fixture context (see Section 14).

## 13. RFM × Cluster cross-tab parity (task Section 52)

**PASS, via an independent hand-computed fixture** — not by calling CP-R2-T03's own cross-tab
reader, which the task explicitly said is not required ("Do not require identical API shape").
`execute-analytical-query.test.ts`'s cross-tab test feeds a fixture with known
`(clusterId, segmentCode)` counts (3/1/2, total 6) through the real
validate→compile→execute→map pipeline and asserts the output matches the hand-computed
distribution exactly — proof that grouping by two dimensions at once produces correct,
non-duplicated counts, the same semantic guarantee CP-R2-T03's own cross-tab provides, arrived at
through this task's own generic engine rather than a second bespoke cross-tab implementation.

## 14. Live validation status (task Section 57/58/65/66)

No MariaDB reachable from this development machine — the same constraint CP-R3-T01/T02 already
documented. What **was** verified without a live DB:

- All 5 example plans (`scripts/intelligence/examples/*.json`) independently loaded, validated,
  and compiled against a representative fixture context — every one produces the exact, readable
  SQL shown in this doc's Section 7 pattern (verified by hand during implementation; the
  compiler's own unit tests assert the same shapes programmatically).
- `npm run intelligence:query -- --file=scripts/intelligence/examples/cluster-distribution.json`
  smoke-run locally: fails closed with the exact `ANALYTICS_DB_* is not configured` message shape
  T01/T02's own CLIs produce, confirming config wiring end-to-end without a live connection.
- `EXPLAIN`/live join-latency measurement (task Section 35/65/66): **not performed** — deferred
  alongside T01's own pending EC2 persistence smoke. Every join key the compiler's FROM/JOIN
  clause uses (`snapshot_id` + `prestashop_customer_id`, `model_id` + `cluster_id`) already has a
  `UNIQUE`/`KEY` per migrations 002/005/008 — the same indexing basis T02's own doc relied on for
  its (also unmeasured) performance expectation.

## 15. Known limitations / deferred

- Live `EXPLAIN`/latency measurement — no local MariaDB (Section 14).
- Median aggregation — deferred, not faked (Section 6).
- No dedicated read-only analytics credential (task Section 43/67) — same `ANALYTICS_DB_*`
  writer-capable credential reused as-is; documented as a future hardening step, not provisioned
  here (same posture T02 already took).
- No generic/bulk query HTTP endpoint (task Section 47 — deliberately not built; internal
  application capability + CLI only).
- No multi-turn conversation state or saved-segment persistence (task Section 75/76) — the plan
  is already a fully serializable, structured object, so both are additive extensions later, not
  precluded by anything built here.
- CP-R3-T01 EC2 live persistence smoke — unchanged, still PENDING (not this task's scope, task
  Section 58 in T02's own doc, restated here per this task's Section 0).
- Copilot/LLM layer, Segment Engine, Brevo, cart features, Marketing UI, Sales Agent integration —
  all explicitly out of scope, none built.

## 16. Definition of Done — checklist (task Section 80)

- [x] Analytical schema registry exists (30 fields, typed, described)
- [x] Fields are typed (`integer`/`decimal`/`string`/`datetime`)
- [x] Operators are bounded (type-driven allowlist, no regex/raw SQL)
- [x] Aggregations are bounded (type-driven allowlist)
- [x] Query plan is versioned (`customer-intelligence-query-plan-v1`)
- [x] Validator rejects invalid plans (50 dedicated tests)
- [x] SQL is parameterized (every value a `?`, tested against an injection value)
- [x] Identifiers come only from the registry (+ a validated safe-alias pattern for user aliases)
- [x] SELECT-only by construction (structural test + infra-layer defense-in-depth guard)
- [x] Snapshot context comes from T02 (never re-derived — dedicated wiring test)
- [x] Feature population semantics preserved (`LEFT JOIN` throughout, never `INNER`)
- [x] RFM/cluster nullable semantics preserved (`IS NULL` fixture test)
- [x] Row mode works · Aggregate mode works · Grouping works · Filtering works · Ordering works ·
      Limit works
- [x] Provenance included on every result
- [x] Deterministic plan hash works (6 dedicated tests)
- [x] Complexity limits work (filters/dimensions/metrics/depth/`IN` values/limit, each tested)
- [x] No PII (own PII-guard copy + dedicated test)
- [x] No PrestaShop dependency (structurally tested)
- [x] Tests pass (1335/1335) · typecheck/lint/build pass
