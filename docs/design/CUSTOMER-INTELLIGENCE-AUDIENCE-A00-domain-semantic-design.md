# CUSTOMER-INTELLIGENCE-AUDIENCE-A00 — Audience Engine Domain + Semantic Design

Status: design / contract audit only

This document defines the Audience Engine as a deterministic population evaluator. It does not
add runtime code, SQL execution, migrations, HTTP endpoints, exports, Brevo integration, or R3
integration.

## 1. Executive verdict

`AUDIENCE_DOMAIN_READY_WITH_OPEN_DECISIONS`

The repository already has the necessary analytical primitives: a feature-snapshot population,
published RFM and behavioral-cluster snapshots, a published CLV snapshot, and normalized
Commercial Affinity rows. The domain can therefore be specified now.

The following implementation prerequisites remain open and must be closed in A01 before an
audience evaluator is released:

1. Add affinity to the feature-anchored snapshot resolver; the current resolver resolves only
   feature/RFM/cluster and the optional active CLV snapshot.
2. Resolve CLV and affinity by the pinned reference time, not by an independently selected
   current/active snapshot.
3. Expose RFM raw fields from the audience read path. `RfmSnapshotRow` has
   `recencyDays`, `frequencyOrders`, and `grossOrderValueTaxIncl`; the current
   `CustomerIntelligenceRow` does not carry those fields.
4. Make affinity population membership observable independently from affinity rows. The current
   affinity row table stores customers with rows and the runtime maps no row to
   `NOT_IN_POPULATION`; it cannot distinguish an eligible customer with no qualifying code from
   a customer outside the affinity builder's eligible population.
5. Provide a versioned affinity code-set validation source. The current consumer metadata carries
   ontology identity and checksums, but not a complete code registry.

These are bounded contract/read-model decisions, not reasons to block the domain design.

## 2. Design principles and boundaries

Audience v1 answers:

> Which customers satisfy this explicit commercial definition against this resolved snapshot
> lineage?

It does not answer which customers a model or an LLM considers interesting. It does not produce a
global score, rank, recommendation, contactability decision, or campaign export.

The identity authority is `prestashop_customer`; the public member identifier is the PrestaShop
`ps_customer.id_customer`. `master_customer.id` is not the Audience v1 population key.

The three domain concepts remain separate:

```text
AudienceDefinitionV1       logical, versioned rule
        |
        v
AudienceEvaluationV1       rule + resolved reference time + complete snapshot lineage
        |
        v
AudienceMembershipV1       immutable set of matching customer ids for that evaluation
```

An evaluation may be preview-only in A01, but the semantics must already be those of a complete
population evaluation. A preview limit controls returned rows, never the population evaluated or
`matchedCount`.

## 3. Domain model

The exact recommended public contract names are:

```ts
type AudienceDefinitionV1 = {
  readonly definitionVersion: 'customer-intelligence-audience-definition-v1';
  readonly root: AudienceFilterV1;
};

type AudienceFilterV1 =
  | AudienceConditionV1
  | { readonly kind: 'AND'; readonly children: readonly AudienceFilterV1[] }
  | { readonly kind: 'OR'; readonly children: readonly AudienceFilterV1[] }
  | { readonly kind: 'NOT'; readonly child: AudienceFilterV1 };

type AudienceConditionV1 =
  | {
      readonly kind: 'SCALAR';
      readonly field: AudienceFieldIdV1;
      readonly operator: AudienceScalarOperatorV1;
      readonly value?: AudienceScalarValueV1;
    }
  | {
      readonly kind: 'HAS_AFFINITY';
      readonly axis: 'PRODUCT_FAMILY' | 'DISCIPLINE' | 'USE_CONTEXT';
      readonly code: string;
      readonly minScore?: AudienceDecimalV1;
      readonly minSupportingOrderCount?: number;
      readonly minSupportingProductCount?: number;
      readonly minSupportingSpend?: AudienceDecimalV1;
      readonly minExplicitEvidenceCoverage?: AudienceDecimalV1;
      readonly lastEvidenceAt?: {
        readonly operator: 'EQ' | 'GT' | 'GTE' | 'LT' | 'LTE';
        readonly value: string;
      };
    };
```

`AudienceConditionV1` is deliberately a discriminated union. Affinity is a normalized
customer-to-many semantic fact and is represented as `HAS_AFFINITY`, not as a fake wide scalar
column. The condition means that one row satisfying all supplied affinity qualifiers exists.

`AudienceEvaluationContextV1` is the resolved, immutable context used by an evaluation:

```ts
type AudienceFieldIdV1 =
  | 'rfm.segmentCode' | 'rfm.segmentVersion' | 'rfm.rfmCode'
  | 'rfm.recencyDays' | 'rfm.frequencyOrders' | 'rfm.grossOrderValueTaxIncl'
  | 'rfm.recencyScore' | 'rfm.frequencyScore' | 'rfm.monetaryScore'
  | 'cluster.clusterId' | 'cluster.modelVersion'
  | 'clv.expectedRevenueTaxIncl' | 'clv.estimateSupportLevel' | 'clv.expectedOrders'
  | 'commercial.validOrders' | 'commercial.totalSpentTaxIncl'
  | 'commercial.averageOrderValueTaxIncl' | 'commercial.firstOrderAt'
  | 'commercial.lastOrderAt' | 'commercial.daysSinceLastOrder'
  | 'commercial.customerTenureDays' | 'commercial.distinctProducts'
  | 'commercial.repeatProductRate' | 'commercial.top1Share' | 'commercial.top3Share'
  | 'commercial.effectiveDiversity' | 'commercial.averageUnitsPerOrder'
  | 'commercial.purchaseFrequencyDays' | 'commercial.orders365d'
  | 'commercial.cancelledOrderRatio' | 'commercial.discountShare'
  | 'commercial.shippingShare';

type AudienceDecimalV1 = string; // canonical non-exponent decimal string
type AudienceScalarValueV1 = string | number | readonly (string | number)[];

type AudienceFeatureSnapshotLineageV1 = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly featureVersion: string;
  readonly populationPolicyVersion: string;
  readonly featureDatasetChecksum: string;
};

type AudienceRfmSnapshotLineageV1 = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly calculationVersion: string;
  readonly segmentVersion: string | null;
  readonly datasetChecksum?: string;
};

type AudienceClusterSnapshotLineageV1 = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly populationPolicyVersion?: string;
  readonly assignmentChecksum?: string;
};

type AudienceClvSnapshotLineageV1 = {
  readonly snapshotId: string;
  readonly snapshotKey: string;
  readonly referenceTime: string;
  readonly generatedAt: string;
  readonly modelVersion: string;
  readonly estimatorPolicyVersion: string;
  readonly horizonMonths: 12;
  readonly currencyIsoCode: 'CLP';
  readonly outputChecksum?: string;
};

type AudienceAffinitySnapshotLineageV1 = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly calculationVersion: string;
  readonly productSemanticSnapshotId: string;
  readonly productSemanticSchemaVersion: string;
  readonly ontologyVersion: string;
  readonly ontologyHash: string;
  readonly sourceSemanticChecksum: string;
  readonly consumerSemanticChecksum: string;
  readonly affinityDatasetChecksum: string;
};

type AudienceSnapshotLineageV1 = {
  readonly feature: AudienceFeatureSnapshotLineageV1;
  readonly rfm: AudienceRfmSnapshotLineageV1 | null;
  readonly cluster: AudienceClusterSnapshotLineageV1 | null;
  readonly clv: AudienceClvSnapshotLineageV1 | null;
  readonly commercialAffinity: AudienceAffinitySnapshotLineageV1 | null;
};

type AudienceEvaluationContextV1 = {
  readonly contextVersion: 'customer-intelligence-audience-context-v1';
  readonly referenceTime: string; // UTC ISO, explicit and immutable for this evaluation
  readonly population: {
    readonly universeId: 'customer-analytics-population-b-v1';
    readonly identityAuthority: 'prestashop_customer';
    readonly policyVersion: string;
    readonly populationSize: number;
    readonly populationChecksum: string;
  };
  readonly lineage: AudienceSnapshotLineageV1;
  readonly resolutionPolicyVersion: 'customer-intelligence-audience-lineage-v1';
};
```

The component lineage types preserve the fields already present in repository contracts, plus
checksums where the existing snapshot header provides them. The evaluator must preserve all
resolved identifiers and not recalculate lineage from a later “current” lookup. The
`AudienceSnapshotLineageV1` name is the single result/context lineage contract; the component
types are its fixed members, not independently resolved contexts.

`AudienceSnapshotLineageV1` is the serialized union of these component references in the result;
it is not a second snapshot-selection algorithm. `AudienceAvailabilityV1` reuses the existing
three states:

```ts
type AudienceAvailabilityStateV1 = 'AVAILABLE' | 'NOT_IN_POPULATION' | 'UNAVAILABLE';

type AudienceAvailabilityV1 = {
  readonly feature: 'AVAILABLE' | 'UNAVAILABLE';
  readonly rfm: AudienceAvailabilityStateV1;
  readonly cluster: AudienceAvailabilityStateV1;
  readonly clv: AudienceAvailabilityStateV1;
  readonly commercialAffinity: AudienceAvailabilityStateV1;
};
```

At component level, `NOT_IN_POPULATION` means a published component snapshot exists but the
customer has no row/member in that component population. At evaluation level, a component with no
resolved published snapshot, a malformed snapshot, or an infrastructure failure is
`UNAVAILABLE`; it is not customer-level absence.

`AudienceValidationErrorV1` is a structured pre-execution error:

```ts
type AudienceValidationErrorV1 = {
  readonly code:
    | 'UNSUPPORTED_FIELD'
    | 'INCOMPATIBLE_OPERATOR'
    | 'INVALID_SCALAR_TYPE'
    | 'INVALID_AFFINITY_AXIS'
    | 'UNKNOWN_AFFINITY_CODE'
    | 'MALFORMED_BOOLEAN_TREE'
    | 'EXCESSIVE_DEPTH'
    | 'EXCESSIVE_CONDITIONS'
    | 'EMPTY_BOOLEAN_GROUP'
    | 'INVALID_BETWEEN'
    | 'DUPLICATE_ALIAS'
    | 'UNSUPPORTED_NULL_TEST'
    | 'INVALID_REFERENCE_TIME';
  readonly path: string;
  readonly message: string;
};
```

Availability failures are not definition validation errors. They occur after a valid definition is
resolved against a concrete context and are represented by a blocked evaluation result.

## 4. Supported fields v1

The audit found three related but not identical projections:

- `RfmSnapshotRow` has raw RFM values and segment metadata.
- `CustomerIntelligenceRow` currently exposes RFM scores, `rfmCode`, and nullable `segmentCode`,
  but not raw `recencyDays`/`frequencyOrders`/`grossOrderValueTaxIncl`.
- `CustomerCommercialProfileRfm` presents those raw values under the projection names
  `recency`, `frequency`, and `monetary`.

Audience v1 uses explicit source-contract names for the raw persisted RFM fields. This avoids
inventing a second meaning for `recency`, `frequency`, or `monetary`. A01 must provide the adapter
that exposes them to the audience evaluator.

### SUPPORTED_FIELDS_V1

| FIELD_ID | SOURCE_COMPONENT | TYPE | NULLABLE | FILTERABLE | NOTES |
|---|---|---:|:---:|:---:|---|
| `rfm.segmentCode` | RFM | string | yes | yes | Persisted `segment_code`; null for unmatched customers and legacy rows predating segment migration. Prefer this for named commercial segments. |
| `rfm.segmentVersion` | RFM | string | yes | yes | Persisted `segment_version`; a saved segment-code rule must pin this with the definition or require the resolved snapshot to carry the exact version. |
| `rfm.rfmCode` | RFM | string | yes | yes | Persisted combined code, e.g. `555`; model/snapshot scoped. |
| `rfm.recencyDays` | RFM | integer | yes | yes | Actual `RfmSnapshotRow.recencyDays`; whole UTC calendar days at the RFM snapshot reference time. |
| `rfm.frequencyOrders` | RFM | integer | yes | yes | Actual `RfmSnapshotRow.frequencyOrders`; valid-order count under the RFM population/monetary policy. |
| `rfm.grossOrderValueTaxIncl` | RFM | decimal string | yes | yes | Actual `RfmSnapshotRow.grossOrderValueTaxIncl`; CLP tax-inclusive monetary value, not a JS float. |
| `rfm.recencyScore` | RFM | integer | yes | yes | Persisted 1–5 score; never recomputed by Audience. |
| `rfm.frequencyScore` | RFM | integer | yes | yes | Persisted 1–5 score; never recomputed by Audience. |
| `rfm.monetaryScore` | RFM | integer | yes | yes | Persisted 1–5 score; never recomputed by Audience. |
| `cluster.clusterId` | Behavioral Cluster | integer | yes | yes | Meaningful only with the resolved `cluster.modelVersion`; definitions must pin/require model version. |
| `cluster.modelVersion` | Behavioral Cluster | string | yes | yes | Actual model identity; prevents retraining from silently changing a saved rule. |
| `cluster.label` | Behavioral Cluster | string | yes | no | Read-model interpretation label is human-readable and interpretation-version dependent; preview-only in v1. |
| `cluster.interpretationVersion` | Behavioral Cluster | string | yes | no | Preserved for explanation, not a v1 filter field. |
| `clv.expectedRevenueTaxIncl` | CLV | decimal string | yes | yes | Expected future tax-inclusive CLP revenue over the fixed 12-month horizon. |
| `clv.estimateSupportLevel` | CLV | string | yes | yes | Actual field name; values `SPARSE` or `SUPPORTED`. No invented `supportClass` field. |
| `clv.expectedOrders` | CLV | decimal string | yes | yes | Optional expected order count; null/missing when not published by the row. |
| `commercial.validOrders` | Customer Analytics | integer | no | yes | Feature snapshot Population B lifetime valid orders. |
| `commercial.totalSpentTaxIncl` | Customer Analytics | decimal string | no | yes | Feature snapshot lifetime tax-inclusive order value. |
| `commercial.averageOrderValueTaxIncl` | Customer Analytics | decimal string | no | yes | Derived feature snapshot value. |
| `commercial.firstOrderAt` | Customer Analytics | datetime | no | yes | Earliest valid order timestamp. |
| `commercial.lastOrderAt` | Customer Analytics | datetime | no | yes | Latest valid order timestamp. |
| `commercial.daysSinceLastOrder` | Customer Analytics | integer | no | yes | Whole days from feature snapshot reference time to last valid order. |
| `commercial.customerTenureDays` | Customer Analytics | integer | no | yes | Whole days from account creation to feature snapshot reference time. |
| `commercial.distinctProducts` | Customer Analytics | integer | no | yes | Distinct products across valid orders. |
| `commercial.repeatProductRate` | Customer Analytics | decimal string | no | yes | Product-level repeat rate. |
| `commercial.top1Share` | Customer Analytics | decimal string | no | yes | Product-level spend concentration share. |
| `commercial.top3Share` | Customer Analytics | decimal string | no | yes | Product-level spend concentration share. |
| `commercial.effectiveDiversity` | Customer Analytics | decimal string | no | yes | Inverse HHI; unbounded above. |
| `commercial.averageUnitsPerOrder` | Customer Analytics | decimal string | no | yes | Total units divided by valid orders. |
| `commercial.purchaseFrequencyDays` | Customer Analytics | decimal string | yes | yes | Null when `validOrders < 2`; null is not zero. |
| `commercial.orders365d` | Customer Analytics | integer | no | yes | Valid orders in the feature snapshot's 365-day window. |
| `commercial.cancelledOrderRatio` | Customer Analytics | decimal string | no | yes | Cancelled/all orders ratio. |
| `commercial.discountShare` | Customer Analytics | decimal string | no | yes | Order-level discount share. |
| `commercial.shippingShare` | Customer Analytics | decimal string | no | yes | Order-level shipping share. |

`customer.customerId` is retained as an internal identity/read projection but is not a normal
commercial filter in v1. Audience membership is already the population of customer ids; allowing
arbitrary id lists would be a debugging feature, not an audience semantic.

Affinity fields are represented by `HAS_AFFINITY`, not added to the scalar field registry. Its
qualifiers map exactly to `CustomerCommercialAffinityRow`: `affinityAxis`, `affinityCode`,
`score`, `supportingOrderCount`, `supportingProductCount`, `supportingSpend`,
`lastEvidenceAt`, and `explicitEvidenceCoverage`.

## 5. Filter grammar and operators

Scalar conditions support the following uppercase operators where their type permits:

`EQ`, `NEQ`, `IN`, `NOT_IN`, `GT`, `GTE`, `LT`, `LTE`, `BETWEEN`, `IS_NULL`, `IS_NOT_NULL`.

Type rules are intentionally the same shape as the existing analytical query registry:

| Type | Operators |
|---|---|
| integer | all operators, with integer values |
| decimal string | equality, membership, comparison, between, null tests; exact decimal values |
| string | `EQ`, `NEQ`, `IN`, `NOT_IN`, null tests |
| datetime | equality, comparisons, between, null tests; absolute ISO timestamps |

`IS_NULL` and `IS_NOT_NULL` have no `value`. All other operators have exactly the value arity
required by the operator. `BETWEEN` has two ordered bounds. `IN` and `NOT_IN` require a non-empty
array. Null is never a substitute value for `EQ`, `NEQ`, `IN`, or `NOT_IN`; callers must use an
explicit null test.

Boolean semantics are three-valued at the leaf level:

```text
AND: FALSE dominates; TRUE only when every child is TRUE; otherwise UNKNOWN
OR:  TRUE dominates; FALSE only when every child is FALSE; otherwise UNKNOWN
NOT:  NOT TRUE = FALSE, NOT FALSE = TRUE, NOT UNKNOWN = UNKNOWN
```

An audience includes a customer only when the root evaluates to `TRUE`. `UNKNOWN` is retained in
diagnostics and is never silently converted to either a match or a false fact.

### Affinity choice

Recommend option A: `HAS_AFFINITY`, with the exact shape above. It is more usable and safer than
exposing a generic relational condition over normalized rows because it makes the existential
semantics explicit, prevents row multiplication in boolean combinations, and provides one place
to enforce affinity-specific null and evidence rules.

The condition is true when one normalized row matches the axis, code, and every supplied
qualifier. It is not a probability query and it does not aggregate or compare a synthetic global
affinity score.

## 6. Availability, absence, and missing-data semantics

The distinction is normative:

| State | Meaning | Scalar condition result |
|---|---|---|
| Matching row/value | Evidence exists in the selected snapshot | normal operator semantics |
| Component published, customer row absent | Customer is outside that component population | `UNKNOWN` |
| Component snapshot absent/unreadable/malformed | No trustworthy component value exists for the evaluation | whole evaluation blocked if the rule depends on it |
| Actual nullable value | The component row exists and explicitly stores null | `IS_NULL` true; other comparisons unknown |
| Numeric zero | Actual stored zero | normal numeric semantics; never missing |

For the final population result, only `TRUE` is included. Thus customer-level absence behaves as
non-membership in the returned set, but it remains observably `UNKNOWN`, with a reason such as
`RFM_NOT_IN_POPULATION` or `AFFINITY_NOT_IN_POPULATION`. This is preferable to claiming that an
unmatched customer is known not to satisfy an analytical condition.

If a rule depends on RFM, cluster, CLV, or affinity and that component is `UNAVAILABLE` for the
resolved context, the evaluator returns `status: 'blocked'` and no membership set. It does not
return an empty audience. A broken dependency and a valid empty result are different outcomes.

Feature population failure also blocks every evaluation because the feature snapshot is the v1
population authority.

### Affinity-specific cases

| Case | v1 meaning |
|---|---|
| Customer has a matching affinity row | Evaluate qualifiers normally. `score = 0` is a real value. |
| Customer has affinity rows, but not the requested code | Known `FALSE` for that `HAS_AFFINITY` condition. |
| Customer has no affinity rows | `UNKNOWN`/`NOT_IN_POPULATION` with the current row-only contract. A01 must add eligible-customer membership to make the distinction definitive. |
| Affinity snapshot exists but customer is `NOT_IN_POPULATION` | `UNKNOWN`, never a fabricated zero or false evidence claim. |
| Affinity component `UNAVAILABLE` | Block the evaluation if referenced. |
| Score is missing on a purported row | Malformed snapshot; component unavailable and evaluation blocked. |
| `explicitEvidenceCoverage = null` | A `minExplicitEvidenceCoverage` qualifier is `UNKNOWN`; null is neither 0 nor 1. Without that qualifier, the nullable field does not affect the match. |
| `PARTIALLY_CLASSIFIED` source evidence | Valid evidence on explicitly populated axes. Unresolved axes produce no rows; they do not produce zero-valued rows. |
| `OTHER` source evidence | No `PRODUCT_FAMILY` evidence; `DISCIPLINE` and `USE_CONTEXT` tags remain eligible under the current affinity policy. |
| `EXCLUDED_NON_PRODUCT` evidence | Contributes no affinity evidence. Its spend/count diagnostics remain snapshot provenance and are not converted into negative evidence or zero affinity. |

For example, `USE_CONTEXT/HOME_GYM >= 0.30` is `TRUE` for a matching row with score `0.30`,
`FALSE` for a known eligible customer with a different code, `UNKNOWN` for a customer outside the
affinity population, and evaluation-blocking when the affinity snapshot itself is unavailable.

There is no v1 “customer is missing from component” filter. `IS_NULL` on an analytical field tests
an explicit nullable value in an existing row; it is not an availability predicate.

## 7. Population universe

### AUDIENCE_BASE_POPULATION_POLICY

`Customer Analytics Population B`: all PrestaShop customers with at least one lifetime valid
order before the feature snapshot `referenceTime`, excluding the configured operational accounts,
under `customer-analytics-population-b-v1` and `operational-account-exclusion-v1`.

The feature snapshot is the sole population authority. The live audit recorded approximately
44,935 customers, with small differences across runs at different reference times. The exact
population size and checksum come from the selected feature snapshot, not from a live count at
evaluation time.

Implications:

- Registered customers with no valid purchase are intentionally outside Audience v1.
- Customers with one valid order remain eligible; this is why the audience base is broader than
  the clustering B-prime population.
- RFM and clustering are subsets and may return `NOT_IN_POPULATION` for base customers.
- CLV currently targets a valid-order population and should normally overlap Population B, but
  its own snapshot population remains authoritative for CLV availability.
- Affinity can be narrower because it requires eligible semantic purchase evidence; it must not
  widen or redefine the Audience universe.
- Future contactability is a projection over this membership, not a replacement population.

This policy gives reproducibility, includes one-time buyers, avoids empty vectors for never-buyers,
and provides one stable base for future CRM/Copilot/Explorer consumers.

## 8. Snapshot lineage and context resolution

The current `createCustomerIntelligenceContextResolvers` already uses the correct anchor for
feature/RFM/cluster composition:

1. Select the requested feature snapshot, or explicitly select the current published feature
   snapshot for an interactive operation.
2. Use its `referenceTime` as the anchor.
3. Select the latest published RFM snapshot with `referenceTime <= feature.referenceTime`.
4. Select the latest published cluster snapshot with `referenceTime <= feature.referenceTime`.

Audience v1 extends the same policy to CLV and affinity:

`component.referenceTime <= feature.referenceTime`, then latest by reference time, with a stable
snapshot-id tie-break. Every selected snapshot must be `published`, and component metadata must
match the expected identity authority and contract version.

The evaluator must not independently take “latest RFM”, “latest cluster”, “active CLV”, and
“active affinity”. That would create a temporally incoherent audience. The current CLV active-only
reader and affinity active-only reader are therefore A01 integration debt, not acceptable final
lineage behavior.

`AudienceEvaluationContextV1.referenceTime` is the feature anchor and is always explicit in a
reproducible evaluation. A convenience “current” operation may resolve the latest published
feature snapshot once, then pins its reference time and complete lineage for the evaluation. A
future R3 brain may request a preview limit and logical definition, but not replace this pinned
context.

The result preserves, at minimum, each component's snapshot id, reference time, version/policy
identifiers, model/segment/calculation versions, dataset/output checksums when available, and
affinity ontology/product-semantic lineage. `evaluatedAt` is an audit timestamp and is never used
to select data.

## 9. Temporal semantics

Audience definitions should be stable logical rules over snapshot fields:

- `rfm.recencyDays GTE 180` is supported and means the persisted whole-day RFM value at the
  selected RFM snapshot reference time.
- `commercial.daysSinceLastOrder GTE 180` means the feature snapshot's persisted value at the
  feature anchor.
- `HAS_AFFINITY.lastEvidenceAt` uses an absolute UTC ISO timestamp in v1.
- Relative phrases such as “last evidence older than six months” are not stored in a definition.

If a future release adds relative temporal predicates, they must evaluate against the pinned
`AudienceEvaluationContextV1.referenceTime`, never the wall clock. A saved definition therefore
retains one meaning for a given lineage even when evaluated later.

RFM recency naturally changes as the reference time changes. That is expected temporal semantics,
not nondeterminism. RFM segment/code boundaries and cluster labels are additionally protected by
snapshot, calculation/model, segment, and interpretation lineage.

## 10. Determinism and canonicalization

### AUDIENCE_DEFINITION_VERSION

`customer-intelligence-audience-definition-v1`

### AUDIENCE_DEFINITION_HASH

`sha256:<64 lowercase hexadecimal characters>` over the canonical logical definition, using the
repository's existing stable object-key serialization/checksum convention. The hash excludes
evaluation timestamps, resolved snapshot ids, preview limits, SQL, and display-only names.

Canonicalization rules:

- Object keys serialize in lexical order.
- Field ids and operators use the exact uppercase contract spelling; no case folding is applied to
  semantic values.
- `AND` and `OR` children are recursively canonicalized and sorted by canonical serialization.
- Exact duplicate children inside the same `AND` or `OR` are removed; this is safe idempotence,
  not general theorem proving.
- `IN` and `NOT_IN` values are recursively canonicalized and sorted by type-aware canonical
  value representation; duplicate values are removed.
- Numeric integers are safe integers. Decimal values use canonical non-exponent decimal strings:
  leading zeroes are removed, trailing fractional zeroes are removed, and zero is represented as
  `0`.
- `BETWEEN` bounds preserve lower/upper order and reject inverted bounds.
- Affinity codes are trimmed and remain case-sensitive opaque ontology codes. Axis values are a
  closed uppercase union.
- `NOT` has one child and is never reordered.
- No attempt is made to prove equivalence such as distributivity, De Morgan transformations, or
  contradictory predicates.

Consequently, omitted defaults and safely reorderable equivalent input produce the same hash;
different field values, bounds, lineage requirements, or boolean structure do not silently
collapse into one definition.

## 11. Result and member contracts

Recommended result shape:

```ts
type AudienceEvaluationResultV1 =
  | {
      readonly status: 'completed';
      readonly resultVersion: 'customer-intelligence-audience-evaluation-v1';
      readonly definitionVersion: typeof AUDIENCE_DEFINITION_VERSION;
      readonly definitionHash: string;
      readonly evaluationId: string | null;
      readonly evaluatedAt: string;
      readonly referenceTime: string;
      readonly populationUniverseCount: number;
      readonly matchedCount: number;
      readonly unknownCount: number;
      readonly returnedCount: number;
      readonly members: readonly AudienceMemberV1[];
      readonly truncated: boolean;
      readonly context: AudienceEvaluationContextV1;
      readonly componentAvailability: AudienceAvailabilityV1;
      readonly durationMs: number;
      readonly warnings: readonly string[];
      readonly canonicalDefinition: AudienceDefinitionV1;
    }
  | {
      readonly status: 'blocked';
      readonly resultVersion: 'customer-intelligence-audience-evaluation-v1';
      readonly definitionVersion: typeof AUDIENCE_DEFINITION_VERSION;
      readonly definitionHash: string;
      readonly evaluationId: string | null;
      readonly evaluatedAt: string;
      readonly referenceTime: string;
      readonly context: AudienceEvaluationContextV1 | null;
      readonly componentAvailability: AudienceAvailabilityV1;
      readonly blockingComponents: readonly string[];
      readonly warnings: readonly string[];
    };

type AudienceMemberV1 = { readonly customerId: number };
```

`matchedCount` is the complete count of `TRUE` customers in the base population. `returnedCount`
is the number of member rows returned after the preview/consumer limit. `truncated` is true when
the returned projection is smaller than the full matched set. A completed empty audience has
`matchedCount = 0`, `returnedCount = 0`, and `truncated = false`.

The minimal membership contract contains only `customerId`. A member is not a duplicate Customer
Commercial Profile and does not carry RFM, CLV, cluster, or affinity blobs. An optional, on-demand
`AudienceMemberPreviewV1` may include bounded condition outcomes and component state for CRM
preview/debugging, but it is a projection, not the membership identity.

## 12. Explainability

Every membership must be explainable without storing a large evidence blob for every customer.
The recommended strategy is:

- evaluate the logical tree against the same pinned context;
- on demand, return a bounded condition trace (`TRUE`/`FALSE`/`UNKNOWN` plus field/component
  state);
- for affinity, optionally retrieve a bounded top-N evidence sidecar using the existing affinity
  evidence shape and snapshot lineage;
- for scalar fields, show the actual persisted value and source snapshot reference only in the
  preview projection.

The default stored membership is only the id. Explanations are derived from the immutable
evaluation context and are not persisted in A00. If later persisted, the explanation must carry
its own contract/version/checksum and remain bounded; it must never change membership.

## 13. Validation limits

Reuse the existing analytical-query guardrails where they fit:

| Limit | Recommended v1 value | Reason |
|---|---:|---|
| `MAX_FILTER_DEPTH` | 5 | Same bounded nesting already used by the analytical query validator. |
| `MAX_CONDITIONS` | 20 | Same maximum filter leaves; enough for explicit commercial definitions. |
| `MAX_IN_VALUES` | 500 | Same bounded membership list limit. |
| `MAX_PREVIEW_RETURNED_MEMBERS` | 1,000 | Same result-row ceiling; does not cap evaluation. |
| `MAX_AFFINITY_CONDITIONS` | 20 included in total | No separate expansion surface is needed. |
| Empty `AND`/`OR` | reject | Avoid vacuous truth/falsehood surprises in user-authored JSON. |

The validator rejects unknown fields, incompatible operators, invalid integer/decimal/datetime
shapes, null values used with non-null operators, invalid `BETWEEN`, empty/oversized `IN`, bad
affinity axis/code syntax, malformed tree nodes, excessive depth/conditions, and invalid UTC
reference times. Limits are hard rejections, never silent clamping.

`UNKNOWN_AFFINITY_CODE` is emitted only when the resolved versioned affinity code registry says a
code is not part of that ontology contract. Until such a registry is available, A00 can validate
only that the code is a non-empty opaque string; it must not call a live catalog endpoint or copy
the catalog ontology into this repository.

## 14. Product ontology boundary

Catalog-service owns product semantics. Customer Profile consumes normalized semantic facts and
persists affinity lineage; it does not own the tag ontology.

The v1 validation mechanism is:

1. validate axis against the small cross-service union
   `PRODUCT_FAMILY | DISCIPLINE | USE_CONTEXT`;
2. validate code syntax locally as a non-empty, case-sensitive opaque string;
3. when available, validate code membership against an immutable, versioned code-set contract
   associated with the selected Product Semantic Snapshot/affinity snapshot;
4. preserve `productSemanticSnapshotId`, schema version, `ontologyVersion`, `ontologyHash`, and
   checksums in affinity lineage.

The code set may be delivered as snapshot metadata or as a separately checksummed catalog-owned
semantic contract consumed by Customer Profile. It must not be a copied static enum and must not
be resolved from “whatever the catalog says now”.

The current repository has the ontology version/hash and observed affinity rows, but not a
complete persisted code set. That is the A01 open decision described in the executive verdict.

## 15. RFM, CLV, and behavioral-cluster semantics

### RFM

`segmentCode` is the preferred named business predicate when the intended meaning is a published
commercial segment, for example `AT_RISK_HIGH_VALUE`. Manual predicates such as
`recencyDays GTE 180 AND grossOrderValueTaxIncl GTE 500000` are also supported, but they mean raw
thresholds, not the segment definition.

Both forms preserve the selected RFM snapshot and `calculationVersion`. Segment definitions must
also carry/require `segmentVersion`; a future segment-version change must not silently alter a
saved audience. If the customer has no RFM row, RFM conditions are `UNKNOWN`, not false data.

### CLV

The actual v1 field is `expectedRevenueTaxIncl`, in CLP, over the fixed 12-month horizon. It means
expected future tax-inclusive revenue produced by the persisted CLV model. `estimateSupportLevel`
is evidence about estimate support (`SPARSE` or `SUPPORTED`), not a probability or customer class.

Allowed examples include:

- `clv.expectedRevenueTaxIncl GTE "500000"`
- `clv.estimateSupportLevel EQ "SUPPORTED"`

Audience must not reinterpret CLV as budget, maximum spend, profitability, margin, willingness to
pay, discount allowance, or marketing cost capacity. Such policies belong to later decision layers.

### Behavioral Cluster

The stable filter identity is `(cluster.modelVersion, cluster.clusterId)`. `clusterId` alone is
invalid as a saved semantic rule because ids are model-scoped. `cluster.label` is retained for
preview only because the current read model chooses the latest interpretation for a model/cluster;
labels can change under a new interpretation version without changing the assignment.

Cluster distance remains numeric model geometry. It is not a membership probability and is not
converted into a confidence or global audience score.

## 16. Future contactability boundary

Audience membership is intentionally separate from contactability, channel eligibility, and
campaign export:

```text
matched audience       = 1,000
email address present  =   920
email campaign eligible=   850
```

Audience v1 does not silently filter by email/phone presence, consent, suppression, channel, or
deliverability. Those rules belong to a later eligibility layer and must be explicit in their own
versioned contract.

## 17. Future export boundary

The future flow is:

```text
AudienceDefinition
  -> AudienceEvaluation
  -> immutable AudienceMembership
  -> eligibility/contactability projection
  -> export job
  -> CSV/XLSX/Brevo template
```

Export operates on an immutable evaluation/membership snapshot. It must not re-evaluate a mutable
definition while exporting, because changed snapshots, changed ontology, changed model versions,
or changed contactability data could produce a file that no longer corresponds to the audience the
operator approved.

## 18. Future R3 capability boundary

The future neutral capability id is:

`customer-intelligence.audience.evaluate`

The brain may control:

- the logical `AudienceDefinitionV1` tree;
- a bounded preview limit.

The brain must never control:

- resolved snapshot ids;
- the authoritative reference time once the session/evaluation is pinned;
- SQL or physical table/column expressions;
- persistence identity or evaluation ids;
- contactability overrides;
- export authorization.

The capability receives structured definitions and returns structured validation/evaluation
results. LLM output is never treated as SQL and never bypasses the deterministic validator.

## 19. Runtime and SQL feasibility audit

The eventual evaluator is feasible for the expected approximately 45k-customer population, but it
must use a fixed, bounded relational plan.

Recommended execution shape:

1. Resolve and validate one complete context.
2. Use the feature snapshot row set as the base population.
3. `LEFT JOIN` one selected RFM, cluster, and CLV row set by snapshot/customer identity so
   customer-level absence remains observable.
4. Compile each `HAS_AFFINITY` as a correlated `EXISTS` predicate over the selected normalized
   affinity snapshot. Do not join raw affinity rows into the base query for boolean evaluation.
5. Evaluate the count and member projection using the same predicate/context. Use keyset paging
   for returned ids, not unbounded in-memory materialization.
6. Fetch bounded explanation/evidence in separate batch reads only when requested.

This avoids N+1 evaluation and avoids affinity row explosion when a customer has multiple axes,
codes, or OR branches. Boolean combinations can still be compiled safely because all SQL shape is
fixed by a local field registry and all values are bound parameters. No definition can introduce a
table, join, expression, or SQL fragment.

Current useful indexes found in migrations:

- feature rows: unique `(snapshot_id, prestashop_customer_id)`;
- RFM rows: unique `(snapshot_id, prestashop_customer_id)`, plus `(snapshot_id, rfm_code)`,
  `(snapshot_id, segment_code)`, and score index;
- cluster rows: unique `(snapshot_id, prestashop_customer_id)` and `(snapshot_id, cluster_id)`;
- CLV rows: unique `(snapshot_id, customer_id)`;
- affinity rows: unique `(snapshot_id, customer_id, affinity_axis, affinity_code)`,
  `(snapshot_id, customer_id)`, and `(snapshot_id, affinity_axis, affinity_code)`;
- snapshot headers: published/reference-time indexes for each component.

Likely follow-up index work, to be measured with `EXPLAIN` rather than added in A00:

- feature `(snapshot_id, <frequently filtered scalar>)` indexes for high-volume range predicates;
- RFM `(snapshot_id, recency_days)`, `(snapshot_id, frequency_orders)`, and possibly
  `(snapshot_id, gross_order_value_tax_incl)` for raw-threshold audiences;
- cluster `(snapshot_id, model-scoped cluster_id)` is already present; model identity should be
  resolved from the header/model join;
- CLV `(snapshot_id, expected_revenue_tax_incl, estimate_support_level)` if CLV thresholds are
  common;
- affinity composite indexes beginning `(snapshot_id, affinity_axis, affinity_code, score)` and
  additional qualifier indexes only if measured workloads justify them.

The primary risk is not the 45k base size; it is accidental row multiplication, repeated
per-customer reads, or independent snapshot selection. A01 should capture query plans and latency
on the target MariaDB before choosing additional indexes.

## 20. Persistence design preview

No migration is created by A00.

### `audience_definition`

- Identity: logical audience id plus immutable definition version, or a content-addressed
  definition hash.
- Lifecycle: a named pointer may be active/archived, but each definition version is immutable.
- Versioning: `definitionVersion`, canonical JSON, `definitionHash`.
- Mutable fields: display name/description only, excluded from the semantic hash.
- Checksum: hash of canonical logical definition.

### `audience_evaluation`

- Identity: immutable evaluation id.
- Inputs: definition id/version/hash, pinned `referenceTime`, complete context lineage.
- Outputs: status, population count, matched/unknown counts, returned count, truncation, warnings,
  duration, availability, and result checksum.
- Lifecycle: `completed` or `blocked`; never updated to change a completed membership set.
- Retention: retain as long as downstream exports/campaign audits need the result.

### `audience_membership`

- Identity: `(evaluation_id, customer_id)`.
- Mutability: immutable; a new evaluation creates a new set.
- Contents: customer id only in v1, with a unique key per evaluation/customer.
- Checksum: deterministic ordered customer-id checksum on the evaluation.

For approximately 45k customers, use rows as the initial storage choice. Rows are straightforward
to count, page, join to a later contactability projection, and audit. A compressed artifact can be
added later as a cache, but it must not replace queryable rows until operational requirements prove
that trade-off. A hybrid row-plus-artifact design is therefore optional optimization, not the A00
contract.

## 21. Contract examples

These are contract examples only, not business recommendations. Decimal monetary/score values are
shown as canonical decimal strings.

### 1. High-value at-risk

```json
{
  "definitionVersion": "customer-intelligence-audience-definition-v1",
  "root": {"kind":"SCALAR","field":"rfm.segmentCode","operator":"EQ","value":"AT_RISK_HIGH_VALUE"}
}
```

### 2. Home-gym affinity

```json
{
  "definitionVersion": "customer-intelligence-audience-definition-v1",
  "root": {"kind":"HAS_AFFINITY","axis":"USE_CONTEXT","code":"HOME_GYM","minScore":"0.30"}
}
```

### 3. Commercial-gym affinity

```json
{
  "definitionVersion": "customer-intelligence-audience-definition-v1",
  "root": {"kind":"HAS_AFFINITY","axis":"USE_CONTEXT","code":"COMMERCIAL_GYM","minScore":"0.30"}
}
```

### 4. HYROX affinity

```json
{
  "definitionVersion": "customer-intelligence-audience-definition-v1",
  "root": {"kind":"HAS_AFFINITY","axis":"DISCIPLINE","code":"HYROX","minScore":"0.30"}
}
```

### 5. Dormant repeat buyers

```json
{
  "definitionVersion": "customer-intelligence-audience-definition-v1",
  "root":{"kind":"AND","children":[
    {"kind":"SCALAR","field":"commercial.validOrders","operator":"GTE","value":2},
    {"kind":"SCALAR","field":"commercial.daysSinceLastOrder","operator":"GTE","value":365}
  ]}
}
```

### 6. CLV-supported high future value

```json
{
  "definitionVersion": "customer-intelligence-audience-definition-v1",
  "root":{"kind":"AND","children":[
    {"kind":"SCALAR","field":"clv.expectedRevenueTaxIncl","operator":"GTE","value":"500000"},
    {"kind":"SCALAR","field":"clv.estimateSupportLevel","operator":"EQ","value":"SUPPORTED"}
  ]}
}
```

### 7. RFM + affinity

```json
{
  "definitionVersion": "customer-intelligence-audience-definition-v1",
  "root":{"kind":"AND","children":[
    {"kind":"SCALAR","field":"rfm.segmentCode","operator":"EQ","value":"AT_RISK_HIGH_VALUE"},
    {"kind":"HAS_AFFINITY","axis":"USE_CONTEXT","code":"HOME_GYM","minScore":"0.30"}
  ]}
}
```

### 8. Cluster + affinity

```json
{
  "definitionVersion": "customer-intelligence-audience-definition-v1",
  "root":{"kind":"AND","children":[
    {"kind":"SCALAR","field":"cluster.modelVersion","operator":"EQ","value":"behavioral-kmeans-k4-v1"},
    {"kind":"SCALAR","field":"cluster.clusterId","operator":"EQ","value":2},
    {"kind":"HAS_AFFINITY","axis":"DISCIPLINE","code":"STRENGTH","minScore":"0.30"}
  ]}
}
```

### 9. Multi-affinity OR

```json
{
  "definitionVersion": "customer-intelligence-audience-definition-v1",
  "root":{"kind":"OR","children":[
    {"kind":"HAS_AFFINITY","axis":"USE_CONTEXT","code":"HOME_GYM","minScore":"0.30"},
    {"kind":"HAS_AFFINITY","axis":"USE_CONTEXT","code":"COMMERCIAL_GYM","minScore":"0.30"},
    {"kind":"HAS_AFFINITY","axis":"DISCIPLINE","code":"HYROX","minScore":"0.30"}
  ]}
}
```

### 10. Raw RFM threshold definition

```json
{
  "definitionVersion": "customer-intelligence-audience-definition-v1",
  "root":{"kind":"AND","children":[
    {"kind":"SCALAR","field":"rfm.recencyDays","operator":"LTE","value":180},
    {"kind":"SCALAR","field":"rfm.frequencyOrders","operator":"GTE","value":2},
    {"kind":"SCALAR","field":"rfm.grossOrderValueTaxIncl","operator":"GTE","value":"300000"}
  ]}
}
```

An explicit “customers not in RFM population” audience is not supported in v1. `rfm.* IS_NULL`
tests explicit nullable values in a present row and does not mean component absence. This avoids
turning missing data into a targetable audience by accident.

## 22. Anti-patterns prohibited by this contract

- LLM-generated SQL or physical SQL fragments in an audience definition.
- A synthetic global audience/affinity/interest score.
- Treating affinity score as a probability.
- Treating missing, absent, or unavailable data as zero.
- Selecting independently pinned “latest” snapshots.
- Customer Profile N+1 evaluation.
- Copying Catalog ontology ownership into Customer Profile.
- Embedding contactability, consent, or channel eligibility into membership.
- Exporting directly from a mutable, unmaterialized definition.
- Allowing a model or brain to control resolved snapshot ids or an authoritative pinned reference
  time.

## 23. Risks and debt

| Risk/debt | Impact | Required treatment |
|---|---|---|
| Affinity no-row ambiguity | Cannot distinguish no qualifying affinity from outside affinity eligible population. | Add immutable eligible-customer membership/coverage lookup in A01. |
| No unified CLV/affinity temporal resolver | Current active-only reads can mix time contexts. | Extend feature-anchor selection to all components. |
| Raw RFM fields absent from `CustomerIntelligenceRow` | `recencyDays`/`frequencyOrders`/`grossOrderValueTaxIncl` need an audience adapter. | Add a fixed audience read projection; do not rename them silently. |
| No complete affinity code registry in snapshot metadata | “Unknown code” cannot be distinguished from a valid code with no observed customers. | Consume a versioned code set/checksum from the semantic snapshot contract. |
| RFM segment/cluster interpretation drift | Saved labels could silently change meaning. | Pin segment/model/interpretation lineage and validate it at evaluation. |
| Missing target MariaDB `EXPLAIN` evidence | Index recommendations are provisional. | Measure representative AND/OR/EXISTS queries in A01. |
| Feature source drift | A feature snapshot can be immutable while source data changes retroactively. | Keep the snapshot checksum/lineage; never rebuild an evaluation against live source rows. |

## 24. Recommended A01 implementation slice

`CUSTOMER-INTELLIGENCE-AUDIENCE-A01` should implement only the following first slice:

1. Add pure v1 contracts, validator, canonicalizer, and definition hash.
2. Add a versioned field registry for the scalar fields in this document.
3. Add the feature-anchored resolver for RFM, cluster, CLV, and affinity, including complete
   lineage and explicit component availability.
4. Add an audience reader port that exposes customer-level component presence separately from
   component-level availability, especially for affinity.
5. Add a fixed, parameterized evaluator using one bounded count path and keyset-paged member path;
   use affinity `EXISTS` semantics.
6. Add completed/blocked result contracts, `matchedCount` versus `returnedCount`, unknown counts,
   warnings, and bounded on-demand explanations.
7. Add focused unit tests for canonicalization, three-valued boolean logic, every availability
   state, affinity edge cases, validation limits, and lineage pinning.
8. Add SQL-shape/`EXPLAIN` tests or a target-environment smoke before any index migration is
   proposed.

Persistence, HTTP, exports, contactability, Brevo, and R3 capability wiring should remain later
 slices after the pure evaluator contract is proven.

## 25. Final report

```text
PRIMARY_VERDICT:
AUDIENCE_DOMAIN_READY_WITH_OPEN_DECISIONS

AUDIENCE_BASE_POPULATION_POLICY:
Customer Analytics Population B — customer-analytics-population-b-v1:
>=1 lifetime valid order before the feature snapshot referenceTime, operational accounts excluded,
identity authority prestashop_customer.

AUDIENCE_DEFINITION_VERSION:
customer-intelligence-audience-definition-v1

SUPPORTED_COMPONENTS_V1:
Customer Analytics commercial feature snapshot; RFM; Behavioral Cluster; CLV; Commercial Affinity
via HAS_AFFINITY.

FILTER_MODEL:
AND/OR/NOT; scalar EQ/NEQ/IN/NOT_IN/GT/GTE/LT/LTE/BETWEEN/IS_NULL/IS_NOT_NULL;
dedicated existential HAS_AFFINITY.

AFFINITY_MODEL:
HAS_AFFINITY over normalized (customerId, affinityAxis, affinityCode) rows with optional
score/order/product/spend/evidence-coverage/absolute-lastEvidenceAt qualifiers.

MISSING_DATA_SEMANTICS:
Three-valued logic. Customer/component row absence is UNKNOWN and excluded from the completed
membership set; explicit null is testable with null operators; zero remains zero.

COMPONENT_UNAVAILABLE_SEMANTICS:
Fail closed at evaluation level: block the whole audience when a referenced component is
unavailable/malformed or has no resolved compatible snapshot. Do not return an empty audience.

SNAPSHOT_LINEAGE_POLICY:
Feature snapshot is the anchor. Select each published component snapshot with referenceTime <=
feature.referenceTime, latest with deterministic tie-break; preserve complete ids, versions,
policies, checksums, and affinity ontology lineage.

DEFINITION_CANONICALIZATION:
Stable canonical JSON; sorted object keys, AND/OR children and IN values; safe duplicate removal;
canonical decimal strings; SHA-256 hash; no theorem-equivalence rewriting.

MEMBER_CONTRACT:
AudienceMemberV1 = { customerId }. Explanations are bounded, on-demand projections.

CONTACTABILITY_BOUNDARY:
Separate from membership; no silent email/phone/consent/channel filtering.

EXPORT_BOUNDARY:
Export only from an immutable evaluation/membership snapshot through a later eligibility layer.

FUTURE_CAPABILITY_ID:
customer-intelligence.audience.evaluate

SQL_FEASIBILITY:
Feasible for ~45k base customers with fixed joins, affinity EXISTS predicates, one count path,
keyset-paged member reads, and no N+1. Existing indexes are adequate for identity/code lookups;
raw scalar range indexes should be measured in A01.

PERSISTENCE_PREVIEW:
Immutable versioned audience_definition, immutable audience_evaluation, and row-based immutable
audience_membership keyed by evaluation/customer. Rows are preferred initially; compressed artifacts
are optional later.

OPEN_DECISIONS:
Unified temporal resolution for CLV/affinity; affinity eligible-customer membership; complete
versioned affinity code registry; fixed audience adapter for raw RFM fields; target-MariaDB EXPLAIN
and index measurements.

PROPOSED_NEXT_RELEASE:
CUSTOMER-INTELLIGENCE-AUDIENCE-A01

FILES_CREATED:
docs/design/CUSTOMER-INTELLIGENCE-AUDIENCE-A00-domain-semantic-design.md

FILES_MODIFIED:
none

TESTS_RUN:
none — design-only task; no validation helpers were added.

DECISION:
CUSTOMER_INTELLIGENCE_AUDIENCE_DOMAIN_DESIGNED
```
