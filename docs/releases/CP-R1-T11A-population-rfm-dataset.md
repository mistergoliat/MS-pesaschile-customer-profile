# CP-R1-T11A Population RFM Dataset

Fecha: 2026-08-03.

> **Superado parcialmente por [CP-R1-T11A4](CP-R1-T11A4-approved-monetary-policy.md)
> (2026-08-05).** El universo y la formula de Monetary descritos en las
> secciones "Universo" y "Monetary Gross y Refunds" de este documento ya no
> son el comportamiento vigente: T11A4 agrego el filtro
> `total_paid_tax_incl > 0`, la exclusion explicita de 4 cuentas
> operacionales y el neteo de lineas seller-service. El resto de este
> documento (ventana, identidad provisional, scoring, snapshot, guardrails)
> sigue vigente sin cambios.

## Resumen

CP-R1-T11A introduce un dataset RFM poblacional offline, deterministico,
versionado y persistible como snapshot. No agrega endpoints, clustering,
segmentos comerciales, scheduler, integracion CRM, integracion Catalog Service
ni calculo RFM por request.

El entrypoint es:

```bash
npm run snapshot:rfm
```

Variables obligatorias:

```text
RFM_REFERENCE_TIME=2026-08-03T00:00:00.000Z
RFM_CALCULATION_VERSION=rfm-population-v1
```

Dry-run:

```text
RFM_DRY_RUN=true
```

En dry-run el comando extrae, calcula, valida y escribe un output bajo
`scripts/snapshots/rfm/outputs/`; no persiste snapshot.

Para persistir (`RFM_DRY_RUN=false`) se requiere una base service-owned
explicita:

```text
RFM_SNAPSHOT_DB_HOST
RFM_SNAPSHOT_DB_PORT
RFM_SNAPSHOT_DB_USER
RFM_SNAPSHOT_DB_PASSWORD
RFM_SNAPSHOT_DB_NAME
RFM_SNAPSHOT_DB_CONNECTION_LIMIT
```

No se reutiliza `CRM_DB_*` para escribir snapshots.

## Identidad Provisional

T11A usa identidad provisional PrestaShop:

```text
identityAuthority = prestashop_customer
identityAuthorityVersion = prestashop-customer-v1
identityKey = ps_customer.id_customer
identityResolutionStatus = provisional
```

Cada row conserva:

```text
prestashopCustomerId = ps_customer.id_customer
masterCustomerId = null
identityResolutionStatus = provisional
```

`ps_customer.id_customer` no se presenta como identidad empresarial definitiva.
`master_customer` sera la autoridad final en una fase posterior. T11A no
requiere `master_customer.prestashop_customer_id`, no modifica
`master_customer` y no hace matching por email.

## Ventana

La ventana es exactamente:

```text
windowStartInclusive = referenceTime - 365 dias
windowEndExclusive = referenceTime
intervalo = [windowStartInclusive, windowEndExclusive)
```

`referenceTime` es obligatorio, explicito y UTC ISO. El dataset no usa
`NOW()`, `CURRENT_DATE()` ni `new Date()` como autoridad temporal. `generatedAt`
si usa la hora real de ejecucion.

## Universo

Incluye clientes con al menos una orden PrestaShop:

```sql
valid = 1
id_customer > 0
date_add >= windowStartInclusive
date_add < windowEndExclusive
```

La extraccion valida que el `id_customer` exista en `ps_customer`. Cuentas sin
compras dentro de la ventana no entran al scoring, aunque el manifest conserva
conteos historicos antes de `referenceTime`.

## R/F/M

Recency:

```text
dias calendario entre referenceTime y la ultima orden valida del cliente
```

Frequency:

```sql
COUNT(DISTINCT id_order)
```

Monetary:

```sql
SUM(total_paid_tax_incl)
```

La metrica se llama `grossOrderValueTaxIncl`. No es net revenue.

## Monetary Gross y Refunds

Politicas:

```text
monetaryPolicyVersion = gross-order-value-tax-incl-v1
refundPolicyVersion = gross-valid-orders-v1
refundAdjustmentApplied = false
```

T11A v1 no resta refunds parciales line-level. El manifest solo diagnostica:

- lineas con `product_quantity_refunded > 0`.
- ordenes afectadas.
- `SUM(total_refunded_tax_incl)`.

## Moneda

La moneda se resuelve desde `ps_currency`.

Politica:

```text
currencyPolicyVersion = single-source-currency-v1
```

El snapshot aborta si:

- hay mas de una moneda en el dataset.
- falta `iso_code`.
- aparece mas de una `conversion_rate`.

Aunque la auditoria encontro solo CLP, el codigo no hardcodea esa moneda.

## Multishop

Politica:

```text
populationScope = all_valid_prestashop_shops
```

T11A v1 no excluye shops automaticamente y no genera scores separados por shop.
El manifest registra customers, orders y monetary por shop, cross-shop
customers y `distinctShopCount` por cliente.

## Scoring

El calculo separa metricas y scores.

R:

- tie-safe percent rank.
- menor recency es mejor.
- scores 1-5.
- valores iguales reciben el mismo score.

M:

- tie-safe percent rank.
- mayor monetary es mejor.
- scores 1-5.
- valores iguales reciben el mismo score.

F:

- no usa `NTILE(5)`.
- no usa quintiles.
- usa thresholds versionados configurables.

Thresholds v1:

```text
F1 = 1
F2 = 2
F3 = 3
F4 = 4-5
F5 = 6+
```

Version:

```text
frequencyScoringPolicyVersion = frequency-thresholds-candidate-v1
```

`rfmCode` se genera como codigo tecnico, por ejemplo:

```text
R5F2M4
```

No se traduce a etiquetas comerciales.

## Snapshot

Migraciones:

- `migrations/002_create_customer_rfm_snapshot_tables.sql`
- `migrations/002_create_customer_rfm_snapshot_tables.rollback.sql`

Tablas:

- `customer_rfm_snapshot`
- `customer_rfm_snapshot_row`

`customer_rfm_snapshot` incluye `snapshot_key`, `status`,
`reference_time`, `window_start`, `window_end`, versiones de politicas,
`currency_code`, `population_size`, `valid_order_count`,
`gross_order_value_tax_incl`, `manifest_json`, `dataset_checksum`,
`generated_at` y `published_at`.

`customer_rfm_snapshot_row` incluye `prestashop_customer_id`,
`master_customer_id nullable`, `identity_resolution_status`, fechas de primera
y ultima compra valida dentro de la ventana, R/F/M metrics, scores, `rfm_code`
y `created_at`.

Constraints principales:

- `UNIQUE(snapshot_id, prestashop_customer_id)`.
- indices por status/reference, version/reference, scores y `rfm_code`.
- sin FK a `master_customer`.

## Publicacion

Estados soportados:

```text
building
validated
published
failed
superseded
```

El repositorio MySQL publica en una transaccion:

```text
building -> insert rows -> row-count verification -> persisted-row checksum verification -> validated -> published -> commit
```

Si falla la persistencia de rows, hace rollback. No debe quedar publicado un
snapshot parcialmente persistido.

## Manifest

El manifest no incluye PII. Contiene:

- `snapshotId`
- `referenceTime`
- `windowStartInclusive`
- `windowEndExclusive`
- `generatedAt`
- identidad y scope
- conteos historicos, activos, scored y excluidos
- valid orders y gross monetary
- moneda, refunds, shops e invalid/future/zero diagnostics
- distribuciones R/F/M
- distribuciones de scores
- distribucion de `rfmCode`
- score cutoffs
- frequency thresholds
- `sourceChecksum`
- `datasetChecksum`

## Guardrails

El snapshot aborta si:

- falta tabla o columna fuente obligatoria.
- `referenceTime` no es UTC ISO explicito.
- hay mas de una moneda.
- falta codigo ISO.
- hay conversion rates incompatibles.
- hay ordenes validas con customer id no utilizable.
- hay ordenes validas con `id_customer` sin fila `ps_customer`.
- hay clientes duplicados en el dataset.
- valores iguales reciben scores distintos.
- hay scores fuera de 1-5.
- existe un snapshot `published` para la misma combinacion
  `referenceTime + calculationVersion`.
- conteo/checksum persistido no coincide.
- el manifest contiene campos PII.

## Limitaciones

- Identidad provisional: no es aun `masterCustomerId`.
- Monetary es bruto tax-incl y no netea refunds parciales.
- Los thresholds F son candidatos versionados, no una segmentacion comercial.
- Multishop se agrupa como `all_valid_prestashop_shops`.
- No hay scheduler ni endpoint de lectura de snapshot.
- La persistencia usa tablas service-owned sin FK a `master_customer`; una fase
  futura debe migrar rows a identidad canonica cuando `master_customer` este
  poblado.

## Migracion Futura a masterCustomerId

Cuando `master_customer.prestashop_customer_id` exista y este poblado:

1. Medir cobertura canonica.
2. Resolver duplicados, orfanos y merges.
3. Cambiar `identityAuthority` a `master_customer`.
4. Poblar `master_customer_id` y conservar `prestashop_customer_id` solo como
   referencia interna.
5. Recalcular distribuciones y thresholds bajo identidad canonica.
