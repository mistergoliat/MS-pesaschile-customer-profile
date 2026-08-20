# MARKETING-R1-T03 - Ephemeral Multi-Turn Analytical Sessions + XLSX Export

Status: **READY_WITH_CONSTRAINTS**. Implementation, deterministic tests, typecheck, lint, and
build are complete locally. Live provider/analytics validation remains not run in this workspace
because no Copilot provider and no reachable `ANALYTICS_DB_*` connection are configured.

Git branch: `feat/marketing-r1-t03-multiturn-xlsx`

## 1. Scope

Adds ephemeral multi-turn analytical sessions and XLSX export for session-owned analytical
results. This is backend-only in `MS-pesaschile-customer-profile`.

No frontend, CRM repo, saved segments, Brevo activation, durable chat history, DB migration, Redis,
or new persistence table was added.

## 2. Session Architecture

Version: `customer-intelligence-copilot-session-v1`

Sessions are held in an in-process bounded memory store. A process restart destroys them by
design. A multi-instance deployment needs sticky routing or a future shared ephemeral store.

Session state contains:

- opaque UUID session id
- created / last activity / expiry timestamps
- pinned Customer Intelligence snapshot context
- bounded recent turns
- bounded analytical references
- bounded retained query results for context
- validated session-owned query plans for export

The session layer does not hold DB credentials, provider secrets, SQL, or PrestaShop access.

## 3. Lifecycle

Capabilities:

- `createSession()`
- `processSessionTurn(sessionId, question)`
- `resetSession(sessionId)`
- `deleteSession(sessionId)`
- `refreshSessionContext(sessionId)`
- `exportSessionQuery(sessionId, queryId, format=xlsx)`

Unknown sessions return `session_not_found`. Expired sessions return `session_expired`. No durable
fallback exists.

## 4. TTL And Bounds

Defaults:

- TTL: 60 minutes
- Max active sessions: 100
- Max turns per session: 20
- Recent turns in context: 6
- Max stored analytical results: 12
- Max result rows retained for LLM context: 50
- Max question chars: 4000
- Max answer chars: 8000
- Export max rows: 50000
- Export batch size: 1000

When max active sessions is exceeded, the in-memory store evicts the oldest session by
`lastActivityAt`. Turns/results are sliced deterministically to their configured maximums.

## 5. Snapshot Pinning

Context is resolved once when a session is created. Every analytical query in the session uses the
same feature/RFM/cluster snapshot ids. Snapshot publication mid-session cannot change analytical
meaning.

`refreshSessionContext(sessionId)` is explicit. It resolves current context again and clears
context-dependent turns, analytical references, and retained results.

## 6. Context Builder

Version: `customer-intelligence-copilot-session-context-v1`

Every turn sends a compact bounded `sessionContext` to the provider:

- pinned snapshot context
- last 6 turns by default
- active structured analytical references
- last 3 query summaries
- retained rows capped by `maxResultRowsRetained`

The provider is treated as stateless. Previous user text is data only, never privileged
instructions.

## 7. Analytical References

The session builds structured references from recent analytical results when possible, e.g.
`currentAudience` with filters such as:

```json
[
  { "field": "cluster.clusterId", "operator": "eq", "value": 0 },
  { "field": "rfm.segmentCode", "operator": "eq", "value": "AT_RISK_HIGH_VALUE" }
]
```

Follow-up turns still go through planner output and T03 validation. New populations or
aggregations require a T03 query; the LLM is not allowed to manually count retained raw rows.

## 8. Answer From Context

Planner status added: `answer_from_context`.

The planner must cite `sourceQueryIds`. The application loads only those retained session-owned
results and calls the answerer with exact data plus provenance. Unknown source ids return
`planner_invalid`.

The existing single-turn endpoint remains compatible. If a single-turn planner emits
`answer_from_context`, it is rejected as `planner_invalid` because no session context exists.

## 9. HTTP Endpoints

All routes reuse:

- `MARKETING_COPILOT_ENABLED`
- `MARKETING_COPILOT_INTERNAL_TOKEN`
- `x-internal-copilot-token`

Endpoints:

- `POST /v1/customer-intelligence/copilot/sessions`
- `POST /v1/customer-intelligence/copilot/sessions/:sessionId/messages`
- `POST /v1/customer-intelligence/copilot/sessions/:sessionId/refresh`
- `POST /v1/customer-intelligence/copilot/sessions/:sessionId/reset`
- `DELETE /v1/customer-intelligence/copilot/sessions/:sessionId`
- `POST /v1/customer-intelligence/copilot/sessions/:sessionId/export`

The existing `POST /v1/customer-intelligence/copilot` remains operational.

## 10. XLSX Export

Version: `customer-intelligence-xlsx-export-v1`

Library: `exceljs`, lazy-loaded only when export runs.

Export source: `SESSION_QUERY_REFERENCE`.

The caller cannot send raw SQL or an arbitrary query plan. The selected `queryId` must already
belong to the session. Export re-executes the stored validated plan against the session's pinned
snapshot context through the T03 analytical runtime.

Interactive row limits remain unchanged. Export uses a separate server-controlled max row setting
(`CUSTOMER_INTELLIGENCE_COPILOT_EXPORT_MAX_ROWS`, default 50000). The public caller cannot request
unbounded rows.

Workbook:

- `Result`: logical analytical column names only
- `Metadata`: export/version/provenance/queryPlanHash/rowCount/truncation metadata

No SQL, bound params, table names, provider prompts, chain-of-thought, credentials, or PII are
written.

Decimal policy: DECIMAL values are written as exact strings to avoid JS float precision loss.
Integer counts/customer ids are numeric cells. Dates/timestamps in metadata are ISO-8601 strings.

Response headers:

- `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `Content-Disposition: attachment; filename="customer-intelligence-<timestamp>.xlsx"`

## 11. Frontend Integration Contract

No CRM/frontend changes were made.

Future UI flow:

1. Create session with `POST /v1/customer-intelligence/copilot/sessions`.
2. Store returned `sessionId` in browser state only.
3. Send messages to `/sessions/:sessionId/messages`.
4. Read `queryIds` from answered turns and offer export for selected query ids.
5. Refresh only via explicit user action.
6. Delete/reset when the user closes or restarts the analytical chat.
7. For export, call `/sessions/:sessionId/export` with `{ "queryId": "...", "format": "xlsx" }`
   and handle attachment headers.

Expected future UI states: session expired, session not found, refresh done, export unavailable,
download started, unsupported/clarification/planner invalid, and answer-from-context.

## 12. Tests

New tests cover:

- session creation, opaque id, TTL, pinned context, empty state
- follow-up planner context and structured analytical references
- answer-from-context without new T03 execution
- per-session context pinning
- explicit refresh clearing old analytical references/results
- TTL expiry without planner/runtime calls
- deterministic active-session bounds
- session isolation
- prompt-injection-as-data behavior
- aggregate XLSX export workbook and metadata
- row-level XLSX export without PII columns
- unknown query export rejection
- HTTP auth/session/message/export headers/expired mapping
- existing single-turn Copilot compatibility

## 13. Known Limitations

- In-memory sessions are instance-local.
- Process restart destroys sessions.
- No durable saved analysis or saved segment exists.
- No frontend session UI yet.
- Export implementation writes workbook in memory; current expected population is manageable, but
  very large exports should move to a streaming writer if limits grow.
- Live LLM/DB validation is still pending local credentials/connectivity.

## 14. Deferred

- CRM-Customer-360 session UI integration
- durable saved analyses
- saved segments
- PII enrichment/activation
- Brevo/campaign activation
- Redis/shared ephemeral store for multi-instance deployment
- historical chat persistence
- analytics EC2 live validation
