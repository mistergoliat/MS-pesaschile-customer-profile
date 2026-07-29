# CP-R1-T07A Monetary Semantics

Fecha: 2026-07-29.

Estado: **ejecutado read-only contra la base real**, sobre las 79.190 órdenes con `valid = 1` (ver [`CP-R1-T07A-order-validity.md`](CP-R1-T07A-order-validity.md)). Fuentes: `scripts/audits/commercial-summary/outputs/monetary-analysis.json` y `refund-analysis.json`. Ningún monto individual de una orden aparece aquí — todo es `MIN`/`MAX`/`AVG`/`SUM`/conteos.

## Facts

### Columnas monetarias

Las 11 columnas candidatas de la sección 5 existen todas en `ps_orders` (`total_paid`, `total_paid_tax_incl`, `total_paid_tax_excl`, `total_products`, `total_products_wt`, `total_discounts`, `total_discounts_tax_incl`, `total_shipping`, `total_shipping_tax_incl`, `total_wrapping`, `conversion_rate`). `id_currency` también existe.

| Columna | min | max | avg | sum | negativos | ceros (de 79.190) |
|---|---:|---:|---:|---:|---:|---:|
| `total_paid` | 0 | 36.872.358 | 142.177,12 | 11.259.006.230,25 | 0 | 9 |
| `total_paid_tax_incl` | 0 | 36.872.358 | 142.177,12 | 11.259.006.230,25 | 0 | 9 |
| `total_paid_tax_excl` | 0 | 30.985.175 | 119.473,66 | 9.461.118.884,02 | 0 | 8 |
| `total_products` | 0 | 30.985.178 | 112.978,72 | 8.946.784.564,02 | 0 | 2 |
| `total_products_wt` | 0 | 36.872.358 | 134.444,75 | 10.646.680.096,25 | 0 | 2 |
| `total_discounts` | 0 | 1.535.176 | 1.307,65 | 103.552.536 | 0 | 70.886 |
| `total_discounts_tax_incl` | 0 | 1.535.176 | 1.307,65 | 103.552.536 | 0 | 70.886 |
| `total_shipping` | 0 | 2.069.233 | 9.040,05 | 715.881.812 | 0 | 30.153 |
| `total_shipping_tax_incl` | 0 | 2.069.233 | 9.040,05 | 715.881.812 | 0 | 30.153 |
| `total_wrapping` | 0 | 0 | 0 | 0 | 0 | **79.190 (100%)** |
| `conversion_rate` | 1 | 1 | 1 | — | 0 | 0 |

- `total_paid` y `total_paid_tax_incl` son **idénticos en cada estadística** (min/max/avg/sum) — misma observación para `total_discounts`/`total_discounts_tax_incl` y `total_shipping`/`total_shipping_tax_incl`.
- `total_wrapping` es **siempre 0** — la instalación no usa envoltorio de regalo pagado.
- `conversion_rate` es **siempre exactamente 1.000000**, en las 79.190 órdenes válidas, sin una sola excepción.
- **Ningún monto negativo** en ninguna de las 11 columnas.
- **9 órdenes válidas con `total_paid_tax_incl = 0`** (y 2 con `total_products_wt = 0`) — existen montos cero dentro del conjunto `valid = 1`.
- `id_currency`: **100% de las órdenes válidas usan `id_currency = 1` (CLP)** — una sola moneda, sin excepción.
- Reconciliación `total_paid_tax_incl - total_products_wt`: promedio **7.732,37**, rango [-1.535.176, 2.069.234]. `total_shipping_tax_incl` promedio: **9.040,05**.

### Reembolsos

- `ps_order_detail.product_quantity_refunded`: **0 líneas** con valor > 0 en todo el dataset de órdenes válidas. `totalRefundedUnits: 0`.
- `ps_order_detail.total_refunded_tax_incl` (columna confirmada presente, ver `CP-R1-T06A-schema-inventory.md`): **0 líneas** con valor > 0. Suma total: `0.000000`.
- `ps_order_slip` **existe como tabla** (columnas: `id_order_slip, conversion_rate, id_customer, id_order, total_products_tax_excl, total_products_tax_incl, total_shipping_tax_excl, total_shipping_tax_incl, shipping_cost, amount, shipping_cost_amount, partial, order_slip_type, date_add, date_upd`) pero tiene **0 filas** — nunca se ha usado.
- `ps_order_slip_detail` también existe como tabla (no se auditaron sus columnas en detalle porque `ps_order_slip`, la tabla padre, ya está vacía).
- Estado `6` ("Cancelado"): 956 órdenes totales, 0 con `valid=1`. Estado `7` ("Reembolsado"): 16 órdenes totales, 0 con `valid=1`.

## Interpretations

### `total_paid_tax_incl` es la columna correcta para `totalSpentTaxIncl`

Cumple los 5 criterios de la sección 5:
1. Representa el monto efectivamente pagado (post-descuento, con impuestos, con despacho) — no es un subtotal de productos.
2. **Incluye despacho**: la reconciliación contra `total_products_wt` (que no incluye despacho) muestra una diferencia promedio (7.732,37) del mismo orden de magnitud que `total_shipping_tax_incl` promedio (9.040,05) — consistente con que la diferencia es mayormente el costo de envío, neteado con descuentos.
3. **Incluye descuentos**: por construcción, `total_paid_tax_incl` es el monto ya neteado — `total_discounts_tax_incl` es una columna informativa aparte, no algo que haya que restar manualmente.
4. **Incluye impuestos**: es la variante `tax_incl`, confirmado por el nombre y porque `total_paid_tax_excl` (sin impuestos) es sistemáticamente menor.
5. `total_paid` y `total_paid_tax_incl` son idénticos en esta instalación — cualquiera de las dos columnas produce el mismo resultado, pero se recomienda `total_paid_tax_incl` por ser semánticamente explícita (el nombre no depende de que la coincidencia se mantenga en el futuro).

### Una sola moneda, conversion_rate constante — no se necesita conversión de moneda en esta fase

CLP al 100%, `conversion_rate` siempre 1. La pregunta 9 y 10 de la sección 5 quedan respondidas empíricamente: **no existen monedas distintas ni tasas de conversión distintas de 1** en el conjunto de órdenes válidas. Esto valida la recomendación preliminar de agregar (`SUM`, o `SUM`/`COUNT`) directamente sin lógica de conversión — pero el campo `currencyIsoCode` del contrato propuesto sigue siendo necesario para no *asumir* CLP silenciosamente en el código (ver `CP-R1-T06A`/`CP-R1-T05`: "no silent default" es un principio ya establecido en este repo).

### PesasChile no usa ningún mecanismo nativo de reembolso de PrestaShop

`product_quantity_refunded`, `total_refunded_tax_incl` y `ps_order_slip` están **completamente vacíos** — no solo con baja cobertura (como `tracking_number` en T06A, 0,011%), sino con **cobertura cero**. Esto es una fuente de verdad definitiva: PrestaShop no tiene, hoy, ningún dato transaccional sobre reembolsos parciales o notas de crédito para esta instalación. `refundedOrderCount` solo puede construirse desde `current_state = 7` (16 órdenes en 4 años) — que es un conteo de *órdenes cuyo último estado es "reembolsado"*, no un registro de *cuánto* se reembolsó ni de reembolsos parciales sobre órdenes que siguen en otro estado.

### El gasto bruto (`totalSpentTaxIncl`) y el gasto neto son, en la práctica, el mismo número

Dado que no existe ningún reembolso parcial registrado en ninguna fuente auditada, exponer "gasto bruto" en la primera versión de `CustomerCommercialSummary` **no introduce ningún sesgo material** hoy — pero la limitación debe documentarse igual: si PesasChile empieza a usar `ps_order_slip` en el futuro, el campo dejaría de ser exacto sin que el contrato lo refleje, salvo que se audite de nuevo.

## Recommendations

1. `totalSpentTaxIncl → SUM(ps_orders.total_paid_tax_incl)` y `averageOrderValueTaxIncl → SUM(ps_orders.total_paid_tax_incl) / COUNT(*)` (no `AVG()` directo, para controlar el redondeo explícitamente), sobre `valid = 1`, **confirmados** por esta auditoría. Verificado empíricamente contra los datos reales que `AVG()` y `SUM()/COUNT()` producen el mismo valor en MariaDB 10.6 (`sum=11.259.006.230,25`, `count=79.190` → `142.177,1212305847`, idéntico al `avg` reportado por el motor) — la elección de `SUM()/COUNT()` es por control explícito de redondeo hacia el futuro, no porque se haya detectado una divergencia hoy.
2. `currencyIsoCode` se expone igual, resuelto vía `ps_currency.iso_code`, aunque hoy sea siempre `"CLP"` — no hardcodear el string, no asumir que seguirá siendo así sin verificar.
3. **No hay base de datos para separar gasto bruto de gasto neto** — exponer solo gasto bruto en la v1 del contrato, con la limitación documentada explícitamente (ver `CP-R1-T07A-commercial-summary-audit.md`, sección de decisiones cerradas).
4. `refundedOrderCount` debe documentarse explícitamente como "cuenta órdenes en estado terminal reembolsado", nunca como "monto reembolsado" ni "reembolsos parciales" — esos datos no existen en esta instalación.
5. No construir ninguna lógica sobre `ps_order_slip`/`ps_order_slip_detail` en la primera versión: 0 filas reales que sustenten un contrato basado en esas tablas.

## Open decisions

1. Si en el futuro PesasChile empieza a usar `ps_order_slip` operativamente, ¿quién es responsable de re-auditar y actualizar `totalSpentTaxIncl` a una versión neta?
2. ¿Las 9 órdenes válidas con `total_paid_tax_incl = 0` deben excluirse de `averageOrderValueTaxIncl` (para no diluir el ticket promedio) o son compras legítimas (ej. 100% cubiertas por un cupón) que deben contarse igual? Esta auditoría no tiene evidencia para decidirlo — son 9 órdenes de 79.190 (0,011%), impacto negligible en cualquier caso.
