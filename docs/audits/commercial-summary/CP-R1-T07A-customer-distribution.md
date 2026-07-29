# CP-R1-T07A Customer Distribution

Fecha: 2026-07-29.

Estado: **ejecutado read-only contra la base real**, sobre las 79.190 órdenes con `valid = 1`. Fuente: `scripts/audits/commercial-summary/outputs/customer-distribution.json`. Cada consulta agrega `GROUP BY id_customer` **sin seleccionar `id_customer` en el resultado** — solo cuentas, sumas y fechas agregadas por cliente, nunca un identificador. Ningún `id_customer` individual aparece en este documento ni en el output.

## Facts

### Compradores y órdenes por cliente

- **44.344 clientes distintos** con al menos una orden válida.
- Órdenes por cliente: min 1, mediana 1, promedio 1,79, p95 3, máximo **14.331** (un outlier extremo — probablemente una cuenta operativa/B2B, no un consumidor final típico).
- Distribución en baldes:
  - 1 compra: **34.344** clientes (77,44%).
  - 2–3 compras: **7.935** (17,90%).
  - 4–10 compras: **1.895** (4,27%).
  - Más de 10: **170** (0,38%).

### Gasto por cliente (CLP, `total_paid_tax_incl`)

- Gasto acumulado por cliente: min 0, mediana 56.790,50, promedio 253.901,46, p95 912.035,75, máximo 726.842.640,10.
- Ticket promedio por cliente (`AVG` de sus propias órdenes): min 0, mediana 48.956, promedio 132.754,87, p95 469.989,50, máximo 16.846.580.

### Días entre primera y última compra

- **10.000 clientes** con 2+ compras (coincide exactamente con `twoToThree + fourToTen + moreThanTen` = 7.935+1.895+170 = 10.000).
- **34.344 clientes** con una sola compra (sin días-entre-compras, por definición).
- Para los 10.000 con 2+: min 0 días, mediana 238, promedio 356,02, p95 1.099, máximo 1.410 días.

### Recencia (días desde la última orden hasta la fecha de ejecución de la auditoría)

- min 0, mediana 581, promedio 637,70, p95 1.340, máximo 1.425 días.
- Sin compra en 30+ días: **43.294** clientes (97,63%).
- Sin compra en 90+ días: **40.890** (92,21%).
- Sin compra en 180+ días: **37.480** (84,52%).
- Sin compra en 365+ días: **30.168** (68,03%).

### Unidades y productos distintos (sobre `ps_order_detail`, líneas de órdenes válidas)

- **276.070 unidades brutas** compradas en total (`SUM(product_quantity)`).
- **0 unidades reembolsadas** (`SUM(product_quantity_refunded) = 0`, consistente con `CP-R1-T07A-monetary-semantics.md`) → unidades netas potenciales = unidades brutas = 276.070.
- **1.705 productos distintos** comprados (`COUNT(DISTINCT product_id)`).
- Cobertura de `order_detail`: 79.189 de 79.190 órdenes válidas tienen al menos una línea; **1 orden válida sin ninguna línea**.
- **28.036 líneas** con `product_attribute_id` (una variante), sobre un total no reportado de líneas individuales (no calculado — no requerido por la tarea).
- **4.047 líneas** (416 productos distintos) referencian un `product_id` que ya no existe en el catálogo actual de `ps_product`.

## Interpretations

### La base de clientes está dominada por compradores únicos, con alta inactividad

77,44% de los clientes solo compró una vez, y 68% de todos los clientes no ha comprado en más de un año. Esto es consistente con un negocio con fuerte adquisición de nuevo cliente pero baja recompra — un hecho de negocio relevante para cualquier feature de "recencia"/"frecuencia" en el perfil comercial: `purchaseFrequencyDays: null` va a ser el valor más común (77% de los clientes), no una excepción rara.

### El máximo de 14.331 órdenes en un solo cliente es un outlier que debe tenerse en cuenta

Ninguna consulta de este audit fue afectada negativamente por este outlier (los queries agregan del lado del servidor), pero cualquier futura UI/reporte que muestre "top clientes" o promedios sin trimming debe considerar excluir o marcar outliers extremos como este — probablemente una cuenta B2B/mayorista, no un caso de "PII" pero sí un caso atípico de negocio.

### La cobertura de `order_detail` es prácticamente completa

99,999% (79.189/79.190) de las órdenes válidas tienen al menos una línea de producto — la única orden sin líneas es un caso aislado, no un patrón sistémico. `totalUnitsPurchased`/`distinctProductsPurchased` pueden calcularse con confianza sobre casi la totalidad del conjunto.

### 416 productos "desaparecidos" del catálogo no invalidan `distinctProductsPurchased`

`COUNT(DISTINCT product_id)` sobre `order_detail` sigue siendo válido aunque el producto ya no exista en `ps_product` — el `product_id` histórico sigue siendo un identificador válido para "cuántos productos distintos compró este cliente", incluso si ya no se puede resolver a un nombre/precio actual. Esto es relevante para una futura Product Purchase Aggregates capability (fuera de alcance de T07A), no para el conteo en sí.

## Recommendations

1. `totalUnitsPurchased` → unidades brutas (`SUM(product_quantity)`), tal como recomienda la sección 9 de la tarea — confirmado seguro porque no hay reembolsos que resten (ver monetary-semantics.md).
2. `distinctProductsPurchased` → `COUNT(DISTINCT product_id)`, sin filtrar por existencia en el catálogo actual — un producto descontinuado sigue siendo parte de la historia de compra real del cliente.
3. `purchaseFrequencyDays = null` cuando `totalOrders < 2` — no es un caso raro, es el **77%** de los clientes; el código y cualquier UI que consuma el contrato deben tratar `null` como el caso común, no como una excepción.
4. Cualquier futura vista agregada (dashboards, "top compradores") debe excluir o marcar explícitamente outliers como el cliente de 14.331 órdenes — fuera de alcance de `CustomerCommercialSummary` en sí (que es por-cliente, no un ranking).

## Open decisions

1. ¿El cliente con 14.331 órdenes es una cuenta legítima (B2B/mayorista) o un artefacto de datos (ej. cuenta de pruebas nunca depurada)? No resoluble desde `ps_orders` solo — requiere confirmación operativa de PesasChile.
2. ¿La alta tasa de inactividad (68% sin compra en 365+ días) debe influir en el diseño del endpoint (ej. paginación/filtrado de "clientes activos" en un futuro caso de uso agregado)? Esta auditoría es sobre un único `CustomerCommercialSummary` por cliente, no sobre un endpoint de listado — queda fuera de alcance, pero se documenta como contexto de negocio relevante.
