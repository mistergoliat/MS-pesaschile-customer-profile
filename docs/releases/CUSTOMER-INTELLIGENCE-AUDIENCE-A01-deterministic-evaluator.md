# CUSTOMER-INTELLIGENCE-AUDIENCE-A01 — Deterministic Evaluator

Status: **BLOCKED_REQUIRES_MIGRATION**

This release was stopped at A01 Gate 1. No Audience runtime, SQL evaluator, persistence, HTTP
endpoint, integration, or migration was added.

## 1. Pre-flight correction

Repository evidence confirms that `HYROX` is a `DISCIPLINE` code, not a `USE_CONTEXT` code:

- `docs/audits/CUSTOMER-INTELLIGENCE-R2-A00.1-commercial-product-ontology-discovery.md` lists
  HYROX under discipline tags.
- `src/application/product-semantic-snapshot/consumer.ts` preserves `disciplines` and validates
  their axis as `DISCIPLINE`.
- The affinity builder consumes discipline and use-context axes separately.

Corrected in the A00 design document:

```json
{"kind":"HAS_AFFINITY","axis":"DISCIPLINE","code":"HYROX","minScore":"0.30"}
```

Examples 4 and 9 were corrected. No ontology or affinity data was changed.

## 2. Gate 1 result

### AFFINITY_POPULATION_MEMBERSHIP

`BLOCKED_REQUIRES_MIGRATION`

The current persisted affinity model contains:

- `customer_commercial_affinity_snapshot` header counts, including
  `eligible_customer_count`, `customers_with_affinity`, and `customers_without_affinity`;
- `customer_commercial_affinity_snapshot_row` rows only for
  `(snapshot_id, customer_id, affinity_axis, affinity_code)` combinations with evidence.

The header count `customers_without_affinity` is not an identity set. The row table cannot answer
whether a base customer is an eligible affinity customer with no requested code or is outside the
affinity population. The current runtime's no-row mapping to `NOT_IN_POPULATION` is therefore not
sufficient for Audience semantics.

Inferring membership from an affinity row, observed codes, the header count, or a live PrestaShop
query would be incorrect. A live source query would also make an evaluation depend on mutable data
outside the selected snapshot.

### Precise schema change required

Before the evaluator can be implemented, add an immutable snapshot population table conceptually
named `customer_commercial_affinity_snapshot_population`:

```sql
snapshot_id BIGINT UNSIGNED NOT NULL,
customer_id INT UNSIGNED NOT NULL,
PRIMARY KEY (snapshot_id, customer_id),
FOREIGN KEY (snapshot_id)
  REFERENCES customer_commercial_affinity_snapshot(id)
  ON DELETE CASCADE
```

The table must contain one row for every eligible customer, including the 1,913 customers currently
reported as `customers_without_affinity`. It should also have a lookup index beginning with
`(snapshot_id, customer_id)` (the primary key already provides that access path). The existing
header count remains useful as a reconciliation invariant, but is not a substitute for this set.

The migration must validate that the population row count equals `eligible_customer_count`, that
customer ids are positive, and that the population checksum is included in immutable snapshot
lineage. Existing snapshots cannot be made historically exact from the header count alone; they
must be rebuilt/re-published from the original eligible-customer artifact or explicitly remain
unusable for audience evaluation.

No migration was created because the task explicitly requires stopping before creating one.

## 3. Affinity code validation

### AFFINITY_CODE_VALIDATION

`SYNTAX_ONLY_WITH_DOCUMENTED_DEBT`

The Product Semantic Snapshot consumer exposes immutable snapshot identity, schema version,
ontology version/hash, classifier version, source checksum, and normalized consumer checksum. It
does not expose a complete catalog-owned `(axis, code)` registry. The affinity population manifest
contains observed distributions/top codes, but those are not a complete ontology universe and
cannot establish that an unobserved code is invalid.

Therefore A01 may validate the local axis union and non-empty, case-sensitive opaque code syntax,
but must not emit `UNKNOWN_AFFINITY_CODE` based on observed rows or current catalog state. A future
catalog-owned, versioned, checksummed code-set contract is required to resolve that validation
fully. Customer Profile must continue to consume that contract rather than copying the ontology.

## 4. Other Gate 1 findings

### Temporal resolution

The existing Customer Intelligence resolver correctly anchors the feature snapshot and selects
published RFM/cluster snapshots with `referenceTime <= feature.referenceTime`. A01 must add the
same selection policy for CLV and Commercial Affinity, with deterministic snapshot-id tie-breaks.
The current CLV and affinity runtime readers select active/latest snapshots and are not sufficient
for a reproducible Audience context. This resolver was not implemented after the membership gate
blocked the release.

Required future context:

```text
feature anchor
  -> latest published RFM    <= feature.referenceTime
  -> latest published cluster <= feature.referenceTime
  -> latest published CLV     <= feature.referenceTime
  -> latest published affinity<= feature.referenceTime
```

Every selected component must preserve its snapshot id, reference time, version/policy fields,
checksums, and affinity ontology lineage. Future/unpublished/malformed/unreadable components must
be excluded or reported as unavailable according to the typed result contract.

### Raw RFM projection

The repository has the required persisted fields in `RfmSnapshotRow`:

- `recencyDays`
- `frequencyOrders`
- `grossOrderValueTaxIncl`

The current `CustomerIntelligenceRow` projection does not carry these fields, and
`CustomerCommercialProfileRfm` renames them for its own customer-centric contract. A01 must add a
fixed audience bulk/read-model projection using the original RFM names, without N+1 reads or
renaming them to `recency`, `frequency`, or `monetary` in the Audience domain. This was not
implemented because the Gate 1 membership prerequisite was not resolved.

## 5. Contracts and evaluator status

The A00 design defines the exact intended v1 names and versions:

- `AudienceDefinitionV1`
- `AudienceFilterV1`
- `AudienceConditionV1`
- `AudienceFieldIdV1`
- `AudienceScalarOperatorV1`
- `AudienceEvaluationContextV1`
- `AudienceSnapshotLineageV1`
- `AudienceAvailabilityV1`
- `AudienceEvaluationResultV1`
- `AudienceMemberV1`
- `AudienceValidationErrorV1`

They were not added to `src/` in this blocked release. The same applies to the scalar field
registry, hard-bounded validator, canonicalizer/hash, explicit TRUE/FALSE/UNKNOWN evaluator,
fixed SQL compiler, and completed/blocked result implementation.

The intended semantics remain:

- include only root `TRUE` customers;
- preserve `UNKNOWN` and count it exactly;
- block an evaluation when a referenced component is unavailable;
- use `HAS_AFFINITY` with one normalized row satisfying all qualifiers;
- use fixed joins and affinity `EXISTS`, never a raw affinity join that multiplies customers;
- return `customerId` only in the member contract;
- keep preview limits independent from `matchedCount`.

## 6. SQL/EXPLAIN status

No representative `EXPLAIN` was run because no evaluator SQL was implemented and the affinity
population gate is unresolved. The planned evidence set remains:

- feature scalar filter;
- RFM segment filter;
- RFM raw threshold;
- cluster id/model;
- CLV threshold/support;
- one `HAS_AFFINITY`;
- RFM AND affinity;
- multi-affinity OR.

No indexes were added. The existing affinity `(snapshot_id, affinity_axis, affinity_code)` and
`(snapshot_id, customer_id)` indexes remain useful for the future `EXISTS` plan, but range/qualifier
index decisions must wait for measured target-MariaDB plans.

## 7. Tests and quality gates

The A01 focused tests were not added because the required Gate 1 membership contract is blocked.
No Customer Intelligence tests or full repository tests were run for this blocked slice. The only
validation performed after the documentation correction was `git diff --check`.

## 8. Rollback

No runtime rollback is required. The only changes are documentation:

- A00 examples 4 and 9 now use `DISCIPLINE/HYROX`.
- This blocked A01 release note records the gate result and required schema addition.

No database, snapshot, index, or production data was changed.

## 9. A02 readiness

`BLOCKED` for A02 audience consumption until the affinity population table/read contract exists,
historical affinity snapshots are either rebuilt or explicitly excluded, and the temporal resolver
can select all referenced components at-or-before the feature anchor. The A00 domain remains valid;
its open decisions are now narrowed to an explicit migration-backed population-membership contract
and the catalog-owned code-set contract.

## 10. Final report

```text
PRE_FLIGHT_A00_CORRECTIONS:
Corrected A00 examples 4 and 9: HYROX is DISCIPLINE/HYROX, confirmed by repository ontology
evidence. No ontology or affinity data changed.

AFFINITY_POPULATION_MEMBERSHIP:
BLOCKED_REQUIRES_MIGRATION

AFFINITY_CODE_VALIDATION:
SYNTAX_ONLY_WITH_DOCUMENTED_DEBT

TEMPORAL_RESOLUTION:
Not implemented after Gate 1 block. Required policy is feature-anchor plus latest published
component snapshot at-or-before the feature referenceTime for RFM, cluster, CLV, and affinity.

RAW_RFM_PROJECTION:
Not implemented. Required source fields are RfmSnapshotRow.recencyDays, frequencyOrders, and
grossOrderValueTaxIncl in a fixed bulk audience projection.

FILES_CHANGED:
docs/design/CUSTOMER-INTELLIGENCE-AUDIENCE-A00-domain-semantic-design.md
docs/releases/CUSTOMER-INTELLIGENCE-AUDIENCE-A01-deterministic-evaluator.md

CONTRACTS:
Not implemented; names and version strings remain defined by A00.

FIELD_REGISTRY:
Not implemented.

VALIDATION:
Not implemented.

CANONICALIZATION:
Not implemented.

THREE_VALUED_LOGIC:
Not implemented; A00 semantics preserved as the implementation target.

AFFINITY_EVALUATION:
Not implemented; blocked by missing immutable eligible-customer identity set.

SNAPSHOT_LINEAGE:
Not implemented; A01 target is feature-anchored at-or-before resolution for all components.

SQL_EVALUATOR:
Not implemented.

EXPLAIN_RESULTS:
Not run; no evaluator SQL exists in this blocked slice.

PERFORMANCE:
Not measured.

FOCUSED_TESTS:
Not run; tests were not added after the mandatory gate stopped implementation.

CUSTOMER_INTELLIGENCE_TESTS:
Not run.

FULL_TESTS:
Not run.

TYPECHECK:
Not run; no runtime code was changed.

LINT:
Not run; no runtime code was changed.

BUILD:
Not run; no runtime code was changed.

GIT_DIFF_CHECK:
PASSED

PUBLIC_BEHAVIOR_CHANGED:
NO

A02_READINESS:
BLOCKED

DECISION:
BLOCKED
```
