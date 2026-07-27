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

This repository currently contains only base project structure and TypeScript contracts. The Customer Profile endpoint is intentionally not implemented yet.

Planned endpoint:

```text
GET /v1/customers/{masterCustomerId}/profile
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
