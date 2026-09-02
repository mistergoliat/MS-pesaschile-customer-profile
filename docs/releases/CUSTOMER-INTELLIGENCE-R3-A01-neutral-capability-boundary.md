# CUSTOMER-INTELLIGENCE-R3-A01 — Neutral Capability Boundary

## Decision

Implemented the smallest provider/brain-neutral application boundary around the existing Customer Intelligence analytical runtime. The release is `GO` for the A01 boundary only; it is not a DeepSeek/Harness rollout and does not authorize autonomous execution.

## Capability contract

The registry exposes exactly one executable capability:

`customer-intelligence.analytics.query` (`customer-intelligence.analytics.query-v1`)

It is read-only and accepts the existing canonical analytical query plan: logical schema fields, bounded filters, dimensions/metrics, ordering, and limit. It returns the existing typed `AnalyticalQueryResult`, including query-plan hash, resolved snapshot provenance, columns, rows, row count, duration, and truncation. No provider, model, prompt, HTTP, physical table, SQL expression, compiled SQL, or bound parameter is part of the neutral contract.

## Execution context and enforcement

Every invocation receives explicit `requestId`, `caller`, optional `sessionId`, pinned snapshot context, resolved snapshot IDs, optional selected-population scope, and a mutable turn budget. The capability revalidates after applying selected-population scope, then delegates to the existing validator/compiler/resolver-aware executor. The existing scope override/hash semantics are preserved in `selected-population-scope.ts` and are no longer implemented inside the session orchestrator.

Budgets are deterministic: maximum calls, requested rows, and elapsed duration are reserved and accounted for in the application boundary. Copilot compatibility preserves the observed limit of at most three query steps and 1,000 rows per query. There are no autonomous loops, retries, or extra database queries.

## Errors

The neutral vocabulary is:

`INVALID_INPUT`, `UNAVAILABLE_SNAPSHOT`, `ANALYTICS_UNAVAILABLE`, `TIMEOUT`, `BUDGET_EXCEEDED`, `UNAUTHORIZED`, `EXECUTION_FAILED`.

The current Copilot stateless route and session service are compatibility adapters. They translate current planner/tool output into the canonical capability input, invoke the registry, and translate the typed result/errors back to the unchanged public Copilot response contracts. The current model/provider remains outside the capability boundary.

## State and policy extraction

`deterministic-state.ts` exposes the practical session projection for pinned context, resolved IDs, analytical references, semantic focus, and selected population. The analytical scope composition is neutral and reusable. Existing model-selection, repair, answer-generation, and response-shaping policies remain in the current Copilot layer because moving them would exceed A01 and risk observable behavior changes.

## Remaining direct paths

The dashboard intersection adapter and session XLSX export continue to use their existing application ports. They are read-only analytical consumers outside the Copilot question execution path; A01 does not change export behavior or public contracts. The session store still has the pre-existing durability/TTL debt documented in A00: child rows are rewritten transactionally, but durable expiry/cleanup and multi-instance concurrency semantics remain follow-up work.

## Database least privilege and rollout gate

The capability reaches the existing analytics executor, which already enforces the validated, parameterized read-only query path. Database grants were not changed by A01 and were not independently verified in this release. Therefore the conceptual gate remains:

`AUTONOMOUS_HARNESS_ANALYTICS_ALLOWED = NO`

No autonomous Harness/DeepSeek execution may be enabled until the analytics principal is verified as least-privilege read-only against the approved read model, with no production write or migration side effects.

## Verification

Focused contract and compatibility tests cover descriptor neutrality, registry cardinality, canonical execution/provenance, scope composition and post-scope validation, budget exhaustion, neutral error normalization, adapter reuse, and architecture imports. The final command results are recorded in this release handoff:

- Focused capability/Copilot tests: 7 files, 143 tests passed.
- Full Customer Intelligence suite: 38 files, 484 tests passed.
- Full repository suite: 220 files, 1,949 tests passed.
- Typecheck: passed (`npm run typecheck`).
- Lint: passed (`npm run lint`).
- Build: passed (`npm run build`).

## Next release readiness

Ready for the next release to add another brain adapter or provider only after it consumes this registry contract, keeps the capability list unchanged unless explicitly approved, and passes the same neutral contract/architecture tests. Not ready for autonomous execution, new analytical capabilities, CLV/Affinity/Profile exposure, audience/export changes, or session durability remediation under A01.
