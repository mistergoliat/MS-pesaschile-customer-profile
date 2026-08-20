# MARKETING-R1-T02 - Copilot UI + Controlled Internal Demo

Status: **READY_WITH_CONSTRAINTS**. Backend endpoint, frontend internal proxy, minimal UI, and
deterministic tests are complete. Live LLM/analytics smoke is **NOT_RUN** on this machine because
no `CUSTOMER_INTELLIGENCE_COPILOT_*` provider and no reachable `ANALYTICS_DB_*` connection are
configured.

Backend branch: `feat/marketing-r1-t02-copilot-ui-controlled-demo`
Frontend branch: `feat/marketing-r1-t02-copilot-ui-controlled-demo`

## 1. Scope

Adds a controlled internal HTTP boundary and a minimal Marketing Copilot UI over the
MARKETING-R1-T01 Copilot application layer and CP-R3-T03 analytical runtime.

This task does not rebuild the planner, query runtime, schema registry, RFM, clustering,
segments, Brevo exports, saved audiences, campaign execution, or multi-turn memory.

## 2. Backend Endpoint

`POST /v1/customer-intelligence/copilot`

Public request shape:

```json
{
  "question": "Cuantos clientes hay en cada cluster?",
  "featureSnapshotId": "17"
}
```

No SQL, raw query plan, physical table names, or planner internals are accepted in the public
request. Extra body fields and query-string parameters are rejected.

The route maps controlled Copilot statuses to HTTP statuses:

- `answered`, `clarification_required`: 200
- `unsupported_data`, `unsupported_operation`: 422
- `planner_invalid`, `answer_generation_failed`: 502
- `analytics_unavailable`: 503
- `analytics_timeout`: 504

## 3. Internal Gate

Backend feature flag:

- `MARKETING_COPILOT_ENABLED=false`
- `MARKETING_COPILOT_INTERNAL_TOKEN=`

When disabled, the route returns 404. When enabled without an internal token, it returns 503. When
enabled, callers must send `x-internal-copilot-token`; comparison uses a timing-safe check.

Frontend proxy flags:

- `MARKETING_COPILOT_ENABLED=false`
- `MARKETING_COPILOT_BACKEND_BASE_URL=`
- `MARKETING_COPILOT_INTERNAL_TOKEN=`
- `MARKETING_COPILOT_TIMEOUT_MS=30000`

The browser never receives the internal token. The Next route forwards only `{ question,
featureSnapshotId? }` to the backend.

## 4. Frontend UI

Route: `/marketing/copilot`

The screen is intentionally minimal and internal:

- question textarea with 4000-character cap
- submit/loading/error states
- controlled demo checklist
- answer rendering
- clarification / unsupported-data / unsupported-operation / planner-invalid / degraded states
- provenance panel with feature/RFM/cluster snapshot and coverage when answered

Demo checklist:

- Cuantos clientes hay?
- Cuantos clientes hay en cada cluster?
- Que cluster tiene mayor ticket promedio?
- Como se distribuyen los segmentos RFM por cluster?
- Cuantos AT_RISK_HIGH_VALUE hay en cada cluster?
- Compara los clusters por ticket promedio y cantidad de clientes.
- Analiza los clusters y dime que oportunidades comerciales observas.
- Cual es el mejor cluster?
- Cual es la mediana del ticket?
- Cuantos clientes abandonaron carrito ayer?

## 5. Provider / Live Demo

Provider abstraction remains `http_json` from MARKETING-R1-T01. No concrete live provider/model is
configured in this workspace.

Controlled internal demo status:

- Provider/model: **NOT_CONFIGURED**
- Analytics DB: **NOT_AVAILABLE**
- Live planner smoke: **NOT_RUN**
- Live UI-to-backend demo: **NOT_RUN**

The route and UI are therefore implementation-ready, but a real internal demo still requires
configuring the Copilot provider, analytics DB connection, backend flag/token, and frontend proxy
flag/token/base URL.

## 6. Verification

Backend:

- `npm run typecheck` - PASS
- `npm run lint` - PASS
- `npm run build` - PASS
- `npm test` - PASS, 169 files / 1368 tests
- New endpoint/model tests - PASS, 16 tests

Frontend:

- `npm run typecheck` - PASS
- `npm run lint` - PASS with pre-existing warnings
- `npm run build` - PASS with pre-existing warnings
- `npm test -- tests/marketing/marketingCopilotApi.test.ts tests/marketing/marketingCopilotWorkspace.test.ts` - PASS, 5 tests
- Full `npm test` - FAILS in pre-existing autonomous/commercial/e2e areas unrelated to this task; the new marketing tests pass.

## 7. Residual Risk

The implementation is closed behind feature flags and an internal-token proxy. The remaining risk
is operational, not structural: until live provider and analytics DB credentials are supplied, the
controlled demo cannot prove real model planning latency, real runtime latency, or real answer
quality on production-like snapshots.
