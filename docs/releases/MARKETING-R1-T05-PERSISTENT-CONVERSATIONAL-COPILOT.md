# MARKETING-R1-T05 - Persistent Conversational Copilot

Status: implemented locally; EC2 live validation not run.

## Previous Architecture

The previous session flow treated every user turn as an analytical request:

user question -> CopilotAnalysisPlan planner -> bounded AnalyticalQueryPlan runtime -> answerer.

Sessions were held in an in-memory store. A process restart lost session history, retained query
plans, result references and export context.

## New Architecture

The session API now routes each turn through a persistent conversational orchestrator:

user message -> durable conversation -> conversational decision -> one of:

- `respond_directly`
- `clarification_required`
- `answer_from_context`
- `run_analytics`
- `unsupported`

Only `run_analytics` invokes the existing strict analytical planner. The planner and T03
AnalyticalQueryPlan runtime remain internal tools behind the orchestrator.

The legacy single-turn `POST /v1/customer-intelligence/copilot` remains planner-driven for
compatibility. The conversational behavior is implemented on the session routes used by CRM.

## Persistence Model

Migration:

- `migrations/010_create_customer_intelligence_copilot_conversations.sql`

Tables:

- `customer_intelligence_copilot_conversation`
- `customer_intelligence_copilot_message`
- `customer_intelligence_copilot_query_execution`
- `customer_intelligence_copilot_reference`

The durable source of truth is the Analytics DB MariaDB connection. PrestaShop is not modified.

Persisted state includes pinned snapshot context, resolved snapshot ids, bounded turn history,
conversation summary checkpoints, validated analytical plans, query plan hashes, provenance, row
counts, truncation flags, execution metadata, bounded retained samples and semantic references.
Full export-sized result sets are not persisted as conversation memory.

## Orchestrator Contract

Version:

`customer-intelligence-conversation-decision-v1`

The deterministic validator accepts only:

- `respond_directly` with `message`
- `clarification_required` with `message`
- `answer_from_context` with `sourceQueryIds` and `instruction`
- `run_analytics` with `analyticalQuestion`
- `unsupported` with `message`

The validator rejects SQL, executable code, shell commands, table/column names, credentials,
unknown actions and invalid decision versions. One bounded repair attempt is allowed.

## Analytics Boundary

For `run_analytics`, the service passes the orchestrator's precise `analyticalQuestion` into the
existing CopilotAnalysisPlan planner. The existing validator and AnalyticalQueryPlan runtime still
own all analytical execution:

- no raw SQL from the LLM
- deterministic SELECT-only compiler
- bound parameters
- max 3 analytical queries
- snapshot-pinned execution
- exact `queryPlanHash` provenance

The planner validator was not relaxed.

## Planner Contract Fix

Planner instructions now explicitly require:

- `planVersion` exactly `customer-intelligence-copilot-analysis-plan-v1`
- `status` exactly one of `query_plan`, `answer_from_context`, `unsupported_data`,
  `unsupported_operation`, `clarification_required`
- required conditional properties for each status
- repair must regenerate the complete valid envelope using validator errors

Invalid envelopes such as `{ "planVersion": 1, "status": "valid" }` remain rejected.

## Context Strategy

The model context is bounded and combines:

- summary checkpoint when the conversation exceeds `CUSTOMER_INTELLIGENCE_COPILOT_SUMMARY_AFTER_TURNS`
- recent turns capped by `CUSTOMER_INTELLIGENCE_COPILOT_CONTEXT_RECENT_TURNS`
- pinned snapshot context
- structured analytical references
- bounded recent result samples

The durable DB retains the original message rows and query execution metadata.

## Snapshot Pinning

A conversation is created against a resolved Customer Intelligence snapshot context and keeps that
context for subsequent analytical turns. Refresh remains explicit. Refresh updates the pinned
context, clears context-dependent analytical results/references, preserves conversation messages,
and records a system refresh turn.

## API Compatibility

Preserved:

- `POST /v1/customer-intelligence/copilot/sessions`
- `POST /v1/customer-intelligence/copilot/sessions/:sessionId/messages`
- `POST /v1/customer-intelligence/copilot/sessions/:sessionId/refresh`
- `POST /v1/customer-intelligence/copilot/sessions/:sessionId/reset`
- `DELETE /v1/customer-intelligence/copilot/sessions/:sessionId`
- `POST /v1/customer-intelligence/copilot/sessions/:sessionId/export`

Added:

- `GET /v1/customer-intelligence/copilot/sessions`
- `GET /v1/customer-intelligence/copilot/sessions/:sessionId`

`sessionId` remains the external identifier and maps 1:1 to durable `conversation_id`.

## Error Taxonomy

The OpenAI-compatible adapter classifies safe provider errors:

- `provider_authentication_error`
- `provider_billing_error`
- `provider_rate_limited`
- `provider_timeout`
- `provider_network_error`
- `provider_invalid_response`

The session service also returns:

- `orchestrator_invalid`
- `planner_invalid`
- `analytics_timeout`
- `analytics_unavailable`
- `answer_generation_failed`

No API keys or provider payloads are exposed in client responses.

## Security Invariants

- The orchestrator cannot invoke arbitrary tools.
- The planner cannot emit SQL into MariaDB.
- Unknown decision actions fail closed.
- Unknown plan statuses fail closed.
- Analytical execution remains behind the validated AnalyticalQueryPlan compiler/runtime.
- XLSX export re-executes the stored validated plan against pinned context.
- List endpoints expose metadata only, not PII.

## Test Evidence

Focused local validation:

`npm test -- tests/unit/customer-intelligence-copilot-contracts.test.ts tests/unit/customer-intelligence-copilot.test.ts tests/unit/customer-intelligence-copilot-session.test.ts tests/unit/http-json-copilot-model.test.ts tests/unit/openai-compatible-copilot-model.test.ts tests/integration/customer-intelligence-copilot-session-routes.test.ts tests/integration/customer-intelligence-copilot-route.test.ts`

Result: PASS, 7 files, 67 tests.

Full validation should run before deployment:

- `npm run build`
- `npm test`
- `npm run lint`

## Controlled EC2 Validation

Do not use real secrets in fixtures. Against a configured EC2 environment:

1. Apply migration `010_create_customer_intelligence_copilot_conversations.sql`.
2. Start customer-profile with Analytics DB and Copilot provider configured.
3. Create a session.
4. Send `¿Cuántos clientes hay?`.
5. Send `¿Cuántos hay en cada cluster?`.
6. Send `¿Cuál tiene mayor ticket promedio?`.
7. Send `¿Por qué?`.
8. Send `¿Cuál es el mejor grupo?` and expect clarification.
9. Send `Por gasto total` and expect continuation.
10. Restart customer-profile.
11. Reopen the same session with `GET /sessions/:sessionId`.
12. Send `Compara ese grupo con el cluster 1`.
13. Export a referenced analytical result as XLSX.

Live validation: NOT_RUN.

## Known Limitations

- Summary checkpointing is deterministic/extractive in this slice; it does not call a separate
  summarizer model.
- Durable persistence is wired for production MariaDB; no live MariaDB restart smoke was run in
  this local validation.
- The legacy single-turn endpoint remains planner-first for backward compatibility.

## T05.1 MySQL JSON Deserialization Hardening

EC2 symptom: session creation persisted correctly, but `GET /v1/customer-intelligence/copilot/sessions/:sessionId`
and message turns failed with `500 internal_error` before provider execution.

Root cause: mysql2/MariaDB may return JSON columns as already-materialized JavaScript objects or
arrays, while the session store assumed every JSON-backed field was a string and called
`JSON.parse()` unconditionally. On EC2 this produced `"[object Object]" is not valid JSON` for
conversation JSON fields.

Fix: `mysql-copilot-session-store.ts` now treats JSON-backed columns as `MysqlJsonValue` and uses a
strict parser that accepts valid JSON strings, materialized objects and materialized arrays. It
rejects malformed strings, `null`, `undefined`, numbers and booleans for required JSON fields.

Fields hardened:

- `pinned_context_json`
- `resolved_ids_json`
- `query_ids_json`
- `source_query_ids_json`
- `plan_json`
- `snapshot_provenance_json`
- `result_metadata_json`
- `result_sample_json`
- `references_json`

Test evidence:

- `npm test -- tests/unit/mysql-copilot-session-store.test.ts` - PASS, 1 file, 15 tests

Live validation status remains pending until redeployed and re-tested on EC2.

## T05.2 Orchestrator Contract Hardening

EC2 symptom: after T05.1 fixed MariaDB persistence, a fresh persisted session loaded with
`turnCount = 0`, `resultCount = 0` and `analyticalReferences = []`. The first real turn,
`Cuantos clientes hay?`, reached the conversational orchestrator but returned `502` with
`orchestrator_invalid`. The invalid decision attempted `answer_from_context` even though the fresh
session had no analytical references or retained results.

Root cause: the conversation decision validator enforced envelope syntax but did not validate
action feasibility against the supplied session context. The repair attempt received the invalid
decision and validator errors, but not compact explicit constraints showing that zero usable
`sourceQueryIds` made `answer_from_context` impossible.

Fix:

- The conversation decision validator now checks `answer_from_context` against current session
  analytical references and recent results.
- `answer_from_context` is rejected when no usable session sources exist, when `sourceQueryIds` is
  empty, when an id is malformed, when an id is duplicated, when an id was invented, or when
  `instruction` is empty.
- `run_analytics` still requires a non-empty `analyticalQuestion`.
- `respond_directly` is rejected for deterministic fresh Customer Intelligence business fact
  requests such as counts, aggregates, rankings, segmentation values and population values.
- The orchestrator prompt version was incremented from
  `customer-intelligence-copilot-orchestrator-v1` to
  `customer-intelligence-copilot-orchestrator-v2`; the decision contract remains
  `customer-intelligence-conversation-decision-v1`.
- Initial decision and repair inputs now include compact action constraints: allowed actions,
  available source ids, reference/result counts, whether context answering is allowed, whether the
  question is a fresh business fact, and concise valid envelopes.
- Repair still regenerates a complete envelope and fails closed if the repaired decision remains
  invalid.
- Production wiring emits safe orchestrator diagnostics with action names, validation errors,
  repair flags and source counts only. It does not log raw provider payloads, credentials or DB
  records.

Tests added cover fresh customer counts, cluster distribution counts, direct RFM explanation,
invalid empty context answers, invented `sourceQueryIds`, valid prior-result context answering,
ambiguous best-group clarification, valid repair to `run_analytics`, and invalid repair fail-closed
behavior.

Local focused validation:

`npm test -- --run tests/unit/customer-intelligence-copilot-contracts.test.ts tests/unit/customer-intelligence-copilot-session.test.ts tests/unit/openai-compatible-copilot-model.test.ts tests/unit/http-json-copilot-model.test.ts`

Result: PASS, 4 files, 46 tests.

Live validation: NOT_RUN.

## T05.5 Answer Generation Reliability and Latency Observability

Live symptom: in a fresh T05.4 session, `Cual cluster tiene mayor ticket promedio?` completed
successfully and identified Cluster 3. The follow-up `Por que?` also passed semantic routing:
orchestrator selected `run_analytics`, preserved `activeSemanticEntityId = 3`, and planner produced
a valid multi-query `query_plan`. The client timed out at 60s, and the persisted assistant turn later
showed `provider_invalid_response` with `Copilot model provider returned malformed JSON`.

Provider call-chain audit:

- Orchestrator generation: OpenAI-compatible chat completion uses `response_format: json_object` and
  parses the model message content as `CopilotConversationDecision` JSON.
- Orchestrator repair: same JSON contract as orchestrator generation.
- Planner generation: OpenAI-compatible chat completion uses `response_format: json_object` and
  parses the model message content as `CopilotAnalysisPlan` JSON.
- Planner repair: same JSON contract as planner generation.
- Answerer generation: OpenAI-compatible chat completion does not send JSON response format and
  returns model message content as free-form text. It must not parse that text as JSON.
- The `http_json` adapter keeps its existing structured transport envelope. Its answer endpoint
  expects provider JSON containing `answer` or `output`, but the returned answer string remains
  free-form text.

Root cause classification: because orchestrator and planner had already succeeded in the live trace,
the exact `malformed JSON` message maps to the answerer provider call failing while parsing the
provider transport envelope (`response.json()`), not to a planner/orchestrator model-content parse
and not to `JSON.parse()` of answer text.

Fix:

- Provider errors now carry safe stage metadata: `orchestrator`, `orchestrator_repair`, `planner`,
  `planner_repair`, or `answerer`.
- Session diagnostics translate ambiguous provider invalid responses into internal stage-specific
  failure statuses such as `orchestrator_provider_invalid_response`,
  `planner_provider_invalid_response`, and `answerer_provider_invalid_response`.
- The public response status remains compatible as `provider_invalid_response`.
- Planner provider failures are now mapped to a persisted copilot response instead of escaping the
  session turn as an unclassified runtime failure.
- Answerer OpenAI-compatible output remains plain text. JSON-looking answer text is returned as text
  and no `response_format` is requested for answer generation.

Latency observability:

- A new safe event `customer_intelligence_copilot_stage_latency` is emitted for model stages,
  aggregate analytical execution, and the total turn.
- Fields are limited to `stage`, `provider`, `model`, `durationMs`, `success`, `failureStatus`,
  `repairAttempted`, `queryCount`, `analyticsExecutionDurationMs`, and `totalTurnDurationMs`.
- Diagnostics do not include raw provider payloads, prompts, SQL, secrets, result rows, PII or
  chain-of-thought.

Timeout behavior:

- `CUSTOMER_INTELLIGENCE_COPILOT_TIMEOUT_MS` defaults to `30000`.
- The timeout is applied per provider `fetch` call in the model adapter.
- It is not a whole-turn timeout. A `run_analytics` turn can spend separate timeout budgets on
  orchestrator, planner, optional repair calls, answerer, and analytical query execution.
- T05.5 does not use timeout increase as the primary fix.

Regression coverage:

- OpenAI-compatible answerer accepts plain-text answer content and does not parse free-form text as
  JSON.
- OpenAI-compatible orchestrator malformed model JSON is classified with stage `orchestrator`.
- OpenAI-compatible planner malformed model JSON is classified with stage `planner`.
- Answerer malformed provider envelopes are classified with stage `answerer`.
- `http_json` malformed answer envelopes are classified with stage `answerer`.
- Session stage latency diagnostics are emitted for `orchestrator`, `planner`,
  `analytics_execution`, `answerer`, and `turn`.
- Planner and answerer provider invalid responses are logged internally as
  `planner_provider_invalid_response` and `answerer_provider_invalid_response`.
- T05.4 semantic follow-up regression remains covered by the semantic benchmark.

Local focused validation:

`npm test -- --run tests/unit/openai-compatible-copilot-model.test.ts tests/unit/http-json-copilot-model.test.ts tests/unit/customer-intelligence-copilot-session.test.ts tests/unit/customer-intelligence-copilot-semantic-benchmark.test.ts`

Result: PASS, 4 files, 65 tests.

Live validation: NOT_RUN.

## T05.3 Planner AnalyticalQueryPlan Contract Hardening

EC2 symptom: after T05.2, the conversational orchestrator correctly routed the fresh question
`Cuantos clientes hay?` into analytics, but the planner returned `planner_invalid` with an invalid
embedded `q1` AnalyticalQueryPlan:

- `q1: plan must specify either "select" (row mode) or "metrics" (aggregate mode)`
- `q1: each metric requires a string alias matching ^[A-Za-z_][A-Za-z0-9_]*$`

This confirmed the live failure had moved downstream:

conversation -> orchestrator PASS -> planner reached -> CopilotAnalysisPlan envelope parsed ->
embedded AnalyticalQueryPlan rejected by the deterministic runtime validator.

Root cause: planner instructions described the outer CopilotAnalysisPlan envelope but did not give
the model a strong enough contract for the embedded AnalyticalQueryPlan. In particular, the planner
was not consistently adhering to the row-vs-aggregate mode split and did not consistently include
required metric aliases.

Fix:

- Planner prompt version incremented from `customer-intelligence-copilot-planner-v1` to
  `customer-intelligence-copilot-planner-v2`.
- The outer CopilotAnalysisPlan contract remains `customer-intelligence-copilot-analysis-plan-v1`.
- The embedded AnalyticalQueryPlan contract remains `customer-intelligence-query-plan-v1`.
- Planner instructions now explicitly document row mode and aggregate mode, including required,
  optional and forbidden fields.
- Metric rules now explicitly require `aggregation` and `alias`, require `field` for
  `count_distinct`, `sum`, `avg`, `min` and `max`, and require omitting `field` for COUNT(*)
  semantics.
- Metric aliases are documented with the exact runtime regex:
  `^[A-Za-z_][A-Za-z0-9_]*$`.
- The planner now receives a compact machine-readable `queryContract` containing the query plan
  version, mode rules, metric schema, allowed aggregations, alias pattern, filter structure,
  dimension limits, ordering rules, row limits and validator-conformant examples.
- `queryContract` is sent to both initial planner generation and bounded repair.
- Repair still regenerates a complete CopilotAnalysisPlan envelope and fails closed if the repaired
  embedded AnalyticalQueryPlan remains invalid.
- Session planner diagnostics now distinguish initial invalid plans, repair attempted, repair
  succeeded, repair failed, query step ids and validation error categories without logging raw
  provider payloads, SQL, credentials or DB records.

Tests added cover valid total population count, customers per cluster, average ticket by cluster,
missing row/aggregate mode, missing metric alias, invalid alias examples, count without field, avg
without field, select plus metrics, valid repair continuation, invalid repair fail-closed behavior,
and provider serialization of `queryContract`.

Local focused validation:

`npm test -- --run tests/unit/customer-intelligence-query-planner-contract.test.ts tests/unit/customer-intelligence-query-validator.test.ts tests/unit/customer-intelligence-copilot-contracts.test.ts tests/unit/customer-intelligence-copilot-session.test.ts tests/unit/customer-intelligence-copilot.test.ts tests/unit/openai-compatible-copilot-model.test.ts tests/unit/http-json-copilot-model.test.ts`

Result: PASS, 7 files, 123 tests.

Live validation: NOT_RUN.

## T05.4 Semantic Analytical Reasoning

Motivation: after T05.1-T05.3, the live EC2 path was healthy for persistence, routing, planner
contract generation, bounded AnalyticalQueryPlan execution, provenance and simple factual answers.
The remaining failures were semantic: conversational follow-ups and broad commercial questions were
not getting enough context to resolve intent, choose useful analyses, and synthesize evidence with
proper limitations.

Observed EC2 semantic failures:

- After `Cual tiene mayor ticket promedio?` returned Cluster 3, the follow-up `Por que?` produced
  `clarification_required` instead of resolving the referent and running explanatory analytics.
- `Cual es el mejor grupo?` correctly asked for clarification, but the follow-up `Por gasto total`
  did not sufficiently constrain the comparison to assigned clusters and could surface
  `clusterId = null` as the top group.
- `currentAudience` could remain tied to an older first retained query result, such as
  `clusters_by_count -> clusterId = 0`, after the conversational focus had moved to Cluster 3.

Semantic context:

- `CopilotSessionContext` now includes a compact derived `semanticFocus`.
- The focus is reconstructed from persisted turns, retained analytical results and stored query
  plans, so no schema migration is required.
- The focus includes active entity, active metric, active comparison, unresolved clarification and
  bounded top-row facts from the latest analytical result.
- It does not persist or expose chain-of-thought, raw provider payloads, SQL, credentials or PII.
- `currentAudience` reference derivation now uses the most recent retained result with derivable
  entity filters instead of the oldest retained result, preventing stale Cluster 0 focus after a
  later Cluster 3 result.

Contextual follow-ups:

- Orchestrator prompt version incremented from `customer-intelligence-copilot-orchestrator-v2` to
  `customer-intelligence-copilot-orchestrator-v3`.
- The orchestrator is instructed to resolve elliptical follow-ups from `semanticFocus`, recent
  turns, unresolved clarification, analytical references and recent results when there is one
  dominant plausible referent.
- Examples include `Por que?`, `Y el 1?`, `Eso es mucho?`, `Y versus los otros?`, `Cual de esos?`
  and `Que pasa con ese grupo?`.
- Clarification remains correct when ambiguity materially changes the result, such as an initial
  `Cual es el mejor grupo?` with no criterion.

Analytical reasoning:

- Planner prompt version incremented from `customer-intelligence-copilot-planner-v2` to
  `customer-intelligence-copilot-planner-v3`.
- The planner is encouraged to use the existing max-3-query budget for explanatory and exploratory
  analysis when synthesis requires more than one bounded query.
- The query contract now includes semantic rules for nullable analytical dimensions. For cluster
  and segment comparisons/rankings, nullable ids should be excluded unless the user explicitly asks
  for whole-base distribution including unassigned/unsegmented customers.
- Broad prompts such as `Que ves interesante?`, `Analiza mis clientes`, `Donde ves oportunidades?`
  and `Hay algo raro?` should run useful initial analytics instead of defaulting to clarification.
- Colloquial commercial language is explicitly mapped to available analytical concepts through
  model interpretation, not a hardcoded synonym table.

Epistemic answer boundaries:

- Answer prompt version incremented from `customer-intelligence-copilot-answer-v1` to
  `customer-intelligence-copilot-answer-v2`.
- The answerer must distinguish facts, interpretations, hypotheses, recommendations and
  limitations semantically.
- Correlation must not be converted into causation.
- Profitability must not be equated with spend or AOV when margin/cost/profit fields are absent.
- Future purchase questions must not be answered as predictions when no predictive model output is
  available.

Observability:

- Orchestrator diagnostics now include safe semantic validation fields: whether follow-up context
  was used, active semantic entity type/id, whether an unresolved clarification is present, and a
  bounded sanitized summary plus hash of the rewritten analytical question when `run_analytics` is
  selected.
- Planner diagnostics from T05.3 remain bounded to statuses, repair flags, query step ids and
  validation error categories.

Benchmark coverage:

- Simple facts: customer count and assigned-cluster counts.
- Contextual follow-ups: `Por que?`, `Y el 1?`, and `Eso es mucho?`.
- Clarification resolution: `Cual es el mejor grupo?` then `Por gasto total`, with assigned-cluster
  filtering.
- Colloquial language: `compra mas caro`, `medios muertos`, and `compra harto pero poco seguido`.
- Exploratory prompts: interesting patterns, general read, commercial opportunity and anomaly
  exploration.
- Limits: unavailable profitability and unsupported future prediction.
- Epistemic safety: explanatory analysis passes through answerer with non-causal grounding rules.
- Reference state: focus moves from an older Cluster 0 distribution to the later Cluster 3 result.

Local focused validation:

`npm test -- --run tests/unit/customer-intelligence-copilot-semantic-benchmark.test.ts tests/unit/customer-intelligence-copilot-session.test.ts tests/unit/customer-intelligence-query-planner-contract.test.ts tests/unit/customer-intelligence-query-validator.test.ts tests/unit/openai-compatible-copilot-model.test.ts tests/unit/http-json-copilot-model.test.ts`

Result: PASS, 6 files, 118 tests.

Live validation: NOT_RUN.
