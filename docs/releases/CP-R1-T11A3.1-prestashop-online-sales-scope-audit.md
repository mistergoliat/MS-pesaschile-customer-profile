# CP-R1-T11A3.1 PrestaShop Online Sales Scope Audit

Fecha: 2026-08-04.

Estado: **AUDIT_ONLY_NO_PRODUCTIVE_QUERY_CHANGE**.

Veredicto principal: **COMBINED_POLICY_REQUIRED**.

Condiciones:

```text
EXCLUDE_CONFIRMED_GENERIC_CUSTOMER
EXCLUDE_ORDERS_WITH_SELLER_SERVICE
T08_REQUIRES_SCOPE_UPDATE
T09_REQUIRES_SCOPE_UPDATE
RFM_REQUIRES_RECALCULATION
```

## 1. Objetivo

Auditar si la poblacion RFM, T08 y T09 actualmente basada en ordenes validas de
PrestaShop representa ventas online reales o mezcla ventas online con tienda,
POS, cuentas genericas y servicios administrativos.

Esta auditoria no implementa POS, omnicanalidad, endpoints, scheduler,
persistencia MySQL, CRM, Sales Agent, Catalog Service, clustering ni motores de
recomendacion. Tampoco modifica queries productivas de T08, T09 ni RFM.

## 2. Contexto Operacional

El alcance conocido antes de esta auditoria era:

```text
RFM current filter = ps_orders.valid = 1 AND ps_orders.id_customer > 0
RFM operational window = [referenceTime - 365d, referenceTime)
RFM historical scope = valid orders before referenceTime
timezoneStatus = UNVERIFIED
identityAuthority = prestashop_customer
```

Ese filtro es correcto como extraccion PrestaShop valida, pero no como contrato
de cliente online. La validacion live confirmo contaminacion material por
senales de tienda/POS y cuentas tecnicas.

## 3. Online-Only Scope

Para Customer Profile, "cliente online" debe significar cliente con compras
digitales reales atribuibles a identidad de cliente, no cualquier orden valida
en PrestaShop.

La frontera candidata queda definida como politica negativa combinada:

```text
online_order = valid_order
  AND not confirmed_generic_customer
  AND not order_contains_confirmed_seller_service_product
  AND not confirmed_store_shop
  AND not confirmed_store_module
```

En esta corrida solo se confirmaron por evidencia automatica:

- `generic_candidate_1`
- `generic_candidate_2`
- `seller_service_candidate_1`

Los IDs tecnicos quedan solamente en outputs locales ignorados por git.

## 4. Auditoria Inicial De Queries

| Area | Filtro actual | Riesgo | Cambio productivo |
|---|---|---|---|
| RFM operacional | `valid = 1`, `id_customer > 0`, ventana 365d | Mezcla online, POS, cuenta generica y servicio vendedor | Ninguno en esta tarea |
| RFM historico | `valid = 1`, `id_customer > 0`, antes de referenceTime | Misma mezcla, con mayor impacto historico | Ninguno en esta tarea |
| T08 | Ordenes validas por `id_customer` y lineas de compra | Puede incluir producto/servicio administrativo y tienda | Ninguno en esta tarea |
| T09 | Ordenes validas por `id_customer` y comportamiento de producto | Puede inferir variedad/afinidad desde POS o servicio | Ninguno en esta tarea |
| Diagnosticos | Distribuciones agregadas sin frontera online | Detectan outliers, no explican canal | Se agrega auditoria separada |

## 5. Shops

Inventario read-only sobre ordenes validas:

| Shop | Ordenes validas | Clientes distintos | Gross tax incl | Lectura |
|---|---:|---:|---:|---|
| `shop_1` | 63.696 | 43.804 | 10.268.407.280,98 | Mayoritariamente online, pero contiene seller service y algunos POS |
| `shop_2` | 13.857 | 654 | 994.954.548,37 | Dominada por POS/cuenta generica |
| `shop_3` | 1.842 | 2 | 29.549.720,90 | Dominada por cuenta generica |

Conclusion: `id_shop` no es suficiente como filtro unico. Puede servir como
senal fuerte despues de confirmacion operacional, pero excluir por shop sin una
politica combinada tiene riesgo de falsos positivos y falsos negativos.

## 6. Modulos Y Pagos

Senales principales observadas:

| Senal | Ordenes validas | Clientes distintos | Lectura |
|---|---:|---:|---|
| `webpay` en `shop_1` | 60.132 | 42.102 | Principal canal online candidato |
| `linkify` en `shop_1` | 3.062 | 2.351 | Canal online candidato, pero tambien aparece en casos con seller service |
| `prestapos` en `shop_2` | 13.857 | 654 | Fuerte senal POS/tienda |
| `prestapos` en `shop_3` | 1.841 | 1 | Fuerte senal POS/tienda/cuenta tecnica |
| `prestapos` en `shop_1` | 97 | 2 | Confirma que modulo no debe analizarse aislado |

Conclusion: `prestapos` es una senal fuerte de tienda/POS, pero esta auditoria
no lo convierte en exclusion productiva porque requiere confirmacion
operacional explicita.

## 7. Carriers

Los carriers aparecen mezclados entre senales online y POS. `carrier_0` se
concentra en POS, pero tambien aparece fuera de ese bloque. Los carriers deben
quedar como senal auxiliar de diagnostico, no como frontera primaria.

## 8. Seller Service

Se detecto `seller_service_candidate_1` como marcador explicito de servicio
administrativo/vendedor:

```text
validOrderCount = 4.483
distinctCustomerCount = 3.018
grossLineAmount = 4.565,00
unitPriceDistribution = 0 a 10
onePesoLikeCount = 4.480
```

La distribucion de ordenes con este marcador:

| Grupo | Ordenes | Clientes | Gross tax incl |
|---|---:|---:|---:|
| Seller service + generic customer | 185 | 1 | 183.594.017,00 |
| Seller service + non generic customer | 4.298 | 3.017 | 3.238.063.303,00 |

Conclusion: este marcador debe excluirse del scope online RFM/T08/T09 cuando
este operacionalmente confirmado. No se usa un umbral estadistico de frecuencia
para excluir clientes.

## 9. Generic Customer

Se detectaron dos cuentas candidatas no humanas/tecnicas:

| Alias | Clasificacion | Ordenes validas | Lectura |
|---|---|---:|---|
| `generic_candidate_1` | `TECHNICAL_ACCOUNT` | 14.331 | Cuenta tecnica concentrada en POS |
| `generic_candidate_2` | `LIKELY_GENERIC_STORE_CUSTOMER` | 188 | Cuenta generica con alta presencia de seller service |

Tambien existen clientes de frecuencia alta clasificados como `UNRESOLVED`.
Esos no se excluyen: requieren revision o reglas de identidad futuras.

## 10. Matriz Cruzada De Senales

| Grupo | Ordenes | Clientes | Gross tax incl | Decision |
|---|---:|---:|---:|---|
| No seller service + no generic customer | 60.578 | 42.327 | 7.141.987.468,15 | Online candidate |
| No seller service + generic customer | 14.334 | 2 | 729.266.762,10 | Excluir |
| Seller service + generic customer | 185 | 1 | 183.594.017,00 | Excluir |
| Seller service + no generic customer | 4.298 | 3.017 | 3.238.063.303,00 | Excluir |

La contaminacion total bajo politica combinada es:

```text
excludedOrderCount = 18.817
excludedCustomerCount = 3.019
excludedGrossAmount = 4.150.924.082,10
includedOrderCount = 60.578
includedCustomerCount = 42.327
includedGrossAmount = 7.141.987.468,15
```

## 11. Variantes De Clasificacion

| Variante | Ordenes incluidas | Ordenes excluidas | Riesgo |
|---|---:|---:|---|
| Excluir solo generic customer | 64.876 | 14.519 | No captura seller service |
| Excluir solo seller service | 74.912 | 4.483 | No captura cuenta tecnica POS |
| Excluir solo store shop | 79.395 | 0 | Sin confirmacion de shops |
| Excluir solo store module | 79.395 | 0 | Sin confirmacion de modulos |
| Politica combinada | 60.578 | 18.817 | Mejor balance actual |
| Online allowlist | 79.395 | 0 | No hay allowlist online confirmada |

## 12. Ambiguedad

Resultado de la corrida:

```text
ambiguousOrderPolicy = fail_open
ambiguousOrderCount = 0
ambiguousShare = 0
```

La ausencia de ambiguos se explica por la politica negativa actual: si una
orden no cae en senales confirmadas de exclusion, queda como online candidate.
Antes de produccion, una politica `quarantine` puede ser preferible para nuevas
senales no clasificadas.

## 13. Politica Candidata

Version:

```text
prestashop-online-orders-candidate-v1
```

Reglas candidatas:

- Excluir cuentas genericas confirmadas.
- Excluir ordenes que contienen `seller_service_candidate_1`.
- Confirmar operacionalmente si `prestapos` debe quedar como modulo store.
- Confirmar operacionalmente si `shop_2` y `shop_3` son tiendas/POS puras.
- Mantener carriers solo como diagnostico auxiliar.
- Mantener IDs tecnicos fuera de documentos versionados.

## 14. Impacto RFM

Ventana operacional con `RFM_REFERENCE_TIME = 2026-08-03T00:00:00.000Z`:

| Metrica | Antes | Despues | Delta |
|---|---:|---:|---:|
| Clientes operacionales | 14.173 | 13.290 | -883 |
| Ordenes operacionales | 19.594 | 16.120 | -3.474 |
| Gross operacional | 3.057.824.156,17 | 1.833.611.002,40 | -1.224.213.153,77 |
| AOV | 156.059,21 | 113.747,58 | -42.311,63 |
| Max Frequency | 2.033 | 15 | -2.018 |
| p95 Frequency | 2 | 2 | 0 |
| p99 Frequency | 4 | 4 | 0 |

Distribucion F-score despues:

```text
F1 = 11.359
F2 = 1.410
F3 = 332
F4 = 143
F5 = 46
```

Conclusion: RFM funciona, pero el scope anterior estaba contaminado por un
outlier tecnico. Requiere recalculo despues de cerrar la politica online.

## 15. Impacto T11A3

| Cohorte | Antes | Despues | Delta |
|---|---:|---:|---:|
| Primera compra 30d | 628 | 569 | -59 |
| Primera compra 60d | 1.261 | 1.162 | -99 |
| Primera compra 90d | 2.222 | 2.083 | -139 |
| Recurrentes 2+ | 2.201 | 1.931 | -270 |
| Recurrentes 3+ | 636 | 521 | -115 |
| High gross active M5 | 1.933 | 1.808 | -125 |
| Active repeat high gross | 197 | 151 | -46 |
| Historico top 10 inactive | 3.029 | 2.904 | -125 |
| Frequency outlier 100+ | 1 | 0 | -1 |

Segunda compra:

| Metrica | Antes | Despues |
|---|---:|---:|
| Clientes con segunda compra | 10.039 | 9.223 |
| Clientes sin segunda compra | 34.419 | 33.104 |
| Mediana first-to-second | 105 dias | 109 dias |
| p75 first-to-second | 296 dias | 302 dias |
| p90 first-to-second | 581 dias | 592 dias |

## 16. Impacto T08

Simulacion agregada sobre lineas de orden:

```text
customersWithPurchasedProducts: 44.458 -> 42.327
orderLines: 169.291 -> 124.492
distinctProducts: 1.713 -> 1.587
sellerServiceLineCount = 4.483
sellerServiceGrossAmount = 4.565,00
```

T08 debe adoptar el mismo scope online cuando se cierre la politica. En caso
contrario puede exponer productos administrativos o comportamiento de tienda en
Customer Profile.

## 17. Impacto T09

Simulacion agregada:

```text
customersAnalyzed: 44.458 -> 42.327
averageDistinctProductCount: 3,073688 -> 2,822950
averageVariantCount: 3,110554 -> 2,852175
sellerServiceDominatedCustomerCount = 1.001
```

T09 no fue duplicado contrato por contrato en esta auditoria; el impacto se
midio como agregado de lineas para no reimplementar el contrato existente.

## 18. Relacion Con Catalog Service

Catalog Service no debe consumir ni enriquecer esta auditoria todavia. La unica
relacion necesaria es conservar una lista confirmada de productos/servicios que
no representan compra comercial del cliente, comenzando por
`seller_service_candidate_1`.

No se implementa compatibilidad, complemento, sustituto ni recomendacion de
producto.

## 19. Relacion Con Sales Agent

Sales Agent no debe consumir RFM online hasta que el scope este cerrado y
Customer Profile defina el contrato. Aun con RFM corregido, este dataset puede
priorizar clientes, pero no decidir producto concreto, necesidad actual,
compatibilidad, complemento ni sustituto.

## 20. Artefactos Generados

Codigo nuevo:

- `src/domain/customer-rfm/online-sales-scope.ts`
- `scripts/snapshots/rfm-online-sales-scope-audit.ts`
- `tests/unit/customer-rfm-online-sales-scope.test.ts`

Exports y comandos:

- `src/domain/customer-rfm/index.ts`
- `package.json`: `npm run audit:rfm-online-sales-scope`

Outputs locales ignorados:

- `scripts/snapshots/rfm/online-scope-outputs/shop-inventory.json`
- `scripts/snapshots/rfm/online-scope-outputs/payment-module-inventory.json`
- `scripts/snapshots/rfm/online-scope-outputs/carrier-inventory.json`
- `scripts/snapshots/rfm/online-scope-outputs/seller-service-candidates.json`
- `scripts/snapshots/rfm/online-scope-outputs/generic-customer-candidates.json`
- `scripts/snapshots/rfm/online-scope-outputs/signal-cross-matrix.json`
- `scripts/snapshots/rfm/online-scope-outputs/classification-policy-comparison.json`
- `scripts/snapshots/rfm/online-scope-outputs/ambiguous-orders-summary.json`
- `scripts/snapshots/rfm/online-scope-outputs/rfm-before-after.json`
- `scripts/snapshots/rfm/online-scope-outputs/t11a3-cohort-before-after.json`
- `scripts/snapshots/rfm/online-scope-outputs/t08-impact-summary.json`
- `scripts/snapshots/rfm/online-scope-outputs/t09-impact-summary.json`
- `scripts/snapshots/rfm/online-scope-outputs/online-scope-verdict.json`

## 21. Veredicto

RFM, T08 y T09 no deben seguir asumiendo que toda orden valida de PrestaShop es
venta online real. La capacidad analitica sigue siendo valida, pero debe
recalcularse con scope online explicito.

Trabajo que se conserva:

- dominio RFM y scoring;
- diagnosticos, checksums y fingerprints;
- auditoria offline read-only;
- simulacion before/after;
- tests de dominio puro.

Trabajo que se posterga:

- endpoint;
- scheduler;
- persistencia MySQL;
- Parquet/object storage/DuckDB;
- integracion CRM, Sales Agent o marketing;
- cambios productivos en T08/T09/RFM.

Roadmap corregido:

1. Confirmar operacionalmente `prestapos`, `shop_2`, `shop_3`,
   `generic_candidate_1`, `generic_candidate_2` y `seller_service_candidate_1`.
2. Convertir la politica candidata en contrato versionado online-scope.
3. Recalcular RFM offline con el scope confirmado.
4. Recalcular T08 y T09 usando la misma frontera.
5. Recien despues definir consumidor runtime, si existe.
