# CP-R1-T11A3.3 Canonical Analytical Order Contract

Fecha: 2026-08-04.

Estado: **AUDIT_ONLY_NO_PRODUCTIVE_QUERY_CHANGE**.

Veredicto principal: **CANONICAL_CONTRACT_REQUIRES_DISCOUNT_EXCEPTION_POLICY**.

Condiciones:

```text
ORDER_DETAIL_IS_HISTORICAL_AUTHORITY
USE_TAX_INCL_AS_PRIMARY
KEEP_TAX_EXCL_AS_AUXILIARY
EXCLUDE_CONFIRMED_TECHNICAL_LINES
ALLOCATE_PRODUCT_DISCOUNT_PROPORTIONALLY
DO_NOT_ALLOCATE_FREE_SHIPPING
SCOPE_ONLINE_REMAINS_CANDIDATE
RFM_READY_FOR_READ_ONLY_ADOPTION
T08_READY_FOR_READ_ONLY_ADOPTION
T09_READY_FOR_READ_ONLY_ADOPTION
```

## 1. Objetivo

Disenar e implementar un contrato canonico read-only de orden analitica para
Customer Profile, compartible por T08, T09 y RFM, sin adoptarlo todavia en
queries productivas.

El contrato representa inclusion/exclusion de orden, identidad, canal, lineas
comerciales y tecnicas, precio historico persistido, descuentos globales,
asignacion proporcional, valor neto analitico, reconciliaciones y versiones de
politica.

## 2. Decisiones Heredadas

T11A3.1 cerro:

```text
COMBINED_POLICY_REQUIRED
valid = 1 no basta para ventas online reales
T08/T09/RFM requieren scope online comun
```

T11A3.2 cerro:

```text
ORDER_DISCOUNT_ATTRIBUTION_PARTIAL
tax-incl es base primaria
tax-excl queda auxiliar
total_paid_tax_incl no representa solo productos
seller service se excluye
```

T11A3.2A cerro:

```text
HYBRID_HISTORICAL_PRICE_POLICY_REQUIRED
ORDER_DETAIL_PERSISTED es autoridad historica para analytics v1
Catalog historico queda como diagnostico/enrichment
no usar precio actual ni IVA fijo como historia
```

## 3. Matriz De Convergencia

| CAPABILITY | CURRENT DOMAIN | CURRENT INPUT | CURRENT OUTPUT | OVERLAP | CONFLICT | CANONICAL DECISION | CHANGE REQUIRED |
|---|---|---|---|---|---|---|---|
| Clasificacion de orden/canal | `online-sales-scope.ts` | `SalesChannelOrder`, policy shop/module/seller/generic | `online/store/ambiguous/technical` | Define scope CP | Reason unico y mezclado con identidad | Canal canonico + reasons multiples | Nuevo contrato puro |
| Identidad | Parcial en online scope | `prestashopCustomerId` | generic/store/technical por policy | Exclusion de cliente | Identidad mezclada con canal | `AnalyticalIdentityClassification` | Separar identidad |
| Lineas | `order-monetary-composition.ts` | IDs tecnicos configurados | eligible/seller/logistics/service/unresolved | Reutilizable | Nombres RFM-specific | `AnalyticalLineClassification` | Mapper canonico |
| Decimal | Monetary + duplicados en scripts | strings escala 6 | money strings | Necesario | duplicacion y algunos scripts usan `Number` | bigint interno del contrato | Helper canonico |
| Precio historico | `historical-catalog-price-reconciliation.ts` | `order_detail` + Catalog candidates | diagnostico Catalog | Confirma autoridad | Catalog podria confundirse con valor | `ORDER_DETAIL_PERSISTED` | Catalog solo diagnostico |
| Descuentos | Monetary | cart rules + totals | categorias y attribution | Base para net value | mixed rule antes podia distribuirse completa | mixed solo distribuye monto confirmado | Exception policy |
| Asignacion | Monetary | eligible weights | largest remainder | Valida | vive bajo RFM | compartir en orden canonica | Builder puro |
| Reconciliacion | Monetary + Historical | deltas productos/pago/catalog | statuses locales | Necesaria | buckets/status dispersos | reconciliacion canonica | Nuevo status comun |
| Versions | dispersas | constantes | outputs audit | Necesario | no hay bloque por orden | `AnalyticalOrderPolicyVersions` | obligatorio |
| T08 productivo | reader T08 | valid orders + lines | SUM line tax-incl | consumidor futuro | sin scope/descuento/tecnicos | no modificar | adopcion futura |
| T09 productivo | reader T09 | valid orders + lines | spend/share | consumidor futuro | sin scope/descuento/tecnicos | no modificar | adopcion futura |
| RFM productivo | population reader | valid orders + `total_paid_tax_incl` | Monetary bruto | consumidor futuro | incluye shipping y tecnicos | no modificar | recalculo futuro |

## 4. Contrato De Orden

Implementado en:

```text
src/domain/customer-orders/analytical-order.ts
```

Campos principales:

```text
orderId
prestashopCustomerId
orderDate
salesChannel
identity
currencyId
shopId
inclusionStatus
exclusionReasons
lines
discounts
grossEligibleProductValueTaxIncl / TaxExcl
productApplicableOrderDiscountTaxIncl / TaxExcl
shippingDiscountTaxIncl / TaxExcl
unresolvedDiscountTaxIncl / TaxExcl
netEligibleProductValueTaxIncl / TaxExcl
excludedTechnicalValueTaxIncl / TaxExcl
shippingValueTaxIncl / TaxExcl
wrappingValueTaxIncl / TaxExcl
reconciliation
policyVersions
```

El valor monetario analitico futuro recomendado sigue siendo:

```text
customerNetEligibleProductPurchaseValueTaxIncl
```

## 5. Contrato De Linea

Campos principales:

```text
orderDetailId
productId
productAttributeId
quantity
productActive
classification
inclusionStatus
exclusionReasons
historicalPriceSource = ORDER_DETAIL_PERSISTED
historicalCatalogDiagnostic
unitValueTaxIncl / TaxExcl
grossLineValueTaxIncl / TaxExcl
allocatedOrderDiscountTaxIncl / TaxExcl
netLineValueTaxIncl / TaxExcl
reconciliationStatus
```

Regla cerrada:

```text
grossLineValueTaxIncl = ps_order_detail.total_price_tax_incl
grossLineValueTaxExcl = ps_order_detail.total_price_tax_excl
```

No se vuelve a aplicar `reduction_percent`, `reduction_amount` ni IVA manual.

## 6. Scope Online

El contrato modela:

```text
ONLINE_CANDIDATE
STORE_CONFIRMED
POS_CONFIRMED
TECHNICAL
AMBIGUOUS
```

La politica actual sigue siendo candidata:

```text
prestashop-online-orders-candidate-v1
```

No se convierten senales no confirmadas en cambios productivos. En la corrida
live se configuraron seller service y generic/technical inference local; no se
confirmaron store shops, store modules ni POS modules.

## 7. Identidad

Identidades:

```text
INDIVIDUAL_CUSTOMER_CANDIDATE
GENERIC_CUSTOMER
TECHNICAL_ACCOUNT
UNRESOLVED
```

Regla:

```text
GENERIC_CUSTOMER / TECHNICAL_ACCOUNT -> orden excluida del analisis por cliente
```

No se crea `masterCustomerId` ni se intenta resolver identidad omnicanal.

## 8. Lineas Tecnicas

Clasificaciones:

```text
COMMERCIAL_PRODUCT
COMMERCIAL_SERVICE
SELLER_SERVICE
LOGISTICS_ARTIFACT
TECHNICAL_LINE
UNRESOLVED
```

Reglas:

```text
SELLER_SERVICE -> excluir siempre
LOGISTICS_ARTIFACT -> excluir solo con ID confirmado
COMMERCIAL_PRODUCT / COMMERCIAL_SERVICE -> incluir
UNRESOLVED -> marcar explicitamente, no excluir silenciosamente
```

La corrida live observo:

```text
totalLineCount = 40.920
eligibleCommercialLineCount = 39.480
sellerServiceLineCount = 1.440
logisticsArtifactLineCount = 0
unresolvedLineCount = 0
inactiveProductLineCount = 1.048
```

## 9. Autoridad Historica

La autoridad del precio historico en el contrato es:

```text
ORDER_DETAIL_PERSISTED
```

Fuentes:

```text
ps_order_detail.unit_price_tax_incl
ps_order_detail.unit_price_tax_excl
ps_order_detail.total_price_tax_incl
ps_order_detail.total_price_tax_excl
```

Catalog historico queda disponible como `HistoricalCatalogDiagnostic`, pero no
modifica `unitValue`, `grossLineValue` ni `netLineValue`.

## 10. Descuentos

Descuentos soportados:

```text
PRODUCT_DISCOUNT
FREE_SHIPPING
MIXED_PRODUCT_AND_SHIPPING
GIFT_PRODUCT
UNKNOWN
```

Estados:

```text
CONFIRMED
PARTIAL
UNRESOLVED
```

Reglas:

- `PRODUCT_DISCOUNT` se distribuye entre lineas elegibles.
- `FREE_SHIPPING` no se distribuye entre productos.
- `MIXED_PRODUCT_AND_SHIPPING` solo distribuye monto de producto confirmado.
- `UNKNOWN` y `GIFT_PRODUCT` quedan unresolved.

Resultado live:

```text
discountCount = 3.328
PRODUCT_DISCOUNT = 3.325
MIXED_PRODUCT_AND_SHIPPING = 3
CONFIRMED = 3.325
PARTIAL = 3
grossDiscountTaxIncl = 47.231.005,260000
productApplicableDiscountTaxIncl = 46.924.846,260000
unresolvedDiscountTaxIncl = 306.159,000000
```

## 11. Asignacion

Metodo:

```text
LARGEST_REMAINDER
```

Base:

```text
eligibleSubtotalTaxIncl = SUM(grossLineValueTaxIncl de lineas incluidas)
```

Resultado live:

```text
productApplicableOrderDiscountTaxIncl = 46.924.846,260000
allocatedOrderDiscountTaxIncl = 46.924.846,260000
excludedLineAllocatedDiscountTaxIncl = 0,000000
negativeNetLineCount = 0
```

La asignacion es deterministica, exacta en suma y no toca lineas excluidas.

## 12. Politica Monetaria

Politica:

```text
primaryTaxBasis = TAX_INCL
auxiliaryTaxBasis = TAX_EXCL
priceAuthority = ORDER_DETAIL_PERSISTED
allocationMethod = LARGEST_REMAINDER
```

Resultado live total de todas las ordenes construidas:

```text
grossEligibleProductValueTaxIncl = 2.915.757.988,145300
productApplicableOrderDiscountTaxIncl = 46.924.846,260000
netEligibleProductValueTaxIncl = 2.868.833.141,885300
netEligibleProductValueTaxExcl = 2.410.782.887,998170
excludedTechnicalValueTaxIncl = 1.460,000000
shippingValueTaxIncl = 189.340.767,000000
```

Para consumo por cliente se debe sumar solo ordenes con
`inclusionStatus = INCLUDED`.

## 13. Reconciliacion

Deltas live:

```text
lineSumVsTotalProductsTaxInclDelta = 93.779,975300
lineSumVsTotalProductsTaxExclDelta = 78.818,133400
analyticalNetVsExpectedProductNetTaxInclDelta = 0,000000
totalPaidTaxInclDelta = 612,000000
totalPaidTaxExclDelta = 176,000000
```

Estados:

```text
RECONCILED = 14.247
ROUNDING_ONLY = 5.174
PARTIAL = 173
UNRESOLVED = 0
```

Buckets de `totalPaidTaxInclDelta`:

```text
0 = 18.849
<=1 CLP = 664
2-10 CLP = 81
```

No se exige que `netEligibleProductValueTaxIncl = total_paid_tax_incl` porque
`total_paid_tax_incl` contiene shipping y otros componentes.

## 14. Versionado

Versiones obligatorias:

```text
analyticalOrderContractVersion = analytical-order-candidate-v1
salesChannelPolicyVersion = prestashop-online-orders-candidate-v1
identityPolicyVersion = prestashop-customer-identity-candidate-v1
lineEligibilityPolicyVersion = eligible-commercial-lines-candidate-v1
monetaryPolicyVersion = eligible-product-net-value-tax-incl-candidate-v1
discountAllocationPolicyVersion = proportional-largest-remainder-candidate-v1
reconciliationPolicyVersion = prestashop-order-reconciliation-candidate-v1
```

Resultado live:

```text
missingVersionCount = 0
```

## 15. Builder

Funcion pura:

```text
buildAnalyticalOrder(input, policies)
```

Ejecuta:

```text
1. clasificar identidad
2. clasificar lineas
3. clasificar canal
4. normalizar descuentos
5. calcular subtotal elegible
6. asignar descuentos por largest remainder
7. calcular net line/order values
8. reconciliar
9. adjuntar policy versions
```

No lee DB, no escribe DB, no usa `NOW()`, no usa nombres de producto y no usa
IVA fijo.

## 16. Validacion Live

Comando:

```bash
npm run audit:canonical-analytical-order
```

Variables:

```text
RFM_REFERENCE_TIME = 2026-08-03T00:00:00.000Z
RFM_CALCULATION_VERSION = rfm-population-v1
ANALYTICAL_ORDER_SCOPE = operational_365d
RFM_CONFIRMED_SELLER_SERVICE_PRODUCT_IDS = 444
```

Resultado:

```text
orderCount = 19.594
includedOrderCount = 18.153
excludedOrderCount = 1.441
quarantinedOrderCount = 0
ONLINE_CANDIDATE = 18.153
TECHNICAL = 1.441
GENERIC_CUSTOMER exclusions = 4
SELLER_SERVICE_MARKER exclusions = 1.440
```

`includedNetEligibleProductValueTaxIncl`:

```text
1.786.406.660,385300
```

## 17. Comparacion Con Auditorias Previas

Contra T11A3.1:

```text
priorVerdict = COMBINED_POLICY_REQUIRED
currentValidOrderCount = 19.594
candidateOnlineOrderCount = 18.153
excludedSellerServiceMarkedOrders = 1.440
excludedGenericOrTechnicalOrders = 4
```

La diferencia con el included order count de T11A3.1 se explica por alcance
operacional, inferencia local de generic customers y configuracion actual sin
store shops/modules confirmados.

Contra T11A3.2:

```text
priorVerdict = ORDER_DISCOUNT_ATTRIBUTION_PARTIAL
distributedProductDiscountTaxIncl = 46.924.846,260000
netEligibleTaxIncl = 2.868.833.141,885300
unresolvedDiscountTaxIncl = 306.159,000000
```

La diferencia frente a la politica D de T11A3.2 proviene de no distribuir reglas
mixtas sin separacion confirmada de producto vs shipping.

Contra T11A3.2A:

```text
priorVerdict = HYBRID_HISTORICAL_PRICE_POLICY_REQUIRED
historicalPriceAuthority = ORDER_DETAIL_PERSISTED
catalogDiagnosticStatus = NOT_RUN_IN_CANONICAL_BUILDER
```

Catalog historico queda fuera del valor monetario canonico.

## 18. Riesgos

- Scope online sigue candidato.
- Timezone sigue `UNVERIFIED`.
- Tres reglas mixtas requieren politica de excepcion.
- Generic customer inference en esta tarea es diagnostica, no contrato
  productivo cerrado.
- POS/store modules no quedaron confirmados en esta corrida.
- Refunds, margen, costos y conciliacion contable siguen fuera de alcance.
- T08/T09/RFM aun no consumen este contrato.

## 19. Tests

Test nuevo:

```text
tests/unit/customer-orders-analytical-order.test.ts
```

Cobertura:

- online candidate;
- generic customer;
- technical account;
- POS/store/ambiguous;
- multiple exclusion reasons;
- commercial product/service;
- seller service;
- logistics artifact;
- unresolved line;
- inactive product preserved;
- order_detail como autoridad;
- Catalog diagnostic no sobrescribe valor;
- product/free/mixed/unknown discounts;
- multiple rules;
- 100% discount;
- discount greater than eligible subtotal;
- zero eligible subtotal;
- largest remainder deterministic;
- no allocation to excluded lines;
- exact/rounding/partial/unresolved reconciliation;
- shipping fuera de Monetary;
- policy versions obligatorias;
- no PII;
- no DB write, no `NOW()`, no IVA fijo, no product names como autoridad.

## 20. Veredicto

**CANONICAL_CONTRACT_REQUIRES_DISCOUNT_EXCEPTION_POLICY**.

El contrato canonico existe, es deterministico, representa las decisiones
aprobadas y puede ser adoptado read-only por T08/T09/RFM en una tarea posterior.
No se valida como contrato plenamente cerrado porque las reglas mixtas generan
`unresolvedDiscountTaxIncl = 306.159,000000`.

No se modificaron T08, T09, RFM productivo ni Catalog Service.

## 21. Siguiente Tarea

Definir politica de excepcion para `MIXED_PRODUCT_AND_SHIPPING`:

```text
opcion A: mantener unresolved y excluir de Monetary final hasta revision
opcion B: exigir fuente que separe monto producto/shipping
opcion C: aceptar una politica candidata explicita de atribucion parcial
```

Despues de eso, la siguiente adopcion debe ser read-only y por consumidor:
primero RFM recalculado offline, luego T08/T09 batch, sin endpoint ni
persistencia productiva hasta cerrar scope online y timezone.

