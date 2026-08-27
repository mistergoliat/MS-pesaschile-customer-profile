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

## T05.8.7 Final User Semantics and Response-State Hardening

Motivation: the remaining T05 production issues were no longer about analytical reach or session
durability, but about final user semantics. A valid answered turn could still be surfaced to CRM
users as a temporary model error, analytical subpopulations could be confused with full entity
counts, internal cluster interpretation codes could leak into user-facing Spanish, and
recommendation questions such as reactivation prioritization still needed a tighter epistemic
boundary.

Response-state invariant:

- Public copilot responses now carry an explicit top-level `finalResponseState`.
- `answered` without synthesis fallback maps to `success`.
- `answered` with deterministic synthesis fallback maps to `degraded_success`.
- Technical no-answer states map to `failure`.
- `clarification_required`, `unsupported_data`, `unsupported_operation`,
  `answered_from_context`, and `responded_directly` remain non-fatal public responses and no
  longer require CRM consumers to infer precedence from provider-oriented details.
- Public degraded-success responses retain bounded metadata such as
  `analysis.synthesisFallbackUsed = true`, but no longer expose provider failure reasons as the
  primary user-facing state.

Deterministic fallback hardening:

- Tool-synthesis fallback no longer says that advanced synthesis failed or degraded.
- The fallback now returns business-facing content only, while internal stage diagnostics continue
  to preserve provider timeout/network/invalid-response causes.
- Public analysis metadata now exposes bounded safe diagnostics:
  `finalResponseState`, `populationContextPresent`, `fullPopulationCount`,
  `analyzedPopulationCount`, and `analysisPopulationBasis` when deterministically derivable.

Population semantics:

- Structured analytical evidence now includes bounded `populationContexts`.
- Each population context is derived only from validated analytical results and may carry:
  `entityType`, `entityId`, `fullPopulation`, `analyzedPopulation`, `analysisBasis`, and
  `coverageRatio`.
- Cluster-level RFM denominator queries are now treated as denominator metadata, not as ordinary
  business findings, so an analyzed RFM count cannot be rendered as if it were the full cluster
  size.
- When a full cluster population and an analyzed RFM subpopulation both exist and differ
  materially, deterministic fallback and synthesis payloads now preserve wording such as:
  "X clientes en total" plus "Y de ellos con informacion RFM disponible", instead of silently
  collapsing those numbers into one.

Cluster business labels:

- The business semantic registry now maps clusters to stable Spanish labels while preserving the
  numeric identity (`Cluster 0`, `Cluster 1`, `Cluster 2`, `Cluster 3`).
- Internal interpretation codes such as
  `LONG_TENURE_DORMANT_SPREAD_OUT_REPEAT_BUYERS`,
  `RECENTLY_ACTIVE_NEWER_REPEAT_BUYERS`,
  `NEW_BURST_THEN_LAPSED_BUYERS`, and
  `HIGH_VALUE_DIVERSIFIED_REPEAT_BUYERS`
  are now translated before any user-facing rendering.
- Preferred rendering is now numeric cluster identity plus business label, e.g.
  `Cluster 3 - Clientes recurrentes de alto valor y compra diversificada`.

Reactivation recommendation boundary:

- Reactivation-priority questions are now treated as supported analytical recommendation requests,
  not as unsupported future prediction requests.
- Conversation validation and orchestration now reject `respond_directly` for those questions and
  require grounded analytics instead.
- Planner, unified planner, answerer, native tool runtime, and tool-synthesis prompts now state
  explicitly that historical recommendations are allowed, but predictions or guaranteed campaign
  outcomes are not.
- Deterministic fallback now has a recommendation-safe path that preserves FACT,
  INTERPRETATION, RECOMENDACION, and LIMITACION semantics without claiming conversion forecasts.

Prompt updates:

- Tool-synthesis prompt version incremented from
  `customer-intelligence-tool-synthesis-v4` to
  `customer-intelligence-tool-synthesis-v5`.
- Prompt instructions now explicitly require:
  no internal cluster codes, no provider degradation talk when an answer exists, plain-language
  analyzed-denominator wording, and recommendation-versus-prediction separation.

Tests added/updated:

- Response-state coverage now asserts explicit `success` / `degraded_success` / `failure`
  semantics and keeps degraded synthesis on an answered HTTP/API path.
- Population coverage now asserts that full cluster counts and analyzed RFM counts remain
  distinct and that denominator wording survives deterministic fallback.
- Cluster-label coverage now asserts Spanish business labels and rejects internal cluster codes in
  user-facing prompt/rendering paths.
- Reactivation coverage now asserts that reactivation prioritization is supported, can consume up
  to the existing 3-query budget, and remains recommendation-only rather than predictive.

Local validation on Wednesday, August 26, 2026:

- Focused copilot validation:
  `npx vitest run --config vitest.config.ts tests/unit/customer-intelligence-copilot-session.test.ts tests/unit/customer-intelligence-copilot-semantic-benchmark.test.ts tests/unit/customer-intelligence-copilot-business-semantics.test.ts tests/unit/customer-intelligence-copilot-contracts.test.ts tests/integration/customer-intelligence-copilot-route.test.ts tests/integration/customer-intelligence-copilot-session-routes.test.ts`
- Result: PASS, 6 files, 116 tests.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- `npm run lint`: PASS.
- `npm test`: PASS, 179 files, 1536 tests.

Live validation:

- NOT_RUN.
- Required fresh-session acceptance questions remain:
  `Cuantos hay en cada cluster?`,
  `Cual tiene mas clientes?`,
  `Cual tiene mayor ticket promedio?`,
  `Ahora compara el RFM del cluster con ticket promedio mas alto contra el cluster 2`,
  `Que grupo priorizarias para una campana de reactivacion y por que?`

Residual documented debt:

- Native LLM tool selection remains probabilistic within the bounded validator/repair envelope.
- Synthesis providers can still degrade occasionally, but the deterministic fallback now preserves
  a successful public answer state.
- XLSX/export remains deferred to `MARKETING-R2-A01 Audience Engine`.
- Predictive campaign propensity/conversion modeling is still unavailable.

## T05.8.8 Final Runtime Reliability

Motivation: fresh live evidence after T05.8.7 showed the remaining defects were not about
semantics but about runtime reliability. An RFM comparison turn completed analytics successfully
(~88ms) but `tool_synthesis` returned `provider_invalid_response` after ~12.7s and had to fall
back deterministically; a separate reactivation-recommendation turn timed tool_selection out at
exactly the shared 30s provider timeout with zero analytics executed, failing the turn terminally.
The unresolvedClarification flag was also observed active after a currency/unit side-question
("Eso esta en pesos o euros?") that the system should have been able to answer deterministically
and mark resolved. This slice is narrow: no memory redesign, no retrieval, no T03/clustering/RFM
changes, no analytical query count increase, no dashboard/UI, no XLSX, no model switch.

### 1. Live timeout evidence

- RFM comparison turn: tool selection success (3 queries), analytics success (~88ms,
  `evidenceBundleChars` ~4136, `evidenceComparisonCount`/`evidenceDistributionCount` 5),
  `synthesisMaxTokens` 1500, `tool_synthesis` failed with `provider_invalid_response` after
  ~12.7s, deterministic fallback executed, turn remained `answered_degraded_synthesis`.
- Reactivation-recommendation turn: `tool_selection` reached exactly the shared ~30s timeout
  (`failureStatus = tool_selection_provider_timeout`), no analytics executed, turn failed
  terminally (`contextProjectionChars` ~23098, `toolSelectionPromptChars` ~23602).
- Model context capacity is not treated as intrinsically excessive here; this is a reliability
  fix, not a context-compression redesign.

### 2-3. Stage-specific provider timeouts and diagnostics

- New env vars, parsed and bounds-validated in `configured-copilot-model.ts`:
  `CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SELECTION_TIMEOUT_MS` and
  `CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SYNTHESIS_TIMEOUT_MS`, each defaulting to `45000` and
  bounded at `60000` (`CUSTOMER_INTELLIGENCE_COPILOT_STAGE_TIMEOUT_MAX_MS`). A value that is
  non-integer, non-positive, or over the bound fails closed (`not_configured`) at startup, the
  same fail-fast pattern the existing `CUSTOMER_INTELLIGENCE_COPILOT_TIMEOUT_MS` check uses - no
  provider call is ever left unbounded.
- `CUSTOMER_INTELLIGENCE_COPILOT_TIMEOUT_MS` (default `30000`) is unchanged and remains the
  fallback/default for `orchestrator`/`orchestrator_repair`/`planner`/`planner_repair`/
  `unified_planner`/`unified_planner_repair`/`answerer` - only `tool_selection` and
  `tool_synthesis` get their own configured timeout, resolved per-call in
  `openai-compatible-copilot-model.ts`'s `resolveTimeoutMsForStage` from the request's own
  `stage`, independent of which named stage-routed model instance handles the call.
  `createConfiguredCustomerIntelligenceCopilotModel` now also returns the resolved
  `toolSelectionTimeoutMs`/`toolSynthesisTimeoutMs`, threaded through `bootstrap.ts` into the
  session service so diagnostics can report the value actually in effect.
- No blind retry was added for either stage (task requirement): a `tool_selection` timeout with
  no analytical result remains a terminal failure (`provider_timeout`, `finalResponseState:
  'failure'`); `tool_synthesis` continues to prefer the existing deterministic fallback over
  retrying the model.
- `CopilotStageLatencyDiagnostic` gained `configuredTimeoutMs` (both stages, success and failure)
  and `invalidResponseSubtype` (failure only, `provider_invalid_response` only) plus cheap
  structural context-size fields: `recentTurnCount`, `analyticalReferenceCount`,
  `recentFindingCount`, `clarificationState` (`'none' | 'open'`). No prompt contents are logged.

### 4-5. Invalid-response taxonomy and tool_synthesis audit

Audited the exact `choices[0].message.content` parsing path
(`openai-compatible-copilot-model.ts`'s `extractMessage`/`extractToolCalls`/
`conversationalTurnOutput`), the same path both `tool_selection` and `tool_synthesis` use:

- Malformed transport JSON (`response.json()` throws) -> `provider_invalid_json`.
- Non-object envelope / non-object choice -> `provider_unexpected_envelope`.
- Missing/empty `choices` -> `provider_missing_choices`.
- Missing `message` -> `provider_missing_message`.
- `content` absent (`null`/`undefined`) with no tool calls -> `provider_missing_content`.
- `content` present but blank/whitespace-only with no tool calls -> `provider_empty_response`
  (this also covers the empty-content-and-empty-tool_calls-array case caught in
  `conversationalTurnOutput`, which is a separate, non-overlapping gate from the one in
  `extractMessage` for a `tool_calls: []` payload).
- `content` absent/blank **and** `finish_reason: 'length'` -> `provider_invalid_finish_reason`
  (checked before the generic missing/empty classification, because a `max_tokens` truncation has
  a different, more actionable root cause than a genuinely empty completion - this is the most
  likely explanation for the live ~12.7s `tool_synthesis` failure with `synthesisMaxTokens: 1500`).
- Malformed `tool_calls` (not an array, or a malformed entry/id/name/arguments) ->
  `provider_invalid_tool_calls`.
- The adapter deliberately never reads `message.reasoning_content`: some OpenAI-compatible
  reasoning variants put chain-of-thought there, and this codebase never surfaces reasoning
  content to users or logs, so a response carrying only `reasoning_content` and no usable
  `content`/`tool_calls` is correctly treated the same as an empty response rather than unwrapped
  as if it were valid - no invented compatibility behavior was added for it.
- The public `category` (`provider_invalid_response`, etc.) is unchanged for backward
  compatibility; the subtype lives only in `CopilotProviderError.metadata.invalidResponseSubtype`
  and the `invalidResponseSubtype` stage-latency diagnostic field. Neither ever carries a raw
  provider payload, prompt, or credential - only which structural expectation failed.

### 6. Fallback remains a successful public response

Unchanged and re-verified: `canUseDeterministicSynthesisFallback` still gates on the public
`category` (`provider_timeout`/`provider_network_error`/`provider_invalid_response`), so the new
subtypes do not change which failures are eligible for the deterministic fallback. Analytics
success + `tool_synthesis` failure + valid evidence still produces `finalResponseState:
'degraded_success'` on an `answered` HTTP path, never a public failure, and internal diagnostics
retain the failure subtype for operators without exposing it to the response body.

### 7. Clarification lifecycle

Root cause found in `deriveSemanticFocus` (`session-context.ts`): `unresolvedClarification` was
derived by scanning **every** turn backward for the most recent one with status
`clarification_required`, with no check for whether a later turn had already resolved it. Once
any clarification_required turn occurred, it stayed "unresolved" in every subsequent turn's
context forever, unless another clarification_required turn happened to replace it.

Fix: `unresolvedClarification` is now open only when the conversation's **latest** turn is itself
`clarification_required`. The instant any further turn completes - answered, responded directly,
answered from context, unsupported, or a new clarification - the prior one is resolved, matching
the three resolution paths the task specifies (user supplied the missing criterion and the turn
proceeded; the system resolved it deterministically; the assistant answered completely and the
conversation moved on). This is not a time/turn-count expiry heuristic - a clarification that is
genuinely still the last thing that happened stays open indefinitely, exactly as required by the
live currency-question evidence ("must NOT be treated automatically as stale state").

### 8-9. Side-question handling and semantic anchor preservation

- New deterministic check in `processSessionTurn` (`session-service.ts`), evaluated before any
  routing branch or model call: `isCurrencyUnitQuestion` detects a question about the currency/
  unit of previously shown values (e.g. "Eso esta en pesos o euros?") and
  `currencyUnitDirectResponse` answers directly - every monetary value this runtime surfaces is
  Chilean pesos (CLP) - as a `responded_directly` / `finalResponseState: 'success'` turn. It never
  calls the model, never runs analytics, and never touches `analyticalState`, so
  `activeFinding`/`activeEntity`/`activeMetric` (derived only from `analyticalState.results`) are
  preserved by construction for the next turn - no special-case anchor-preservation logic was
  needed beyond not mutating that state.
- `isClarificationContent`'s free-text heuristic previously flagged **any** assistant message
  containing a "?" anywhere as a fresh `clarification_required` turn - a declarative answer with a
  mid-sentence rhetorical "?" (or one that simply referenced the question mark from the user's own
  currency question) could misclassify itself and re-open `unresolvedClarification`. It now
  requires the whole trimmed message to *end* in "?" (or match the existing explicit
  clarification-phrase patterns), so a complete direct answer is never mistaken for a new
  clarifying question. Definitional side-questions ("Que significa RFM?", "Que significa ticket
  promedio?") already went through this same `responded_directly` path and are preserved
  identically now that the heuristic is tighter, not looser.

### 10. Context hygiene (no aggressive truncation)

Audited `toolRuntimeMessages` (the tool_selection context projection) for accidental duplication,
matching the live ~23KB evidence:

- `unresolvedClarification` was sent as its own top-level key **and** again inside
  `semanticFocus.unresolvedClarification` - the same value, twice. Removed the top-level
  duplicate; the model still has the value through `semanticFocus`.
- `recentFindings: [activeFinding]` duplicated `semanticFocus.activeFinding` under a second name.
  Removed; `recentFindingsFromContext` is retained as a helper for the new
  `recentFindingCount` diagnostic.
- `recentTurns` was truncated a second time to the last 3 turns on top of the
  `contextRecentTurns`-bounded window `buildCopilotSessionContext` already computes.
  `summarizeConversation` (`session-service.ts`) previously summarized the last
  `summaryAfterTurns` turns as rendered text - once a session crossed that threshold, the last
  `contextRecentTurns` of those were sent **twice**: once as rendered "question -> answer" text in
  the checkpoint, once as structured `recentTurns`. `summarizeConversation` now excludes exactly
  the `contextRecentTurns` window from the checkpoint, and `toolRuntimeMessages` sends the full
  (already-bounded) `recentTurns` array instead of re-truncating it to 3 - net effect: no
  duplicate representation of the same turns, and no turns silently dropped from either
  representation.
- Preserved, unchanged: recent turns, semantic anchor, active finding, current question, the
  schema/query-contract capability contract, and analytical references. No aggressive truncation
  was introduced solely because one request timed out, and no T07 memory/retrieval architecture
  was pulled forward.

### 11. Context size observability

Added to `CopilotStageLatencyDiagnostic`, alongside the existing `contextProjectionChars`/
`toolSelectionPromptChars`/`toolSelectionPromptTokens`: `recentTurnCount`,
`analyticalReferenceCount`, `recentFindingCount`, `clarificationState`. No prompt contents.

### 12. Retry policy

Unchanged by design: no blind multi-retry loop was added for `tool_selection` timeouts, and
`tool_synthesis` continues to prefer the deterministic fallback over retrying the model - avoiding
doubled latency/cost and non-deterministic retry storms, per the task's explicit constraint.

### 13. Model

`deepseek-v4-flash` remains the default; no model routing was introduced.

### Tests added

- Stage timeouts (adapter level, `openai-compatible-copilot-model.test.ts`): tool_selection uses
  its own configured timeout instead of the legacy one; tool_synthesis likewise; the legacy
  timeout remains the fallback/default for orchestrator/planner/answerer/unified_planner and for
  an adapter config with no stage overrides; `createConfiguredCustomerIntelligenceCopilotModel`
  bounds-enforces both stage timeouts (over-max and non-positive fail closed) and reports the
  resolved values when configured.
- Invalid-response taxonomy (adapter level): malformed transport JSON, missing choices, missing
  message, missing vs. empty/whitespace content (distinct subtypes), a `finish_reason: 'length'`
  truncation with no usable content, malformed `tool_calls`, a valid plain-text synthesis response
  classified as no subtype, and a raw-payload-never-exposed check on both the error message and
  metadata.
- Session-level (`customer-intelligence-copilot-session.test.ts`, new "T05.8.8" describe block):
  `configuredTimeoutMs` surfaced on both tool_selection (success) and tool_synthesis (success)
  diagnostics; `configuredTimeoutMs` surfaced on a terminal tool_selection timeout with zero
  analytics executed; `invalidResponseSubtype` surfaced on a tool_synthesis failure diagnostic
  while the public response stays `degraded_success` and never echoes the subtype/internal
  message; cheap context-size diagnostics present on every tool_selection call; clarification
  marked `open` going into the resolving turn and `none` immediately after; a currency/unit
  question answered deterministically with zero model calls and zero analytics; the Cluster 3
  semantic anchor preserved through a currency side-question so a later "su RFM" comparison
  resolves to Cluster 3; a resolved clarification not contaminating a later reactivation-
  recommendation question; a mid-sentence rhetorical "?" in a direct answer not misclassified as a
  fresh clarification.
- Full pre-existing T05.8-T05.8.7 regression suite (distribution semantics, primary-finding
  selection, semantic anchor, top-rank fast path, synthesis fallback/degraded_success, population
  semantics, business-semantic rendering, reactivation recommendation boundary, T03 provenance,
  max-3-queries enforcement, session persistence) re-run unchanged.

Local validation:

- `npx vitest run --config vitest.config.ts tests/unit/customer-intelligence-copilot-session.test.ts tests/unit/openai-compatible-copilot-model.test.ts tests/unit/customer-intelligence-copilot-semantic-benchmark.test.ts tests/unit/customer-intelligence-copilot-business-semantics.test.ts tests/unit/customer-intelligence-copilot-contracts.test.ts tests/unit/customer-intelligence-copilot-benchmark.test.ts tests/unit/config.test.ts tests/unit/http-json-copilot-model.test.ts tests/unit/customer-intelligence-compact-query-adapter.test.ts tests/unit/customer-intelligence-query-planner-contract.test.ts tests/unit/customer-intelligence-query-validator.test.ts tests/integration/customer-intelligence-copilot-route.test.ts tests/integration/customer-intelligence-copilot-session-routes.test.ts`
- Result: PASS, 13 files, 257 tests.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- `npm run lint`: PASS.
- `npm test`: PASS, 179 files, 1560 tests.

Live validation: NOT_RUN - no configured provider credentials or analytics DB access in this
environment. The Section 18 four-question fresh-session flow (highest-ticket cluster -> currency
side-question -> RFM comparison -> reactivation recommendation, repeated 3x for the last question)
and the Section 19 log-gate fields (`configuredTimeoutMs`, `invalidResponseSubtype`,
`clarificationState`, `unresolvedClarificationPresent`, `synthesisFallbackUsed`,
`semanticAnchorEntityId`, `primaryFindingEntityId`) remain the required next step before closing
T05 per Section 20.

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

## T05.8.2 Compact Analytical Tool Plans and Deterministic Fast Paths

Motivation: T05.8.1 validated the native tool-calling architecture and semantics, but live evidence
still showed too much model work around query selection and one avoidable grouped-ranking synthesis.

Live T05.8.1 EC2 evidence with `deepseek-v4-flash`:

- `simple_fact`: PASS, total 2.847s, tool selection 2.695s, analytics 137ms, synthesis 0,
  semantic PASS.
- `simple_grouped_ranking`: PASS, total 9.298s, tool selection 4.220s, analytics 58ms,
  synthesis 5.015s, semantic PASS, cache hit ratio 0.875.
- `contextual_deep_followup`: PASS, total 34.269s, tool selection 21.279s, analytics 193ms,
  synthesis 12.790s, semantic PASS, cache hit ratio 0.763.

Renderer issue:

- A one-query aggregate grouped ranking such as `Cual cluster tiene mayor ticket promedio?` must
  complete as tool selection -> analytics -> deterministic renderer when the validated plan/result
  identify a winner.
- The renderer decision is now based on validated query and result structure, including aggregate
  mode, metric count, grouping, ordering, truncation, result columns, row count and tie detection.
  It no longer depends on matching phrases in the user question.

Compact contract architecture:

- Native `run_analytical_queries` now exposes compact query objects directly as
  `queries: [{ id, dimensions, metrics, filters, orderBy, limit }]`.
- Compact metrics use `{ op, field?, alias }`; compact filters use `{ field, op, value? }`.
- The model-facing field catalog is keyed by compact names such as `clusterId`,
  `averageOrderValue`, `totalSpent` and `validOrderCount`, with terse machine-readable type,
  nullability, operator and aggregation metadata.

Deterministic expansion:

- `CompactAnalyticalQuery` is expanded deterministically to full T03 `AnalyticalQueryPlan`.
- The adapter injects `customer-intelligence-query-plan-v1`, maps compact field names to T03
  logical fields, maps metric `op` to T03 `aggregation`, normalizes `orderBy`, expands compact
  filters into the T03 filter AST, applies limits, rejects unsupported properties and then calls
  the existing T03 validator. T03 remains authoritative; no SQL is generated from the model.
- Legacy full `AnalyticalQueryPlan` execution remains supported for rollback and non-tool paths.

Latency diagnostics:

- Stage diagnostics now include `compactToolContract`, `toolSchemaChars`,
  `toolSelectionPromptChars`, `toolSelectionPromptTokens` when provider usage exposes it,
  `toolArgumentChars`, `contextProjectionChars` and `resultSummaryChars`.
- Benchmark JSONL records now include the same compact-contract and size fields alongside
  `toolSelectionMs`, `analyticsMs`, `toolSynthesisMs`, `cacheHitRatio` and `semanticPass`.
- No latency improvement is claimed here without live measurement.

Local focused validation:

`npx vitest run tests/unit/customer-intelligence-compact-query-adapter.test.ts tests/unit/customer-intelligence-query-planner-contract.test.ts tests/unit/customer-intelligence-copilot-session.test.ts tests/unit/customer-intelligence-copilot-benchmark.test.ts`

Result: PASS, 4 files, 63 tests.

Live benchmark: NOT_RUN.

Live validation: NOT_RUN.

## T05.8.3 Bounded Synthesis and Semantic Anchor Integrity

Motivation: T05.8.2 made simple grouped rankings eligible for deterministic rendering, but that
claim still needs live measurement. This slice does not broaden optimization scope; it makes the
remaining synthesis path bounded, auditable and semantically anchored before running the next live
benchmark.

Semantic anchor contract:

- Each tool-runtime turn captures an immutable `semanticAnchor` from the pre-execution session
  context before new analytics can introduce a different top row.
- `semanticAnchor` is separate from `semanticFocus`; synthesis receives both, and the anchor is the
  authoritative referent for follow-up interpretation.
- Follow-up turns with an active finding are not allowed to be answered by the simple deterministic
  renderer, even if the new query result shape is otherwise renderable. This avoids replacing
  Cluster 3 / active finding with a later top-ranked row.

Deterministic renderer diagnostics:

- Stage diagnostics now include `deterministicRendererEligible` and
  `deterministicRendererReason`.
- Reasons are drawn from a fixed set: `eligible`, `multiple_queries`, `multiple_metrics`,
  `unsupported_dimension`, `missing_order`, `order_metric_mismatch`, `limit_not_supported`,
  `tie_detected`, `truncated_result`, `unexpected_result_shape` and
  `explanatory_question_requires_synthesis`.
- Renderer eligibility is based on validated query/result shape, not user phrase matching.
- Diagnostics remain metadata-only and do not include raw result rows.

Bounded synthesis v3:

- Tool synthesis now receives only the current question, immutable semantic anchor, compact
  semantic focus, deterministic `AnalyticalEvidenceBundle` and concise epistemic boundaries.
- The v3 payload excludes schema, query contract, raw plans, full history, raw rows, tool
  definitions and provider metadata.
- The evidence bundle is built deterministically from validated results and capped at 4000 chars.
- Synthesis completion is bounded by
  `CUSTOMER_INTELLIGENCE_COPILOT_SYNTHESIS_MAX_TOKENS` with default `500`.

Synthesis fallback:

- If analytics succeeds but `tool_synthesis` times out, loses network or returns an invalid model
  response, the service returns a deterministic degraded evidence answer instead of surfacing a
  provider failure.
- The degraded answer preserves query ids and snapshot provenance, marks
  `analysis.synthesisFallbackUsed = true`, and does not call legacy planner/answerer paths.

Benchmark harness:

- JSONL records now include `synthesisFallbackUsed`, `deterministicRendererEligible`,
  `deterministicRendererReason`, `semanticAnchorEntityType`, `semanticAnchorEntityId`,
  `evidenceBundleChars`, `evidenceFactCount`, `evidenceComparisonCount`,
  `synthesisPromptChars` and `synthesisCompletionTokens`.
- Tool-runtime semantic pass is stricter for the key scenarios:
  `simple_fact` requires tool selection + analytics + zero synthesis,
  `simple_grouped_ranking` requires deterministic renderer eligibility + zero synthesis, and
  `contextual_deep_followup` requires Cluster 3 semantic anchor preservation with at most one
  synthesis.
- Live benchmark remains `NOT_RUN`. The next required work is measurement, especially verifying
  that `simple_grouped_ranking` eliminates the previous ~5s synthesis and that deep follow-up keeps
  Cluster 3 semantics intact.

Local focused validation:

`npm test -- --run tests/unit/customer-intelligence-copilot-session.test.ts tests/unit/customer-intelligence-copilot-benchmark.test.ts tests/unit/config.test.ts tests/unit/openai-compatible-copilot-model.test.ts`

Result: PASS, 4 files, 91 tests.

Live benchmark: NOT_RUN.

Live validation: NOT_RUN.

## T05.8.4 Primary Finding Stability and Safe Top-K Rendering

Motivation: fresh T05.8.3 EC2 evidence with `deepseek-v4-flash` showed the remaining defect was
variability, not architecture. `simple_grouped_ranking` was PASS in 2/3 runs but one run hit
`deterministicRendererReason=truncated_result` and fell through to an unnecessary 4s synthesis
call (`semanticFailureReason=unexpected_tool_synthesis`). `contextual_deep_followup` had a
`semanticPassRate` of only 0.333, with one run losing the Cluster 3 anchor
(`semanticAnchorEntityId=0`) and one run running an extra query
(`queryCount=5` instead of ~4). This slice does not redesign the runtime; it fixes truncation
eligibility and primary-finding/semantic-anchor selection.

Live T05.8.3 EC2 baseline (`deepseek-v4-flash`):

- `simple_fact`: 3/3 PASS, p50 1.651s, semanticPassRate 1.0.
- `simple_grouped_ranking`: successRate 1.0, semanticPassRate 0.667; 2/3 runs rendered
  deterministically, 1/3 hit `truncated_result` and paid an unnecessary
  `toolSynthesisMs=4038` synthesis call.
- `contextual_deep_followup`: successRate 1.0, no timeout, p50 19.883s, semanticPassRate 0.333;
  one run reported `semanticAnchorEntityId=0` instead of `3`, one run reported `queryCount=5`
  instead of ~4, and the synthesis fallback prevented terminal failures.
- `exploratory`: 3/3 usable, semanticPassRate 1.0, no timeout, deterministic synthesis fallback
  working.

### Safe top-k truncation

The deterministic renderer previously rejected any query result flagged
`execution.truncated`, unconditionally. `execution.truncated` is set whenever the compiled SQL's
`LIMIT <plan.limit> + 1` probe fetched more rows than `plan.limit` (`execute-analytical-query.ts`)
- it does not distinguish "the runtime cut off rows the answer needed" from "the plan only asked
for the top row and there happen to be more rows behind it". For an ordered grouped ranking
(`GROUP BY` dimension, `ORDER BY` the target aggregate, explicit deterministic direction, single
grouped dimension, `LIMIT 1`, one row returned, no runtime error), that truncation is intentional
and safe: the caller asked for exactly the winner.

- `deterministicRendererEligibility` now distinguishes `intentional_top_k_truncation` from
  `unsafe_runtime_truncation` using the already-validated query/result structure (limit, orderBy,
  dimension count, `isSimpleTopMetricRankingPlan`) - never by matching user phrases.
- A new `deterministicRendererReason` value, `eligible_top_k_truncation`, is emitted when the
  renderer accepts a truncated top-1 ranking. The prior `truncated_result` rejection is
  unchanged for every other truncated shape (distributions, non-ranked groupings, multi-row
  windows), so truncation is not globally ignored.
- `renderDeterministicSimpleAnswer` no longer re-rejects on `execution.truncated` internally; all
  three call sites (native tool runtime, legacy planner, unified planner) already gate on
  `deterministicRendererEligibility` before calling it, so truncation safety has a single source
  of truth instead of being checked twice with different rules.

### PrimaryAnalyticalFinding contract

`CopilotSemanticFocus.activeFinding` is now typed as an exported `CopilotPrimaryFinding` contract
(`sourceQueryId`, `sourceTurnId`, `findingType`, `entityType`, `entityId`, `metric`, `value`) -
the canonical finding that actually answered the prior turn. `sourceTurnId` is new; every other
field already existed under T05.8.1's semantic-focus work.

Root cause fixed: `deriveSemanticFocus` selected `activeFinding`/`activeEntity`/`activeMetric`
from `session.analyticalState.results[results.length - 1]` - literally whichever result an
LLM-emitted multi-query tool call happened to append last, not the query that structurally
answered the question. A simple ranking turn that also emitted an auxiliary
count/distribution/context query could have that auxiliary query silently become the primary
finding for every subsequent follow-up.

Fix: `selectPrimaryQueryResult` (`session-context.ts`) first narrows to the latest turn's own
result group (results are always appended per-turn in a contiguous block), then - only when that
turn produced more than one result - prefers structurally: an ordered top-ranking query
(`isTopRankPlan`), then a single-value aggregate query (`isSingleValuePlan`), before falling back
to declaration order. It never phrase-matches the user's question. `deriveSemanticFocus` now
routes `activeEntity`, `activeMetric`, `activeComparison`, `activeFinding` and
`lastAnalyticalResult` through this one selection instead of each depending on raw array
position.

### Semantic anchor from primary finding

`semanticAnchorFromSessionContext` already prioritized `semanticFocus.activeFinding` over
`activeEntity`/`activeMetric` (T05.8.3); fixing `activeFinding`'s derivation above fixes the
anchor transitively; no change was needed to the anchor's own priority order. For
"Cual cluster tiene mayor ticket promedio?" followed by "Por que?", the anchor now resolves to
cluster 3 / `averageOrderValue` / `top_rank` even when the first turn executed more than one
analytical query, as long as one of those queries is the ordered ranking.

### Multi-query first-turn stability and redundant query suppression

Section 4/5 of the task are covered by the same structural selection: no additional query
suppression was added. Aggressive pre-execution pruning of "provably redundant" queries was
considered and rejected as out of scope - it would require judging tool-call intent before
execution, which is exactly the kind of runtime redesign this slice avoids. All emitted queries
still execute; only the *interpretation* of which result is primary changed.

### Synthesis fallback benchmark accounting

Audited: each turn calls `tool_synthesis` at most once (`processToolRuntimeTurn` has no retry
loop around the synthesis call), and the deterministic fallback (`fallbackToolSynthesisResponse`)
never issues a second model call - it only runs after the single synthesis attempt already
succeeded-with-invalid-output or failed. The live `tool_synthesis_count_above_1` observation on
`contextual_deep_followup` came from its *first* turn ("Cual cluster tiene mayor ticket
promedio?") being structurally identical to `simple_grouped_ranking` and hitting the same
`truncated_result` bug, which forced an extra synthesis call before the second turn's own
(legitimate) synthesis call. Fixing safe top-k truncation removes this; no separate accounting
change was needed. Test G below pins the invariant (fallback adds zero extra
`tool_synthesis` diagnostics) directly.

### Diagnostics and benchmark harness

- New `CopilotStageLatencyDiagnostic` fields: `primaryFindingEntityType`,
  `primaryFindingEntityId`, `primaryFindingMetric`, `primaryFindingType`,
  `primaryFindingSourceQueryId`, emitted on the `turn` stage for deterministic fast-path answers.
- `CopilotBenchmarkRecord` gained matching flat `primaryFindingEntityType`,
  `primaryFindingEntityId`, `primaryFindingMetric`, `primaryFindingType` fields for live
  inspection. This is observability only; it does not change any `semanticPass` gate.
- Diagnostics remain metadata-only: no raw result rows, PII, prompts, SQL or provider payloads.

### Tests added

- Ordered grouped `LIMIT 1` + `execution.truncated=true` remains renderer-eligible
  (`deterministicRendererReason: 'eligible_top_k_truncation'`), one model call, correct
  `queryPlanHashes`/`provenance` (T03 provenance unchanged).
- A truncated grouped count distribution with no top-1 ranking still rejects the renderer
  (`truncated_result`) and routes to bounded synthesis.
- A multi-query first turn (ranking query declared first, auxiliary audience-level count query
  declared second) still anchors the next turn's `semanticFocus.activeFinding` /
  `activeSemanticEntityType`/`Id` on the ranking query's Cluster 3, not the auxiliary query.
- The existing tool-synthesis-provider-failure fallback test now also asserts exactly one
  `tool_synthesis` stage diagnostic is emitted (fallback adds none).
- Full T05.8.1-T05.8.3 regression suite (session, benchmark, semantic benchmark, contracts,
  config, OpenAI-compatible/http-json model adapters, compact query adapter, query planner
  contract/validator) re-run unchanged.

Local focused validation:

`npx vitest run tests/unit/customer-intelligence-copilot-session.test.ts tests/unit/customer-intelligence-copilot-benchmark.test.ts tests/unit/customer-intelligence-copilot-semantic-benchmark.test.ts tests/unit/customer-intelligence-copilot-contracts.test.ts tests/unit/config.test.ts tests/unit/openai-compatible-copilot-model.test.ts tests/unit/http-json-copilot-model.test.ts tests/unit/customer-intelligence-compact-query-adapter.test.ts tests/unit/customer-intelligence-query-planner-contract.test.ts tests/unit/customer-intelligence-query-validator.test.ts`

Result: PASS, 10 files, 196 tests.

Full suite (`npx vitest run`): PASS, 178 files, 1515 tests. `tsc --noEmit` and `npm run lint`
clean.

Live benchmark (5 runs, per task acceptance criteria): NOT_RUN - no configured provider
credentials or analytics DB access in this environment. The benchmark harness and diagnostics are
ready to record `primaryFinding.entityId`, `deterministicRendererReason`, and
`semanticAnchorEntityId` for that run.

Live validation: NOT_RUN.

## T05.8.5 Distribution Semantics and Fallback Preservation

Motivation: live EC2 evidence for `Cuantos hay en cada cluster?` showed the tool runtime correctly
selected and executed a `cluster_distribution` query plus an auxiliary `unclustered_count` query
(`queryCount = 2`), then `tool_synthesis` failed
(`tool_synthesis_provider_invalid_response`) and the deterministic fallback correctly activated
(`answered_degraded_synthesis`, `synthesisFallbackUsed = true`). But the semantic state the turn
left behind was wrong: `activeSemanticEntityType = "cluster"`, `activeSemanticEntityId = 0`,
`activeFindingType = "top_rank"`, `activeFindingSourceQueryId = "cluster_distribution"` - a full
cluster breakdown was recorded as if Cluster 0 had been specifically asked for and identified. That
false anchor would have contaminated every subsequent turn. The evidence bundle was also
overcollapsed: `evidenceFactCount = 2` for a turn with 4+ clusters plus an unclustered count,
because only the first row of the grouped query became a fact.

Root cause:

- `execute-analytical-query.ts` always slices `rows` to `plan.limit` (or leaves every matched row
  when no limit is set/exceeded), so more than one returned row can only ever mean the query was
  never actually reduced to a single winner - a `LIMIT 1` query can never return 2+ rows. Despite
  this, `isTopRankPlan` (session-context.ts) only checked that `orderBy` matched the metric and
  direction, never row count or `limit`. A grouped count query the model happened to order
  descending for presentation - with no `LIMIT` - satisfied that check and was misclassified as a
  resolved single entity, with `entityId` taken from row 0.
- `entityFromRow` (the separate `activeEntity` derivation) had no concept of distribution vs.
  ranking at all: it read `row.clusterId` off the first row of any multi-row result unconditionally.
  Two independent, divergent classifiers (`findingFromResult` for `activeFinding`, `entityFromRow`
  for `activeEntity`) could disagree, and both defaulted to "row 0 wins."
- `buildAnalyticalEvidenceBundle` picked exactly one row per metric (the semantic-anchor match, or
  row 0 when there was no anchor) regardless of how many rows the query actually returned,
  silently discarding every other group.
- `renderDeterministicEvidenceFallback` additionally capped the already-undercollected facts at 5.

## 1-2. Distribution finding type and top-rank distinction

- `CopilotPrimaryFinding.findingType` (and `CopilotSemanticAnchor.findingType`) gained a third
  value, `distribution`, alongside the existing `top_rank` and `single_value`.
- `findingFromResult` (session-context.ts) now classifies purely from the validated
  plan/result shape: a grouped-by-entity query (`cluster.clusterId` or `rfm.segmentCode`) that
  returned more than one row is always `distribution`, with `entityId: null` - never phrase-matched,
  never inferred from row order or which row happens to hold the largest value. Exactly one row
  means the query reduced to one specific entity (via an explicit `LIMIT`, a narrowing filter, or a
  single group in the data), so it is `top_rank` when ordered by the metric, `single_value`
  otherwise. This is structurally impossible to get backwards for a genuine top-1 ranking, since
  `execute-analytical-query.ts` can never return more than `plan.limit` rows.
- `deriveSemanticFocus` now computes the finding once and derives `activeEntity` from it (null for
  `distribution`), eliminating the second, divergent `entityFromRow`-only path that used to ignore
  distribution/ranking status entirely.
- `selectPrimaryQueryResult`'s priority list is reordered to `top_rank > distribution >
  single_value > declaration order`, reusing `findingFromResult` itself for the classification
  instead of separate ad hoc checks, so the priority list and the persisted finding can never
  disagree again. `distribution` outranks `single_value` deliberately: for the live bug's own turn
  (`cluster_distribution` + `unclustered_count`), the grouped breakdown is the answer the user
  asked for and the auxiliary count is supplementary, so the richer, more complete result must win
  as primary - this is a considered, testable resolution of an apparent tension in the task's
  abstract priority ordering versus its own concrete worked example, and is pinned by a test.

## 3-4. Semantic focus and semantic anchor rules

- For a `distribution` finding, `activeEntityType`/`activeEntityId` are `null` and
  `activeMetric`/`activeFindingType` remain populated - the conversation stays neutral across
  every group until a follow-up resolves one.
- `semanticAnchorFromSessionContext` needed no change: it already prioritized
  `semanticFocus.activeFinding`, so fixing the finding's derivation fixes the anchor transitively.
- `deterministicRendererEligibility`'s anchor guard (T05.8.3: block the fast deterministic path
  when a prior finding is active, to protect it from being silently replaced) is narrowed to only
  block when the anchor names a specific entity (`findingType` is `top_rank`/`single_value` **and**
  `entityId !== null`). A `distribution` anchor names no entity, so a fresh follow-up ranking - e.g.
  `Cual tiene mas?` right after `Cuantos hay en cada cluster?` - remains eligible for the fast path
  and does not pay an unnecessary synthesis call, matching Section 9's requirement not to regress
  the top-rank fast path.

## 5. Evidence bundle preserves distributions

`buildAnalyticalEvidenceBundle`: when a grouped metric has more than one ranked row and no semantic
anchor matches it, every row is now pushed as its own fact (bounded by the existing 12-fact/
4000-char caps) instead of collapsing to row 0. The anchored-explanation path (an entity-specific
anchor found among the rows) is unchanged - it still summarizes to the anchor's fact plus a
peer-range comparison, which is the correct compact form for "why is Cluster 3 higher" follow-ups.
A tied ranking (T05.8.3's existing tie test) now correctly preserves both tied rows as facts
instead of only the first (`evidenceFactCount` 1 -> 2 for that scenario).

## 6. Deterministic fallback preserves distributions

`renderDeterministicEvidenceFallback` no longer truncates at 5 facts; it renders every fact the
(already bounded) evidence bundle retained. Combined with the Section 5 fix, a synthesis failure
after a distribution query now renders every cluster the query returned plus any separately
retained auxiliary count (e.g. unclustered), instead of silently dropping most of the breakdown.

## 7. Primary finding selection audit

`primaryFindingFromDeterministicExecution` (session-service.ts, T05.8.4) was a second,
independent classifier duplicating what `session-context.ts` now does correctly - exactly the kind
of divergent-classifier bug this slice fixes elsewhere. It is replaced by
`primaryFindingDiagnostic(session)`, which reads the finding back from the just-persisted session
via the same `deriveSemanticFocus`/`selectPrimaryQueryResult` used to build the next turn's
context, for every response branch (deterministic fast path, synthesis success, both fallback
paths) - not only the single-execution fast path as in T05.8.4. `distributionRowCount` is included
when the finding is a distribution.

## 8. Follow-up behavior

Validated end-to-end in tests: `Cuantos hay en cada cluster?` (distribution, no active entity) ->
`Cual tiene mas?` (resolves Cluster 0 via an explicit top-1 count ranking) -> `Y cual tiene mayor
ticket promedio?` (a fresh top-1 AOV ranking resolves Cluster 3) -> `Por que?` (the semantic anchor
carried into the turn is Cluster 3, not Cluster 0).

## 9. Top-rank fast path preserved

T05.8.4's `simple_grouped_ranking` behavior (deterministic renderer eligible, intentional top-K
truncation safe, zero synthesis for one sufficient ranking query) is unchanged and re-verified by
the full T05.8.3/T05.8.4 regression suite. Distributions and rankings remain distinct
`PrimaryFinding` shapes; nothing about ranking classification was broadened to also match
distributions or vice versa.

## 10. Diagnostics

`CopilotStageLatencyDiagnostic` already had `primaryFindingEntityType`, `primaryFindingEntityId`,
`primaryFindingMetric`, `primaryFindingType` (T05.8.4); it gains `distributionRowCount` for
`distribution` findings. All are metadata-only: no raw result rows, no SQL, no PII.

## Test evidence

Tests added: a cluster count breakdown classifies as `distribution` with `entityId: null` and the
unclustered auxiliary query remains a separate fact (Section 11 A/B/C/G); the evidence bundle
preserves every cluster row for that turn (E); the deterministic fallback renders every cluster
plus the unclustered count when synthesis fails (F); a 4-turn conversation resolves `Cual tiene
mas?` to Cluster 0, a fresh AOV ranking to Cluster 3, and preserves the Cluster 3 anchor through
`Por que?` (H/I/J); the existing T05.8.3 tie-detection test's evidence-fact-count assertion is
corrected from 1 to 2 to reflect the Section 5 fix; a semantic-benchmark regression test's
assertion is corrected from an unlimited 2-row ranking implying `activeEntity: {id: 3}` to the
now-correct `activeEntity: null` plus `activeComparison` still carrying both cluster ids (that test
scenario's plan never had `LIMIT 1`, so under the corrected model it is a comparison/distribution,
not a resolved winner). Ordered `LIMIT 1` rankings still classify `top_rank` and the simple
top-rank fast path is unchanged, both re-verified by the existing T05.8.3/T05.8.4 tests without
modification (D/K). T03 provenance (`queryPlanHashes`, snapshot ids) is unchanged and asserted in
the new tests (L).

Local focused validation:

`npx vitest run tests/unit/customer-intelligence-copilot-session.test.ts tests/unit/customer-intelligence-copilot-semantic-benchmark.test.ts tests/unit/customer-intelligence-copilot-benchmark.test.ts tests/unit/customer-intelligence-copilot-contracts.test.ts`

Result: PASS, 4 files, 81 tests.

Full suite (`npm test` / `npx vitest run`): PASS, 178 files, 1518 tests. `npm run typecheck`,
`npm run build`, and `npm run lint` all clean.

Live acceptance gate (Section 12, the four-message conversation plus log inspection): NOT_RUN - no
configured provider credentials or analytics DB access in this environment.

Live validation: NOT_RUN.

## Export/XLSX

Explicitly out of scope for T05.8.5 and not modified. The current generic XLSX export
(`xlsx-export.ts`, `POST /v1/customer-intelligence/copilot/sessions/:sessionId/export`) remains
deferred for product redesign. Audience/segment-shaped export will be defined separately under
MARKETING-R2-A01 Audience Engine.

## T05.8.6 Analytical Reasoning Capacity + Human Presentation

Motivation: T05.8.5 fixed distribution semantics, but live evidence showed the runtime was still
hitting artificial ceilings, not genuine reasoning limits, and the answers it did produce leaked
implementation detail:

- `tool_synthesis` repeatedly reached exactly the old 500-token ceiling.
- `AnalyticalEvidenceBundle` repeatedly reached exactly the old 12-fact cap while still far below
  the old 4000-char cap - the fact cap, not the char budget, was the binding constraint.
- `evidenceComparisonCount` was often 0 even for genuinely comparative questions, because a
  comparison was only ever generated when a stored semantic anchor happened to match a row in the
  new result - a same-turn "compare cluster 3 vs cluster 1" with no prior anchor produced zero
  comparisons.
- User-visible degraded (fallback) answers exposed internal aliases and jargon directly:
  `avg_r`, `avg_f`, `avg_m`, `customer_count`, `rank N`, raw `cluster coverage NN%`, query ids.
- `finish_reason` was parsed by the OpenAI-compatible adapter but discarded, so a synthesis call
  truncated by `finishReason=length` was indistinguishable from a normal `stop` completion in any
  diagnostic.

This slice is a capacity/presentation slice only. T03's deterministic SELECT-only compiler/runtime,
the compact tool contract, the 3-query cap, T05.8.5 distribution semantics, PrimaryFinding/
semanticAnchor selection, the deterministic fast paths, session persistence, and provenance/
queryPlanHash are all unchanged and re-verified by the full pre-existing regression suite.

### 1-2. Synthesis capacity and evidence budget

- `CUSTOMER_INTELLIGENCE_COPILOT_SYNTHESIS_MAX_TOKENS` default raised from `500` to `1500`
  (`src/config.ts`); the existing `.max(2000)` ceiling and env override are unchanged.
- Evidence bundle bounds raised: max facts `12` -> `32`
  (`ANALYTICAL_EVIDENCE_MAX_FACTS`), max serialized chars `4000` -> `8000`
  (`ANALYTICAL_EVIDENCE_BUNDLE_MAX_CHARS`). A new `ANALYTICAL_EVIDENCE_MAX_DISTRIBUTION_ROWS = 32`
  also raises the per-query row cap `rankedRowsForMetric` reads before ranking/grouping, so a
  distribution with more than 12 groups is no longer silently cut at the source.
  `compactEvidenceBundle`'s trim loop now degrades distributions gracefully (trims the largest
  distribution's rows one at a time) before dropping a whole distribution or a fact, so a
  char-budget overrun never drops an entire query's evidence first.
- Nothing here changes what data is fetched from MariaDB: these are all post-execution, in-memory
  bounds on what is serialized into the synthesis prompt.

### 3. Finish reason observability

- `CopilotModelMetadata` (application ports) gained `finishReason?: string | null`.
- `openai-compatible-copilot-model.ts`'s `extractMessage` now also returns the response's
  `choices[0].finish_reason` (`stop`, `length`, `tool_calls`, or `null` when the provider omits
  it), threaded into every stage's metadata - not logged as a raw payload, just the reason string.
- New stage-latency diagnostics: `providerFinishReason` (`tool_selection`) and
  `synthesisFinishReason` (`tool_synthesis`), plus `synthesisMaxTokens`, `evidenceMaxFacts`,
  `evidenceMaxChars`, and `evidenceDistributionCount` alongside the existing `evidenceFactCount`/
  `evidenceComparisonCount`. The benchmark harness records `synthesisFinishReason` per run.
- Tests cover both `stop` and `length` at the provider-adapter level (raw JSON parsing) and at the
  session level (surfaced as the new diagnostic fields), plus the no-`finish_reason` case
  defaulting to `null`.

### 4-7. Structured analytical evidence

`AnalyticalEvidenceBundle` (`domain/customer-intelligence-copilot/contracts.ts`) evolved from
`{ anchor, facts, comparisons, limitations }` into `{ anchor, facts, comparisons, distributions,
limitations }` - a smaller, compatible refactor rather than the fully separate `keyFindings`/
`supportingFacts` split the task sketched, since `facts` already distinguishes a `rank`/
`comparison` "winner" entry from an "observed" one and `evidenceFactCount` is an existing,
depended-on diagnostic name. Every value is still read back from a validated
`AnalyticalQueryResult`; nothing in the bundle is model-generated.

`buildAnalyticalEvidenceBundle` (session-service.ts) now branches per metric on row count and
semantic anchor match:

- **Anchor found** (an active entity from a prior turn matches a row): one fact for that entity
  (`rank`, `highest`/`lowest`/`observed`) plus one `anchor_vs_peer_range` comparison against the
  peer whose value is farthest from the anchor's - `left` is the anchor, `right` is that peer,
  with `peerMin`/`peerMax` still carrying the full observed range.
- **No anchor, one row**: a single fact, tagged `highest`/`lowest` when the query was itself
  ordered by that metric (unchanged from T05.8.5).
- **No anchor, exactly two rows**: a `pairwise` comparison (e.g. "compare cluster 3 vs cluster
  1") - this is the case that previously produced zero comparisons. The two rows are also kept as
  facts.
- **No anchor, three or more rows**: a bounded `distributions` entry (all rows, task
  MARKETING-R1-T05.8.5 Section 7 unchanged) plus, only when the query is itself ordered by that
  metric, a single `top_vs_bottom` comparison (first ranked row vs. last) - never a full pairwise
  matrix (never O(n^2)); at most one comparison per metric either way.

`absoluteDifference` and `relativeDifference` (`(left - right) / right`) are computed from
`Number()`-parsed values and rounded for display (`toFixed`); no big-decimal dependency was added
- values already come from validated `DECIMAL` columns at business magnitudes, where double
  precision is more than sufficient. `relativeDifference` is a relative-increase fraction (e.g.
  `1.9205` for a ~192% increase); the "X veces mayor" ratio phrasing used in prose is a separate,
  presentation-only `left/right` division, not stored in the bundle.

An `IS NULL` filter on the entity dimension (e.g. an unclustered-customer count) is now detected
(`nullEntityDimensionFromFilters`) and labeled `entityType: 'cluster', entityId: null` instead of
the generic `'audience'`, so it renders as "Clientes sin cluster asignado" rather than a
disconnected "Clientes observado" line.

### 8-9. Business semantic registry and human number formatting

New module `src/domain/customer-intelligence-copilot/business-semantics.ts` - the one source of
truth the task asked for. It replaces two separate, already-divergent `semanticMetricName`
functions (session-context.ts and session-service.ts each had their own partial field-to-name
mapping) with one exported `resolveSemanticMetricName`, and adds:

- `resolveBusinessMetric`/`resolveBusinessMetricByName`: field/aggregation -> `{ name, label,
  format }`. Covers every field currently reachable through the schema, including the RFM score
  averages that were leaking as `avg_r`/`avg_f`/`avg_m` (`rfm.rScore` -> "Recencia promedio",
  `rfm.fScore` -> "Frecuencia promedio", `rfm.mScore` -> "Valor monetario promedio") and a bare
  `COUNT(*)` (no field, in this schema always a customer count) -> "Clientes". An `avg` aggregation
  over an otherwise count-shaped field resolves to `decimal` format instead of `count` (e.g. "2.5
  compras promedio", not "2 compras promedio"). An unrecognized field never echoes the raw alias -
  it humanizes it (camelCase/snake_case split into words) as a last resort.
- `businessEntityLabel`: `Cluster 3`, `Segmento RFM AT_RISK_HIGH_VALUE`, `Clientes sin cluster
  asignado` / `Clientes sin segmento RFM`, or `la poblacion analizada` for audience-level values.
- `formatBusinessValue`: `currency_clp` (`$381.304`, no decimals), `count` (`3.973`, Spanish
  thousands separator), `percentage` (`22,6%`, one decimal), `decimal` (two decimals), `ratio`
  (`2,9 veces`, one decimal) - all `es-CL` locale, via `Intl.NumberFormat`. Internal
  numeric/provenance representations (result rows, `queryPlanHash`, etc.) are untouched; only
  user-facing text is formatted.
- `formatBusinessRank`: `"1.er lugar de 4"` for rank 1 (apocopated `primer` -> `1.er`), `"2.o lugar
  de 4"` for others - plain-ASCII approximation of the Spanish ordinal indicator (`o`, not the
  superscript `º`), consistent with this codebase's existing no-accent Spanish text convention.
  Exported and unit-tested; not currently wired into a specific sentence (no renderer needed a
  "rank of N" phrase beyond what `comparison: highest/lowest` already conveys).
- `formatRatio`: the "X veces" phrase used in comparison sentences.

### 10. Humanized deterministic fallback

`renderDeterministicEvidenceFallback` (session-service.ts) rewritten against the structured
bundle: distributions render as a labeled bulleted breakdown ("Distribucion de clientes por
cluster:\n- Cluster 0: 3.973 clientes...."), comparisons render as a direct sentence with the
ratio phrase ("Cluster 0 tiene 3.973 clientes, frente a 2.569 del Cluster 3; es aproximadamente
1,55 veces mayor."), and facts render as either a count sentence ("Cluster 3 es el grupo con mas
clientes: 4.") or a business-label sentence ("Cluster 3 presenta el mayor ticket promedio
observado: $150.000."). None of `customer_count`, `avg_r`/`avg_f`/`avg_m`, `rank N`, a raw query
id, or a raw coverage percentage can appear - every value goes through the business-semantics
registry first. The old `.slice(0, 5)` fact truncation (already removed in T05.8.5) stays removed;
the bundle's own bounds are the only limit.

The fast deterministic renderer (`renderDeterministicSimpleAnswer`, the zero-synthesis path for
`simple_fact`/`simple_grouped_ranking`) was migrated to the same registry - it previously only knew
two metric labels (`ticket promedio`, `gasto total`) via a separate `metricDisplayName` function and
formatted every other metric with a bare `Intl.NumberFormat` (no currency symbol, wrong precision
for CLP). It now produces `"Cluster 3 presenta el mayor ticket promedio: $381.304."` instead of a
raw `381304.040000`. `entityLabel`, `metricDisplayName`, `semanticMetricName`, and `formatNumber`
(session-service.ts local functions) were deleted in favor of the shared registry.

### 11. Material limitations

`buildAnalyticalEvidenceBundle` only pushes a limitation sentence when the bundle actually contains
evidence of that entity type (tracked via `entityTypesPresent`) and coverage for it is below 100%:
"Este analisis corresponde a los clientes que tienen un cluster asignado." /
"...con informacion RFM disponible." - never both unconditionally, and never the raw
`cluster coverage NN%; RFM coverage NN%` string. Exact coverage percentages remain available on
`provenance.population` for anything that needs the number, just not injected into user-facing text.

### 12. Synthesis prompt v4

`CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SYNTHESIS_PROMPT_VERSION` bumped
`customer-intelligence-tool-synthesis-v3` -> `-v4`. `CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SYNTHESIS_INSTRUCTIONS`
rewritten per the task's suggested semantics (lead with the conclusion, quantify differences,
compare segments directly using the supplied comparisons/distributions, distinguish fact from
interpretation/hypothesis/recommendation, no causality from correlation, no profitability without
margin/cost/profit fields, no prediction without a predictive model, mention coverage only when
material, state insufficient evidence explicitly, and - the new, explicit line - never expose
internal aliases/field names/query ids/plan ids/contract or version names/database terms; always
translate into business terminology with natural formatting). Still excludes schema, query
contract, raw plans, and full conversation history, per the existing v3 design; only the
instruction text changed.

### 13. Tool selection

Not redesigned. Native tool calling, the compact query contract, the 3-query cap, and T03
validation are unchanged. `toolQueries` diagnostics gained `hasEntityFilter` (boolean) and `limit`
(the query's own `LIMIT`, or `null`) alongside the existing `id`/`dimensions`/`metrics`/
`filterFieldNames`/`orderByFields`. Filter *values* are still never logged, only field names and
this boolean/limit metadata.

### 14. Model unchanged

`deepseek-v4-flash` remains the default; the benchmark harness's default model list
(`deepseek-v4-flash,deepseek-v4-pro`) is untouched. No production model switch was made.

### Test evidence

New/updated tests cover: default synthesis max tokens = 1500 and env override (config.test.ts);
evidence distributions carrying more than 12 rows, bounded at 32, and the whole bundle bounded at
8000 chars; `finish_reason` `stop`/`length`/absent at both the provider-adapter level and the
session-diagnostic level; deterministic pairwise comparison generation with verified
absolute/relative-difference arithmetic; CLP/percentage/count/ratio/rank formatting and RFM-score
label humanization (dedicated `customer-intelligence-copilot-business-semantics.test.ts`); material
limitations rendered as plain sentences with no raw coverage percentage; the v4 synthesis prompt
text asserted to prohibit internal aliases/query ids; and the full pre-existing T05.8.1-T05.8.5
regression suite (distribution semantics, top-rank fast path, semantic anchor, synthesis fallback,
T03 provenance, max-3-queries enforcement) re-run and passing unchanged except for output-text
assertions updated to match the new humanized wording (e.g. `$381.304` instead of `381304.040000`,
`3.973` instead of `3973`) and one evidence-bundle assertion corrected from 2 loose facts to 1
pairwise comparison for a tied ranking, which is the intended Section 6 behavior.

Local focused validation:

`npx vitest run tests/unit/customer-intelligence-copilot-session.test.ts tests/unit/customer-intelligence-copilot-business-semantics.test.ts tests/unit/customer-intelligence-copilot-semantic-benchmark.test.ts tests/unit/customer-intelligence-copilot-benchmark.test.ts tests/unit/customer-intelligence-copilot-contracts.test.ts tests/unit/config.test.ts tests/unit/openai-compatible-copilot-model.test.ts tests/unit/http-json-copilot-model.test.ts`

Result: PASS.

Full suite (`npm test` / `npx vitest run`): PASS, 179 files, 1533 tests. `npm run typecheck`,
`npm run build`, and `npm run lint` all clean.

Live validation (Section 17's six-question conversation plus diagnostic inspection) and the Flash
benchmark (Section 18): NOT_RUN - no configured provider credentials or analytics DB access in
this environment.

## Export/XLSX (T05.8.6)

Still explicitly out of scope; not modified. Same deferral as T05.8.5 - audience/segment-shaped
export is defined separately under MARKETING-R2-A01 Audience Engine.

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
