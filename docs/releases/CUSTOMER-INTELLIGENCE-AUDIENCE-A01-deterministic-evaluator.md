# CUSTOMER-INTELLIGENCE-AUDIENCE-A01 — Deterministic Evaluator

Status: **READY_WITH_DOCUMENTED_DEBT**

This release implements the bounded Audience Engine core. It adds no HTTP route, persistence for
audience definitions/evaluations, CRM/R3/Copilot integration, contactability, export, or campaign
behavior.

## Historical Gate 1 block and resolution

The original A01 stopped at Gate 1 because affinity rows did not persist the exact eligible
customer identity set. That evidence is preserved here: row absence could not distinguish an
eligible customer with no matching code from a customer outside the affinity population.

Historical Gate 1 decision: `AFFINITY_POPULATION_MEMBERSHIP=BLOCKED_REQUIRES_MIGRATION`. The
precise missing contract was an immutable table keyed by `(snapshot_id, customer_id)`, containing
one row for every eligible customer, including customers without affinity rows. Inferring that set
from row data, header counts, observed top codes, or mutable PrestaShop data was explicitly
rejected.

`CUSTOMER-INTELLIGENCE-AFFINITY-A01.5.1` resolved that prerequisite with migration 014 and the
immutable `customer_commercial_affinity_snapshot_population` table. EC2 validation recorded
published snapshot 4, population size 45,196, 102,967 affinity rows, 43,283 customers with
affinity, 1,913 without affinity, and the exact dataset, affinity, and eligible-population
checksums in the A01.5.1 release note. A second identical build returned `idempotent=true` and
snapshot 4. The one-customer drift from snapshot 3 is explained by customer 158623/order 81612
with `valid=0`. `AFFINITY_POPULATION_MEMBERSHIP=READY` and `AUDIENCE_A01_UNBLOCKED=YES`.

## Gate 1 result

### G1.1 Affinity population membership — READY

Audience consumes the persisted snapshot population table, never affinity rows alone. An eligible
customer with no matching normalized row evaluates `FALSE`; a customer outside the selected
eligible set evaluates `UNKNOWN`. Batch access is bounded and uses the `(snapshot_id, customer_id)`
primary key. Snapshot 4 is compatible with this contract.

### G1.2 Temporal resolution — READY

`createAudienceContextResolver` uses the selected published feature snapshot as the sole anchor,
then selects the latest published RFM, cluster, CLV, and affinity snapshot at or before its
reference time. Equal reference times use the higher snapshot id. Future snapshots and legacy
affinity headers without a population checksum are excluded. The result serializes component
ids, reference times, versions, policies, checksums, model/ontology lineage, and availability.

### G1.3 Raw RFM projection — READY

The fixed Audience SQL projection reads persisted `recency_days`, `frequency_orders`, and
`gross_order_value_tax_incl` from the selected RFM snapshot with one set-based query. It does not
rename those fields to Commercial Profile names and performs no per-customer orchestration.

### G1.4 Affinity code validation — SYNTAX_ONLY_WITH_DOCUMENTED_DEBT

Axis is restricted to `PRODUCT_FAMILY`, `DISCIPLINE`, and `USE_CONTEXT`; code is bounded,
non-empty, case-sensitive, and opaque. Customer Profile does not reject an unobserved code. A
complete versioned/checksummed Catalog-owned code registry remains an integration debt.

### G1.5 SQL feasibility — READY_WITHOUT_INDEX_CHANGE

The compiler emits fixed SELECT-only SQL, fixed table/column identifiers, parameterized values,
left joins for scalar component rows, and correlated `EXISTS` predicates for affinity. No index
migration was required or added. Target-database EXPLAIN evidence remains an operational follow-up
because `ANALYTICS_DB_*` is not configured in this checkout. The prepared shapes are feature
scalar, RFM segment, raw RFM threshold, cluster model/id, CLV threshold/support, one affinity,
RFM-and-affinity, and multi-affinity OR. Existing snapshot/customer and axis/code indexes remain
the available access paths; no measured basis exists for a new index.

## Contracts and field registry

The implementation preserves the A00 v1 contracts and version strings:

- `AudienceDefinitionV1`, `AudienceFilterV1`, `AudienceConditionV1`;
- `AudienceFieldIdV1`, `AudienceScalarOperatorV1`;
- `AudienceEvaluationContextV1`, `AudienceSnapshotLineageV1`, `AudienceAvailabilityV1`;
- `AudienceEvaluationResultV1`, `AudienceMemberV1`, `AudienceValidationErrorV1`.

The compile-time registry exposes only the approved RFM, cluster, CLV, and commercial feature
fields. Affinity is not a scalar field. Cluster identity remains `(modelVersion, clusterId)` and
RFM segment interpretation remains paired with its selected segment version.

Validation enforces the fixed field/operator/type allowlists, maximum depth 5, maximum 20
conditions, maximum 500 `IN` values, non-empty boolean groups, ordered `BETWEEN` bounds, explicit
null tests, affinity qualifier bounds, and absolute UTC timestamps. Invalid definitions are
rejected before compilation.

## Canonicalization and semantics

Canonical JSON sorts object keys, recursively canonicalizes `NOT`, sorts/deduplicates `AND` and
`OR` children, normalizes `IN`/`NOT_IN` values, and normalizes decimal strings without changing
case-sensitive semantic strings. It performs no algebraic rewriting. The SHA-256 digest is
available as `audienceDefinitionChecksum`; evaluation timestamps, SQL, preview limits, and
resolved context are excluded.

The evaluator preserves explicit `TRUE`, `FALSE`, and `UNKNOWN` values. SQL NULL behavior and the
pure row evaluator both implement the A00 truth tables. Actual nullable feature values can satisfy
`IS_NULL`; missing component rows produce `UNKNOWN`; numeric zero remains a value. Only root
`TRUE` is included, while all three counts reconcile to the feature population universe.

## Affinity evaluation and snapshot lineage

`HAS_AFFINITY` uses one normalized row for axis, code, and every supplied qualifier. It never
combines qualifiers across rows and never multiplies base customers. Outside the selected
affinity population is `UNKNOWN`; eligible without a matching row or with failed qualifiers is
`FALSE`; one qualifying row is `TRUE`.

## A01.1 operational validation runner — pending manual EC2 evidence

The development/operations-only runner is available at
`scripts/customer-intelligence-audience/a01-1-operational-validation.ts` and is exposed as
`npm run customer:audience:validate`. It composes the existing context resolver, evaluator,
compiler, and MySQL executor; it does not add public API behavior, persistence, migrations, or
Audience business logic. It discovers real RFM, cluster, and affinity values with bounded reads,
executes the fixed representative suite, checks three-valued probes, captures EXPLAIN plans and
performance evidence, and writes the credential-free artifact
`artifacts/customer-intelligence-audience/a01-1-operational-validation.json`.

The runner prefers `ANALYTICS_DB_*`. On the current EC2 layout, where the analytics tables share
the RFM schema and only `RFM_SNAPSHOT_DB_*` is available, it uses that existing family through an
explicit runner-only compatibility fallback. Credentials are never printed. Local execution in
this checkout is not operational evidence because the agent cannot access EC2.

Exact EC2 command to execute after deploying the runner:

```text
npm run customer:audience:validate
```

The repository decision remains:

```text
A01_OPERATIONAL_STATUS: PENDING_MANUAL_EC2_EXECUTION
A02_READINESS: BLOCKED_PENDING_MANUAL_EC2_EXECUTION
```

Referenced unavailable components block the whole evaluation with a typed reason. Unreferenced
unavailable components do not block. Preview members are minimal `{customerId}`, sorted ascending,
bounded at 1,000, and do not affect `matchedCount`.

## SQL architecture, security, and performance

The SQL evaluator starts from the selected Feature Snapshot Population B, left joins selected RFM,
cluster, and CLV rows, and expresses affinity through population and row `EXISTS` checks. The
compiler accepts no user identifiers or raw fragments. Values are bound parameters and execution
is SELECT-only with the configured analytics query timeout. Query and total durations are captured.
The implementation is set-based and has no N+1 path.

## Tests and remaining debt

Focused Audience tests: 92 passed. Affinity tests: 147 passed, 1 skipped. Customer Intelligence
tests: 415 passed. The full repository suite: 2,048 passed, 1 skipped. Typecheck, lint, build, and
`git diff --check` passed.

Remaining debts are the Catalog-owned versioned affinity code registry and target-EC2 EXPLAIN
artifacts in this checkout. No ontology definition was copied into Customer Profile, and no R3 or
Copilot dependency was introduced.

## Final decision

```text
PRE_FLIGHT_DOCS: PASSED; A01.5.1 records EC2 validation and READY decision
GATE_1: PASSED
AFFINITY_POPULATION_MEMBERSHIP: READY
AFFINITY_CODE_VALIDATION: SYNTAX_ONLY_WITH_DOCUMENTED_DEBT
TEMPORAL_RESOLUTION: READY
RAW_RFM_PROJECTION: READY
CONTRACTS: READY
FIELD_REGISTRY: READY
VALIDATION: READY
CANONICALIZATION: READY
THREE_VALUED_LOGIC: READY
NULL_SEMANTICS: READY
AFFINITY_EVALUATION: READY
SNAPSHOT_LINEAGE: READY
SQL_EVALUATOR: READY
EXPLAIN_RESULTS: A01.1 runner implemented; target-EC2 execution pending
PERFORMANCE: SET-BASED; DURATIONS CAPTURED; NO INDEX MIGRATION
SECURITY: READY
FOCUSED_TESTS: 92 passed
AFFINITY_TESTS: 147 passed, 1 skipped
CUSTOMER_INTELLIGENCE_TESTS: 415 passed
FULL_TESTS: 2,048 passed, 1 skipped
TYPECHECK: PASSED
LINT: PASSED
BUILD: PASSED
GIT_DIFF_CHECK: PASSED
PUBLIC_BEHAVIOR_CHANGED: NO
A02_READINESS: BLOCKED_PENDING_MANUAL_EC2_EXECUTION
DECISION: CUSTOMER_INTELLIGENCE_AUDIENCE_EVALUATOR_READY_WITH_DOCUMENTED_DEBT
```
