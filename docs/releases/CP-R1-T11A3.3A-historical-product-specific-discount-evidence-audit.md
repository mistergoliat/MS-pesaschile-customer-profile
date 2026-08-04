# CP-R1-T11A3.3A - Historical Product Specific Discount Evidence Audit

## 1. Objetivo

Auditar descuentos historicos especificos de producto desde `ps_specific_price` como nivel separado de los descuentos globales de orden. La auditoria evalua la logica de Catalog Service usando `effectiveAt = ps_orders.date_add`, sin modificar T08, T09, RFM, Catalog Service, endpoints, persistencia, scheduler ni contratos runtime.

Scope ejecutado:

- `referenceTime`: `2026-08-03T00:00:00.000Z`
- `calculationVersion`: `rfm-population-v1`
- `scope`: `operational_365d`
- `sellerServiceProductIds`: `444`
- `logisticsProductIds`: no configurado

Veredicto live:

```text
BLOCKED_BY_CUSTOMER_GROUP_HISTORY
```

## 2. Logica Catalog Entregada

Catalog Service resuelve precio actual con:

- `COALESCE(product_shop.price, product.price, 0)`
- `COALESCE(product_attribute_shop.price, product_attribute.price, 0)`
- filtro productivo `p.active = 1`
- `ps_specific_price` filtrado por contexto y ventana vigente actual
- seleccion en memoria por score

Score real encontrado:

```text
id_product_attribute exact
id_shop exact
id_currency exact
id_country exact
id_group exact
id_customer exact
from_quantity
priority
-id_specific_price
```

La query productiva de Catalog no define `ORDER BY`; la determinacion ocurre en `selectSpecificPrice`.

## 3. Adaptacion Por OrderDate

La auditoria reemplaza la vigencia actual por:

```text
effectiveAt = ps_orders.date_add
```

No usa funciones de tiempo actual para seleccionar reglas. Esto permite probar si el `specific_price` era aplicable al momento de compra.

## 4. Contexto Historico

Datos disponibles por linea:

- `orderDate`
- `shopId`
- `currencyId`
- `customerId`
- `countryId`
- `quantity`
- `productId`
- `productAttributeId`
- `tax_rate` y precios tax incl/excl de `ps_order_detail`

Dato faltante critico:

- `id_group` historico del cliente al momento de la orden

Resultado live:

- `allValidOrders`: `19594`
- `candidateOnlineOrders`: `18153`
- `excludedTechnicalOrders`: `1440`
- `totalLineCount`: `40920`
- `commercialLineCount`: `39480`
- `CONTEXT_PARTIAL`: `40920`
- `customerGroupHistoricalAvailableLineCount`: `0`

## 5. Precio Base

La auditoria lee precio base desde tablas actuales de producto y combinacion, pero no lo adopta como autoridad historica porque no existe snapshot historico del precio base.

Resultado live:

- `BASE_PRICE_CURRENT_STATE_ONLY`: `40238`
- `BASE_PRICE_UNAVAILABLE`: `682`
- `currentlyInactiveProductLineCount`: `1051`
- `commercialBaseValueTaxIncl`: `3285018386.000000`

## 6. Combinacion

La combinacion se incorpora igual que Catalog:

```text
catalogBaseTaxExcluded = max(productPrice + combinationImpact, 0)
```

Si `specific_price.price >= 0`, se usa:

```text
effectiveTaxExcluded = specific_price.price + combinationImpact
```

Resultado live:

- `linesWithCombinationSpecificRule`: `5565`

## 7. Specific Price

La auditoria carga candidatos `ps_specific_price` read-only por productos en scope y filtra en dominio por:

- `id_cart = 0`
- atributo, shop, moneda, pais, grupo, cliente
- `from_quantity <= product_quantity`
- `from/to` compatibles con `ps_orders.date_add`

Resultado live:

- `sourceCandidateCount`: `6666`
- `linesWithSpecificPriceCandidate`: `35790`
- `linesWithSelectedSpecificPrice`: `17761`
- `NO_SPECIFIC_PRICE`: `21719`
- `SPECIFIC_PRICE_SELECTION_PARTIAL`: `17761`
- `ambiguousLineCount`: `0`

## 8. Prioridad

La prioridad replica Catalog actual. La auditoria marca empates comerciales como ambiguos si solo queda desempate tecnico por `id_specific_price`.

No hubo ambiguedad live:

- `ambiguousLineCount`: `0`

Riesgo vigente:

- la prioridad real de Catalog ubica `id_customer` despues de atributo, shop, currency, country y group; esto puede no coincidir con una politica comercial esperada.

## 9. Descuentos Porcentuales

Formula:

```text
effectiveTaxExcluded = effectiveTaxExcluded * (1 - reduction)
```

Resultado live:

- `lineCount`: `17250`
- `orderCount`: `10845`
- `grossBaseValueTaxIncl`: `1202246612.000000`
- `reconstructedDiscountValueTaxIncl`: `368744942.000000`
- `effectiveValueTaxIncl`: `833501670.000000`
- `orderDetailMatchRate`: `0.797449`

## 10. Descuentos Fijos

Formula:

```text
reductionTaxExcluded =
  reduction_tax = 1 ? reduction / taxMultiplier : reduction
```

Resultado live:

- `amount lineCount`: `110`
- `amount reconstructedDiscountValueTaxIncl`: `834270.000000`
- `price_override lineCount`: `398`
- `price_override reconstructedDiscountValueTaxIncl`: `2433369.000000`
- `price_override_amount lineCount`: `3`

## 11. IVA

La auditoria no usa una tasa global fija. Usa `ps_order_detail.tax_rate` cuando existe y valida contra los precios unitarios tax excl/incl.

Resultado live:

- `TAX_RATE_CONFIRMED`: `36777`
- `TAX_RATE_INCONSISTENT`: `4143`
- `TAX_RATE_UNAVAILABLE`: `0`
- tasas observadas: `0.000000`, `0.190000`

La inconsistencia indica que existe evidencia tributaria que requiere revision antes de tratar la reconstruccion como autoridad completa.

## 12. Comparacion Con Order Detail

Clasificacion live sobre lineas comerciales:

- `SPECIFIC_PRICE_APPLIED_AND_ORDER_DETAIL_MATCHES`: `9681`
- `NO_SPECIFIC_PRICE_AND_ORDER_DETAIL_MATCHES_BASE`: `7663`
- `ROUNDING_ONLY`: `6403`
- `ORDER_DETAIL_HIGHER_THAN_RECONSTRUCTED`: `3080`
- `ORDER_DETAIL_LOWER_THAN_RECONSTRUCTED`: `897`
- `ORDER_DETAIL_MATCHES_BASE_NOT_DISCOUNTED`: `28`
- `HISTORICAL_PRICE_NOT_PROVABLE`: `11728`

Match rate global:

```text
0.601494
```

## 13. Comparacion Con total_products_wt

Tres subtotales comparados contra `ps_orders.total_products_wt`:

Persistido desde `ps_order_detail`:

- exact: `17495`
- rounding: `151`
- material mismatch: `1`
- unresolved: `1947`
- total delta: `-90273578.024700`

Base reconstruida:

- exact: `3548`
- material mismatch: `14098`
- unresolved: `1947`
- total delta: `369352717.830000`

Efectivo reconstruido:

- exact: `9652`
- rounding: `345`
- material mismatch: `7650`
- unresolved: `1947`
- total delta: `-2660062.170000`

## 14. Separacion Descuento Especifico/Global

La auditoria separa:

- `specificProductDiscount`: descuento incorporado al precio individual del producto
- `orderLevelDiscount`: descuento adicional de orden/cart rule

Resultado live:

- `reconstructedSpecificProductDiscountTaxIncl`: `372012789.000000`
- `orderLevelDiscountTaxIncl`: `47181667.000000`
- `orderLevelDiscountTaxExcl`: `39648512.000000`
- `productCartRuleTaxIncl`: `46924846.260000`
- `freeShippingCartRuleTaxIncl`: `0.000000`
- `mixedCartRuleTaxIncl`: `306159.000000`

No se resta el descuento global dentro del precio especifico reconstruido.

## 15. Match Rates

Metricas principales:

- `orderDetailMatchRate`: `0.601494`
- `contextCompleteRate`: `0.000000`
- porcentaje, `orderDetailMatchRate`: `0.797449`
- monto fijo, `orderDetailMatchRate`: `0.000000`
- price override, `orderDetailMatchRate`: `0.000000`

Lectura: hay evidencia fuerte de que `order_detail` ya refleja muchos descuentos porcentuales, pero no basta para validar todos los tipos ni convertir la reconstruccion en autoridad productiva.

## 16. Gaps

Gaps que bloquean adopcion:

- grupo historico de cliente no disponible
- precio base historico no versionado
- `BASE_PRICE_UNAVAILABLE` en `682` lineas
- `TAX_RATE_INCONSISTENT` en `4143` lineas
- `HISTORICAL_PRICE_NOT_PROVABLE` en `11728` lineas comerciales

Trabajo que fue sobrearquitectura para esta etapa:

- persistencia SQL previa a definir consumidor
- endpoint antes de validar autoridad
- scheduler antes de definir frecuencia
- snapshots historicos como obligatorios sin consumidor confirmado
- asumir consumo runtime por CRM/Sales Agent

## 17. Autoridad Recomendada

Autoridad recomendada por ahora:

```text
ORDER_DETAIL_PERSISTED remains the operational monetary authority.
```

La reconstruccion de `ps_specific_price` queda como diagnostico historico, no como reemplazo.

Razon:

- `order_detail` reconcilia mejor contra `total_products_wt` que la base reconstruida
- el contexto de grupo historico esta incompleto
- el precio base historico no es recuperable desde tablas actuales

## 18. Impacto Esperado En Monetary

No integrar todavia en RFM Monetary.

Impacto conceptual:

- el descuento especifico explica una diferencia potencial grande entre precio base y precio efectivo: `372012789.000000` CLP tax incl reconstruidos
- este descuento no debe mezclarse con los `47181667.000000` CLP de descuento global de orden
- Monetary debe seguir basandose en `order_detail` persistido mas asignacion separada de descuentos de orden, hasta resolver gaps historicos

## 19. Tests

Se agrego cobertura para:

- precio base y combinacion
- producto inactivo
- base no disponible
- porcentaje
- monto tax incl
- monto tax excl
- price override
- combinacion
- shop, currency, country, group, customer y quantity via prioridad
- fecha vigente, futura y expirada
- multiples candidatos y desempate deterministico
- IVA confirmado, derivado, cero y no disponible
- comparacion exacta, base-only, rounding y no recuperable
- separacion de descuento especifico y descuento global
- seller service excluido
- guardas read-only y anti atajos de precio actual

## 20. Veredicto

```text
BLOCKED_BY_CUSTOMER_GROUP_HISTORY
```

La capacidad analitica existe y calcula evidencia de descuentos especificos historicos, pero la utilidad operativa queda limitada a auditoria/diagnostico. No habilita persistencia, endpoint, scheduler ni adopcion en RFM hasta definir:

- fuente o politica para grupo historico
- politica para precio base historico no versionado
- manejo de lineas tributarias inconsistentes
- consumidor primario del resultado
- frecuencia y necesidad real de snapshots
