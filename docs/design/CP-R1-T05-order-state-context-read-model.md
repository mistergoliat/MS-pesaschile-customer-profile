# CP-R1-T05 Order State Context Read Model

Fecha: 2026-07-28.

Estado: implementado (traducción read-only de `currentStateId`). Sin migraciones ejecutadas, sin backfill, sin escrituras.

## Propósito

T04 dejó cada orden reciente con `currentStateId: number` — un ID bruto de `ps_orders.current_state`, sin nombre. T05 traduce ese ID a una etiqueta legible consultando el catálogo de estados de PrestaShop (`ps_order_state` / `ps_order_state_lang`), para que Customer Profile pueda alimentar más adelante a Sales AI y Postventa.

T05 responde: **"¿cuál es el estado operativo registrado actualmente para esta orden?"**.

T05 explícitamente **no** responde: dónde está físicamente el paquete, cuál es su tracking, cuándo llegará, qué transportista lo lleva, ni qué secuencia de estados ha recorrido la orden. Ver "Fuera De Alcance".

## Relación Con T04

Regla empresarial vigente (sin cambios desde T04, reafirmada aquí):

```text
toda fila persistida en ps_orders se considera una orden pagada;
current_state no determina si la orden está pagada;
current_state representa el paso operativo o de postventa en que se encuentra;
valid sigue siendo un dato bruto y no se usa como filtro.
```

T05 no reabre ni reinterpreta esa regla. Solo agrega una traducción legible de `current_state` — sigue sin ser una clasificación comercial (pagada/no pagada) ni operacional (despachada/entregada) en el sentido de negocio; es contenido descriptivo tomado tal cual de PrestaShop.

## `current_state` Como Estado Operacional, No Filtro De Pago

`ps_order_state_lang.name` es el nombre humano que PrestaShop asigna al paso operativo/postventa en el que está la orden (ej. "Pago aceptado", "Preparación en curso", "Enviado", "Entregado", "Cancelado" — nombres reales que dependerán del catálogo configurado en el ambiente de PesasChile). T05 **no** interpreta ese texto: no hay `if (name.includes('enviado'))`, no hay mapeo de keywords a una etapa (`shipped`, `delivered`, etc.). Ver "Regla De Diseño: Sin Clasificación Por Keywords".

## Fuentes De Datos

```text
ps_orders.current_state
→ ps_order_state.id_order_state
→ ps_order_state_lang.id_order_state (+ id_lang)
→ ps_order_state_lang.name
```

Solo se consulta `<prefix>order_state` y `<prefix>order_state_lang`, nunca `ps_order_history` (esa tabla es historial de transiciones, no el estado actual — fuera de alcance, ver más abajo).

## Idioma Configurable

```dotenv
PRESTASHOP_ORDER_STATE_LANG_ID=1
```

**Obligatoria, sin default silencioso.** A diferencia de `PRESTASHOP_DB_PREFIX` (que sí tiene un default documentado, `ps_`, porque es una decisión previa ya registrada en este repositorio), no existe ningún registro previo en este proyecto de cuál es el `id_lang` operativo real de PesasChile en PrestaShop. Adivinar `1` en el código habría sido una asunción silenciosa horneada en cada traducción de estado. `src/config.ts` la valida con Zod (`z.coerce.number().int().positive()`, sin `.default()`) — el proceso falla explícitamente al arrancar si falta, igual que `CRM_DB_HOST`/`PRESTASHOP_DB_HOST` en T03. `.env.example` documenta `PRESTASHOP_ORDER_STATE_LANG_ID=1` como valor recomendado de partida, con la nota de que debe coincidir con el idioma operativo real usado por PesasChile.

Solo se consulta **un** idioma por request — nunca todos los idiomas disponibles en `ps_order_state_lang`.

## Modelo De Lectura

[`src/domain/customer-profile/order-state-record.ts`](../../src/domain/customer-profile/order-state-record.ts):

```ts
export type OrderStateRecord = {
  readonly stateId: number;
  readonly name: string;
};
```

Deliberadamente mínimo. No incluye `semanticStage`, `isDelivered`, `isCancelled`, `isFinal`, `isPaid`, `customerMessage` ni `recommendedAction` — esos campos requieren una política empresarial explícita que todavía no existe.

## Puerto

[`src/application/customer-profile/ports.ts`](../../src/application/customer-profile/ports.ts):

```ts
export interface OrderStatesReader {
  findByIds(stateIds: readonly number[], languageId: number): Promise<readonly OrderStateRecord[]>;
}
```

Acepta IDs (el adapter dedupe defensivamente incluso si el caller no lo hizo), devuelve cero o más estados, nunca falla porque un ID individual no exista — eso se resuelve como `unknown` en el caso de uso, no como una excepción del reader. No expone `mysql2`. Sin métodos de escritura. Sin búsqueda por nombre.

## Prevención De N+1

El caso de uso extrae los `currentStateId` de `recentOrders`, los deduplica con `Set`, y hace **una sola** llamada batch:

```text
[2, 4, 4, 5] → [2, 4, 5] → una consulta
```

No se consulta el catálogo de estados si `recentOrders` está vacío — ni siquiera con un array vacío de IDs. Confirmado por test (`is available with recentOrders = [] ... order states never queried`, `unreachableOrderStatesReader`).

## Adapter (Read-Only)

[`src/infrastructure/prestashop/mysql-order-states-reader.ts`](../../src/infrastructure/prestashop/mysql-order-states-reader.ts):

```sql
SELECT os.id_order_state, osl.name
FROM <prefix>order_state os
INNER JOIN <prefix>order_state_lang osl
  ON osl.id_order_state = os.id_order_state
WHERE os.id_order_state IN (?, ?, ...)
  AND osl.id_lang = ?
```

- Prefijo validado con `^[A-Za-z0-9_]+$` antes de interpolarse en los nombres de tabla (mismo patrón que T03/T04).
- La lista `IN (...)` se construye con exactamente un placeholder `?` por ID único — nunca más, nunca menos.
- IDs y `languageId` van como parámetros (`executor.execute(sql, [...uniqueStateIds, languageId])`), nunca interpolados como literales numéricos.
- IDs deduplicados con `Set` antes de construir los placeholders.
- Cada ID y el `languageId` se validan como enteros positivos (`Number.isInteger`, `> 0`) antes de ejecutar — un ID cero, negativo o decimal hace que el adapter lance en vez de ejecutar la consulta.
- Si `stateIds` está vacío, devuelve `[]` **sin ejecutar SQL** — ni siquiera se valida `languageId` en ese caso, porque no hay nada que consultar.
- Sin `GROUP_CONCAT`. Sin una consulta por ID. El orden de las filas devueltas por MySQL no importa: el caso de uso construye un `Map<stateId, OrderStateRecord>` para el lookup, nunca asume una posición.
- Sin joins adicionales, sin subqueries innecesarias, sin escrituras.
- Timeout heredado del `QueryExecutor` compartido (mismo pool PrestaShop que el resto de los adapters).
- Errores conocidos mapean a `PrestashopTimeoutError` / `PrestashopUnavailableError` (reutilizadas de `errors.ts`, sin tipos nuevos). Errores desconocidos se propagan sin clasificar.

## Contrato Público De Cada Orden

[`src/domain/customer-profile/contracts.ts`](../../src/domain/customer-profile/contracts.ts):

```ts
export type CustomerOrderStateContext = {
  readonly stateId: number;
  readonly name: string | null;
  readonly resolution: 'resolved' | 'unknown';
};

export type CustomerOrderSummary = {
  readonly orderId: number;
  readonly reference: string;
  readonly currentStateId: number;
  readonly currentState: CustomerOrderStateContext;
  readonly valid: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly totalPaidTaxIncl: string;
  readonly totalProductsTaxIncl: string;
  readonly currencyId: number;
};
```

`currentStateId` se mantiene junto a `currentState` (no se reemplaza por el nombre) por compatibilidad y como evidencia operacional bruta — un consumidor que solo confía en IDs (p. ej. un futuro motor de reglas) no depende de que la traducción haya funcionado.

## Comportamiento Cuando Falta La Traducción

Que un `current_state` no tenga fila localizada en `order_state_lang` para el `languageId` configurado **no degrada todo Customer Profile**. Produce:

```json
{
  "stateId": 4,
  "name": null,
  "resolution": "unknown"
}
```

Más un warning estructurado agregado como máximo una vez por snapshot: `order_state_label_missing` (sin ID, sin nombre, sin referencia — mismo estilo que `prestashop_email_differs_from_master` en T03). No se inventa un nombre como "Estado desconocido" o "En proceso" — esa decisión de fallback queda para el frontend o Sales AI. Confirmado por test (`is available with currentState unknown ...`, `adds the order_state_label_missing warning only once ...`, `does not put the stateId inside the order_state_label_missing warning string`).

**`unknown` solo corresponde a una consulta batch exitosa sin fila para ese ID/idioma.** Si la consulta completa falla (timeout, indisponibilidad, error desconocido), el resultado **no** es `available` con todos los `currentState` en `unknown` — degrada como se describe abajo. Confirmado por test (`never returns available with recentOrders labeled as if resolved when the order states read fails entirely`).

## Integración Al Caso De Uso

[`src/application/customer-profile/get-customer-profile.ts`](../../src/application/customer-profile/get-customer-profile.ts): `createGetCustomerProfile` recibe `orderStatesReader` y `orderStateLanguageId` además de las dependencias de T03/T04.

```text
1. leer master_customer
2. resolver vínculo (prestashop_customer_id)
3. leer ps_customer
4. leer recentOrders (T04)
5. si recentOrders está vacío  → orderStatesReader NO se llama, recentOrders = []
6. si recentOrders tiene datos → extraer currentStateId únicos
                                → leer estados en batch
                                → construir Map<stateId, OrderStateRecord>
                                → enriquecer cada orden preservando su orden original
7. construir snapshot
```

El caso de uso **no vuelve a consultar `ps_orders`** ni cambia el orden de `recentOrders` establecido por el adapter de T04 (`date_add DESC, id_order DESC`) — solo mapea cada orden a su `CustomerOrderSummary` enriquecido, en el mismo orden de entrada. Ninguna orden se filtra porque su estado no tenga nombre: toda orden que llegó desde T04 sigue apareciendo, con `resolution: 'unknown'` si corresponde. Confirmado por test (`maps distinct currentStateIds correctly without changing recentOrders order`).

## Fallas Del Catálogo De Estados

Reutiliza las causas ya existentes desde T03, sin agregar ninguna nueva:

```text
orderStatesReader timeout          → degraded / prestashop_timeout
orderStatesReader unavailable      → degraded / prestashop_unavailable
orderStatesReader error desconocido → se propaga (error de servicio, 500)
```

Misma dependencia PrestaShop que ya podía fallar en T03/T04 — no una causa nueva. Confirmado por test (timeout/unavailable/error desconocido sobre `orderStatesReader`).

## Warnings

`order_state_label_missing` se agrega como máximo una vez por snapshot, sin importar cuántas órdenes tengan un estado sin resolver — el caso de uso rastrea con un flag booleano (`resolveOrderState`), no concatena el warning por cada orden. No contiene el `stateId`, el nombre ni la referencia de la orden.

## Preparación Futura Para Postventa

T05 deja disponible para una tarea futura (candidata: **CP-R1-T06 — Customer Order Tracking Capability**):

```text
orderId
reference
currentStateId
currentState.name
updatedAt
```

Esa tarea futura podría combinar `current_state` + `ps_order_history` + carrier/tracking + lenguaje comercial seguro para responder "¿dónde está mi pedido?". T05 **no** implementa: endpoint `/orders/:id/status`, selección de una orden por referencia, búsqueda por teléfono/email, tracking, Carrier MS, `ps_order_history`, ETA, mensajes al cliente, tools de Sales AI ni routing a Postventa.

## Regla De Diseño: Sin Clasificación Por Keywords

**Incorrecto** (no implementado en T05):

```ts
if (name.includes('enviado')) {
  stage = 'shipped';
}
```

**Correcto** (lo que T05 realmente expone):

```json
{
  "currentStateId": 4,
  "currentState": { "stateId": 4, "name": "Enviado", "resolution": "resolved" }
}
```

`name` es contenido descriptivo tomado tal cual del catálogo de PrestaShop — no una entrada de una regla de routing. Una futura clasificación empresarial (p. ej. "¿esta orden ya fue despachada?") deberá usar IDs de estado configurados explícitamente o una tabla de mapeo explícita, nunca keywords traducidas del nombre.

## Readiness

`GET /health/ready` **no** consulta el catálogo completo de estados — sigue usando el probe ligero de PrestaShop ya existente desde T03 (`SELECT 1`). Una traducción individual ausente se detecta en runtime como `unknown`, no en readiness. Una tabla completa ausente o un error SQL real en el catálogo se propaga como falla de la dependencia PrestaShop (mismo camino que cualquier otro error de `mysql-order-states-reader.ts`), no como un chequeo aparte en `/health/ready`.

## Composición

[`src/bootstrap.ts`](../../src/bootstrap.ts): una sola instancia de `orderStatesReader`, construida con `createMysqlOrderStatesReader(getPrestashopQueryExecutor(), config.prestashopDb.prefix)` — mismo pool lógico PrestaShop que `prestashopCustomerReader`/`customerOrdersReader`, sin pool nuevo. `orderStateLanguageId` se inyecta desde `config.customerProfile.orderStateLanguageId`; el dominio y la aplicación nunca leen `process.env` ni `config.js` directamente.

[`src/infrastructure/prestashop/index.ts`](../../src/infrastructure/prestashop/index.ts) exporta `createMysqlOrderStatesReader` junto al resto de adapters de PrestaShop.

## Observabilidad

Se mantiene `recentOrderCount`. Se agrega `unknownOrderStateCount` (agregado numérico únicamente — cuántas órdenes del snapshot quedaron en `resolution: 'unknown'`). Nunca se loguea: nombre de estado, `currentStateId`, referencia de orden, ID de orden, montos, la lista completa de órdenes, ni PII. Confirmado por test (`never logs order state names or order references on success`).

## Seguridad

Read-only. IDs de estado e idioma parametrizados; el `IN (...)` se construye únicamente a partir de la cantidad de IDs deduplicados, nunca interpolando los valores numéricos. Prefijo de tabla validado. Sin búsqueda por nombre. Sin detalles internos en errores (mismo middleware/clasificación de T03). Sin PII nueva en logs ni en warnings. Endpoint interno, sin autenticación nueva — sin cambios respecto a T03/T04 en ese punto.

## Límites

Acotado por el mismo `CUSTOMER_PROFILE_RECENT_ORDERS_LIMIT` de T04 (el catálogo de estados nunca se consulta con más IDs únicos de los que puede haber en `recentOrders`, que ya está limitado). No hay un límite adicional propio del catálogo de estados: el número de estados distintos configurados en PrestaShop es intrínsecamente pequeño (decenas, no miles).

## Fuera De Alcance De T05

Clasificación semántica de estados, `isDelivered`/`isCancelled`/`isFinal`/`isPaid`/`customerMessage`/`recommendedAction`, tracking real, ETA, Carrier MS, `ps_order_history`, endpoint `/orders/:id/status`, búsqueda de una orden por referencia/teléfono/email, mensajes al cliente, tools de Sales AI, routing a Postventa, migraciones, backfill, escritura de estados.

## Plan De Pruebas

- `tests/unit/mysql-order-states-reader.test.ts`: `stateIds` vacío (sin ejecutar SQL), deduplicación, cantidad de placeholders `IN (...)`, parámetros (`[...ids, languageId]`), tabla `<prefix>order_state` + join `<prefix>order_state_lang`, filtro `id_lang = ?`, ausencia de búsqueda por nombre y de `GROUP_CONCAT`, ausencia de `INSERT/UPDATE/DELETE/ALTER`, mapeo snake_case → camelCase, prefijo inseguro rechazado, ID de estado inválido (cero/negativo/decimal) rechazado, `languageId` inválido rechazado, timeout/unavailable/error desconocido.
- `tests/unit/get-customer-profile.test.ts`: sin órdenes → `orderStatesReader` nunca llamado; una orden con estado encontrado → `resolved` + nombre; varias órdenes con el mismo `currentStateId` → una sola llamada con un ID deduplicado; `orderStateLanguageId` configurado se pasa tal cual; estados distintos mapeados sin alterar el orden; estado ausente → `unknown` + warning; varios estados ausentes → warning una sola vez; warning sin el ID incluido; timeout/unavailable/error desconocido del catálogo de estados; ninguna orden queda marcada como resuelta si la consulta completa del catálogo falla.
- `tests/integration/customer-profile-route.test.ts`: contrato JSON completo para `resolved` y `unknown`, sin exposición de columnas internas adicionales, log de éxito sin nombres de estado ni referencias (solo `recentOrderCount`/`unknownOrderStateCount` agregados).
- `tests/unit/contracts.test.ts`: forma real de `CustomerOrderStateContext` en ambas resoluciones.

Ninguna prueba depende de una base de datos real ni de credenciales productivas.
