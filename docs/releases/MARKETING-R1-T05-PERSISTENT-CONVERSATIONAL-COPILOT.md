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

## T05.6 Copilot Latency Optimization and Model Benchmarking

Live baseline:

- Simple analytical question, `Cual cluster tiene mayor ticket promedio?`: orchestrator about
  4.3s, planner about 10.0s, analytics about 0.06s, answerer about 15.1s, total about 29.5s.
- Complex follow-up, `Por que?`: orchestrator about 6.7s, planner about 30.0s, total about
  36.8s, with planner failing at the configured provider timeout.
- More than 99% of the observed latency is model/provider inference, not deterministic analytical
  query execution.

Timeout classification:

- The OpenAI-compatible and `http_json` adapters already classified fetch aborts as
  `provider_timeout`, but an abort raised while parsing the provider transport JSON envelope could
  be caught as malformed JSON.
- Transport JSON parse now checks abort errors and preserves `provider_timeout` instead of
  `provider_invalid_response`.
- Stage-aware internal diagnostics now classify timeouts as
  `orchestrator_provider_timeout`, `planner_provider_timeout`, or `answerer_provider_timeout`.
- Public response statuses remain compatible (`provider_timeout`, `provider_invalid_response`,
  `provider_network_error`, `provider_rate_limited`, `provider_authentication_error`,
  `provider_billing_error`).

Latency optimizations:

- Independent multi-query analytical plans now execute concurrently with a bounded cap equal to the
  existing max query budget (`CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES`, currently 3).
- Result ordering remains deterministic because query results are reassembled in validated plan
  order.
- Per-query provenance, stable query ids, validation failure handling and persisted result retention
  are preserved.
- Simple single-query aggregate answers can use an internal deterministic renderer and skip the
  answerer LLM. Detection is based on the validated plan and result shape, not hardcoded user
  phrases.
- Supported deterministic render cases include total customer count, simple grouped counts and
  top-1 grouped metric rankings such as highest average ticket by cluster.
- Deep/exploratory multi-query analysis still uses answerer synthesis to preserve semantic and
  epistemic quality.

Prompt and context reduction:

- Planner prompt version incremented to `customer-intelligence-copilot-planner-v4`.
- Redundant textual examples were replaced with a pointer to the existing machine-readable
  `queryContract` examples, keeping the strict contract while reducing repeated planner context.
- T05.3 query contract validation and T05.4 semantic follow-up behavior remain covered by focused
  tests.

Observability:

- `customer_intelligence_copilot_stage_latency` now supports optional `promptCharCount`,
  `responseCharCount`, `promptTokens`, `completionTokens`, `totalTokens`, and `executionMode`.
- `executionMode` is one of `fast_path`, `simple_analysis`, or `deep_analysis`.
- Provider usage metadata is captured when the provider response exposes it.
- If token usage is unavailable, adapters capture bounded serialized request/response character
  counts.
- Diagnostics still do not include prompts, raw provider payloads, SQL, credentials, result rows,
  PII or chain-of-thought.

Model configuration:

- `CUSTOMER_INTELLIGENCE_COPILOT_MODEL` remains the default model selector.
- Optional stage-specific overrides are supported:
  `CUSTOMER_INTELLIGENCE_COPILOT_ORCHESTRATOR_MODEL`,
  `CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_MODEL`, and
  `CUSTOMER_INTELLIGENCE_COPILOT_ANSWERER_MODEL`.
- Provider abstraction stays generic; no DeepSeek-specific branch was added to domain or
  application logic.

Benchmark harness:

- Added `npm run intelligence:copilot:benchmark`.
- Default benchmark model list is `deepseek-v4-flash,deepseek-v4-pro`, overrideable with
  `--models=` or `CUSTOMER_INTELLIGENCE_COPILOT_BENCHMARK_MODELS`.
- Runs default to 3, overrideable with `--runs=` or
  `CUSTOMER_INTELLIGENCE_COPILOT_BENCHMARK_RUNS`.
- Scenarios cover simple fact, simple grouped ranking, contextual deep follow-up, clarification
  continuation, exploratory analysis, commercial recommendation and profitability limitation.
- Output records include model, scenario id, run, stage latencies, total latency, query count,
  repair count, status, timeout stage, invalid-response stage and semantic pass/fail.
- Aggregate reporting includes mean, p50, p95 when sample size allows, min, max, timeout count,
  invalid-response count, success rate and semantic pass rate.

Example:

`npm run intelligence:copilot:benchmark -- --models=deepseek-v4-flash,deepseek-v4-pro --runs=3`

Flash vs Pro benchmark result: NOT_RUN locally in this task because it requires configured provider
credentials and an analytics DB. No production model switch was made without controlled benchmark
evidence.

Remaining debt:

- Orchestrator and planner were not merged into a single structured reasoning/planning call in
  T05.6; that remains higher-risk and should be decided using benchmark evidence.
- Simple fast path still needs the orchestrator/planner route unless a later deterministic intent
  layer or merged plan envelope is introduced.
- Live EC2 validation and Flash/Pro comparison remain pending.

Local focused validation:

`npm test -- --run tests/unit/openai-compatible-copilot-model.test.ts tests/unit/http-json-copilot-model.test.ts tests/unit/customer-intelligence-copilot-session.test.ts tests/unit/customer-intelligence-copilot-semantic-benchmark.test.ts tests/unit/customer-intelligence-copilot-benchmark.test.ts tests/unit/customer-intelligence-query-planner-contract.test.ts tests/unit/customer-intelligence-query-validator.test.ts`

Result: PASS, 7 files, 131 tests.

Live validation: NOT_RUN.

## T05.7 Unified Analytical Decision and Planning

Motivation: T05.6 showed that analytical turns still paid two serial model calls before analytics:
conversation routing and analytical planning. T05.7 introduces a guarded unified path that decides
the conversational action and, for `run_analytics`, returns the validated analytical plan in the same
structured provider response.

Contract:

- New internal contract: `customer-intelligence-conversation-plan-v1`.
- Supported actions remain `respond_directly`, `clarification_required`, `answer_from_context`,
  `run_analytics` and `unsupported`.
- `run_analytics` requires `analyticalQuestion` plus a complete embedded `CopilotAnalysisPlan`
  `query_plan`.
- Non-analytical actions must not include `analysisPlan`.
- The answerer contract is unchanged: answer generation is plain text and is not parsed as JSON.

Runtime behavior:

- The session service uses the unified path when
  `CUSTOMER_INTELLIGENCE_COPILOT_UNIFIED_PLANNER_ENABLED=true` and the configured model exposes
  unified planner methods.
- The unified path does not call legacy `generateConversationDecision()` followed by
  `generateAnalysisPlan()`.
- One bounded repair call is available through `unified_planner_repair`.
- Invalid unified envelopes and invalid embedded `AnalyticalQueryPlan` objects fail closed after
  repair, using the same deterministic validators as the legacy orchestrator and planner.
- No automatic fallback to the legacy two-call route is performed for unified provider timeout or
  invalid-response failures.

Observability:

- Stage latency diagnostics now include `unified_planner` and `unified_planner_repair`.
- Existing safe stage fields remain: stage, provider, model, duration, success/failure,
  repairAttempted, queryCount, analyticsExecutionDurationMs and totalTurnDurationMs.
- Diagnostics continue to exclude raw provider payloads, prompts, SQL, credentials, result rows,
  PII and chain-of-thought.

Benchmark harness:

- Benchmark runs now pass through the production unified planner flag.
- Progress is logged per model/scenario/run.
- Optional `--output=` or `CUSTOMER_INTELLIGENCE_COPILOT_BENCHMARK_OUTPUT` writes JSONL records as
  each run completes.
- Unified planner latency is included in the benchmark planning bucket.

Local focused validation:

`npm test -- --run tests/unit/customer-intelligence-copilot-contracts.test.ts tests/unit/openai-compatible-copilot-model.test.ts tests/unit/http-json-copilot-model.test.ts tests/unit/customer-intelligence-copilot-session.test.ts tests/unit/customer-intelligence-copilot-semantic-benchmark.test.ts tests/unit/customer-intelligence-copilot-benchmark.test.ts tests/unit/customer-intelligence-query-planner-contract.test.ts tests/unit/customer-intelligence-query-validator.test.ts`

Result: PASS, 8 files, 156 tests.

Live validation: NOT_RUN.

## T05.8 Native Tool-Calling Analytical Runtime

Motivation: live T05.7 benchmark evidence showed that the unified mega-envelope did not improve
reliability or latency: simple and grouped analytical scenarios failed before reaching analytics,
and unified repairs increased latency. T05.8 keeps T05.7 behind its own flag and introduces a new,
separate native tool-calling runtime for analytical conversation turns.

Architecture:

- The session runtime can now ask the OpenAI-compatible provider for a normal assistant response or
  native `tool_calls` using Chat Completions `tools` and `tool_choice`.
- The only analytical tool is `run_analytical_queries`.
- Tool arguments contain `queries: [{ id, plan }]`, with 1 to 3 query steps.
- The provider adapter parses native `message.tool_calls[].function.arguments` as JSON and exposes
  structured tool-call data to application code. Malformed argument JSON is not executed.
- The `http_json` provider is not faked into tool calling; when the tool runtime flag is enabled and
  no native method exists, the session fails explicitly with unsupported tool runtime behavior.

Model-call budgets:

- Direct conversation: one model call (`tool_selection`), no analytics.
- Simple analytics: one model call (`tool_selection`), analytical execution, deterministic renderer,
  no synthesis model call.
- Deep analytics: one model call (`tool_selection`), analytical execution, one final
  `tool_synthesis` model call. No recursive tool loop or third inference is allowed.

Validation boundary:

- Tool-call arguments are untrusted.
- Unknown tools, malformed arguments, duplicate query ids, query counts over
  `CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES`, and invalid `AnalyticalQueryPlan` objects fail closed.
- Existing T03 validation/compiler/runtime remains the security firewall: no provider-generated SQL,
  no arbitrary expressions, no table names, SELECT-only compiled queries, bound parameters, field
  registry enforcement, snapshot pinning, provenance, and queryPlanHash remain intact.

Context projection:

- The tool runtime request uses a stable system prefix with tool-runtime and epistemic rules.
- The dynamic suffix carries the compact projected session context: pinned snapshot context,
  conversation summary, recent turns, semantic focus, unresolved clarification, analytical
  references, recent results, and deterministic recent findings.
- `semanticFocus.activeFinding` is derived from persisted plans/results when the result shape makes a
  top-rank or single-value finding deterministic. It is contextual state, not chain-of-thought, and
  requires no migration.

Execution modes:

- Native tool path diagnostics use `direct_response`, `simple_analysis`, and `deep_analysis`.
- Legacy paths are retained for rollback/benchmark continuity.

Observability:

- Added safe latency stages `tool_selection` and `tool_synthesis`.
- Stage diagnostics include duration, success/failure, failureStatus, queryCount, executionMode,
  analyticsExecutionDurationMs, totalTurnDurationMs, prompt/response char counts, token usage, and
  provider cache tokens when available.
- New internal failure statuses include `tool_selection_provider_timeout`,
  `tool_selection_provider_invalid_response`, `tool_call_invalid_arguments`,
  `tool_call_unknown_tool`, `tool_call_query_validation_failed`, `tool_execution_timeout`,
  `tool_execution_unavailable`, `tool_synthesis_provider_timeout`, and
  `tool_synthesis_provider_invalid_response`.
- Diagnostics continue to exclude raw prompts, provider payloads, SQL, credentials, result rows, PII,
  and chain-of-thought.

Feature flags:

- `CUSTOMER_INTELLIGENCE_COPILOT_TOOL_RUNTIME_ENABLED=false` by default.
- `CUSTOMER_INTELLIGENCE_COPILOT_UNIFIED_PLANNER_ENABLED=false` by default.
- The flags are independent. Tool runtime, unified planner, and legacy routes can be benchmarked
  separately.

Benchmark harness:

- `npm run intelligence:copilot:benchmark` supports `--runtime=legacy`, `--runtime=unified`,
  `--runtime=tools`, or production-config-driven runtime.
- Records now include runtime, tool selection latency, tool synthesis latency, tool call count,
  cache hit/miss tokens, and cache hit ratio.
- Existing progress logging and JSONL incremental output are preserved.

Local focused validation:

`npm test -- --run tests/unit/customer-intelligence-copilot-contracts.test.ts tests/unit/openai-compatible-copilot-model.test.ts tests/unit/http-json-copilot-model.test.ts tests/unit/customer-intelligence-copilot-session.test.ts tests/unit/customer-intelligence-copilot-semantic-benchmark.test.ts tests/unit/customer-intelligence-copilot-benchmark.test.ts tests/unit/customer-intelligence-query-planner-contract.test.ts tests/unit/customer-intelligence-query-validator.test.ts tests/unit/config.test.ts`

Result: PASS, 9 files, 182 tests.

Live benchmark: NOT_RUN locally in this task because it requires configured provider credentials and
an analytics DB.

Live validation: NOT_RUN.

## T05.8.1 Tool Runtime Latency and Semantic Hardening

Motivation: fresh T05.8 live evidence showed the native tool runtime reached analytics but still
spent unnecessary time in synthesis for simple grouped ranking, and the deep follow-up `Por que?`
did not reliably preserve the Cluster 3 analytical focus through the tool path.

Live T05.8 baseline evidence:

- `simple_fact`: PASS, total 1.588s, tool selection 1.492s, analytics 84ms,
  `toolSynthesisMs = 0`.
- `simple_grouped_ranking`: PASS, total 8.561s, tool selection 2.816s, analytics 60ms,
  synthesis 5.682s. The synthesis call was unnecessary because the ordered grouped aggregate
  already identified the winner deterministically.
- `contextual_deep_followup`: HTTP/runtime answered, semantic FAIL, total 34.096s, tool selection
  11.777s, analytics 230ms, synthesis 22.079s, no timeout.

Runtime changes:

- Simple grouped rankings now use the deterministic renderer when there is one grouped aggregate
  metric ordered by that metric. This covers the `Cual cluster tiene mayor ticket promedio?` path
  without a synthesis model call.
- Grouped count distributions without an explicit top ranking render as bounded distribution
  summaries instead of inventing a "winner".
- Tool selection now sends a stable system prefix plus a compact dynamic suffix. Recent retained
  results are projected as metadata only in selection, without rows.
- Deep synthesis now uses a dedicated compact prompt and result summary payload. It no longer
  reuses the tool-selection prompt, query contract, schema, tool definitions, or raw tool result
  envelope.
- OpenAI-compatible tool synthesis sends no `tools` field when tool definitions are empty.

Semantic hardening:

- Derived semantic focus now keeps `activeEntity = cluster 3` for top cluster results even when the
  result also has comparison dimensions.
- The active metric name is normalized to stable semantic names such as `averageOrderValue`.
- `activeFinding` carries top-rank source query context so deep follow-ups can reference the
  original analytical finding without chain-of-thought or raw provider payloads.
- The benchmark contextual follow-up evaluator accepts either planner diagnostics or safe native
  tool runtime diagnostics, and JSONL records include `semanticFailureReason` when an evaluator can
  identify the failed condition.

Observability:

- Stage diagnostics now include compact semantic focus fields, context projection size, tool query
  ids/counts, bounded query summaries, synthesis result-summary size, synthesis input result count,
  provider/model metadata, success/failure, repair flag, analytics execution time and total turn
  time.
- Diagnostics continue to exclude raw prompts, provider payloads, SQL, credentials, result rows,
  PII and chain-of-thought.

Feature flags:

- `CUSTOMER_INTELLIGENCE_COPILOT_TOOL_RUNTIME_ENABLED=false` remains the default.
- `CUSTOMER_INTELLIGENCE_COPILOT_UNIFIED_PLANNER_ENABLED=false` remains the default.

Local focused validation:

`npm test -- --run tests/unit/customer-intelligence-copilot-session.test.ts tests/unit/customer-intelligence-copilot-benchmark.test.ts`

Result: PASS, 2 files, 46 tests.

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
