# CUSTOMER-INTELLIGENCE-AUDIENCE-A04.0 — Audience Export + Brevo Projection Contract

Status: `AUDIT_AND_CONTRACT_DESIGN_ONLY`

Decision: `READY` for the core synchronous export contract, with account-specific Brevo custom
attributes explicitly deferred until the Brevo account attribute inventory is available.

This document does not add endpoints, writers, migrations, Brevo calls, persistence, saved
audiences, CRM changes, Catalog changes, Product Semantics changes, or evaluator-semantic changes.

## Executive decision

The current Audience evaluator already has the correct execution model for export authority:

```text
AudienceDefinitionV1
  -> server-side context resolution
  -> one set-based evaluation over Feature Snapshot Population B
  -> TRUE / FALSE / UNKNOWN counts
  -> bounded preview member IDs
  -> bounded analytical preview enrichment
```

The current result is not yet an export contract. In particular, `evaluation.members` is only the
bounded preview list, there is no full-membership result, and no export projection or PII bulk-read
boundary exists.

A04 should add a separate application flow:

```text
AudienceDefinitionV1
  -> AudienceEvaluationContextV1
  -> AudienceMembershipResultV1                 authoritative, complete
  -> AudienceExportPreviewV1                    derived from that result
  -> AudienceExportProjectionV1                 generic or Brevo-specific
  -> CSV / XLSX writer                          server-side only
```

The preview member IDs are never an export input. The export source is the complete TRUE member
set produced by the same authoritative membership resolution.

## CURRENT_AUDIENCE_FLOW

### Runtime path

| Stage | Current implementation | Finding |
|---|---|---|
| Definition contract | `src/domain/customer-intelligence-audience/contracts.ts` — `AudienceDefinitionV1`, `AudienceFilterV1`, `AudienceConditionV1` | Versioned tree; no customer IDs or SQL in the definition. |
| Validation | `src/domain/customer-intelligence-audience/validation.ts` — `validateAudienceDefinition()` | Fixed field registry, operator/type checks, depth/condition/IN bounds, explicit null tests. |
| Canonicalization | `src/domain/customer-intelligence-audience/canonicalization.ts` — `canonicalizeAudienceDefinition()`, `audienceDefinitionChecksum()` | Stable JSON, sorted boolean children/IN values, decimal normalization, SHA-256. |
| Truth evaluation | `src/domain/customer-intelligence-audience/logic.ts` — `evaluateAudienceFilter()` | Three-valued `TRUE` / `FALSE` / `UNKNOWN` logic, including affinity existential semantics. |
| SQL compilation | `src/application/customer-intelligence-audience/compile-audience-sql.ts` — `compileAudienceSql()` | Fixed SELECT-only shape; Feature Snapshot is the base population; values are bound parameters. |
| SQL execution | `src/infrastructure/customer-intelligence-audience/mysql-audience-sql-executor.ts` | Executes one SELECT and normalizes returned truth values. |
| Evaluation orchestration | `src/application/customer-intelligence-audience/evaluate-audience.ts` — `createEvaluateAudience()` | Resolves context, blocks missing referenced components, evaluates all returned rows, counts truths, and truncates only returned TRUE IDs. |
| Context resolution | `src/application/customer-intelligence-audience/context-resolver.ts` — `createAudienceContextResolver()` | Feature snapshot is the anchor; published component headers are selected at or before its reference time. |
| Capability | `src/application/customer-intelligence-audience/capability.ts` | Calls evaluator first, then enriches only `previewMembers`. |
| Preview | `src/application/customer-intelligence-audience/preview.ts` — `createAudiencePreviewEnricher()` | One bounded set-based read for preview IDs; no PII; enrichment degradation cannot alter evaluation counts. |
| HTTP consumer | `src/http/routes/index.ts` — `/v1/customer-intelligence/audiences/evaluate` | Strict request body; only `definition` and bounded `previewLimit`; internal token required. |

### Current analytical reads

The evaluator SQL starts at:

```sql
customer_feature_snapshot_row fr
WHERE fr.snapshot_id = ?
```

It left joins the selected RFM, cluster, and CLV rows by customer identity. `HAS_AFFINITY` uses
correlated `EXISTS` predicates against the selected affinity population and normalized affinity
rows, so affinity rows do not multiply the base population.

The preview reader is
`src/infrastructure/customer-intelligence-audience/mysql-audience-preview-reader.ts`. It reads
commercial feature values, raw RFM values, cluster values, CLV values, and bounded affinity
evidence for the already selected IDs. It does not read `firstname`, `lastname`, `email`, phone,
RUT, address, consent, or channel eligibility.

### Preview execution model

`PREVIEW_EXECUTION_MODEL: FULL_POPULATION_THEN_TRUNCATE`

Evidence:

1. `compileAudienceSql()` has no `LIMIT`; it selects every row in the selected Feature Snapshot.
2. `createEvaluateAudience()` counts every returned SQL row before applying
   `trueIds.slice(0, previewLimit)`.
3. The tests explicitly assert that `previewLimit: 1` leaves `matchedCount: 3` unchanged.
4. `createAudiencePreviewEnricher()` receives only the bounded `previewMembers` IDs.

This conclusion applies to the production SQL evaluator and the pure `evaluateAudienceRows()`
test helper. The current production evaluator is still an in-memory result collector: the SQL
executor returns all rows to application memory, and production runtime does not independently
assert that `rows.length === context.population.populationSize` or that all returned IDs are
unique. The A04 membership resolver must make those completeness checks explicit.

### Current preview limitations relevant to A04

- `AudienceEvaluationResultV1.members` and `previewMembers` contain the same bounded list. The
  name `members` must not be reused as the authoritative export source.
- `populationUniverseCount` is derived from SQL rows, while the context also carries a header
  `populationSize`; the current evaluator does not fail on a mismatch.
- No evaluation or membership checksum includes the full truth state.
- No full-membership persistence, paging port, streaming query port, export projection, or
  bulk PII hydration port exists.
- Preview enrichment can degrade to zero preview rows while evaluation remains completed. This is
  correct preview behavior but cannot be interpreted as an empty audience.

## AUTHORITATIVE_POPULATION_SOURCE

`Customer Analytics Population B`, represented by the selected Feature Snapshot:

```text
universeId = customer-analytics-population-b-v1
identityAuthority = prestashop_customer
base table = customer_feature_snapshot_row
row identity = (snapshot_id, prestashop_customer_id)
```

The population is produced by
`src/infrastructure/prestashop/mysql-customer-feature-reader.ts` and materialized by the
Customer Analytics snapshot flow. Its documented scope is customers with at least one lifetime
valid order before the feature reference time, with operational accounts excluded. The valid-order
policy is `valid = 1`, positive tax-inclusive paid amount, positive customer ID, excluded
operational accounts removed, and `date_add < referenceTime`.

This is the only Audience population definition. A04 must not use CRM population, affinity
population, a browser member list, a live PrestaShop re-query, or a second export-specific
population. A customer may be absent from RFM, cluster, CLV, or affinity component populations;
that is component-level missing data, not exclusion from the Audience universe.

The Feature Snapshot builder sorts by `prestashopCustomerId`, rejects duplicate customers, records
`populationSize`, and verifies the persisted row count and feature dataset checksum. The existing
`featureDatasetChecksum` is a checksum of the complete derived feature dataset, not a separately
named customer-ID-only checksum. A04 must preserve that existing lineage and must validate the
base row count/uniqueness during authoritative resolution; a future context minor version may add
a dedicated population-identity checksum if operational evidence requires it.

## AUTHORITATIVE_MEMBERSHIP_RULE

For every customer in the complete Feature Snapshot population, evaluate the canonical definition
against the resolved context:

```text
TRUE     -> member
FALSE    -> notMatched
UNKNOWN  -> notMatched, and counted separately as unknown
```

`UNKNOWN` is never converted to `FALSE` inside the evaluator, membership resolver, checksum, or
export projection. The export file contains only `TRUE` members. A generic export may report the
unknown count in metadata, but it must not include unknown customers as rows.

Required count invariant:

```text
population = matched + notMatched + unknown
```

Here `notMatched` is the count of root `FALSE` results. A completed membership result is invalid if
the invariant fails, the feature row count differs from the declared population, a customer ID is
duplicated, or any truth value is outside the closed three-valued set. Such a result is an export
failure, not a partial export.

## UNKNOWN_SEMANTICS

The current domain semantics are preserved:

- Missing row from a referenced component population is `UNKNOWN` at customer level.
- An unavailable or unreadable referenced component is a blocked/incomplete evaluation, not a
  population of UNKNOWN customers.
- A stored nullable value can be tested with `IS_NULL`; this is different from a missing row.
- Numeric zero remains a value.
- Boolean composition is Kleene-style: FALSE dominates AND, TRUE dominates OR, and NOT UNKNOWN
  remains UNKNOWN.
- A valid complete evaluation with all customers UNKNOWN is a successful empty membership with a
  non-zero `unknown` count and a warning. It is not the same as an unavailable snapshot.

## IDENTITY_AUTHORITY

Analytical membership identity is `ps_customer.id_customer`, represented internally as
`customerId: number` and externally in a Brevo projection as a string `EXT_ID` candidate.

Evidence:

- `README.md` states that the current runtime identity authority is `ps_customer.id_customer`.
- `src/domain/customer-intelligence-audience/contracts.ts` already sets
  `identityAuthority: 'prestashop_customer'`.
- Feature, RFM, cluster, affinity, and most CLV rows use the PrestaShop customer identity.
- `src/infrastructure/prestashop/mysql-prestashop-customer-identity-repository.ts` resolves
  identity directly from `ps_customer.id_customer`.

`master_customer.id` is not guaranteed. The planned CRM link migration is nullable, and the
canonical CRM resolver explicitly returns `unmatched` or `ambiguous` with
`masterCustomerId: null`. `masterCustomerId` is therefore an optional enrichment field only. A04
must not drop a member when that linkage is absent, ambiguous, or CRM is unavailable.

The generic row may expose `masterCustomerId` only when a separately authorized, bulk identity
read resolves exactly one link. It is not a required export key, default field, or Brevo identity
source in v1.

## PII_HYDRATION_SOURCE

Membership does not depend on PII. Hydration is a later projection step.

Current source and boundary:

- `src/application/customer-profile/ports.ts` — `PrestashopCustomerReader.findById(customerId)`.
- `src/infrastructure/prestashop/mysql-prestashop-customer-reader.ts` — reads `ps_customer` by
  `id_customer`, selecting `firstname`, `lastname`, `email`, activity/shop/timestamps.
- `src/domain/customer-profile/contracts.ts` — profile contains `firstname`, `lastname`, and
  `email`; `rut` is explicitly `null` in the current direct-PrestaShop contract.

There is no current bulk reader and no current Customer Profile contract for phone/mobile. There
is no current export source for address, RUT, consent, suppression, or channel eligibility. A04
must add a dedicated, chunked export-contact read port rather than call the single-customer profile
use case once per member.

PII allowlist for the first export contract:

```text
customerId       analytical identity, required
masterCustomerId  optional CRM linkage, only if exactly resolved and explicitly selected
email            ps_customer.email, optional
phone            NOT AVAILABLE until a verified source/field contract is added
firstname        ps_customer.firstname, optional
lastname         ps_customer.lastname, optional
```

Explicitly prohibited: RUT, address, birthday, passwords, consent flags, suppression flags,
channel eligibility, order references, and arbitrary source columns. Missing `masterCustomerId`
does not remove the member. Missing optional contact PII becomes null/blank in generic output or a
destination rejection only when the destination requires it.

## SNAPSHOT_DEPENDENCIES

Feature Snapshot is always required because it defines the universe. The relevant component
dependencies are determined from the definition:

| Definition dependency | Snapshot lineage required by the rule |
|---|---|
| `commercial.*` | Feature Snapshot |
| `rfm.*` | Feature + selected RFM snapshot |
| `cluster.*` | Feature + selected cluster snapshot/model |
| `clv.*` | Feature + selected CLV snapshot |
| `HAS_AFFINITY` | Feature + selected affinity snapshot + its Product Semantic snapshot/ontology lineage |

Current `createAudienceContextResolver()` fetches all published header lists and places all
resolved components in the context, even when the definition references only one. The evaluator
blocks only the referenced unavailable components. A04 should define `relevantLineage` as the
feature lineage plus only components referenced by the canonical definition when checksumming and
reporting required dependencies. It must not require unrelated CLV or affinity merely because
those fields are present in the current context shape.

## LINEAGE_CONTRACT

The existing `AudienceEvaluationContextV1` remains the context source. A04 adds an explicit
lineage envelope around the membership/export result rather than inventing a second snapshot
selection algorithm:

```ts
type AudienceEvaluationLineageV1 = {
  readonly evaluatorVersion: 'customer-intelligence-audience-evaluation-v1';
  readonly definitionChecksum: string;
  readonly contextVersion: 'customer-intelligence-audience-context-v1';
  readonly referenceTime: string;                 // UTC ISO
  readonly population: AudienceEvaluationContextV1['population'];
  readonly resolutionPolicyVersion: string;
  readonly relevantSnapshotLineage: Partial<AudienceSnapshotLineageV1> & {
    readonly feature: AudienceSnapshotLineageV1['feature'];
  };
  readonly evaluatedAt: string;                   // UTC ISO
};
```

The serialized result must retain exact feature/component snapshot IDs, reference times, versions,
policies, model/ontology identity, and available checksums. `evaluatedAt` describes execution time;
it is not a substitute for snapshot lineage and is not included as a semantic replacement for the
resolved reference time.

## REPRODUCIBILITY_LEVEL

`ACTIVE_SNAPSHOT_CONSISTENT`

The current readers can pin an explicit Feature Snapshot ID through the application port, and the
feature reader can read a historically published/superseded feature snapshot by ID. However,
`mysql-audience-snapshot-header-reader.ts` lists only currently `published` RFM, cluster, CLV, and
affinity headers and the resolver selects the latest published candidate at or before the feature
anchor. It does not accept explicit component snapshot IDs or read superseded component headers by
ID.

Therefore A04 must not claim full historical reproducibility. A result is reproducible against the
resolved lineage while those exact component snapshots remain available as published/readable;
re-running later may resolve a different active component lineage. Export metadata must state this
level and preserve the exact lineage used for the run.

A future `FULLY_PINNED_REPRODUCIBLE` level requires snapshot readers that resolve and validate all
component IDs explicitly, including historical/superseded component snapshots, plus durable
retention guarantees.

## EVALUATION_CHECKSUM

Use the existing repository convention `sha256Stable()` / `stableStringify()` from
`src/shared/stable-checksum.ts`, with a new checksum purpose/version label:

```ts
evaluationChecksum = sha256Stable({
  checksumVersion: 'audience-evaluation-checksum-v1',
  definition: canonicalizeAudienceDefinition(definition),
  evaluatorVersion,
  evaluationLineage: canonicalRelevantLineage,
  truthByCustomerId: [
    { customerId: 1, truth: 'FALSE' },
    { customerId: 2, truth: 'TRUE' },
    { customerId: 3, truth: 'UNKNOWN' },
  ],
});
```

Rules:

- Customer IDs are sorted ascending numerically.
- Every complete population row is present exactly once.
- Truth strings are exactly `TRUE`, `FALSE`, or `UNKNOWN`.
- The definition is the canonical definition, not caller key order or raw JSON.
- Lineage includes the Feature Snapshot and only definition-relevant component lineage, plus
  population identity/policy and evaluator version.
- Preview limit, selected export fields, destination, file format, estimated size, timestamps used
  only for operation logging, and all PII are excluded.

## MEMBERSHIP_CHECKSUM

```ts
membershipChecksum = sha256Stable({
  checksumVersion: 'audience-membership-checksum-v1',
  definition: canonicalizeAudienceDefinition(definition),
  evaluatorVersion,
  membershipLineage: canonicalRelevantLineage,
  trueCustomerIds: sortedUniqueTrueCustomerIds,
});
```

The member IDs are the complete sorted TRUE set, not the preview slice. No presentation field,
contact data, PII, file format, destination, or attribute mapping is included. A change from TRUE
to UNKNOWN therefore changes both checksums, while a change only to selected output columns does not.

## MEMBERSHIP_RESULT_CONTRACT

The repository-consistent name is `AudienceMembershipResultV1`:

```ts
type AudienceMembershipResultV1 = {
  readonly membershipVersion: 'customer-intelligence-audience-membership-v1';
  readonly definition: AudienceDefinitionV1;       // canonical definition
  readonly definitionChecksum: string;
  readonly evaluationContext: AudienceEvaluationContextV1;
  readonly lineage: AudienceEvaluationLineageV1;
  readonly counts: {
    readonly population: number;
    readonly matched: number;                      // TRUE
    readonly notMatched: number;                   // FALSE
    readonly unknown: number;                      // UNKNOWN
  };
  readonly members: readonly AudienceMemberV1[];   // complete TRUE set, ascending
  readonly evaluationChecksum: string;
  readonly membershipChecksum: string;
  readonly completeness: 'COMPLETE';
  readonly warnings: readonly string[];
};
```

The public contract represents a complete set. The implementation may internally stream sorted
IDs, write to a protected temporary artifact, or process batches, but it must not expose a result as
complete until the count/checksum/completeness invariants pass. A bounded `previewMembers` value
cannot populate this field.

For the initial synchronous A04 implementation, no durable membership table is required. The
membership result is authoritative for the export operation that owns it. Durable immutable
`audience_evaluation` / `audience_membership` persistence belongs to A07 or a future asynchronous
export job, and must use the same contract/checksums if introduced.

## EXPORT_PREVIEW_CONTRACT

The preview is an operational export summary, not a customer sample:

```ts
type AudienceExportPreviewV1 = {
  readonly previewVersion: 'customer-intelligence-audience-export-preview-v1';
  readonly status: 'READY' | 'BLOCKED';
  readonly audienceMatchedCount: number;
  readonly unknownCount: number;
  readonly customersWithEmail: number;             // non-blank normalized source value
  readonly customersWithoutEmail: number;
  readonly customersWithPhone: number | null;
  readonly customersWithoutPhone: number | null;
  readonly duplicateEmailCount: number;            // members in duplicate-email groups
  readonly duplicatePhoneCount: number;            // members in duplicate-phone groups
  readonly exportableCount: number;                // rows valid for selected projection
  readonly excludedFromExportCount: number;
  readonly brevoEligibleCount: number;
  readonly brevoRejectedCount: number;
  readonly selectedFields: readonly AudienceExportFieldIdV1[];
  readonly selectedFormat: 'GENERIC_CSV' | 'GENERIC_XLSX' | 'BREVO_CONTACT_IMPORT_CSV';
  readonly selectedDestination: 'DOWNLOAD' | 'BREVO_CONTACT_IMPORT_FILE';
  readonly estimatedFileRows: number;
  readonly estimatedFileSizeBytes: number | null;
  readonly membershipChecksum: string;
  readonly evaluationChecksum: string;
  readonly lineage: AudienceEvaluationLineageV1;
  readonly validationWarnings: readonly string[];
};
```

Definitions:

- `audienceMatchedCount` is exactly `membership.counts.matched`.
- `unknownCount` is exactly `membership.counts.unknown`.
- Email coverage is numeric when the approved bulk `ps_customer` reader is available. Phone
  coverage is `null`/`null` with a `phone_source_unavailable` warning until a verified phone source
  contract exists; A04 must not report unavailable phone data as zero customers with phone.
- Generic export row count is the complete matched set, unless a configured export policy rejects a
  row for a selected required projection field. Optional missing PII does not remove a generic row.
- `excludedFromExportCount` is projection/destination exclusion, never analytical non-membership.
- `brevoEligibleCount + brevoRejectedCount = audienceMatchedCount` for a completed Brevo
  eligibility pass.
- `estimatedFileRows` excludes a CSV header and XLSX metadata rows; for Brevo it equals eligible
  contact rows.
- A contact with a missing `masterCustomerId` remains exportable under the PrestaShop identity.
- The summary must be built from the same `AudienceMembershipResultV1` that feeds the writer. It
  must not re-evaluate from preview IDs.

## EXPORT_REQUEST_CONTRACT

```ts
type AudienceExportFieldIdV1 =
  | 'customerId'
  | 'masterCustomerId'
  | 'email'
  | 'phone'
  | 'firstname'
  | 'lastname'
  | 'rfmCode'
  | 'clusterId'
  | 'clvExpectedRevenueTaxIncl'
  | 'audienceSource';

type AudienceExportRequestV1 = {
  readonly requestVersion: 'customer-intelligence-audience-export-request-v1';
  readonly definition: unknown;                     // server validates/canonicalizes
  readonly projection: 'GENERIC_CSV' | 'GENERIC_XLSX' | 'BREVO_CONTACT_IMPORT';
  readonly format: 'GENERIC_CSV' | 'GENERIC_XLSX' | 'BREVO_CONTACT_IMPORT_CSV';
  readonly fields?: readonly AudienceExportFieldIdV1[];
  readonly destination?: 'DOWNLOAD' | 'BREVO_CONTACT_IMPORT_FILE';
  readonly locale?: string;                          // validated BCP-47 tag; presentation only
};
```

The server rejects mismatched projection/format/destination combinations and rejects unknown or
unauthorized fields. The client cannot provide authoritative IDs, a snapshot ID, lineage/checksum,
SQL, a raw membership list, an evaluator bypass, or arbitrary PII field names. The definition is
validated exactly as an AudienceDefinitionV1 before context resolution or PII hydration.

For the first synchronous flow, the export request resolves context and membership server-side in
one operation. If a UI wants to export a previous result exactly, a future persisted evaluation
reference is required; a browser-supplied checksum or member list is not sufficient.

## GENERIC_EXPORT_ROW_CONTRACT

```ts
type AudienceExportRowV1 = {
  readonly customerId: number;
  readonly masterCustomerId: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly firstname: string | null;
  readonly lastname: string | null;
  readonly rfmCode: string | null;
  readonly clusterId: number | null;
  readonly clvExpectedRevenueTaxIncl: string | null;
  readonly audienceSource: string | null;
};
```

All fields are projection fields, not membership inputs. `customerId` is always present. Nullable
fields are serialized as blank in files. Decimal values remain canonical decimal strings; they are
not converted through JavaScript floating point.

`audienceSource` is a presentation/trace field such as an application-defined audience export
label or definition checksum; it is not a customer-controlled value and is not part of
`membershipChecksum`.

Analytical values are opt-in and only available when their already-resolved component data is
present. The generic export does not include all analytical data by default.

## DEFAULT_EXPORT_FIELDS

```text
customerId
```

This is the only safe default because it exports analytical membership identity without silently
creating a bulk PII export. It also works when PrestaShop PII hydration is unavailable.

## OPTIONAL_EXPORT_FIELDS

```text
email
firstname
lastname
phone                  blocked until a verified source contract exists
masterCustomerId       only when explicitly authorized; nullable
rfmCode                only when RFM is a relevant/resolved dependency
clusterId              only when cluster is a relevant/resolved dependency
clvExpectedRevenueTaxIncl
audienceSource
```

`email`, names, phone, and CRM linkage require explicit bulk-export permission. RUT, address,
consent, channel eligibility, suppression, and arbitrary analytical columns are not optional
fields in v1.

## BREVO_PROJECTION_CONTRACT

The dedicated core projection is:

```ts
type BrevoContactProjectionV1 = {
  readonly projectionVersion: 'customer-intelligence-brevo-contact-projection-v1';
  readonly customerId: number;                       // internal provenance, not necessarily a file column
  readonly extId: string;                            // candidate: String(customerId)
  readonly email: string | null;
  readonly sms: string | null;
  readonly fname: string | null;
  readonly lname: string | null;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
};
```

The v1 file column order is:

```text
EXT_ID,EMAIL,SMS,FNAME,LNAME
```

`EXT_ID` is the candidate mapping `customerId -> String(customerId)`. This is appropriate for the
current analytical identity authority and is stable across exports, but the Brevo account must
confirm that this account does not already use another external-ID namespace. A08 must not silently
change this mapping.

The core attributes are based on Brevo's documented contact import conventions: at least one of
EMAIL, SMS, WHATSAPP, LANDLINE_NUMBER, or EXT_ID can identify a new contact; SMS requires a country
code; FNAME/LNAME are standard attributes; and custom attributes must exist in the target account.
See the official sources linked in the final audit notes.

Potential analytical attributes are deliberately not finalized:

```text
RFM_CODE
CLUSTER_ID
CLV_12M
AUDIENCE_SOURCE
```

They may be added only through server-owned, versioned mapping configuration after the actual
Brevo account's attribute names/types are audited. Client-provided attribute names are forbidden.
Until then, core contact import is the supported Brevo projection and no custom analytical columns
are emitted.

## BREVO_ELIGIBILITY_RULES

Eligibility is destination compatibility, not audience membership or marketing consent.

```text
BREVO_ELIGIBLE  -> a valid projection row can be emitted
BREVO_REJECTED  -> the member remains in Audience Membership but is absent from the Brevo file
```

Deterministic checks, in order:

1. `customerId` must be a positive safe integer; this is guaranteed by the analytical population.
2. `EXT_ID` mapping must be enabled and produce a non-empty string. If the account-level mapping is
   not approved, reject with `ATTRIBUTE_MAPPING_UNAVAILABLE` rather than guessing.
3. A non-blank email must be normalized and syntactically valid. An invalid non-blank email is a
   `BREVO_REJECTED / INVALID_EMAIL` row; it is not silently passed through.
4. A non-blank phone must be normalized to the verified Brevo SMS format (country code, digits,
   and no display punctuation). A non-blank value that cannot be normalized is
   `BREVO_REJECTED / INVALID_PHONE`.
5. The normalized EXT_ID, email, and phone values must be unique across distinct customer IDs in
   this projection batch. Duplicate values are rejected, not collapsed.
6. Every requested custom attribute must have a server-owned verified mapping and compatible
   account type. Otherwise the projection is blocked or the row is rejected with
   `ATTRIBUTE_MAPPING_UNAVAILABLE`/`UNSUPPORTED_FIELD`, according to the mapping validation stage.

Required row reason codes:

```text
MISSING_CONTACT_IDENTIFIER
INVALID_EMAIL
INVALID_PHONE
DUPLICATE_IDENTIFIER
UNSUPPORTED_FIELD
ATTRIBUTE_MAPPING_UNAVAILABLE
```

With the approved `customerId -> EXT_ID` policy, `MISSING_CONTACT_IDENTIFIER` should be rare; it
remains in the contract for a disabled/unavailable EXT_ID mapping or a future destination policy.
Missing optional email or SMS alone is not a rejection when EXT_ID is valid. A missing optional
profile row therefore remains Brevo-eligible with EXT_ID-only if policy allows it; a malformed
non-blank contact value is rejected rather than silently discarded.

This contract does not assert opt-in, deliverability, suppression, or legal marketing permission.
Those are separate destination/account controls and must not be inferred from the Audience result.

## DUPLICATE_POLICY

Normalize identifiers before comparing:

- email: trim and case-fold for duplicate comparison; preserve the normalized email in projection;
- SMS: normalize to the verified international representation before comparison;
- EXT_ID: compare exact normalized string.

The duplicate policy is `REJECT_ALL_DUPLICATE_ROWS_FOR_BREVO`:

- same identifier on multiple customer IDs is a duplicate group;
- every row in that group receives `DUPLICATE_IDENTIFIER`;
- no deterministic primary customer is selected;
- no records are silently merged;
- generic CSV/XLSX preserves one row per authoritative member and does not collapse duplicates;
- `duplicateEmailCount` and `duplicatePhoneCount` count matched members participating in duplicate
  groups, not merely the number of groups.

This is safest because `customerId` is the analytical truth and the repository has no verified
one-to-one PrestaShop-to-Brevo identity map. Brevo's own account-level merge behavior must not be
implicitly invoked by A04.

## CSV_CONTRACT

Both CSV projections use the repository's existing comma convention and RFC 4180-style output:

```text
encoding       UTF-8, no locale-dependent recoding
delimiter      comma (",")
newline        CRLF, including the final record terminator
quoting        quote fields containing comma, quote, CR, or LF; double embedded quotes
null           empty field
date           UTC ISO-8601 string, e.g. 2026-09-10T12:00:00.000Z
decimal        canonical decimal string; never locale comma or binary float formatting
boolean        TRUE / FALSE
header         first record; stable contract-defined column order
```

`GENERIC_CSV` headers follow the selected camelCase export field IDs. `BREVO_CONTACT_IMPORT_CSV`
uses uppercase Brevo attribute headers and contains only contact rows, with no metadata rows.

Generic spreadsheet-compatible output must apply formula-injection protection to customer-
controlled text beginning with `=`, `+`, `-`, or `@`: prefix only text cells with a literal
apostrophe before CSV quoting. Do not apply this transformation to numeric analytical values,
customer IDs, dates, or canonical decimal fields.

The Brevo protocol file is not a general-purpose spreadsheet export. Its typed core fields must
remain valid for Brevo; in particular a valid SMS `+` country-code value must not be altered by a
spreadsheet escape. FNAME/LNAME and future free-text custom attributes must use a destination-safe
typed validation/escaping policy before they are emitted. A Brevo CSV must never be opened and
resaved through a spreadsheet as part of the server path.

The existing writers are not reusable as-is: `scripts/clustering/lib/csv.ts` assumes only numeric
or simple strings and does not implement RFC quoting or formula protection. It is evidence of the
comma convention, not an A04 writer.

## XLSX_CONTRACT

`exceljs` is already a production dependency and is already used by
`src/application/customer-intelligence-copilot-session/xlsx-export.ts`; no new XLSX package is
required.

Workbook structure:

```text
Sheet 1: Audience
  row 1: selected headers
  rows 2..N: one row per complete TRUE member after generic projection

Sheet 2: Metadata
  key | value rows only
```

Audience sheet requirements:

- no preview-only rows;
- no FALSE or UNKNOWN rows;
- one row per authoritative member that is exportable under the selected generic projection;
- stable selected-field order;
- frozen header row and auto-filter are recommended from the existing XLSX convention;
- null values are blank cells;
- canonical decimal strings remain strings to avoid rounding;
- dangerous customer-controlled text uses Excel text/quote-prefix handling;
- no formulas are generated from customer values.

Metadata must include at least:

```text
exportVersion
definitionChecksum
evaluationChecksum
membershipChecksum
population
matched
notMatched
unknown
evaluatedAt
referenceTime
evaluatorVersion
featureSnapshotId
relevant snapshot IDs and versions
resolutionPolicyVersion
projection
format
selectedFields
selectedDestination
estimatedFileRows
validationWarnings
```

Metadata must not include raw SQL, bound parameters, PII, or the authoritative member list.

## BREVO_CSV_CONTRACT

`BREVO_CONTACT_IMPORT_CSV` is a direct-import-compatible file, not a second evaluation path:

- source rows are the Brevo-eligible subset of the same complete TRUE membership;
- header is exactly the configured core/custom attribute order, with core v1 order
  `EXT_ID,EMAIL,SMS,FNAME,LNAME`;
- no metadata or explanatory rows are mixed into the file;
- no `CONTACT_ID` is emitted for new-contact import unless a future update-specific contract
  explicitly requests it;
- no Brevo API is called by A04;
- the export preview/audit result reports matched, eligible, rejected, duplicate, and reason counts
  separately from the file row count;
- an empty eligible set is a successful empty file with headers when membership evaluation is
  complete.

The same `BrevoContactProjectionV1` must later be passed to an A08 transport adapter. A08 owns
only destination validation, projection translation, API batching, retries, and import result
reporting; it must not reimplement audience evaluation, PII selection, duplicate policy, or
eligibility semantics.

## SCALE_STRATEGY

Current audit:

- population is approximately 45k customers;
- current evaluator is set-based and has no per-customer analytical N+1 calls;
- current evaluator still materializes every truth row in the SQL executor response;
- current PII source is single-customer only, which would create an unacceptable N+1 export path.

Required A04 execution shape:

```text
resolve one server-owned context
  -> validate definition and relevant dependencies
  -> evaluate complete feature population in ordered batches/stream
  -> count TRUE/FALSE/UNKNOWN and increment checksums
  -> retain/stream complete sorted TRUE IDs
  -> bulk-hydrate PrestaShop contact rows in bounded chunks
  -> apply generic/Brevo projection and duplicate policy
  -> stream writer output to a server-side response/temp file
```

The implementation should use keyset pagination by `prestashop_customer_id` or a streaming
executor, never browser-side paging and never `OFFSET` over a changing source. Contact hydration
must use one set-based `WHERE id_customer IN (...)` read per bounded chunk, with a configurable
chunk size and no profile-use-case loop.

The configured export policy must fail closed when no maximum is present. It must define maximum
matched members, maximum output bytes, request timeout, and rate/concurrency limits. Exceeding a
limit fails the export with a typed size/budget result; it must never silently truncate the
authoritative audience. A 45k population should be tested against the target MariaDB plan and
memory/streaming behavior before production enablement.

## FAILURE_SEMANTICS

| Condition | Required behavior |
|---|---|
| Invalid AudienceDefinition | Reject before context/PII/writer; return structured validation errors. |
| 0 matched, complete evaluation | Successful empty generic/Brevo file with headers and metadata; `matched = 0`. |
| All UNKNOWN, complete evaluation | Successful empty file; preserve `unknown = population` and warning `all_members_unknown`; never report FALSE. |
| Referenced snapshot unavailable | Block membership and export; no empty file is produced. |
| Partial referenced analytical source unavailable | Block/fail complete evaluation; do not produce a partial authoritative export. Per-customer component absence remains UNKNOWN only when the selected snapshot is available. |
| Population/count/duplicate-ID invariant fails | Fail membership resolution and export; no partial file is authoritative. |
| PII hydration transport/schema failure | Fail the export atomically; do not emit a file claiming complete projection. |
| Individual optional PII row missing | Preserve customerId in generic output with null optional fields; warn. Brevo uses the explicit eligibility rule. |
| Brevo projection mapping unavailable | Brevo export blocked/rejected with mapping reason; generic export remains independent. |
| Invalid non-blank email/phone | Keep member in membership; reject that row from Brevo with explicit reason. |
| Duplicate contact identifiers | Keep all members in membership; reject all affected Brevo rows; generic output preserves rows. |
| Writer/storage failure | Fail atomically where possible; never report a successful complete file. |
| Export size/rate limit exceeded | Fail with typed budget/authorization result; never truncate silently. |

`0 matched + successful complete evaluation` is therefore materially different from
`authoritative evaluation incomplete`.

## PREVIEW_EXPORT_INVARIANTS

For the same `AudienceMembershipResultV1`:

```text
AudienceExportPreviewV1.audienceMatchedCount
  = membership.counts.matched
  = generic export source membership count
  = Brevo eligibility input count
```

The Brevo file count may be lower:

```text
brevoEligibleCount <= audienceMatchedCount
brevoRejectedCount = audienceMatchedCount - brevoEligibleCount
```

The authoritative generic export source is the complete `members` set, never
`evaluation.previewMembers`, `preview.rows`, a client-provided list, or a re-derived live
population. `membershipChecksum` must be identical across generic CSV, generic XLSX, and Brevo CSV
when they are generated from the same membership result. Field selection and destination may change
projection checksums/metadata but must not change membership truth.

## CAPABILITY_BOUNDARIES

Recommended application/domain seams:

```text
evaluateAudience()
  -> current bounded A02 evaluation/preview contract

resolveAudienceMembership()
  -> complete TRUE/FALSE/UNKNOWN membership result and checksums

previewAudienceExport()
  -> membership + bulk contact hydration + projection counts/warnings

buildAudienceExportProjection()
  -> generic allowlist projection

buildBrevoContactProjection()
  -> core Brevo mapping, validation, duplicate classification

writeAudienceCsv()
writeAudienceXlsx()
  -> serialization only; no evaluation or PII lookup
```

Membership evaluation must not import Customer Profile PII readers. PII hydration must not
re-evaluate definitions. Writers must not select snapshots or perform SQL. Brevo transport is a
future adapter behind `BrevoContactProjectionV1`.

## SECURITY_BOUNDARY

The existing A02 internal token is an authentication boundary for the neutral audience capability,
not sufficient evidence of bulk-export authorization. A04 must require, through the service's
authorization context or a dedicated internal credential:

- audience-evaluate permission for analytical membership;
- bulk-export permission for any file;
- explicit PII-export permission for email/name/phone fields;
- Brevo-destination permission for the Brevo projection;
- field allowlist enforcement server-side;
- configured maximum member count, output bytes, timeout, rate, and concurrency;
- audit logging of actor/service, definition checksum, evaluation/membership checksums, lineage,
  destination, selected fields, counts, outcome, and duration;
- no raw PII, SQL, credentials, or rejected contact values in logs;
- atomic temporary-file handling and short retention/deletion for generated artifacts;
- no arbitrary SQL, member IDs, snapshot IDs, or evaluator bypass from the client.

Consent, suppression, deliverability, and channel eligibility are not created by this contract.
They require a separately owned authorized source and must be added as a destination policy rather
than folded into analytical membership.

## FUTURE_COMPATIBILITY

| Consumer | A04 compatibility rule |
|---|---|
| A03.1 CRM Audience Workspace | Sends the same `AudienceDefinitionV1`; export UI never sends preview IDs. |
| A05 R3 Audience Query/Iteration | May propose/edit a definition only; it never provides authoritative IDs or SQL. |
| A07 Saved Audiences | May persist definitions/evaluations/membership using the same canonical checksums; it must not create a second evaluator. |
| A08 Brevo API | Consumes `BrevoContactProjectionV1`; only translates, batches, calls Brevo, and reports destination results. |
| A09 Campaign Intelligence | Consumes audience/eligibility counts, lineage, checksums, and export/import outcomes; it does not recalculate membership. |

## FILES_LIKELY_TO_CHANGE

No files are changed by this audit/design task.

Future A04 implementation is likely to add or modify:

```text
src/domain/customer-intelligence-audience/contracts.ts
src/domain/customer-intelligence-audience/canonicalization.ts
src/application/customer-intelligence-audience/ports.ts
src/application/customer-intelligence-audience/membership.ts
src/application/customer-intelligence-audience/export-preview.ts
src/application/customer-intelligence-audience/export-projection.ts
src/application/customer-intelligence-audience/brevo-projection.ts
src/application/customer-intelligence-audience/csv-writer.ts
src/application/customer-intelligence-audience/xlsx-writer.ts
src/application/customer-profile/ports.ts or a dedicated export-contact port
src/infrastructure/prestashop/mysql-prestashop-customer-export-reader.ts
src/http/routes/index.ts                                  (later, when endpoint is authorized)
tests/unit/*audience*export*.test.ts
tests/integration/*audience*export*.test.ts
```

The existing `mysql-prestashop-customer-reader.ts` should not be called in a per-member loop. A
dedicated bulk reader is preferable to widening the single-customer profile orchestration.

## MIGRATION_REQUIRED

`NO` for the initial synchronous A04 contract and implementation: the complete membership can be
resolved and checksummed in the export operation without creating a second population or durable
audience table.

`YES` only for a later durable evaluation/membership/export-job feature (expected in A07 or an
asynchronous export evolution). Such a migration must persist immutable evaluations and membership
rows keyed by evaluation, retain the exact lineage/checksums, and never replace the current
Feature Snapshot population definition.

## NEW_DEPENDENCIES_REQUIRED

`NONE` for the initial design and planned core implementation.

`exceljs` is already present in `package.json` and already used for server-side XLSX output. CSV
can be implemented with a small local RFC 4180 writer; the current simple experiment writer is not
sufficient and should not be copied without hardening. No Brevo SDK or HTTP client is required in
A04 because Brevo API execution is explicitly deferred to A08.

## IMPLEMENTATION_PHASES

1. Add contract types and checksum helpers without changing A02 evaluator semantics.
2. Add an authoritative full-membership resolver using the same context/compiler/population and
   explicit count, uniqueness, and completeness invariants.
3. Add a bulk PrestaShop contact projection port with chunked reads and the PII allowlist.
4. Add generic projection and deterministic export preview summary from one membership result.
5. Add core Brevo projection/eligibility and duplicate rejection without account API calls.
6. Add hardened generic CSV writer, then generic XLSX writer using existing `exceljs`.
7. Add Brevo CSV writer with fixed core headers and no metadata rows.
8. Add export authorization, limits, audit logging, atomic output handling, and integration tests.
9. Validate MariaDB execution plans and run a non-zero ~45k operational export rehearsal before
   enabling production bulk export.
10. Defer verified account custom-attribute mappings and Brevo transport to A08.

## IMPLEMENTATION_DECISION

`READY`

The core contract is implementable against the repository's current boundaries. The following are
explicit preconditions, not hidden assumptions:

- use PrestaShop `customerId` as analytical/export identity;
- do not require `masterCustomerId`;
- do not expose phone until its source is verified;
- emit only Brevo core attributes until the real account attribute inventory is approved;
- classify the current reproducibility level as `ACTIVE_SNAPSHOT_CONSISTENT`;
- keep membership, PII hydration, projection, and writing separate;
- do not create a migration or call Brevo in A04.0.

## Final required output

```text
CURRENT_AUDIENCE_FLOW:
  AudienceDefinitionV1 -> validate/canonicalize -> resolve feature-anchored context -> compile fixed SELECT -> evaluate full Feature Snapshot rows -> count TRUE/FALSE/UNKNOWN -> truncate only preview IDs -> bounded analytical preview enrichment.

PREVIEW_EXECUTION_MODEL:
  FULL_POPULATION_THEN_TRUNCATE

AUTHORITATIVE_POPULATION_SOURCE:
  customer_feature_snapshot_row for customer-analytics-population-b-v1 (Feature Snapshot Population B), identity ps_customer.id_customer.

AUTHORITATIVE_MEMBERSHIP_RULE:
  TRUE is member; FALSE is notMatched; UNKNOWN is notMatched but separately counted. population = matched + notMatched + unknown.

UNKNOWN_SEMANTICS:
  Preserve three-valued logic. Missing customer component row is UNKNOWN; unavailable referenced component blocks; UNKNOWN never becomes FALSE internally.

IDENTITY_AUTHORITY:
  ps_customer.id_customer / customerId. masterCustomerId is optional enrichment and never a membership/export prerequisite.

PII_HYDRATION_SOURCE:
  ps_customer through the existing direct PrestaShop customer contract for email/firstname/lastname; new A04 bulk port required. Phone is not currently owned/available.

SNAPSHOT_DEPENDENCIES:
  Feature always; RFM/cluster/CLV/affinity only when referenced, with affinity carrying indirect Product Semantic lineage. Current resolver resolves all headers but evaluator blocks only referenced unavailable components.

LINEAGE_CONTRACT:
  Existing AudienceEvaluationContextV1 plus evaluator version, definition checksum, evaluatedAt, population identity/policy, resolution policy, exact relevant snapshot lineage, and component checksums.

REPRODUCIBILITY_LEVEL:
  ACTIVE_SNAPSHOT_CONSISTENT

EVALUATION_CHECKSUM:
  sha256Stable(canonical definition + evaluator version + relevant canonical lineage + sorted complete customerId/truth state including TRUE/FALSE/UNKNOWN).

MEMBERSHIP_CHECKSUM:
  sha256Stable(canonical definition + evaluator version + relevant canonical lineage + sorted complete TRUE customer IDs); no PII/presentation.

EXPORT_PREVIEW_CONTRACT:
  AudienceExportPreviewV1 with matched/unknown, email/phone coverage (nullable when a source is unavailable), duplicate counts, generic exportability, Brevo eligibility/rejection, selected fields/format/destination, estimated rows/bytes, checksums, lineage, warnings.

EXPORT_REQUEST_CONTRACT:
  AudienceExportRequestV1 with server-validated definition, allowlisted projection/format/fields/destination/locale. No member IDs, SQL, snapshot IDs, raw membership, evaluator bypass, or arbitrary PII fields.

MEMBERSHIP_RESULT_CONTRACT:
  AudienceMembershipResultV1 with canonical definition/context/lineage, population/matched/notMatched/unknown, complete ascending members, evaluationChecksum, membershipChecksum, COMPLETE marker, warnings.

GENERIC_EXPORT_ROW_CONTRACT:
  customerId required; masterCustomerId/email/phone/firstname/lastname/rfmCode/clusterId/clvExpectedRevenueTaxIncl/audienceSource optional and nullable.

BREVO_PROJECTION_CONTRACT:
  BrevoContactProjectionV1; core file headers EXT_ID,EMAIL,SMS,FNAME,LNAME; candidate EXT_ID = String(customerId); custom analytical attributes require account-audited server mappings.

BREVO_ELIGIBILITY_RULES:
  Validate EXT_ID, normalized email/SMS, custom mapping availability, and identifier uniqueness. Reject with explicit reasons; keep rejected rows in audience membership. Consent/deliverability are separate.

DUPLICATE_POLICY:
  Reject all Brevo rows participating in duplicate normalized email/phone/EXT_ID groups; never silently collapse. Generic exports preserve one row per member.

DEFAULT_EXPORT_FIELDS:
  customerId

OPTIONAL_EXPORT_FIELDS:
  masterCustomerId, email, firstname, lastname, phone (blocked pending source), rfmCode, clusterId, clvExpectedRevenueTaxIncl, audienceSource.

CSV_CONTRACT:
  UTF-8, comma delimiter, CRLF, RFC-style quoting, blank nulls, UTC ISO dates, canonical decimal strings, TRUE/FALSE booleans, formula protection for generic customer text.

XLSX_CONTRACT:
  exceljs; Audience sheet with complete generic rows; Metadata sheet with checksums/counts/evaluatedAt/lineage/projection; no PII in metadata and no formulas from customer text.

BREVO_CSV_CONTRACT:
  One direct-import-compatible contact table, core uppercase headers, eligible rows only, no metadata rows, no CONTACT_ID for new-contact import, same authoritative membership source.

SCALE_STRATEGY:
  Ordered/batched or streamed full evaluation -> complete checksums -> chunked bulk PII hydration -> projection -> server-side streamed/atomic writer; no browser export and no N+1.

FAILURE_SEMANTICS:
  Complete zero-match/all-UNKNOWN evaluations produce successful empty files; incomplete evaluation, invalid definition, unavailable dependency, invariant failure, global PII failure, mapping failure, size limit, or writer failure produces no authoritative file.

SECURITY_BOUNDARY:
  Separate analytical/bulk/PII/Brevo permissions, server allowlists, size/rate/concurrency limits, audit logs without PII/SQL/secrets, protected temporary files, no client member lists or SQL.

PREVIEW_EXPORT_INVARIANTS:
  preview matched = membership matched = generic source count = Brevo eligibility input; Brevo eligible may be lower; same membership checksum across all projections.

FILES_LIKELY_TO_CHANGE:
  New audience membership/export/projection/writer modules, bulk PrestaShop export reader, future authorized routes, and focused unit/integration tests. No current files changed by A04.0.

MIGRATION_REQUIRED:
  NO for synchronous A04; YES only for later durable evaluation/membership/export-job persistence.

NEW_DEPENDENCIES_REQUIRED:
  NONE; reuse existing exceljs and implement a hardened local CSV writer. No Brevo SDK/API in A04.

IMPLEMENTATION_PHASES:
  Contracts/checksums -> full membership -> bulk PII -> generic preview/projection -> Brevo core eligibility -> CSV/XLSX writers -> authorization/limits/audit -> ~45k operational rehearsal -> A08 custom mappings/transport.

IMPLEMENTATION_DECISION:
  READY, core-only; Brevo account custom attributes and phone source remain explicit prerequisites for optional fields.
```

## Audit sources

Repository sources are linked throughout this document. For the Brevo-specific core-file claims,
the official documentation consulted on 2026-09-10 was:

- [Create a file to import your contacts](https://help.brevo.com/hc/en-us/articles/208729849-Create-a-file-to-import-your-contacts)
- [Import your contacts to Brevo](https://help.brevo.com/hc/en-us/articles/115000719584-Import-your-contacts-to-Brevo)
- [Create a contact](https://developers.brevo.com/reference/create-contact)
- [Manage your contacts in Brevo](https://developers.brevo.com/docs/synchronise-contact-lists)

These sources confirm the supported core identifiers/attributes and account-specific custom
attribute requirement. They do not provide the actual account's custom-attribute inventory, so no
custom analytical attribute name is treated as finalized by A04.0.
