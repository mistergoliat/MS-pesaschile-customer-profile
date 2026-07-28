# CP-R1-T06A Proposed Operational Map

Fecha: 2026-07-28.

Estado: **metodología implementada y probada; tabla de resultados generada contra datos reales**. Esta tarea pide *proponer*, no implementar, un mapa de estados a etapas operacionales. La propuesta vive como código puro y testeado en `scripts/audits/order-state-semantics/lib/classification.ts` (`proposeClassification`) — nunca en `src/`, nunca conectado a un endpoint runtime.

## Método (implementado, no una promesa)

`proposeClassification(input)` decide únicamente a partir de:

- `flags` — los booleanos nativos de `ps_order_state` (`paid`, `shipped`, `delivery`, `hidden`, `deleted`, `logable`).
- `orderCount` / `totalOrders` — volumen real, para calcular participación porcentual.

**Nunca** a partir de `name` — el nombre localizado se registra en `weakSignals`, un campo separado de `evidence`, y jamás participa en la decisión (`candidateStage`/`confidence`). Esto es verificado por test: `does not put ... only as a weak signal` en `tests/unit/audit-order-state-classification.test.ts`, y `never emits cancelled or refunded as a candidate stage`.

### Reglas Aplicadas (en orden)

1. Sin fila de `order_state` para el `stateId` (referenciado por `orders.current_state` pero inexistente en el catálogo) → `unknown` / `low`.
2. `deleted = true` → `exception` / `low` (sin importar los demás flags).
3. `hidden = true` y `orderCount > 0` → `exception` / `low` (oculto pero en uso — inconsistencia).
4. `logable = false` → `exception` / `low` (típicamente un estado técnico/transitorio, no una etapa comercial estable).
5. `delivery = true` → `delivered`; `confidence: high` si además `shipped = true`, `medium` si no (inconsistencia: entregado sin haber sido marcado como enviado).
6. `shipped = true` (y no `delivery`) → `dispatched` / `high`.
7. `paid = true` (y ni `shipped` ni `delivery`) → `payment_confirmed` / `medium`, siempre con `manualReviewRequired: true`.
8. Ningún flag positivo → `unknown` / `low`.

### Por Qué Nunca Emite `cancelled` Ni `refunded`

`ps_order_state` no tiene un flag booleano nativo para "cancelado" ni para "reembolsado" — en una instalación estándar de PrestaShop esos son `id_order_state` específicos (convencionalmente 6 y 7, pero configurable por instalación), no una propiedad derivable de `paid`/`shipped`/`delivery`/`logable`. Intentar inferirlos seguro solo del nombre violaría la regla de diseño de la sección 22 de la tarea ("no hacer routing ni clasificación por el texto de `ps_order_state_lang.name`"). Por eso `proposeClassification` nunca los produce — quedan como **decisión abierta para el negocio** (ver más abajo), no como un gap de implementación.

### Por Qué `preparing`/`packed`/`ready_for_dispatch` Colapsan En `payment_confirmed`

Los mismos tres flags nativos (`paid`/`shipped`/`delivery`) no alcanzan para distinguir "pago confirmado" de "preparando" de "embalado" de "listo para despacho" — PrestaShop no modela esa granularidad en columnas booleanas propias. La función es honesta al respecto: cualquier estado con `paid = true` y sin `shipped`/`delivery` recibe `payment_confirmed` con confianza `medium` y **siempre** `manualReviewRequired: true`, en vez de inventar una distinción que los datos no permiten.

## Detección De Inconsistencias (sección 10, separada de la propuesta)

`detectStateInconsistencies(input)` es una función distinta, usada solo para señalar candidatos a revisión manual — nunca cambia la salida de `proposeClassification`. Devuelve una lista tipada `{ label, kind }` donde `kind` es `'weak_signal'` (solo un chequeo: si el nombre sugiere "entrega" pero `delivery = false`) o `'flag_evidence'` (los otros seis, puramente basados en flags/volumen — incluyendo el hallazgo de que el flag `paid` de PrestaShop **no** se alinea con la regla de negocio de PesasChile de que toda fila en `ps_orders` cuenta como pagada, ver CP-R1-T04/T05).

## Tabla De Resultados (real, `id_lang = 1`)

Fuente: `scripts/audits/order-state-semantics/outputs/state-distribution.json`, claves `classificationProposals` + `matrix`. `evidence` resumido (texto completo en el JSON).

| stateId | name | candidateStage | confidence | manualReviewRequired | volumen |
|---:|---|---|:---:|:---:|---:|
| 1 | En espera de pago por cheque | exception | low | true | 1 (0.00%) |
| 2 | Pago aceptado | payment_confirmed | medium | true | 15.876 (19.79%) |
| 3 | Preparación en curso | payment_confirmed | medium | true | 0 (0.00%) |
| 4 | Entregado a Transportista | **dispatched** | **high** | **false** | **19.227 (23.97%)** |
| 5 | Entregado | **dispatched** | **high** | **false** | **42.314 (52.75%)** |
| 6 | Cancelado | exception | low | true | 955 (1.19%) |
| 7 | Reembolsado | exception | low | true | 16 (0.02%) |
| 8 | Error en pago | exception | low | true | 23 (0.03%) |
| 9 | Pedido pendiente por falta de stock (pagado) | exception | low | true | 1 (0.00%) |
| 10 | En espera de pago por transferencia bancaria | exception | low | true | 7 (0.01%) |
| 11 | Pago remoto aceptado | payment_confirmed | medium | true | 0 (0.00%) |
| 12 | Pedido pendiente por falta de stock (no pagado) | exception | low | true | 1 (0.00%) |
| 13 | En espera de validación por contra reembolso. | exception | low | true | 0 (0.00%) |
| 14 | "1" *(placeholder)* | unknown | low | true | 0 (0.00%) |
| 16 | Embalando | unknown | low | true | 42 (0.05%) |
| 17 | Listo para despacho | unknown | low | true | 0 (0.00%) |
| 19 | Etiquetando | unknown | low | true | 9 (0.01%) |
| 23 | Espera de consolidar | payment_confirmed | medium | true | 0 (0.00%) |
| 25 | Consolidando Ruta | unknown | low | true | 46 (0.06%) |
| 26 | Pedido con Insidencia | unknown | low | true | 2 (0.00%) |
| 27 | En Reparto | **dispatched** | **high** | **false** | **12 (0.01%)** |
| 28 | Entregado a Transportista old | payment_confirmed | medium | true | 60 (0.07%) |
| 29 | "2" *(placeholder)* | unknown | low | true | 0 (0.00%) |
| 30 | Listo para retiro | payment_confirmed | medium | true | 26 (0.03%) |
| 31 | Listo para retiro en tienda | payment_confirmed | medium | true | 57 (0.07%) |
| 32 | Picking RB | unknown | low | true | 0 (0.00%) |
| 33 | Picking RT | unknown | low | true | 0 (0.00%) |
| 34 | En Transito a Tienda | exception | low | true | 9 (0.01%) — `hidden=1` pero en uso |
| 35 | Embalando BE | unknown | low | true | 89 (0.11%) |
| 36 | Entregado a BlueExpress | unknown | low | true | 1.438 (1.79%) |

Resumen por etapa: `exception` 9 estados, `payment_confirmed` 7, `dispatched` 3, `unknown` 11. Ningún estado recibió `delivered`, `cancelled`, `refunded`, `preparing`, `packed` ni `ready_for_dispatch` — confirmado por los datos reales, no solo por diseño teórico (ver hallazgo central abajo).

### Hallazgo Central: Los Tres Estados De Mayor Volumen De Entrega Son Indistinguibles Por Flags

Los estados **4** (Entregado a Transportista, 23.97% del volumen), **5** (Entregado, 52.75%) y **27** (En Reparto, 0.01%) —que juntos representan **76.73% de todas las órdenes**— reciben exactamente el mismo veredicto: `dispatched` / `high` / sin revisión manual requerida. No es un error: sus flags técnicos son **idénticos** (`paid=1, shipped=1, delivery=0, logable=1, hidden=0, deleted=0`), y `delivery=1` no aparece en ningún estado de todo el catálogo de 30. "Alta confianza" aquí significa únicamente "los flags son consistentes con la regla `shipped=true`" — **no** "esta es la etapa real correcta". Esta es la evidencia empírica, con el 76.73% del volumen real de PesasChile, de por qué una futura tarea de tracking no puede apoyarse solo en flags nativos.

Adicionalmente, **11 de 30 estados** (incluyendo varios de volumen no trivial: 36 con 1.79%, 25 con 0.06%, 16 con 0.05%) caen en `unknown/low` porque no tienen **ningún** flag positivo (`paid=shipped=delivery=0`) — entre ellos, estados con nombres operacionalmente claros como "Embalando", "Etiquetando", "Consolidando Ruta" y el propio "Entregado a BlueExpress". El catálogo de flags nativos de PrestaShop, en esta instalación, es informativo solo para una fracción del ciclo de vida real (confirmación de pago y despacho genérico) — el resto del flujo de fulfillment de PesasChile vive enteramente en nombres de estado custom sin respaldo de flags.

## Preguntas Abiertas Para El Negocio

Estas no se resuelven con más código — requieren que alguien de PesasChile con conocimiento operativo confirme:

1. ¿Qué `id_order_state` concretos representan cancelación y reembolso en la instalación real? Dato disponible: estado `6` "Cancelado" y `7` "Reembolsado" tienen nombres autoexplicativos y flags consistentes entre sí (`paid=0, logable=0`), pero esta auditoría no los asume como definitivos solo por el nombre.
2. ¿Cuál es el orden real esperado entre los estados 4 ("Entregado a Transportista"), 27 ("En Reparto") y 5 ("Entregado")? El hallazgo de mismatch de `order_history` (`CP-R1-T06A-tracking-coverage.md`: 10.610 órdenes con `current_state=5` pero último historial `=27`) sugiere que 27 debería preceder a 5 en el flujo esperado, pero el volumen de 27 (12 órdenes actuales) es mucho menor que el de las transiciones que lo mencionan como paso previo — sugiere que 27 es un estado de tránsito muy breve, casi nunca "actual" al momento de consultar.
3. ¿Existe ya una distinción operativa entre "preparando" (2, 3), "embalado" (16, 35) y "listo para despacho" (17) — o son, en la práctica, una sola fase para el equipo de postventa?
4. Para los 9 estados `exception`/`low` (1, 6, 7, 8, 9, 10, 12, 13, 34): ¿son básicamente terminales/técnicos de PrestaShop sin necesidad de acción (pago fallido, cancelado, reembolsado, stock), o el caso de 34 ("En Transito a Tienda", oculto pero con 9 órdenes activas) requiere que se le quite `hidden=1`?
5. ¿Por qué "Entregado a BlueExpress" (36, 1.79% del volumen, tercer estado custom más usado) no tiene ningún flag técnico activado? ¿Fue un estado creado copiando una plantilla sin configurar sus flags, o es intencional?
6. ¿Debe la futura tarea de tracking (candidata: CP-R1-T06) construir su propio mapa `id_order_state → etapa` como configuración explícita (tabla o constante versionada), en vez de intentar derivarlo de flags en runtime? Esta auditoría recomienda que sí — la evidencia real (76.73% del volumen indistinguible por flags) lo confirma — pero la decisión de diseño en sí queda para esa tarea futura, no para T06A.

