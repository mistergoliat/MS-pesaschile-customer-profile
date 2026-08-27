# MARKETING-R1-T06.3 — Dashboard Intersections via T03

Status: implemented locally; full local test suite passing (1634 tests). No live EC2/production
DB run performed, consistent with the rest of the T02/T03/Copilot/Dashboard stack (still pending
its first live validation pass overall — see docs/audits/MARKETING-R1-T06-1-...md).

Prerequisite work: T06.1 (audit) and T06.2 (Overview/RFM/Clusters/Context readers). This task
adds the bridge between fixed dashboard sections and arbitrary business filtering, using the
existing T03 analytical query runtime — no new filter language, no new SQL compiler.

## 1. Public contract

`POST /v1/customer-intelligence/dashboard/intersections`

Request:

```json
{
  "contractVersion": "customer-intelligence-dashboard-intersection-request-v1",
  "featureSnapshotId": "17",
  "filters": { "field": "rfm.segmentCode", "operator": "eq", "value": "CHAMPION" }
}
```

`filters` is T03's own `AnalyticalFilterInput` shape (`domain/customer-intelligence-query/
contracts.ts`) — a bare condition, an `{and:}`/`{or:}` group, or an array (sugar for AND) —
reused verbatim (task §3: no `dashboardFilter`/`dashboardOperator`/`dashboardCondition` type
exists anywhere in this codebase). `featureSnapshotId` is optional and reuses the exact pinning
convention T06.2's endpoints and the Copilot already use.

Response (`available`):

```json
{
  "status": "available",
  "contractVersion": "customer-intelligence-dashboard-intersection-response-v1",
  "context": { "featureSnapshotId": "17", "rfmSnapshotId": "9", "clusterSnapshotId": "5", "...": "..." },
  "intersection": {
    "matchingPopulation": 30,
    "featurePopulation": 100,
    "rfmMatchedPopulation": 40,
    "clusterMatchedPopulation": 35,
    "bothMatchedPopulation": 20,
    "rfmCoveragePct": 40,
    "clusterCoveragePct": 35,
    "requiredDimensions": ["rfm"]
  },
  "metrics": { "totalSpentTaxIncl": "900000.000000", "averageOrderValueTaxIncl": "10000.000000", "...": "..." },
  "analyticalDefinition": { "queryPlanHash": "…64 hex chars…", "filters": { "field": "rfm.segmentCode", "operator": "eq", "value": "CHAMPION" } },
  "execution": { "queryCount": 2, "filterLeafCount": 1, "filterDepth": 1 }
}
```

Every non-`available` status (`no_published_feature_snapshot`, `feature_snapshot_not_found`,
`required_rfm_snapshot_unavailable`, `required_cluster_snapshot_unavailable`,
`invalid_intersection`, `degraded`) carries `contractVersion` and its own distinguishing fields —
never a bare 500.

## 2. Architecture: a new reusable layer, not a dashboard-only one

Task §22-24 asked for a canonical, reusable intersection definition — not dashboard-specific
naming, because T06.4 (Copilot `uiContext`) and the future Audience Engine need to produce/consume
the same shape. This landed as a genuine new peer module, not nested under either consumer:

```
customer-intelligence-query (T03: registry, validator, compiler, plan-hash, executor)
        ^                                    ^
        |                                    |
customer-intelligence-copilot      customer-intelligence-intersection   <- NEW, dashboard-agnostic
        ^                                    ^
        |                                    |
   (MARKETING-R1-T05)              customer-intelligence-dashboard (get-dashboard-intersection.ts)
                                             ^
                                             |
                                    POST /v1/.../dashboard/intersections
```

- `src/domain/customer-intelligence-intersection/` — `CustomerIntelligenceIntersectionDefinition`,
  `IntersectionMetrics`, `IntersectionPopulation`, `IntersectionExecution`, and
  `collectRequiredDimensions`/`filterTreeStats` (pure filter-tree walkers).
- `src/application/customer-intelligence-intersection/execute-intersection.ts` —
  `createExecuteIntersection`, the deterministic adapter: request → T03 `AnalyticalQueryPlan` →
  `validateAnalyticalQueryPlan` → dimension gating → `executeAnalyticalQueryWithResolvedContext`
  (the exact function `bootstrap.ts` already builds for the Copilot) → result.
- `src/application/customer-intelligence-dashboard/get-dashboard-intersection.ts` — a thin
  reshape onto the dashboard's flat `DashboardContext` (reusing `buildDashboardContext()` from
  T06.2 verbatim), nothing else.

No raw SQL, no alternate compiler, no planner LLM anywhere in this path (task §8) — every SQL
identifier the request can ever influence still comes from T03's static field registry.

## 3. Plan generation (task §9)

Dashboard filters are already structured, so no LLM planner is needed — the plan is built
deterministically. Exactly one aggregate `AnalyticalQueryPlan` (no `dimensions`, so it's an
ungrouped aggregate — SQL always returns exactly one row for that, which is what makes "zero
matches" free rather than something this code has to special-case) with 10 metrics — the type-level
`MAX_METRICS` cap T03's own validator already enforces:

| Alias | Aggregation | Field | Public? |
|---|---|---|---|
| `matchingPopulation` | count | — | yes |
| `totalSpentTaxIncl` | sum | `commercial.totalSpentTaxIncl` | yes |
| `sumValidOrders` | sum | `commercial.validOrders` | no — AOV ratio input only |
| `averageTotalSpentTaxIncl` | avg | `commercial.totalSpentTaxIncl` | yes |
| `averageValidOrders` | avg | `commercial.validOrders` | yes |
| `averageOrders365d` | avg | `commercial.orders365d` | yes |
| `averageDaysSinceLastOrder` | avg | `commercial.daysSinceLastOrder` | yes |
| `averagePurchaseFrequencyDays` | avg | `commercial.purchaseFrequencyDays` | yes |
| `averageEffectiveDiversity` | avg | `commercial.effectiveDiversity` | yes |
| `averageRepeatProductRate` | avg | `commercial.repeatProductRate` | yes |

A second, small query (`{metrics:[{aggregation:'count', alias:'n'}], filters: <user filters> AND
purchaseFrequencyDays IS NOT NULL}`) runs **only when `matchingPopulation > 0`**, to get the exact
non-null sample size for `averagePurchaseFrequencyDays` — `AVG()` already correctly skips NULLs in
SQL, but T03's per-field metric model has no plain "COUNT(field)" (non-distinct, non-null count)
shape, and `count_distinct` would silently undercount on tied decimal values. This is the "1-2
queries" the task asks for (§9/§19) — never one query per metric, never a third.

**AOV stays order-weighted** (`sum(totalSpentTaxIncl) / sum(validOrders)`, task §21's "do not
silently change semantics from T06.2") — computed in application code from the two summed
metrics above, because T03's compiler only ever aggregates one field per metric (no two-field
expressions). This is a deliberate, documented simplification (see the `ponytail:`-style comment
in `execute-intersection.ts`): safe at realistic order-value/count magnitudes, unlike T06.2's
dedicated reader which does the same ratio in SQL and never touches a float. If exact SQL-side
DECIMAL division is ever required, the upgrade path is a two-field ratio metric kind in
`compiler.ts` — not a reason to block this task.

## 4. Snapshot pinning (task §11)

Identical anchor behavior to T06.2: `featureSnapshotId` omitted → latest published feature
snapshot; supplied → that specific one. RFM/cluster are each independently resolved to "latest
published, `referenceTime <= anchor`" via `createCustomerIntelligenceContextResolvers`, reused
verbatim — no second resolution algorithm, no "latest" lookup after execution begins.

## 5. Population semantics (task §6/7) — dimension-aware, never a single fabricated coverage %

`intersection.featurePopulation`/`rfmMatchedPopulation`/`clusterMatchedPopulation`/
`bothMatchedPopulation`/`rfmCoveragePct`/`clusterCoveragePct` come straight from the resolved
context's own population coverage — computed once during snapshot resolution (already paid for),
**zero extra queries**. This describes the addressable universe for the snapshot context,
independent of the caller's filters. `matchingPopulation` is the one number that's actually
filtered.

`requiredDimensions` is derived deterministically by walking the **validated** filter tree's own
registered `fieldMeta.source` values (task §7: "do not phrase-match the user") — never guessed
from the raw JSON. Gating:

- No `rfm.*`/`cluster.*` fields referenced → executes regardless of RFM/cluster snapshot
  availability (commercial-only intersections always work).
- `rfm.*` referenced, no compatible RFM snapshot resolved → `required_rfm_snapshot_unavailable`,
  **no DB execution** — never a silently-wrong `matchingPopulation: 0` (task §16's own warning:
  "0 champions" would be misleading when RFM data isn't available at all).
- Same for `cluster.*` → `required_cluster_snapshot_unavailable`.
- Both referenced, only one missing → the missing one wins (checked RFM-first, matching the
  task's own example ordering).

## 6. Query plan hash (task §10)

T03's own `computeQueryPlanHash()` over the **main** aggregate plan is the one and only hash
surfaced (`analyticalDefinition.queryPlanHash`) — never a second, dashboard-specific hash over
equivalent semantics. The small sample-size query is a derived denominator refinement of the same
filter set, not a separately meaningful intersection definition, so it doesn't get its own hash.
Verified stable across repeated calls with identical filters (see `execute-intersection.test.ts`).

## 7. Error model (task §17)

| Status | HTTP | Notes |
|---|---|---|
| `available` | 200 | Includes `matchingPopulation: 0` for a valid filter matching nobody (task §14 — never a 404) |
| `no_published_feature_snapshot` | 404 | |
| `feature_snapshot_not_found` | 404 | Explicit `featureSnapshotId` doesn't resolve |
| `required_rfm_snapshot_unavailable` | 404 | |
| `required_cluster_snapshot_unavailable` | 404 | |
| `invalid_intersection` | 400 | Unknown field, bad operator, too deep, malformed BETWEEN/IN, etc. — fails before any DB execution, T03's own validator errors passed through unchanged (task §15) |
| `degraded` (`dashboard_not_configured` \| `analytics_unavailable`) | 503 | |
| Unexpected exception | 500 | Sanitized, never leaks SQL/stack |

## 8. Performance (task §19)

1-2 deterministic queries per request (never one per metric, never row materialization of the
matching customers just to count them). Structured log per request:
`event, durationMs, status, matchingPopulation, requiredDimensions, queryCount,
filterLeafCount, filterDepth, degradedReason` — counts only, never the filter's actual field
names/values, never customer ids, never SQL.

## 9. Security (task §18)

Unchanged from every other endpoint in this service: PrestaShop is never queried at request time
(local `ANALYTICS_DB_*` only), no raw SQL or arbitrary expression ever reaches the compiler
(every identifier still comes from T03's static registry), bound parameters throughout, bounded
complexity (T03's own `MAX_FILTER_LEAVES=20`/`MAX_FILTER_DEPTH=5`/`MAX_IN_VALUES=500` apply
unchanged), and the aggregate response never includes a customer id — this endpoint answers "how
many and what averages", never "which customers."

## 10. Audience Engine compatibility (task §24)

`CustomerIntelligenceIntersectionDefinition` (`filters` + `resolvedContext` + `queryPlanHash`) is
exactly what a future Audience needs to persist and later re-execute — no rebuild from
human-readable labels required. No Audience persistence/migration was added in this task (task
§12) — only the shape that makes it possible without a redesign.

## 11. T06.4 boundary (task §23)

The shared `customer-intelligence-intersection` module has zero dashboard-specific naming or
types — `execute-intersection.ts` takes only `{featureSnapshotId, filters}` and returns the
canonical result. A future Copilot `uiContext` adapter can call `createExecuteIntersection`
directly (or go through the same `AnalyticalFilterInput` shape it already emits today for T03
plans) without touching this task's code. Not wired into the Copilot in this task, as instructed.

## 12. Regression

Full local suite: 1634 tests passing across 187 files; typecheck/build/lint clean.
`RouteDependencies` gained one new required field (`getDashboardIntersection`); all 12
pre-existing route-level integration tests (the 11 from T06.2 plus T06.2's own dashboard route
test) were updated with `unreachable`/no-op fixtures, following each file's existing convention.
`bootstrap.ts`'s analytics wiring was restructured again: `analyticalQueryExecutor`/
`executeAnalyticalQueryWithResolvedContext` now build once in the outer `if (config.analyticsDb)`
block (previously only built inside the Copilot's `if (copilotModel.status === 'configured')`
block) and are shared by both Dashboard Intersections and the Copilot — a wiring reorganization,
not a behavior change (confirmed by the unchanged Copilot test suite passing unmodified). T06.2's
four endpoints, T03's compiler/validator/executor, RFM/cluster business labels, and the
PrestaShop read-only boundary are all untouched.

## 13. Limitations / explicit non-goals (task §31, unchanged from the plan)

Not built in this task: frontend, dashboard filters UI, Copilot `uiContext` wiring, Audience
persistence, XLSX export, Commercial Affinity, product taxonomy, product/campaign intelligence,
caching, predictive models.

## 14. Commercial Affinity boundary (task §25)

No affinity field exists anywhere in this task's contracts. The design does not assume every
dimension is one-row-per-customer: `collectRequiredDimensions`/the gating logic operate on
registered field **sources** (`rfm`/`cluster` today), a set that a future `affinity` source can
join without restructuring — and T03's compiler already supports `EXISTS`-shaped filter fields
in principle (per the T06.1 audit's own recommendation for a normalized, multi-row affinity
table), so adding `affinity.*` fields later is additive to the registry, not a rework of this
task's gating/dimension-detection code.
