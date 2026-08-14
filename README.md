# MS-pesaschile-customer-profile

Read-oriented Customer Profile microservice for PesasChile.

This service currently serves PrestaShop customer data directly. The public runtime identifier is `customerId`, interpreted as `ps_customer.id_customer`.

## Sources

- Runtime identity and customer data: PrestaShop (`pesas_productiva`), centered on `ps_customer`, `ps_orders` and `ps_order_detail`.
- CRM is optional diagnostic context only in this stage. It is not required for runtime reads or readiness.

## Scope

`GET /v1/customers/{customerId}/profile` returns a direct PrestaShop customer profile with recent orders, preserving current business fields and adding `provenance`.

`GET /v1/customers/{customerId}/orders/{reference}/status` returns the latest order state recorded in PrestaShop for a specific order owned by that same `customerId`.

`GET /v1/customers/{customerId}/commercial-summary` returns aggregated historical commerce metrics derived from valid PrestaShop orders.

`GET /v1/customers/{customerId}/purchased-products` returns aggregated historical purchased products derived from valid PrestaShop order lines.

`GET /v1/customers/{customerId}/purchase-behavior` returns derived purchase behavior metrics calculated from valid PrestaShop order lines.

`GET /v1/customers/{masterCustomerId}/rfm` returns the current published RFM snapshot row for the canonical CRM customer identity, including raw RFM metrics, scores, segment and snapshot metadata.

Every useful response now includes:

- `customerId`
- `provenance.customerIdentity`
- `provenance.dataSources`
- `provenance.generatedAt`
- `provenance.contractVersion = customer-profile-prestashop-direct-v1`

`GET /health/ready` depends only on the PrestaShop runtime contract required by this stage:

- connectivity
- `ps_customer`
- `ps_orders`
- `ps_order_detail`

CRM incompatibility must not block readiness.

```text
GET /v1/customers/{customerId}/profile
GET /v1/customers/{customerId}/orders/{reference}/status
GET /v1/customers/{customerId}/commercial-summary
GET /v1/customers/{customerId}/purchased-products
GET /v1/customers/{customerId}/purchase-behavior
GET /v1/customers/{masterCustomerId}/rfm
GET /health
GET /health/ready
```

## Identity

Current identity authority:
`ps_customer.id_customer`

Future canonical identity authority:
`master_customer.id`

Current runtime exception:
`GET /v1/customers/{masterCustomerId}/rfm` already uses canonical `masterCustomerId` because persisted RFM snapshots are materialized and consumed against `master_customer.id`.

For migrated PrestaShop customers, the planned compatibility assumption remains:
`master_customer.id = ps_customer.id_customer`

That future migration is documented but not implemented in this stage.

### Breaking change: `customerId` is not `masterCustomerId`

The five non-RFM routes above kept their URL shape (`/v1/customers/{id}/...`) across
this change, but the identifier they accept did not: it used to be
`masterCustomerId` (`master_customer.id`, resolved through
`master_customer.prestashop_customer_id`), it is now `customerId`
(`ps_customer.id_customer`), read directly. `masterCustomerId` is no longer
accepted by those five routes, there is no automatic translation between the two
ID spaces, and a numerically valid `masterCustomerId` cannot be told apart
from a valid `customerId` by format alone — both are positive numeric
strings. Any existing consumer must migrate explicitly. Full before/after
contract table:
[`docs/releases/CP-R1-T12A-direct-prestashop-customer-input.md`](docs/releases/CP-R1-T12A-direct-prestashop-customer-input.md#breaking-contract-mastercustomerid---customerid).

### `customer.rut` is always `null`

`profile.customer.rut` in `GET /v1/customers/{customerId}/profile` is always
`null` in this contract version (`customer-profile-prestashop-direct-v1`):
`rut` came exclusively from `master_customer.rut`, which this service no
longer reads. It is not resolved by DNI/PII, not fabricated, and recovering
it is out of scope for this stage — see
[`docs/releases/CP-R1-T12A-direct-prestashop-customer-input.md`](docs/releases/CP-R1-T12A-direct-prestashop-customer-input.md#field-changes-customerrut).

## Security and Logging

- CRM is read at runtime only for canonical `masterCustomerId`-based capabilities such as `GET /v1/customers/{masterCustomerId}/rfm`.
- No email-, phone- or RUT-based lookup.
- No writes to PrestaShop.
- Logs include safe technical metadata such as `customerId` or `masterCustomerId`, `identitySource`, `contractVersion`, endpoint status and duration.
- Logs do not include raw SQL errors, credentials or customer PII.
- No service-to-service auth is implemented inside this repo yet; any auth must be enforced upstream.

## Development

```bash
npm run typecheck
npm run lint
npm run build
npm test
npm run snapshot:rfm
npm run snapshot:rfm:scheduled
```

`npm run snapshot:rfm` remains the manual/backfill entrypoint. It accepts an explicit `RFM_REFERENCE_TIME` and can still be used in `RFM_DRY_RUN=true`.

`npm run snapshot:rfm:scheduled` is the production worker entrypoint meant to be triggered by an external scheduler (for example cron or the platform scheduler). It computes the daily `referenceTime` automatically at the UTC start-of-day boundary, acquires a DB-backed execution lock and records each run in `customer_rfm_snapshot_run`.
