# MARKETING-R1-T06.4 — Copilot uiContext Adapter

Status: implemented locally; full local suite passing (1660 tests / 188 files); typecheck/build/lint
clean. No live EC2/production DB run performed, consistent with the rest of the T02/T03/Copilot/
Dashboard stack (see docs/audits/MARKETING-R1-T06-1-...md).

Prerequisite: T06.3 (`customer-intelligence-intersection`, `createExecuteIntersection`). This task
wires a dashboard-selected population into the existing Customer Intelligence Copilot session — no
second filter grammar, no second validator, no second snapshot resolver.

## 1. Request contract

`POST /v1/customer-intelligence/copilot/sessions/:sessionId/messages`

```json
{
  "question": "Que ves interesante?",
  "uiContext": {
    "intersection": {
      "contractVersion": "customer-intelligence-copilot-ui-context-v1",
      "filters": { "and": [
        { "field": "rfm.segmentCode", "operator": "eq", "value": "CHAMPION" },
        { "field": "cluster.clusterId", "operator": "eq", "value": 3 }
      ] }
    }
  }
}
```

- `uiContext` is optional — omitted entirely, behavior is byte-for-byte unchanged from before this
  task (backward compatibility, task §2/23; verified by the pre-existing "sends session messages"
  route test, unmodified).
- `intersection.filters` is T03's own `AnalyticalFilterInput` shape, reused verbatim — the same
  contract T06.3's dashboard intersection endpoint already accepts. No `uiFilter`/`dashboardFilter`
  type exists anywhere in this codebase.
- `intersection.contractVersion` is optional; if supplied it must equal
  `customer-intelligence-copilot-ui-context-v1` (`CUSTOMER_INTELLIGENCE_COPILOT_UI_CONTEXT_VERSION`,
  `domain/customer-intelligence-copilot/contracts.ts`) — a new, small envelope version distinct from
  T06.3's dashboard-endpoint version, because this is a different transport (copilot session
  messages, not `POST .../dashboard/intersections`) carrying the same underlying filter contract.
- `intersection.featureSnapshotId` is optional and, if supplied, must equal the session's own
  pinned feature snapshot (§19 below) — never a second pinning mechanism.

The outer envelope is validated by a `.strict()` zod schema mirroring T06.3's
`dashboardIntersectionRequestBody` exactly (`http/routes/index.ts`); `filters`' full structural/
semantic validation (unknown field, invalid operator, malformed BETWEEN/IN, too many leaves, too
deep) is owned entirely by T03's `validateAnalyticalQueryPlan`, invoked once via
`createExecuteIntersection` — never a second, zod-shaped filter schema that could silently diverge.

## 2. The adapter

`src/application/customer-intelligence-copilot-session/ui-context.ts` —
`resolveCopilotUiContext(deps, args)`:

```
CopilotUiContextRequest
   -> contractVersion/featureSnapshotId checks (cheap, pure)
   -> deps.executeIntersection({ featureSnapshotId: session's pinned id, filters })   <- T06.3, reused verbatim
   -> map result to ResolveCopilotUiContextResult
   -> project into CopilotUiContextSelectedPopulation (compact, label-bearing)
```

`executeIntersection` is the exact `ExecuteIntersection` function `bootstrap.ts` already builds for
`POST /v1/customer-intelligence/dashboard/intersections` — one instance, shared by both consumers
(`bootstrap.ts` now hoists it into a local `const` before wiring either).

Ponytail-documented decision (task §21, Performance): the adapter **recomputes** the intersection
(T06.3's own bounded 1-2 aggregate queries — never per-metric, never row materialization) on every
turn that carries a `uiContext`, rather than caching by `queryPlanHash` and trusting a
client-supplied `matchingPopulation`. Task §21 explicitly allows either approach; recomputing is
simpler and never trusts an unverified client-supplied count. Revisit only if this measurably shows
up in latency — it has not been measured against a live DB in this task (see Status above).

## 3. Validation is fail-closed (task §4/18)

Every failure path returns before any model call:

| Adapter result | Session-turn response | HTTP |
|---|---|---|
| unknown `contractVersion` | `invalid_ui_context` | 400 |
| `featureSnapshotId` mismatch | `invalid_ui_context` | 400 |
| T03 `invalid_intersection` (unknown field, bad operator, too deep, malformed BETWEEN/IN, ...) | `invalid_ui_context` (T03's own errors, unchanged) | 400 |
| `required_rfm_snapshot_unavailable` / `required_cluster_snapshot_unavailable` | `invalid_ui_context` | 400 |
| `degraded` (analytics down/not configured) | `analytics_unavailable` (existing status, reused) | 503 |

`invalid_ui_context` is a new `CustomerIntelligenceCopilotResponse` status
(`domain/customer-intelligence-copilot/contracts.ts`), the same shape as the existing
`planner_invalid` (`{status, finalResponseState:'failure', errors, contractVersion}`) — reusing the
established pattern rather than inventing a new response envelope shape. The turn is still recorded
in session history (question + failure response) so the conversation stays legible; `analyticalState`
and the model are both untouched.

No raw SQL, no arbitrary field names — every identifier still comes from T03's static field
registry (`schema-registry.ts`), unchanged by this task.

## 4. Semantic projection for the model (task §5)

`CopilotUiContextSelectedPopulation` (`domain/customer-intelligence-copilot/contracts.ts`):

```json
{
  "filters": [
    { "field": "rfm.segmentCode", "label": "Segmento RFM", "operator": "eq", "value": "CHAMPION", "businessValue": "Clientes campeones: compra reciente, frecuente y de alto valor" },
    { "field": "cluster.clusterId", "label": "Cluster", "operator": "eq", "value": 3, "businessValue": "Cluster 3 - Clientes recurrentes de alto valor y compra diversificada" }
  ],
  "matchingPopulation": 412,
  "queryPlanHash": "…64 hex…",
  "featureSnapshotId": "17",
  "rfmSnapshotId": "9",
  "clusterSnapshotId": "5",
  "requiredDimensions": ["rfm", "cluster"]
}
```

`filters` is a full recursive leaf-walk of the validated T03 filter tree — display-only, the boolean
AND/OR nesting itself is preserved separately for execution (§5 below) and never reconstructed from
this flattened list. `label`/`businessValue` come exclusively from `business-semantics.ts`'s two new
exports, `resolveFilterFieldLabel`/`resolveFilterFieldBusinessValue` (task §14: no second label
dictionary) — only `rfm.segmentCode`/`cluster.clusterId` get a resolved `businessValue` today
(ponytail-documented ceiling: every other registered field gets a humanized label with
`businessValue: null`, no invented per-field formatting).

Never exposed: SQL, physical columns (`fr.*`/`rr.*`/`cr.*`), compiler/plan internals, internal table
names, the raw T03 filter tree, or the queryPlanHash's derivation.

## 5. Semantic role and precedence (task §6)

`uiContext` (`sessionContext.uiContext`, new field on `CopilotSessionContext`) is a distinct concept
from T05's conversational semantic anchor (`sessionContext.semanticFocus`) — both are sent to the
model together, never merged into one structure:

- **uiContext** = the externally selected dashboard population (this task).
- **semanticFocus/activeFinding** = the prior conversational finding (T05, unchanged).

Precedence, as implemented:

- **B/D (structural, always enforced).** The current uiContext is the default population scope for
  every executed query — enforced deterministically by `executeAnalyticalSteps`' composition step
  (§6 below), which runs *after* the model has already produced its query and cannot be bypassed by
  prompt drift or a stale semantic anchor. A conflicting prior anchor can influence the model's
  wording, but it can never broaden the actually-executed query beyond the current uiContext scope
  unless the model explicitly names a different value for that same field (an intentional override,
  §7).
- **A/C/E (linguistic, prompt-guided).** Which referent resolves a pronoun ("este grupo", "ese
  cluster"), when to clarify, and when the user's explicit wording should steer analysis outside
  the default scope are language-understanding judgment calls — guided via the tool-runtime/
  synthesis prompt instructions (§8), backed by the same structural guarantee above so a
  misjudgment can drift the *answer's framing* but never silently drop the population scope from
  the *executed query*.

## 6. Filter composition (task §10/11) — the single chokepoint

`executeAnalyticalSteps` (`session-service.ts`) is the one function every analytics execution path
already shared before this task (native tool runtime, unified planner, legacy planner). It now takes
one additional parameter, `uiContextFilters: AnalyticalFilterInput | null` (the session's active
`uiContext.rawFilters`, threaded from all three call sites), and — before executing any step —
AND-composes it with that step's own filters via `composeStepFiltersWithUiContext`
(`ui-context.ts`), then **re-validates** the composed plan with T03's own `validateAnalyticalQueryPlan`
before execution:

```
model query filters  +  uiContext scope filters  ->  deterministic AND composition  ->  T03 re-validation  ->  execution
```

Composition rule: a uiContext top-level condition (a top-level `{and:[...]}` group is unwrapped the
same as the bare-array AND sugar, so the two equivalent T03 syntaxes never compose differently) is
dropped — never AND'd in — whenever the model's own step already references that same field.
Everything else is AND'd in unchanged. A nested `{or:[...]}` inside the scope is kept or dropped as
one indivisible unit, never partially flattened (partial flattening would silently turn an OR into
an AND). This single rule produces every mode the task asked for without a named mode field exposed
anywhere:

- **inherit_scope** — model's query has no overlapping filter → the whole scope is AND'd in.
- **refine_scope** — model adds an unrelated condition (e.g. `daysSinceLastOrder >= 180`) → AND'd
  alongside the full scope.
- **compare/override_scope** — model explicitly filters the same field to a different value (e.g.
  `clusterId = 2` while uiContext says `clusterId = 3`) → that one scope condition is dropped for
  that query; every other scope condition still applies. Two queries with two different explicit
  values on the same field (the "compáralo con el cluster 2" case) therefore each keep their own
  value and never collide into an impossible `clusterId = 3 AND clusterId = 2`.

If composition pushes the plan past T03's own `MAX_FILTER_LEAVES`/`MAX_FILTER_DEPTH`, the existing
`invalid_plan` → `planner_invalid` response is reused (no new failure status needed).

## 7. Analytics routing (task §9) — uiContext augments, never forces

Routing itself (respond_directly / clarification_required / answer_from_context / run_analytics /
the tool-runtime's own tool-call decision) is completely untouched by this task. `uiContext` only
changes *what a query is scoped to when analytics runs* — it never forces analytics for a purely
conceptual question ("Que significa Champion?" answers directly from the projection's labels, no
tool call) and never skips analytics for a factual question ("Cuantos son?" still requires
`run_analytical_queries`, deliberately — see the tool-runtime instruction below).

## 8. Prompt changes (native tool runtime — task §11's own explicit focus)

`CUSTOMER_INTELLIGENCE_COPILOT_TOOL_RUNTIME_INSTRUCTIONS` (v2→v3) and
`CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SYNTHESIS_INSTRUCTIONS` (v5→v6) gained `selectedPopulation`
guidance: treat it as the default scope, don't repeat its filters in your own query (the runtime
scopes automatically), write your own filter on the same field only to narrow/compare/override, and
never state its `matchingPopulation` (present in context for scale/framing, not as a citable fact)
without calling `run_analytical_queries` first. `toolRuntimeMessages`/`toolSynthesisMessages`
(`session-service.ts`) now send `selectedPopulation: sessionContext.uiContext` alongside the
existing `semanticFocus`.

**Scope cut, documented:** the legacy/unified-planner prompt sets (`ORCHESTRATOR`/
`UNIFIED_PLANNER`/`PLANNER`/`ANSWER` instructions) were not given equivalent textual guidance. Those
paths still *receive* `sessionContext.uiContext` (it flows through generically — `generateAnswer`/
`generateConversationDecision`/`generateConversationPlan`/`generateAnalysisPlan` all pass the whole
`sessionContext` object to the provider, unlike the tool-runtime's two hand-built JSON payloads), but
without prompt text explaining its semantics. Both paths are feature-flagged off by default
(`CUSTOMER_INTELLIGENCE_COPILOT_TOOL_RUNTIME_ENABLED`/`_UNIFIED_PLANNER_ENABLED` both default
`false`), and task §11's own heading centers "the native tool runtime" — this is a scope boundary,
not an oversight. Filter composition (§6) applies uniformly to all three paths regardless (single
chokepoint), so scope enforcement is never weaker there even though prompt guidance is.

## 9. Snapshot consistency (task §19)

The session's pinned feature snapshot is always authoritative. `resolveCopilotUiContext` always
resolves the intersection against `session.resolvedIds.featureSnapshotId` (never `null`/"latest"),
and rejects a request-supplied `featureSnapshotId` that names a different one — `invalid_ui_context`,
never a silent switch. `refreshSessionContext` and `resetSession` both now clear `session.uiContext`
to `null` (same staleness reasoning that already made them clear `analyticalState`): a uiContext
resolved against the old anchor no longer describes the same population once the pin moves.

## 10. Session persistence (task §8)

`CopilotSession` gained one field, `uiContext: CopilotSessionUiContextState | null`
(`application/customer-intelligence-copilot-session/contracts.ts`):

```ts
type CopilotSessionUiContextState = {
  selectedPopulation: CopilotUiContextSelectedPopulation;  // the exact model-facing projection, §4
  rawFilters: AnalyticalFilterInput | null;                // canonical T03 tree, execution-only, never sent to the model
  resolvedAtTurnId: string;
  resolvedAt: string;
};
```

Bounded, no redundant result rows, no chain-of-thought — exactly the fields task §8 recommended.
`mysql-copilot-session-store.ts` persists it as one nullable JSON column,
`ui_context_json` (migration `011_add_customer_intelligence_copilot_ui_context.sql`, `+.rollback.sql`
— the same per-field JSON column convention `pinned_context_json`/`resolved_ids_json` already use on
this table, additive/nullable/backward compatible). The in-memory test store needed no change (whole
`CopilotSession` object, no field-by-field mapping).

**Absence vs. presence on a given turn** (task §7 "same-context persistence" / §16 example G): a
turn whose request omits `uiContext` leaves `session.uiContext` untouched — a client that isn't
dashboard-embedded (or a turn with no dashboard state attached) never clears a previously active
selection. A turn that *does* supply `uiContext` always resolves and replaces it (§2's
recompute-every-time decision) and change detection is the canonical `queryPlanHash`
(`state.changed`), never heuristic text comparison of the raw filters (task §7's own explicit
requirement) — verified by a same-hash-twice / different-hash unit test.

## 11. Observability (task §20)

A new `'ui_context'` `CopilotStageLatencyDiagnostic` stage is emitted once per turn that resolves a
uiContext (success or the invalid/degraded failure path), independent of which downstream routing
branch runs — a single emission point rather than threading new fields through every one of
`processToolRuntimeTurn`'s ~9 existing `emitTurnLatency` call sites. New fields, all counts/hashes/
dimension names only (never raw filter values, customer ids, or SQL): `uiContextPresent`,
`uiContextChanged`, `uiContextQueryPlanHash`, `uiContextFilterLeafCount`,
`uiContextRequiredDimensions`, `uiContextMatchingPopulation`. No `uiContextScopeMode` field was
added — §6's composition rule is derived structurally per-field rather than through a named mode, so
there is no internal mode value to report.

## 12. CRM transport (task §15/22) — contract for T06.5, not built here

No CRM-Customer-360 code was touched in this task (backend-only, per task §27/instructions). The
exact request shape T06.5's frontend integration should send with every message:

```json
POST /v1/customer-intelligence/copilot/sessions/:sessionId/messages
{
  "question": "<user text>",
  "uiContext": {
    "intersection": {
      "contractVersion": "customer-intelligence-copilot-ui-context-v1",
      "filters": <the dashboard's current canonical filter selection, T03 AnalyticalFilterInput shape>
    }
  }
}
```

- Send only the current canonical filter selection — never chart internals, rendered/localized
  labels as if they were data, SQL, the entire dashboard payload, or unrelated UI state. The backend
  remains the sole source of semantics/labels (§4/14); the frontend's own rendered "Champion" text
  is presentation only.
- Omit `uiContext` entirely for a plain chat turn with no dashboard state.
- `featureSnapshotId` should normally be omitted (defaults to the session's own pin, §9) — only
  include it if the dashboard is deliberately re-asserting the same pinned snapshot as a sanity
  check; never a different one.
- A `400 invalid_ui_context` response means the current dashboard selection could not be honored
  (bad filter, unavailable RFM/cluster snapshot, or a snapshot mismatch) — the frontend should
  surface this distinctly from a normal conversational error, not retry the same payload.
- Backward compatible today: every existing T06.2/T06.3-only CRM integration that never sends
  `uiContext` is unaffected.

Compatibility is exercised by this task's own contract tests (§13 below), which double as the
integration reference T06.5 can build the frontend call against.

## 13. Tests

- `tests/unit/customer-intelligence-copilot-ui-context.test.ts` (new, 17 cases) — the adapter in
  isolation: absent/resolved/changed-vs-unchanged (by hash)/unknown contractVersion/featureSnapshotId
  mismatch/T03 validation passthrough/required-dimension-unavailable/degraded passthrough, plus
  `composeStepFiltersWithUiContext` (inherit/refine/override/OR-group-indivisibility/full-override)
  and `collectFilterFieldNames`.
- `tests/unit/customer-intelligence-copilot-session.test.ts` (+6 cases, native tool runtime) —
  Examples A (scoped count), B (direct response, no analytics), C (refine: scope AND extra
  condition), D (comparison: two queries, no impossible AND), invalid uiContext (model never
  called), and F/G combined (uiContext carried across a turn that omits it; a real hash change on a
  later turn is honored and the prior scope does not leak into the new query).
- `tests/integration/customer-intelligence-copilot-session-routes.test.ts` (+3 cases) — optional
  `uiContext` passthrough, `.strict()` rejection of an unknown field (400, service never called),
  `invalid_ui_context` → HTTP 400 mapping.
- Existing suites: `execute-intersection.test.ts`, `mysql-copilot-session-store.test.ts`,
  `customer-intelligence-copilot-semantic-benchmark.test.ts`, and the full 1660-test/188-file suite
  all pass unmodified in behavior (two pre-existing tests updated only for the two prompt-version
  string bumps, §8).

## 14. Regression

T05.8.9 assistant-first behavior, T05 strict data grounding, T06.2 endpoints, T06.3 intersections
(untouched — this task only adds a second consumer of `createExecuteIntersection`), T03 provenance/
`queryPlanHash`, session persistence, snapshot pinning, the 3-query cap, and deterministic fallback
are all unchanged. `RouteDependencies` shape is unchanged (only the message body/response contract
grew an optional field). `bootstrap.ts`'s analytics wiring gained one shared local
(`executeIntersection`) reused by both Dashboard Intersections and the Copilot — a wiring
reorganization, not a behavior change for either existing consumer.

## 15. Limitations / explicit non-goals

Not built in this task: saved audiences, Commercial Affinity, product ontology, the CRM-Customer-360
frontend itself, charts, campaign activation, predictive models, long-term retrieval (T07). Prompt
guidance for `selectedPopulation` is soft (LLM-adherence dependent, like every other "never invent a
fact" instruction already in this prompt set) — the hard guarantee is the deterministic filter
composition in `executeAnalyticalSteps` (§6), which cannot be bypassed by the model ignoring an
instruction. No live EC2/production DB validation was performed (consistent with the rest of this
stack, §Status).
