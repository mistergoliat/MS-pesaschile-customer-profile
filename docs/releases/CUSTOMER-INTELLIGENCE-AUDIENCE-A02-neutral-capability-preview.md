# CUSTOMER-INTELLIGENCE-AUDIENCE-A02 — Neutral Audience Capability + Preview Transport

Status: `READY_WITH_DOCUMENTED_DEBT`

## Purpose

A02 exposes the deterministic A01 Audience evaluator to authorized application consumers. It
provides schema discovery, evaluation, and a bounded human-inspection preview. Customer Profile
remains authoritative for definition validation, membership truth, temporal context, and preview
lineage. CRM Audience Workspace and R3 are future consumers, not part of this release.

## Capability and HTTP contract

Capability version: `customer-intelligence-audience-capability-v1`.

- `GET /v1/customer-intelligence/audiences/schema`
- `POST /v1/customer-intelligence/audiences/evaluate`

The evaluate request is `{ definition: AudienceDefinitionV1, previewLimit?: number }`. The HTTP
boundary intentionally does not accept snapshot ids, context checksums, customer-id truth lists,
SQL, or arbitrary identifiers. Context is resolved server-side from the latest published Feature
Snapshot and compatible published component snapshots at or before its reference time.

The response is `{ capabilityVersion, evaluation, preview }`. `evaluation` is the typed A01
result, including TRUE/FALSE/UNKNOWN reconciliation, definition checksum, resolved context,
lineage, counts, and bounded raw member ids. `preview` is a separate
`customer-intelligence-audience-preview-v1` envelope. Preview enrichment cannot alter evaluation
counts, checksums, or context.

## Schema discovery

The schema is generated from `AUDIENCE_FIELD_REGISTRY_V1`, including descriptions, scalar types,
nullability, units, and operators. `HAS_AFFINITY` exposes the three supported axes:
`PRODUCT_FAMILY`, `DISCIPLINE`, and `USE_CONTEXT`. Affinity codes remain opaque because a
Catalog-owned versioned code registry is not available; no code list is fabricated or copied into
Customer Profile.

RFM segment codes are paired with the resolved segment version. Cluster ids are paired with the
resolved cluster model version. Definitions that explicitly contradict the resolved pairing are
blocked.

## Preview, limits, and lineage

The practical default preview limit is 50 and the A02 HTTP maximum is 100, which is below the A01
hard maximum of 1,000. Preview reads are one set-based query for the returned ids and use the exact
feature, RFM, cluster, CLV, and affinity snapshot ids from `evaluation.context`. Commercial
features, raw RFM scores, cluster label/id, CLV revenue/support, and bounded normalized affinity
rows are available where the component row exists; affinity output is limited to the top three
rows per axis using deterministic score/code ordering. Missing components are represented explicitly;
enrichment degradation is reported without changing evaluation truth. No per-customer profile
orchestration is used.

Preview excludes email, phone, address, RUT, consent, channel eligibility, and all other PII.
There is no full membership export, pagination, persistence, or campaign behavior.

## Security and ownership

Both endpoints require the established constant-time internal token boundary. The current service
reuses `MARKETING_COPILOT_INTERNAL_TOKEN` and accepts the established copilot header plus the
neutral `x-internal-customer-intelligence-token` header. Anonymous access is denied. Fixed
registry validation and the SELECT-only compiler prevent arbitrary SQL. Full consumer-specific
RBAC and separate audience credentials remain authorization debt.

## Readiness

The contract is `R3_READY_WITH_DOCUMENTED_DEBT`: an adapter can inspect schema, construct a
versioned definition, evaluate, inspect counts/preview, and repeat without conversational state.
It is CRM-ready for dynamic controls, structured definition display, counts, and a preview table;
no frontend is included.

## A03 prerequisites

A03 may build a CRM workspace on this boundary after operational deployment validation of the
analytics database query plans and provisioning of the Catalog-owned affinity code registry.
A03 must continue to treat `UNKNOWN` separately from `FALSE`, preserve the returned context and
checksums, and keep preview display distinct from audience truth. Export, saved audiences,
contactability, and campaign integrations remain later roadmap work.

## Explicit non-goals

No XLSX/CSV export, full membership export, persistence, saved definitions, Brevo, contactability,
R3 integration, Copilot orchestration, natural-language parsing, diagnostic recommendations,
product recommendation logic, new ontology ownership, or arbitrary analytical SQL is included.
