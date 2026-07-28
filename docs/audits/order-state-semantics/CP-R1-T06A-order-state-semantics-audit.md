# CP-R1-T06A Order State Semantics Audit

Fecha: 2026-07-28.

Estado: **ejecutado read-only contra la base real** (`pesas_productiva`). Sesión anterior de esta misma tarea preparó el script sin credenciales disponibles; en esta sesión se agregaron variables `PRESTASHOP_DB_*` en un `.env` local (ignorado por Git, nunca leído/impreso por el agente) y se corrió la auditoría completa, incluyendo la extensión de alcance a `ps_order_detail`.

Este documento separa explícitamente **Facts** (observado/verificado contra datos reales), **Interpretations** (lectura de esos facts), **Recommendations** (qué hacer a continuación) y **Open decisions** (lo que requiere una decisión de negocio humana que esta auditoría no puede resolver por sí sola).

## Facts

### Conexión y guardrails

- Conexión exitosa contra `pesas_productiva`. Motor real: **MariaDB 10.6.25**, no MySQL — dato relevante porque el diseño del script (fallback de `order_history` para "MySQL &lt; 8.0") asumía MySQL; MariaDB 10.6 soporta funciones de ventana y CTEs desde la serie 10.2, así que la detección por "major version ≥ 8" dio el resultado correcto por coincidencia (10 ≥ 8), no porque el chequeo conozca MariaDB explícitamente. Ver "Open decisions".
- Grants: **`SELECT`/`USAGE` únicamente** — verificado y seguro (`disallowedPrivileges: []`, `hasGrantOption: false`).
- Carga del servidor en el momento de la ejecución: segura (`Threads_running = 3`, `max_connections = 646`, ratio ≈ 0.5%).
- Prefijo detectado: `ps_`. Las 6 tablas requeridas existen bajo ese prefijo, sin ambigüedad (`missingTables: []`).
- Host y usuario de conexión **no se incluyen en este documento** por instrucción explícita de esta tarea (más estricta que el precedente de T01, que sí publicó el host). Ambos quedan solo en `outputs/preflight.json`, que está ignorado por git.
- 64 queries ejecutadas contra datos reales, 14.75s de duración acumulada, todas por debajo del timeout de 15s por query. Detalle completo en `outputs/query-log.json` (ignorado por git).

### Descubrimiento de tabla de detalle (alcance nuevo)

- La tabla de detalle de orden se llama, en esta instalación, **`ps_order_detail`** (forma singular estándar). Se verificó explícitamente contra `information_schema.tables`, comprobando ambas variantes (`ps_order_detail`, `ps_order_details`) antes de usar cualquiera — `ps_order_details` (plural) no existe.

### Catálogo de estados

- **30 estados configurados** en `ps_order_state`, IDs 1–36 con huecos (15, 18, 20, 21, 22, 24 no existen como filas en absoluto — ni siquiera como `deleted = 1`).
- **Ningún estado tiene `deleted = 1`** en todo el catálogo — los huecos de ID no se explican por soft-delete; son IDs nunca creados o eliminados a nivel de fila (DELETE real, no flag).
- **Idioma operativo real: `id_lang = 1`**, único idioma con traducciones en `ps_order_state_lang` (30 de 30 estados traducidos). Coincide exactamente con `PRESTASHOP_ORDER_STATE_LANG_ID=1` ya configurado en el servicio (T05) — sin discrepancia.
- **`delivery = 1` no aparece en ningún estado del catálogo completo.** Los 30 estados tienen `delivery = 0`, incluyendo estados llamados literalmente "Entregado" (id 5) y "En Reparto" (id 27). PesasChile no usa ese flag nativo de PrestaShop en absoluto.
- Módulos: solo 3 estados tienen `module_name` no vacío, y los 3 son módulos core de PrestaShop (`ps_checkpayment`, `ps_wirepayment`, `ps_cashondelivery`) — no hay estados creados por módulos custom/de terceros.
- Catálogo completo, distribución y matriz de flags: ver `CP-R1-T06A-state-catalog.md`.

### Distribución de `current_state` (80.211 órdenes totales)

- `current_state = 0` o `NULL`: **0 órdenes**.
- `current_state` que no existe en `ps_order_state`: **0 órdenes**. Integridad referencial de facto perfecta pese a no haber FK declaradas.
- **21 de los 30 estados configurados están en uso actual**; 9 nunca son el `current_state` de ninguna orden hoy: `[3, 11, 14, 17, 23, 29, 32, 33, 13]`. Entre estos, el estado 3 ("Preparación en curso") y el 17 ("Listo para despacho") llaman la atención por ser nombres operacionalmente relevantes y sin embargo no tener ninguna orden actualmente en ellos.
- **Estado 34 ("En Transito a Tienda") tiene `hidden = 1` en el catálogo pero es el `current_state` de 9 órdenes reales hoy** — la única instancia confirmada de "estado oculto pero en uso" en todo el catálogo.
- Los 3 estados de mayor volumen concentran el 96.5% de las órdenes: `5` "Entregado" (42.314, 52.75%), `4` "Entregado a Transportista" (19.227, 23.97%), `2` "Pago aceptado" (15.876, 19.79%). El resto de la cola: `36` "Entregado a BlueExpress" (1.438, 1.79%), `6` "Cancelado" (955, 1.19%), y 15 estados adicionales con volumen bajo (89 órdenes o menos cada uno).
- Detalle completo (los 21 estados en uso, conteo y rango de fechas): `CP-R1-T06A-state-catalog.md`.

### Consistencia `current_state` vs `order_history`

- **100% de las órdenes tienen al menos un evento en `order_history`** (80.211/80.211) — 0 órdenes sin historial.
- **0 filas huérfanas** en `order_history` (ni por `id_order` faltante ni por `id_order_state` faltante).
- **0 casos de "último historial ambiguo"** (mismo `date_add` máximo con distinto `id_order_state` para la misma orden).
- Promedio de eventos por orden: 3.64; mínimo 1; máximo 40.
- **`current_state` NO coincide con el último evento de `order_history` en 11.958 de 80.211 órdenes (14.91%).** No es ruido disperso: se concentra en 3 transiciones sistemáticas:
  - `current_state = 5` ("Entregado") con último historial = `27` ("En Reparto") → **10.610 órdenes**.
  - `current_state = 4` ("Entregado a Transportista") con último historial = `19` ("Etiquetando") → **1.172 órdenes**.
  - `current_state = 36` ("Entregado a BlueExpress") con último historial = `35` ("Embalando BE") → **136 órdenes**.
  - El resto (≈40 órdenes) son casos aislados (1–24 órdenes cada uno).
- Ver "Interpretations" para la lectura de este hallazgo — es el más importante de toda la auditoría.

### Carrier y tracking

- **0 órdenes tienen más de un `order_carrier`** (`max_order_carrier_rows_per_order = 1`, `orders_with_multiple_carriers = 0`). 80.189 de 80.211 órdenes (99.97%) tienen exactamente un `order_carrier`; 22 no tienen ninguno.
- **Cobertura de `tracking_number`: 9 de 80.189 filas de `order_carrier` (0.011%)** tienen un valor no vacío. La inmensa mayoría de `order_carrier` no tiene tracking cargado en PrestaShop.
- 0 grupos de `tracking_number` duplicados (esperable con tan pocos valores).
- **`orders.id_carrier` no coincide con el `order_carrier` más reciente en 400 de 80.189 órdenes (0.50%)** — mayoritariamente sí es confiable como "vigente", pero no siempre.
- Catálogo de carriers: 19 totales, 12 activos, 9 marcados `deleted = 1`, 8 de módulo. **3 carriers `deleted = 1` siguen referenciados por `order_carrier` real** — esperable para historial, pero confirma que "vigente" no puede leerse solo de `carrier.deleted = 0`.
- Detalle completo: `CP-R1-T06A-tracking-coverage.md`.

### Detalle de órdenes (`ps_order_detail`)

- 170.744 líneas totales. 80.208 de 80.211 órdenes tienen al menos una línea (3 no tienen ninguna). **0 líneas huérfanas** (`id_order` faltante en `ps_orders`).
- Líneas por orden: promedio 2.13, mediana 1, p95 = 6, máximo 63.
- **Conciliación monetaria** (`SUM(total_price_tax_incl)` por orden vs `orders.total_products_wt`, tolerancia explícita 0.5%): 79.974/80.208 coinciden exactamente (99.71%); 80.189/80.208 dentro de tolerancia (99.98%); diferencia promedio $7,33 CLP; **diferencia máxima $124.980 CLP en al menos una orden** — una discrepancia real que amerita investigación puntual fuera de esta auditoría (deliberadamente no se identificó qué orden es, para no romper la regla de "sin IDs de orden individuales en outputs").
- Descuentos a nivel de línea: 9.194 líneas (5.4%) con descuento, sumando $97.401.757,21 CLP — reportado por separado de la conciliación monetaria, nunca mezclado.
- Reembolsos/devoluciones: 32 líneas con cantidad reembolsada (34 unidades); 0 líneas con cantidad devuelta o reinyectada.
- 4.165 líneas (2.4%) referencian un `product_id` que ya no existe en `ps_product`; 420 productos distintos afectados.
- Calidad de datos: 0 líneas con `product_id` cero/nulo, 0 con cantidad ≤ 0, 0 con precio total negativo, 0 grupos de líneas duplicadas, 0 sin `product_name`, 20 sin `product_reference`.
- Detalle completo: `CP-R1-T06A-order-detail-coverage.md`.

## Interpretations

### `order_history` no es una fuente de verdad confiable para reconstruir el estado actual

El hallazgo del 14.91% de mismatch, concentrado casi por completo en tres transiciones de **alto volumen** (27→5, 19→4, 35→36), no luce como ruido aleatorio ni como error de captura ocasional. El patrón — un salto directo de "En Reparto"/"Etiquetando"/"Embalando BE" a un estado terminal ("Entregado"/"Entregado a Transportista"/"Entregado a BlueExpress") sin un evento de `order_history` intermedio que lo documente — sugiere que **`orders.current_state` se actualiza en al menos un flujo (probablemente un proceso batch, cron o integración de carrier) que no pasa por el mecanismo estándar de PrestaShop que escribe en `order_history`** (`OrderHistory::changeIdOrderState()` normalmente inserta en ambas tablas atómicamente). Esto es una interpretación razonable a partir de los datos, no un hecho verificado directamente — verificarlo requeriría revisar el código/los módulos de PesasChile que tocan `current_state`, fuera del alcance read-only de esta auditoría.

### Los flags nativos de PrestaShop no alcanzan para distinguir etapas reales del negocio — con evidencia concreta

Los tres estados de mayor volumen — `4` "Entregado a Transportista", `5` "Entregado", `27` "En Reparto" — tienen **flags técnicos idénticos** (`paid=1, shipped=1, delivery=0, logable=1, hidden=0, deleted=0`), a pesar de representar tres momentos claramente distintos del ciclo de vida real de una entrega (despachado al transportista → en reparto local → entregado al cliente). La propuesta de clasificación (`proposeClassification`) los marca a los tres como `dispatched`/`high` — "alta confianza" ahí significa **"los flags son internamente consistentes y coinciden con la regla `shipped=true` sin `delivery`"**, no "alta confianza en que esta es la etapa real correcta". Esto no es un error del algoritmo: es la prueba empírica, con datos reales, de la limitación que `CP-R1-T06A-proposed-operational-map.md` ya anticipaba de forma abstracta antes de tener acceso a la base. Ningún ajuste de flags puede resolver esto — se necesita un mapeo explícito `id_order_state → etapa` provisto por el negocio.

### PesasChile no usa tracking_number de PrestaShop de forma operativa

Con 0.011% de cobertura, `ps_order_carrier.tracking_number` no es una fuente utilizable para responder "¿cuál es mi número de seguimiento?" hoy. Si el tracking se comunica al cliente por otro medio (portal del carrier, WhatsApp, email fuera de PrestaShop), ese es un sistema externo a auditar por separado — no algo que esta auditoría pueda confirmar sin acceso a esos sistemas.

### La reconciliación monetaria confirma que la regla de negocio de T04/T05 es operativamente consistente

99.71% de coincidencia exacta entre la suma de líneas y `total_products_wt` confirma que, salvo un puñado de excepciones, los totales de `ps_orders` reflejan fielmente sus líneas — refuerza la confiabilidad de los montos que T04 ya expone (`totalPaidTaxIncl`, `totalProductsTaxIncl`) como string sin pérdida de precisión.

## Recommendations

1. **No implementar CP-R1-T06 (tracking) apoyándose en `order_history` como fuente única de "qué pasó y cuándo"** — el 14.91% de mismatch sistemático lo invalida como fuente de verdad completa. `current_state` (ya expuesto por T05) sigue siendo más confiable que el último evento de `order_history` para saber el estado actual, precisamente porque el mismatch demuestra que algo actualiza `current_state` sin pasar por `order_history`.
2. **Antes de construir cualquier mapeo `id_order_state → etapa comercial`, obtener del negocio una tabla explícita**, no una heurística de flags — la evidencia de los estados 4/5/27 (flags idénticos, semántica distinta) hace que cualquier heurística automática sea insuficiente por diseño, no por un bug corregible.
3. **Investigar puntualmente la orden (u órdenes) con diferencia de $124.980 CLP** en la conciliación monetaria — fuera de esta auditoría, ya que identificarla requiere una consulta que exponga un `id_order` individual, algo que esta auditoría evita deliberadamente en sus outputs.
4. **No prometer tracking real a través de Customer Profile/Sales AI** hasta que se confirme, con el equipo de operaciones, si existe una fuente de tracking fuera de PrestaShop — la cobertura nativa (0.011%) es demasiado baja para ser útil por sí sola.
5. Considerar si **4.165 líneas de `ps_order_detail` que referencian productos eliminados de `ps_product`** (2.44% del total) requieren algún tratamiento especial en una futura T07 — el nombre/referencia histórico de la línea (`product_name`, `product_reference`) sigue disponible aunque el producto ya no exista, así que no hay pérdida de información, pero cualquier vínculo a catálogo actual (`product_id`) fallará para esas líneas.
6. Mantener el mismo criterio de esta auditoría (agregados, sin IDs de orden, sin PII) si se decide profundizar en cualquiera de los hallazgos anteriores.

## Open decisions

Requieren una decisión de negocio humana — no se resuelven con más ingeniería:

1. ¿Qué proceso concreto actualiza `current_state` sin escribir en `order_history` para las transiciones 27→5, 19→4 y 35→36? Candidatos razonables no verificados: un cron/batch de sincronización con el carrier (BlueExpress aparece explícitamente en los nombres de estado), o una integración que llama directamente a un `UPDATE` sobre `ps_orders` en vez de usar el flujo estándar de PrestaShop.
2. ¿Qué `id_order_state` concretos representan cancelación y reembolso a efectos de negocio? Dato real disponible: estado `6` se llama "Cancelado" y estado `7` "Reembolsado", ambos con `paid=0, logable=0` — nombres y flags consistentes entre sí, pero esta auditoría no asume que el nombre sea suficiente para una clasificación productiva (regla de diseño de la sección 22 del alcance original de T06A). Requiere confirmación explícita del negocio.
3. Los estados 4, 5 y 27 comparten flags idénticos pero representan "despachado al transportista", "entregado al cliente" y "en reparto local" — respectivamente. ¿Cuál es el orden real esperado entre ellos (¿27 debería preceder a 5, o pueden saltarse pasos según el tipo de despacho)? Esto es exactamente lo que el hallazgo de mismatch de `order_history` (27→5, 10.610 casos) sugiere pero no puede confirmar sin input humano.
4. ¿Por qué el estado 3 ("Preparación en curso", core de PrestaShop, sin flags problemáticos) y el 17 ("Listo para despacho", custom) nunca son el `current_state` actual de ninguna orden? ¿Fueron reemplazados operacionalmente por "Embalando" (16)/"Etiquetando" (19), o son vestigios sin uso?
5. ¿Es aceptable que el estado 34 ("En Transito a Tienda") esté marcado `hidden=1` pero tenga 9 órdenes actualmente en él? ¿Debería dejar de estar oculto, o es intencional (paso interno no destinado a mostrarse al cliente)?
6. ¿Existe una fuente de tracking number fuera de PrestaShop (portal del carrier, sistema externo) que Customer Profile debería consultar en el futuro, dado que la cobertura nativa es de 0.011%?
7. La orden con $124.980 CLP de diferencia en la conciliación monetaria — ¿es un caso legítimo (ajuste manual, nota de crédito no reflejada en `order_detail`) o un error de datos? Requiere investigación puntual fuera de esta auditoría.
8. ¿El motor real siendo MariaDB (no MySQL) cambia alguna asunción de otras tareas de este repositorio? No se detectó ningún problema de compatibilidad en esta auditoría (todas las queries, incluida la variante con `ROW_NUMBER() OVER`, funcionaron correctamente), pero vale la pena que quien mantenga `src/infrastructure/*` lo tenga presente si en el futuro se usa una función específica de MySQL sin equivalente en MariaDB.

## Implementación

### Script

- `scripts/audits/order-state-semantics/audit-order-state-semantics.ts` — entrypoint. No importa nada de `src/`.
- `scripts/audits/order-state-semantics/lib/guardrails.ts` — `assessGrants()`, `evaluateLoad()`.
- `scripts/audits/order-state-semantics/lib/schema-discovery.ts` — `detectPrefix()`, `detectOrderDetailTable()` (nuevo en esta sesión: nunca asume `order_detail` vs `order_details`, verifica ambas contra `information_schema.tables`).
- `scripts/audits/order-state-semantics/lib/history-sql.ts` — SQL de `order_history`, variante con funciones de ventana y variante sin `WITH`/sin funciones de ventana (compatibilidad ≤ MySQL 5.7 / MariaDB antiguo).
- `scripts/audits/order-state-semantics/lib/classification.ts` — `proposeClassification()`, `detectStateInconsistencies()`.
- `scripts/audits/order-state-semantics/lib/stats.ts` — nuevo en esta sesión: `computePercentileStats()` (min/max/avg/mediana/p95 calculados en JS a partir de conteos agregados, sin exponer `id_order`, compatible con cualquier versión de MySQL/MariaDB) y `isWithinTolerance()`.
- `scripts/audits/order-state-semantics/lib/types.ts` — tipos compartidos.

### Outputs

`scripts/audits/order-state-semantics/outputs/` — ignorados por git:

- `preflight.json`, `audit-result.json`, `query-log.json`, `explains.json`
- `schema-inventory.json` (incluye ahora `ps_order_detail`)
- `state-catalog.json`, `state-distribution.json` (incluye `history`)
- `tracking-coverage.json`
- `order-detail-coverage.json` (nuevo en esta sesión)

### Guardrails aplicados

- Conexión única (`mysql.createConnection`, nunca un pool).
- `SHOW GRANTS FOR CURRENT_USER()` y carga del servidor verificados antes de cualquier consulta de datos.
- Timeout de 15s por query; `EXPLAIN FORMAT=JSON` en las consultas más pesadas.
- Sin `CREATE TEMPORARY TABLE`, sin `INSERT`/`UPDATE`/`DELETE`/`ALTER`/`DROP`/`TRUNCATE`/`LOCK TABLES` en ninguna consulta (incluida la extensión de `order_detail`).
- Sin PII: sin email, nombre, RUT, dirección, teléfono, referencia completa de orden, tracking number real, ni lista completa de `product_name`. `template` solo por presencia/longitud.
- Sin IDs de orden individuales en ningún output — todo agregado. Las consultas de "líneas por orden"/"productos distintos por orden" ni siquiera seleccionan `id_order` (solo `GROUP BY id_order` sin proyectarlo), y el resumen estadístico se calcula en JS sobre el arreglo de conteos.

## Validación

| Check | Resultado |
|---|---|
| `npm run typecheck` | ✅ |
| `npm run lint` | ✅ |
| `npm test` | ✅ 188/188 (19 archivos) |
| `npm run build` | ✅ |
| `git check-ignore .env` | ✅ ignorado |
| Ejecución real contra `pesas_productiva` | ✅ 64 queries, 14.75s, exit code 0 |
| Grants verificados en la ejecución real | ✅ `SELECT`/`USAGE` únicamente |
| Carga del servidor verificada en la ejecución real | ✅ segura (`Threads_running = 3`) |

**Confirmado**: cero escrituras (grep global sin `INSERT/UPDATE/DELETE/ALTER/CREATE/DROP/TRUNCATE/LOCK TABLES` en `scripts/audits/order-state-semantics/`), sin migraciones, sin backfill, sin contratos runtime modificados (`src/` sin diff), sin endpoints nuevos, sin secretos en outputs ni en este documento, `.env` ignorado por git y nunca leído/impreso por el agente, sin commit, sin push, sin PR.
