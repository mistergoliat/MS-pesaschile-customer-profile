# CUSTOMER-INTELLIGENCE-R3-A02.0 — R3 Harness-Pattern Runtime Audit

**Repository audited:** `E:\dev\codex\CRM-Customer-360`
**Primary repository:** `E:\dev\codex\MS\MS-pesaschile-customer-profile`
**Mode:** audit only
**Date:** 2026-09-01
**Decision scope:** locate and reverse-engineer the existing R3 orchestration pattern before designing the Customer Intelligence A02 adapter.
**Implementation status:** no adapter, runtime, provider, session, route, dependency, or test code was changed.

## Executive finding

The R3 pattern exists and is usable as a reference, but it has two different
forms that must not be conflated:

1. **R3 production-native runtime:** a custom, provider-neutral agent boundary
   around an iterative tool loop:
   `SalesAgentRuntime -> runAgentToolLoop -> governed capability gateways ->
   dispatch`.
2. **Official DeepSeek Harness package:** a real external `@deepseek-ai/dsh-*`
   runtime used only by the isolated `experiments/deepseek-harness` bake-off.
   It provides a stronger native session/event model, but is not imported by
   R3 production code and was explicitly not adopted as a production
   dependency.

The R3 production runtime is more capable than the current Customer
Intelligence Copilot orchestration because it can make several bounded,
evidence-aware tool decisions in one turn, execute tools through an
application-owned governance boundary, feed sanitized observations back into
the next decision, and finalize after tool gathering. The current Customer
Intelligence flow still owns planning, repair, execution, and answer synthesis
as separate Copilot-specific branches.

The external Harness validates the same general shape and adds an append-only,
model-readable session with native streaming, tool-call/result events,
checkpointing, compaction, and resume. However, its installed release is a
developer preview and its in-process Agent lifecycle does not match a
stateless multi-instance webhook without an explicit resume/locking design.

## Evidence map

| Concern | Evidence | Finding |
|---|---|---|
| R3 native loop | `lib/brain/commercial/agent-loop/runAgentToolLoop.ts` | Two-phase bounded autonomous loop, provider calls, validation, governance, observations, finalization. |
| Provider-neutral seam | `lib/brain/commercial/agent-loop/agentLoopProviderTypes.ts` | `{messages, correlationId} -> {rawOutput, usage/metadata}` with timeout/abort options; no Cordis or session dependency. |
| DeepSeek HTTP adapter | `lib/brain/commercial/agent-loop/providers/httpAgentLoopProvider.ts` | OpenAI-compatible JSON HTTP transport, bounded technical retries, DeepSeek thinking/cache metadata. |
| Prompt/context assembly | `lib/brain/commercial/agent-loop/buildAgentStepPromptPackage.ts` | Rebuilds a bounded system/user prompt from current context, prior steps, tool observations, and policy. |
| Tool result boundary | `lib/brain/commercial/agent-loop/buildToolObservation.ts` | Projects gateway output into bounded, tool-specific, model-facing observations. |
| Capability governance | `lib/brain/commercial/agent-loop/capability-gateway/executeCapability.ts` and `capability-gateway/types.ts` | Registry/availability/identity/retry/audit choke point; application owns the decision. |
| R3 runtime boundary | `lib/brain/commercial/sales-agent-runtime/salesAgentRuntime.ts` | Accepts an `AgentRuntimeEvent`, invokes the loop, normalizes the result, records session activity. |
| Channel/dispatch boundary | `lib/brain/commercial/sales-agent-runtime/runSalesAgentRuntimeCycle.ts` | Adapts inbound event to runtime and terminal outcome to dispatch/outbox semantics. |
| R3 session audit store | `lib/brain/commercial/agent-session/` | Stable conversation session, append-only metadata events, dedupe, bounded loads, summary projection. Not a model transcript. |
| External Harness runner | `experiments/deepseek-harness/harness/bakeoffRunnerPlugin.ts` | `ctx.agents.create`, one Agent, `agent.followup`, `agent.whenIdle`, `agent.session.events`, `deriveMessages`, dispose. |
| External Harness tools | `experiments/deepseek-harness/harness/bakeoffToolsPlugin.ts` | Public `ctx.tools.register({name, description, parameters, output, execute})` extension point. |
| External Harness boot/policy | `experiments/deepseek-harness/harness/bootBakeoff.mts` and `bakeoff.cordis.patch.yml` | Cordis patch composition; unsafe/default coding-agent capabilities disabled; only four read-only tools exposed. |
| External package contract | `experiments/deepseek-harness/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js`, `dsh-agent/lib/types/runtime-types.d.ts`, `dsh-session/lib/types/index.d.ts` | Actual compiled loop/session behavior, not inferred only from comments. |
| Prior R3 decision | `docs/architecture/A13-H0-deepseek-harness-bakeoff.md`, `docs/releases/SALES-AGENT-R3-V1.8-B-HARNESS-NATIVE-SESSION-CONTINUITY-AUDIT.md`, `docs/releases/SALES-AGENT-R3-V1.8-C0-HARNESS-PRODUCTION-ADOPTION-REEVALUATION.md` | Adopt the pattern, not the external package; the package is isolated and production topology remains unresolved. |

## Runtime location and capability boundary

`CRM-Customer-360` contains the actual sibling implementation. Its R3
production-shaped entry is:

```text
AgentRuntimeEvent
  -> runSalesAgentRuntimeCycle.ts
  -> runSalesAgentRuntime.ts
  -> runAgentToolLoop.ts
  -> buildAgentStepPromptPackage.ts
  -> AgentLoopProvider.invoke()
  -> validateAgentStep()
  -> governed read/action gateway
  -> buildToolObservation.ts
  -> next provider decision
  -> final respond/handoff
  -> dispatchSalesAgentTerminalOutcome.ts / outbox boundary
```

The runtime is a real dynamic loop, not merely a planner that emits a fixed
list of deterministic work items. `SalesAgentRuntime` explicitly translates a
normalized `CUSTOMER_MESSAGE` into the loop input and invokes
`runAgentToolLoop` unmodified. Human ownership and AI-blocked governance are
checked before any provider call. Non-customer events are rejected by this
boundary rather than silently reinterpreted.

The external Harness is located at:

```text
E:\dev\codex\CRM-Customer-360\experiments\deepseek-harness
```

That directory has its own `package.json` and dependency tree. There are no
production imports of `@deepseek-ai/*` under the R3 production runtime, and
the repository's own R3 adoption reevaluation records that the package was not
adopted. The external runtime is therefore evidence of the Harness pattern,
not an existing production dependency that A02 can import directly.

## Complete R3-native turn trace

The following is the source-level path for one real customer-message turn.
The path includes both cognition and delivery, while preserving the
application-owned boundaries.

1. A channel adapter creates an `AgentRuntimeEvent` containing the conversation
   id, message id/text, correlation id, current time, and already-resolved
   customer/session context.
2. `runSalesAgentRuntimeCycle.ts` receives the event, provider, identity
   configuration, limits, optional session store, and optional opportunity
   anchor.
3. `runSalesAgentRuntime.ts` rejects a human-owned or AI-blocked conversation
   before provider access. It also rejects any event that is not
   `CUSTOMER_MESSAGE`.
4. Before cognition, it appends a deduplicated `USER_MESSAGE_RECEIVED` marker
   containing only the inbound message reference. The message text remains in
   the canonical conversation message store.
5. The runtime maps the event into `RunAgentToolLoopInput`: customer text,
   bounded commercial context, recent catalog context, pending catalog action,
   trusted customer session, correlation id, provider, and turn limits.
6. `runAgentToolLoop.ts` creates a fixed backend-owned tool description list
   from `AGENT_LOOP_TOOL_POOL`. The model does not define or expand this pool.
7. For each gathering decision, `buildAgentStepPromptPackage.ts` builds the
   system/user messages. The package contains current time, customer message,
   sanitized commercial context, recent catalog context, pending action, prior
   steps/observations, remaining budget, identity policy, and the exact
   `AgentStep` contract.
8. `invokeProviderWithDeadline` calls the provider with the turn deadline and
   abort signal. The production DeepSeek implementation is
   `createHttpAgentLoopProvider()` in
   `providers/httpAgentLoopProvider.ts`.
9. The returned raw JSON is validated as exactly one `AgentStep`: `respond`,
   `handoff`, or `use_tool`.
10. For `use_tool`, `processUseToolStep` enriches application-owned arguments,
    constructs a deterministic in-turn dedupe key, checks registration and
    evidence gates, classifies exposure as `READ_TOOL` or
    `COMMERCIAL_ACTION`, and only then enters the corresponding gateway.
11. `executeReadTool`/`executeCommercialActionRequest` lead to
    `executeGovernedCapability`. The gateway owns capability lookup, identity,
    availability, retryable outcome handling, audit persistence, and the safe
    gateway result. The loop never calls SQL or a domain client directly.
12. `buildToolObservation.ts` converts the gateway result into a bounded
    model-facing observation. It omits credentials, SQL, raw errors, and
    unrequested data. The observation is added to the next prompt's prior-step
    context.
13. The loop repeats until the decision budget, tool budget, or deadline is
    exhausted, or the model returns `respond`/`handoff`.
14. If gathering ends without a terminal answer, the loop enters finalization.
    It makes at most two provider attempts, offers no tools, and accepts only
    `respond` or `handoff`. A final failure becomes a typed terminal reason,
    not an unbounded retry.
15. `SalesAgentRuntime` maps the loop terminal reason to `responded`,
    `handoff`, `failed`, or `blocked`, rolls up step/tool/token metadata,
    records bounded session activity, and returns a provider-neutral runtime
    result.
16. `runSalesAgentRuntimeCycle.ts` maps that result to the single R3-native
    dispatch terminal boundary. The response/fallback/handoff is written using
    existing outbox/delivery semantics; the runtime does not create a second
    sender. Post-dispatch, it records the assistant reference and commercial
    event/metrics. The customer-visible transcript remains owned by the
    conversation/outbox domain.

## Actual external Harness turn trace

The isolated Harness runner uses the official public extension surface:

```text
bootBakeoff.mts
  -> dsh-app-boot.boot(root + dsh-base patch + bakeoff patch)
  -> bakeoffToolsPlugin.apply(ctx)
       -> ctx.tools.register(four read-only tools)
  -> bakeoffRunnerPlugin.apply(ctx)
       -> ctx.agents.create({sessionId, agentOptions})
       -> for each scenario turn:
            createUserMessage(...)
            agent.followup(message)
            await agent.whenIdle()
            read agent.session.events / deriveMessages()
       -> handle.dispose()
```

The runner uses one Agent/session for all scenario turns. `followup()` inserts
one ordinary user message into the Agent inbox; it does not rebuild or resend
the prior transcript. `whenIdle()` waits until the current activity and any
replacement work are quiescent. The runner then reads the append-only session
events and derives the model-facing message history. This is real native
session behavior in the installed package, not a custom loop in the bake-off.

The compiled `dsh-agent-loop/lib/index.js` shows the actual inner mechanics:

- `turn()` appends `turn/start`, claims inbox messages, assembles prompt
  context, appends `step/start`, runs `step()`, appends `step/end`, and then
  appends `turn/end`.
- `step()` derives the complete session message surface with
  `session.deriveMessages()`, builds a provider request, streams assistant
  chunks into `assistant/chunk`, appends `assistant/message`, extracts tool
  calls, executes them, appends `tool/call`/`tool/result`, and repeats at the
  next step boundary while the tool result does not conclude the turn.
- Tool calls are grouped by execution mode. Parallel-safe calls are dispatched
  through a bounded pool (`DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10`), while
  exclusive calls form barriers. Cancellation drains started calls and
  appends synthetic aborted results for calls not dispatched.
- Provider request failures pass through `agent/request-error`; a listener may
  explicitly return `{kind: "retry"}`, otherwise the step becomes an error.
- A session request header/context is persisted once and changed only when the
  effective route/config changes. The provider receives the durable derived
  message surface plus registered tool schemas.

The external package's tools are native protocol tools: its DeepSeek adapter
serializes `tools` into function declarations, assistant `tool-call` blocks,
and tool-result messages. This differs from the R3-native loop, whose HTTP
provider sends no native `tools` field and asks DeepSeek for one JSON
`AgentStep`; R3's tool descriptions are prompt content and its tool result is
inserted into the next generated prompt.

## Why the R3 pattern is more capable

The current Customer Intelligence Copilot has a strong deterministic query
engine, but its brain-specific orchestration still separates planner, repair,
analytical execution, answerer, native-tool selection, and session branches.
Its model is not given a generic, repeatable loop where every observation can
drive another bounded decision.

R3 adds these capabilities at the orchestration layer:

- iterative model decisions within one turn, instead of one planner decision;
- a fixed backend-owned capability pool and explicit read/action exposure;
- application-enforced evidence gates before catalog/product mutations;
- governed capability execution with safe observations fed back to the model;
- independent decision, tool, finalization, provider-retry, and timeout limits;
- explicit terminal outcomes and handoff instead of treating every failure as
  an answer;
- per-call inference records for elapsed time, model, request id, finish reason,
  and token counts;
- a runtime boundary independent from channel routing and delivery;
- a session/event pattern that can be extended toward cross-turn model memory.

This does not mean R3 owns Customer Intelligence truth. R3's greater
capability is bounded cognition/orchestration; identity, pricing, stock,
shipping, opportunity, authorization, query execution, and delivery remain
application/domain responsibilities.

## Generic, mixed, and CRM-specific components

| Component | Classification | Reuse conclusion |
|---|---|---|
| Iterative gather/finalize loop | Generic runtime pattern | Extract behind a neutral runtime interface; do not copy Sales prompts. |
| Provider invocation interface | Generic | Reuse the shape conceptually: messages, correlation, timeout, abort, normalized response metadata. |
| HTTP JSON transport, status parsing, deadline, technical retry | Generic provider adapter | Reusable transport mechanics, with provider-specific fields isolated. |
| DeepSeek `thinking`, `reasoning_tokens`, prompt-cache fields | Provider-specific | Keep in the DeepSeek adapter; expose only neutral metadata to A02. |
| Fixed tool registry/descriptor projection | Generic boundary | Reuse registry-to-tool projection, but source descriptors from A01. |
| Native tool call/result event log and `deriveMessages()` | Generic session primitive | Valid design target; do not make the external package's format the A02 source of truth without a compatibility decision. |
| Stable session id, append, resume, dedupe, compaction/checkpoint hooks | Generic session primitive | Reuse as requirements. R3's current store covers only the audit/event subset. |
| Bounded observation/result projection | Generic safety mechanism | Reuse the mechanism; define Customer Intelligence-specific fields separately. |
| `AGENT_LOOP_TOOL_POOL` | CRM-specific | Replace with A01 registry-derived, allowlisted descriptors. |
| Commercial Capability Gateway | CRM-specific application boundary | Keep; A02 must call it or its Customer Intelligence equivalent, never bypass it. |
| Identity/customer/opportunity context | CRM-specific | Keep application-owned and inject as trusted context. |
| Sales prompt rules, catalog continuity, shipping/product policy | CRM-specific | Do not carry into Customer Intelligence. |
| Mutation/evidence guards | Mixed | Generic guard shape; current rules are sales/catalog-specific. A02 remains read-only unless a later explicit contract says otherwise. |
| `runAgentToolLoop.ts` as a whole | Mixed | It combines a generic loop with Sales AgentStep, tool names, evidence policy, and pending catalog state. Extract the core contract; do not import the whole module. |
| `SalesAgentRuntime` | Mixed | Runtime/terminal normalization is reusable; event/context fields and dispatch are CRM-specific. |
| `AgentSessionStore` | Mixed but intentionally narrow | Useful audit trail and dedupe primitive; not a substitute for full model-visible transcript memory. |
| `buildToolObservation.ts` | Mixed | Projection discipline is reusable; its product/shipping/recommendation shapes are not. |
| `httpAgentLoopProvider.ts` | Mixed | Transport and failure taxonomy are reusable; DeepSeek wire details stay provider-specific. |

## Responsibility matrix

| Responsibility | R3/Harness pattern | Customer Intelligence A02 owner |
|---|---|---|
| Decide whether a turn may run | Runtime boundary/governance input | CI application route/session policy; fail closed for blocked owner/AI state. |
| Build model-facing context | Runtime/session projection | CI adapter; only bounded, sanitized context and application-owned pinned refs. |
| Advertise capabilities | Tool registry | A01 `CustomerIntelligenceCapabilityRegistry.listDescriptors()`, filtered by policy. |
| Select next capability | Model loop | Harness/runtime may propose; application validates the id/schema and budget. |
| Authorize execution | Gateway/application | A01 registry and execution context; never model self-report. |
| Execute query | Domain/application query runtime | Existing A01 `analytics.query` capability and its validated analytical executor. |
| Enforce scope | Application | `selectedPopulation`, pinned context, resolved snapshot ids, query validator/compiler. |
| Return model observation | Runtime adapter | A02 safe result projection; no raw SQL/PII/unbounded rows. |
| Own business truth | Domain stores | CI snapshot/query/result/provenance state; never Harness session. |
| Persist model transcript | Harness-native session if selected | Must be an explicit A02 design choice; current A01 session store does not do this. |
| Persist capability audit | Application event/gateway store | A01/CI capability execution and session audit records. |
| Deliver customer/user response | Channel/outbox boundary | Existing CI HTTP/session presentation; Harness must not send directly. |
| Retry | Provider transport for technical failures; bounded loop recovery | A02 maps only typed capability/provider failures; no duplicate autonomous retry. |
| Observe/measure | Runtime inference/tool/session events | CI trace with correlation id, capability id/version, plan hash, provenance, latency, row count, and safe error category. |

## Actual loop and safety behavior

### R3 native limits

`runAgentToolLoop.ts` currently defines:

- `DEFAULT_MAX_DECISIONS = 3`;
- `DEFAULT_MAX_TOOL_EXECUTIONS = 2`;
- `DEFAULT_TIMEOUT_MS = 20000`;
- `FINALIZATION_MAX_ATTEMPTS = 2`;
- one gathering structural-response recovery and one gathering schema-invalid
  AgentStep repair, followed by finalization;
- finalization accepts no tools and only `respond`/`handoff`.

Duplicate calls with the same canonical tool/argument key are blocked by an
in-memory `Set` for the current turn and do not consume the real tool budget.
Evidence-gated calls and invalid-argument calls are also blocked before real
backend work. A gateway execution counts only after an actual attempt. The
gateway owns its own bounded retry policy and persists execution audit data.

### Safety assessment

| Safety concern | Assessment | Evidence/gap |
|---|---|---|
| Max model iterations | **Robust** | Gathering decision bound plus two-attempt finalization. |
| Max capability calls | **Robust per turn** | Tool execution count increments only for actual attempts; fixed pool. |
| Duplicate exact calls | **Robust per turn** | Canonical argument key and `executedCalls` set. |
| Semantic/repeated calls across turns | **Partial** | The in-memory set expires at the turn boundary; durable session dedupe is audit-event dedupe, not result replay. |
| Tool authorization | **Robust** | Exposure classification, registry lookup, application gateway, evidence checks. |
| Mutating replay/idempotency | **Partial-to-strong at gateway** | Request/event identity and gateway audit exist, but the generic loop itself is not a durable transaction coordinator. |
| Provider technical retries | **Robust/bounded** | Only selected 429/5xx and transport failures retry; exponential backoff capped at 2 seconds and deadline-aware. |
| Model decision retry | **Robust/bounded** | Separate recovery flags; no unbounded “try until valid” behavior. |
| Tool timeout/cancellation | **Partial** | Provider deadline and abort are explicit; tool calls receive runtime signal in the external Harness, but R3 gateway/tool cancellation propagation is not a single demonstrated universal contract. |
| Session append failure | **Degrade-safe** | R3 session event writes use one 50 ms retry then warning/degraded status; invalid payloads are not retried. |
| Concurrent inbound turns | **Partial** | R3 MariaDB session dedupe/CAS mechanisms protect event identity, but turn ownership/serialization for simultaneous runtime calls is not the same as a single live Agent lock. |
| Cross-process resume | **Missing in native R3** | `AgentSessionStore` stores bounded metadata, not model-visible message history; `runAgentToolLoop` rebuilds each request. |
| External Harness resume | **Native by source, unexecuted here** | `AgentRegistry.resume()` and JSONL/checkpoint plugins exist, but the bake-off disables persistence/checkpointing and did not run a cross-process resume test. |
| Default unsafe capabilities | **Robust in bake-off only** | The Harness patch disables bash/fs/subagents/web/skills/telemetry; this must be recreated by any A02 boot/profile, not assumed from package defaults. |

## Provider contract

### R3 native provider

`AgentLoopProvider` is deliberately narrow:

```ts
type AgentLoopProvider = {
  name: string;
  version?: string | null;
  invoke(
    request: {
      messages: { role: "system" | "user"; content: string }[];
      correlationId?: string | null;
    },
    options: { signal?: AbortSignal | null; timeoutMs: number }
  ): Promise<{
    rawOutput: unknown;
    model?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    reasoningTokens?: number | null;
    cacheReadTokens?: number | null;
    cacheMissTokens?: number | null;
    providerRequestId?: string | null;
    finishReason?: string | null;
  }>;
};
```

`createHttpAgentLoopProvider` sends classic OpenAI-compatible Chat
Completions JSON to `BRAIN_MODEL_API_URL`, with bearer auth, `model`,
`temperature`, optional `max_tokens`, optional DeepSeek `thinking`, JSON
response format, and the generated `messages`. It does not send native tool
schemas. It parses `choices[0].message.content`, converts it into raw JSON,
and normalizes usage, finish reason, request id, empty response, invalid JSON,
HTTP status, timeout, and network failures. Provider retries are technical
transport retries only; they do not replace the loop's decision/finalization
budgets.

### External Harness provider

The installed `dsh-llm-deepseek` adapter is a streaming provider abstraction.
It serializes system/user/assistant/tool-result history, native function tool
schemas, assistant tool calls, `stream: true`, `stream_options.include_usage`,
DeepSeek thinking/reasoning fields, and optional token/accounting metadata. The
external loop therefore owns richer message/session semantics than R3's JSON
AgentStep provider.

For A02 this means the CI capability adapter should not depend on either
provider's wire format. It should receive a neutral tool invocation from the
runtime and return a neutral, bounded capability result. Provider selection,
native tool declarations, stream parsing, and usage normalization stay above
or beside that adapter.

## Session model and state ownership

### External Harness session

The external session is an append-only event log whose model-facing surface is
derived from `user/message`, `assistant/message`, and `tool/result` events.
The installed types and compiled runtime show durable turn/step boundaries,
assistant chunks/messages, native tool calls/results, request header/context,
inbox events, cancellation, and session metadata. `deriveMessages()` projects
the ordered surface; compaction can replace older surface nodes. `Agent` owns
an inbox and lifecycle (`idle`/`running`), `followup()`, `steer()`, `inject()`,
`cancel()`, `whenIdle()`, and disposal. A new process can use
`ctx.agents.resume({resumeSessionId})` when persistence is mounted.

There is no separate named “working memory” primitive in the inspected
package. The session log plus context projection, compaction, checkpoint, and
token-meter plugins are the memory model.

### R3 native session

`lib/brain/commercial/agent-session/types.ts` and `store.ts` define a stable
session id per conversation and append-only sanitized metadata events such as
`USER_MESSAGE_RECEIVED`, tool/action lifecycle events, follow-up events, and
summary/compaction placeholders. `dedupe.ts` makes ids and event keys
deterministic. `summary.ts` derives bounded recent tool activity and the last
commercial outcome from the full event list.

The R3 store intentionally does not own message text, authoritative identity,
customer profile, selected products, shipping, quote, orders, or follow-up
truth. It is an audit/context-state store. The canonical conversation text is
`conversation_message`; authoritative CI data remains the snapshot/query
domain. This ownership decision is correct and must remain intact.

The missing native-R3 primitive is a cross-turn, appendable, model-readable
conversation surface equivalent to the external Harness's `Session`.
`AgentSessionStore` cannot be promoted into that role without changing its
purpose and coupling it to transcript contents.

## A01 capability registry compatibility

A01 already exposes a compatible application boundary in the primary repo:

- `src/application/customer-intelligence-capability/contracts.ts` defines
  `CapabilityDescriptor`, `CapabilityExecutionContext`, bounded mutable
  `CapabilityBudget`, typed error codes, and `CapabilityExecutionResult`.
- `src/application/customer-intelligence-capability/registry.ts` exposes
  `getDescriptor`, `listDescriptors`, and `execute`.
- `analytics-query-capability.ts` exposes the read-only id
  `customer-intelligence.analytics.query`, version
  `customer-intelligence.analytics.query-v1`, input/output schemas, selected
  population composition, pinned context/resolved ids, query validation, and
  call/row/duration budget accounting.

This is structurally compatible with the R3/Harness tool model, but it is not a
drop-in native tool registration yet:

| A01 concern | Harness compatibility | Required A02 adapter behavior |
|---|---|---|
| Descriptor discovery | Good | Project only allowed descriptors into Harness tool schemas. |
| Tool id/version | Good | Preserve id/version in trace and result; do not let model override version. |
| Input schema | Compatible in principle | Validate the canonical plan/envelope at the adapter boundary; reject unknown/raw executable fields. |
| Execution context | Good application shape | Build from CI session/request state; never accept pinned ids, selected population, caller, or budget from the model. |
| Read-only mutability | Strong | A02 exposes only `read_only`; no autonomous export/write capability. |
| Boundedness | Strong | Share one turn budget with the runtime; do not create a second unaccounted loop budget. |
| Typed errors | Good | Convert to a safe model observation while preserving structured trace fields. |
| Typed result | Good | Return compact bounded rows/columns/provenance; keep full result application-side. |
| Registry execution | Direct | One Harness tool call maps to `registry.execute(id, canonicalInput, context)`. |

The compatibility conclusion is **YES, through a thin adapter**. The adapter
must not pass the current OpenAI tool schema blindly, and it must not expose
raw SQL or allow the model to select snapshot identity outside the application
context.

## Target A02 design (design only; not implemented)

The smallest safe A02 design should be a CI-specific adapter, not a copy of
the Sales Agent runtime:

```text
Harness/native runtime
  -> CI Harness capability descriptor projection
  -> one validated tool invocation
  -> A01 CustomerIntelligenceCapabilityRegistry.execute()
  -> bounded safe result/observation + invocation trace
```

Proposed responsibilities:

1. Accept a registry and an application-owned `CustomerIntelligenceHarness
   Context` containing request/correlation id, session id, caller, pinned
   snapshot context, resolved snapshot ids, selected-population scope, and a
   turn-scoped budget.
2. Project `listDescriptors()` into a Harness-native tool declaration. For the
   first slice, expose only `customer-intelligence.analytics.query`.
3. Validate the tool name, capability version, canonical query envelope, and
   schema before registry execution. Reject raw SQL, physical table/column
   names, arbitrary context overrides, PII-shaped fields/values, and unknown
   properties.
4. Call `registry.execute()` exactly once per accepted invocation. The registry
   and A01 capability remain responsible for context composition, plan
   validation, compiler safety, execution, budget accounting, provenance, and
   typed failure.
5. Project the result into a bounded model-facing value containing at minimum
   capability id/version, query plan hash, context/provenance summary, column
   descriptors, bounded rows, row count, truncation, duration, and a safe error
   category when unsuccessful. Do not expose SQL, credentials, raw stack/error
   text, or arbitrary rows beyond the declared cap.
6. Emit a neutral invocation trace with correlation id, session id, capability
   id/version, input hash/query plan hash, status, duration, row count,
   remaining budget, and provider/runtime step index. The trace is not a second
   source of business truth.
7. Keep all state ownership outside the Harness: selected population, pinned
   snapshot ids, context provenance, retained analytical results, references,
   and UI scope remain CI application state. A Harness session may retain
   conversation/tool messages, but it cannot mutate those authoritative
   values.

The first implementation slice should not expose `audience.export`, mutation,
or a second CRM capability family. It should prove one read-only query call,
typed error/result projection, shared budget enforcement, and compatibility
with the current A01 registry.

## Reuse strategy

`runAgentToolLoop.ts` is not directly reusable by Customer Intelligence because
its prompt contract, tools, observations, evidence rules, commercial action
branch, catalog continuity, and opportunity state are Sales-specific. The
external `@deepseek-ai/dsh-*` package is also not directly reusable as a
production dependency based on the sibling repository's recorded stability,
Node/runtime, telemetry, and stateless-webhook findings.

The correct strategy is to extract the generic harness core conceptually and
behind neutral contracts: bounded step loop, provider invocation, tool
descriptor registration, capability invocation, safe observation, cancellation
and deadlines, per-step trace, and session abstraction. Keep A01's registry and
CI state ownership in the primary repository. Use the external Harness as a
controlled bake-off/reference implementation only until package maturity and
production topology are independently proven.

## A03 bake-off feasibility

A03 is feasible for a controlled comparison, with blockers that must be made
explicit:

- **Shared capability surface:** both candidates can call the same A01
  `analytics.query` capability and receive the same pinned context, selected
  population, schema, result, and provenance.
- **Shared corpus:** scenarios can compare planning quality, grounding,
  scope-preservation, clarification, repeated-query behavior, latency, token
  usage, and failure handling without changing the query runtime.
- **Shared output envelope:** score the customer-facing answer plus structured
  trace, not raw provider text alone.
- **External Harness blocker:** the package is isolated, developer-preview
  software with its own Node/dependency/boot profile. Its default coding-agent
  tools and telemetry must remain disabled, as the existing bake-off patch
  does.
- **Session blocker:** the Harness's strongest advantage is its live
  model-readable session. A fair production-shaped comparison must define how
  CI sessions are created/resumed across webhook requests and how concurrent
  turns are serialized.
- **Mutation blocker:** no mutating capability should enter the first CI
  bake-off. A01 currently provides the required read-only boundary.
- **Durability blocker:** the existing A01 session store is not a transcript
  store. The bake-off must either use an isolated Harness session strictly as a
  test fixture or compare against an explicitly designed CI session adapter;
  it must not silently treat either session as CI business truth.

Therefore A03 can start after A02 creates the adapter seam and fixture harness,
but it should not claim production readiness from a one-process live Agent
comparison.

## Session durability findings

| Layer | Durability finding | Decision for A02 |
|---|---|---|
| External Harness native session | Full event/session model, native derive, checkpoint/compaction/persistence/resume by source in the installed release. The prior bake-off disabled persistence/checkpointing, so cross-process resume remains unexecuted. | Design target/reference, not an implicit dependency. |
| R3 `AgentSessionStore` | MariaDB-backed append-only sanitized metadata/audit events with deterministic dedupe and bounded recent loads. Does not store transcript text or model-visible tool results. | Reuse only as audit/state projection if needed; do not make it the Harness transcript. |
| CI current session | `session-service.ts` combines orchestration, state, result retention, presentation, and persistence; A01 extracted a neutral capability registry but not a generic brain session. | Keep CI authoritative state application-owned; add a thin model-session projection later. |
| Canonical conversation | `conversation_message` remains the customer/assistant transcript authority in R3's architecture. | Never duplicate authoritative message/business state into capability results. |
| Snapshot/provenance/query state | Application-owned and deterministic in A01. | Harness can read a bounded projection only; it cannot select or rewrite pinned ids. |
| Multi-instance webhook | A live external Agent object is process-local; a production turn may need `resume()` plus locking or a different durable runtime. | A02 must define turn ownership/idempotency before using native Harness session semantics in production. |

The most important durability conclusion is not “add more session rows.” It is
to separate three concerns: canonical conversation, model-context session,
and authoritative Customer Intelligence state. The R3 audit proves those are
different objects. A02 should preserve that separation.

## Required final fields

**R3_RUNTIME_FOUND:** `YES`

**R3_REPOSITORY:** `E:\dev\codex\CRM-Customer-360`

**R3_PATTERN_SUMMARY:** R3 production uses a custom bounded iterative
provider/tool loop (`runAgentToolLoop`) behind `SalesAgentRuntime`, with fixed
backend-owned tool exposure, governed capability execution, safe observations,
two-phase gathering/finalization, explicit terminal outcomes, and a narrow
provider contract. The official DeepSeek Harness is present only in the
isolated bake-off and adds a native append-only model-readable session with
`followup`, `whenIdle`, native tool events, derive, checkpoint/compaction, and
resume semantics.

**WHY_R3_IS_MORE_CAPABLE:** It supports multiple evidence-aware capability
decisions and tool observations within one bounded turn, separates provider
transport from orchestration, keeps authorization/application state outside the
model, and has explicit failure/handoff/finalization behavior. The external
Harness further demonstrates cache-friendly persistent session semantics, but
is not a production R3 dependency.

**GENERIC_RUNTIME_COMPONENTS:** Bounded gather/finalize loop; provider-neutral
invoke contract; deadline/abort; structural/schema repair; fixed descriptor
registration; governed capability callback; safe observation projection;
session event append/derive abstraction; dedupe/idempotency primitives; per-call
inference and tool traces; compaction/checkpoint/resume interfaces.

**CRM_SPECIFIC_COMPONENTS:** Sales AgentStep schema and prompts; catalog,
shipping, product, recommendation, opportunity and customer identity context;
`AGENT_LOOP_TOOL_POOL`; commercial action/read exposure mapping; evidence gates;
pending catalog action continuity; sales mutation-claim guard; R3 dispatch,
outbox, and commercial event vocabulary; A01's analytical schema/context/result
semantics are the CI-specific equivalents.

**ACTUAL_TOOL_LOOP:** R3 native: fixed tool pool -> prompt package -> one
provider JSON AgentStep -> validate -> pre-gateway dedupe/evidence/exposure ->
read/action gateway -> sanitized observation -> next gathering decision ->
tool-free finalization -> typed terminal outcome. External Harness: native
streaming assistant message -> native tool-call blocks -> bounded tool scheduler
-> durable tool-result events -> derived session history -> next step until
turn stopping; `followup` queues the next turn on the same Agent/session.

**SESSION_MODEL:** External Harness uses an append-only full-fidelity session
surface (`user/message`, `assistant/message`, `tool/call`, `tool/result`, turn,
step, request, inbox, and cancellation events) with `deriveMessages()` and
documented `create`/`resume`. R3 native `AgentSessionStore` is a narrower,
sanitized MariaDB audit/context projection and intentionally excludes transcript
text and authoritative business state. Cross-turn model-readable R3 memory is
still a design gap.

**PROVIDER_CONTRACT:** R3 native is a narrow `AgentLoopProvider.invoke()` over
system/user strings, timeout, abort, correlation id, raw parsed output, usage,
finish reason, request id, and safe provider metadata. The R3 DeepSeek adapter
uses OpenAI-compatible JSON mode and technical HTTP retries, without native
tool declarations. External Harness uses a streaming provider with native
message/tool schemas and DeepSeek-specific thinking/usage serialization. A02
must remain provider-neutral.

**STATE_OWNERSHIP:** Harness/runtime owns cognition, turn mechanics, and any
model-context session. Customer Intelligence owns identity, selected
population, pinned snapshot/resolved ids, query validation/compiler, result and
provenance truth, budgets, authorization, capability audit, HTTP/session
presentation, and delivery. `conversation_message` remains canonical
transcript state; no Harness memory becomes CI business truth.

**LOOP_SAFETY:** R3 has robust per-turn decision/tool/finalization bounds,
fixed exposure, pre-execution evidence gates, exact-call dedupe, deadline-aware
provider retries, safe observations, and explicit terminal failures. It is
partial for cross-turn duplicate result replay, universal tool cancellation,
concurrent runtime ownership, and durable model-context resume. External
Harness has stronger native cancellation/tool event/session mechanics, but its
multi-instance resume/locking path was not exercised.

**CAPABILITY_REGISTRY_COMPATIBILITY:** `YES_WITH_THIN_ADAPTER`. A01's
`listDescriptors()` and `execute(id, input, application-owned context)` map
cleanly to Harness tool registration and execution. The adapter must validate
canonical query input, preserve selected population/pinned context/budget in
application state, project bounded safe results, and never expose raw SQL or
model-controlled context overrides.

**REUSE_STRATEGY:** `EXTRACT_SHARED_HARNESS_CORE`

**TARGET_A02_DESIGN:** Add a CI-specific Harness adapter that projects the A01
read-only registry descriptor into one Harness tool, validates the canonical
analytical query envelope, builds context from application-owned pinned
snapshot/selection/budget state, calls the A01 registry exactly once per
accepted invocation, returns a bounded result/observation plus neutral trace,
and leaves all authoritative state in CI. Do not copy the Sales runtime,
directly import the external package into production, or expose mutations in
the first slice.

**A03_BAKEOFF_FEASIBILITY:** `FEASIBLE_WITH_BLOCKERS` — same A01 capability,
context, corpus, result/provenance envelope, and metrics are possible; blocked
until the A02 adapter exists and session resume/turn ownership, external
Harness boot/dependency constraints, telemetry isolation, and read-only scope
are explicit.

**SESSION_DURABILITY_FINDINGS:** External Harness durability is stronger by
source (full session event surface, checkpoint/persistence/resume/compaction),
but persistence/resume was disabled or unexecuted in the existing bake-off and
the live Agent is process-local. R3's MariaDB `AgentSessionStore` is durable
metadata/audit state, not model transcript memory. A02 must preserve separate
ownership for canonical conversation, model session, and CI business truth.

**FILES_CREATED:** `docs/audits/CUSTOMER-INTELLIGENCE-R3-A02.0-r3-harness-pattern-audit.md`

**FILES_MODIFIED:** `none`

**TESTS_RUN:** `none (audit-only; read-only repository inspection only)`

**DECISION:** `CUSTOMER_INTELLIGENCE_R3_HARNESS_PATTERN_AUDITED`

## Audit hygiene

This task created only this audit document in the primary repository. No
production code, tests, package manifests, migrations, prompts, routes,
provider wiring, session implementation, external repository, or commit was
changed by this audit.
