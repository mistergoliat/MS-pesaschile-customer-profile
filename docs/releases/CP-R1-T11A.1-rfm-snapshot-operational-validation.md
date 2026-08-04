# CP-R1-T11A.1 RFM Snapshot Operational Validation

Fecha: 2026-08-03.

Veredicto: **BLOCKED_BY_PERSISTENCE**.

## Objetivo

Validar operacionalmente el snapshot RFM T11A: migracion, publicacion
transaccional, rollback, concurrencia, checksums, timezone, moneda,
distribuciones, outliers, performance y manifest sin PII.

Esta tarea no agrega clustering, segmentos comerciales, endpoints, scheduler,
CRM integration, Catalog integration, matching, backfill de `master_customer`,
neteo de refunds ni cambios de identidad.

## Ambiente De Validacion

PrestaShop se uso read-only para dos dry-runs y diagnosticos agregados.

La base service-owned de snapshots no estuvo configurada en este entorno:

```text
RFM_SNAPSHOT_DB_* = missing
```

Por esa razon no se ejecuto publicacion real, migracion forward/rollback,
concurrencia real ni validacion de estados persistidos. No se escribio en
PrestaShop, CRM ni `master_customer`.

Preflight PrestaShop:

- grants inspeccionados sin imprimir usuario ni grants crudos.
- privilegios de escritura detectados: ninguno.
- `@@global.time_zone`: `UTC`.
- `@@session.time_zone`: `UTC`.
- `NOW()` y `UTC_TIMESTAMP()` coincidieron en la consulta ejecutada.

## Migraciones

Migracion T11A:

- `migrations/002_create_customer_rfm_snapshot_tables.sql`
- `migrations/002_create_customer_rfm_snapshot_tables.rollback.sql`

Cambios T11A.1:

- `snapshot_key VARCHAR(512)` para soportar reference/calculation/policy
  versions.
- `UNIQUE(snapshot_key)` mantiene proteccion real contra duplicados.
- indice `idx_customer_rfm_snapshot_publication_stream` para supersede por
  stream.
- `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  declarado explicitamente en ambas tablas.
- FK `customer_rfm_snapshot_row.snapshot_id -> customer_rfm_snapshot.id` con
  `ON DELETE CASCADE`, sin FK a `master_customer`.

No se pudo aplicar la migracion en una base service-owned porque
`RFM_SNAPSHOT_DB_*` no existe en el entorno.

## Esquema Real

Pendiente de validar contra la base service-owned:

- engine InnoDB.
- charset/collation.
- precision decimal real.
- indices reales.
- constraints reales.
- rollback y reapply.

El SQL de migracion declara `DECIMAL(20,6)` para monetary y no crea FK a
`master_customer`. Tambien declara explicitamente InnoDB, `utf8mb4` y
`utf8mb4_unicode_ci`; falta confirmarlo contra `information_schema` real.

## Politica Transaccional

La publicacion del repositorio MySQL queda definida como:

```text
BEGIN
insert snapshot building
insert rows
verify row count
verify stored dataset_checksum
persist manifest_json with snapshotId
mark previous published snapshots in same stream as superseded
mark new snapshot as validated
mark new snapshot as published
COMMIT
```

Ante error:

```text
ROLLBACK
```

Los hooks de fallo existen solo por dependency injection en tests, no por
variables de entorno productivas.

## Snapshot Key

`snapshot_key` ahora deriva de:

- `calculationVersion`
- `identityAuthorityVersion`
- `populationPolicyVersion`
- `monetaryPolicyVersion`
- `refundPolicyVersion`
- `scoringPolicyVersion`
- `referenceTime`

Ejemplo observado:

```text
rfm-population-v1__prestashop-customer-v1__active-365-valid-prestashop-customer-v1__gross-order-value-tax-incl-v1__gross-valid-orders-v1__r-tie-safe-percent-rank-v1__frequency-thresholds-candidate-v1__m-tie-safe-percent-rank-v1__2026-08-03T00-00-00-000Z
```

## Concurrencia

La proteccion minima real es `UNIQUE(snapshot_key)`. El repositorio transforma
`ER_DUP_ENTRY` en un error controlado: `Duplicate RFM snapshot key`.

La prueba real de dos procesos concurrentes no se ejecuto porque falta
`RFM_SNAPSHOT_DB_*`. Queda bloqueada por persistencia.

## Rollback Inducido

Tests agregados inducen fallos en:

- `after_begin`
- `after_header_insert`
- `during_row_insert`
- `after_rows_insert`
- `before_row_count`
- `after_row_count_before_checksum`
- `before_supersede_previous`
- `after_supersede_before_publish`
- `before_commit`

Todos verifican rollback y ausencia de commit en el fake transaccional.

Rollback real contra DB descartable: no ejecutado por falta de
`RFM_SNAPSHOT_DB_*`.

## Dry-run Versus Persistido

Dry-run ejecutado dos veces en esta continuacion con:

```text
RFM_REFERENCE_TIME=2026-08-03T00:00:00.000Z
RFM_CALCULATION_VERSION=rfm-population-v1
```

Resultados iguales en ambas corridas:

- active/scored customers: 14.174.
- valid orders: 19.595.
- grossOrderValueTaxIncl: `3057873347.170000`.
- currency: `CLP`.
- sourceChecksum:
  `16cf084703bbc657b4d2a1e64f115819f91dd5d3ad3b0d446bcf271be695ca29`.
- datasetChecksum:
  `0964b66b3a02bfa1f81cd613f5e9f5ccfc8ca9bb7caedaa60d23edf861ed3532`.

Nota de source drift: una evidencia anterior del mismo documento registraba el
mismo conteo de clientes y ordenes, pero monetary/checksums distintos
(`3057857133.170000`, `fe88a4...`, `85d801...`). T11A.1A corrigio ademas
`firstValidOrderAt` para representar la primera compra dentro de la ventana,
por lo que los checksums cambiaron sin cambiar conteos ni monetary. Las dos
corridas actuales son deterministicas entre si, pero la diferencia historica
debe explicarse antes de cerrar validacion operacional completa.

Comparacion dry-run versus persistido: no ejecutada por falta de DB snapshot.

## Checksums

`checksumVersion = rfm-checksum-canonical-json-v1`.

`sourceChecksum` incluye:

- `referenceTime`
- `windowStartInclusive`
- `windowEndExclusive`
- source rows normalizadas y ordenadas por `prestashopCustomerId ASC`

`datasetChecksum` incluye:

- `calculationVersion`
- identity/policy/checksum versions
- `populationScope`
- rows RFM scoreadas normalizadas

En persistencia, la verificacion recalcula el checksum leyendo
`customer_rfm_snapshot_row` dentro de la misma transaccion, ordenando por
`prestashop_customer_id ASC`, y comparando contra el checksum calculado en
memoria antes de publicar. No basta con leer el valor del header recien
insertado.

No incluye:

- `generatedAt`
- snapshot auto-increment id
- orden accidental de SQL
- whitespace
- orden de propiedades

Dos dry-runs con distinto `generatedAt` produjeron el mismo source y dataset
checksum.

## Timezone

Estado: **UNVERIFIED**.

Evidencia ejecutada:

- MySQL global/session timezone reporto `UTC`.
- La conexion mysql2 usa `timezone: 'Z'` y `dateStrings: true`.
- `RFM_REFERENCE_TIME` exige UTC ISO.

Esto no prueba por si solo la semantica historica de `ps_orders.date_add` en
PrestaShop. Por lo tanto T11A.1 no cierra timezone comercial.

Politica implementada actual:

```text
sourceDateTimeStorage = mysql_datetime
sourceTimezone = UNVERIFIED
calculationTimezone = UTC
referenceTimeTimezone = UTC
recencyCalendarPolicy = utc-calendar-days-v1
timezoneStatus = UNVERIFIED
```

## Moneda

Politica implementada real:

```text
singleCurrencyUniformConversionRateV1
```

El codigo aborta si:

- `distinctCurrencyCount != 1`
- falta ISO code
- `distinctConversionRateCount != 1`

Diagnostico live de la ventana:

- distinct currency ids: 1.
- distinct ISO codes: 1.
- distinct conversion rates: 1.
- min/max conversion rate: `1.000000`.
- currencyCode: `CLP`.

No se implemento conversion multimoneda.

## Distribucion R/F/M

Distribuciones dry-run:

- Recency count 14.174, min 1, max 365, p95 346, p99 362.
- Frequency count 14.174, min 1, max 2.033, p95 2, p99 4.
- Monetary count 14.174, min `0.000000`, max `94211374.770000`, p95
  `746839.000000`, p99 `2358439.000000`.

Score distributions:

| Score | R customers | F customers | M customers |
|---:|---:|---:|---:|
| 1 | 2.732 | 11.973 | 4.300 |
| 2 | 3.386 | 1.565 | 2.953 |
| 3 | 2.514 | 389 | 2.541 |
| 4 | 2.558 | 186 | 2.447 |
| 5 | 2.984 | 61 | 1.933 |

## Distribucion F1-F5

Thresholds versionados sin cambios:

| F | Threshold | Customers | Orders | Monetary |
|---:|---|---:|---:|---:|
| 1 | 1 | 11.973 | 11.973 | 1.565.039.504,80 |
| 2 | 2 | 1.565 | 3.130 | 610.897.481,90 |
| 3 | 3 | 389 | 1.167 | 362.081.212,30 |
| 4 | 4-5 | 186 | 801 | 219.071.417,00 |
| 5 | 6+ | 61 | 2.524 | 300.783.731,17 |

Todos los buckets estan poblados. F5 contiene 0,43% de clientes y 12,88% de
ordenes.

## Outliers

`operationalAccountPolicy = none`.

Diagnostico agregado:

- maximumFrequencyOrders: 2.033.
- customersAbove100Orders: 1.
- customersAbove500Orders: 1.
- top1CustomerFrequencyShare: 10,3751%.
- top5CustomerFrequencyShare: 10,8956%.
- top10CustomerFrequencyShare: 11,1559%.
- score distribution excluding >100 orders: F5 baja de 61 a 60.
- score distribution excluding >500 orders: F5 baja de 61 a 60.

La identidad extrema permanece en el dataset. No se etiqueta como fraude, B2B
ni operacional.

## Performance

Medicion dry-run:

- schema preflight: 1.343 ms.
- population extraction: 1.264 ms.
- diagnostics: 3.970 ms.
- total dry-run: 6.125 ms.
- second dry-run: 3.830 ms.
- peak rows in memory: 14.174.

`EXPLAIN FORMAT=JSON` de la extraccion principal:

- `ps_orders` access type: `ALL`.
- estimated rows: 70.862.
- condition: `valid = 1`, `id_customer > 0`, window by `date_add`.
- filesort by `id_customer`.
- `ps_customer` join: `eq_ref` by primary key.

No se crearon indices en PrestaShop.

## PII Validation

El manifest rechaza claves y valores PII-shaped en root, objetos anidados y
arrays. Tests cubren:

- email.
- phone/telefono.
- RUT/DNI/document.
- firstName/last_name.
- address/street.
- payment/card.
- customerPayload/orderPayload.
- valores email-like y phone-like.

Rows snapshot contienen solo IDs tecnicos, metricas, scores, timestamps y
estado de identidad provisional.

## Pruebas

Tests focalizados T11A/T11A.1:

```text
7 files passed
40 tests passed
```

Cubren dataset, checksum deterministico, PII guard, migraciones por inspeccion
SQL, CLI real-mode env, reader, repository transaccional, rollback hooks,
checksum recalculado desde rows persistidas y duplicate key.

## Baseline Failure

La falla conocida sigue aislada:

```text
tests/unit/audit-rfm-population-t10a3-corrections.test.ts
PRE_EXISTING_BASELINE_FAILURE
```

No se modifico ese test.

## Riesgos

- No hay DB service-owned configurada para validar migracion/publicacion real.
- Hay source drift no explicado contra la evidencia dry-run anterior del mismo
  `referenceTime`; requiere investigacion antes de cerrar T11A.1.
- Timezone de negocio de `ps_orders.date_add` sigue `UNVERIFIED`.
- PrestaShop extraction hace full scan/filesort en la medicion; documentar
  recomendacion de indice separada si crece volumen.
- Identidad sigue provisional.
- Monetary sigue gross tax-incl sin neteo refunds.
- Thresholds F siguen candidate v1.
- No hay endpoint ni scheduler.

## Veredicto

**BLOCKED_BY_PERSISTENCE**.

La implementacion quedo mas robusta para atomicidad, checksum, rollback,
snapshot key, stream supersede, outlier diagnostics y PII guard. Pero T11A.1 no
puede cerrarse como `OPERATIONALLY_VALIDATED` sin una base
`RFM_SNAPSHOT_DB_*` real donde aplicar migracion, publicar, probar rollback real
y concurrencia real. Timezone tambien queda `UNVERIFIED` hasta confirmar la
semantica operacional de `ps_orders.date_add`.
