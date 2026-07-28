# MS-pesaschile-customer-profile

Read-oriented Customer Profile microservice for PesasChile.

This service will expose commercial customer profile snapshots for two future consumers:

- CRM Customer 360.
- Autonomous sales worker.

The public customer identifier is always `masterCustomerId`.

`ps_customer.id_customer` is an internal operational reference used only after identity has been resolved from CRM identity data. It must never become the public customer identity.

## Sources

- CRM source: `main_management`, centered on `master_customer`.
- PrestaShop source: `pesas_productiva`, centered on `ps_customer`, orders, order details, carts, discounts, addresses, and service metadata.

CRM and PrestaShop have separate logical connection settings even when they share physical infrastructure.

## Scope

`GET /v1/customers/{masterCustomerId}/profile` is implemented as a minimal runtime read foundation (CP-R1-T03): given a `masterCustomerId` already confirmed by onboarding / Identity Resolver, it reads `master_customer`, reads the linked `ps_customer` if any, and returns `available` / `partial` / `not_found` / `degraded`. It does **not** yet return commercial history — no orders, no spend, no addresses, no active opportunity. See [`docs/design/CP-R1-T03-customer-profile-runtime-read-foundation.md`](docs/design/CP-R1-T03-customer-profile-runtime-read-foundation.md) for the full contract.

This endpoint is internal and read-only, with no email-based lookup and no service-to-service authentication yet — it is not fit for public exposure without a gateway/auth layer in front.

`GET /health/ready` checks CRM connectivity *and* minimal schema compatibility (not just "can we connect"): if `master_customer.prestashop_customer_id` is missing, it reports `503 not_ready` with `reason: crm_schema_incompatible` instead of announcing `ready` and only failing on the first real profile request. Logs never contain a raw MySQL driver message (which can include host, port or user) — only a closed set of safe labels such as `crm_unavailable` or `prestashop_timeout`.

```text
GET /v1/customers/{masterCustomerId}/profile
GET /health
GET /health/ready
```

## Out Of Scope

- Creating customers.
- Merging customers.
- Creating opportunities.
- Managing conversations or messages.
- Making commercial decisions.
- Writing to PrestaShop.
- A monolithic Customer 360.
- Worker implementation.
- Identity graph, probabilistic matching, event sourcing, queues, CQRS, or ORM.

## Development

```bash
npm run typecheck
npm run lint
npm test
```
