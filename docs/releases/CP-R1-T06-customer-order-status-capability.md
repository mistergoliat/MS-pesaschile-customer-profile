# CP-R1-T06 Customer Order Status Capability

Fecha: 2026-07-29.

Estado: implementado. Read-only. Sin migraciones, sin backfill, sin escrituras, sin conexión a producción durante el desarrollo.

## Objetivo

Dar a Sales AI una forma segura de responder **"¿cuál es el estado de mi pedido `X`?"** para un `masterCustomerId` y una `reference` de orden específicos.

La respuesta entrega:

- el último estado registrado en PrestaShop (`currentStateId` + `currentStateName`);
- el método de entrega seleccionado (`deliveryMethod`), derivado de un mapa de negocio explícito sobre `id_carrier`;
- un plazo general declarado para ese método (`deliveryEstimate`), nunca una fecha calculada;
- una aclaración explícita y siempre presente de que esto **no** es tracking en tiempo real (`isRealTimeTracking: false`).

T06 **no** implementa un sistema de tracking. No hay número de guía, no hay eventos logísticos, no hay integración con Carrier MS, no hay ETA exacta, no hay cálculo de días hábiles/feriados.

## Arquitectura

Mismo patrón de capas que T03–T05: dominio puro (contratos + políticas testeadas sin I/O) → aplicación (caso de uso que orquesta puertos) → infraestructura (adapters MySQL sobre el mismo pool PrestaShop) → HTTP (Express, validación con Zod).

```text
src/domain/customer-order-status/
  contracts.ts                 → DeliveryMethod, DeliveryEstimate, CustomerOrderStatus,
                                  GetCustomerOrderStatusInput/Result, warnings
  customer-order-status-record.ts → CustomerOrderStatusRecord (read model de ps_orders)
  carrier-record.ts            → CarrierRecord (read model de ps_carrier + ps_carrier_lang)
  resolve-delivery-method.ts   → política pura: id_carrier -> DeliveryMethod
  resolve-delivery-estimate.ts → política pura: DeliveryMethod -> DeliveryEstimate

src/application/customer-order-status/
  ports.ts                     → CustomerOrderStatusReader, CarriersReader
  get-customer-order-status.ts → createGetCustomerOrderStatus (caso de uso)

src/infrastructure/prestashop/
  mysql-customer-order-status-reader.ts → SELECT ... FROM <prefix>orders WHERE id_customer = ? AND reference = ?
  mysql-carriers-reader.ts              → SELECT ... FROM <prefix>carrier LEFT JOIN <prefix>carrier_lang

src/http/routes/index.ts       → GET /v1/customers/:masterCustomerId/orders/:reference/status
```

`GetCustomerOrderStatus` reutiliza dos dependencias ya existentes en vez de duplicarlas:

- `MasterCustomerReader` (T03) para resolver `masterCustomerId → prestashop_customer_id`.
- `OrderStatesReader` (T05) para resolver `currentStateId → name`, llamado siempre con un array de un solo elemento.

No reutiliza `PrestashopCustomerReader` ni `CustomerOrdersReader` (T03/T04): esta capability no necesita leer `ps_customer` ni la lista de órdenes recientes, solo la orden puntual solicitada.

## Fuente De Verdad

```text
ps_orders.current_state
  → ps_order_state_lang.id_order_state (+ id_lang = PRESTASHOP_ORDER_STATE_LANG_ID)
  → ps_order_state_lang.name
```

Explícitamente **no** usados como autoridad del estado: `ps_order_history` (historial de transiciones, no el estado actual), flags de `ps_order_state` (`paid`/`shipped`/`delivery`), keywords del nombre del estado, ni el `template` del estado. `ps_order_history` queda completamente fuera de esta capability — ningún archivo de `src/` la referencia.

## Búsqueda Segura De La Orden (Pertenencia En La Misma Consulta)

```sql
SELECT id_order, reference, id_customer, current_state, id_carrier, date_upd
FROM <prefix>orders
WHERE id_customer = ?
  AND reference = ?
LIMIT 1
```

`id_customer` y `reference` viajan juntos en el mismo `WHERE`, nunca se busca solo por `reference` y se valida después. Consecuencia directa: una orden inexistente y una orden que pertenece a otro cliente son indistinguibles para el caso de uso — ambas producen exactamente `{ status: 'order_not_found' }`, sin filtrar nunca si la referencia existe bajo otro `id_customer`. Confirmado por test (`mysql-customer-order-status-reader.test.ts`: "never queries by reference alone"; `get-customer-order-status.test.ts`: "produces order_not_found the same way whether the order truly does not exist or belongs to another customer").

## Mapa De Carriers (`resolveDeliveryMethod`)

Política pura y centralizada en [`src/domain/customer-order-status/resolve-delivery-method.ts`](../../src/domain/customer-order-status/resolve-delivery-method.ts), confirmada por operación:

| `id_carrier` | `deliveryMethod` |
| --- | --- |
| 1, 6, 15, 16 | `store_pickup` |
| 7, 13 | `warehouse_pickup` |
| 8, 9, 10, 11 | `event_pickup` |
| 2, 4, 12, 19 | `direct_dispatch` |
| 3, 5, 17, 18 | `external_carrier` |
| 14, cualquier id no listado | `unknown` |

Un único `Map<number, DeliveryMethod>`, sin switch/case distribuido en varios archivos. Nunca inspecciona `name`, `delay`, `is_module` ni `external_module_name` — confirmado por test (`resolve-delivery-method.test.ts` cubre el mapa completo; `get-customer-order-status.test.ts` "never uses ps_order_history, flags or keyword matching" prueba con un carrier cuyo `name`/`delay` sugerirían otra clasificación por texto, y el resultado sigue viniendo solo de `carrierId`).

**Nota documental (igual que en la tarea original):** este primer mapa usa `id_carrier` porque es la información operacional confirmada disponible hoy. Una futura evolución puede migrarlo a `id_reference` cuando se audite y confirme el mapa real de referencias — ver "Relación Futura Con Carrier MS".

## Estimaciones (`resolveDeliveryEstimate`)

Política pura en [`src/domain/customer-order-status/resolve-delivery-estimate.ts`](../../src/domain/customer-order-status/resolve-delivery-estimate.ts):

| `deliveryMethod` | `deliveryEstimate` |
| --- | --- |
| `direct_dispatch` | `applicable`, 3–5 días hábiles desde despacho |
| `external_carrier` | `applicable`, 5–15 días hábiles desde despacho |
| `store_pickup` / `warehouse_pickup` / `event_pickup` | `not_applicable` |
| `unknown` | `unknown` |

Es una declaración de negocio, no un cálculo: sin fechas de calendario, sin feriados, sin afirmar que el plazo ya empezó a correr. `startsFrom: 'dispatch'` solo nombra desde cuándo se cuenta el rango, nunca una fecha concreta.

## Lectura Del Carrier

[`src/infrastructure/prestashop/mysql-carriers-reader.ts`](../../src/infrastructure/prestashop/mysql-carriers-reader.ts):

```sql
SELECT c.id_carrier, c.id_reference, c.name, cl.delay
FROM <prefix>carrier c
LEFT JOIN <prefix>carrier_lang cl
  ON cl.id_carrier = c.id_carrier
 AND cl.id_lang = ?
 AND cl.id_shop = ?
WHERE c.id_carrier = ?
LIMIT 1
```

`LEFT JOIN` deliberado: si `carrier_lang` no tiene fila para el idioma/tienda configurados, el carrier igual se devuelve con `delay: null` — solo un carrier ausente de `ps_carrier` produce `null`. Un carrier inexistente **no** degrada el resto del lookup: produce `deliveryMethod: 'unknown'` más los warnings `carrier_not_found` y `delivery_method_unknown`, con `status: 'available'`. Un carrier presente pero sin mapeo confirmado (ej. `14`) produce `deliveryMethod: 'unknown'` con solo el warning `delivery_method_unknown` (sin `carrier_not_found`, porque la fila sí existe).

**`id_carrier = 0`** es un valor legítimo de PrestaShop para órdenes sin envío físico (ej. productos virtuales) — nunca existe una fila con ese id en `ps_carrier`. El reader lo detecta antes de ejecutar SQL y devuelve `null` directamente (mismo resultado que un carrier realmente ausente), en vez de rechazarlo como id inválido. `carrierId` negativo, decimal, `NaN`, `Infinity` o fuera de rango seguro sigue rechazándose. Ver `resolveCarrierId` en [`mysql-carriers-reader.ts`](../../src/infrastructure/prestashop/mysql-carriers-reader.ts).

### Fuente De `id_carrier` Y Mismatch Conocido (T06A)

T06 usa exclusivamente `ps_orders.id_carrier` como fuente de verdad del carrier — nunca `ps_order_carrier` (la tabla transaccional escrita en el momento del despacho). `CP-R1-T06A-tracking-coverage.md` documenta, contra datos reales de PesasChile, que `orders.id_carrier` **no coincide** con el `id_carrier` del `order_carrier` más reciente en 400 de 80.189 órdenes comparables (**0,50%**) — en esos casos `order_carrier` es la fuente más confiable porque `orders.id_carrier` puede haberse modificado después del despacho, mientras `order_carrier` no. T06 acepta este 0,50% de posible imprecisión en `deliveryMethod` como una limitación conocida y cuantificada, no como un defecto de implementación: la sección "Fuente de verdad" del encargo especifica `ps_orders.id_carrier` explícitamente. Una evolución futura podrá priorizar `ps_order_carrier` sobre `ps_orders.id_carrier` cuando exista discrepancia entre ambos, sin cambiar el contrato público de `CustomerOrderStatus`.

## Idiomas Configurables (Independientes)

```dotenv
PRESTASHOP_ORDER_STATE_LANG_ID=1   # ya existente desde T05
PRESTASHOP_CARRIER_LANG_ID=1       # nuevo, T06
PRESTASHOP_CARRIER_SHOP_ID=1       # nuevo, T06
```

`PRESTASHOP_CARRIER_LANG_ID` es independiente de `PRESTASHOP_ORDER_STATE_LANG_ID` por diseño: ambos pueden terminar apuntando al mismo idioma en la instalación real de PesasChile, pero eso es un hecho operacional a confirmar, no una asunción a codificar reutilizando una sola variable para dos catálogos distintos. Ninguna de las dos variables nuevas tiene default silencioso — mismo criterio que `PRESTASHOP_ORDER_STATE_LANG_ID` desde T05: el proceso falla explícitamente al arrancar si faltan.

## Contrato Público

```ts
type DeliveryMethod =
  | 'direct_dispatch' | 'external_carrier' | 'store_pickup'
  | 'warehouse_pickup' | 'event_pickup' | 'unknown';

type CustomerOrderStatus = {
  orderId: number;
  reference: string;
  currentStateId: number;
  currentStateName: string | null;
  deliveryMethod: DeliveryMethod;
  deliveryEstimate: DeliveryEstimate;
  lastRecordedUpdateAt: string;   // ISO-8601, desde ps_orders.date_upd
  source: 'prestashop_current_state';
  isRealTimeTracking: false;
};

type GetCustomerOrderStatusResult =
  | { status: 'available'; order: CustomerOrderStatus; warnings: readonly CustomerOrderStatusWarning[] }
  | { status: 'customer_not_found' | 'customer_not_linked' | 'order_not_found' }
  | { status: 'degraded'; reason: 'prestashop_unavailable' | 'prestashop_timeout' };

type CustomerOrderStatusWarning =
  | 'order_state_label_missing' | 'carrier_not_found' | 'delivery_method_unknown';
```

Ningún warning contiene IDs, referencias, nombres ni PII — solo la etiqueta fija. Ver [`src/domain/customer-order-status/contracts.ts`](../../src/domain/customer-order-status/contracts.ts).

## Endpoint

```text
GET /v1/customers/{masterCustomerId}/orders/{reference}/status
```

Ejemplo `200 available`:

```json
{
  "status": "available",
  "order": {
    "orderId": 123,
    "reference": "ABC123XYZ",
    "currentStateId": 4,
    "currentStateName": "Entregado a Transportista",
    "deliveryMethod": "direct_dispatch",
    "deliveryEstimate": { "status": "applicable", "minimumBusinessDays": 3, "maximumBusinessDays": 5, "startsFrom": "dispatch" },
    "lastRecordedUpdateAt": "2026-01-02T10:00:00.000Z",
    "source": "prestashop_current_state",
    "isRealTimeTracking": false
  },
  "warnings": []
}
```

Códigos de estado (misma convención que T03–T05, sin inventar un esquema nuevo):

| `status` | HTTP |
| --- | --- |
| `available` | 200 |
| `customer_not_found` | 404 |
| `customer_not_linked` | 404 |
| `order_not_found` | 404 |
| `degraded` (`prestashop_unavailable` / `prestashop_timeout`) | 503 |
| validación (`masterCustomerId`/`reference` inválidos) | 400 |
| error desconocido | 500 |

`customer_not_found`, `customer_not_linked` y `order_not_found` comparten 404 deliberadamente: ninguno de los tres devuelve un `order`, y usar el mismo código evita filtrar por el status code si el problema fue "no existe el cliente" vs. "no existe el link" vs. "no existe/no es tuya la orden" — esa distinción vive solo en el campo `status` del body, nunca en el código HTTP.

Validación de parámetros (`src/http/routes/index.ts`):

- `masterCustomerId`: mismo criterio que el endpoint de perfil (numérico, 1–20 caracteres) — nunca acepta un email.
- `reference`: alfanumérico, 1–32 caracteres, decodificado por Express antes de validar — nunca acepta un `id_customer` de PrestaShop.
- Es un `GET`: no hay body que validar.

## Seguridad

- Toda consulta SQL parametrizada; el prefijo de tabla se valida con `^[A-Za-z0-9_]+$` antes de interpolarse (igual que T03–T05).
- Sin `SELECT *`. Sin búsqueda por nombre en ningún reader.
- La pertenencia de la orden al cliente se valida en la misma query (`id_customer AND reference`), nunca después.
- `order_not_found` nunca revela si la referencia existe bajo otro cliente.
- Read-only en todos los adapters — ningún `INSERT/UPDATE/DELETE/ALTER`.
- Logs de éxito: `status`, `deliveryMethod`, `currentStateResolved`, `carrierResolved`, cantidad de warnings y duración — nunca `masterCustomerId`, `prestashopCustomerId`, `orderId`, `reference`, `currentStateId`, `currentStateName`, `carrierId`, `carrierName`, `delay`, montos ni PII (más estricto que el log de T03, que sí incluye `masterCustomerId`). Logs de error: solo una clasificación segura (`classifyErrorForLog`), nunca `error.message` crudo.
- Endpoint interno, sin autenticación nueva — mismo estado que T03–T05.

## Ausencia De Tracking Real

`isRealTimeTracking` es siempre `false`: `currentStateName`/`currentStateId` son el último estado que PrestaShop registró en `ps_orders.current_state`, no una posición física del paquete ni un feed en vivo. No hay número de guía, no hay eventos de tránsito, no hay ETA calculada a partir de un `deliveryEstimate` — el rango de días hábiles es una política de negocio declarada, no una promesa de fecha.

## Limitaciones / Fuera De Alcance

Confirmado ausente de esta tarea (ver también sección 17 del encargo):

- `ps_order_history`, `ps_order_detail`, `tracking_number`.
- Integración con Carrier MS.
- ETA exacta, feriados, fechas calculadas.
- Clasificación operacional por etapas (`operationalStage` extenso tipo T06A) — esa propuesta sigue viviendo solo en `scripts/audits/order-state-semantics/`, nunca conectada a un endpoint runtime.
- Clasificación por keywords del nombre de estado o del carrier, o por flags (`paid`/`shipped`/`delivery`, `is_module`, `external_module_name`).
- Mensajes generados por LLM: el microservicio entrega datos estructurados; Sales AI redacta el mensaje final (ver ejemplos de consumo abajo).
- Escrituras, migraciones, backfill.
- Modificación de `recentOrders` del snapshot principal (`GET /v1/customers/{masterCustomerId}/profile`, T03–T05) — endpoint separado, contrato separado.

Limitación conocida y aceptada (no un gap de implementación): el 0,50% de mismatch entre `ps_orders.id_carrier` y `ps_order_carrier` — ver "Fuente De `id_carrier` Y Mismatch Conocido (T06A)" arriba.

## Relación Futura Con Carrier MS

El mapa `id_carrier → deliveryMethod` es una decisión operacional explícita y versionada en código (`resolve-delivery-method.ts`), no derivada en runtime desde `ps_carrier.is_module`/`external_module_name` ni desde texto. Cuando exista un Carrier MS con tracking real, la expectativa es que esa capability futura reemplace o complemente `deliveryEstimate`/`isRealTimeTracking` sin cambiar el contrato de `CustomerOrderStatus` que Sales AI ya consume — y que la migración de `id_carrier` a `id_reference` (si se confirma necesaria) ocurra dentro de esta misma política pura, sin tocar el caso de uso ni el endpoint.

## Ejemplos De Consumo (Documental, No Implementado)

El microservicio nunca genera este texto — vive en Sales AI:

- `direct_dispatch`: "El último estado registrado de tu pedido es 'X'. Elegiste despacho directo de PesasChile, cuyo plazo estimado es de 3 a 5 días hábiles desde el despacho."
- `external_carrier`: "El último estado registrado de tu pedido es 'X'. Elegiste un transportista externo, cuyo plazo estimado es de 5 a 15 días hábiles desde el despacho."
- pickup (`store_pickup`/`warehouse_pickup`/`event_pickup`): "El último estado registrado de tu pedido es 'X'. La orden corresponde a retiro, por lo que no aplica un plazo de despacho."

## Composición

[`src/bootstrap.ts`](../../src/bootstrap.ts): `customerOrderStatusReader` y `carriersReader` se construyen con `getPrestashopQueryExecutor()` — mismo pool lógico PrestaShop que el resto de los adapters, sin pool nuevo. `getCustomerOrderStatus` reutiliza la misma instancia de `masterCustomerReader` y `orderStatesReader` que `getCustomerProfile`.

## Plan De Pruebas

- `tests/unit/resolve-delivery-method.test.ts`: mapa completo (18 ids confirmados), carrier 14, id no configurado, aridad de la función (nunca recibe `name`/`delay`).
- `tests/unit/resolve-delivery-estimate.test.ts`: los 6 métodos, ausencia de campos de fecha calculada.
- `tests/unit/mysql-customer-order-status-reader.test.ts`: consulta por `id_customer AND reference`, `LIMIT 1`, sin `SELECT *`, sin `ps_order_history`, prefijo inseguro, `customerId`/`reference` inválidos (vacía, larga, caracteres inseguros), timeout/unavailable/error desconocido, parseo de `date_upd` a `Date`, `date_upd` no parseable rechazado.
- `tests/unit/mysql-carriers-reader.test.ts`: join con `carrier_lang`, parámetros `id_lang`/`id_shop`/`id_carrier`, carrier ausente, `delay: null` por `LEFT JOIN`, `carrierId` inválido (negativo/decimal/NaN/Infinity/inseguro) rechazado sin ejecutar SQL, **`carrierId = 0` devuelve `null` sin ejecutar SQL**, timeout/unavailable/error desconocido.
- `tests/unit/get-customer-order-status.test.ts`: los cuatro `status` no-`available`, orden ajena indistinguible de orden inexistente, estado resuelto/sin label, carrier directo/externo/pickup/14/inexistente/**`carrierId = 0`**, warnings exactos por caso, timeout/unavailable/error desconocido por cada reader, no se consulta la orden si el master no existe o no está linkeado, no se consulta estado/carrier si la orden no existe, `source`/`isRealTimeTracking` fijos, parámetros exactos pasados a cada reader.
- `tests/integration/customer-order-status-route.test.ts`: contrato JSON completo, `null` serializado (no omitido), códigos 200/404/503/400/500, validación de `masterCustomerId`/`reference`, logs sin PII en éxito y en error.

Ninguna prueba depende de una base de datos real ni de credenciales productivas.
