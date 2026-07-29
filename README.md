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

`GET /v1/customers/{masterCustomerId}/profile` is implemented as a minimal runtime read foundation (CP-R1-T03): given a `masterCustomerId` already confirmed by onboarding / Identity Resolver, it reads `master_customer`, reads the linked `ps_customer` if any, and returns `available` / `partial` / `not_found` / `degraded`. See [`docs/design/CP-R1-T03-customer-profile-runtime-read-foundation.md`](docs/design/CP-R1-T03-customer-profile-runtime-read-foundation.md) for the full contract.

Customer Profile incluye hasta N órdenes recientes pagadas según la regla empresarial de PesasChile (`CUSTOMER_PROFILE_RECENT_ORDERS_LIMIT`, default 10, máx. 50): toda fila persistida en `ps_orders` cuenta como orden pagada. Ver [`docs/design/CP-R1-T04-customer-orders-read-model.md`](docs/design/CP-R1-T04-customer-orders-read-model.md).

Cada `recentOrder` ahora incluye además `currentState` (CP-R1-T05): el nombre del estado (`ps_order_state_lang.name`, en el idioma configurado por `PRESTASHOP_ORDER_STATE_LANG_ID`) cuando PrestaShop tiene una traducción para ese `currentStateId`, o `{ name: null, resolution: 'unknown' }` si no la tiene — sin que eso degrade el resto del perfil. Ver [`docs/design/CP-R1-T05-order-state-context-read-model.md`](docs/design/CP-R1-T05-order-state-context-read-model.md). El nombre proviene tal cual de PrestaShop: todavía **no** existe interpretación semántica (no hay "despachado"/"entregado" derivado de keywords), ni tracking real, ni la capacidad de que Sales AI consulte cualquier pedido por referencia, teléfono o email. Sigue sin devolver spend agregado, direcciones ni oportunidad activa.

`GET /v1/customers/{masterCustomerId}/orders/{reference}/status` (CP-R1-T06) responde el estado de **una** orden puntual de un cliente: último `currentStateId`/nombre registrado en PrestaShop, `deliveryMethod` (derivado de un mapa de negocio explícito sobre `id_carrier`), un `deliveryEstimate` general declarado por método (nunca una fecha calculada) y `isRealTimeTracking: false` siempre presente. La pertenencia de la orden al cliente se valida en la misma consulta (`id_customer AND reference`); una orden inexistente y una que pertenece a otro cliente producen exactamente el mismo `order_not_found`. No usa `ps_order_history`, no clasifica por keywords ni por flags, no calcula ETA ni feriados, y no integra con ningún Carrier MS. Ver [`docs/releases/CP-R1-T06-customer-order-status-capability.md`](docs/releases/CP-R1-T06-customer-order-status-capability.md).

`GET /v1/customers/{masterCustomerId}/commercial-summary` (CP-R1-T07) responde un resumen comercial agregado, bajo demanda y directamente contra PrestaShop, para clientes vinculados por `master_customer.prestashop_customer_id`. Una compra comercial valida es exclusivamente `ps_orders.valid = 1`: no usa existencia de fila, `current_state = 2`, flags `paid`, nombres de estados ni `ps_order_history`. Devuelve totales de ordenes validas, gasto bruto tax-incl en strings de seis decimales, promedio, primera/ultima compra, recencia, frecuencia, unidades brutas, productos distintos agregados, cancelaciones (`current_state = 6`) y reembolsos (`current_state = 7`). La moneda publica es fija `CLP`. No devuelve productos individuales, `product_name`, referencias, categorias, segmentacion, recomendaciones ni cambia `/profile`. Ver [`docs/releases/CP-R1-T07-customer-commercial-summary.md`](docs/releases/CP-R1-T07-customer-commercial-summary.md).

This endpoint is internal and read-only, with no email-based lookup and no service-to-service authentication yet — it is not fit for public exposure without a gateway/auth layer in front.

`GET /health/ready` checks CRM connectivity *and* minimal schema compatibility (not just "can we connect"): if `master_customer.prestashop_customer_id` is missing, it reports `503 not_ready` with `reason: crm_schema_incompatible` instead of announcing `ready` and only failing on the first real profile request. Logs never contain a raw MySQL driver message (which can include host, port or user) — only a closed set of safe labels such as `crm_unavailable` or `prestashop_timeout`.

```text
GET /v1/customers/{masterCustomerId}/profile
GET /v1/customers/{masterCustomerId}/orders/{reference}/status
GET /v1/customers/{masterCustomerId}/commercial-summary
GET /health
GET /health/ready
```

### Environment (CP-R1-T06)

`PRESTASHOP_CARRIER_LANG_ID` / `PRESTASHOP_CARRIER_SHOP_ID` (`ps_carrier_lang.id_lang` / `id_shop`, para leer `delay`): obligatorias, sin default silencioso — deliberadamente independientes de `PRESTASHOP_ORDER_STATE_LANG_ID` aunque puedan terminar apuntando al mismo idioma en la instalación real.

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
