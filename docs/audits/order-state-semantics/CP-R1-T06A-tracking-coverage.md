# CP-R1-T06A Tracking Coverage

Fecha: 2026-07-28.

Estado: **ejecutado read-only contra la base real**. Fuente: `scripts/audits/order-state-semantics/outputs/tracking-coverage.json` y `state-distribution.json` (clave `history`). Total de órdenes: 80.211.

Ningún número de este documento incluye un `tracking_number` real, un `id_order` individual, ni cualquier otro dato de una orden específica — todo es agregado.

## order_history (sección 11)

- **Disponible**: sí (`ps_order_history` y `ps_orders` existen ambas).
- **Cobertura**: 80.211 de 80.211 órdenes tienen al menos un evento de `order_history` — **0 órdenes sin historial**.
- **Filas huérfanas**: 0 con `id_order` faltante, 0 con `id_order_state` faltante — integridad referencial perfecta de facto.
- **Último historial ambiguo** (`ordersWithDuplicateLatestHistory`): **0** — ninguna orden tiene dos eventos con el mismo `date_add` máximo y distinto estado.
- **Eventos por orden**: total 80.211 órdenes con historial, mínimo 1, promedio 3.64, máximo 40. (Percentiles no calculados para esta métrica específica — ver nota en el informe principal, sección "Open decisions" #8, sobre limitaciones de diseño no explotadas dado que el motor sí soporta funciones de ventana en esta instalación.)

### Coincidencia `current_state` vs último evento de `order_history`

- **Coincide**: 68.253 de 80.211 órdenes (**85.09%**).
- **No coincide** (`current_state` ≠ último `id_order_state` de `order_history`, con historial presente): 11.958 de 80.211 (**14.91%**).
- El mismatch se concentra casi por completo en 3 transiciones sistemáticas, no en ruido disperso:

| current_state | último order_history | órdenes | % del total |
|---:|---:|---:|---:|
| 5 (Entregado) | 27 (En Reparto) | 10.610 | 13.23% |
| 4 (Entregado a Transportista) | 19 (Etiquetando) | 1.172 | 1.46% |
| 36 (Entregado a BlueExpress) | 35 (Embalando BE) | 136 | 0.17% |
| *(otros, dispersos)* | *(varios)* | ~40 | ~0.05% |

Ver el informe principal, sección "Interpretations", para la lectura de este hallazgo: sugiere que al menos un flujo (probablemente automatizado/batch) actualiza `orders.current_state` sin pasar por el mecanismo estándar de PrestaShop que también escribe en `order_history`.

## Carrier Y Tracking (secciones 12–13)

- **Disponible**: sí (`ps_order_carrier`, `ps_carrier`, `ps_orders` existen todas).
- **Cobertura de `order_carrier`**: 80.189 de 80.211 órdenes (99.97%) tienen exactamente un registro en `ps_order_carrier`; 22 no tienen ninguno.
- **Múltiples carriers por orden**: `max_order_carrier_rows_per_order = 1`, `orders_with_multiple_carriers = 0`. **Ninguna orden en esta base tiene más de un `order_carrier`** — respuesta empírica y definitiva a la pregunta 13 del alcance: hoy, `orders.id_carrier` y "el único `order_carrier` de la orden" son, en la práctica, la misma cosa (salvo el 0.50% de mismatch, ver abajo).
- **Cobertura de `tracking_number`**: **9 de 80.189 filas (0.011%)** tienen un valor no vacío. `min_tracking_length = 0` (filas vacías), `max_tracking_length = 6` (entre las 9 con contenido). La cobertura nativa de PrestaShop es, a efectos prácticos, **inexistente**.
- **Tracking duplicado**: 0 grupos (esperable con tan pocos valores no vacíos).
- **`orders.id_carrier` vs `order_carrier` más reciente**: coinciden en 79.789 de 80.189 órdenes comparables; **400 no coinciden (0.50%)**.
- **Catálogo de carriers**: 19 totales, 12 activos, 9 marcados `deleted = 1`, 8 de módulo (`is_module = 1`).
- **Carriers eliminados aún referenciados**: **3** carriers con `deleted = 1` tienen al menos un `order_carrier` real asociado — esperable para historial (una orden vieja pudo haberse despachado con un carrier que luego se dio de baja), pero confirma que `carrier.deleted = 0` no puede usarse solo para decidir "vigente".

## Respuestas A Las Preguntas De La Sección 15

- **7. ¿Cuántas órdenes tienen `tracking_number`?** → Prácticamente ninguna: 9 filas de `order_carrier` (0.011% de 80.189).
- **8. ¿Cuántas tienen más de un carrier?** → 0 (cero) en esta base.
- **9. ¿Qué carrier debe considerarse vigente?** → Dado que ninguna orden tiene más de un `order_carrier`, no existe ambigüedad de "cuál es el vigente" en el 99.97% de los casos con carrier asignado. El único matiz real es el 0.50% (400 órdenes) donde `orders.id_carrier` no coincide con el `id_carrier` de ese único `order_carrier` — en esos casos, `order_carrier` (la tabla transaccional, escrita en el momento del despacho) es la fuente más confiable, no `orders.id_carrier` (que puede haberse modificado después).
- **15. ¿Qué información requiere un futuro Carrier MS?** → Con 0.011% de cobertura de `tracking_number` nativo, **cualquier promesa de tracking real a un cliente requiere una fuente externa a PrestaShop** — el propio ERP/PrestaShop de PesasChile no la tiene cargada de forma sistemática hoy. ETA y estado del envío en el sistema del transportista tampoco existen en las tablas auditadas.
