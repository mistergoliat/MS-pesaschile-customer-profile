# CP-R1-T12A Direct PrestaShop Customer Input

Date: August 5, 2026

## Problem

Customer Profile depended on `master_customer.prestashop_customer_id` at runtime. In the current environment that CRM column is not available, which caused `GET /health/ready` to return `503 crm_schema_incompatible` even though the actual business data used by the service already lives in PrestaShop.

## Architectural Decision

Runtime identity is now resolved directly from `ps_customer.id_customer`.

- Current identity authority: `ps_customer.id_customer`
- Identity source: `PRESTASHOP`
- Identity status: `DIRECT_SOURCE`
- Contract version: `customer-profile-prestashop-direct-v1`

No runtime CRM lookup is used by the customer-facing HTTP capabilities in this task.

## Initial Audit Matrix

| Capability | Current Input | Current Data Source | Current CRM Dependency | Target Input | Target Data Source | HTTP Contract Impact | Change Required |
| --- | --- | --- | --- | --- | --- | --- | --- |
| routes | `:masterCustomerId` | route params | hard-coded param naming and 400 error naming | `:customerId` | route params | `invalid_customer_id`, `invalid_order_reference`, provenance | yes |
| controllers | `masterCustomerId` string | HTTP adapters | request parsing and logs referenced CRM naming | `customerId` number | HTTP adapters | readiness and logs changed | yes |
| request schemas | numeric text for `masterCustomerId` | Zod | name and zero-handling tied to old contract | numeric positive `customerId` | Zod + numeric parse | 400 mapping updated | yes |
| use cases | `masterCustomerId -> master_customer -> prestashop_customer_id` | CRM + PrestaShop | blocking | `customerId -> ps_customer` | PrestaShop only | no partial state, provenance added | yes |
| repositories | `master_customer` + PrestaShop readers | CRM + PrestaShop | blocking | `ps_customer` identity repo + PrestaShop readers | PrestaShop only | sanitized schema errors | yes |
| dependency injection | CRM reader in all use cases | bootstrap | blocking | shared identity resolver | bootstrap | no CRM runtime wiring | yes |
| health/readiness | CRM schema gate | CRM + simple PrestaShop ping | blocking | PrestaShop schema gate only | PrestaShop | 200 ready with optional `crm: false` | yes |
| OpenAPI/docs equivalent | README/overview described `masterCustomerId` | docs | stale | README/overview/release note updated | docs | yes | yes |
| integration tests | mocked `masterCustomerId` contract | HTTP tests | stale | direct `customerId` + provenance | tests | yes | yes |
| error mapping | `invalid_master_customer_id`, `invalid_reference`, timeouts surfaced separately | HTTP + use cases | stale | `invalid_customer_id`, `invalid_order_reference`, `prestashop_unavailable`, `prestashop_schema_incompatible`, `customer_profile_unavailable` | code/tests | yes | yes |
| logging | mixed old field names | HTTP adapters | stale | `customerId`, `identitySource`, `identityStatus`, `contractVersion` | HTTP adapters | yes | yes |

## Previous Flow

```text
customer request
-> masterCustomerId
-> read master_customer
-> read prestashop_customer_id
-> query PrestaShop by linked id
-> return response
```

## New Flow

```text
customer request
-> customerId
-> validate ps_customer.id_customer exists
-> query PrestaShop with the same customerId
-> add provenance
-> return response
```

## Identity Contract

```ts
type CustomerIdentity = {
  customerId: number;
  externalCustomerId: number;
  identitySource: "PRESTASHOP";
  identityStatus: "DIRECT_SOURCE";
  sourceMetadata: {
    platform: "PRESTASHOP";
    entity: "ps_customer";
    primaryKey: "id_customer";
  };
};
```

## Provenance Contract

All useful endpoint responses now include:

```ts
type CustomerDataProvenance = {
  customerIdentity: {
    customerId: number;
    source: "PRESTASHOP";
    externalCustomerId: string;
    status: "DIRECT_SOURCE";
  };
  dataSources: Array<{
    source: "PRESTASHOP";
    entity:
      | "ps_customer"
      | "ps_orders"
      | "ps_order_detail"
      | "ps_order_cart_rule"
      | "derived_purchase_behavior";
    purpose: string;
  }>;
  generatedAt: string;
  contractVersion: "customer-profile-prestashop-direct-v1";
};
```

## Endpoint Results

- `/profile`: available with direct PrestaShop customer data, recent orders and provenance.
- `/commercial-summary`: available with historical metrics and provenance.
- `/purchased-products`: available with aggregated purchased products and provenance.
- `/purchase-behavior`: available with derived metrics and provenance.
- `/orders/{reference}/status`: available with order status and provenance.

## Readiness

`GET /health/ready` now returns `200` when PrestaShop is available and the required schema is compatible, even if CRM is unavailable or incompatible.

Expected ready payload:

```json
{
  "status": "ready",
  "prestashop": true,
  "crm": false,
  "customerIdentitySource": "PRESTASHOP",
  "identityStatus": "DIRECT_SOURCE",
  "contractVersion": "customer-profile-prestashop-direct-v1"
}
```

## CRM Dependencies Removed

Removed from runtime flow:

- `master_customer` existence lookup
- `prestashop_customer_id` lookup
- CRM-gated readiness
- runtime distinction between linked and not-linked customer states

## Errors

Maintained input errors:

- `invalid_customer_id`
- `invalid_limit`
- `invalid_offset`
- `invalid_top_products`
- `invalid_top_variants`
- `invalid_order_reference`

Sanitized runtime degradation labels:

- `prestashop_unavailable`
- `prestashop_schema_incompatible`
- `customer_profile_unavailable`

## Security

- No raw SQL or credentials are returned.
- No PII is used for identity resolution.
- Logs use technical identifiers only.
- No writes are performed in PrestaShop.

## Tests

Validation executed on August 5, 2026:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm test`

All passed.

Added or adapted coverage for:

- direct identity resolution
- direct `ps_customer` identity repository
- PrestaShop readiness
- provenance presence
- readiness contract
- HTTP contract updates

## Live Results

Live local verification on August 5, 2026 with technical customer id `22066`:

- `GET /health` -> `200`
- `GET /health/ready` -> `200`
- `GET /v1/customers/22066/profile` -> `200 available`
- `GET /v1/customers/22066/commercial-summary` -> `200 available`
- `GET /v1/customers/22066/purchased-products` -> `200 available`
- `GET /v1/customers/22066/purchase-behavior` -> `200 available`

Observed:

- `contractVersion = customer-profile-prestashop-direct-v1`
- consistent `customerId = 22066`
- logs contained no obvious PII signals during the live run

## Breaking Contract: `masterCustomerId` -> `customerId`

The URL **shape** of all five customer-scoped routes is unchanged — same path
segments, same position for the identifier:

```text
GET /v1/customers/{id}/profile
GET /v1/customers/{id}/orders/{reference}/status
GET /v1/customers/{id}/commercial-summary
GET /v1/customers/{id}/purchased-products
GET /v1/customers/{id}/purchase-behavior
```

What changed is the **meaning** of `{id}`. This is a breaking change even
though no route was renamed or moved.

| | Before (pre-T12A) | After (T12A) |
| --- | --- | --- |
| Path parameter name | `masterCustomerId` | `customerId` |
| Identity space | `master_customer.id` (CRM) | `ps_customer.id_customer` (PrestaShop) |
| Format | numeric string, `1..20` digits | numeric string, `1..20` digits |
| Resolution | `master_customer` lookup, then follow `prestashop_customer_id` | direct `ps_customer.id_customer` lookup, no indirection |
| Not-linked customer | `status: 'partial'`, `linkStatus: 'not_linked'` | does not exist — a customer either resolves or is `not_found` |
| Invalid-id error | `invalid_master_customer_id` | `invalid_customer_id` |
| Invalid-reference error | `invalid_reference` | `invalid_order_reference` |
| Response identity fields | `masterCustomerId`, `linkStatus`, `prestashopCustomerId` | `customerId`, `provenance.customerIdentity.*` |
| Readiness gate | CRM schema (`master_customer.prestashop_customer_id`) | PrestaShop schema (`ps_customer`/`ps_orders`/`ps_order_detail`) |
| CRM required at runtime | yes | no |

Consequences that follow directly from the table above:

- **`masterCustomerId` is no longer accepted by these five routes.** There is
  no code path in this service, after this change, that reads
  `master_customer` for a customer-scoped HTTP request.
- **A valid `masterCustomerId` value cannot be distinguished from a valid
  `customerId` value by format alone.** Both are positive numeric strings up
  to 20 digits (see `mysql-prestashop-customer-identity-repository.ts` and the
  legacy `master_customer.id` column) — the service cannot detect "this looks
  like the old identity space" and reject or redirect it. A caller that keeps
  sending `master_customer.id` values gets either `not_found` (if that number
  does not exist as a `ps_customer.id_customer`) or, worse, a response for a
  **different, wrong customer** (if it happens to collide with a real
  `ps_customer.id_customer`) — never a loud, distinguishable error.
- **There is no automatic resolution between the two identity spaces.**
  `master_customer.prestashop_customer_id` is not consulted anywhere in this
  request path anymore (see "CRM Dependencies Removed" above). Bridging the
  two ID spaces, if ever needed, is a caller-side or future-task concern, not
  something this service does implicitly.
- **Any existing consumer must migrate explicitly** — there is no
  compatibility shim, no dual-read, no silent fallback from `customerId` back
  to `masterCustomerId`. This was a deliberate choice: guessing which ID space
  a numeric value belongs to would be more dangerous than requiring an
  explicit migration.
- **The migration to a canonical identity (`master_customer.id` as the public
  identifier again, with PrestaShop as one linked source among others) is
  deferred**, not abandoned — see `MASTER_CUSTOMER_MIGRATION_DEFERRED` in the
  Verdict section and `CP-R1-T12B`'s "next task" pointer below.

### Cross-repo consumer check (2026-08-06)

Audited `CRM-Customer-360` and the catalog-service (`MS-Stock/services`)
repos for anything still sending `masterCustomerId` to this service:

- `CRM-Customer-360/lib/customer-profile/httpCustomerProfileAdapter.ts`
  (T10B1) still targets the old `masterCustomerId` contract, but has zero
  call sites outside its own test — it is not wired into the agent loop, the
  capability gateway, or `buildCustomerRecommendationContext` (the only
  consumer designed to use its output). `CP-R1-T12B`/`CP-R1-T12C` (2026-08-05)
  added the correct `customerId`-based client
  (`lib/integrations/customer-profile/*`) and wired it into the live
  commercial agent loop instead, with a guard-rail test
  (`tests/commercial/customerProfileLegacyImportGuard.test.ts`) preventing the
  legacy path from being reintroduced. `CUSTOMER_PROFILE_SERVICE_BASE_URL` is
  unset in `.env.example`.
- `MS-Stock/services/src/infrastructure/recommendation/httpCustomerAffinityEvidenceProvider.ts`
  (T10B4B) also targets the old `masterCustomerId` contract and *is* wired
  into `src/bootstrap.ts` / `src/recommendationRuntime.ts`, but only activates
  when `CUSTOMER_AFFINITY_PROVIDER_MODE=http` — `.env.example` defaults that
  flag to `unavailable`.

Neither path fires by default in either repo's example configuration. This
check only covers what is visible in-repo (both `.env.example` files, not any
real deployed `.env`) — it is not a substitute for confirming actual
production configuration before treating this as fully risk-free.

## Field Changes: `customer.rut`

`profile.customer.rut` is now **always `null`** in every `available` response
from `GET /v1/customers/{customerId}/profile`.

- **Cause**: `rut` was sourced exclusively from `master_customer.rut` (see
  the pre-T12A `buildSnapshot`, which read `master.rut` directly). Since
  `master_customer` is no longer read anywhere in this request path, there is
  no source left to populate it from.
- **Not resolved by PII.** This service does not look up `rut` by DNI, name,
  email, phone, or any other PII-based match — `ps_customer` does not carry a
  `rut` column, and no such lookup was added.
- **Not fabricated.** The field is not defaulted to an empty string, not
  inferred, not backfilled from another table — it is the literal, typed
  value `null`, which is part of the public `CustomerProfileSnapshot`
  contract (`customer.rut: string | null`), not an omission.
- **Out of scope for this task.** Recovering `rut` (e.g. once the canonical
  identity migration in `MASTER_CUSTOMER_MIGRATION_DEFERRED` happens) is
  explicitly deferred, not addressed here.
- **Consumers must not assume `rut` is populated.** Any code that previously
  relied on a real `master_customer.rut` value from this endpoint will now
  always see `null` and must be updated to treat that as an expected,
  permanent state of this contract version
  (`customer-profile-prestashop-direct-v1`), not a transient degradation.

This is frozen by test:
`tests/unit/get-customer-profile.test.ts` ->
`"rut is always null in the direct PrestaShop contract, regardless of input"`.

## Risks

- `/orders/{reference}/status` was not exercised live in this pass because no safe technical reference was selected for the report.
- Future migration to `master_customer.id` will still require a contract transition plan, but provenance now cleanly separates the direct identity model from the future canonical one.
- Two `masterCustomerId`-based clients exist in sibling repos (see "Cross-repo
  consumer check" above). Neither is active by default today, but both are
  real, production-quality code that would silently misinterpret `customerId`
  values if ever enabled without first migrating to the new contract.

## Verdict

`DIRECT_PRESTASHOP_CUSTOMER_INPUT_VALIDATED`

Conditions:

- `CUSTOMER_ID_EQUALS_PRESTASHOP_CUSTOMER_ID`
- `CRM_NOT_REQUIRED_FOR_RUNTIME`
- `PRESTASHOP_IS_CURRENT_IDENTITY_SOURCE`
- `PROVENANCE_METADATA_EXPOSED`
- `HTTP_CONTRACT_READY_FOR_SALES_AGENT`
- `MASTER_CUSTOMER_MIGRATION_DEFERRED`
- `BREVO_INTEGRATION_DEFERRED`

## Next Task

`CP-R1-T12B Sales Agent Customer Profile HTTP Client`
