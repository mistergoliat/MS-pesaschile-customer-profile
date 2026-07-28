# CP-R1-T06A Order Detail Coverage

Fecha: 2026-07-28.

Estado: **ejecutado read-only contra la base real**. Fuente: `scripts/audits/order-state-semantics/outputs/order-detail-coverage.json`. Tabla real: **`ps_order_detail`** (forma singular; se verificó también que `ps_order_details` no existe). 80.211 órdenes totales.

Ningún número de este documento incluye un `id_order` individual, un `product_name`/`product_reference` real, ni ningún otro dato específico de una orden o cliente — todo es agregado. Las consultas de distribución (líneas por orden, productos distintos por orden) ni siquiera seleccionan `id_order`: solo `GROUP BY id_order` sin proyectarlo, resumido en JavaScript.

## Cobertura

- **170.744 líneas totales** en `ps_order_detail`.
- **80.208 de 80.211 órdenes (99.996%) tienen al menos una línea**; **3 órdenes no tienen ninguna**.
- **0 líneas huérfanas** (`id_order` que no existe en `ps_orders`).
- Líneas por orden: mínimo 1, máximo 63, promedio 2.13, mediana 1, p95 = 6.
- Productos distintos por orden: mínimo 1, máximo 55, promedio 2.11, mediana 1, p95 = 6 (prácticamente idéntico a "líneas por orden" — indica que casi no hay líneas repetidas del mismo producto dentro de una orden, consistente con "0 grupos de líneas duplicadas" más abajo).
- **37.293 de 80.208 órdenes (46.5%) tienen más de un producto distinto** — casi la mitad de las órdenes son multi-producto.

## Calidad De Datos

- Unidades totales vendididas: **280.042**.
- Líneas con cantidad ≤ 0: **0**.
- Líneas con `product_id` = 0 o `NULL`: **0**.
- Líneas con precio total (`total_price_tax_incl`) negativo: **0**.
- Grupos de líneas aparentemente duplicadas (mismo `id_order` + `product_id` + `product_attribute_id` repetido): **0**.
- Líneas sin `product_name`: **0** — el snapshot histórico del nombre de producto está completo en el 100% de las líneas.
- Líneas sin `product_reference`: **20** (0.012% del total) — negligible.
- Líneas con `product_attribute_id` (variante de producto): **28.325** (16.6% del total) — indica uso real de variantes (talla/color/etc.), no solo productos simples.

**Lectura**: la calidad de datos de `ps_order_detail` es alta — cero cantidades inválidas, cero precios negativos, cero duplicados, snapshot de nombre 100% completo. La única brecha (líneas sin `product_reference`) es marginal.

## Productos Eliminados Del Catálogo Actual

- Tabla `ps_product` **confirmada existente** (verificación opcional, no parte de las 6 tablas originalmente requeridas).
- **4.165 líneas (2.44% de 170.744)** referencian un `product_id` que ya no existe en `ps_product`.
- **420 productos distintos** están afectados.

**Lectura**: consistente con la sección 5 del alcance — el nombre y la referencia históricos de la línea (`product_name`, `product_reference`) se preservan en `ps_order_detail` independientemente de que el producto siga existiendo en el catálogo actual, así que no hay pérdida de información para mostrar "qué compró el cliente" — pero cualquier vínculo a datos *actuales* del catálogo (precio vigente, imagen, disponibilidad) fallará para esas 4.165 líneas.

## Cantidades Reembolsadas, Devueltas Y Reinyectadas

| Métrica | Líneas afectadas | Unidades totales |
| --- | ---: | ---: |
| Reembolsadas (`product_quantity_refunded`) | 32 | 34 |
| Devueltas (`product_quantity_return`) | 0 | 0 |
| Reinyectadas/repuestas a stock (`product_quantity_reinjected`) | 0 | 0 |

**Lectura**: volumen de reembolsos/devoluciones a nivel de línea es marginal (32 líneas sobre 170.744, 0.019%). Esto es consistente con la baja cantidad de órdenes en estado `7` "Reembolsado" (16 órdenes, ver `CP-R1-T06A-state-catalog.md`) — ambas fuentes (nivel orden y nivel línea) coinciden en que los reembolsos son infrecuentes en este negocio, al menos los que quedan reflejados en PrestaShop.

## Descuentos A Nivel De Línea

- **9.194 líneas (5.4% de 170.744)** tienen un descuento (`reduction_amount_tax_incl ≠ 0`).
- Suma total de descuentos a nivel de línea: **$97.401.757,21 CLP** (promedio ≈ $10.594 CLP por línea con descuento).
- Reportado **por separado** de la conciliación monetaria siguiente — nunca mezclado en el cálculo de diferencia/tolerancia.

## Consistencia Monetaria: `SUM(total_price_tax_incl)` Por Orden Vs `ps_orders.total_products_wt`

Tolerancia explícita: **0.5% relativo** (`MONEY_TOLERANCE_RATIO = 0.005` en el script — elegida para absorber redondeo, documentada, no oculta).

| Métrica | Valor |
| --- | ---: |
| Órdenes comparadas (con al menos una línea) | 80.208 |
| Coincidencia exacta | 79.974 (99.71%) |
| Dentro de tolerancia (0.5%) | 80.189 (99.98%) |
| Fuera de tolerancia | 19 (0.02%) |
| Diferencia absoluta promedio | $7,33 CLP |
| Diferencia absoluta máxima | **$124.980 CLP** |

**Lectura**: la coincidencia es muy alta (99.98% dentro de tolerancia), lo que confirma que `orders.total_products_wt` refleja fielmente la suma de líneas en la inmensa mayoría de los casos — refuerza la confiabilidad de los montos que Customer Profile ya expone (T04: `totalPaidTaxIncl`, `totalProductsTaxIncl`). Sin embargo, **hay al menos una orden con una diferencia de $124.980 CLP**, fuera de cualquier explicación razonable de redondeo. Esta auditoría **no identificó cuál orden es** — hacerlo requeriría una consulta que exponga un `id_order` individual, algo que se evitó deliberadamente en todos los outputs de esta auditoría. Queda como acción de investigación puntual fuera de este documento (ver informe principal, "Recommendations" #3).

Nota metodológica: la comparación no intenta separar el efecto de descuentos a nivel de orden (`orders.total_discounts_tax_incl`, no columna de `order_detail`) del de descuentos a nivel de línea (`reduction_amount_tax_incl`, ya reportado arriba por separado) — el 99.71%/99.98% de coincidencia sugiere que, en la práctica, `total_products_wt` ya refleja los descuentos de línea aplicados, y que los descuentos a nivel de orden (si existen) no afectan esta comparación específica. No se verificó esto de forma exhaustiva — es una interpretación razonable a partir de la alta tasa de coincidencia, no un hecho confirmado columna por columna.

## Relación Con Customer Profile (sección 5)

- `ps_orders` es la cabecera de la orden — ya expuesta por T04 (`recentOrders`) y T05 (`currentState`).
- `ps_order_detail` es **evidencia histórica** de qué productos se compraron en cada orden — no forma parte del alcance de lectura runtime de Customer Profile todavía.
- `product_name` y `product_reference` en `ps_order_detail` son un **snapshot histórico** de la venta en el momento en que ocurrió — confirmado por esta auditoría: 100% de las líneas tienen `product_name`, independientemente de que el producto exista hoy en `ps_product` (2.44% de las líneas referencian productos ya eliminados, y aun así conservan su nombre histórico).
- `product_id` permite vincular con el catálogo actual **solo cuando el producto todavía existe** (97.56% de las líneas) — el catálogo actual **no debe reemplazar** el nombre histórico de la línea, debe complementarlo cuando esté disponible.
- Cantidades reembolsadas/devueltas/reinyectadas están preservadas a nivel de línea y disponibles para una interpretación futura (bajo volumen real: 0.019% de las líneas).

**No se implementó lectura runtime de `order_detail` en esta tarea.**

### Tarea Propuesta: CP-R1-T07 — Customer Purchased Products Read Model

Deberá decidir, con datos reales ya disponibles en esta auditoría como insumo:

- **Últimas líneas compradas**: con un promedio de 2.13 líneas/orden y mediana 1, la mayoría de las órdenes son simples — un límite razonable de líneas por orden en un futuro read model no necesita ser grande (p95 = 6).
- **Agregados por producto**: 420 productos distintos ya no existen en el catálogo actual (2.44% de las líneas) — cualquier agregado "por producto actual" debe decidir explícitamente qué hacer con ese porcentaje (excluir, mostrar como "producto descontinuado", etc.).
- **Productos eliminados**: confirmado que el nombre/referencia histórico sobrevive en la línea — T07 puede mostrar el historial completo sin depender de que el producto siga en catálogo.
- **Variantes**: 16.6% de las líneas tienen `product_attribute_id` — T07 deberá decidir si expone la variante específica o solo el producto base.
- **Devoluciones**: volumen bajo (0.019% de las líneas) pero las columnas (`product_quantity_refunded`, `product_quantity_return`, `product_quantity_reinjected`, `total_refunded_tax_incl`/`_excl`) existen y están disponibles.
- **Cantidades netas**: `product_quantity` menos `product_quantity_refunded`/`product_quantity_return` da la cantidad neta — no calculado en esta auditoría (fuera de alcance de T06A), candidato directo para T07.
- **Vínculo con Product Relationship Engine**: fuera del alcance de esta auditoría; no se investigó si ese sistema existe o qué datos expone.
