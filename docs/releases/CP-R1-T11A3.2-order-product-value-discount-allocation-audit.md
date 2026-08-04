# CP-R1-T11A3.2 Order Product Value and Discount Allocation Audit

Fecha: 2026-08-04.

Estado: **AUDIT_ONLY_NO_PRODUCTIVE_QUERY_CHANGE**.

Veredicto principal: **ORDER_DISCOUNT_ATTRIBUTION_PARTIAL**.

Condiciones:

```text
USE_TAX_INCL_AS_PRIMARY
KEEP_TAX_EXCL_AS_AUXILIARY
EXCLUDE_SELLER_SERVICE
ALLOCATE_PRODUCT_DISCOUNT_PROPORTIONALLY
DO_NOT_ALLOCATE_FREE_SHIPPING
RFM_REQUIRES_MONETARY_RECALCULATION
T08_REQUIRES_VALUE_RECALCULATION
T09_REQUIRES_SPEND_RECALCULATION
```

## 1. Objetivo

Determinar una politica monetaria canonica, reproducible y auditable para que
Customer Profile analytics v1 represente exclusivamente valor de productos
comerciales efectivamente comprados por el cliente online.

No se modifican T08, T09, RFM, endpoints, scheduler, persistencia, CRM, Sales
Agent, Catalog Service, POS ni PrestaShop.

## 2. Alcance Live

La corrida live read-only uso:

```text
RFM_REFERENCE_TIME = 2026-08-03T00:00:00.000Z
RFM_CALCULATION_VERSION = rfm-population-v1
RFM_MONETARY_AUDIT_SCOPE = operational_365d
```

El modo `all_historical` queda disponible en el script, pero la corrida
historica completa excedio el limite practico de esta tarea. El alcance
operacional coincide con la ventana que RFM usa hoy.

## 3. Logica Actual De Precios

| AREA | CURRENT SOURCE FIELDS | CURRENT FORMULA | TAX BASIS | DISCOUNT BASIS | RISK | EVIDENCE | CHANGE REQUIRED |
|---|---|---|---|---|---|---|---|
| T08 Purchased Products | `ps_order_detail.total_price_tax_incl`, `product_quantity` | `SUM(total_price_tax_incl)` | Tax-incl persistido | Linea PrestaShop, sin global allocation | Incluye tecnicos; no asigna descuento global | `mysql-purchased-products-reader.ts` | Futuro scope comun |
| T09 Product Behavior | `ps_order_detail.total_price_tax_incl` | `SUM(total_price_tax_incl)` y shares | Tax-incl persistido | Linea PrestaShop, sin global allocation | Spend share contaminado por tecnicos | `mysql-customer-product-behavior-reader.ts` | Futuro scope comun |
| RFM Monetary | `ps_orders.total_paid_tax_incl` | `SUM(total_paid_tax_incl)` | Tax-incl total orden | Total orden neto PrestaShop | Mezcla productos, shipping, wrapping, descuentos y tecnicos | `mysql-rfm-population-reader.ts` | Futuro net eligible product value |
| RFM AOV | `grossOrderValueTaxIncl`, `frequencyOrders` | `gross / frequency` | Heredado de RFM Monetary | Heredado | AOV contaminado | `dataset.ts` | Recalcular |
| Formula manual 1.19 | No encontrada en runtime T08/T09/RFM | N/A | N/A | N/A | El riesgo es asumirla a futuro | `rg` productivo | No usar |

No se encontro logica productiva equivalente a:

```text
(product price - product discount) * 1.19
```

## 4. Campos De Linea

Los campos requeridos existen en `ps_order_detail`:

```text
id_order_detail, id_order, product_id, product_attribute_id,
product_quantity, unit_price_tax_excl, unit_price_tax_incl,
total_price_tax_excl, total_price_tax_incl, product_price,
reduction_percent, reduction_amount, reduction_amount_tax_incl,
reduction_amount_tax_excl, group_reduction, tax_computation_method,
id_tax_rules_group, product_name, product_reference
```

La documentacion no versiona nombres ni referencias de producto.

## 5. Campos De Orden

Los campos requeridos existen en `ps_orders`:

```text
total_products, total_products_wt,
total_discounts, total_discounts_tax_incl, total_discounts_tax_excl,
total_shipping, total_shipping_tax_incl, total_shipping_tax_excl,
total_wrapping, total_wrapping_tax_incl, total_wrapping_tax_excl,
total_paid, total_paid_tax_incl, total_paid_tax_excl, total_paid_real,
conversion_rate, id_currency, round_mode, round_type
```

En la ventana operacional:

```text
orderCount = 19.594
customerCount = 14.173
currencyCount = 1
```

## 6. Semantica Tax Incl/Excl

Resultado:

```text
LINE_VALUE_SEMANTICS_CONFIRMED
checkedLineCount = 40.920
quantityTimesUnitTaxInclMatches = 40.920
quantityTimesUnitTaxExclMatches = 40.920
productPriceTaxExclCandidateMatches = 40.920
specificDiscountMetadataPresentCount = 19.598
totalPriceAlreadyNettedEvidenceCount = 15.888
```

Lectura:

- `total_price_tax_incl` representa total de linea con IVA y cantidad.
- `total_price_tax_excl` representa total equivalente sin IVA.
- `product_price` se comporta como base tax-excl.
- `reduction_*` es metadata de descuento especifico y no debe restarse de nuevo
  cuando se usa `total_price_*`.

## 7. Tasas Tributarias

No se debe asumir 19% global.

```text
lineCount = 40.920
distinctTaxRulesGroupCount = 1
19 percent lines = 39.478-39.480 aprox.
0 percent lines = 1.438
other observed rates = 3
undefined rate lines = 1
manualTaxFormulaVerdict = CORRECT_ONLY_FOR_19_PERCENT_LINES
```

Distribucion observada:

| Rate | Lines |
|---|---:|
| `0.190000` | 39.478 |
| `0.000000` | 1.438 |
| `0.190722` | 2 |
| `0.200000` | 1 |
| `UNDEFINED` | 1 |

La politica futura debe preferir campos tax-incl persistidos por PrestaShop.

## 8. Descuentos Especificos

Los descuentos especificos aparecen como metadata de linea. La evidencia indica
que `total_price_tax_incl` y `total_price_tax_excl` ya estan neteados cuando
corresponde.

Riesgo evitado:

```text
No restar reduction_amount_* otra vez.
No multiplicar manualmente por 1.19.
```

## 9. Descuentos Globales

Campos de orden:

```text
ordersWithDiscount = 3.303
ordersWithoutDiscount = 16.291
ordersWhereLegacyEqualsTaxIncl = 19.594
ordersWhereLegacyEqualsTaxExcl = 17.874
ordersWhereAllDiffer = 0
maxDifference = 245.112,00
```

Lectura operacional:

- `total_discounts` coincide con `total_discounts_tax_incl` en esta ventana.
- `total_discounts_tax_excl` debe conservarse para diagnostico tax-excl.
- `total_discounts` no debe ser autoridad semantica futura aunque coincida hoy.

## 10. Cart Rules

Clasificacion read-only:

| Categoria | Orders | Rules | Gross tax incl |
|---|---:|---:|---:|
| Fixed product discount | 3.304 | 3.325 | 46.924.846,26 |
| Free shipping | 2 | 2 | 107.713,00 |
| Mixed product and shipping | 1 | 1 | 198.446,00 |
| Percent product discount | 0 | 0 | 0 |
| Specific product discount | 0 | 0 | 0 |
| Gift product | 0 | 0 | 0 |
| Unknown | 0 | 0 | 0 |

La atribucion queda parcial por una regla mixta. No se distribuye free shipping
entre productos.

## 11. Servicio Vendedor

Se uso `seller_service_candidate_1` desde T11A3.1 como ID tecnico confirmado en
configuracion diagnostica local.

```text
orderCount = 1.440
lineCount = 1.440
quantity = 1.461
grossLineTaxIncl = 1.460,00
grossLineTaxExcl = 1.458,00
unitPrice median = 1,00
cartRuleParticipation = 1.438
```

Decision candidata:

```text
SELLER_SERVICE -> excluir siempre de valor comercial del producto
```

## 12. Costo Logistico

No se confirmo ningun `LOGISTICS_ARTIFACT` en esta corrida:

```text
excludedLogisticsValueTaxIncl = 0,00
```

No se excluye costo logistico hasta confirmar que es artefacto administrativo y
no servicio comprado por el cliente.

## 13. Reconciliacion De Productos

Comparacion `SUM(order_detail.total_price_tax_incl)` vs
`ps_orders.total_products_wt`:

| Delta bucket | Orders | Share |
|---|---:|---:|
| 0 | 19.438 | 99,2038% |
| <= 1 CLP | 153 | 0,7809% |
| 2-10 CLP | 2 | 0,0102% |
| > 1000 CLP | 1 | 0,0051% |

Comparacion `SUM(order_detail.total_price_tax_excl)` vs
`ps_orders.total_products`:

| Delta bucket | Orders | Share |
|---|---:|---:|
| 0 | 17.413 | 88,8690% |
| <= 1 CLP | 2.180 | 11,1259% |
| > 1000 CLP | 1 | 0,0051% |

Conclusion: `total_products_wt` es altamente reconciliable con suma de lineas
tax-incl, con excepciones menores de redondeo y un outlier.

## 14. Reconciliacion De Total Pagado

Identidad candidata tax-incl:

```text
total_products_wt
- total_discounts_tax_incl
+ total_shipping_tax_incl
+ total_wrapping_tax_incl
~= total_paid_tax_incl
```

Resultado:

| Delta bucket | Orders | Share |
|---|---:|---:|
| 0 | 18.849 | 96,1978% |
| <= 1 CLP | 664 | 3,3888% |
| 2-10 CLP | 81 | 0,4134% |
| > 10 CLP | 0 | 0% |

La reconciliacion del total pagado es estable en tax-incl.

## 15. Asignacion Proporcional

Politica simulada:

```text
lineWeight = lineGrossEligibleTaxIncl / grossEligibleProductValueTaxIncl
allocatedOrderDiscountTaxIncl = lineWeight * productApplicableDiscountTaxIncl
lineNetEligibleProductValueTaxIncl = lineGrossEligibleTaxIncl - allocated
```

Reglas:

- no asignar descuento a seller service;
- no asignar a logistics artifact excluido;
- no asignar free shipping a productos;
- no permitir net negativo;
- usar decimal exacto en dominio;
- residuo por `largest_remainder`.

Resultado:

```text
productApplicableOrderDiscountTaxIncl = 47.123.292,26
shippingDiscountTaxIncl = 107.713,00
otherDiscountTaxIncl = 0,00
allocatedDiscountTaxIncl = 47.123.292,26
negativeNetLineCount = 0
```

## 16. Redondeos

El dominio usa aritmetica decimal sobre `bigint` con escala 6. La asignacion de
residuo es deterministica:

```text
allocationMethod = largest_remainder
```

Los deltas observados de pago quedan dentro de 10 CLP para el 100% de ordenes
operacionales.

## 17. Casos Especiales

```text
fullyDiscountedOrderCount = 8
discountGreaterThanEligibleSubtotalCount = 1
zeroPaidOrderCount = 4
negativePaidOrderCount = 0
multipleCartRulesOrderCount = 22
giftProductOrderCount = 0
freeShippingOrderCount = 2
technicalOnlyOrderCount = 0
exemptLineOrderCount = 1.438
multiCurrencyOrderCount = 0
refundEvidenceOrderCount = 0
refundAdjustmentApplied = false
```

Refunds no se resuelven en esta tarea.

## 18. Comparacion De Politicas

| Politica | Total monetary | AOV | Median | p95 | Zero orders |
|---|---:|---:|---:|---:|---:|
| A `total_paid_tax_incl` | 3.057.824.156,17 | 156.059,21 | 47.960,00 | 549.970,00 | 4 |
| B `total_products_wt` | 2.915.665.668,17 | 148.804,00 | 42.990,00 | 530.604,00 | 1 |
| C gross eligible lines | 2.915.757.988,145300 | 148.808,72 | 42.990,00 | 530.604,00 | 0 |
| D net eligible tax-incl | 2.868.634.696,885300 | 146.403,73 | 42.491,50 | 523.160,00 | 8 |
| E net eligible tax-excl | 2.410.616.126,998170 | 123.028,28 | 35.706,80 | 439.629,60 | 8 |

Politica candidata para Customer Profile analytics v1:

```text
Monetary = SUM(netEligibleProductValueTaxIncl)
```

## 19. Impacto RFM

En la misma poblacion operacional:

```text
totalMonetaryBefore = 3.057.824.156,17
totalMonetaryAfter = 2.868.634.696,885300
changedMonetaryScoreCount = 3.010
changedRfmCodeCount = 3.010
highGrossCohortCountBefore = 1.933
highGrossCohortCountAfter = 1.499
```

Distribucion M-score:

| Score | Before | After |
|---|---:|---:|
| M1 | 4.300 | 5.080 |
| M2 | 2.953 | 3.071 |
| M3 | 2.540 | 2.538 |
| M4 | 2.447 | 1.985 |
| M5 | 1.933 | 1.499 |

Conclusion: `total_paid_tax_incl` contamina materialmente Monetary para RFM.

## 20. Politica Candidata

Version:

```text
monetaryPolicyVersion = eligible-product-net-value-tax-incl-candidate-v1
```

Contrato por orden:

```text
grossEligibleProductValueTaxIncl
grossEligibleProductValueTaxExcl
productApplicableOrderDiscountTaxIncl
productApplicableOrderDiscountTaxExcl
netEligibleProductValueTaxIncl
netEligibleProductValueTaxExcl
excludedSellerServiceValueTaxIncl
excludedLogisticsValueTaxIncl
shippingValueTaxIncl
wrappingValueTaxIncl
reconciliationDeltaTaxIncl
reconciliationStatus
discountAttributionStatus
```

Nombre semantico recomendado:

```text
customerNetEligibleProductPurchaseValueTaxIncl
```

No llamar `revenue`, `profit` ni `margin`.

## 21. Riesgos

- Una regla mixta de producto/shipping deja la atribucion global como parcial.
- Un outlier de reconciliacion de productos requiere revision puntual.
- `all_historical` no fue completado por timeout operativo.
- Costo logistico como producto sigue sin identificar.
- Timezone sigue `UNVERIFIED`.
- T11A3.1 online scope aun debe combinarse con esta politica monetaria.

## 22. Tests Y Artefactos

Codigo nuevo:

- `src/domain/customer-rfm/order-monetary-composition.ts`
- `scripts/snapshots/rfm-order-monetary-audit.ts`
- `tests/unit/customer-rfm-order-monetary-composition.test.ts`

Comando:

```bash
npm run audit:rfm-order-monetary
```

Outputs locales ignorados:

- `schema-fields.json`
- `current-price-calculation.json`
- `tax-rate-analysis.json`
- `line-vs-order-products-reconciliation.json`
- `discount-fields-reconciliation.json`
- `cart-rule-classification.json`
- `technical-product-analysis.json`
- `eligible-product-subtotal-analysis.json`
- `discount-allocation-analysis.json`
- `paid-total-reconciliation.json`
- `monetary-policy-comparison.json`
- `rfm-monetary-impact.json`
- `order-special-cases.json`
- `monetary-audit-verdict.json`

Veredicto final: la politica monetaria queda identificada con excepciones de
atribucion de descuentos. No debe integrarse aun en T08, T09 ni RFM hasta
combinarla con online scope y revisar las excepciones.
