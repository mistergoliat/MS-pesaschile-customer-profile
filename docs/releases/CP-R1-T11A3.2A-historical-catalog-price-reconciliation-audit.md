# CP-R1-T11A3.2A Historical Catalog Price Reconciliation Audit

Fecha: 2026-08-04.

Estado: **AUDIT_ONLY_NO_PRODUCTIVE_QUERY_CHANGE**.

Veredicto principal: **HYBRID_HISTORICAL_PRICE_POLICY_REQUIRED**.

Condiciones:

```text
USE_ORDER_DATE_AS_EFFECTIVE_AT
REMOVE_ACTIVE_PRODUCT_REQUIREMENT_FOR_HISTORY
DO_NOT_USE_CURRENT_PRICE_AS_HISTORY
USE_ORDER_DETAIL_AS_FALLBACK
CATALOG_REQUIRES_HISTORICAL_MODE
RFM_REQUIRES_PRICE_RECALCULATION
T08_REQUIRES_PRICE_SOURCE_REVIEW
T09_REQUIRES_SPEND_RECALCULATION
```

## 1. Objetivo

Auditar si Customer Profile puede reconciliar precios historicos de lineas de
orden contra reglas de Catalog/PrestaShop usando la fecha real de la orden como
`effectiveAt`.

Esta tarea no modifica T08, T09, RFM productivo, Catalog Service, endpoints,
scheduler, persistencia, CRM, Sales Agent, POS, refunds, margen/costos ni
PrestaShop.

## 2. Catalog Actual

Catalog productivo ya resuelve precio como:

```text
base product price tax-excl
+ combination price impact tax-excl
+ optional specific_price override/reduction
+ tax rate configured by caller
```

La lectura comercial de Catalog obtiene `product`, `product_shop`,
`product_attribute`, `product_attribute_shop` y `specific_price`. No aplica
`NOW()` en SQL para descuentos especificos y no filtra productos por
`p.active = 1`.

Riesgo actual para historia: el resolver legacy filtra ventanas temporales con
tiempo actual de ejecucion. Eso sirve para precio vigente, pero no para
reconstruir precio historico.

## 3. EffectiveAt

La auditoria usa:

```text
effectiveAt = ps_orders.date_add
referenceTime = 2026-08-03T00:00:00.000Z
scope = operational_365d
calculationVersion = rfm-population-v1
```

No se usa `NOW()` ni `Date.now()` para decidir vigencia historica de
`specific_price`.

Timezone sigue:

```text
timezoneStatus = UNVERIFIED
```

Por eso la auditoria valida consistencia de reglas, no cierra todavia una
frontera temporal comercial definitiva.

## 4. Contexto Historico Disponible

Resultado live read-only:

```text
lineCount = 40.920
commercialLineCount = 39.480
contextStatus = CONTEXT_PARTIAL para 40.920 lineas
countryAvailableLineCount = 40.920
customerGroupHistoricalAvailableLineCount = 0
customerGroupUnavailableLineCount = 40.920
productBaseAvailableLineCount = 40.238
combinationImpactAvailableLineCount = 40.920
taxRateAvailableLineCount = 40.920
```

Lectura: falta grupo historico de cliente para el 100% de las lineas. Por eso
la seleccion de `specific_price` no puede declararse completa aunque existan
pais, IVA de linea y gran parte del precio base.

## 5. Priority De Specific Price

La auditoria replica una prioridad historica candidata sin tocar Catalog
productivo:

```text
product_attribute specificity
shop specificity
from_quantity
currency/country/group/customer specificity
newer from date
higher specific_price id
```

Reglas de compatibilidad:

```text
id_cart = 0
from_quantity <= line quantity
product_attribute wildcard or exact match
shop/currency/country/group/customer wildcard or exact match
from/to window contains effectiveAt
```

Resultado:

```text
specificPriceCandidateCount = 6.666
productsWithSpecificPriceCandidateCount = 797
selectedLineCount = 17.761
ambiguousLineCount = 0
selection confirmed = 17.761
selection partial = 23.159
compatible candidates 0 = 23.159 lineas
compatible candidates 1 = 17.285 lineas
compatible candidates 2 = 476 lineas
```

La prioridad no queda bloqueada por ambiguedad, pero sigue parcial por falta de
grupo historico.

## 6. Base Price

La reconstruccion usa precio base tax-excl historico disponible desde tablas de
Catalog/PrestaShop:

```text
COALESCE(product_shop.price, product.price)
```

No usa precio actual como fallback historico. Cuando falta base/impact/tax, la
linea queda como `ORDER_DETAIL_FALLBACK` o `UNRESOLVED`, segun corresponda.

Resultado:

```text
CATALOG_BASE_PRICE = 21.037 lineas
ORDER_DETAIL_MATCHES_BASE_PRICE_ONLY = 28 lineas
```

## 7. Combination Impact

La reconstruccion suma impacto de combinacion tax-excl:

```text
COALESCE(product_attribute_shop.price, product_attribute.price, 0)
```

Resultado:

```text
combinationImpactAvailableLineCount = 40.920
matched combination dimension = 5.565 selecciones
```

No se elimina una linea por producto actualmente inactivo ni por combinacion
historica no vigente en Catalog actual.

## 8. Discounts

Descuentos especificos observados:

```text
percentage = 6.527 candidatos
amount = 139 candidatos
combinationSpecific = 2.319 candidatos
shopSpecific = 1.189 candidatos
quantityThreshold = 0 candidatos
```

Semantica auditada:

```text
percentage reduction -> base * (1 - reduction)
amount reduction tax-excl -> subtract amount
amount reduction tax-incl -> subtract amount / (1 + effective tax rate)
```

Esto evita asumir que una reduccion fija es siempre tax-incl o siempre tax-excl.

## 9. IVA

No se asume 19% global.

La tasa efectiva se toma desde la linea de orden cuando esta disponible, o se
deriva desde unit tax-incl/tax-excl cuando corresponde.

Resultado:

```text
TAX_MATCH = 40.920 lineas
tax rate 0.190000 = 36.777 lineas
tax rate 0.000000 = 4.143 lineas
```

Conclusion: para historia se debe usar IVA efectivo de linea, no configuracion
global de Catalog ni formula manual `* 1.19`.

## 10. Comparacion Con Order Detail

Comparacion contra `ps_order_detail.total_price_tax_incl`:

```text
matchCount = 17.344
mismatchCount = 21.454
unresolvedCount = 682
matchRate = 0.439311
```

Distribucion de delta por valor de linea tax-incl:

| Bucket | Lineas |
|---|---:|
| 0 | 23.468 |
| <=1 | 964 |
| 2-10 | 152 |
| 11-100 | 83 |
| 101-1000 | 1.188 |
| >1000 | 13.625 |
| UNRESOLVED | 1.440 |

El total de lineas con valor persistido puede coincidir por fallback o por
redondeo; el match rate reportado cuenta solo reconstruccion de Catalog.

## 11. Match Rates

Por fuente de precio:

| Fuente | Lineas | Match rate |
|---|---:|---:|
| `CATALOG_BASE_PRICE` | 21.037 | 0,364263 |
| `CATALOG_SPECIFIC_PRICE` | 17.761 | 0,545071 |
| `ORDER_DETAIL_FALLBACK` | 682 | 0 |
| `UNRESOLVED` | 1.440 | 0 |

Por ano:

| Ano | Lineas | Match rate |
|---|---:|---:|
| 2025 | 21.249 | 0,361335 |
| 2026 | 19.671 | 0,491383 |

Por canal tecnico:

| Modulo | Lineas | Match rate |
|---|---:|---:|
| `webpay` | 33.065 | 0,498110 |
| `linkify` | 2.859 | 0,287863 |
| `ps_wirepayment` | 842 | 0,052257 |
| `prestapos` | 4.143 | 0 |

## 12. Deltas

Clasificaciones principales:

```text
ORDER_DETAIL_HIGHER_THAN_RECONSTRUCTED = 10.822
ORDER_DETAIL_LOWER_THAN_RECONSTRUCTED = 9.890
ROUNDING_ONLY = 714
ORDER_DETAIL_MATCHES_BASE_PRICE_ONLY = 28
```

Los deltas materiales ocurren en ambos sentidos, lo que descarta una explicacion
unica como "solo falta descuento" o "solo falta IVA". La diferencia apunta a
evidencia historica incompleta, mutabilidad de Catalog y/o reglas de precio no
capturadas por la reconstruccion offline.

## 13. Evidencia Historica Perdida

Evidencia faltante o insuficiente:

- grupo historico del cliente al momento de la compra;
- snapshots historicos de producto/combinacion;
- snapshot historico completo de reglas y prioridades de `specific_price`;
- confirmacion timezone comercial;
- semantica cerrada para lineas tecnicas y POS dentro del scope online.

La auditoria prueba que usar Catalog actual para historia no es equivalente a
precio historico.

## 14. Productos Inactivos

Resultado:

```text
inactiveLineCount = 1.048
inactiveProductAliasCount = 110
inactiveMatchCount = 720
inactiveUnresolvedCount = 0
```

Decision: historia no debe filtrar `active = 1`. Un producto actualmente
inactivo puede haber sido comprado validamente y debe permanecer en T08/T09/RFM.

## 15. Lineas Tecnicas

Resultado:

```text
sellerServiceLineCount = 1.440
sellerServiceHistoricalPriceMatchRate = 0
logisticsArtifactLineCount = 0
logisticsArtifactStatus = UNRESOLVED
```

Las lineas de servicio vendedor quedan excluidas como lineas tecnicas en esta
auditoria. No se confirma ningun artefacto logistico adicional.

## 16. Politicas A/B/C

Comparacion de autoridad monetaria:

| Politica | Resueltas | Fallback | Unresolved | Total tax-incl |
|---|---:|---:|---:|---:|
| A `order_detail` persistido | 40.920 | 0 | 0 | 2.915.759.448,145300 |
| B Catalog historico reconstruido | 39.480 | 0 | 1.440 | 3.003.371.504,000000 |
| C hibrida | 40.920 | 2.122 | 0 | 3.003.372.964,000000 |

Comparacion contra `ps_orders.total_products_wt`:

```text
Policy A delta = 93.779,975300
Policy B delta = 87.705.835,830000
Policy C delta = 87.707.295,830000
```

Policy A reconcilia mejor con PrestaShop persistido. Policy B/C permite
diagnosticar reglas historicas, pero no debe reemplazar todavia a
`order_detail` como autoridad monetaria.

## 17. Autoridad Recomendada

Autoridad recomendada para Customer Profile analytics v1:

```text
primary historical monetary authority = ps_order_detail persisted values
catalog historical reconstruction = diagnostic/enrichment only
fallback policy = required for non-reconstructable lines
```

Catalog historico puede usarse para explicar y auditar precio, pero no para
reescribir Monetary de RFM/T08/T09 hasta tener snapshots o contrato historico
completo.

## 18. Riesgos

- Timezone comercial sigue `UNVERIFIED`.
- `specific_price` historico no es completamente seleccionable sin grupo
  historico de cliente.
- Catalog actual puede no representar estado de producto/combinacion en la fecha
  de compra.
- POS y lineas tecnicas siguen dependiendo de politicas T11A3.1/T11A3.2.
- Refunds, margen, costo y rentabilidad estan fuera de alcance.
- No hay evidencia suficiente para endpoint, scheduler o read model SQL.

## 19. Tests Y Artefactos

Codigo nuevo:

- `src/domain/customer-rfm/historical-catalog-price-reconciliation.ts`
- `scripts/snapshots/rfm-historical-catalog-price-reconciliation.ts`
- `tests/unit/customer-rfm-historical-catalog-price-reconciliation.test.ts`

Exports y comandos:

- `src/domain/customer-rfm/index.ts`
- `package.json`: `npm run audit:rfm-historical-catalog-price`

Outputs locales ignorados:

- `pricing-context-availability.json`
- `specific-price-candidate-analysis.json`
- `specific-price-selection-analysis.json`
- `historical-price-line-reconciliation.json`
- `historical-price-delta-distribution.json`
- `historical-price-temporal-analysis.json`
- `tax-reconciliation.json`
- `inactive-product-analysis.json`
- `technical-line-analysis.json`
- `pricing-policy-comparison.json`
- `historical-price-authority-verdict.json`

Cobertura unitaria:

- `effectiveAt` historico sin `NOW()`;
- prioridad de `specific_price`;
- amount y percentage reductions;
- `reduction_tax`;
- IVA efectivo de linea;
- productos inactivos conservados;
- fallback a `order_detail`;
- lineas tecnicas excluidas;
- policies A/B/C;
- outputs sin PII.

## 20. Veredicto

**HYBRID_HISTORICAL_PRICE_POLICY_REQUIRED**.

La capacidad de reconstruccion historica existe y es util como diagnostico, pero
no es suficiente como autoridad monetaria porque el match rate catalogado es
43,9311% y el contexto historico esta parcial en el 100% de las lineas.

Trabajo que se conserva:

- dominio puro de auditoria historica;
- selector `specific_price` con `effectiveAt`;
- resolver tax-aware sin 19% global;
- outputs agregados sin PII;
- tests deterministas.

Trabajo que se posterga:

- persistencia MySQL;
- Parquet/object storage/DuckDB;
- endpoint;
- scheduler;
- integracion CRM, Sales Agent o marketing;
- cambios productivos en T08/T09/RFM;
- cambios productivos en Catalog Service.

Roadmap corregido:

1. Cerrar timezone.
2. Cerrar scope online y lineas tecnicas.
3. Definir si se necesita snapshot historico de Catalog o si `order_detail`
   queda como autoridad permanente.
4. Recalcular RFM/T08/T09 solo con politica monetaria y scope confirmados.
5. Recien despues definir consumidor runtime y patron de persistencia.

