# CP-R1-T03 Customer Profile Runtime Read Foundation

Fecha: 2026-07-27.

Estado: implementado (lookup mínimo real, read-only). Sin migraciones ejecutadas, sin backfill, sin escrituras.

## Precondición

Customer Profile no resuelve identidad. Solo se invoca después de que onboarding / Identity Resolver confirmó `masterCustomerId`:

```text
onboarding / Identity Resolver
→ confirma que existe master_customer
→ entrega masterCustomerId
→ recién entonces se permite consultar Customer Profile
```

Entrada runtime, sin campos de email:

```ts
export type GetCustomerProfileInput = {
  readonly masterCustomerId: string;
};
```

## Flujo Implementado

[`src/application/customer-profile/get-customer-profile.ts`](../../src/application/customer-profile/get-customer-profile.ts) → `createGetCustomerProfile`:

```text
1. leer master_customer por masterCustomerId
2. si no existe            → not_found                      (PrestaShop NO se consulta)
3. si existe sin link      → partial / not_linked            (PrestaShop NO se consulta)
4. si existe con link      → leer ps_customer por prestashop_customer_id
5. ps_customer no existe   → degraded / prestashop_customer_not_found
6. timeout de PrestaShop   → degraded / prestashop_timeout
7. PrestaShop no disponible→ degraded / prestashop_unavailable
8. snapshot construido     → available
9. falla la construcción   → degraded / profile_build_failed
```

Errores no clasificados (falla de CRM al leer `master_customer`, o un error de PrestaShop que no es `PrestashopTimeoutError`/`PrestashopUnavailableError`) **se propagan**, no se absorben en el resultado. No son un estado de `CustomerProfileLookupResult`: son errores de servicio (5xx genérico vía middleware de Express), nunca `not_found` ni un `degraded` inventado.

## Límites (confirmados por diseño y por tests)

No busca por email. No crea `master_customer`. No modifica `master_customer`. No vincula clientes. No ejecuta backfill. No ejecuta migraciones. No lee órdenes, direcciones ni carritos. No calcula comportamiento comercial. No llama al worker autónomo.

## Puertos

[`src/application/customer-profile/ports.ts`](../../src/application/customer-profile/ports.ts):

```ts
export interface MasterCustomerReader {
  findById(masterCustomerId: string): Promise<MasterCustomerRecord | null>;
}

export interface PrestashopCustomerReader {
  findById(prestashopCustomerId: number): Promise<PrestashopCustomerRecord | null>;
}

export interface Clock {
  now(): Date;
}
```

`null` en `MasterCustomerReader.findById` significa "la fila no existe" (→ `not_found`). Una falla de conexión/consulta CRM **debe** rechazar la promesa, nunca resolver a `null` — confirmado por test (`propagates CRM (master_customer) read failures instead of treating them as not_found`).

`null` en `PrestashopCustomerReader.findById` significa "`ps_customer` no existe" (→ `degraded / prestashop_customer_not_found`, un resultado válido, no una excepción). Timeout/indisponibilidad se modelan como errores tipados:

[`src/application/customer-profile/errors.ts`](../../src/application/customer-profile/errors.ts): `PrestashopTimeoutError`, `PrestashopUnavailableError`, `CustomerProfileBuildError`, y (agregados en la corrección post-auditoría) `CrmUnavailableError`, `CrmTimeoutError`, `CrmSchemaIncompatibleError`.

**Política de errores desconocidos** (explícita, no implícita): el caso de uso solo mapea `PrestashopTimeoutError` → `prestashop_timeout`, `PrestashopUnavailableError` → `prestashop_unavailable`, y `CustomerProfileBuildError` (lanzado únicamente si falla la construcción del snapshot, p. ej. el reloj) → `profile_build_failed`. Cualquier otro error se relanza sin clasificar — nunca se adivina una razón `degraded`. Los errores `Crm*` no cambian el algoritmo del caso de uso (una falla CRM sigue sin capturarse ahí, sigue siendo error de servicio); existen para que el logging (ver "Observabilidad Mínima") pueda distinguir la causa sin nunca citar el mensaje crudo del driver.

## Modelos De Lectura

[`src/domain/customer-profile/master-customer-record.ts`](../../src/domain/customer-profile/master-customer-record.ts) — `id` se mantiene como `string` de punta a punta: `master_customer.id` es `bigint(20) unsigned` (ver `docs/audits/CP-R1-T01-schema-inventory.md`), y un bigint puede superar `Number.MAX_SAFE_INTEGER`. `firstname`, `lastname`, `email`, `platformOrigin` son `string` (no `| null`): el inventario de T01 confirma que esas columnas son `NOT NULL` en el schema real; solo `rut` es nullable ahí. El pool CRM se configura con `supportBigNumbers: true, bigNumberStrings: true` para que MySQL nunca devuelva el bigint como `number` con pérdida de precisión.

[`src/domain/customer-profile/prestashop-customer-record.ts`](../../src/domain/customer-profile/prestashop-customer-record.ts) — solo los campos de `ps_customer` necesarios para el vínculo y metadata operacional; sin órdenes, direcciones ni campos derivados. `dateAdd`/`dateUpd` se mantienen `string | null`: T01 no inventarió la nulabilidad exacta de esas columnas, así que no se afirma algo no auditado.

## Adapters (Read-Only)

[`src/infrastructure/crm/mysql-master-customer-reader.ts`](../../src/infrastructure/crm/mysql-master-customer-reader.ts):

```sql
SELECT id, firstname, lastname, email, platform_origin, rut, prestashop_customer_id
FROM master_customer
WHERE id = ?
LIMIT 1
```

[`src/infrastructure/prestashop/mysql-prestashop-customer-reader.ts`](../../src/infrastructure/prestashop/mysql-prestashop-customer-reader.ts):

```sql
SELECT id_customer, firstname, lastname, email, active, id_shop, date_add, date_upd
FROM <prefix>customer
WHERE id_customer = ?
LIMIT 1
```

Ambos: consulta parametrizada, `LIMIT 1`, sin joins, sin búsqueda por email, sin escrituras. El prefijo de PrestaShop se valida contra `^[A-Za-z0-9_]+$` **dos veces**: una vez en `config.ts` (Zod) y otra vez dentro del propio adapter (`createMysqlPrestashopCustomerReader` lanza si el prefijo no calza), porque el prefijo se concatena en el nombre de tabla — SQL no permite parametrizar identificadores — y el adapter no debe confiar ciegamente en que la validación de configuración ya ocurrió.

**Si la columna `prestashop_customer_id` todavía no existe en un ambiente** (migración `001` no aplicada), esto ya no se descubre recién en el primer request real: `GET /health/ready` lo detecta explícitamente (ver "Health Checks") antes de que el servicio se declare listo. El adapter de lectura (`mysql-master-customer-reader.ts`) también clasifica esa misma falla si ocurre durante un request (`ER_BAD_FIELD_ERROR` / `ER_NO_SUCH_TABLE` → `CrmSchemaIncompatibleError`), junto con timeouts (`CrmTimeoutError`) e indisponibilidad/conexión/credenciales (`CrmUnavailableError`) — mismo patrón que el adapter de PrestaShop. Ningún error de CRM se esconde ni se convierte en `not_found`; el caso de uso los sigue dejando propagar sin capturarlos. No hay chequeo de schema al boot del proceso (solo bajo demanda vía `/health/ready`) ni ejecución automática de migraciones.

Ambos adapters comparten [`src/infrastructure/shared/query-executor.ts`](../../src/infrastructure/shared/query-executor.ts), un `QueryExecutor` delgado sobre `mysql2/promise` — así ni el dominio ni la aplicación importan `mysql2` directamente, y los tests de adapter inyectan un executor falso en vez de mockear el pool.

## Pools

[`src/infrastructure/crm/crm-pool.ts`](../../src/infrastructure/crm/crm-pool.ts) y [`src/infrastructure/prestashop/prestashop-pool.ts`](../../src/infrastructure/prestashop/prestashop-pool.ts): singletons perezosos (un solo pool reutilizable por proceso, no una conexión nueva por request), `mysql2/promise`, límites configurables, cierre ordenado (`closeCrmPool` / `closePrestashopPool`, invocados en shutdown desde `src/index.ts`). Sin `SET` globales. Sin migraciones en startup. Pools separados aunque compartan infraestructura física, siguiendo la separación lógica CRM/PrestaShop ya establecida en el README.

## Configuración

`.env.example` y `src/config.ts` actualizados. `CRM_DB_HOST`, `CRM_DB_USER`, `CRM_DB_PASSWORD`, `PRESTASHOP_DB_HOST`, `PRESTASHOP_DB_USER`, `PRESTASHOP_DB_PASSWORD` ya **no** tienen default silencioso a `''`: son obligatorios (`z.string().min(1)`), y la app lanza al iniciar (`Invalid environment variables: ...`) si falta alguno — falla explícita, no oculta. `CRM_DB_NAME`/`PRESTASHOP_DB_NAME` conservan su default existente (`main_management`/`pesas_productiva`, ya documentado en README) pero ahora también rechazan un valor vacío explícito. `PRESTASHOP_DB_PREFIX` conserva el default `ps_` (decisión ya existente) y se valida con el mismo patrón seguro. Se agregaron `CRM_DB_CONNECTION_LIMIT`, `CRM_DB_QUERY_TIMEOUT_MS`, `PRESTASHOP_DB_CONNECTION_LIMIT`, `PRESTASHOP_DB_QUERY_TIMEOUT_MS` (default 5 conexiones / 3000ms).

## Snapshot

`master_customer` es la autoridad canónica para nombre, email y RUT. PrestaShop aporta el vínculo y metadata operacional (activo, tienda, fechas), nunca reemplaza la identidad:

```ts
export type CustomerProfileSnapshot = {
  masterCustomerId: string;
  generatedAt: string;
  customer: { firstname: string; lastname: string; email: string; rut: string | null; platformOrigin: string };
  prestashop: { customerId: number; active: boolean; shopId: number; createdAt: string | null; updatedAt: string | null };
  warnings: readonly string[];
};
```

Explícitamente fuera de esta versión: total de órdenes, gasto acumulado, última compra, direcciones, teléfonos, productos, categorías, carritos, preferencias, scores, oportunidad activa.

## Diferencias CRM vs PrestaShop

Nunca se reconcilian automáticamente. Si difieren, se agregan warnings estructurados (sin exponer los valores) y el resultado sigue siendo `available`:

```text
prestashop_email_differs_from_master
prestashop_name_differs_from_master
prestashop_customer_inactive
```

Confirmado por test (`does not reconcile master_customer with PrestaShop data even when they differ`): el snapshot sigue devolviendo el email/nombre de `master_customer`, nunca el de PrestaShop.

La comparación normaliza con `value.trim().toLowerCase().replace(/\s+/g, ' ')` — colapsa espacios internos repetidos además de mayúsculas y espacios en los extremos, para no generar warnings falsos por formato (p. ej. `" Ana  Perez "` vs `"ana perez"` no genera `prestashop_name_differs_from_master`). No se eliminan acentos ni se hace transliteración Unicode; eso queda fuera de esta tarea.

## Clasificación Pura

[`src/domain/customer-profile/classify-lookup.ts`](../../src/domain/customer-profile/classify-lookup.ts) → `classifyCustomerProfileLookup`. Sigue sin consultar nada — solo decide la forma de la respuesta a partir de hechos ya resueltos por el caller.

`CustomerProfileLookupContext` está discriminado por `masterCustomerExists` en vez de ser un objeto plano único:

```ts
export type CustomerProfileLookupContext =
  | { masterCustomerId: string; masterCustomerExists: false; warnings: readonly string[] }
  | {
      masterCustomerId: string;
      masterCustomerExists: true;
      linkedPrestashopCustomerId: number | null;
      degradedReason: CustomerProfileDegradedReason | null;
      profile: CustomerProfileSnapshot | null;
      warnings: readonly string[];
    };
```

Esto hace que "master no existe pero prestashop status = found" sea un error de compilación, no solo un caso ignorado en runtime — es una modificación mínima (discriminar un booleano) en vez de replicar el union completo de 4 estados de PrestaShop sugerido como alternativa; se prefirió porque ya elimina la combinación imposible concreta sin aumentar tanto la superficie del tipo.

## Endpoint

`GET /v1/customers/:masterCustomerId/profile`. Solo GET — sin POST/PATCH/DELETE.

Validación de entrada (`src/http/routes/index.ts`): `masterCustomerId` debe ser una cadena de dígitos, 1–20 caracteres (`^[0-9]+$`, acorde a `bigint(20) unsigned`); cualquier otra cosa (vacío, con letras, un email) → `400 { error: 'invalid_master_customer_id' }`, sin invocar el caso de uso.

| Resultado | HTTP |
| --- | --- |
| `available` | 200 |
| `partial` | 200 |
| `not_found` | 404 |
| `degraded` / `prestashop_unavailable`, `prestashop_timeout`, `prestashop_customer_not_found` | 503 |
| `degraded` / `profile_build_failed` | 500 |
| error no clasificado (CRM u otro, capturado en la propia ruta) | 500, `{ error: 'internal_error' }`, sin stack, sin SQL, sin config, sin secretos |

Decisión explícita: `profile_build_failed` es 500 porque representa una falla interna determinística (la construcción del snapshot falló con ambas fuentes ya leídas con éxito); las otras tres razones de `degraded` son 503 porque representan una dependencia (PrestaShop) temporalmente no disponible.

## Inyección De Dependencias

[`src/bootstrap.ts`](../../src/bootstrap.ts) es la única composition root: arma los readers MySQL reales sobre los pools y construye `getCustomerProfile` con `createGetCustomerProfile`. El caso de uso nunca instancia sus propios readers. `Clock` se inyecta (`{ now: () => new Date() }` en producción; relojes fijos o que lanzan en tests) para que los timestamps del snapshot sean determinísticos en tests. No se agregó ningún framework de DI.

## Health Checks

`GET /health` (ya existente, sin cambios). `GET /health/ready`:

- **PrestaShop**: `SELECT 1` — barato, solo conectividad.
- **CRM**: [`checkCrmReadiness()`](../../src/infrastructure/crm/crm-pool.ts) verifica conectividad **y** compatibilidad mínima de schema en una sola consulta barata y read-only: `SELECT prestashop_customer_id FROM master_customer LIMIT 0`. `LIMIT 0` nunca escanea filas; si la columna no existe, MySQL responde `ER_BAD_FIELD_ERROR` (o `ER_NO_SUCH_TABLE` si toda la tabla falta) antes de tocar ninguna fila.

```text
CRM no responde                        → 503 not_ready, reason: crm_unavailable
CRM responde con timeout               → 503 not_ready, reason: crm_timeout
CRM responde pero falta la columna     → 503 not_ready, reason: crm_schema_incompatible
CRM listo, PrestaShop caído            → 200 ready_degraded
ambos listos                           → 200 ready
```

El servicio **no** anuncia `ready` para luego fallar recién en el primer request real: si `prestashop_customer_id` no existe (migración `001` no aplicada), `/health/ready` ya lo reporta como `not_ready` / `crm_schema_incompatible`. Nunca se devuelve el mensaje original del driver MySQL en la respuesta — solo una de las tres razones cerradas (`CrmReadinessReason` en `crm-pool.ts`).

Razón para el resto de la política: sin CRM no se puede ni verificar que `master_customer` existe, así que el servicio no puede cumplir su contrato en absoluto. Sin PrestaShop, `partial` y `degraded` siguen siendo respuestas válidas, así que el servicio sigue siendo útil.

## Observabilidad Mínima

Log de éxito estructurado por request en el handler del endpoint (`console.info`, el mismo mecanismo ya usado en `src/index.ts` — no se agregó una plataforma nueva):

```text
requestId, masterCustomerId, status, degradedReason, durationMs, prestashopLookupAttempted
```

Log de falla — nunca `error.message` ni `error.stack` crudos, solo una etiqueta segura de [`src/observability/classify-error-for-log.ts`](../../src/observability/classify-error-for-log.ts) (`classifyErrorForLog`, clasifica exclusivamente por `instanceof` sobre los tipos de `errors.ts`, nunca lee el mensaje):

```text
crm_unavailable | crm_timeout | crm_schema_incompatible
prestashop_unavailable | prestashop_timeout | profile_build_failed
unexpected_error
```

Sitios que loguean así: la propia ruta del perfil (`{ event: 'customer_profile_request_failed', requestId, masterCustomerId, errorType }`, con contexto porque el catch vive en el handler, no en un middleware genérico), el middleware de fallback de `app.ts` (`{ event: 'unhandled_request_error', errorType }`, sin `masterCustomerId` porque no hay contexto de ruta confiable ahí) y el cierre del servicio (`src/observability/log-shutdown-failure.ts`: `{ event: 'service_shutdown_failed', errorType }`).

Nunca se loguea `email`, `firstname`, `lastname`, `rut`, direcciones, SQL, host, puerto, usuario ni configuración — en ningún punto de falla.

## Seguridad

Endpoint interno, read-only, sin búsqueda por email, sin listados, sin endpoint de búsqueda arbitraria, sin secretos en las respuestas (confirmado por test: un mensaje de error con `secret-internal-host` nunca llega al cliente), consultas parametrizadas, prefijo SQL validado dos veces, `masterCustomerId` validado por formato, timeouts configurados por variable de entorno.

**No se implementó autenticación nueva.** No existe todavía una decisión arquitectónica de service-to-service auth en este repositorio. Este endpoint no es apto para exposición pública sin un gateway/capa de autenticación delante — queda documentado aquí y en el README, no resuelto en este task.

## Fuera De Alcance De T03

Historial de órdenes, agregados comerciales (gasto, última compra), direcciones, teléfonos, carritos, oportunidad activa, autenticación service-to-service, ejecución de la migración `001` contra un CRM real, backfill, worker autónomo.

## Plan De Pruebas

- `tests/unit/get-customer-profile.test.ts`: las 7 ramas del algoritmo, warnings de discrepancia (email/nombre/inactivo) y sus casos negativos (mismo valor con distinto whitespace/casing → sin warning), no-reconciliación, propagación de errores no clasificados (CRM y PrestaShop), "PrestaShop no se llama" verificado explícitamente para `not_found` y `partial`.
- `tests/unit/classify-customer-profile-lookup.test.ts`: las 4 formas de resultado, sin `conflicted`.
- `tests/unit/mysql-master-customer-reader.test.ts`: intención estructural del SQL (`WHERE id = ?`, `LIMIT 1`, sin `email =`, sin `INSERT/UPDATE/DELETE`), mapeo de errores CRM por código (`ER_BAD_FIELD_ERROR`/`ER_NO_SUCH_TABLE` → `CrmSchemaIncompatibleError`, `ETIMEDOUT` → `CrmTimeoutError`, `ECONNREFUSED`/`ER_ACCESS_DENIED_ERROR` → `CrmUnavailableError`, desconocido → propaga), bigint grande preservado como string sin pérdida de precisión.
- `tests/unit/mysql-prestashop-customer-reader.test.ts`: mismo patrón estructural, validación de prefijo inseguro, mapeo de errores PrestaShop por código.
- `tests/unit/query-executor.test.ts`: `createQueryExecutor` probado directamente (no a través de un adapter falso) — confirma que `{ sql, timeout }` y los parámetros llegan a `pool.execute` en el orden correcto, y que las filas se devuelven sin alterar.
- `tests/unit/crm-pool.test.ts`: `checkCrmReadiness()` con `mysql2/promise` mockeado — `ready` cuando el probe `LIMIT 0` responde, `crm_schema_incompatible` en `ER_BAD_FIELD_ERROR`/`ER_NO_SUCH_TABLE`, `crm_unavailable` en `ECONNREFUSED`, `crm_timeout` en `ETIMEDOUT`; `closeCrmPool()` sin pool inicializado no lanza y no crea un pool.
- `tests/unit/prestashop-pool.test.ts`: `closePrestashopPool()` sin pool inicializado no lanza y no crea un pool.
- `tests/unit/classify-error-for-log.test.ts`: cada tipo de error tipado mapea a su etiqueta; cualquier error no reconocido (incluyendo valores que no son `Error`) mapea a `unexpected_error`.
- `tests/unit/log-shutdown-failure.test.ts`: spy sobre `console.error`; el mensaje sensible original nunca aparece en el log, solo la clasificación segura.
- `tests/integration/customer-profile-route.test.ts`: códigos HTTP por estado, validación de `masterCustomerId`, no fuga de detalles internos en 500, spy sobre `console.error` confirmando que un mensaje sensible (host/usuario/código de driver) nunca llega al log ni a la respuesta, `/health/ready` en sus cuatro combinaciones (incluyendo `crm_schema_incompatible`). Servidor HTTP real (`node:http` + `fetch` global), sin dependencia nueva, sin base de datos real — el caso de uso y la readiness se inyectan falsos.
- `tests/unit/contracts.test.ts`: forma real del snapshot.

Ninguna prueba depende de una base de datos real ni de credenciales productivas. `mysql2/promise` se mockea con `vi.mock` únicamente en `crm-pool.test.ts` / `prestashop-pool.test.ts`, donde es el propio wrapper del driver el que se está probando.
