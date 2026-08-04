# CP-R1-T11A3 RFM Analytical Use-Case Validation

Fecha: 2026-08-04.

Veredicto principal: **RFM_USE_CASES_VALIDATED**.

Condiciones secundarias:

```text
RFM_REQUIRES_HISTORICAL_LAYER
RFM_REQUIRES_T08_T09_ENRICHMENT
```

## 1. Objetivo

Validar si las metricas RFM actuales permiten construir cohortes analiticas
interpretables, materialmente distintas, suficientemente pobladas,
comercialmente relevantes y accionables en una fase posterior, sin reabrir
persistencia, endpoints, scheduler, CRM, Sales Agent, Catalog Service,
clustering ni automatizacion.

## 2. Contexto T11A2

T11A2 cerro con:

```text
KEEP_ANALYTICAL_CORE
FREEZE_PERSISTENCE
FIRST_CONSUMER_ANALYST
```

T11A3 conserva ese marco. La identidad sigue provisional:

```text
identityAuthority = prestashop_customer
identityAuthorityVersion = prestashop-customer-v1
prestashopCustomerId = ps_customer.id_customer
masterCustomerId = null
identityResolutionStatus = provisional
```

La timezone sigue:

```text
timezoneStatus = UNVERIFIED
```

## 3. Auditoria Inicial

| AREA | CURRENT CAPABILITY | VALID FOR T11A3 | GAP | EVIDENCE | CHANGE REQUIRED |
|---|---|---:|---|---|---|
| Poblacion operacional | Clientes con orden valida en `[referenceTime - 365d, referenceTime)` | Si | No representa inactivos historicos | `buildRfmSnapshotWindow`, `readPopulation` | Agregar capa historica auxiliar |
| Lifetime metrics | Solo `historicalCustomerCount` agregado | Parcial | Faltaban metrics lifetime por cliente | `RfmSnapshotDiagnostics` | Implementado en dominio puro |
| Clientes fuera de ventana | `excludedCustomerCount` agregado | Parcial | Sin cohortes historicas | Manifest T11A | Implementado como agregados sin IDs |
| Segunda compra | No existia | No | Faltaba first/second order y censura temporal | Sin contrato previo | Implementado desde ordenes validas normalizadas |
| Scores actuales | R/M tie-safe, F thresholds candidate v1 | Si | Solo operacionales | `scoring.ts` | Reutilizar sin modificar |
| Shops | Diagnostico operacional por shop | Parcial | Faltaba distribucion por cohorte | `readDiagnostics().shops.perShop` | Implementado cuando hay `shopId` tecnico |
| Outlier Frequency | Diagnostico >100/>500 | Si | Faltaba impacto en cohortes | Manifest T11A | Implementado como revision diagnostica |
| T08/T09 | Contratos por cliente existentes | Parcial | No hay input batch normalizado | `contracts.ts` T08/T09 | Reportar `CROSS_SIGNAL_UNAVAILABLE` |
| Persistencia/runtime | Congelado | No | No consumidor runtime | T11A2 | Sin cambios |

## 4. Poblacion Operacional

Referencia usada:

```text
RFM_REFERENCE_TIME = 2026-08-03T00:00:00.000Z
RFM_CALCULATION_VERSION = rfm-population-v1
```

Resultado live read-only de T11A3:

```text
operationalCustomerCount = 14.173
operationalOrderCount = 19.594
operationalGrossOrderValueTaxIncl = 3.057.824.156,17
```

Nota de fuente mutable: T11A.1A habia observado 14.174 clientes y 19.595
ordenes para el mismo `referenceTime`. La diferencia actual de 1 cliente/orden
confirma que la fuente historica puede derivar por updates posteriores.

## 5. Poblacion Historica

Universo:

```text
todas las ordenes valid = 1 anteriores a referenceTime
```

Resultado:

```text
historicalCustomerCount = 44.458
historicalOrderCount = 79.396
historicalGrossOrderValueTaxIncl = 11.292.911.550,25
historicalOutsideOperationalWindowCount = 30.285
operationalShareOfHistoricalCustomers = 31,8795%
```

Los clientes registrados sin compras validas no forman parte del denominador.

## 6. Separacion Temporal

La capa operacional conserva:

```text
operationalFirstValidOrderAt
operationalLastValidOrderAt
operationalRecencyDays
operationalFrequencyOrders
operationalGrossOrderValueTaxIncl
operationalAverageOrderValueTaxIncl
```

La capa historica auxiliar calcula:

```text
lifetimeFirstValidOrderAt
lifetimeLastValidOrderAt
lifetimeFrequencyOrders
lifetimeGrossOrderValueTaxIncl
lifetimeAverageOrderValueTaxIncl
daysSinceLifetimeLastOrder
hasOrderInOperationalWindow
```

Resumen:

```text
customersInBothLayersCount = 14.173
historicalOnlyCustomerCount = 30.285
operationalOnlyCustomerCount = 0
historicalOutsideOperationalWindowGrossOrderValueTaxIncl = 5.797.500.145,95
medianDaysSinceLastOrderOutsideOperationalWindow = 829
```

## 7. Cohortes Candidatas

Estas cohortes son candidatas tecnicas, no segmentos comerciales finales.

### Recent First Purchase Candidate

| Cohorte | Customers | Operational share | Historical share | Gross monetary | Median order value |
|---|---:|---:|---:|---:|---:|
| 30d | 628 | 4,4310% | 1,4126% | 98.187.376,00 | 48.495,00 |
| 60d | 1.261 | 8,8972% | 2,8364% | 193.775.100,00 | 47.586,00 |
| 90d | 2.222 | 15,6777% | 4,9980% | 325.816.976,00 | 46.980,00 |

Accion potencial: seguimiento orientado a segunda compra. No decide producto.

### Second Purchase Achieved Candidate

```text
customersWithSecondPurchase = 10.039
customersWithoutSecondPurchase = 34.419
conversionFromFirstToSecondProxy = 22,5809%
```

No es tasa causal de conversion porque no define una cohorte temporal de
adquisicion con madurez homogena.

### Repeat Customer Candidate

| Definicion | Customers | Population share | Order share | Gross monetary share | Median recency |
|---|---:|---:|---:|---:|---:|
| operationalFrequency >= 2 | 2.201 | 15,5295% | 38,8997% | 48,8201% | 122 |
| operationalFrequency >= 3 | 636 | 4,4874% | 22,9254% | 28,8420% | 94 |
| operationalFrequency >= 4 | 247 | 1,7428% | 16,9695% | 17,0003% | 63 |

### High Gross Purchase Value Active Candidate

`monetaryScore = 5`:

```text
customerCount = 1.933
operationalPopulationShare = 13,6386%
grossMonetaryShare = 70,5883%
frequency median = 1
recency median = 140
```

Comparadores:

| Definicion | Customers | Gross monetary share | Median frequency |
|---|---:|---:|---:|
| top 20% gross monetary | 2.835 | 78,0592% | 1 |
| top 10% gross monetary | 1.418 | 64,6816% | 2 |
| top 5% gross monetary | 709 | 52,1111% | 2 |

No se interpreta como margen, rentabilidad ni cliente rentable.

### Active Repeat High Gross Candidate

| Definicion | Customers | Population share | Order share | Gross monetary share | Max frequency |
|---|---:|---:|---:|---:|---:|
| R>=4 AND F>=4 AND M>=4 | 197 | 1,3900% | 5,4558% | 12,0946% | 57 |
| R=5 AND F=5 AND M=5 | 35 | 0,2469% | 1,6485% | 5,2359% | 57 |

El outlier de 2.033 ordenes no entra en estas dos cohortes.

### Historically High Gross Inactive Candidate

Usa capa historica; no mezcla scores operacionales.

| Definicion | Customers | Historical share | Lifetime gross monetary share | Median days since last order | P75 days |
|---|---:|---:|---:|---:|---:|
| outside window + top 20% lifetime gross | 6.057 | 13,6241% | 39,5785% | 802 | 1.093 |
| outside window + top 10% lifetime gross | 3.029 | 6,8132% | 32,3096% | 783 | 1.043 |
| outside window + top 5% lifetime gross | 1.515 | 3,4077% | 25,1690% | 754 | 1.009 |

Esta es la evidencia mas fuerte de que RFM operacional requiere una capa
historica auxiliar para reactivacion.

### Frequency Outlier Review

| Definicion | Customers | Order share | Gross monetary share | Max without cohort |
|---|---:|---:|---:|---:|
| frequency > 100 | 1 | 10,3756% | 3,0810% | 57 |
| frequency > 500 | 1 | 10,3756% | 3,0810% | 57 |
| top 0,1% frequency | 15 | 11,3657% | 6,8455% | 8 |

No se etiqueta como fraude, B2B ni cuenta operacional. Requiere revision manual.

## 8. Analisis De Segunda Compra

Distribucion:

| Bucket | Customers |
|---|---:|
| sameDay | 441 |
| 1-7 days | 1.003 |
| 8-30 days | 1.436 |
| 31-60 days | 1.069 |
| 61-90 days | 783 |
| 91-180 days | 1.553 |
| 181-365 days | 1.762 |
| >365 days | 1.992 |
| noSecondPurchase | 34.419 |

`daysFirstToSecondOrder`:

```text
p25 = 23
median = 105
p75 = 296
p90 = 581
average = 206,978683
```

Las cohortes de primera compra desde 2025-09 en adelante se marcaron como no
maduras para observacion completa de 365 dias, separando `not_yet_observed` de
`no_second_purchase`.

## 9. Cruces T08/T09

Resultado actual:

```text
CROSS_SIGNAL_UNAVAILABLE
```

Motivo:

- T08 existe como contrato runtime por cliente, pero no hay input batch
  normalizado para cruzar contra cohortes RFM.
- T08 no expone familias de producto validas.
- T09 expone repeticion, diversidad y concentracion por cliente, pero T11A3 no
  debe duplicar sus calculos dentro de RFM.

RFM gana interpretabilidad cuando se combina con T08/T09, pero ese join debe
ser una tarea futura separada.

## 10. Valor Incremental De RFM

| Use case | Simple filter baseline | RFM enrichment | Verdict |
|---|---|---|---|
| recent first purchase follow-up | `frequency = 1 AND recency <= 30 days` | R/M agregan priorizacion relativa | `RFM_ADDS_LIMITED_VALUE` |
| second purchase timing | `lifetimeFrequencyOrders >= 2` | RFM no explica timing sin secuencia historica | `SIMPLE_FILTER_IS_SUFFICIENT` |
| high gross active prioritization | top percentile gross monetary | M score combina valor poblacional con R/F | `RFM_ADDS_MEANINGFUL_VALUE` |
| historically high gross inactive | no order in 365d + lifetime gross | requiere historico fuera de RFM operacional | `RFM_ADDS_LIMITED_VALUE` |
| product interpretation | RFM cohort only | necesita T08/T09 | `REQUIRES_T08_T09` |

Conclusion: RFM no es solo filtros simples, pero su mayor valor aparece al
combinar valor relativo, recencia, frecuencia y capa historica. Para segunda
compra, la secuencia historica aporta mas que el score RFM.

## 11. Sensibilidad

### Recency

| Threshold | Customers | Population share | Order share | Gross monetary share |
|---|---:|---:|---:|---:|
| <=30 | 1.086 | 7,6625% | 9,0742% | 14,3361% |
| <=60 | 2.078 | 14,6617% | 16,0866% | 23,3749% |
| <=90 | 3.482 | 24,5678% | 25,8446% | 34,5818% |
| <=180 | 6.863 | 48,4231% | 47,4635% | 56,9106% |
| <=365 | 14.173 | 100,0000% | 100,0000% | 100,0000% |

### Frequency

| Threshold | Customers | Population share | Order share | Gross monetary share |
|---|---:|---:|---:|---:|
| >=2 | 2.201 | 15,5295% | 38,8997% | 48,8201% |
| >=3 | 636 | 4,4874% | 22,9254% | 28,8420% |
| >=4 | 247 | 1,7428% | 16,9695% | 17,0003% |
| >=6 | 61 | 0,4304% | 12,8815% | 9,8360% |

### Monetary

| Threshold | Customers | Population share | Order share | Gross monetary share |
|---|---:|---:|---:|---:|
| p80 | 2.835 | 20,0028% | 36,0416% | 78,0592% |
| p90 | 1.418 | 10,0049% | 25,7375% | 64,6816% |
| p95 | 709 | 5,0025% | 19,2151% | 52,1111% |

No se selecciona ningun threshold final en esta tarea.

## 12. Estabilidad

Se ejecuto estabilidad recalculada con referencias explicitas:

```text
2026-07-04T00:00:00.000Z
2026-06-04T00:00:00.000Z
2026-05-05T00:00:00.000Z
```

| Reference time | Operational customers | Recent first purchase 30d | Repeat 2+ | M5 | R4F4M4+ | Historical inactive top10 |
|---|---:|---:|---:|---:|---:|---:|
| 2026-07-04 | 14.362 | 665 | 2.187 | 1.945 | 194 | 2.945 |
| 2026-06-04 | 14.643 | 1.018 | 2.278 | 1.985 | 201 | 2.848 |
| 2026-05-05 | 14.823 | 835 | 2.305 | 1.988 | 205 | 2.723 |

Advertencia: estas comparaciones son recalculos contra una fuente mutable, no
fotografias exactas del estado que existia en esas fechas.

## 13. Accionabilidad

| Cohorte | Hipotesis de accion | Readiness | Requiere |
|---|---|---|---|
| Recent first purchase | Seguimiento de experiencia y eventual segunda compra | `HUMAN_REVIEW_CANDIDATE` | historial de productos, oportunidad, consentimiento, revision humana |
| Second purchase achieved | Identificar patrones asociados a recurrencia | `ANALYSIS_ONLY` | T08/T09, madurez de cohorte |
| Repeat customer | Fidelizacion o atencion diferenciada | `HUMAN_REVIEW_CANDIDATE` | product behavior, contexto actual |
| High gross active | Priorizacion humana y revision de necesidades | `HUMAN_REVIEW_CANDIDATE` | T08/T09, margen si existe en el futuro |
| Historically high gross inactive | Reactivacion revisada | `HUMAN_REVIEW_CANDIDATE` | T08/T09, consentimiento, intencion actual |
| Frequency outlier | Revision manual antes de segmentacion | `ANALYSIS_ONLY` | revision operacional |

No se usa `READY_FOR_AUTOMATION`.

## 14. Limitaciones

Monetary:

```text
gross tax-incl
not net revenue
not margin
not profitability
refundAdjustmentApplied = false
```

Timezone:

```text
timezoneStatus = UNVERIFIED
```

Identidad:

```text
prestashopCustomerId is provisional
not a public Customer Profile identity
```

Fuente mutable:

```text
historical recalculation may drift
```

Otras limitaciones:

- cohortes recientes tienen censura temporal;
- clientes inactivos requieren capa historica separada;
- outliers no deben eliminarse sin clasificacion comercial;
- scores son politicas candidatas, no segmentos finales;
- no hay producto recomendado ni accion automatica.

## 15. Outputs

Directorio ignorado:

```text
scripts/snapshots/rfm/use-case-outputs/
```

Artefactos generados sin PII:

```text
population-summary.json
operational-vs-lifetime.json
second-purchase-analysis.json
candidate-cohorts.json
threshold-sensitivity.json
rfm-incremental-value.json
cohort-stability.json
t08-t09-cross-analysis.json
use-case-validation-verdict.json
```

## 16. Tests

Tests nuevos:

```text
tests/unit/customer-rfm-use-case-analysis.test.ts
```

Cobertura:

- capa operacional e historica;
- first/last lifetime order;
- lifetime frequency y monetary;
- `hasOrderInOperationalWindow`;
- segunda compra, mismo dia, 7/30/365/>365 dias;
- cohortes candidatas superpuestas;
- sensibilidad R/F/M;
- valor incremental;
- outputs sin customer IDs, order IDs ni PII-shaped fields;
- checksum deterministico;
- referencia temporal explicita.

## 17. Riesgos

- Fuente PrestaShop mutable.
- Timezone comercial no verificada.
- Identidad provisional.
- Monetary bruto tax-incl sin refunds neteados.
- T08/T09 no disponibles como input batch normalizado.
- Outlier de 2.033 ordenes distorsiona frecuencia y debe revisarse manualmente.
- Los thresholds siguen siendo candidatos.

## 18. Recomendacion De Proximo Consumidor

Mantener **analista** como proximo consumidor.

Siguiente tarea recomendada: definir un artifact batch seguro para cruzar T11A3
con T08/T09 sin endpoint ni persistencia productiva, o cerrar primero la
verificacion timezone si se quiere usar recency en decisiones operacionales.

## 19. Veredicto

**RFM_USE_CASES_VALIDATED** porque existen al menos dos cohortes materialmente
distintas, pobladas e interpretables:

- recent first purchase para seguimiento de segunda compra;
- repeat customer para fidelizacion/atencion diferenciada;
- high gross active para priorizacion humana;
- historically high gross inactive para reactivacion revisada.

Condiciones:

```text
RFM_REQUIRES_HISTORICAL_LAYER
RFM_REQUIRES_T08_T09_ENRICHMENT
FREEZE_PERSISTENCE
```

No avanzar a persistencia, endpoint, scheduler, clustering ni integracion
runtime desde T11A3.
