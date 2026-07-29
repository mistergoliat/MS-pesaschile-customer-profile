# CP-R1-T07 Customer Commercial Summary

## Objetivo

Agregar una capacidad read-only para consultar, bajo demanda, un resumen comercial agregado de un cliente:

```text
GET /v1/customers/{masterCustomerId}/commercial-summary
```

El endpoint es separado de `/v1/customers/{masterCustomerId}/profile` y no modifica su contrato.

## Fuente De Datos

El flujo parte desde `master_customer` mediante `masterCustomerId`. Solo si el master existe y tiene `prestashop_customer_id`, el servicio consulta PrestaShop directamente en runtime.

Las compras comerciales se calculan exclusivamente desde `ps_orders.valid = 1`. No se usa `current_state = 2`, `ps_order_state.paid`, nombres de estados, keywords ni `ps_order_history`.

## Formulas

- `totalOrders`: cantidad de ordenes del cliente con `valid = 1`.
- `totalSpentTaxIncl`: suma bruta de `total_paid_tax_incl` para ordenes con `valid = 1`.
- `averageOrderValueTaxIncl`: `totalSpentTaxIncl / totalOrders`; con cero ordenes devuelve `"0.000000"`.
- `firstOrderAt`: primera `date_add` entre ordenes validas.
- `lastOrderAt`: ultima `date_add` entre ordenes validas.
- `daysSinceLastOrder`: dias completos entre `Clock.now()` y `lastOrderAt`, calculado en la aplicacion.
- `purchaseFrequencyDays`: `(lastOrderAt - firstOrderAt) / (totalOrders - 1)`; con menos de dos ordenes devuelve `null`.
- `totalUnitsPurchased`: suma bruta de `ps_order_detail.product_quantity` para lineas de ordenes validas.
- `distinctProductsPurchased`: `COUNT(DISTINCT product_id)` para ordenes validas.
- `cancelledOrderCount`: ordenes con `current_state = 6`, sin filtro `valid = 1`.
- `refundedOrderCount`: ordenes con `current_state = 7`, sin filtro `valid = 1`.

Los montos publicos son strings con seis decimales y se manejan con aritmetica decimal basada en texto/`BigInt`, redondeando half-up a seis decimales.

## Moneda

`currencyIsoCode` es siempre `"CLP"`, segun la evidencia auditada actual: las ordenes observadas usan CLP y `conversion_rate = 1`.

## Seguridad

El endpoint solo acepta `masterCustomerId` numerico en path. No acepta email, `prestashopCustomerId`, filtros por query string, moneda, fechas ni body.

Las consultas son read-only, parametrizadas por `id_customer`, con prefijos de tabla validados. No seleccionan PII, referencias de orden, SQL dinamico inseguro, productos individuales ni nombres de producto.

## Observabilidad

Los logs del endpoint son agregados y saneados: estado, bucket de cantidad de ordenes (`zero`, `one`, `multiple`), presencia de historia comercial, duracion y razon degradada cuando aplica.

No se loguean `masterCustomerId`, `prestashopCustomerId`, montos, fechas, unidades, productos distintos, cancelaciones, reembolsos, IDs de orden, referencias, PII, SQL ni mensajes crudos de error.

## Errores

- Master inexistente: `customer_not_found` con HTTP 404.
- Master sin link PrestaShop: `customer_not_linked` con HTTP 404.
- Cliente vinculado sin ordenes validas: `available` con resumen vacio.
- Timeout o indisponibilidad de cualquier reader PrestaShop: `degraded` con HTTP 503.
- Error desconocido o dato contractual invalido: se propaga y la ruta responde 500 saneado.

## Limitaciones

- Gasto bruto, no neto de reembolsos externos.
- PrestaShop no registra reembolsos nativos en los datos auditados.
- CLP fijo segun evidencia actual.
- No incluye productos especificos.
- No incluye categorias.
- No incluye segmentacion.
- No incluye clustering.
- No incluye recomendaciones.
- No modifica `/profile`.
