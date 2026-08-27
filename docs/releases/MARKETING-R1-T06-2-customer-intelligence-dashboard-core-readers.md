# MARKETING-R1-T06.2 — Customer Intelligence Dashboard: Overview + RFM + Clusters

Status: implemented locally; full local test suite passing (1596 tests); no live EC2/production
DB run performed as part of this task (consistent with the rest of the T02/T03/Copilot stack,
which is also still pending its first live validation pass — see
docs/audits/MARKETING-R1-T06-1-customer-intelligence-dashboard-read-model-audit.md).

Prerequisite audit: docs/audits/MARKETING-R1-T06-1-customer-intelligence-dashboard-read-model-audit.md
(decision: READY_WITH_PREREQUISITES). This task implements the first prerequisite slice from that
audit's §21 sequence (there called T06.2) and the P1-4/P1-5 fixes it flagged.

## 1. Architecture

No second analytical model was created (task §1). The dashboard reuses, unmodified:

- `createCustomerIntelligenceContextResolvers` (CP-R3-T02) for snapshot resolution — feature
  snapshot as anchor, RFM/cluster each independently "latest published, `referenceTime <=`
  anchor", exactly as the Copilot already does.
- `customer_feature_snapshot_row` / `customer_rfm_snapshot_row` / `customer_cluster_snapshot_row`
  / `customer_cluster_interpretation` — the same four tables the read model and T03 already read,
  through the same `ANALYTICS_DB_*` pool.
- `ClusterAnalyticsReader.getInterpretations()` (CP-R2-T03) for cluster label/description —
  never re-derived.
- `business-semantics.ts` for every user-facing label (cluster labels reused as-is; RFM segment
  labels added in this task, see §6).

What's new is a **dedicated reader**, not a new model: `DashboardAnalyticsReader`
(`src/application/customer-intelligence-dashboard/ports.ts`,
`src/infrastructure/customer-intelligence-dashboard/mysql-dashboard-analytics-reader.ts`) — four
grouped `GROUP BY` aggregate queries, following the exact precedent CP-R2-T03 set with
`ClusterAnalyticsReader`/`RfmSegmentBulkReader`: a purpose-built reader for a purpose-built
aggregation shape, kept separate from the per-customer-row `CustomerIntelligenceReader` T03/Copilot
use.

```
customer_feature_snapshot_row (anchor)
        |
        +-- LEFT JOIN customer_rfm_snapshot_row     (context resolution, reused verbatim)
        +-- LEFT JOIN customer_cluster_snapshot_row  (context resolution, reused verbatim)
        v
resolveCurrent() / resolveForFeatureSnapshot()  <-- createCustomerIntelligenceContextResolvers
        v
+-------------------+-------------------+---------------------+
| GetDashboardContext | GetDashboardOverview | GetDashboardRfm | GetDashboardClusters
+-------------------+-------------------+---------------------+
        |                    |                    |                    |
        v                    v                    v                    v
  (reshape only)   getOverviewCommercialAggregate  getRfmSegmentAggregates   getClusterAggregates
                    (1 grouped query, feature only)  (1 INNER JOIN, by segment)  (1 INNER JOIN, by cluster)
                                                                              + getClusterRfmCrossSectionGroups
                                                                                (1 INNER+LEFT JOIN, anchored -
                                                                                 NOT get-rfm-cluster-cross-tab.ts,
                                                                                 see §5)
```

Each of the 4 application services independently resolves its own context per HTTP request (task
§2: "section endpoints may resolve current context internally") — this is the cost of the chosen
hybrid API shape (task §10 of T06.1: modular bounded endpoints), not an N+1 query problem; within
one request, every service issues exactly one or two grouped SQL statements, never per-row queries
(task §9).

## 2. Contracts

`src/domain/customer-intelligence-dashboard/contracts.ts`:

- `customer-intelligence-dashboard-context-v1`
- `customer-intelligence-dashboard-overview-v1`
- `customer-intelligence-dashboard-rfm-v1`
- `customer-intelligence-dashboard-clusters-v1`

All four are discriminated unions on `status`, matching the existing `GetClusterSnapshotSummaryResult`/
`GetRfmClusterCrossTabResult` shape convention exactly (never a bare `throw` for an expected
"resource absent" case — see §7). No field, anywhere in any of the four contracts, references
Commercial Affinity — explicitly out of scope per the T06.1 audit and this task's own instruction.

## 3. Endpoints

- `GET /v1/customer-intelligence/dashboard/context`
- `GET /v1/customer-intelligence/dashboard/overview`
- `GET /v1/customer-intelligence/dashboard/rfm`
- `GET /v1/customer-intelligence/dashboard/clusters`

All four accept an optional `?featureSnapshotId=` query parameter (reusing the existing
`numericId` validator and the exact pinning convention the Copilot's `featureSnapshotId` field
already established — task §2's "clean existing pattern", not a new mechanism). Omitted =>
latest published feature snapshot. Any other query parameter, or a request body, is rejected with
400.

`/context` returns only flat, UI-safe metadata plus population coverage — no physical table or
column name is ever exposed (`sqlExpression`-style leakage is impossible here since these routes
never touch T03's registry at all).

## 4. Population semantics (non-negotiable per task §10)

Every response makes its denominator explicit, never a bare count:

- **Overview**: `population` is the full read-model coverage object
  (`featurePopulation`/`rfmMatched`/`clusterMatched`/`bothMatched`/`neitherMatched`/
  `rfmCoveragePct`/`clusterCoveragePct`) — reused verbatim from
  `customer-intelligence-read-model-v1`, never renamed to the task's suggested aliases
  (`totalCustomers` etc.) per task §12's "use existing project naming conventions if they
  differ." Commercial KPIs (`totalSpentTaxIncl`, `averageOrderValueTaxIncl`, ...) are aggregated
  over the **full feature population** (every feature-snapshot row has commercial data
  regardless of RFM/cluster match) — RFM/cluster absence never makes Overview unavailable
  (task §16).
- **RFM**: `analyzedPopulation` = `rfmMatched` (RFM row `INNER JOIN` feature row for the resolved
  snapshot pair) — **never** the full feature population. `fullFeaturePopulation` and
  `coveragePct` are always present alongside it so a caller can never mistake one for the other
  (task §5/§10's explicit warning).
- **Clusters**: `analyzedPopulation` = `clusterMatched` (cluster row `INNER JOIN` feature row),
  same discipline. A customer with no cluster assignment never appears as a cluster row and is
  never mislabeled into one (task §20 test Y) — it is reflected only in the coverage numbers.
- **AOV definition, made explicit** (task §4's "clearly define aggregation semantics"):
  `averageOrderValueTaxIncl` is always **order-weighted**
  (`SUM(total_spent_tax_incl) / NULLIF(SUM(valid_orders), 0)`) — the standard commercial AOV
  definition — and is `null` (never a fabricated `0`) when the denominator is 0. This is a
  distinct metric from `averageTotalSpentTaxIncl` (a simple per-customer mean of total spend),
  which is exposed separately in the RFM/cluster segment/cluster objects because it answers a
  different question.
- **`purchaseFrequencyDays`**: `AVG()` in SQL already skips `NULL`s (task §4's "do not average
  null as zero" requirement is structurally satisfied, not just documented), and
  `purchaseFrequencyDaysSampleSize` (`COUNT(purchase_frequency_days)`) makes that reduced
  denominator explicit rather than leaving it ambiguous.

## 5. RFM cross-section inside `/clusters` — a deliberate deviation from naive reuse

Task §7 asked for a per-cluster RFM cross-section, reusing existing proven code "without
duplicating query semantics" where possible. `get-rfm-cluster-cross-tab.ts`
(`GET /v1/clustering/snapshots/latest/rfm-cross-tab`) already computes almost exactly this — but
its own header comment states its RFM side **always resolves "latest published RFM snapshot"
independently of any cluster/feature anchor**. Calling it verbatim from inside the dashboard would
silently mix a newer RFM snapshot with this context's feature-anchored cluster snapshot whenever a
newer RFM snapshot has been published since — precisely the snapshot-alignment hazard the T06.1
audit's P0-1/§6 warns against, and precisely what task §1's "reuse... latest published *compatible*
RFM/cluster snapshot" rule forbids.

Built instead: `getClusterRfmCrossSectionGroups(clusterSnapshotId, featureSnapshotId,
rfmSnapshotId)` — one additional grouped query (not embedded in the route, per task §7/§8's own
instruction), keyed to the **same resolved `(clusterSnapshotId, rfmSnapshotId)` pair** every other
dashboard section uses. It reuses only two things from the existing cross-tab, never its snapshot
selection: the `UNSEGMENTED` bucket convention (a matched RFM row with `segment_code IS NULL`,
distinct from "not in RFM at all") and the `comparablePopulation`/`coveragePct` coverage shape.

The query groups by `(cluster_id, hasRfmRow, segment_code)` in one pass — `hasRfmRow` (a boolean
derived from `rr.prestashop_customer_id IS NOT NULL`) is what lets application code tell "matched,
unsegmented legacy row" (`UNSEGMENTED`, counted in `comparablePopulation`) apart from "not present
in the RFM snapshot at all" (`notInRfmPopulation`) — both of which collapse to SQL `NULL` on
`segment_code` alone. Base population is cluster row `INNER JOIN` feature row (same as
`getClusterAggregates`), so a cluster's cross-section total always reconciles with its
`getClusterAggregates` `customerCount` for the same snapshot pair.

When no compatible RFM snapshot is resolved for the context at all, `rfmCrossSectionAvailable:
false` and every cluster's `rfmCrossSection` is `null` — the cross-section reader is never called
(task §16: RFM absence never degrades the cluster distribution itself).

## 6. RFM business labels (task §6, T06.1's P1-4)

`business-semantics.ts` gained `RFM_SEGMENT_BUSINESS_LABELS` (8 entries, one per code already
defined in `src/domain/customer-rfm/segmentation.ts` — no new segmentation invented) and a new
exported `resolveRfmSegmentBusinessLabel(segmentCode: string | null): string`, mirroring
`CLUSTER_BUSINESS_LABELS`'s existing pattern exactly: one canonical resolver, plain-label output
for structured JSON fields (distinct from `businessEntityLabel`'s "CODE - Label" prose form, kept
for the Copilot's inline-answer use case and updated to use the new labels too). No duplicate
label dictionary is needed in any frontend — every `businessLabel` field in the RFM/clusters
responses is resolved server-side through this one function.

## 7. Error model (task §16)

| Situation | Context | Overview | RFM | Clusters |
|---|---|---|---|---|
| No published feature snapshot | 404 `no_published_feature_snapshot` | same | same | same |
| Explicit `featureSnapshotId` not found | 404 `feature_snapshot_not_found` | same | same | same |
| No compatible RFM snapshot | n/a (context still resolves) | n/a (KPIs still available, `rfmMatched: 0`) | 404 `no_compatible_rfm_snapshot` | n/a (`rfmCrossSectionAvailable: false`, cluster distribution still available) |
| No compatible cluster snapshot | n/a | n/a (`clusterMatched: 0`) | n/a | 404 `no_compatible_cluster_snapshot` |
| Analytics DB unreachable/timeout/schema mismatch | 503 `degraded` / `analytics_unavailable` | same | same | same |
| `ANALYTICS_DB_*` not configured at all | 503 `degraded` / `dashboard_not_configured` | same | same | same |
| Unexpected exception | 500 `internal_error` (never leaks error detail) | same | same | same |

Nothing collapses into a generic 500 for an expected "resource absent" case (task §16's explicit
instruction) — every non-`available` status above is a distinct, typed branch.

## 8. Provenance

Every `available` response embeds the exact same flat `DashboardContext` shape (built once by
`buildDashboardContext()` in `get-dashboard-context.ts` and reused by all three data endpoints —
task §13's "do not duplicate incompatible provenance structures"): resolved snapshot ids,
reference times, `featureVersion`/`populationPolicyVersion`/`rfmCalculationVersion`/
`clusterModelVersion`, and a best-effort `clusterInterpretationVersion` (see §9).

## 9. `clusterInterpretationVersion` — an honest value, not an assumed one

Task §3 asks the context endpoint for one flat `clusterInterpretationVersion`, but
`customer_cluster_interpretation` is versioned per `(model_id, cluster_id)`, so in principle
different clusters of the same model could carry different interpretation versions if backfilled
at different times. `buildDashboardContext()` only returns a version when **every** interpreted
cluster for the resolved model actually agrees on one; otherwise `null`. This is a deliberate,
documented choice, not an oversight — see the code comment on `deriveSharedInterpretationVersion`
in `get-dashboard-context.ts`.

## 10. Index status (task §15 — T06.1's P1 prerequisite)

Confirmed directly from migrations, no live DB check needed or performed:

| Table | Index | Migration |
|---|---|---|
| `customer_feature_snapshot_row` | `UNIQUE KEY uq_customer_feature_snapshot_row_customer (snapshot_id, prestashop_customer_id)` | `008_create_customer_feature_snapshot_tables.sql:78` |
| `customer_rfm_snapshot_row` | `UNIQUE KEY uq_customer_rfm_snapshot_row_customer (snapshot_id, prestashop_customer_id)` | `002_create_customer_rfm_snapshot_tables.sql:62` |
| `customer_rfm_snapshot_row` | `KEY idx_customer_rfm_snapshot_row_snapshot_segment (snapshot_id, segment_code)` | `003_add_customer_rfm_snapshot_row_segments.sql:7` |
| `customer_cluster_snapshot_row` | `UNIQUE KEY uq_customer_cluster_snapshot_row_customer (snapshot_id, prestashop_customer_id)` | `005_create_customer_cluster_tables.sql:87` |

`INDEX_STATUS: CONFIRMED_FROM_SOURCE` — every join/group-by predicate this task's SQL uses
(`snapshot_id` + `prestashop_customer_id`, and `snapshot_id` + `segment_code`/`cluster_id`) is
covered. `LIVE_INDEX_CONFIRMATION_REQUIRED` does not apply here; no DDL was invented or assumed
beyond what these migrations already define.

## 11. Performance

No caching added (task §14/§17's "avoid premature caching" and "measure before optimizing"). At
current scale (~44.9k feature rows, ~10k cluster rows, RFM windowed subset) every endpoint issues
1-2 grouped queries covered by the indexes in §10 — no per-row/N+1 pattern. `console.info`
structured logs record `durationMs`, `status`, population/coverage counts, and degraded reasons
only — never PII, result rows, raw SQL, or credentials (task §14).

## 12. Regression

Full local suite: 1596 tests passing across 184 files (`npm test`), `npm run typecheck`, `npm run
build`, `npm run lint` all clean. `RouteDependencies` gained four new required fields
(`getDashboardContext`/`Overview`/`Rfm`/`Clusters`); all 11 pre-existing route-level integration
tests that construct `RouteDependencies` directly were updated with `unreachable*`/no-op fixtures
for the new fields, following each file's own pre-existing convention (no test file was rewritten
beyond that). `bootstrap.ts`'s Copilot wiring was restructured (analytics pool/resolvers now
built once behind `if (config.analyticsDb)`, with the Copilot's LLM-specific wiring nested one
level deeper behind `if (copilotModel.status === 'configured')`) so the dashboard readers work
independently of whether an LLM key is configured — this is a wiring reorganization, not a
behavior change for RFM/clustering/Copilot: `getCustomerRfm`/`getCustomerCluster`/
`getClusterSnapshotSummary`/`getRfmClusterCrossTab`/`answerCustomerIntelligenceQuestion`/
`customerIntelligenceCopilotSessionService` are constructed under the exact same conditions as
before (confirmed by the unchanged Copilot/clustering/RFM test suites passing unmodified).
PrestaShop remains read-only and is never queried by any dashboard endpoint (all four read only
from the local `ANALYTICS_DB_*` MariaDB schema, at request time, same as the read model/T03/
Copilot already do).

## 13. Limitations / explicit non-goals (task §22, unchanged from the plan)

Not built in this task, as instructed: Commercial Affinity, product taxonomy, customer-product
affinity, product-product relationships, Audience Engine, Intersections endpoint, Copilot
`uiContext`, frontend/UI, charts, a cache layer, predictive models. No `sqlExpression` or other
physical-schema detail is exposed by any of the four endpoints.

## 14. T06.3 boundary

Per the T06.1 audit's own resequencing recommendation, the next slice is **Intersections**,
wired directly to the existing T03 compiler/validator/executor (no new filter language) —
`src/domain/customer-intelligence-query/` — persisting the validated filter tree + resolved
snapshot ids + resulting population size in the same shape a future Audience (R2-A01) will need.
Commercial Affinity remains its own, separately-scoped track (T06.1 §22): a net-new,
`prestashopCustomerId`-keyed, snapshot-anchored, normalized-row engine, not a T06.x polish task.
