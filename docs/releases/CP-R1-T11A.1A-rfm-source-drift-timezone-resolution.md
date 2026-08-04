# CP-R1-T11A.1A RFM Source Drift and Timezone Resolution

Fecha: 2026-08-04.

Veredicto: **SOURCE_DRIFT_BASELINE_NOT_COMPARABLE**.

`timezoneStatus = UNVERIFIED`.

## Objetivo

Resolver el drift observado entre la evidencia agregada T11A0 y los dry-runs
actuales T11A/T11A.1 para `RFM_REFERENCE_TIME=2026-08-03T00:00:00.000Z`, sin
usar `RFM_SNAPSHOT_DB_*` y sin escribir en PrestaShop, CRM ni
`master_customer`.

## Evidencia Anterior Y Actual

Evidencia agregada T11A0:

| Fuente | Clientes | Ordenes | Monetary |
|---|---:|---:|---:|
| T11A0 doc | 14.188 | 19.616 | 3.062.422.680,17 |

Dry-runs actuales, despues de corregir `firstValidOrderAt` a valor en ventana:

| Fuente | Clientes | Ordenes | Monetary |
|---|---:|---:|---:|
| T11A.1A dry-run 1 | 14.174 | 19.595 | 3.057.873.347,17 |
| T11A.1A dry-run 2 | 14.174 | 19.595 | 3.057.873.347,17 |

Checksums actuales:

```text
sourceChecksum = 16cf084703bbc657b4d2a1e64f115819f91dd5d3ad3b0d446bcf271be695ca29
datasetChecksum = 0964b66b3a02bfa1f81cd613f5e9f5ccfc8ca9bb7caedaa60d23edf861ed3532
```

## Auditoria Diferencial Del Codigo

| Area | Previous behavior | Current behavior | Changed | Drift impact | Evidence |
|---|---|---|---:|---|---|
| Window end | T11A0 usa `DATE_ADD(as_of_date, INTERVAL 1 DAY)` | T11A usa `referenceTime` como end exclusivo | Si | Alto | T11A0 SQL y `buildRfmSnapshotWindow` |
| Window start | `2025-08-03 00:00:00` | `2025-08-03 00:00:00` | No | Bajo | Ambos con reference UTC midnight |
| End comparator | `< end` | `< end` | No | Bajo | No hay orden en el limite exacto |
| Customer id | `IS NOT NULL AND <> 0` | `> 0` | No material | Bajo | Equivalente para ids positivos |
| `ps_customer` join | No en agregados T11A0 | `INNER JOIN ps_customer` y abort si missing | Si | Potencial | No hay evidencia de impacto en conteo actual |
| Shops | T11A0 all shops | T11A all shops | No para baseline T11A0 | Bajo | T10A P1 no es baseline comparable |
| Zero amount | Incluye | Incluye | No | Bajo | `zeroAmountOrderCount=4` |
| First valid order | T11A actual previo tomaba primera valida antes del end | T11A.1A corrige a primera valida en ventana | Si | Checksum/row artifact | No cambia conteos ni monetary |
| Decimal normalization | SQL agregado directo | escala fija 6 | Si | Checksum/formato | `formatRfmDecimal` |
| Source checksum | No existia artifact por fila | Canonical JSON sobre filas normalizadas | Si | Baseline checksum no comparable | T11A0 solo agregado |

## Especificacion Autoritativa De Extraccion

Politica T11A v1 congelada:

```text
identityAuthority = prestashop_customer
identityAuthorityVersion = prestashop-customer-v1
masterCustomerId = null
identityResolutionStatus = provisional
window = [referenceTime - 365 dias, referenceTime)
```

Query logica autoritativa:

```sql
SELECT
  o.id_customer AS prestashopCustomerId,
  MIN(o.date_add) AS firstValidOrderAtInWindow,
  MAX(o.date_add) AS lastValidOrderAtInWindow,
  COUNT(DISTINCT o.id_order) AS frequencyOrders,
  COALESCE(SUM(o.total_paid_tax_incl), 0) AS grossOrderValueTaxIncl,
  COALESCE(SUM(o.total_paid_tax_incl), 0) / COUNT(DISTINCT o.id_order)
    AS averageOrderValueTaxIncl,
  COUNT(DISTINCT o.id_shop) AS distinctShopCount,
  MIN(o.id_currency) AS currencyId,
  MIN(cu.iso_code) AS currencyCode
FROM ps_orders o
INNER JOIN ps_customer c
  ON c.id_customer = o.id_customer
LEFT JOIN ps_currency cu
  ON cu.id_currency = o.id_currency
WHERE o.valid = 1
  AND o.id_customer > 0
  AND o.date_add >= :window_start_inclusive
  AND o.date_add < :window_end_exclusive
GROUP BY o.id_customer
ORDER BY o.id_customer ASC;
```

Ausencia de `ps_customer`: aborta el snapshot mediante diagnostic guardrail; no
se excluye silenciosamente.

## Variantes Temporales

Live read-only actual:

| Variante | Clientes | Ordenes | Monetary | Delta customers | Delta orders | Delta monetary |
|---|---:|---:|---:|---:|---:|---:|
| current UTC `[start,end)` | 14.174 | 19.595 | 3.057.873.347,17 | 0 | 0 | 0 |
| end inclusive `[start,end]` | 14.174 | 19.595 | 3.057.873.347,17 | 0 | 0 | 0 |
| end + 1 UTC day | 14.222 | 19.664 | 3.068.395.686,17 | +48 | +69 | +10.522.339,00 |
| Chile calendar dates | 14.174 | 19.595 | 3.058.017.013,17 | 0 | 0 | +143.666,00 |

Ninguna variante reproduce exactamente la evidencia T11A0. La variante
`end + 1 UTC day` prueba que T11A0 usaba otra semantica de ventana, pero con la
fuente actual agrega 69 ordenes, no 21.

## Post-Reference Updates

Ordenes dentro de la ventana actual con `date_upd >= windowEndExclusive`:

```text
ordersUpdatedAfterReferenceTime = 90
customersAffectedByPostReferenceUpdates = 89
grossMonetaryOfOrdersUpdatedAfterReferenceTime = 12.431.239,00
validOrdersUpdatedAfterReferenceTime = 88
invalidOrdersUpdatedAfterReferenceTime = 2
```

Todas las actualizaciones observadas caen en `DATE(date_upd)=2026-08-03`.
Esto demuestra mutabilidad posterior al referenceTime, pero no prueba que las
columnas RFM (`valid`, `total_paid_tax_incl`, `date_add`) hayan cambiado.

## Analisis De Limites

Alrededor del end actual:

| Intervalo | Ordenes | Clientes | Monetary |
|---|---:|---:|---:|
| end -24h | 54 | 53 | 3.902.857,00 |
| end -1h | 3 | 3 | 138.307,00 |
| end +1h | 3 | 3 | 236.036,00 |
| end +24h | 69 | 68 | 10.522.339,00 |

La diferencia `<` versus `<=` no fue material en la corrida actual. La
diferencia `referenceTime` versus `referenceTime + 1 day` si es material.

## Timezone

Preflight MySQL:

```text
@@global.time_zone = UTC
@@session.time_zone = UTC
NOW() = UTC_TIMESTAMP() en la consulta ejecutada
connectionTimezone = mysql2 timezone Z + dateStrings true
```

No hay evidencia accesible de timezone PHP, backoffice PrestaShop ni una orden
con timestamp visible contrastable. Por lo tanto:

```text
timezoneStatus = UNVERIFIED
```

## Politica Temporal

Estado productivo actual:

```text
sourceDateTimeStorage = mysql_datetime
sourceTimezone = UNVERIFIED
connectionTimezone = mysql2 timezone Z
referenceTimeTimezone = UTC
calculationTimezone = UTC
recencyCalendarPolicy = utc-calendar-days-v1
windowBoundaryPolicy = [referenceTime - 365d, referenceTime)
timezoneStatus = UNVERIFIED
```

No se declara UTC confirmado solo por la sesion MySQL.

## Source Fingerprint

Fingerprint actual:

```text
activeCustomerCount = 14174
validOrderCount = 19595
grossOrderValueTaxIncl = 3057873347.170000
minOrderDateAdd = 2025-08-03T00:25:39.000Z
maxOrderDateAdd = 2026-08-02T23:51:38.000Z
maxOrderDateUpd = 2026-08-03T18:32:58.000Z
distinctShopCount = 3
distinctCurrencyCount = 1
distinctConversionRateCount = 1
zeroAmountOrderCount = 4
ordersUpdatedAfterReferenceTime = 90
sourceChecksum = 16cf084703bbc657b4d2a1e64f115819f91dd5d3ad3b0d446bcf271be695ca29
checksumVersion = rfm-source-fingerprint-v1
```

## Comparacion De Datasets

Se genero `scripts/snapshots/rfm/drift-outputs/current-source-rows.json` con
una fila por customer, IDs tecnicos y `rowChecksum`, sin PII.

No existe artifact anterior equivalente. Comparador disponible:

```bash
npm run snapshot:rfm:compare-source -- <baseline file> <candidate file>
```

## Comparabilidad De Baseline

```text
baselineComparability = AGGREGATE_ONLY
```

La evidencia anterior vive como agregados en
`docs/audits/CP-R1-T11A0-rfm-segmentation-source-audit.md`. No contiene filas
por cliente ni row checksums; no permite identificar added/removed/changed
customers.

## Causa Raiz O Hipotesis Restantes

Factor identificado:

- T11A0 uso ventana `referenceTime + 1 day`; T11A actual usa `referenceTime`.

Limitacion probatoria:

- La variante `+1 day` actual no reproduce T11A0 porque la fuente siguio
  cambiando. El baseline es agregado-only, por lo que no puede atribuirse la
  diferencia exacta fila por fila.

Hipotesis restante:

- La evidencia T11A0 probablemente fue tomada durante el dia 2026-08-03 con una
  ventana que incluia pedidos ya existentes de ese dia; la fuente actual ya
  contiene mas pedidos/updates de ese mismo dia.

## Source Drift Policy

Recomendacion: **B - snapshot de input normalizado** para auditoria futura.

Persistir o archivar, como artifact restringido:

```text
prestashopCustomerId
firstValidOrderAtInWindow
lastValidOrderAtInWindow
frequencyOrders
grossOrderValueTaxIncl
averageOrderValueTaxIncl
distinctShopCount
rowChecksum
```

Opcion C (`prestashopCustomerId + rowChecksum`) es util para detectar cambios,
pero no explica que metrica cambio. Opcion A no permite investigar drift.

## Tests

Tests focalizados T11A.1A:

```text
5 files passed
27 tests passed
```

Cubren row checksum, decimal/date canonicalization, field-change checksum
changes, source fingerprint, dataset comparator, aggregate-only/missing
baseline, variantes UTC, conversion America/Santiago, medianoche y cambio de
offset Chile.

## Riesgos

- Timezone operacional de `ps_orders.date_add` sigue no verificada.
- No hay baseline fila-a-fila anterior, solo agregados.
- `date_upd` prueba mutacion posterior, no cual columna cambio.
- La correccion `firstValidOrderAtInWindow` cambia checksums respecto del
  dry-run T11A.1 previo, sin cambiar conteos/monetary.
- `RFM_SNAPSHOT_DB_*` sigue fuera de alcance en esta tarea.

## Outputs

Directorio ignorado:

```text
scripts/snapshots/rfm/drift-outputs/
```

Archivos generados:

```text
current-source-rows.json
current-source-fingerprint.json
window-variant-comparison.json
post-reference-update-analysis.json
boundary-analysis.json
timezone-analysis.json
dataset-comparison.json
drift-verdict.json
```
