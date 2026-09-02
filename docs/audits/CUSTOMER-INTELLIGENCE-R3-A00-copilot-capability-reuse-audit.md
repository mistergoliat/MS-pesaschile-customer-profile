# CUSTOMER-INTELLIGENCE-R3-A00 — Copilot Capability Reuse Audit

**Repository:** `MS-pesaschile-customer-profile`  
**Mode:** audit only  
**Date:** 2026-09-01  
**Scope:** current production Copilot, Customer Intelligence read models, analytical runtime, session state, provider adapters, HTTP wiring, persistence, and tests. No production code, migration, prompt, HTTP contract, or provider dependency was changed.

## 1. Executive verdict

**PRIMARY_VERDICT:** `REUSE_PARTIAL_WITH_SIGNIFICANT_REFACTOR`

The architectural hypothesis is feasible, but only if “capability” means the deterministic Customer Intelligence data/runtime layer and a small amount of deterministic context/provenance state. It is not feasible as a direct replacement of the current `CustomerIntelligenceCopilotModel` implementation or of the current session service.

**ESTIMATED_REUSABLE_PERCENT:** approximately **65% by semantic/runtime surface**, or approximately **45% of the current Copilot-specific code**. The first estimate includes the query runtime, snapshot resolution, provenance, result validation, deterministic business semantics, UI population evaluation, and persistence primitives. The second reflects that `session-service.ts` contains most of the current orchestration and presentation behavior and must be split before another brain can safely use it.

### Directly reusable

- `src/domain/customer-intelligence-query/`: logical schema, type/operator/aggregation validation, bounded filter tree, canonicalization, plan hash, parameterized compiler, PII guard, typed result contract.
- `src/application/customer-intelligence-query/`: schema publication, validation facade, context-aware execution, export execution.
- `src/infrastructure/customer-intelligence-query/mysql-analytical-query-executor.ts` and the existing analytics timeout/error seam.
- `src/application/customer-intelligence/resolve-customer-intelligence-context.ts`: feature snapshot as anchor, compatible RFM/cluster selection, coverage and provenance.
- `src/application/customer-intelligence-intersection/execute-intersection.ts`: deterministic population evaluation and shared UI scope semantics.
- deterministic portions of `session-context.ts`, `ui-context.ts`, `business-semantics.ts`, result retention, provenance, result validation, and failure taxonomy after extraction.
- the abstract `CopilotSessionStore` concept and the persisted snapshot/result/reference records, subject to TTL/concurrency fixes.
- HTTP authentication/envelope behavior only at the compatibility boundary; it should not be part of a Harness capability.

### Requires adapter

- compact model-facing query shape to canonical `AnalyticalQueryPlan`.
- capability metadata/schema publication and capability invocation context.
- `run_analytical_queries` tool-call translation from OpenAI-compatible native tool calls to a neutral invocation.
- result envelope normalization for Harness, including provenance, truncation, and typed cells.
- session-native history to deterministic application state projection.
- UI selected-population scope to every executed analytical plan.
- optional customer/profile capability wrappers if CLV, affinity, or Commercial Profile must become callable by the new brain.
- observability mapping from provider-specific metadata to a provider-neutral turn/capability trace.

### Brain-specific code to replace

- planner/orchestrator/unified-planner decision flow.
- prompt construction and prompt versions.
- `answer_from_context` and source-query selection as model-facing actions.
- provider-specific repair loops and OpenAI-compatible tool message protocol.
- current native tool runtime's single-call policy and tool-call parser.
- answer synthesis prompts and the model answerer, except for deterministic renderer/fallback logic that should be extracted as a guarded result presentation capability.

### High-risk couplings

1. `src/application/customer-intelligence-copilot-session/session-service.ts` combines turn lifecycle, orchestration, capability execution, context projection, deterministic rendering, synthesis fallback, errors, export, and observability in one module.
2. The current session context is simultaneously a persisted application state, a prompt projection, and an orchestration control surface.
3. The semantic anchor and primary finding are derived from result shape, but the current brain is allowed to choose source query ids and instructions.
4. UI scope composition is enforced in application code, but also described in prompts; losing the application enforcement would permit silent scope drift.
5. The existing provider interface exposes stages (`orchestrator`, `planner`, `answerer`, native tool selection/synthesis), not a neutral brain contract.
6. The query runtime has no CLV or Commercial Affinity fields. The current Commercial Profile endpoint has them, but the Copilot cannot call that profile today.
7. MySQL session persistence rewrites child messages/queries and does not enforce the in-memory TTL/concurrency behavior identically.

### Explicit verdicts

**ANALYTICAL_RUNTIME_VERDICT:** `YES_WITH_REFACTOR`. The deterministic runtime is already mostly neutral; publish it behind a capability boundary, keep compact query syntax as an adapter concern, and add authorization/budget context before autonomous Harness access.

**CONTEXT_STATE_VERDICT:** Keep deterministic snapshot pinning, result/provenance/reference state, semantic anchor/finding, UI scope, clarification lifecycle, and bounded retention in the application. Let a Harness own conversational history only as a session-native memory projection. Do not let Harness memory become the source of truth for data, snapshot identity, or provenance.

**HARNESS_ADAPTER_FEASIBILITY:** feasible, with a medium/high extraction effort. A first adapter can expose one read-only analytical capability without changing the existing endpoint. A safe adapter cannot simply pass the current OpenAI tool schema through.

**AUDIENCE_ENGINE_PLACEMENT:** `audience.evaluate` belongs beside `customer-intelligence-intersection` as a deterministic, read-only capability over validated filter trees and snapshot context. `audience.export` belongs in an application/export boundary and must remain an explicit user-authorized operation; it should not be an autonomous Harness capability by default.

**PROPOSED_NEXT_RELEASE:** R3-A01, a no-behavior-change neutral capability boundary for the existing analytical runtime and deterministic context/provenance primitives. Do not begin Harness cutover before its contract tests pass against both the current brain and an adapter stub.

## 2. Current architecture map

```text
HTTP routes
  ├─ stateless POST /v1/customer-intelligence/copilot
  │    └─ answer-customer-intelligence-question
  │         └─ planner → validation/repair → analytical execution → answerer
  └─ session routes
       └─ customer-intelligence-copilot-session/session-service
            ├─ uiContext resolution / intersection
            ├─ legacy orchestrator + planner + answerer
            ├─ unified planner + answerer
            ├─ native tool selection + analytical execution + synthesis
            ├─ semantic context, findings, references, retention
            ├─ deterministic answer/fallback and error mapping
            └─ session store / XLSX export

All analytical branches:
  schema → plan validation → snapshot context resolution → fixed SQL compiler
  → SELECT-only MySQL executor → typed result + queryPlanHash + provenance

Current providers:
  configured-copilot-model
    ├─ http-json-copilot-model
    └─ openai-compatible-copilot-model
```

The bootstrap wires one `executeAnalyticalQueryWithResolvedContext` instance to the Copilot and to dashboard intersection evaluation. The Copilot is enabled only when both `ANALYTICS_DB_*` and a configured model are available, while non-LLM dashboard readers can remain wired without the model.

## 3. Module inventory

The following is the production inventory. “Model dependence” means dependence on an LLM/provider, not domain models such as RFM or clustering snapshots.

| Module | Responsibility | Inputs / outputs | Dependencies | Model / state / data dependence | Side effects |
|---|---|---|---|---|---|
| `src/http/routes/index.ts` | Copilot and session HTTP entrypoints, auth, Zod envelopes, status mapping, request logging | HTTP JSON/XLSX → public response/status | Express, Zod, route dependency ports | No model logic; delegates session/app state | Logs; sends HTTP |
| `src/app.ts` | Express composition and safe fallback error handler | Express request → HTTP response | `buildRoutes`, error classifier | None | Logs; HTTP |
| `src/bootstrap.ts` | Wires pools, context resolvers, query executor, provider, session service and routes | Config → dependency graph | All application/infrastructure factories | Provider and analytics configuration; creates session store | Opens/closes DB pools; console diagnostics |
| `src/config.ts` | Environment contract, feature flags, limits, provider timeout configuration | `process.env` → config | Zod | Provider-specific flags and session limits | Throws at startup for invalid config |
| `src/application/customer-intelligence-copilot/answer-customer-intelligence-question.ts` | Stateless legacy turn: planner, repair, analytics, answer generation | question/snapshot id → Copilot response | Copilot model, query runtime, context resolver, domain validators | Strong planner/answerer dependence; no session state | LLM calls; DB through runtime |
| `src/application/customer-intelligence-copilot/ports.ts` | Current brain/provider interface and metadata/tool message contracts | Stage-specific model inputs/outputs | Analytical and Copilot domain types | Directly encodes current stage model | None |
| `src/application/customer-intelligence-copilot-session/session-service.ts` | Stateful turn orchestration, all branches, result storage, deterministic rendering/fallback, errors, diagnostics, export lifecycle | Session operations and question → session response/context | Query runtime, intersection, domain prompts/validators/semantics, store, clock, model | Very high: planner, tool protocol, answerer, session state, snapshot data | LLM calls, DB reads/writes, logs/diagnostics, XLSX export |
| `src/application/customer-intelligence-copilot-session/contracts.ts` | Session, turn, query result, limits, store and HTTP result types | Structured state/contracts | Copilot/query/context types | Mix of reusable state and current response contract | None |
| `src/application/customer-intelligence-copilot-session/session-context.ts` | Projects persisted turns/results into prompt context; derives references, semantic focus, primary finding | Session → bounded context | Copilot semantic types, query result shape | State-dependent; prompt-oriented projection | None |
| `src/application/customer-intelligence-copilot-session/ui-context.ts` | Validates/resolves UI population and composes it with model plans | UI context/session → selected population or error; filters → scoped plan | Intersection capability, business labels, query filters | Deterministic; currently consumed by brain prompt/runtime | Bounded analytics reads through intersection |
| `src/application/customer-intelligence-copilot-session/in-memory-session-store.ts` | TTL/bounded ephemeral store for tests/benchmarks | session → CRUD/list | Session contracts, clock values | State-only | Memory mutation |
| `src/application/customer-intelligence-copilot-session/xlsx-export.ts` | Re-executes an owned query and renders Result/Metadata sheets | session/query/result → XLSX buffer | ExcelJS, provenance/result contracts | No model dependence; explicit presentation/export | XLSX generation |
| `src/domain/customer-intelligence-copilot/contracts.ts` | Copilot response, planner/decision, semantic anchor/finding, evidence, UI projection contracts | Unknown/model outputs and deterministic state → typed contracts | Query/intersection/context contracts | Mixed: response and action envelopes are brain-specific; evidence/provenance are reusable | None |
| `src/domain/customer-intelligence-copilot/business-semantics.ts` | Maps metrics/entities to business labels and formats CLP, counts, percentages, ranks | Analytical values → business-readable values | Query metric types | Deterministic, but currently exported from Copilot domain and reused by dashboard | None |
| `src/domain/customer-intelligence-copilot/analysis-plan-validator.ts` | Validates Copilot plan envelope/status/query-step shape | Unknown plan → validated envelope/errors | Query plan contract | Brain envelope-specific; embedded query validation is partly delegated | None |
| `src/domain/customer-intelligence-copilot/conversation-decision-validator.ts` | Validates actions, source ids, forbidden executable keys and analytic routing rules | Unknown decision + context → decision/errors | Session context, semantic heuristics | Brain-specific, though safety checks are reusable | None |
| `src/domain/customer-intelligence-copilot/conversation-plan-validator.ts` | Validates unified planner envelope and derives decision | Unknown plan → plan/decision/errors | Decision validator | Brain-specific transitional contract | None |
| `src/domain/customer-intelligence-copilot/prompts.ts` | Planner/orchestrator/unified/tool/synthesis instruction text and versions | Constants → provider prompts | Business/query concepts | Strongly brain/provider-specific; includes business semantics that must be extracted | None |
| `src/domain/customer-intelligence-copilot/schema-context.ts` | Converts analytical schema/query contract to compact Copilot syntax | Analytical schema → compact prompt contract | Query schema/contract | Mixed: field descriptions are reusable metadata; compact shape is current brain adapter | None |
| `src/domain/customer-intelligence-copilot/response-state.ts` | Calculates final response state from public response | response → success/degraded/failure | Copilot contract | Deterministic response policy | None |
| `src/domain/customer-intelligence-query/contracts.ts` | Neutral query plan/schema/result contracts and limits vocabulary | Structured plan/result types | Snapshot context | Model-independent | None |
| `src/domain/customer-intelligence-query/schema-registry.ts` | Logical field registry and fixed SQL expression map | field name → metadata/internal expression | Query contracts | Model-independent; physical SQL map stays private | None |
| `src/domain/customer-intelligence-query/validator.ts` | Type/arity/mode/complexity validation and canonical plan | Unknown plan → normalized plan/errors | Registry | Model-independent safety boundary | None |
| `src/domain/customer-intelligence-query/compiler.ts` | Fixed SELECT/JOIN topology, parameterized SQL | normalized plan + resolved ids → compiled SQL/params | Registry, normalized validator types | Model-independent; data-source-specific to current read model | None |
| `src/domain/customer-intelligence-query/compact-query-adapter.ts` | Expands compact field/op syntax to canonical plan | compact query → analytical plan | Query registry/contracts | Adapter to current model-facing syntax | None |
| `src/domain/customer-intelligence-query/plan-hash.ts` | Stable hash of canonical plan | canonical plan → SHA-256 | Stable checksum | Model-independent | None |
| `src/domain/customer-intelligence-query/pii-guard.ts` | Rejects PII-shaped fields/values in analytical data | unknown value → void/error | None | Model-independent safety | None |
| `src/application/customer-intelligence-query/get-analytical-schema.ts` | Publishes physical-name-free schema | none → schema | Registry, read model version | Capability metadata, currently imported by Copilot | None |
| `src/application/customer-intelligence-query/validate-analytical-query-plan.ts` | Application facade over domain validator | unknown → validation | Domain validator | Capability facade | None |
| `src/application/customer-intelligence-query/execute-analytical-query.ts` | Resolves context, validates, compiles, executes and maps typed results | plan/context → result/errors | Context resolver, query executor, compiler | Model-independent; current runtime data model | DB read |
| `src/application/customer-intelligence-query/ports.ts` | Generic compiled-query executor port | compiled query → raw rows | None | Model-independent | None |
| `src/infrastructure/customer-intelligence-query/mysql-analytical-query-executor.ts` | SELECT-only defense-in-depth and analytics error mapping | compiled query → raw rows/errors | Shared query executor, analytics error taxonomy | Data-source-specific, not model-specific | DB read |
| `src/application/customer-intelligence/resolve-customer-intelligence-context.ts` | Anchors feature snapshot and selects compatible RFM/cluster snapshots; returns coverage/provenance | current/id → resolved context/ids | Feature/header/intelligence readers, optional CLV header | Deterministic state/data; model-independent | DB reads |
| `src/application/customer-intelligence/ports.ts` | Snapshot/header/row reader ports and resolved id contract | ids/options → rows/counts/headers | Domain snapshot contracts | Model-independent | None |
| `src/domain/customer-intelligence/contracts.ts` | Read-model rows, snapshot refs and population coverage | deterministic data contracts | Feature/RFM/cluster/CLV contracts | Model-independent | None |
| `src/application/customer-intelligence-intersection/execute-intersection.ts` | Deterministic filter population and aggregate metrics, shared by dashboard/UI context | filters/snapshot → intersection result | Query runtime, context resolver | Model-independent capability; used as session scope adapter | DB reads |
| `src/domain/customer-intelligence-intersection/contracts.ts` | Reusable subset definition, population, metrics and errors | filters/context → contracts | Query/context contracts | Model-independent | None |
| `src/domain/customer-intelligence-intersection/filter-tree-analysis.ts` | Required-dimension and safe filter-tree diagnostics | validated filter → dimensions/stats | Query normalized filter | Model-independent | None |
| `src/infrastructure/customer-intelligence-copilot/openai-compatible-copilot-model.ts` | OpenAI-compatible HTTP transport, JSON/tool parsing, timeout, usage and provider taxonomy | stage request → stage output/metadata | Fetch, OpenAI-shaped messages, prompt constants | Fully provider/protocol-specific | External HTTP |
| `src/infrastructure/customer-intelligence-copilot/http-json-copilot-model.ts` | Legacy generic JSON provider transport and response extraction | stage request → stage output/metadata | Fetch, prompt constants | Provider-specific | External HTTP |
| `src/infrastructure/customer-intelligence-copilot/configured-copilot-model.ts` | Provider selection and stage-specific model routing | env → current model port | Both adapters | Provider/config-specific | None; provider calls occur later |
| `src/infrastructure/customer-intelligence-copilot/mysql-copilot-session-store.ts` | Durable session/message/query/reference persistence | session → MySQL rows/session | MySQL pool, migrations, session contracts | State/data persistence; no model calls | DELETE/INSERT/UPSERT/SELECT |
| `migrations/010_create_customer_intelligence_copilot_conversations.sql` | Conversation/message/query/reference tables | migration → schema | MySQL | Durable state | Schema mutation |
| `migrations/011_add_customer_intelligence_copilot_ui_context.sql` | Adds persisted UI scope JSON | migration → schema | MySQL | Durable state | Schema mutation |
| `src/http/routes/index.ts` + `src/bootstrap.ts` | Public compatibility assembly | dependencies/config → endpoint | Express and all ports | Presentation/config | HTTP, logs, pool lifecycle |

Adjacent but not currently Copilot-callable:

- `src/application/customer-commercial-profile/customer-commercial-profile-service.ts` and `src/domain/customer-commercial-profile/contracts.ts` compose RFM, behavioral cluster, CLV and Commercial Affinity for `/v1/customers/:customerId/commercial-profile`.
- The Copilot session service does not receive `CustomerCommercialProfileService`, `GetCustomerClv`, `GetCustomerCommercialAffinity`, or a profile capability. It only receives the analytical runtime, intersection evaluator, model, store, clock, and limits.
- Therefore Commercial Affinity A01 and CLV are reusable product capabilities, but their existing profile service is not automatically reusable by a Harness until a neutral capability wrapper and authorization/input contract are defined.

## 4. Classification matrix

Each item has one primary class. Mixed items are intentional extraction targets.

| Component | Primary class | Audit conclusion |
|---|---|---|
| RFM/clustering/feature snapshot semantics and persisted snapshot reads | `A. DOMAIN_DETERMINISTIC` | Preserve as truth; never move reasoning into the brain. |
| Query registry, validator, compiler, plan hash, PII guard | `A. DOMAIN_DETERMINISTIC` | Directly reusable behind a neutral read capability. |
| Context resolver and coverage/provenance context | `A. DOMAIN_DETERMINISTIC` | Preserve feature-anchor and at-or-before snapshot policy. |
| `execute-analytical-query.ts` | `B. REUSABLE_CAPABILITY` | Extract stable operation with caller/budget context. |
| `execute-intersection.ts` | `B. REUSABLE_CAPABILITY` | Reuse for UI scope and future audience evaluation. |
| `get-analytical-schema.ts` | `B. REUSABLE_CAPABILITY` | Rename/rehouse as registry metadata publication; compact serialization becomes adapter. |
| Typed result/provenance/truncation contract | `B. REUSABLE_CAPABILITY` | Common contract for both brains. |
| `session-context.ts` semantic derivation | `C. REUSABLE_CONTEXT_STATE` | Extract deterministic state reducer from prompt projection. |
| Pinned snapshot IDs, retained validated results, references, primary finding, UI scope | `C. REUSABLE_CONTEXT_STATE` | Must survive a brain swap. |
| Conversation summary/recent turn rendering | `C. REUSABLE_CONTEXT_STATE` | Keep as bounded audit/session state; Harness may own its own native history. |
| `session-service.ts` | `G. MIXED_COUPLING` | Split into session lifecycle/state, capability executor, brain adapter, response policy, and telemetry. |
| `answer-customer-intelligence-question.ts` | `G. MIXED_COUPLING` | Keep only as legacy compatibility orchestration or route it through the same neutral boundary. |
| Copilot response/action/plan contracts | `G. MIXED_COUPLING` | Extract neutral capability/result/error contracts; keep current action envelopes in legacy brain adapter. |
| `schema-context.ts` | `G. MIXED_COUPLING` | Extract public registry metadata; keep compact field/op projection in current/Harness adapters. |
| `prompts.ts` | `G. MIXED_COUPLING` | Keep provider-neutral business policy separately; replace prompt instructions with Harness capability metadata/policy. |
| `business-semantics.ts` | `A. DOMAIN_DETERMINISTIC` | Preserve, but move out of a Copilot-only namespace to a shared semantic presentation module. |
| Decision/plan validators | `D. BRAIN_ORCHESTRATION` | Legacy brain contract validators; analytical query validator remains reusable. |
| Native `run_analytical_queries` schema/parser | `E. PROVIDER_SPECIFIC` | Replace protocol parser with neutral invocation adapter; keep query validation. |
| OpenAI-compatible and HTTP JSON model adapters | `E. PROVIDER_SPECIFIC` | Replace only the provider adapter; do not leak its stage model into capabilities. |
| Session store and migrations | `C. REUSABLE_CONTEXT_STATE` | Reuse persistence concept; fix TTL, transaction, and concurrency semantics. |
| Routes, status mapping, auth, XLSX response | `F. PRESENTATION_OR_HTTP` | Preserve for compatibility; Harness should run behind a new internal adapter, not own HTTP. |
| Customer Commercial Profile service | `B. REUSABLE_CAPABILITY` | Reusable product capability, but not part of the current Copilot tool registry. |

### Mixed-coupling extraction detail

**`session-service.ts` — extract:**

- `executeAnalyticalSteps` plus scope composition into a capability invocation coordinator.
- `retainedResult`, `appendResults`, `uniqueQueryId`, provenance/result validation into state/result modules.
- `deriveSemanticFocus`, primary finding, analytical references and clarification lifecycle into a deterministic state reducer.
- deterministic simple answer rendering and evidence bundle/fallback into a result interpretation/presentation module.
- provider-neutral failure categories and turn/capability trace into observability.

**Keep in the current brain adapter:**

- decision action selection, planner invocation, repair, answerer invocation, current tool protocol, prompt construction, and current model-stage metadata.

**`answer-customer-intelligence-question.ts` — extract:**

- query execution and response/provenance assembly into the same neutral capability path used by sessions.

**Keep:**

- the stateless endpoint's legacy planner → answerer behavior until compatibility tests prove parity. It is currently a second orchestration implementation, so leaving it untouched creates permanent divergence.

**`schema-context.ts` — extract:**

- schema field metadata, descriptions, allowed operations, and unsupported-data policy into registry metadata.

**Keep/rewrite:**

- compact names (`f`, `t`, `n`, `d`, `ops`, `aggs`) and the Copilot-specific contract serializer as adapter code. A Harness may want full JSON Schema or function metadata instead.

**`prompts.ts` — extract:**

- epistemic/business policies: observed versus interpreted, no causality, no profitability inference, no prediction without model output, nullable population semantics, labels and CLP formatting.

**Keep/rewrite:**

- action ordering, follow-up examples, planner repair wording, “one tool call”, OpenAI tool syntax and JSON-envelope instructions in the current brain adapter only.

## 5. Tool/capability inventory

### Explicitly callable by the current Copilot brain

| Tool/capability | Purpose and input | Output and implementation | Data / mutability / bound | Current coupling | DeepSeek Harness reuse |
|---|---|---|---|---|---|
| `run_analytical_queries` | Up to 3 compact queries, each with `id`, `select` or `dimensions`/`metrics`, optional filters/order/limit | Validated typed query results, later transformed into response/evidence; `validateRunAnalyticalQueriesToolCall` → compact adapter or canonical validator → `executeAnalyticalSteps` → `executeAnalyticalQueryWithResolvedContext` | Snapshot read; read-only; bounded by 3 queries, 20 filter leaves, 5 depth, 10 metrics, 5 dimensions, 1,000 rows | Tool name/schema is OpenAI function format; query syntax and descriptions are prompt-shaped; model call count is enforced by current runtime; UI scope is hidden application behavior | **ADAPTER**. Reuse the deterministic runtime, not the OpenAI tool envelope. Harness adapter must expose id/version/schema, caller/session/snapshot context, max cost, and normalized result/error. |

### Current internal capabilities that are not autonomous tools

| Current operation | Purpose | Why it is not a current tool | Harness treatment |
|---|---|---|---|
| `getAnalyticalSchema()` | Publishes 30 logical fields with types, operations, aggregations and descriptions | Injected into planner/tool prompts; no independent invocation | Neutral registry metadata, possibly filtered per capability/authorization. |
| `validateAnalyticalQueryPlan()` | Rejects unsafe/malformed plans before DB | Used by application/runtime and hidden behind tool/planner validation | Directly reusable as the final server-side gate. |
| `executeIntersection()` | Evaluates a validated filter population and returns common metrics/coverage | Called by UI context resolution, not selected by the model | Neutral `audience.evaluate`/`population.evaluate` capability; keep read-only and deterministic. |
| `answer_from_context` | Reuses stored results by source query id | Current brain action, not a data capability; invokes answerer | Replace with state lookup plus brain synthesis policy. Harness must not invent source ids. |
| deterministic renderer/evidence bundle | Converts validated results into safe business answer material | Embedded in session service | Reusable result interpretation module; optional final renderer. |
| XLSX export | User-triggered export of a session-owned query | HTTP lifecycle operation, not a model tool | Explicit application action; not autonomous by default. |
| direct currency response | Deterministic CLP explanation | Current session fast path | Reusable business policy or presentation rule, not a Harness tool. |

### Capabilities that should not be exposed to an autonomous Harness

- raw SQL or `CompiledAnalyticalQuery`; only logical plans/capability-specific inputs.
- `CopilotSessionStore` CRUD, delete/reset/refresh, raw session JSON, or arbitrary source-query retrieval.
- XLSX export without an explicit user authorization and query/session ownership check.
- provider diagnostics, token/cache internals, prompt versions, raw provider payloads, or repair operations.
- unrestricted profile lookup by email, phone, RUT, or other PII. The analytical runtime intentionally exposes only customer id as an identifier.
- snapshot publication, scoring, clustering, CLV generation, affinity snapshot build, migration, or any mutating operation.
- raw `getAnalyticalSchema` if it leaks internal SQL expressions; the existing application facade correctly strips them.

## 6. Analytical query runtime assessment

**CAN_ANALYTICAL_QUERY_RUNTIME_BECOME_NEUTRAL_CAPABILITY = `YES_WITH_REFACTOR`**

The current core is unusually well suited for reuse:

- Supported contract is `customer-intelligence-query-plan-v1`, plus a compact adapter used by the current Copilot. Row mode uses `select` without metrics. Aggregate mode uses dimensions/metrics without `select`.
- Logical fields are registered, not user-created. The current registry contains customer id, 18 commercial fields, 5 RFM fields, and 6 cluster fields. CLV, Commercial Affinity and profile fields are absent.
- Filters support `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `in`, `not_in`, `is_null`, and `is_not_null`, with type/arity checks.
- Complexity limits are hard rejection, not silent clamping: 20 filter leaves, depth 5, 5 dimensions, 10 metrics, 500 `IN` values, default limit 100, max result limit 1,000.
- SQL generation is deterministic and fixed-topology. Values are parameterized; identifiers come from the registry or safe aliases. The compiler can only produce one `SELECT` with fixed joins.
- The base population is the feature snapshot row set with left joins to RFM and cluster. Nullable RFM/cluster semantics are preserved; missing assignment is not silently converted to zero.
- Feature snapshot anchors compatible RFM/cluster snapshots at or before its reference time. The full snapshot context and coverage are carried on every successful result.
- Decimal results stay strings, count values are bounded/coerced to numbers, datetimes become ISO values, and results carry `queryPlanHash`, columns, rows, row count, duration and truncation.
- The MySQL executor delegates timeout/error mapping to the existing query executor and includes a SELECT-only guard.
- The LLM does not write SQL. It writes a structured plan/compact query; validation and compilation generate SQL.

The refactor is required for four reasons:

1. The current neutral-looking application port is still selected and called by Copilot-specific code paths and lacks a capability invocation context (caller, session, tenant/authorization, budget, idempotency and trace).
2. Compact syntax is conflated with capability definition. Harness metadata should describe the logical operation, while a separate adapter may support compact JSON, JSON Schema, function calling, or Harness-native arguments.
3. The current `executeAnalyticalSteps` silently composes UI scope after model planning. That security/correctness invariant must become part of the neutral execution boundary, not remain a hidden session-service detail.
4. The runtime is read-only but the configured analytics credential is not explicitly read-only. That is an operational hardening blocker for autonomous use.

Recommended neutral result:

```ts
type AnalyticalCapabilityResult = {
  capabilityId: 'customer-intelligence.analytics.query';
  capabilityVersion: string;
  queryPlanHash: string;
  context: CustomerIntelligenceSnapshotContext;
  columns: readonly { name: string; type: string }[];
  rows: readonly Record<string, string | number | boolean | null>[];
  rowCount: number;
  truncated: boolean;
  execution: { durationMs: number };
};
```

The actual repository types can be reused; this shape illustrates that `queryPlanHash`, provenance and truncation are capability truth, not answerer metadata.

## 7. Context and memory assessment

### State classification

| State item | Classification | Recommendation |
|---|---|---|
| `activeSemanticEntityType` / `activeSemanticEntityId` | Generic deterministic semantic focus, currently surfaced in diagnostics and prompts | Keep as derived `activeEntity`; never let Harness replace a validated finding with an arbitrary entity. |
| `activeMetric` | Generic semantic focus derived from a validated metric | Keep; expose business name/format, not raw field names. |
| `activeFindingType` | Generic classification of the last primary result (`top_rank`, `single_value`, `distribution`) | Keep; it prevents a distribution from being treated as a winner. |
| `activeFindingSourceQueryId` | Deterministic provenance reference | Keep, but source ids are opaque application ids and must be validated against session state. |
| `unresolvedClarificationPresent` / `clarificationState` | Generic application conversation state with explicit latest-turn lifecycle | Keep as deterministic state. Do not rely on the Harness to remember whether a clarification is open. |
| `recentTurnCount` | Structural observability metric | Keep in telemetry; not semantic memory. |
| `analyticalReferenceCount` | Structural state/telemetry count | Keep for diagnostics and bounded context; not a brain decision rule by itself. |
| `recentFindingCount` | Mostly a projection/diagnostic concept; current implementation derives one active finding | Keep only if a future contract defines multiple findings; otherwise remove the redundant name. |
| `semanticAnchorEntityType` / `semanticAnchorEntityId` / `semanticAnchorMetric` / `semanticAnchorFindingType` | Generic deterministic anchor used for follow-ups and evidence | Keep in the application state reducer and capability trace. |
| recent turns and `conversationSummary` | Session-native conversational memory plus persisted audit | Harness may own a native history; application should retain bounded audit turns and a compatibility projection. |
| `pinnedContext`, `resolvedIds` | Deterministic application truth | Must remain application-owned and immutable within a session until refresh/reset. |
| retained query results and `analyticalReferences` | Deterministic evidence cache/provenance | Must remain application-owned; Harness can receive a projection, never author it. |
| persisted `uiContext` and raw validated filter tree | Deterministic selected population state | Must remain application-owned; every query path must apply/validate it. |

### SESSION_NATIVE_MEMORY

- Harness conversation history, message ordering, native session ids, and model-native summaries.
- Natural-language continuity that does not assert a data fact.
- Provider-specific context-window management.

### DETERMINISTIC_APPLICATION_STATE

- Pinned feature/RFM/cluster snapshot context and resolved ids.
- Query plans/results, query hashes, truncation and result ownership.
- Primary finding, semantic anchor, active metric/entity, comparison set and source query ids.
- Clarification open/closed lifecycle.
- UI selected population, validated canonical filters, required dimensions and matching population.
- TTL, session ownership, result retention, export authorization, capability budgets and provenance.

The current `buildCopilotSessionContext()` is a prompt projection over both categories. It should be split into `reduceSessionState()` and `projectBrainContext()`. This is the key boundary for Harness coexistence.

## 8. Prompt/brain coupling findings

### Business semantics to preserve

The following rules are not merely prompt style and must survive a brain replacement:

- never invent PesasChile-specific facts; fresh counts, rankings, values and comparisons require validated analytics;
- observed differences are not causal proof;
- spend is not profitability without margin/cost/profit data;
- historical reactivation prioritization is a recommendation, not a prediction;
- nullable RFM/cluster dimensions must be excluded for rankings unless the user asks for unassigned customers;
- selected UI population is distinct from the conversational finding and must be the default scope;
- current session snapshot pin is authoritative; a UI context cannot silently switch snapshots;
- internal aliases, query ids, provider details and physical database identifiers must not reach users;
- CLP, counts, percentages, ranks and cluster/RFM labels need the existing business formatting/label policy.

These policies should become capability metadata, deterministic result policy, or a provider-neutral safety policy. They must not exist only in natural-language prompts.

### Metadata/contracts that should move to neutral capability metadata

- the 30 logical schema fields and their data types;
- allowed operators and aggregations;
- row versus aggregate mode;
- complexity limits and result bounds;
- nullability/coverage semantics;
- unsupported concepts and safe alternatives;
- read-only/mutability and boundedness;
- result/provenance/truncation contract;
- capability id/version and input/output schema.

The current `serializeAnalyticalSchemaForCopilot()` and `serializeAnalyticalQueryContractForCopilot()` are useful source material, but their compact keys and prompt-oriented examples belong in an adapter.

### Orchestration heuristics to replace with Harness behavior

- `CopilotConversationDecisionAction` and `allowedActions` (`respond_directly`, `clarification_required`, `answer_from_context`, `run_analytics`, `unsupported`).
- `buildConversationDecisionActionConstraints()` and its `freshBusinessFactQuestion` lexical classifier.
- `isLikelyFollowUp()` prefix regexes such as `por que`, `y el`, `eso`, and `por ticket`.
- planner → repair → execution → answerer branching.
- `answer_from_context` as a model action with explicit `sourceQueryIds`.
- `validateRunAnalyticalQueriesToolCall()` requiring exactly one native tool call.
- hard-coded “one tool selection then one synthesis” behavior.
- provider stage names and stage-specific model routing.

These are valid current-runtime safeguards, but they are implementation of the current brain, not reusable intelligence semantics.

### Provider workarounds removable if Harness supplies them

- OpenAI `choices[0].message` parsing and `tool_calls` conversion.
- `response_format: json_object` and provider-specific JSON envelope parsing.
- `finish_reason`/`reasoning_content` handling.
- provider-specific repair prompts and invalid-response subtypes.
- stage-specific model selection and OpenAI tool message replay.
- prompt token/cache metadata extraction where it is not available in a neutral Harness trace.

The no-chain-of-thought and no-raw-provider-payload policies remain regardless of provider.

## 9. Proposed neutral capability boundary

The smallest useful boundary is a registry plus an executor that receives deterministic application context:

```ts
type CustomerIntelligenceCapability = {
  id: string;
  version: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  mutability: 'read_only' | 'explicit_write';
  boundedness: { maxCost: number; maxRows?: number; maxCalls?: number };
  execute(input: unknown, context: CapabilityExecutionContext): Promise<CapabilityExecutionResult>;
};

type CapabilityExecutionContext = {
  sessionId: string;
  caller: string;
  pinnedContext: CustomerIntelligenceSnapshotContext;
  resolvedIds: ResolvedCustomerIntelligenceSnapshotIds;
  selectedPopulation?: { filters: AnalyticalFilterInput; queryPlanHash: string } | null;
  requestId: string;
  remainingBudget: { calls: number; rows: number; durationMs: number };
};
```

Repository-specific guidance:

- Keep `executeAnalyticalQueryWithResolvedContext` behind the capability implementation.
- Validate unknown input at the capability boundary, then validate again immediately before execution after scope composition.
- Apply selected population in the capability executor, never only in descriptions/prompts.
- Return typed results with provenance and query hash; do not return compiled SQL.
- Make all capability errors typed and safe: invalid input, unavailable snapshot, timeout, unavailable analytics, budget exceeded, unauthorized, and execution failure.
- Keep deterministic capability code independent of Harness SDK/dependencies.
- Allow a legacy adapter to invoke the same registry so the current Copilot and Harness are tested against identical operations.

### Existing tool mapping

| Current tool | Neutral capability | Harness adapter requirement |
|---|---|---|
| `run_analytical_queries` | `customer-intelligence.analytics.query` | Translate Harness arguments to one or more bounded logical plans; enforce max 3/cost; attach pinned context and selected scope; map typed result/errors. |
| `getAnalyticalSchema` prompt payload | `customer-intelligence.analytics.query` metadata | Publish registry entry/input schema; no execution call needed. |
| UI `executeIntersection` | `customer-intelligence.audience.evaluate` or `customer-intelligence.population.evaluate` | Usually server-side context initialization, not autonomous selection. If exposed, read-only, bounded, validated filters only. |
| Current `answer_from_context` | No autonomous capability; `session.evidence.lookup` internal state operation | Application resolves ids/results; Harness receives only authorized evidence projection. |
| Current XLSX export | `customer-intelligence.query.export` explicit application action | Do not register as autonomous by default; require user intent, session ownership and format allowlist. |
| Future `audience.evaluate` | `customer-intelligence.audience.evaluate` | Deterministic filter evaluator over snapshots; same contract as intersection, with explicit audience version. |
| Future `audience.export` | `customer-intelligence.audience.export` | Explicit write/export permission, destination/format allowlist, row/PII policy, audit event and idempotency. |

## 10. Current Copilot vs Harness responsibilities

| Responsibility | Current owner | Target owner | Reuse | Rewrite | Remove |
|---|---|---|---|---|---|
| Intent understanding | Planner/orchestrator prompts | Harness brain | Business ontology/policies | Brain adapter | Current lexical routing as authority |
| Conversational continuity | Session service + projected prompt | Harness session plus application state projection | Bounded audit/state | Projection adapter | Duplicate rendered history |
| Semantic anchors | `session-context.ts` + prompt fields | Deterministic application reducer | Yes | Expose neutral anchor | Model-authored anchor state |
| Clarification | Orchestrator decision + latest-turn heuristic | Harness reasoning, guarded by app clarification state | State lifecycle | Adapter mapping | Action envelope as permanent contract |
| Tool selection | Native model/tool runtime or planner | Harness brain | Capability metadata | Harness adapter | OpenAI tool protocol |
| Multi-tool orchestration | `session-service.ts` | Harness brain + capability budget | Execution coordinator | Brain adapter | Legacy max-one-call assumption |
| Deterministic analytics execution | Query runtime | Capability registry/runtime | Yes | Add auth/budget context | None |
| Customer profile retrieval | Separate HTTP Commercial Profile service | Future capability registry | Existing service semantics | Neutral profile adapter | Direct provider access |
| Audience evaluation future | Not implemented; intersection is current base | Deterministic capability layer | Intersection contracts | New capability | None |
| Provenance | Query result/context/session service | Capability result + application state | Yes | Normalize adapter | Answer-only provenance |
| Result validation | Query validator + tool/planner validators | Capability boundary + contract suite | Query validator | Remove duplicate envelope validators | Prompt-only validation |
| Final answer synthesis | Answerer/tool synthesis/fallback | Harness brain plus deterministic rendering guard | Business semantics/evidence | Brain adapter | Current answer prompt |
| Error recovery | Provider repair + session mapping | Harness retry policy plus deterministic capability errors | Error taxonomy | Neutral retry/budget policy | Provider-specific repair prompts |
| Provider calls | HTTP JSON/OpenAI adapters | Harness adapter/provider | None beyond safe metadata | Replace transport | Current stage API |
| Token/cache accounting | Provider metadata and stage diagnostics | Harness/provider telemetry | Aggregate economics fields | Telemetry adapter | Assumption that token fields are universal |
| Observability | `timeCopilotStage`, turn/stage diagnostics | Provider-neutral capability/turn trace | Event intent and safe fields | Trace adapter | Stage names tied to old brain |

## 11. Duplication and technical debt

### Duplication to remove through extraction

- Stateless `answer-customer-intelligence-question.ts` and stateful `session-service.ts` independently implement planner validation/repair, analytics execution, response construction, and error mapping.
- The query contract exists in the neutral query domain, is compacted in `schema-context.ts`, repeated in planner/tool prompts, and partially described again in the native tool JSON schema.
- `validateAnalyticalQueryPlan` is correctly centralized, but Copilot adds multiple envelope validators and tool validators that mix query validation with brain routing.
- Semantic focus is stored/derived in `session-context.ts`, compacted again in `session-service.ts`, and repeated as prompt instructions and diagnostics.
- Older-turn summary and structured recent turns were already recognized in code comments as overlapping representations; this remains a sign that session state and prompt projection are not separated.
- UI scope composition is implemented once in `executeAnalyticalSteps`, but the prompt also tells the model how scope inheritance/override works. The application invariant is authoritative; prompt text is explanatory duplication.
- Provider stage metadata is translated in infrastructure, then interpreted again in `session-service.ts` through provider stage names and failure naming.
- Business labels are correctly centralized in `business-semantics.ts`, but that Copilot domain module is imported by dashboard code, creating a namespace dependency that should move to shared intelligence semantics.
- MySQL session store schema has `model_provider`/`model_name` columns in migration 010, but the current insert path does not populate them. Provider metadata is therefore not durably captured there.
- MySQL session store rewrites all messages and query executions on save. Without an explicit transaction/optimistic version, concurrent turns can lose updates or leave child tables temporarily inconsistent.
- In-memory store purges/returns expired sessions, but MySQL `get` and `list` do not enforce expiry in the same way. Durable and ephemeral state behavior can diverge.

### Abstractions that would make the system worse

- A single generic “tool” abstraction that erases the distinction between a validated analytical query, an audience evaluator, an export, and a profile read.
- Exposing the entire 30-field analytical runtime as the only future capability; this would make Harness reasoning depend on low-level fields and still omit CLV/affinity/profile semantics.
- Moving snapshot pinning or provenance into Harness session memory. This would make truth depend on model/session behavior.
- Making the model responsible for UI scope composition, null coverage, or authorization. These are deterministic application invariants.
- Reusing the current prompt strings as the neutral capability contract. Prompts are not executable schemas and cannot enforce budgets or result ownership.
- Replacing deterministic renderers and evidence fallback with model output. Those paths protect correctness during synthesis failure and should remain independent.
- Treating all historical profile services as one broad capability without separate availability/provenance blocks. The existing Commercial Profile deliberately models partial degradation per RFM, cluster, CLV and affinity.

## 12. Migration risks

| Risk | Rank | Why |
|---|---|---|
| Tool-result contract mismatch | HIGH | Current brain receives OpenAI tool calls and later a custom evidence bundle; Harness may expect different call/result envelopes. |
| Session state divergence | HIGH | Current state mixes application truth and prompt projection; Harness-native history can disagree with persisted findings/results. |
| Clarification semantics | HIGH | “Open only on latest clarification turn” is deterministic application behavior currently inferred in `session-context.ts`; a Harness may keep stale conversational intent. |
| Hidden prompt assumptions | HIGH | Scope inheritance, null exclusion, profitability limits, reactivation semantics and “why” comparison behavior are spread across prompts and code. |
| Error propagation | HIGH | Current public statuses are tied to provider stages and old Copilot response contracts. |
| Deterministic truth vs model reasoning | HIGH | A model can synthesize plausible but unsupported answers if capability provenance/results are not authoritative. |
| Tool-call loops/repeated calls | HIGH | Current runtime intentionally accepts one native tool selection and performs bounded parallel queries; Harness loops need explicit budgets/idempotency. |
| Latency | MEDIUM | Current path may include orchestration, planning, several DB queries and synthesis; Harness session behavior may reduce or add calls. No live EXPLAIN evidence is present in the repo. |
| Token/cache economics | MEDIUM | Current metrics are provider-specific and stage-specific; Harness economics are unknown until adapter telemetry is defined. |
| Existing endpoint compatibility | HIGH | Stateless endpoint and session endpoints have distinct behavior and response envelopes; cutover must preserve both. |
| Current workflow regression | HIGH | Tests cover many semantic follow-ups, deterministic renderer guards, UI scope and degraded paths; new brain must pass the same invariant suite. |
| Snapshot drift | HIGH | Sessions pin a feature snapshot and compatible RFM/cluster snapshots; Harness must not silently refresh or select a newer context. |
| PII leakage | HIGH | Query runtime is intentionally PII-free, but broader profile capabilities and Harness context may not be. |
| Durable TTL/concurrency | MEDIUM | MySQL and in-memory store semantics differ and save is multi-statement; a brain swap increases concurrent-session pressure. |
| Export authorization | HIGH | Reusing a query id is safe only when it belongs to the session and export is explicitly requested; do not expose export as autonomous tool. |

## 13. Proposed R3 migration phases

### R3-A01 — Neutral Capability Boundary

**Objective:** extract a registry/executor facade around the existing analytical runtime and deterministic context/provenance state without changing behavior.

**Affected components:** `src/domain/customer-intelligence-query/*`, `src/application/customer-intelligence-query/*`, `src/application/customer-intelligence/resolve-customer-intelligence-context.ts`, `src/application/customer-intelligence-intersection/*`, selected deterministic functions from `session-context.ts`, `ui-context.ts`, and `session-service.ts`.

**Invariants:** same logical fields, plan hash, SQL safety, snapshot selection, left-join/null semantics, result/provenance shape, UI scope composition, limits and error taxonomy.

**Validation gate:** existing query/intersection/context tests plus new capability contract tests; current Copilot still invokes the old behavior through a compatibility adapter.

**Rollback boundary:** delete/disable the new facade wiring; no public route or schema change.

### R3-A02 — Harness Adapter

**Objective:** implement an adapter only after the neutral contract is fixed; do not add Harness dependency to the current runtime in this audit.

**Affected components:** new adapter module, capability registry metadata, provider-neutral telemetry mapping, session projection boundary.

**Invariants:** read-only, bounded calls, pinned snapshot, scope composition, no SQL/PII/provider payload leakage, query ownership and provenance preserved.

**Validation gate:** adapter contract tests use fake Harness calls and the same capability fixtures as the current brain.

**Rollback boundary:** feature flag routes all traffic to current brain; adapter can be disabled without changing stored session data.

### R3-A03 — Controlled Bakeoff

**Objective:** compare current brain and Harness brain on identical contexts/capabilities/data and record invariant outcomes.

**Affected components:** existing `scripts/intelligence/copilot-benchmark.ts`/reporting or a new audit-only runner, fixture snapshots, capability contract suite.

**Invariants:** same pinned snapshot ids, same input questions, same capability registry versions, same allowed result budgets, no production user exposure.

**Validation gate:** no cutover unless factual/provenance/tool/continuity invariants meet a predefined threshold and no HIGH-risk invariant regresses.

**Rollback boundary:** benchmark is isolated; current runtime remains the only live path.

### R3-A04 — Runtime Gate

**Objective:** allow per-request/per-session selection behind an internal feature gate while preserving the current endpoint contract.

**Affected components:** bootstrap, session service brain adapter selection, safe route/config gate, observability.

**Invariants:** same public statuses and response contract, session state remains application-owned, old path available, no mixed-brain turn unless explicitly designed.

**Validation gate:** shadow or allowlisted traffic, parity dashboards, error/latency/tool-budget thresholds, rollback drill.

**Rollback boundary:** gate off returns all new turns to current brain; pinned sessions should either finish on their selected brain or be explicitly reset, never silently mixed.

### R3-A05 — Cutover / Coexistence

**Objective:** make Harness the selected brain only after bakeoff evidence; retain current brain as fallback/coexistence path.

**Affected components:** runtime gate, provider configuration, session metadata/versioning, runbooks and dashboards.

**Invariants:** old stateless and session HTTP contracts, deterministic capability truth, auditability, explicit fallback semantics, export ownership.

**Validation gate:** sustained production metrics and scenario replay; no unresolved blocker below.

**Rollback boundary:** route new sessions to current brain; preserve existing deterministic state and stored query evidence.

## 14. Controlled bakeoff design

Both brains must receive the same pinned `CustomerIntelligenceSnapshotContext`, resolved ids, selected UI scope, capability registry version, scenario input, and deterministic capability responses. The comparison must record capability calls before comparing text.

| Scenario | Required invariant checks |
|---|---|
| 1. Single factual query | Uses analytics; result value/hash/provenance match fixture; no invented number. |
| 2. Follow-up using previous entity | Same entity type/id as deterministic primary finding; no unrelated entity substitution. |
| 3. Follow-up using previous metric | Metric resolves to prior validated semantic metric; fresh query only when evidence is insufficient. |
| 4. Ambiguity requiring clarification | Clarifies only when multiple interpretations materially change the result; clarification state opens and then clears correctly. |
| 5. Multi-tool analysis | Uses only registered capabilities; bounded count; no duplicate/unbounded loop; deterministic results match. |
| 6. Analytical comparison | Same filters/dimensions/metric semantics; null handling and comparison population are explicit. |
| 7. Customer-specific Commercial Profile | If enabled in a future phase, profile block availability/provenance is preserved; identity authorization is enforced. Current query runtime alone cannot satisfy this scenario. |
| 8. Affinity reasoning | If enabled in a future phase, A01 snapshot/result semantics are used; no inference from unrelated spend fields. |
| 9. Failure/degraded component | Partial/degraded statuses are preserved; no “0” fabricated for unavailable RFM/cluster/CLV/affinity. |
| 10. Multi-turn audience-like request | UI scope and/or future audience evaluation remains deterministic; no export or mutation without explicit action. |

Measure:

- factual correctness against fixture truth;
- capability selection and argument correctness;
- capability count, duplicate calls, budget compliance and loop count;
- entity/metric/clarification continuity;
- provenance completeness and query-plan hash equality;
- latency by capability, brain and turn;
- prompt/provider/Harness token/cache economics where available;
- error category and recovery outcome;
- deterministic renderer eligibility/fallback usage;
- public response contract compatibility.

Do not use subjective answer quality as the primary gate. Text review is a secondary check after the structural invariants pass.

## 15. Reusable test inventory

### Existing relevant tests

| Test file | Coverage | Brain-independent potential |
|---|---|---|
| `tests/unit/customer-intelligence-query-validator.test.ts` | Query modes, fields, operators, aggregations, aliases, limits, boolean filters | Direct contract suite |
| `tests/unit/customer-intelligence-query-compiler.test.ts` | Fixed topology, grouping, filters, truncation, SELECT-only/injection safety | Direct contract suite; assert no raw SQL in capability result |
| `tests/unit/customer-intelligence-query-plan-hash.test.ts` | Stable canonical hash | Direct contract suite |
| `tests/unit/customer-intelligence-query-schema-registry.test.ts` | Registry field shape/type/PII | Direct registry suite |
| `tests/unit/get-analytical-schema.test.ts` | Public schema strips physical identifiers | Direct registry suite |
| `tests/unit/execute-analytical-query.test.ts` | Validation gate, snapshot ids, typed conversion, result/provenance/truncation | Direct capability suite |
| `tests/unit/mysql-analytical-query-executor.test.ts` | SELECT guard and analytics errors | Infrastructure contract suite |
| `tests/unit/customer-intelligence-query-no-prestashop-dependency.test.ts` | Layer dependency guard | Architecture contract suite |
| `tests/unit/resolve-customer-intelligence-context.test.ts` | Feature anchor, compatible snapshot selection, degraded states | Direct context contract suite |
| `tests/unit/execute-intersection.test.ts` | Filter evaluation, coverage, required dimensions, metrics | Direct future audience/evaluate suite |
| `tests/unit/customer-intelligence-copilot-ui-context.test.ts` | UI context validation, scope composition, hash/change behavior | Direct scope contract suite |
| `tests/unit/customer-intelligence-copilot-business-semantics.test.ts` | CLP/count/percentage/rank/labels and prompt leakage rules | Direct semantic presentation suite |
| `tests/unit/customer-intelligence-copilot-session.test.ts` | 81 counted test cases covering session lifecycle, semantic follow-ups, native tools, unified planner, fallback, diagnostics, export and UI context | Split: state/result/evidence tests become shared; planner/provider branch tests remain current-brain tests |
| `tests/unit/customer-intelligence-copilot-contracts.test.ts` | Decision/plan envelope rules and action constraints | Keep for legacy adapter; create neutral capability/error contract tests |
| `tests/unit/customer-intelligence-copilot-semantic-benchmark.test.ts` | Semantic scenario behavior | Reuse scenario fixtures and invariants; replace brain-specific expectations with capability/event assertions |
| `tests/unit/customer-intelligence-copilot-benchmark.test.ts` | Aggregates latency/pass rates | Reuse report schema; add Harness-neutral dimensions |
| `tests/unit/openai-compatible-copilot-model.test.ts` | OpenAI serialization, tool parsing, timeout, finish reason, provider taxonomy | Keep provider adapter only |
| `tests/unit/http-json-copilot-model.test.ts` | Legacy HTTP JSON serialization/parsing/errors | Keep provider adapter only |
| `tests/unit/mysql-copilot-session-store.test.ts` | JSON persistence/deserialization | Extend with expiry, transaction/concurrency and version invariants |
| `tests/integration/customer-intelligence-copilot-route.test.ts` | Stateless endpoint/auth/response mapping | Preserve as HTTP compatibility suite |
| `tests/integration/customer-intelligence-copilot-session-routes.test.ts` | Session routes, export, UI context, status mapping | Preserve as HTTP compatibility suite |

The repository also has the customer intelligence reader/query executor tests that validate read-model data access. They should remain below the capability suite, not be duplicated in each brain integration test.

### Tests that should become shared contract tests

1. Given the same capability input and resolved context, both brains observe the same result version, rows, hash, truncation and provenance.
2. Invalid plans never reach the DB, regardless of who produced them.
3. UI scope is applied/overridden according to deterministic field rules, regardless of brain.
4. Unavailable RFM/cluster is a typed unavailable state, never a false zero.
5. Primary finding/semantic anchor derives from result shape, not from model-selected array position.
6. Clarification state transitions are latest-turn deterministic.
7. PII, SQL, physical identifiers, provider payloads and chain-of-thought never enter public response/capability result.
8. Results can be reloaded/exported only when query ids belong to the session and retain provenance.

## 16. Audience Engine placement

No Audience Engine is implemented by this audit.

### `audience.evaluate`

Place it as a peer capability beside `customer-intelligence-intersection`, using the existing validated `AnalyticalFilterInput`, feature-anchored snapshot resolution, required-dimension gating, coverage semantics and query hash. The current intersection evaluator is a strong foundation because it already treats the filter tree as the canonical subset definition and is shared by Dashboard and Copilot UI context.

The brain may decide that an audience evaluation is useful and supply a bounded logical filter request. The brain must not:

- write SQL;
- bypass validator/required-dimension checks;
- supply or override snapshot provenance;
- claim the matching population without the capability result;
- persist or export the audience implicitly.

### `audience.export`

Place it in an explicit application/export boundary, using an owned audience definition, destination/format allowlist, row and PII policy, audit event, and idempotency key. It may reuse the XLSX/export infrastructure but should not be an autonomous Harness capability unless the caller grants explicit export permission. CSV/XLSX/Brevo delivery is an external side effect and is therefore materially different from read-only reasoning.

## 17. Explicit blockers

- The repository contains no DeepSeek Harness SDK or contract, and this audit is prohibited from adding one. The proposed adapter therefore remains conceptual until the external Harness invocation/session contract is supplied.
- Harness-native session semantics, retry/loop behavior, tool result format, token/cache telemetry and cancellation behavior are not verifiable from this repository.
- Current `CustomerIntelligenceCopilotModel` is a current-brain/provider interface, not a neutral brain adapter boundary.
- Current analytical schema omits CLV, Commercial Affinity and the full Commercial Profile. The stated “mature capabilities” are not all available to a replacement brain through the current Copilot runtime.
- Current session persistence needs a durability audit: MySQL does not mirror in-memory expiry behavior; save uses multiple child-table rewrites without an explicit transaction/version check; concurrent turns have no visible lock/idempotency boundary.
- Migrations are intentionally not changed in this task. Any session metadata/versioning required for coexistence belongs in a later release.
- No live MariaDB/EXPLAIN or production latency evidence is present in the local audit context; query safety is strongly unit-tested, but performance claims remain unmeasured.
- The configured analytics credential is not proven read-only by this repository. Autonomous Harness access should wait for a least-privilege decision.
- The stateless endpoint and session endpoint have different orchestration paths. A migration that replaces only the session brain would leave two Copilot behaviors and two capability integration paths.

## 18. Recommended next release

Proceed with **R3-A01 Neutral Capability Boundary** only.

Definition of done for that release:

- one neutral, versioned read-only analytical capability facade;
- one neutral schema/metadata publication surface;
- one deterministic capability execution context carrying pinned snapshots, UI scope, caller, budget and request id;
- one shared result/error/provenance contract;
- current stateless and session Copilot paths both invoke the facade without public behavior change;
- deterministic state reducer separated from brain prompt projection;
- shared contract tests run with current-brain stubs and a Harness-shaped adapter stub;
- no CLV/Affinity exposure is implied until separate capability contracts are explicitly designed;
- session TTL/concurrency discrepancies are recorded as release blockers, not silently normalized.

## 19. Final output

```text
PRIMARY_VERDICT:
REUSE_PARTIAL_WITH_SIGNIFICANT_REFACTOR

ESTIMATED_REUSABLE_PERCENT:
~65% of semantic/runtime surface; ~45% of Copilot-specific implementation without extraction

DIRECTLY_REUSABLE:
Analytical query domain/runtime, snapshot context resolution, provenance, deterministic validation,
intersection evaluation, business semantics, bounded state/result primitives

REQUIRES_ADAPTER:
Compact query/tool schema, capability registry, Harness invocation/session projection, scope
composition boundary, profile/CLV/Affinity wrappers, provider-neutral telemetry

BRAIN_SPECIFIC_TO_REPLACE:
Orchestrator/planner/unified planner, prompt construction, native OpenAI tool protocol, repair
loops, answer synthesis, source-query action selection

HIGH_RISK_COUPLINGS:
session-service.ts mixed responsibilities, prompt/application duplication, state/projection
conflation, provider-stage model interface, scope/provenance assumptions, durable-session semantics

ANALYTICAL_RUNTIME_VERDICT:
YES_WITH_REFACTOR

CONTEXT_STATE_VERDICT:
Keep deterministic application state; allow Harness to own native conversational memory projection

HARNESS_ADAPTER_FEASIBILITY:
Feasible with significant extraction; first safe slice is one bounded read-only analytical capability

AUDIENCE_ENGINE_PLACEMENT:
audience.evaluate beside intersection as deterministic capability; audience.export explicit app-side
side effect, not autonomous by default

PROPOSED_NEXT_RELEASE:
R3-A01 Neutral Capability Boundary

FILES_CREATED:
docs/audits/CUSTOMER-INTELLIGENCE-R3-A00-copilot-capability-reuse-audit.md

FILES_MODIFIED:
none

TESTS_RUN:
npm test -- --run — 218 test files passed, 1939 tests passed (12.75s).
No production code was changed.

DECISION:
CUSTOMER_INTELLIGENCE_R3_AUDIT_COMPLETE
```
