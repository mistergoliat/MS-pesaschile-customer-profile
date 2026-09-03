# CUSTOMER-INTELLIGENCE-AUDIENCE-A03.0 - CRM Audience Workspace Design

Status: `DESIGN_ONLY`

Decision: `CUSTOMER_INTELLIGENCE_AUDIENCE_A03_WORKSPACE_DESIGNED`

This document designs the future CRM Audience Workspace. It does not implement frontend code,
change Customer Profile runtime behavior, add HTTP endpoints, create persistence, or modify the
CRM-Customer-360 repository.

## DESIGN_DECISION

The workspace is a CRM presentation and interaction layer over the existing A02 neutral audience
capability. Its authoritative flow is:

```text
human intent
  -> CRM structured draft
  -> AudienceDefinitionV1
  -> Customer Profile A02 validation/evaluation
  -> evaluation counts and bounded preview
  -> CRM result presentation
```

The CRM owns the draft, controls, copy, layout, and temporary interaction state. Customer Profile
owns schema truth, validation, context resolution, membership truth, three-valued evaluation,
preview enrichment, and lineage. The CRM never calculates membership or queries the analytics
database.

The first implementation should be a schema-driven structured editor with an explicit **Evaluar**
action. The layout reserves a stable intent/assistant surface for a future R3 integration, but
A03.1 does not need natural-language interpretation or conversational persistence.

The existing A02 endpoints are sufficient for the A03.1 core workspace. No A02 extension is part
of A03.0.

### Non-negotiable invariants

- `AudienceDefinitionV1` is the only semantic input sent to A02.
- A02 is the only source of audience membership truth.
- `UNKNOWN` remains distinct from `FALSE` in counts, copy, color, and accessibility text.
- Preview rows are visibly bounded and are never presented as complete membership.
- A02-selected lineage is displayed as technical context, not as an editable user control.
- The CRM does not copy the Catalog affinity ontology into local code.
- A03.1 does not persist saved audiences, full membership, contactability, exports, or campaigns.

## USER_MENTAL_MODEL

The user should think of an audience as a named question about customers:

> "¿Qué clientes cumplen estos criterios según la información analítica disponible?"

The workspace should make the path from business language to deterministic criteria visible:

```text
clientes HYROX con buen potencial
  -> Afinidad: Disciplina = HYROX
  -> CLV esperado >= $500.000
  -> resultado evaluado por Customer Profile
```

The user does not need to understand snapshot ids, checksums, model hashes, SQL, physical tables,
or raw internal field ids during normal use. The underlying definition remains inspectable through
an advanced/details affordance and is never replaced by a hidden heuristic.

### Product language for analytical concepts

| Technical concept | User-facing concept | Required clarification |
|---|---|---|
| RFM | Segmentación de comportamiento de compra | Recencia, frecuencia y valor monetario; a named segment is a published taxonomy, not a CRM-created label. |
| `rfm.recencyDays` | Días desde última compra | Days relative to the selected feature reference time, not necessarily today. |
| Behavioral cluster | Perfil conductual | A model-produced grouping. The label is descriptive and model-scoped, not a universal customer type. |
| CLV | Valor futuro estimado | Expected tax-inclusive revenue over the fixed 12-month CLV horizon; not margin, budget, or probability. |
| Affinity | Interés comercial | Evidence derived from normalized purchase behavior. A score is evidence strength, not probability. |
| `UNKNOWN` | Sin información suficiente | The required component has no usable information in the selected analytical context. It is not a failed match. |

The copy should prefer business labels in the primary view and retain the technical definition in a
secondary view. For example, the primary criterion may read **Días desde última compra hasta 180**;
the details drawer may show `commercial.daysSinceLastOrder LTE 180`.

## WORKSPACE_STRUCTURE

The page should use a single workspace with a clear top-to-bottom progression. On narrow screens,
the same sections become stacked cards without changing semantics.

```text
Audience Workspace                                      [Estado: Borrador]

¿Qué audiencia quieres analizar?                        [R3: Próximamente]
[ optional intent/assistant surface ]

Criterios                                                 [Editar]
  Clientes con ...
  [condition rows and boolean groups]
  [+ Agregar condición] [+ Agregar grupo]

Resultado                                                [Evaluar]
  842 clientes de 45.196 (1,9%)
  TRUE 842     FALSE 42.110     UNKNOWN 2.244

Preview                                                  [50 filas]
  Mostrando 50 de 842
  [bounded preview table]

Contexto técnico                                        [collapsed]
  capability, definition, lineage, availability, timing
```

### A. Intent / assistant area

In A03.1 this is a reserved, non-authoritative surface. It may contain:

- an optional text prompt labelled **Describe una audiencia**;
- a short explanation that natural-language assistance is not yet enabled; and
- the future R3 conversation entry point.

It must not imply that free text is currently evaluated. If A03.1 has no R3 adapter, the control is
disabled or omitted behind a feature flag, while the structured editor remains fully usable.

### B. Structured Audience Definition

This is the primary editing surface. It shows criteria in business language, boolean connectors,
field-specific controls, validation messages, and the current draft state. A small **Cambios sin
evaluar** indicator appears whenever the draft differs from the last evaluated definition.

### C. Evaluation summary

The summary is shown only for a completed evaluation. It distinguishes the complete matched count
from the bounded preview returned count and uses the population universe as the denominator for the
percentage.

### D. Customer preview

The preview is a human-inspection sample, not a membership browser. It contains only the fields
returned by A02 and never adds PII through another CRM call.

### E. Context / technical details

This collapsed section makes the deterministic contract auditable without burdening routine users.
It can show:

- capability and schema versions;
- definition version and checksum;
- evaluation timestamp and reference time;
- `populationUniverseCount`, `matchedCount`, `returnedCount`, and truncation;
- feature/RFM/cluster/CLV/affinity lineage ids and versions;
- component availability and enrichment status; and
- bounded performance metadata when exposed by the response.

The user cannot edit these values. Re-evaluation is the only way to obtain a new server-resolved
context.

## DEFINITION_EDITOR

The editor maintains a draft object matching `AudienceDefinitionV1` plus non-semantic UI state.
UI state includes expanded groups, selected category, and validation focus; it must never be mixed
into the definition sent to A02.

### Visual-to-contract mapping

| Visual control | Serialized contract |
|---|---|
| Scalar condition row | `{ kind: "SCALAR", field, operator, value }` |
| Affinity condition row | `{ kind: "HAS_AFFINITY", axis, code, qualifiers... }` |
| All/any group | `{ kind: "AND" | "OR", children: [...] }` |
| Exclude group | `{ kind: "NOT", child: ... }` |
| Definition root | `{ definitionVersion, root }` |

The component names may be `ConditionRow`, `ConditionGroup`, `AffinityCondition`, `BooleanGroup`,
and `DefinitionSummary`, but names are not contractual. The important requirement is that every
visual edit has a lossless mapping to the typed tree.

### Scalar condition UX

A scalar row contains:

1. a grouped field selector;
2. an operator selector limited to `allowedOperators` from A02 schema;
3. a type-aware value editor; and
4. a remove action plus an advanced-definition affordance.

`IS_NULL` and `IS_NOT_NULL` render without a value control. The helper text must say that an
explicit null value is being tested; it does not mean that a missing component is a targetable
segment.

`IN` and `NOT_IN` use a bounded token/list editor with a visible count and a maximum of 500 values.
`BETWEEN` uses two values and preserves the order required by A02 validation. Decimal values are
serialized as canonical decimal strings. Datetimes are selected in the user's timezone and
serialized as UTC timestamps before submission.

### Boolean group UX

- `AND` is displayed as **Todas estas condiciones**.
- `OR` is displayed as **Cualquiera de estas condiciones**.
- `NOT` is displayed as **Excluir quienes cumplan** and contains exactly one child.
- Connectors are shown between children, not as ambiguous inline punctuation.
- Every group has add-child, move, duplicate, and remove actions where valid.
- The root may be a condition or any valid boolean node.
- Empty `AND`/`OR` groups are blocked locally because A02 rejects them.

The editor displays depth and condition counters as users approach the A02 limits. It must enforce
or clearly block:

- maximum filter depth: 5;
- maximum scalar/affinity conditions: 20; and
- maximum `IN`/`NOT_IN` values: 500.

These are UX guardrails only. A02 remains authoritative and the CRM must still render server
validation errors if the draft is rejected.

### Definition summary

The summary is a compact sentence or chips generated from the draft, for example:

```text
Todas:
  Días desde última compra hasta 180
  CLV esperado al menos $500.000
  Afinidad de disciplina: HYROX
```

The summary is display-only. The canonical JSON and checksum come from the server contract; CRM
must not invent semantic equivalence, reorder meaning beyond the A02 canonicalizer, or calculate a
membership result locally.

### Schema-driven capability rule

On workspace load, CRM fetches `GET /v1/customer-intelligence/audiences/schema` and builds the
field/operator/value capabilities from the response. A field may be shown under a human-friendly
group using CRM presentation metadata keyed by `fieldId`, but availability and allowed operators
must come from the response. If a field or operator disappears in a newer schema, an existing draft
must be marked incompatible and not silently rewritten.

## FIELD_PRESENTATION

The normal field picker is grouped by product meaning rather than registry order. A CRM-owned
presentation map may provide labels, group, help text, and formatting hints; it must not contain
independent analytical eligibility rules. Unknown future fields fall back to the schema's
`displayDescription` and an **Otros campos** group.

### Customer Value

| Field | Label | Format |
|---|---|---|
| `clv.expectedRevenueTaxIncl` | CLV esperado | CLP currency; helper: valor futuro estimado a 12 meses |
| `clv.expectedOrders` | Pedidos futuros esperados | Decimal orders |
| `clv.estimateSupportLevel` | Soporte de la estimación CLV | Text enum as returned; do not translate into a confidence percentage |
| `commercial.totalSpentTaxIncl` | Gasto total | CLP currency |
| `commercial.averageOrderValueTaxIncl` | Ticket promedio | CLP currency |

### Purchase Behavior

| Field | Label | Format |
|---|---|---|
| `commercial.validOrders` | Pedidos válidos | Integer orders |
| `commercial.orders365d` | Pedidos válidos últimos 365 días | Integer orders |
| `commercial.daysSinceLastOrder` | Días desde última compra | Integer days |
| `commercial.lastOrderAt` | Fecha de última compra | Localized date/time; submitted as UTC |
| `commercial.firstOrderAt` | Fecha de primera compra | Localized date/time; submitted as UTC |
| `commercial.purchaseFrequencyDays` | Frecuencia de compra | Decimal days; null is explicitly explained |
| `commercial.averageUnitsPerOrder` | Unidades promedio por pedido | Decimal units/order |
| `commercial.distinctProducts` | Productos distintos comprados | Integer products |
| `commercial.repeatProductRate` | Tasa de recompra de productos | Ratio displayed as percentage, serialized as decimal |
| `commercial.top1Share` | Participación del producto principal | Ratio displayed as percentage |
| `commercial.top3Share` | Participación de los tres principales | Ratio displayed as percentage |
| `commercial.effectiveDiversity` | Diversidad efectiva del mix | Numeric index; show schema help |
| `commercial.cancelledOrderRatio` | Proporción de pedidos cancelados | Ratio displayed as percentage |
| `commercial.discountShare` | Participación de descuentos | Ratio displayed as percentage |
| `commercial.shippingShare` | Participación de despacho | Ratio displayed as percentage |

### Customer Lifecycle

| Field | Label | Format |
|---|---|---|
| `rfm.segmentCode` | Segmento RFM | Opaque code with business label only when supplied by an authoritative source |
| `rfm.segmentVersion` | Versión de segmentación RFM | Technical/advanced field; shown when needed for pairing |
| `rfm.rfmCode` | Código RFM | Three-digit string |
| `rfm.recencyDays` | Días desde última compra (RFM) | Integer days |
| `rfm.frequencyOrders` | Pedidos del período RFM | Integer orders |
| `rfm.grossOrderValueTaxIncl` | Valor bruto del período RFM | CLP currency |
| `rfm.recencyScore` | Puntaje de recencia | Integer 1-5, with schema description |
| `rfm.frequencyScore` | Puntaje de frecuencia | Integer 1-5 |
| `rfm.monetaryScore` | Puntaje monetario | Integer 1-5 |

When a user selects `rfm.segmentCode`, the editor should explain that its meaning is tied to the
resolved segment version. If the user explicitly adds `rfm.segmentVersion`, the value must agree
with the resolved version or A02 will block the definition.

### Behavioral Profile

| Field | Label | Format |
|---|---|---|
| `cluster.modelVersion` | Versión del modelo conductual | Advanced pairing field |
| `cluster.clusterId` | Perfil conductual | Integer cluster id, always displayed with model version |

Cluster labels are preview interpretation, not a substitute for the model-scoped filter identity.
CRM must not make a `clusterId`-only saved semantic rule or treat a label as permanently stable.

### Commercial Interest

`HAS_AFFINITY` is rendered as a dedicated row with axis, opaque code, and optional qualifiers:
score, minimum supporting orders/products/spend, explicit evidence coverage, and last-evidence
date. Axis labels are:

- **Familia de producto** (`PRODUCT_FAMILY`)
- **Disciplina** (`DISCIPLINE`)
- **Contexto de uso** (`USE_CONTEXT`)

The row must show that affinity is an evidence-based interest signal and not a probability or
guarantee of intent.

### Operator wording

The operator dictionary is presentation-only and maps the operator returned by A02:

| A02 operator | Spanish wording |
|---|---|
| `EQ` | es |
| `NEQ` | no es |
| `IN` | es uno de |
| `NOT_IN` | no es ninguno de |
| `GT` | es mayor que |
| `GTE` | es al menos |
| `LT` | es menor que |
| `LTE` | es hasta |
| `BETWEEN` | está entre |
| `IS_NULL` | tiene valor nulo explícito |
| `IS_NOT_NULL` | tiene un valor informado |

The UI must hide incompatible operators based on `allowedOperators`; it must not assume that all
fields have the same operators even though the current registry is broad.

## AFFINITY_UX

The user first chooses an axis, then enters or selects an affinity code, then optionally adds
evidence qualifiers. The axis is a small cross-service union owned by the contract; the code is
not owned by CRM.

### A03.1 behavior before the registry exists

Because A02 currently reports `enumerationStatus: CATALOG_REGISTRY_NOT_AVAILABLE`, the code control
must be a clearly labelled opaque string input, not a fabricated dropdown. It may support paste,
case-sensitive validation feedback, and a link to the internal business glossary if one exists,
but it must not offer local suggestions based on observed customer rows.

Suggested helper text:

> El código de afinidad pertenece al catálogo y se valida como texto opaco. No se muestran opciones
> aquí porque el registro oficial de códigos aún no está disponible.

Temporary implementation is acceptable only when it preserves ownership: the user supplies a code,
CRM serializes it unchanged, and Customer Profile/A02 validates the request. CRM must not copy
`HYROX`, `HOME_GYM`, or any other observed code into a local enum as an authoritative list.

### AFFINITY_CODE_REGISTRY_REQUIREMENT

Before implementing a dropdown or autocomplete, Catalog must provide an immutable, versioned code
registry contract containing at least:

- axis and opaque code;
- display label, description, and locale policy;
- active/deprecated status and replacement metadata where applicable;
- ontology/product semantic version;
- effective snapshot or reference identity; and
- a checksum that can be preserved in affinity/evaluation lineage.

Customer Profile must consume the Catalog-owned contract or its checksummed snapshot metadata. CRM
may render the returned labels, but may not become the ontology owner. A code registry extension is
a prerequisite for richer affinity UX; it is not an A03.0 implementation.

## EVALUATION_STATES

The UI state machine is separate from the A02 result status because transport and user interaction
have states that are not domain evaluation states.

| Workspace state | Entry | User-visible behavior |
|---|---|---|
| `IDLE` | Initial load or cleared draft | Show editor guidance and **Agregar condición**. Do not call evaluate without a valid root. |
| `VALIDATING` | User presses **Evaluar** | Disable duplicate submissions, run local shape/limit checks, then submit only if valid. |
| `EVALUATING` | Request accepted | Show progress/skeleton, preserve the draft, and state that the evaluation may inspect the full population. |
| `COMPLETED` | A02 returns completed | Show counts, percentage, preview, truncation, availability, and the evaluated definition context. |
| `BLOCKED` | A02 returns a typed blocked evaluation | Keep the draft editable; show field/path-specific correction guidance and do not render a false empty result. |
| `ERROR` | Auth, unavailable service, timeout, malformed response, or network failure | Show retry and service guidance; preserve the draft and last successful result separately. |

The UI should also show a `stale` marker when a completed result belongs to an earlier draft. It
must never silently attach old counts to new criteria.

### Completed summary

Use the following presentation model:

```text
842 clientes de 45.196 (1,9%)

TRUE       842       Cumplen los criterios
FALSE   42.110       No cumplen los criterios
UNKNOWN  2.244       Sin información suficiente
```

`percentage = matchedCount / populationUniverseCount * 100`. If the universe is zero, show `0%`
and avoid division by zero. Use locale-aware thousands separators and CLP formatting where needed.
The denominator is the complete population, not the preview count.

### Blocked mapping

- `INVALID_DEFINITION`: **Revisa los criterios**; focus the invalid path and display A02's message.
- `BUDGET_EXCEEDED`: **La audiencia supera los límites permitidos**; show the relevant limit.
- `INCOMPATIBLE_SNAPSHOT`: **El criterio no es compatible con el contexto analítico actual**; the
  user may remove the explicit version pairing or evaluate again after the context changes.
- `UNAVAILABLE_COMPONENT`: **No se puede evaluar porque falta información analítica requerida**;
  do not show zero matches.
- `QUERY_TIMEOUT`: **La evaluación tardó demasiado**; preserve the draft and offer retry.
- `EXECUTION_FAILED`: **No fue posible evaluar la audiencia**; offer retry and support diagnostics.

The HTTP boundary currently maps these typed results to status codes, but the CRM should use the
typed response body rather than infer semantics from status alone.

## UNKNOWN_UX

`UNKNOWN` means that the predicate could not be determined because a required component or value
was unavailable in the resolved analytical context. It is not an excluded customer, a negative
match, a zero value, or an indication that the customer failed the criterion.

Required presentation:

- keep `unknownCount` as its own metric and legend item;
- use neutral copy: **Sin información suficiente para determinar el criterio**;
- provide the explanation: **El componente requerido no tiene información suficiente en el
  contexto analítico seleccionado**;
- use a neutral pattern/color that is distinct from TRUE and FALSE and also works without color;
- never label UNKNOWN as **No cumple**, **Excluido**, **No interesado**, or **0**;
- do not offer a CRM action that converts UNKNOWN to FALSE; and
- when component availability is unavailable, explain that the entire evaluation is blocked rather
  than silently moving customers into UNKNOWN.

If a preview row is missing a component, use the A02 availability state (`AVAILABLE`,
`NOT_IN_POPULATION`, or `UNAVAILABLE`) and a **Sin datos** badge. Do not render a missing CLV as
`$0`, a missing RFM segment as **Ninguno**, or a missing affinity as no interest without context.

## PREVIEW

The preview is the bounded human-inspection projection returned by A02. Its default limit is 50;
the A02 HTTP maximum is 100. A03.1 should offer the supported limit choices without implying that
the user is paging through full membership.

### Default table

Default columns, in this order:

1. `customerId` - labelled **ID cliente**;
2. RFM segment, when present;
3. behavioral cluster label, with model context available on expansion;
4. CLV expected revenue;
5. valid orders;
6. total spend;
7. last order;
8. recency; and
9. top affinities as compact axis/code/evidence chips.

Optional expansion can show raw RFM scores, expected orders, support level, purchase frequency,
affinity support counts/spend, and component availability. It must remain bounded and must not call
individual Customer Profile endpoints for each row.

### Truncation and empty results

Use the A02 contract semantics:

```text
preview.truncated = matchedCount > preview.returned
```

When truncated, show the message **Mostrando 50 de 8.421 clientes coincidentes** using the actual
returned and matched values. If all matched members are returned, show **Mostrando 43 de 43** and
do not call it truncated. For zero matches, show **No hay clientes que cumplan los criterios** and
do not render a misleading empty table or pagination control.

If enrichment degrades, keep the evaluation counts visible, show **La vista previa no está
disponible temporalmente**, and distinguish this from zero matches. If some rows have missing
components, render the rows with explicit availability badges and retain the evaluation's truth
counts.

There is no pagination in A03.1 because A02 does not expose full membership paging. Do not invent
page numbers, a total-members endpoint, browser-owned member ID lists, or an **Export all** button.

### Affinity visualization

Show each affinity as an axis/code chip with optional score and supporting evidence. A score may be
shown with a relative bar or strength label, but the UI must include **evidencia**, not **probabilidad**,
and must not translate it into a global interest score.

### PII and contactability

The preview contains `customerId` and bounded intelligence fields only. No email, phone, address,
RUT, consent, channel eligibility, suppression, or deliverability data is added in A03.1. A matching
audience and a contactable audience remain separate concepts.

## R3_FUTURE_INTEGRATION

R3 is a future authoring assistant over the same workspace, not a second evaluator. The structured
definition remains the durable semantic handoff between R3, CRM, and Customer Profile.

### Conceptual flow

```text
R3 draft
  -> proposed AudienceDefinitionV1
  -> visible criteria and assumptions in CRM
  -> user applies/edits the proposal
  -> A02 evaluation
  -> counts and preview
  -> R3 interprets the typed result
```

Example:

```text
User: Quiero clientes HYROX con buen potencial.
R3: propone DISCIPLINE = HYROX AND CLV esperado >= $500.000.
CRM: muestra la propuesta como criterios editables.
User: Aplicar y evaluar.
A02: devuelve la evaluación autoritativa.

User: Son demasiados, sólo los de mayor valor.
R3: modifica el criterio CLV; CRM muestra el diff.
A02: evalúa la nueva definición y devuelve el nuevo resultado.
```

R3 should return a structured proposal and a concise natural-language explanation, but CRM must
show the proposed tree before applying it when the change is material. A later R3 adapter may
automatically submit an explicit user-approved evaluation request, but it must not directly set
membership, choose snapshot ids, emit SQL, override the reference time, or bypass A02 validation.

After every applied R3 turn, the workspace replaces the visible draft and marks the prior result
stale until A02 evaluates the new definition. R3 interpretation must cite the returned counts and
preserve the TRUE/FALSE/UNKNOWN distinction.

## ITERATION_MODEL

A03.1 should treat iterations as ephemeral workspace state, not durable audience history.

Recommended initial model:

- keep the current draft, last submitted definition, last result, and stale/error state in the CRM
  page/session state;
- optionally use `sessionStorage` for a short-lived refresh recovery if CRM conventions require it;
- clear temporary state on logout, explicit workspace reset, or session expiration;
- do not create a CRM database record for every edit or evaluation;
- do not persist full membership or an Audience Snapshot;
- do not use `evaluationId` as a substitute for saved audience persistence; and
- do not re-evaluate automatically on every keystroke.

URL-safe state is optional and should be off by default. If later enabled, encode only a canonical
definition and non-sensitive display state, never customer IDs, preview rows, lineage secrets, or
auth material. A shared URL must still re-submit the definition to A02 and must not claim that its
old result remains current.

Durable Saved Audiences, immutable evaluations, membership snapshots, retention, audit, and sharing
belong to later A07/A04 work and require explicit contracts.

## CRM_BOUNDARY

| CRM owns | CRM must not own |
|---|---|
| Workspace layout and accessibility | Membership calculation |
| Human labels, help text, and formatting | Analytics SQL or direct DB access |
| Schema-driven controls | A02 field/operator validation rules copied into logic |
| Draft `AudienceDefinitionV1` editing | Snapshot selection or lineage resolution |
| Local shape/limit hints | Converting UNKNOWN to FALSE |
| Submit/retry/loading interaction | Product semantic ontology or affinity code ownership |
| Result and preview presentation | Contactability, consent, suppression, or campaign eligibility |
| Ephemeral iteration state | Durable audience/evaluation/membership persistence in A03.1 |
| Future R3 conversation surface | R3-controlled membership or SQL |

CRM may maintain a presentation dictionary keyed by stable field ids. This dictionary is not a
second registry: it cannot enable an operator rejected by A02, assign business meaning to an
unknown field, or validate affinity-code membership locally.

## CUSTOMER_PROFILE_BOUNDARY

Customer Profile remains responsible for:

- the machine-readable audience schema and fixed registry;
- `AudienceDefinitionV1` validation, canonicalization, and checksum;
- context/reference-time resolution and compatible snapshot selection;
- deterministic TRUE/FALSE/UNKNOWN semantics;
- complete `populationUniverseCount`, `matchedCount`, and truth counts;
- bounded member IDs and preview enrichment;
- preview truncation semantics and enrichment degradation status;
- lineage, availability, warnings, and typed blocked results; and
- authorization at the A02 HTTP boundary.

CRM consumes the response as a contract. It must preserve the returned context and checksums in
technical details and must not reconstruct them from local state.

## A02_API_SUFFICIENCY

Decision: `SUFFICIENT_FOR_A03_1_CORE`

Existing endpoints:

```text
GET  /v1/customer-intelligence/audiences/schema
POST /v1/customer-intelligence/audiences/evaluate
```

They are sufficient for schema-driven controls, definition construction, evaluation summary,
bounded preview, lineage details, and the planned error/degradation states.

### A03.1 client behavior

1. Load schema once when the workspace becomes available; cache only for the session and respect the
   returned version.
2. Build a definition using `definitionVersion` from the schema.
3. Submit `{ definition, previewLimit }` to evaluate.
4. Render the typed `evaluation` and separate `preview` response.
5. Preserve the last valid result while a new draft is being edited, marked as stale.

The client must send no snapshot id, context checksum, customer-id list, SQL, or arbitrary
identifier. The server resolves the context and owns the result.

### Known limitations that do not block A03.1

- A02 does not provide human-friendly labels for every value. CRM may provide presentation copy for
  known fields, while raw values remain visible in advanced details.
- A02 does not provide per-customer truth explanations. A03.1 can show component availability and
  generic UNKNOWN copy, but should not invent row-level reasons.
- A02 does not provide a complete affinity code registry. A03.1 uses opaque text input until the
  Catalog-owned registry requirement is met.
- A02 does not provide full-membership pagination or export. The preview remains bounded.

None of these requires a new A02 endpoint for the structured workspace. A future extension may add
authoritative affinity registry metadata, bounded diagnostics, or export jobs, but those are separate
roadmap contracts and must not be implemented as A03.0 work.

## EDGE_STATES

| Edge state | User-visible behavior | Prohibited behavior |
|---|---|---|
| No criteria | IDLE guidance; require a root before evaluate | Sending an empty definition or treating it as all customers |
| 0 matches | Completed summary `0 de N (0%)`; empty-state message | Calling it truncated or showing pagination |
| All customers match | Show `N de N`; preview is truncated when the limit is below N | Implying the preview is the full audience |
| High UNKNOWN count | Separate UNKNOWN metric and explanation; offer context details | Folding UNKNOWN into FALSE or silently hiding it |
| Required component unavailable | BLOCKED with missing component and retry/context guidance | Returning an empty audience |
| Invalid definition | Field/path-specific correction state; preserve draft | Dropping user criteria or guessing a replacement |
| Preview enrichment degraded | Keep evaluation summary; preview card degraded with retry | Replacing evaluation counts or claiming 0 matches |
| Auth failure (401) | Session/permission message and escalation; preserve draft | Retrying aggressively or exposing token details |
| Audience route disabled (404) | Feature unavailable message | Falling back to direct database or another endpoint |
| Auth not configured / capability unavailable (503) | Service configuration/unavailable message and retry | Treating service unavailability as no matches |
| Evaluation timeout (504 / typed timeout) | Retry action and preserved draft/result | Auto-looping retries |
| Malformed response | Generic contract error, telemetry correlation id if available | Rendering partial counts as authoritative |

The previous successful result may remain visible during an error only with an explicit label such
as **Resultado anterior - no corresponde necesariamente a este borrador**.

## PERFORMANCE_UX

The evaluator can inspect a population of approximately 45,000 customers. The UX should make the
cost and state of evaluation understandable without exposing SQL or implementation detail.

Recommendations:

- use an explicit **Evaluar audiencia** button;
- do not submit on every field keystroke or every token change;
- validate local shape and limits immediately, but reserve the network evaluation for an explicit
  action;
- disable duplicate submission while `EVALUATING`;
- show a skeleton for summary and preview, with the draft still visible;
- preserve the completed result until a new result arrives, marked stale after edits;
- allow one deliberate retry after timeout/service errors;
- use the A02 default preview limit of 50 and never request above its returned maximum of 100;
- avoid client-side member sorting/filtering that could imply complete membership; and
- measure request duration and error rates through existing CRM observability conventions.

Future R3 may make iteration feel conversational, but each iteration still results in one explicit
structured evaluation request. Debouncing R3 text is an assistant concern; it must not weaken the
server-side contract or create accidental evaluation storms.

## A04_HANDOFF

A03.1 may reserve an action area for:

```text
[ Exportar CSV ]  [ Exportar XLSX ]
```

Both actions should be disabled or labelled **Próximamente** because export is A04 scope. They must
not export the bounded preview as if it were full membership.

A04 will need, from an approved immutable evaluation rather than the browser's local member list:

- definition version, canonical definition, and checksum;
- evaluation identity/status and timestamp;
- pinned context and complete lineage;
- complete `matchedCount` and relevant availability/UNKNOWN counts;
- an immutable membership source or export job created by the authoritative service; and
- a later contactability/eligibility projection, if a channel export is requested.

The future flow is:

```text
AudienceDefinition
  -> A02 evaluation
  -> immutable approved membership/evaluation
  -> explicit eligibility/contactability layer
  -> A04 export job
```

The browser preview IDs are never the export source.

## A03_1_IMPLEMENTATION_PLAN

The following slices are implementation-ready for the future CRM repository. They are ordered to
keep the contract boundary clear and to allow independent testing.

### A03.1.1 Customer Profile client adapter

- Add a typed client for the schema and evaluate endpoints.
- Centralize base URL, auth headers, timeout, retry, and response-shape handling.
- Preserve typed blocked responses separately from transport failures.
- Never expose arbitrary URL/query/SQL controls through the workspace API.

### A03.1.2 Schema hook/service

- Load and cache the A02 schema for the workspace session.
- Expose field definitions, allowed operators, limits, version pairing, PII constraints, and
  affinity metadata to the editor.
- Fail closed when the schema is unavailable; do not use a stale hardcoded registry as a semantic
  fallback.

### A03.1.3 Definition editor

- Implement scalar, affinity, AND, OR, and NOT editing.
- Keep draft state separate from presentation state.
- Enforce depth, condition, and IN-value UX limits.
- Serialize only the A02 definition contract.
- Render server validation paths without dropping the draft.

### A03.1.4 Evaluation summary

- Implement IDLE/VALIDATING/EVALUATING/COMPLETED/BLOCKED/ERROR states.
- Display matched, universe, percentage, TRUE, FALSE, and UNKNOWN.
- Mark results stale after any semantic edit.
- Preserve the last result during a new request or recoverable error with clear labelling.

### A03.1.5 Preview table

- Render the bounded A02 preview with default and optional columns.
- Implement `matchedCount > preview.returned` messaging.
- Display missing component availability and degraded enrichment explicitly.
- Do not add pagination, full-membership assumptions, or per-row profile requests.

### A03.1.6 Context and error states

- Add the collapsed technical context panel.
- Map typed A02 reasons and HTTP auth/service failures to actionable copy.
- Keep lineage read-only and preserve response versions/checksums.

### A03.1.7 Navigation and access integration

- Add the workspace route in CRM using existing navigation and permissions conventions.
- Gate the workspace on the A02 capability availability and CRM authorization.
- Keep the feature behind a rollout flag until production A02 validation is confirmed.

### A03.1.8 R3 seam and A04 seam

- Reserve interfaces for a future definition proposal and result interpretation, without enabling
  unimplemented conversation behavior.
- Reserve export action slots without exporting preview data.
- Do not add durable saved-audience tables in these slices.

## TEST_STRATEGY

No CRM tests are implemented by A03.0. A03.1 should include the following tests.

### Contract and schema mapping

- schema fields map to the correct grouped labels and types;
- only operators returned in `allowedOperators` are offered;
- unknown/future fields use safe fallback presentation;
- limits and version pairing are displayed from schema metadata; and
- PII fields never appear in the preview column configuration.

### Definition serialization

- scalar EQ/GTE/LTE/BETWEEN/IN and null tests serialize losslessly;
- AND and OR preserve child order and semantics;
- NOT always contains one child;
- nested groups respect maximum depth;
- affinity axes and qualifiers serialize unchanged; and
- draft presentation state is not sent in the definition.

### Validation and evaluation states

- no criteria stays IDLE and cannot submit;
- local limit validation prevents avoidable requests;
- A02 invalid-definition paths focus the right control;
- completed results render matched/universe/percentage correctly;
- TRUE, FALSE, and UNKNOWN remain separate;
- zero matches is not shown as truncated;
- all-match and bounded-match cases show the correct preview message;
- `matchedCount > preview.returned` displays truncation;
- enrichment degradation does not change evaluation counts;
- unavailable components show BLOCKED rather than zero matches; and
- a changed draft marks the prior result stale.

### Integration and failure behavior

- schema/evaluate request payloads contain only the approved A02 fields;
- 401, 404, 503, and 504 responses preserve the draft and show appropriate recovery;
- malformed responses do not render partial authoritative results;
- duplicate evaluate clicks do not create concurrent accidental submissions;
- retry is bounded and deliberate; and
- no test relies on CRM-Customer-360 implementation details.

### Accessibility and usability

- status is conveyed by text and semantic labels, not color alone;
- condition rows and nested groups have accessible names and keyboard order;
- loading, blocked, UNKNOWN, and degraded states are announced appropriately;
- currency, dates, ratios, and counts use locale-aware accessible formatting; and
- the preview communicates its bounded nature to screen readers as well as visually.

## AFFINITY_CODE_REGISTRY_REQUIREMENT

This is a release gate for dropdown/autocomplete affinity controls. The authoritative registry must
be Catalog-owned, immutable/versioned, and checksummed. It must provide code identity and display
metadata for `PRODUCT_FAMILY`, `DISCIPLINE`, and `USE_CONTEXT`, plus the ontology/version lineage
needed to determine whether a code is current, deprecated, or replaced.

Until that contract is available, A03.1 may use only an opaque text entry that delegates validation
to A02. It must not infer valid codes from preview rows, production data, copied examples, or a
local enum. This preserves the boundary even if temporary manual entry is less convenient.

## DECISION

`CUSTOMER_INTELLIGENCE_AUDIENCE_A03_WORKSPACE_DESIGNED`

The next implementation release, when the CRM repository is available and separately authorized,
is A03.1: a schema-driven, structured CRM workspace over the existing A02 endpoints, with explicit
evaluation, bounded preview, truthful UNKNOWN handling, ephemeral iterations, and a reserved seam
for future R3. No A03.0 production code or CRM-Customer-360 change is required.

## FINAL_OUTPUT

```text
DESIGN_DECISION: CRM-hosted schema-driven deterministic workspace over A02; no local membership logic.
USER_MENTAL_MODEL: Build a customer question with visible business criteria and receive a verified result.
WORKSPACE_STRUCTURE: Intent seam, structured definition, evaluation summary, bounded preview, technical context.
DEFINITION_EDITOR: Lossless AudienceDefinitionV1 editor for SCALAR, HAS_AFFINITY, AND, OR, and NOT.
FIELD_PRESENTATION: Product-language groups with schema-derived capabilities and CRM-owned display metadata.
AFFINITY_UX: Axis plus opaque code and qualifiers; manual entry until the Catalog registry exists.
EVALUATION_STATES: IDLE, VALIDATING, EVALUATING, COMPLETED, BLOCKED, and ERROR with stale-result handling.
UNKNOWN_UX: Separate neutral metric and explanation; never represented as FALSE or zero.
PREVIEW: Bounded A02 table; show matchedCount versus returned; no pagination or PII.
R3_FUTURE_INTEGRATION: R3 proposes the same structured definition; A02 remains the evaluator.
ITERATION_MODEL: Ephemeral page/session state; no durable iteration or membership persistence in A03.1.
CRM_BOUNDARY: Presentation, editing, interaction, temporary state, and future assistant surface.
CUSTOMER_PROFILE_BOUNDARY: Schema, validation, context, truth, preview, lineage, and availability.
A02_API_SUFFICIENCY: SUFFICIENT_FOR_A03_1_CORE; existing schema and evaluate endpoints are enough.
EDGE_STATES: Explicit behavior for empty, zero, all-match, UNKNOWN, unavailable, invalid, degraded, and auth states.
PERFORMANCE_UX: Explicit Evaluate action, no keystroke evaluation, bounded retry, loading skeletons.
A04_HANDOFF: Reserve disabled export actions; future export must use immutable authoritative membership.
A03_1_IMPLEMENTATION_PLAN: Client adapter, schema service, editor, summary, preview, errors, navigation, seams.
TEST_STRATEGY: Contract, serialization, evaluation states, failure, accessibility, and bounded-preview tests.
AFFINITY_CODE_REGISTRY_REQUIREMENT: Catalog-owned immutable/versioned/checksummed code set before dropdowns.
DECISION: CUSTOMER_INTELLIGENCE_AUDIENCE_A03_WORKSPACE_DESIGNED
```
