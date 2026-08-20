# MARKETING-R1-T01 - Customer Intelligence Copilot LLM Layer

Status: **READY_WITH_CONSTRAINTS**. Local implementation and deterministic unit tests are
complete. Live LLM and live DB smoke are not run on this machine because no Copilot provider and
no `ANALYTICS_DB_*` connection are configured.

Git branch: `feat/marketing-r1-t01-customer-intelligence-copilot`

## 1. Purpose

Adds the first provider-agnostic conversational layer over CP-R3-T03. A user asks a natural
language analytical question; the planner model produces a structured `CopilotAnalysisPlan`
containing one to three `AnalyticalQueryPlan` objects; T03 validates and executes each plan
deterministically; the answerer model receives only the exact analytical results and provenance.

No SQL is accepted from the LLM. No direct DB or PrestaShop access exists in Copilot
domain/application code. No UI, HTTP endpoint, saved segments, exports, Brevo, or conversation
persistence is implemented.

## 2. Architecture

```
question
  -> getAnalyticalSchema() from CP-R3-T03
  -> compact schema serialization
  -> CustomerIntelligenceCopilotModel.generateAnalysisPlan()
  -> CopilotAnalysisPlan validation
  -> T03 validateAnalyticalQueryPlan() for every query
  -> one bounded repair attempt if invalid
  -> resolve CustomerIntelligenceSnapshotContext once
  -> T03 executeAnalyticalQueryWithResolvedContext() for every query
  -> CustomerIntelligenceCopilotModel.generateAnswer()
  -> CustomerIntelligenceCopilotResponse
```

The pinned-context T03 executor is additive: it reuses T03 validation, compiler, result mapping,
query hashes, provenance, timeout-aware executor port, and SELECT-only infrastructure.

## 3. Provider Abstraction

Application port: `CustomerIntelligenceCopilotModel`.

Capabilities:

- `generateAnalysisPlan(input)`
- `repairAnalysisPlan(input)`
- `generateAnswer(input)`

The application layer does not import OpenAI, Gemini, DeepSeek, mysql, or PrestaShop. The shipped
infrastructure adapter is `http_json`, configured by:

- `CUSTOMER_INTELLIGENCE_COPILOT_PROVIDER=http_json`
- `CUSTOMER_INTELLIGENCE_COPILOT_ENDPOINT`
- `CUSTOMER_INTELLIGENCE_COPILOT_MODEL`
- `CUSTOMER_INTELLIGENCE_COPILOT_API_KEY`
- `CUSTOMER_INTELLIGENCE_COPILOT_TIMEOUT_MS`

If not configured, CLI usage fails closed.

## 4. Prompt Versions

Planner prompt version: `customer-intelligence-copilot-planner-v1`

Planner rules: use only provided logical fields, output structured plans only, never SQL, never
invent fields or unavailable operations, minimize queries, maximum three queries, prefer
aggregate plans unless row-level customer ids are explicitly requested.

Answer prompt version: `customer-intelligence-copilot-answer-v1`

Answer rules: use only supplied results and provenance, no invented numbers or causality, respect
RFM/cluster coverage, mention truncation when present, treat cluster labels as analytical
interpretations and cluster ids as model-scoped.

## 5. Analysis Plan Contract

Version: `customer-intelligence-copilot-analysis-plan-v1`.

Supported planner statuses:

- `query_plan`
- `unsupported_data`
- `unsupported_operation`
- `clarification_required`

`query_plan` contains `queries[]`, each `{ id, plan }`, where `plan` is a CP-R3-T03
`AnalyticalQueryPlan`. Max queries per turn: 3. All planned queries are required in V1.

## 6. Validation And Repair

The Copilot validates two layers:

- Copilot envelope: no `sql` key anywhere, versioned, safe query ids, 1-3 queries.
- T03 query plans: authoritative validation through `validateAnalyticalQueryPlan()`.

If validation fails, the planner receives the previous plan, validation errors, and the same
compact schema for one repair attempt. If repair fails, status is `planner_invalid`. No partial
execution happens.

## 7. Context Pinning

For executable plans, Customer Intelligence context is resolved once per turn, then reused for
all query executions via `createExecuteAnalyticalQueryWithResolvedContext()`. This prevents query
1 and query 2 from observing different feature/RFM/cluster snapshots if a snapshot publishes
mid-turn.

## 8. Fail-Closed Behavior

Unsupported cart/email/PII requests return `unsupported_data` when the planner classifies them
against the schema. Median/percentile requests return `unsupported_operation` because T03 median
is deferred. Ambiguous questions such as "best cluster" return `clarification_required`.

Analytics unavailable/schema errors return `analytics_unavailable`; timeout errors return
`analytics_timeout`. Answer generation is skipped after any analytics failure.

## 9. CLI

- `npm run intelligence:copilot:schema` prints the compact public schema sent to the planner.
- `npm run intelligence:copilot -- --question="Cuantos clientes hay en cada cluster?"`
- `--debug` prints the full structured response.
- `--feature-snapshot-id=17` pins an explicit feature snapshot programmatically.

No HTTP endpoint is implemented.

## 10. Tests

New tests cover:

- simple count
- cluster distribution
- RFM x cluster filtered grouping
- unsupported cart data
- unsupported median operation
- ambiguous question
- invalid field hallucination with repair
- SQL-shaped planner output rejection
- double invalid planner failure
- analytics unavailable and timeout
- answer grounding, truncation, and coverage payload
- multi-query context pinning
- max-query rejection
- email/data-exfiltration classification
- no PrestaShop or direct DB imports from Copilot domain/application

## 11. Limitations And Deferred

- Live LLM smoke not run: no provider configured.
- Live DB smoke not run: no local `ANALYTICS_DB_*` configured.
- Natural-language historical date-to-snapshot resolution is deferred.
- Dependent multi-query DAGs are deferred.
- Median/percentiles remain deferred to a runtime task.
- UI, multi-turn state, saved segments, exports, cart features, Brevo, and dedicated SELECT-only
  analytics credentials are deferred.

## 12. Definition Of Done

- [x] Provider port exists
- [x] Planner and answerer capabilities exist
- [x] Schema comes from T03 registry through `getAnalyticalSchema()`
- [x] No duplicate analytical field catalog
- [x] Structured `CopilotAnalysisPlan`
- [x] Max 3 query plans
- [x] T03 validation and execution reused
- [x] One repair attempt
- [x] Context resolved once per turn for query execution
- [x] Unsupported data / unsupported operation / clarification paths
- [x] Analytics errors fail closed
- [x] No SQL exposed to LLM contract
- [x] No direct DB or PrestaShop access in Copilot domain/application
- [x] No PII fields in schema/result contracts
