# CP-R1-T07A Runtime Recommendation

Fecha: 2026-07-29.

Estado: **ejecutado read-only contra la base real** (MariaDB 10.6.25). Fuentes: `scripts/audits/commercial-summary/outputs/customer-distribution.json` (bloque `frequency`), `performance-analysis.json`, `explains.json`, `query-log.json`.

## Facts — Frecuencia (fórmula A vs. fórmula B)

- Fórmula A: `(lastOrderAt - firstOrderAt) / (totalOrders - 1)`, calculada sobre los 10.000 clientes con 2+ órdenes válidas: min 0, mediana 135, promedio 210,49, p95 710,05, máximo 1.398 días.
- Fórmula B: promedio real de los intervalos entre compras consecutivas (`LAG()` sobre `date_add`, particionado por cliente), calculada sobre los mismos 10.000 clientes: **min 0, mediana 135, promedio 210,49, p95 710,05, máximo 1.398 días — idéntica a la fórmula A en cada estadístico.**
- Diferencia absoluta |A − B| **por cliente**, calculada en la misma consulta SQL (mismas filas, sin reordenar por dos queries separadas): **min 0, max 0, avg 0, mediana 0, p95 0** — cero diferencia, sin una sola excepción entre los 10.000 clientes.

## Interpretations

### A y B no "suelen parecerse" — son la misma fórmula, matemáticamente

Esto no es una coincidencia de estos datos: para la historia de compras de **un mismo cliente**, la suma de los intervalos consecutivos (`compra[2]-compra[1] + compra[3]-compra[2] + ... + compra[n]-compra[n-1]`) es una **serie telescópica** que siempre colapsa exactamente a `compra[n] - compra[1]` — el total del período. Dividir esa suma por la cantidad de intervalos (`n-1`) da, por definición, `(último - primero) / (n-1)`, que es exactamente la fórmula A. Esta identidad se demostró de dos formas independientes en esta tarea:

1. **Analíticamente y por test unitario puro** (`tests/unit/audit-commercial-summary-frequency.test.ts`), sobre secuencias de fechas irregulares construidas a mano, sin tocar la base de datos.
2. **Empíricamente, contra los datos reales**: la consulta SQL calculó A y B para los mismos 10.000 clientes en la misma pasada, y la diferencia fue exactamente 0 en el 100% de los casos.

A y B **solo pueden divergir** si se agregan de forma distinta a nivel de población (ej. promediar el promedio-por-cliente vs. calcular un único ratio global de todas las órdenes de todos los clientes juntas) — nunca para la historia de un mismo cliente en aislamiento, que es exactamente el ámbito de `purchaseFrequencyDays` en el contrato propuesto (un campo por cliente).

### Comportamiento para clientes con una sola compra

Ambas fórmulas requieren dividir por `totalOrders - 1` o promediar sobre "intervalos", que no existen con una sola compra. `purchaseFrequencyDays = null` cuando `totalOrders < 2` (recomendación de la tarea, sección 8) es la única opción consistente — no hay una fórmula alternativa que produzca un número significativo para un comprador único. Como se documentó en `CP-R1-T07A-customer-distribution.md`, esto aplica al **77% de los clientes**, así que `null` es el caso común, no el borde.

### Precisión temporal requerida

`date_add` es `DATETIME` (precisión de segundo), pero tanto la fórmula A como la B en SQL usan `DATEDIFF()`, que trunca a **días completos**. Esto es suficiente para "frecuencia de compra" (una métrica de negocio en escala de días/semanas, no de horas) — no se requiere mayor precisión, y usar segundos introduciría ruido irrelevante para el caso de uso.

## Recommendations — Frecuencia

1. **Usar la fórmula A** (`(lastOrderAt - firstOrderAt) / (totalOrders - 1)`) en runtime: produce el mismo número que B, es O(1) a partir de dos fechas y un conteo que el caso de uso **ya necesita obtener** para `firstOrderAt`/`lastOrderAt`/`totalOrders`, y no requiere funciones de ventana ni una consulta adicional.
2. No implementar la fórmula B en runtime — agregaría complejidad (función de ventana, o iteración en aplicación) sin ningún beneficio de exactitud sobre la fórmula A.

---

## Facts — Performance

Se generó `EXPLAIN FORMAT=JSON` para 4 consultas candidato, todas parametrizadas por un único `id_customer` (como sería una consulta runtime real, no la agregación poblacional que usó esta auditoría):

| Candidato | Descripción | `access_type` | `key` usado | `rows` estimadas |
|---|---|---|---|---|
| A | Resumen directo (`COUNT`, `SUM(total_paid_tax_incl)`) por `id_customer` | `ref` | `id_customer` | 1 |
| B | `orders` JOIN `order_detail` por `id_customer` | `ref` (ambas tablas) | `id_customer` / `order_detail_order` | 1 |
| C | Frecuencia con `LAG() OVER (PARTITION BY id_customer ...)` | `ref` (dentro de `window_functions_computation`) | `id_customer` | 1 |
| D | Cancelaciones/reembolsos (`current_state IN (6,7)`) por `id_customer` | `ref` | `id_customer` | 1 |

Las 4 consultas usan el índice `id_customer` (o el índice compuesto `idx_orders_customer_idorder`, ya presente desde antes de esta tarea) — ninguna hace table scan completo. La consulta C agrega un `filesort`/`temporary_table` interno para materializar la función de ventana, pero sigue partiendo de `rows: 1` gracias al filtro por `id_customer` const.

Para contraste, la consulta **poblacional** que usó esta auditoría para calcular percentiles sobre los 44.344 clientes (`GROUP BY id_customer` sin filtro de `id_customer`) tardó **~7 segundos** sobre las 79.190 órdenes — ver `query-log.json`, entrada `distribution.per-customer-aggregates`. Ninguna consulta candidato-por-cliente (A–D) se ejecutó realmente con datos (solo `EXPLAIN`, para no cobrar el costo de una query real por cada candidato), pero su plan de acceso (`rows: 1`, índice usado) indica un costo muy inferior al de la agregación poblacional.

## Interpretations — Performance

Una consulta runtime real de `CustomerCommercialSummary` para **un** cliente es estructuralmente distinta —y mucho más barata— que las consultas de esta auditoría, que deliberadamente agregan **toda la población** para poder calcular percentiles. El índice `id_customer` (y el compuesto `idx_orders_customer_idorder`, evidenciado también en T06A) ya cubre los 4 patrones de acceso candidatos sin necesidad de un índice nuevo.

## Recommendations — Runtime / Snapshot / Cache

1. **Consulta runtime directa es viable** para `CustomerCommercialSummary` de un solo cliente: las 4 consultas candidato usan índices existentes (`id_customer` / `idx_orders_customer_idorder`), sin necesidad de un índice nuevo ni de una migración.
2. **Separar el resumen de unidades/productos distintos de las demás métricas es opcional, no obligatorio**: la consulta B (join con `order_detail`) también usa `id_customer` eficientemente — no hay evidencia de que deba aislarse en una consulta o servicio distinto por motivos de performance. Puede combinarse en el mismo request si la implementación futura lo prefiere por razones de diseño (no de performance).
3. **No se necesita snapshot offline para el caso de un solo cliente** — el patrón de acceso (`WHERE id_customer = ?`) es exactamente el mismo que ya usan T03–T06 para el resto del perfil de cliente.
4. **No se necesita cache** para este caso de uso específico (`GET` por cliente individual, `rows: 1` en cada consulta candidato) — cache solo se justificaría si el mismo cliente se consulta con muy alta frecuencia en un período corto, lo cual es una decisión de producto, no de estos datos.
5. **No se necesita una nueva migración ni un nuevo índice** — confirmado por las 4 consultas EXPLAIN, todas resueltas con índices ya existentes.
6. Si en el futuro se agrega un endpoint **agregado/poblacional** (ej. "dashboard de todos los clientes"), **ese sí** requeriría snapshot/cache — la consulta poblacional de esta auditoría tomó ~7 segundos para un solo campo agregado; un dashboard con múltiples métricas sobre 44.344+ clientes no debe ejecutarse en el camino síncrono de un request HTTP. Esto está fuera del alcance de `CustomerCommercialSummary` (que es por-cliente), pero se deja documentado para la decisión de arquitectura de una futura tarea.

## Open decisions

1. ¿`CustomerCommercialSummary` debe ejecutarse 100% en runtime (como T03–T06), o debe cachearse con un TTL corto dado que agrega hasta 4-5 consultas por request (orders, order_detail, currency, y potencialmente order_state para cancelaciones/reembolsos)? Los datos de esta auditoría dicen que runtime directo es viable en costo, pero la decisión final de cachear o no es de producto/arquitectura, no solo de costo de query.
2. ¿Debe `CustomerCommercialSummary` vivir en el endpoint de perfil principal (`GET /v1/customers/{masterCustomerId}/profile`) o en un endpoint separado (`GET /v1/customers/{masterCustomerId}/commercial-summary`)? Esta auditoría no cierra esta decisión — ver `CP-R1-T07A-commercial-summary-audit.md`, sección "Decisiones que debe cerrar el informe", punto 13.
