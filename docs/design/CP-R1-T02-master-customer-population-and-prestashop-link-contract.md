# CP-R1-T02 Master Customer Population And PrestaShop Link Contract

Fecha: 2026-07-27.

Estado: diseño. Sin escrituras productivas. Sin migración ejecutada. Sin backfill ejecutado.

## Estado Arquitectónico Definitivo

Customer Profile **no** resuelve identidad. La precondición de uso es:

```text
onboarding / Identity Resolver
→ confirma que existe master_customer
→ entrega masterCustomerId
→ recién entonces se permite consultar Customer Profile
```

Customer Profile recibe exclusivamente:

```ts
export type GetCustomerProfileInput = {
  readonly masterCustomerId: string;
};
```

No busca por email. No crea clientes. No vincula clientes. No modifica identidad.

La población histórica y la resolución por email pertenecen exclusivamente al proceso administrativo offline **T02A**. **T02B** es la lectura runtime, exclusivamente por `masterCustomerId` ya confirmado.

---

## T02A — Population And Link Contract (offline)

T02A es un proceso administrativo offline que crea o reconcilia `master_customer` y persiste `prestashop_customer_id`. La clasificación implementada en `classifyIdentityMatch` sirve exclusivamente al dry-run y al futuro job de población. **No forma parte del lookup runtime de Customer Profile ni se asume reutilizada por onboarding dentro del alcance de T02.**

### Punto De Partida (CP-R1-T01)

- `master_customer`: 1 fila, no matchea con PrestaShop.
- `ps_customer`: 71.822 filas; compradores reales (`DISTINCT ps_orders.id_customer`, excluyendo NULL/0): 44.739.
- Emails duplicados en `ps_customer`: 385 (16 dentro del mismo shop, 373 entre shops), medidos sobre los 71.822 `ps_customer`, no sobre los compradores. El job de población recalcula la agrupación por email restringida a los 44.739 compradores antes de decidir nada.

### 1. Migración

Archivo: [`migrations/001_add_master_customer_prestashop_customer_id.sql`](../../migrations/001_add_master_customer_prestashop_customer_id.sql).
Rollback: [`migrations/001_add_master_customer_prestashop_customer_id.rollback.sql`](../../migrations/001_add_master_customer_prestashop_customer_id.rollback.sql).

```sql
ALTER TABLE master_customer
  ADD COLUMN prestashop_customer_id INT UNSIGNED NULL AFTER platform_origin;

ALTER TABLE master_customer
  ADD CONSTRAINT uq_master_customer_prestashop_customer_id
  UNIQUE (prestashop_customer_id);
```

Confirmado:

- Columna nullable, sin valor centinela.
- Índice único: MySQL/InnoDB trata cada `NULL` como distinto en un `UNIQUE KEY`, no hace falta índice parcial.
- Sin FK cruzada a `ps_customer`: CRM (`main_management`) y PrestaShop (`pesas_productiva`) se mantienen como fuentes lógicas separadas aunque compartan infraestructura física. La integridad referencial la garantiza el Identity Resolver / el job de población, no la base de datos.
- Aditiva: no toca columnas existentes, no borra datos.

**El rollback es destructivo para todos los vínculos, sin condición de "seguro después de activación productiva".** `DROP COLUMN prestashop_customer_id` pierde el vínculo de cada `master_customer` ya enlazado. Una vez que Customer Profile dependa productivamente de esta columna, ejecutar el rollback deja a ese servicio sin capacidad de responder `available` para ningún cliente. No se afirma que sea seguro en ningún momento posterior a la activación productiva; si de todas formas debe ejecutarse, primero hay que exportar y respaldar el mapping completo fuera de la base, y aun así implica una discontinuidad para cualquier consumidor que dependa del vínculo.

### 2. Población Histórica

Fuente: compradores PrestaShop (`ps_orders.id_customer` distinto, no NULL/0, join a `ps_customer`), no la tabla `ps_customer` completa. Universo: 44.739, no 71.822.

Regla de agrupación: `LOWER(TRIM(ps_customer.email))` por comprador.

| Caso | Acción v1 |
| --- | --- |
| Exactamente 1 `ps_customer` con ese email, y no existe ya un `master_customer` con ese email | Crear `master_customer` nuevo con `prestashop_customer_id` ya seteado. Estado: `resolved` (el vínculo se crea explícito en el momento de la población). |
| Exactamente 1 `ps_customer` con ese email, y ya existe un `master_customer` con ese email sin `prestashop_customer_id` | Reconciliar: `UPDATE` solo de `prestashop_customer_id` sobre la fila existente. |
| Exactamente 1 `ps_customer` con ese email, pero el `master_customer` existente ya tiene un `prestashop_customer_id` distinto | Conflicto de datos. Se reporta y se excluye; no se sobreescribe automáticamente. |
| Más de 1 `ps_customer` con el mismo email normalizado (duplicado intra-shop o multishop) | **No se crea/vincula automáticamente en v1.** Se exporta al reporte de conflictos (`conflicted`, `multiple_exact_email_matches`). Este conflicto vive solo en el reporte offline; nunca se persiste en `master_customer.prestashop_customer_id`, que solo puede ser un id o `NULL` (ver T02B, sección de estados). |
| Email nulo/vacío tras normalizar | `unlinked`, `missing_or_unusable_email`. No se crea `master_customer` sin email utilizable (`master_customer.email` es `NOT NULL UNIQUE`). |

Mapeo de columnas al crear un `master_customer` nuevo desde `ps_customer`:

- `firstname`, `lastname`, `email` ← columnas homónimas de `ps_customer`.
- `platform_origin` ← `'prestashop'` (reutiliza la columna existente, sin agregar columnas nuevas).
- `rut` ← pendiente de confirmar; T01 no inventarió una columna equivalente en `ps_customer`. Queda `NULL` hasta confirmar la fuente real.

### 3. Idempotencia

Claves naturales: `master_customer.email` (única, ya existe) y `master_customer.prestashop_customer_id` (única, este documento).

1. Antes de insertar, buscar `master_customer` por email normalizado.
2. Antes de vincular, buscar `master_customer` por `prestashop_customer_id`.
3. Si ambas búsquedas coinciden en la misma fila → no-op.
4. Si coinciden en filas distintas, o una ya tiene un `prestashop_customer_id` diferente → conflicto, se reporta, no se escribe.
5. Ninguna escritura es un `DELETE`; el job solo crea filas nuevas o completa `prestashop_customer_id` en `NULL`.

### 4. Dry-Run

Modo por defecto y único modo cubierto por este diseño: solo `SELECT`, mismo patrón de guardrails que CP-R1-T01 (`connectionLimit=1`, timeout de query, sin PII completa en logs).

```ts
type PopulationDryRunReport = {
  runId: string;
  generatedAt: string;
  buyerPopulationCount: number;
  wouldCreateResolved: number;
  wouldReconcileExisting: number;
  wouldSkipConflict: number;
  wouldSkipUnusableEmail: number;
  sampleConflicts: ReadonlyArray<{
    normalizedEmail: string;
    prestashopCustomerIds: readonly number[];
  }>;
};
```

Ejecutar escrituras reales (`--apply`) queda **fuera de alcance de T02**.

### 5. Reanudación Por Lotes — Deduplicación Global Antes De Lotear

La unicidad/duplicidad de un email no puede decidirse mirando solo el lote actual: un email con sus dos `ps_customer` repartidos en lotes distintos se vería, lote a lote, como "1 match" en cada uno — falso `resolved` doble. Diseño de 3 fases:

```text
fase 1 — conteo global
  SELECT LOWER(TRIM(email)) AS normalized_email, COUNT(*), GROUP_CONCAT(id_customer)
  FROM ps_customer
  WHERE id_customer IN (compradores: DISTINCT ps_orders.id_customer)
  GROUP BY normalized_email
  → mapa completo normalized_email -> lista de prestashop_customer_id
    (44.739 compradores caben en memoria; no requiere tabla temporal)

fase 2 — recorrido por lotes
  WHERE id_customer > :cursor ORDER BY id_customer LIMIT :batchSize
  (keyset pagination, no OFFSET — no escala y se corrompe con writes concurrentes)

fase 3 — clasificación
  por cada comprador del lote, usar el conteo del mapa global (fase 1) para decidir
  resolved / provisional / conflicted, nunca el conteo local del lote
```

Cursor de keyset: `ps_customer.id_customer`.

#### Checkpoint (reforzado)

[`src/domain/master-customer-population/contracts.ts`](../../src/domain/master-customer-population/contracts.ts) → `PopulationCheckpoint`:

```ts
export type PopulationCheckpoint = {
  readonly runId: string;
  readonly environment: string;
  readonly sourceDatabase: string;
  readonly startedAt: string;
  readonly sourceSnapshotAt: string;
  readonly candidateMapHash: string;
  readonly lastProcessedPrestashopCustomerId: number;
  readonly updatedAt: string;
};
```

- `environment`: evita reanudar una corrida de staging en producción (o viceversa).
- `sourceDatabase`: identifica la base origen.
- `sourceSnapshotAt`: momento en que se construyó el mapa global de candidatos (fase 1).
- `candidateMapHash`: identifica ese mapa global; si los datos origen cambiaron, el hash cambia.

**Regla obligatoria de reanudación**: si `environment`, `sourceDatabase` o `candidateMapHash` del checkpoint guardado no coinciden exactamente con los de la corrida actual, el job **no reanuda**: aborta con un error explícito. Reanudar sobre un mapa global desactualizado o en el ambiente equivocado puede escribir vínculos incorrectos.

Persistencia: archivo JSON local por corrida, no una tabla nueva en el CRM. No se implementa el job todavía; este documento define el shape y la regla, la ejecución es tarea posterior.

### 6. Contrato De Clasificación (Offline)

Implementación: [`src/domain/master-customer-population/classify-match.ts`](../../src/domain/master-customer-population/classify-match.ts) → `classifyIdentityMatch`. Vive en `master-customer-population`, no en `identity-resolution`, y no se re-exporta desde ahí — la ubicación del archivo no debe sugerir que es parte del lookup runtime de Customer Profile ni asumirse reutilizada por onboarding dentro de T02.

Usos:

- dry-run de población;
- reconciliación histórica;
- análisis de candidatos.

**No se invoca desde `GET /v1/customers/{masterCustomerId}/profile`.**

El campo único y ambiguo `prestashopCustomerId` está separado en dos:

```ts
export type IdentityMatchResult = {
  readonly status: IdentityResolutionStatus;
  readonly reason: IdentityResolutionReason;
  readonly resolvedPrestashopCustomerId: number | null; // confirmado, listo para persistir
  readonly candidatePrestashopCustomerId: number | null; // sugerencia, no persistida sola
};
```

### 7. Plan De Rollback Lógico

**Nunca `DELETE` automático de `master_customer`.** T01 encontró dependientes reales por columna (`crm_opportunities.customer_master_id`, `n8n_conversation_messages.customer_master_id`), sin FK declarada — un `DELETE` automático puede dejar huérfanas oportunidades o conversaciones sin que la base lo impida.

- **Filas reconciliadas** (ya existían, se les completó `prestashop_customer_id`): revertir a `NULL` usando el reporte de esa corrida (`runId` + lista de ids) como evidencia.
- **Filas creadas por el job**: no se borran automáticamente. Se marcan como *candidatas a rollback* en el reporte de la corrida.
- Antes de cualquier desactivación de una fila candidata: revisar `crm_opportunities` y `n8n_conversation_messages` por `customer_master_id`. Si hay referencias, no desactivar/borrar; requiere decisión manual.
- **Rollback de migración** (`DROP COLUMN prestashop_customer_id`): ver advertencia de la sección 1 — destructivo para todos los vínculos, sin garantía de seguridad post-activación.

---

## T02B — Customer Profile Lookup Contract (runtime)

### Responsabilidades

Customer Profile: recibe `masterCustomerId`, verifica que `master_customer` existe, lee `prestashop_customer_id`, construye el perfil comercial, devuelve perfil parcial si no hay vínculo. No busca candidatos por email, no crea clientes, no vincula clientes, no modifica identidad.

### 1. Contrato De Entrada

[`src/domain/customer-profile/contracts.ts`](../../src/domain/customer-profile/contracts.ts) → `GetCustomerProfileInput`:

```ts
export type GetCustomerProfileInput = {
  readonly masterCustomerId: string;
};
```

Sin `normalizedEmail`, `emailCandidates` ni `hasUsableEmail`. `IdentityResolutionInput` (email-based) pertenece al onboarding/Identity Resolver, no al lookup runtime de Customer Profile.

### 2. Contrato De Salida

Misma ruta → `CustomerProfileLinkStatus`, `CustomerProfileDegradedReason` y `CustomerProfileLookupResult`:

```ts
export type CustomerProfileLinkStatus = 'linked' | 'not_linked';

export type CustomerProfileDegradedReason =
  | 'prestashop_unavailable'
  | 'prestashop_timeout'
  | 'prestashop_customer_not_found'
  | 'profile_build_failed';

export type CustomerProfileLookupResult =
  | { status: 'available'; masterCustomerId: string; linkStatus: 'linked';
      prestashopCustomerId: number; profile: CustomerProfileSnapshot; warnings: readonly string[] }
  | { status: 'partial'; masterCustomerId: string; linkStatus: 'not_linked';
      prestashopCustomerId: null; profile: null; warnings: readonly string[] }
  | { status: 'degraded'; reason: CustomerProfileDegradedReason; masterCustomerId: string;
      linkStatus: 'linked'; prestashopCustomerId: number; profile: null; warnings: readonly string[] }
  | { status: 'not_found'; masterCustomerId: string; profile: null; warnings: readonly string[] };
```

**Sin `conflicted` en runtime.** Con el modelo persistido actual, `master_customer.prestashop_customer_id` solo puede ser un `number` o `NULL` — Customer Profile solo puede observar `linked` / `not_linked`. Los conflictos por email se detectan en T02A y no se persisten en `master_customer`; viven exclusivamente en `src/domain/master-customer-population/`.

`degraded.reason` es obligatorio, no se infiere desde `warnings`:

```text
prestashop_unavailable        → la fuente no responde o está caída
prestashop_timeout            → la fuente excede el timeout permitido
prestashop_customer_not_found → master_customer tiene prestashop_customer_id,
                                 pero ese id no existe en PrestaShop
profile_build_failed          → las fuentes respondieron, pero falló la construcción del snapshot
```

`CustomerProfileSnapshot` ya no incluye `identityStatus`. Customer Profile no resuelve identidad, así que no debe reportar un estado de resolución de identidad; ese dato pertenece a onboarding/Identity Resolver, no a este contrato:

```ts
export type CustomerProfileSnapshot = {
  readonly masterCustomerId: string;
  readonly generatedAt: string;
  readonly warnings: readonly string[];
};
```

El dominio `customer-profile` ya no importa `IdentityResolutionStatus`.

### 3. Comportamiento Del Futuro Endpoint

`GET /v1/customers/{masterCustomerId}/profile`

| Caso | HTTP | `status` | `reason` |
| --- | --- | --- | --- |
| master existe + link válido + PrestaShop responde | 200 | `available` | — |
| master existe + sin link | 200 | `partial` | — (`linkStatus: not_linked`) |
| master no existe | 404 | `not_found` | — |
| master existe + link + PrestaShop no disponible | 503 | `degraded` | `prestashop_unavailable` |
| master existe + link + timeout | 503 | `degraded` | `prestashop_timeout` |
| master existe + link apunta a `ps_customer` inexistente | 503 | `degraded` | `prestashop_customer_not_found` |
| master existe + fuentes responden pero falla el build | 500 o 503 (política final pendiente) | `degraded` | `profile_build_failed` |

Ninguna degradación se convierte en `not_found`. No se busca por email en ningún caso.

### 4. Clasificación Runtime (Pura, Testeable)

[`src/domain/customer-profile/classify-lookup.ts`](../../src/domain/customer-profile/classify-lookup.ts) → `classifyCustomerProfileLookup`. Recibe los hechos ya resueltos por el caller (existe el master, cuál es el link, la razón de degradación si aplica, el snapshot ya construido) y solo decide la forma de la respuesta — no consulta nada, no busca por email. No hay todavía implementación de las consultas reales (T03).

### 5. Estados — Vocabulario Separado Por Dominio

```text
Identity Resolver / master_customer (onboarding, T02A):
  resolved     → master_customer confirmado
  provisional  → master_customer existe, requiere completar o confirmar vínculo
  conflicted   → conflicto de identidad o de vínculo (nivel identidad, solo offline)
  unlinked     → no se pudo resolver ningún master_customer

Customer Profile / vínculo PrestaShop (runtime, T02B):
  linked       → master_customer con prestashop_customer_id
  not_linked   → master_customer sin prestashop_customer_id
```

`unlinked` (Identity Resolver) y `not_linked` (Customer Profile) no son el mismo concepto: el primero dice que no hay `master_customer`; el segundo asume que sí lo hay y solo falta el vínculo PrestaShop. `conflicted` es exclusivo del dominio de identidad offline y no existe en el contrato runtime de Customer Profile.

### 6. Tests

[`tests/unit/classify-customer-profile-lookup.test.ts`](../../tests/unit/classify-customer-profile-lookup.test.ts):

- master no existe → `not_found`.
- master existe sin link → `partial` / `not_linked`.
- master existe con link y snapshot → `available` / `linked`.
- master existe con link y PrestaShop caído → `degraded` / `prestashop_unavailable`.
- master existe con link y timeout → `degraded` / `prestashop_timeout`.
- master existe con link pero `ps_customer` no existe → `degraded` / `prestashop_customer_not_found`.
- fuentes responden pero falla el build → `degraded` / `profile_build_failed`.

Ningún test runtime para `conflicted`: no es un estado alcanzable desde este contrato. No se implementan consultas reales a CRM/PrestaShop; los hechos de entrada son construidos a mano en el test.

---

## Fuera De Alcance De T02 (A Y B)

- Ejecutar la migración contra el CRM real.
- Ejecutar el backfill (`--apply`).
- Implementar el job de población completo (el checkpoint solo define shape + regla de reanudación).
- Implementar las consultas reales del lookup runtime (adapters CRM/PrestaShop).
- Clasificación comercial de estados de orden PrestaShop.
- Tabla genérica `customer_source_link`.
- Worker autónomo.
