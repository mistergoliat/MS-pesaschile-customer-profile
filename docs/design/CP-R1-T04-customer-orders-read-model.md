# CP-R1-T04 Customer Orders Read Model

Fecha: 2026-07-28.

Estado: implementado (lectura read-only de órdenes recientes). Sin migraciones ejecutadas, sin backfill, sin escrituras.

## Decisión Empresarial Confirmada

Regla de negocio vigente en PesasChile:

```text
si una orden existe en ps_orders
→ se considera una orden pagada
```

Esta tarea **no reinterpreta** esa regla usando `current_state` ni `valid`. `ps_orders` representa el historial de órdenes pagadas del cliente; toda fila devuelta por este read model es, por definición de negocio, una orden pagada.

`current_state` **no decide** si la orden cuenta como pagada. Representa el paso operacional o postventa en que se encuentra (pagada, preparando, embalando, en despacho, entregada u otros estados operacionales de PrestaShop). T04 captura `current_state` como dato bruto — un `currentStateId: number` sin nombre, sin clasificación, sin traducción a un estado humano. Esa interpretación queda para una tarea futura (ver "Preparación Para Postventa Futura").

`valid` también se captura como dato bruto (`valid: boolean`), sin usarse jamás como filtro de pago. No existe un campo `isPaid`: sería redundante, porque en este read model *toda* fila ya es una orden pagada por definición.

## Precondición

Customer Profile sigue sin resolver identidad. T04 solo extiende el flujo ya establecido en CP-R1-T03, una vez que `masterCustomerId` ya fue confirmado por onboarding / Identity Resolver.

## Flujo Implementado

[`src/application/customer-profile/get-customer-profile.ts`](../../src/application/customer-profile/get-customer-profile.ts) → `createGetCustomerProfile`:

```text
1. leer master_customer por masterCustomerId
2. si no existe            → not_found                       (PrestaShop NO se consulta, orders NO se consulta)
3. si existe sin link      → partial / not_linked             (PrestaShop NO se consulta, orders NO se consulta)
4. si existe con link      → leer ps_customer por prestashop_customer_id
5. ps_customer no existe   → degraded / prestashop_customer_not_found   (orders NO se consulta)
6. ps_customer existe      → leer ps_orders por id_customer (limit configurado)
7. timeout de orders       → degraded / prestashop_timeout
8. orders no disponible    → degraded / prestashop_unavailable
9. snapshot construido     → available, con recentOrders
10. falla la construcción  → degraded / profile_build_failed
```

`ps_orders` nunca se consulta si el flujo termina antes del paso 6: `master_customer` inexistente, sin `prestashop_customer_id`, o `ps_customer` inexistente/con error. Esto está confirmado por test (`unreachableOrdersReader` en los tres casos).

Un error no clasificado al leer órdenes (cualquier cosa que no sea `PrestashopTimeoutError` / `PrestashopUnavailableError`) **se propaga**, igual que en T03 para `ps_customer` — no es un estado de `CustomerProfileLookupResult`, es un error de servicio (5xx genérico).

**No se agregó una causa `orders_not_found`.** Una lista vacía de órdenes es un resultado exitoso, no un error. Una falla real de la consulta de órdenes se mapea a la misma causa que ya existía para `ps_customer` (`prestashop_timeout` / `prestashop_unavailable`), porque es la misma dependencia PrestaShop, no una nueva.

## Fuente De La Relación

Exclusivamente:

```text
master_customer.prestashop_customer_id
→ ps_orders.id_customer
```

No se busca por email, nombre, RUT, dirección, teléfono ni `id_guest`. Confirmado por test estructural del SQL (`tests/unit/mysql-customer-orders-reader.test.ts`).

## Modelo De Lectura

[`src/domain/customer-profile/customer-order-record.ts`](../../src/domain/customer-profile/customer-order-record.ts):

```ts
export type CustomerOrderRecord = {
  readonly orderId: number;
  readonly reference: string;
  readonly customerId: number;
  readonly currentStateId: number;
  readonly valid: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly totalPaidTaxIncl: string;
  readonly totalProductsTaxIncl: string;
  readonly currencyId: number;
};
```

`orderId` e `id_customer` son `int(10) unsigned` en el schema real de `ps_orders` (PrestaShop estándar) — muy por debajo de `Number.MAX_SAFE_INTEGER` — así que se mantienen `number`, a diferencia de `master_customer.id` (`bigint`). Los montos (`totalPaidTaxIncl`, `totalProductsTaxIncl`) se mantienen `string`: mysql2 devuelve columnas `DECIMAL` como string por defecto (no se configuró `decimalNumbers` en el pool de PrestaShop), que es exactamente lo que preserva precisión aquí — nunca se convierten a `number`.

**Advertencia de validación de schema:** los tipos y nulabilidad de las columnas de `ps_orders` se basan en el schema estándar de PrestaShop 1.7.8.x y todavía no han sido confirmados mediante inventario directo del ambiente PesasChile (`docs/audits/CP-R1-T01-schema-inventory.md` solo confirmó que la tabla existe, no inventarió sus columnas). La validación operacional deberá realizarse antes del primer despliegue conectado a datos reales.

## Puerto

[`src/application/customer-profile/ports.ts`](../../src/application/customer-profile/ports.ts):

```ts
export interface CustomerOrdersReader {
  findByCustomerId(
    prestashopCustomerId: number,
    options?: {
      readonly limit?: number;
    },
  ): Promise<readonly CustomerOrderRecord[]>;
}
```

`mysql2` nunca se expone fuera de `src/infrastructure/`. El caso de uso nunca ve SQL. Sin métodos de escritura.

## Adapter (Read-Only)

[`src/infrastructure/prestashop/mysql-customer-orders-reader.ts`](../../src/infrastructure/prestashop/mysql-customer-orders-reader.ts):

```sql
SELECT
  id_order, reference, id_customer, current_state, valid,
  date_add, date_upd, total_paid_tax_incl, total_products_wt, id_currency
FROM <prefix>orders
WHERE id_customer = ?
ORDER BY date_add DESC, id_order DESC
LIMIT <limit>
```

- `id_customer` parametrizado (`?`).
- Prefijo validado con `^[A-Za-z0-9_]+$` antes de interpolarse en el nombre de tabla (mismo patrón que `mysql-prestashop-customer-reader.ts`), porque SQL no permite parametrizar identificadores.
- **`LIMIT` no se pasa como placeholder `?`**: se valida como entero seguro (`Number.isInteger`, `1 <= limit <= 50`) y se interpola directamente, en vez de depender del soporte de `mysql2` para un placeholder de `LIMIT` en sentencias preparadas. Es el mismo patrón defensivo ya usado para el prefijo — el valor nunca viene de entrada de usuario sin validar (siempre pasa por el límite configurado por variable de entorno o por un valor explícito ya acotado), y un límite inválido lanza en vez de usarse.
- Sin joins, sin subqueries, sin escrituras.
- Orden determinístico: `date_add DESC, id_order DESC`.
- Timeout heredado del `QueryExecutor` compartido (mismo mecanismo que el resto de los adapters de T03).
- Errores conocidos (`ETIMEDOUT`, `ECONNREFUSED`, etc.) mapean a `PrestashopTimeoutError` / `PrestashopUnavailableError` (reutilizadas de `errors.ts`, no se crearon tipos nuevos). Errores desconocidos se propagan sin clasificar.

**No filtra por `current_state` ni por `valid`.** Ambos se seleccionan y se devuelven como hechos operacionales brutos — nunca como condición `WHERE`. Confirmado por test (`does not filter by current_state or valid`).

## Límite De Órdenes

No se devuelve historial ilimitado en runtime. `CUSTOMER_PROFILE_RECENT_ORDERS_LIMIT` (`.env.example`, `src/config.ts`), validado con Zod (`min(1)`, `max(50)`, default `10`). El adapter también valida el límite de forma independiente (mismo rango 1–50, default 10 si no se especifica), sin confiar ciegamente en que la validación de configuración ya ocurrió — mismo criterio ya aplicado al prefijo de tabla en T03.

El snapshot expone el campo como `recentOrders`, no `allOrders`: declara explícitamente que contiene órdenes recientes, acotadas por el límite, no necesariamente el historial completo del cliente.

## Snapshot Enriquecido

[`src/domain/customer-profile/contracts.ts`](../../src/domain/customer-profile/contracts.ts):

```ts
export type CustomerOrderSummary = {
  readonly orderId: number;
  readonly reference: string;
  readonly currentStateId: number;
  readonly valid: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly totalPaidTaxIncl: string;
  readonly totalProductsTaxIncl: string;
  readonly currencyId: number;
};

export type CustomerProfileSnapshot = {
  readonly masterCustomerId: string;
  readonly generatedAt: string;
  readonly customer: { /* sin cambios desde T03 */ };
  readonly prestashop: { /* sin cambios desde T03 */ };
  readonly recentOrders: readonly CustomerOrderSummary[];
  readonly warnings: readonly string[];
};
```

`CustomerOrderSummary` omite `customerId` (redundante con `prestashop.customerId`, ya presente en el snapshot). No se agregaron `completedOrders`, `cancelledOrders`, `deliveredOrders`, `totalRevenue`, `averageTicket`, `firstOrderAt` ni `lastCompletedOrderAt` — quedan fuera de alcance de T04. Tampoco se duplicó `lastOrderAt`: aunque `recentOrders[0]` ya es la orden más reciente cuando el arreglo no está vacío, no existe todavía una necesidad contractual concreta que justifique ese campo derivado.

## Integración Al Caso De Uso

[`src/application/customer-profile/get-customer-profile.ts`](../../src/application/customer-profile/get-customer-profile.ts): `createGetCustomerProfile` ahora recibe `customerOrdersReader` y `recentOrdersLimit` además de las dependencias de T03:

```ts
createGetCustomerProfile({
  masterCustomerReader,
  prestashopCustomerReader,
  customerOrdersReader,
  clock,
  recentOrdersLimit,
});
```

`recentOrders: []` significa exclusivamente "la consulta fue exitosa y `ps_orders` no tiene filas para este `id_customer`" — nunca significa que la consulta falló. Si la lectura de órdenes lanza `PrestashopTimeoutError` / `PrestashopUnavailableError`, el resultado degrada (`profile: null`) en vez de devolver `available` con `recentOrders: []` como si la consulta hubiera funcionado. Confirmado por test (`never returns available ... when the orders read fails`).

El caso de uso **no vuelve a ordenar** `recentOrders`: confía en el contrato del reader (`ORDER BY date_add DESC, id_order DESC` ya garantiza orden determinístico), y solo mapea cada `CustomerOrderRecord` a `CustomerOrderSummary` preservando el orden de llegada. Confirmado por test (`preserves the order returned by the reader instead of re-sorting`).

## Composición

[`src/bootstrap.ts`](../../src/bootstrap.ts): una sola instancia de `customerOrdersReader`, construida con `createMysqlCustomerOrdersReader(getPrestashopQueryExecutor(), config.prestashopDb.prefix)` — el mismo pool lógico PrestaShop que ya usa `prestashopCustomerReader` (`getPrestashopQueryExecutor()` envuelve el pool singleton perezoso existente, no crea uno nuevo). Sin conexiones por request.

[`src/infrastructure/prestashop/index.ts`](../../src/infrastructure/prestashop/index.ts) exporta `createMysqlCustomerOrdersReader` junto al resto de adapters de PrestaShop.

## Preparación Para Postventa Futura (CP-R1-T05)

T04 preserva deliberadamente lo mínimo necesario para que una tarea futura (`CP-R1-T05 — Order State Interpretation and Tracking Context`) pueda resolver `currentStateId` a un nombre operacional (preparando / embalando / en despacho / entregada / etc.) sin tener que re-diseñar este read model: `orderId`, `reference`, `currentStateId`, `createdAt`, `updatedAt`.

T04 explícitamente **no** consulta `ps_order_state_lang`, `ps_order_history`, carrier ni tracking number/delivery number, y **no inventa** estados humanos. Esa capability (responder "¿en qué está mi pedido?", "¿ya fue despachado?", "¿está en preparación?", "¿fue entregado?") queda completamente fuera de esta tarea.

## Errores Y Degradación

Reutiliza las causas ya existentes desde T03 sin agregar ninguna nueva:

```text
prestashop_unavailable
prestashop_timeout
prestashop_customer_not_found
profile_build_failed
```

No se agregó `orders_not_found`. Un `recentOrders: []` no es un error. Una falla real al leer órdenes se mapea a `prestashop_unavailable` / `prestashop_timeout` — la misma dependencia PrestaShop que ya fallaba en T03, no una causa nueva.

## Tests

- `tests/unit/get-customer-profile.test.ts`: además de las 7 ramas originales de T03, se agregaron los casos de T04 — `ps_customer` existe con 0/N órdenes, `recentOrders` mapeado preservando `currentStateId`/`valid` sin reinterpretarlos, orden preservado (no re-ordenado), límite y `prestashopCustomerId` exactos pasados al reader, timeout/unavailable/error-desconocido de la lectura de órdenes, y verificación explícita de que el reader de órdenes nunca se llama cuando el flujo termina antes del paso 6 (`unreachableOrdersReader`).
- `tests/unit/mysql-customer-orders-reader.test.ts`: tabla `<prefix>orders`, `WHERE id_customer = ?`, orden `date_add DESC, id_order DESC`, `LIMIT` (default y explícito), ausencia de filtro por `current_state`/`valid` (pero presencia en el `SELECT`), ausencia de `email`/`id_guest`, ausencia de `INSERT/UPDATE/DELETE/ALTER`, mapeo snake_case → camelCase, montos como string, `valid` convertido a boolean (`1`/`0`), prefijo inseguro rechazado, límite inválido (cero, negativo, no entero, sobre el máximo) rechazado, timeout/unavailable/error desconocido.
- `tests/integration/customer-profile-route.test.ts`: el caso `available` ahora incluye `recentOrders`; se agregó verificación del contrato JSON completo de una orden (`currentStateId`, `valid`, montos como string, sin `customerId` ni `isPaid` filtrados), y un caso explícito de `recentOrders: []` devolviendo 200.
- `tests/unit/contracts.test.ts`: forma real del snapshot extendido y de `CustomerOrderSummary`.

Ninguna prueba depende de una base de datos real ni de credenciales productivas, siguiendo el mismo criterio de T03.

## Observabilidad

Se agregó `recentOrderCount` al log de éxito (`src/http/routes/index.ts`, `logLookup`) — solo el conteo, nunca la lista. Se sigue sin loguear `reference`, montos, `currentStateId`, `email`, RUT ni nombres, en ningún punto de éxito o falla.

## Seguridad

Read-only. Consulta solo por `prestashopCustomerId` ya vinculado (nunca por email ni listados globales). Límite máximo acotado (50) tanto en configuración como en el adapter. Consultas parametrizadas para `id_customer`; `LIMIT` validado como entero seguro antes de interpolarse. Sin detalles internos en errores (mismo middleware/clasificación de T03). Sin PII nueva en logs. El endpoint sigue siendo interno, sin autenticación nueva — sin cambios respecto a T03 en ese punto.

## Fuera De Alcance De T04

Clasificación semántica de estados, tracking de despacho, Carrier MS, postventa, devoluciones, reembolsos, líneas de producto, direcciones, teléfonos, carritos, recomendaciones, agregados predictivos, scoring, oportunidades, escritura de órdenes, cambio de estado, migraciones, backfill.
