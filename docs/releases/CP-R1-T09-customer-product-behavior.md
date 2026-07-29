# CP-R1-T09 Customer Product Behavior

## Objetivo

Agregar una capacidad read-only para transformar el historial de productos comprados por un cliente en indicadores relativos y explicables de comportamiento:

```text
GET /v1/customers/{masterCustomerId}/purchase-behavior
```

T07 responde cuanto y cuando compra. T08 responde que productos y variantes compro. T09 responde como se distribuye, concentra y repite ese consumo.

El endpoint es separado de `/profile`, `/commercial-summary` y `/purchased-products`; no modifica esos contratos.

## Autoridad Historica

La fuente de verdad es exclusivamente el historial de compra:

```sql
ps_orders
INNER JOIN ps_order_detail
```

Solo se incluyen lineas de ordenes con `ps_orders.valid = 1`. No se usa `current_state = 2`, `ps_order_state.paid`, nombres de estados, `ps_order_history`, categorias, familias comerciales ni catalogo actual para sustituir datos historicos.

## Unidades

La unidad primaria es `product_id + product_attribute_id`, que conserva la fidelidad historica de variantes compradas.

El rollup secundario es `product_id`, que permite interpretar compras de distintas variantes como parte del mismo producto base. Ambos se calculan siempre; no hay query param para elegir granularidad.

## Nombre Y Referencia

Para variantes, `productName` y `productReference` provienen de la linea historica mas reciente de la agrupacion `product_id + product_attribute_id`.

Para productos base, `latestObservedProductName` y `latestObservedProductReference` provienen de la linea historica mas reciente del `product_id`, independientemente de la variante.

El desempate deterministico es:

1. `o.date_add DESC`
2. `o.id_order DESC`
3. `od.id_order_detail DESC`

## Repeticion

Una variante es repetida cuando aparece en al menos dos ordenes validas distintas: `COUNT(DISTINCT id_order) >= 2`.

Un producto base es repetido cuando el `product_id` aparece en al menos dos ordenes validas distintas, aunque sean variantes diferentes.

Comprar varias unidades en una sola orden no constituye repeticion.

## Shares

Las participaciones se publican como strings decimales con seis decimales:

- `spendShare`: gasto del elemento / gasto total valido de lineas.
- `orderShare`: ordenes distintas del elemento / ordenes validas del cliente.
- `quantityShare`: unidades del elemento / unidades totales validas.
- `repeatProductRate`: productos repetidos / productos distintos.
- `repeatVariantRate`: variantes repetidas / variantes distintas.
- `repeatedVariantSpendShare`: gasto de variantes repetidas / gasto total valido de lineas.

Con denominador cero se devuelve `"0.000000"`.

## Concentracion Y Diversidad

La concentracion se calcula por separado para productos y variantes, usando todo el historial valido:

- `top1Share`: participacion de gasto del elemento con mayor gasto.
- `top3Share`: suma de participaciones de gasto de los tres elementos con mayor gasto.
- `hhi`: `SUM(spendShare_i ^ 2)`.
- `effectiveDiversity`: `1 / hhi`.

Sin compras, todos los valores son `"0.000000"`. Con gasto positivo, `hhi` queda entre 0 y 1 y `effectiveDiversity` es al menos 1.

No se crean etiquetas `low` / `medium` / `high`, umbrales arbitrarios ni `importanceScore`.

## Universo Completo Versus Tops

El calculo considera el 100% del historial valido del cliente:

- ordenes validas;
- unidades compradas;
- gasto total de lineas;
- productos distintos;
- variantes distintas;
- repeticion;
- concentracion;
- diversidad.

Los query params `topProducts` y `topVariants` limitan solo la presentacion. Ambos tienen default `10`, minimo `1` y maximo `10`.

No se aceptan `limit`, `offset`, `sort`, categorias, marcas, fechas, producto, email, `prestashopCustomerId`, parametros desconocidos, duplicados, vacios, negativos, cero, decimales, `NaN` ni `Infinity`.

## Ordenamiento

`topProducts` y `topVariants` se ordenan deterministamente por:

```text
totalSpentTaxIncl DESC
orderCount DESC
totalQuantityPurchased DESC
lastPurchasedAt DESC
productId ASC
productAttributeId ASC
```

`productAttributeId` aplica solo a variantes.

## Dinero Y Decimales

Los montos y proporciones se calculan con aritmetica decimal segura basada en strings y `BigInt`, con salida de seis decimales y redondeo half-up.

No se usa `Number`, `parseFloat` ni `Math.round` para dinero, shares, HHI o diversidad efectiva.

## Recencia

`calculatedAt` usa el `Clock` inyectado. `daysSinceLastPurchase` son dias completos entre `calculatedAt` y `lastPurchasedAt`, en UTC y con minimo 0.

Una fecha futura o fechas invertidas son datos contractualmente invalidos y se propagan como error saneado en HTTP.

## Errores

- Master inexistente: `customer_not_found` con HTTP 404.
- Master sin link PrestaShop: `customer_not_linked` con HTTP 404.
- Cliente vinculado sin compras validas: `available` con comportamiento vacio.
- Timeout PrestaShop: `degraded / prestashop_timeout` con HTTP 503.
- Indisponibilidad PrestaShop: `degraded / prestashop_unavailable` con HTTP 503.
- Error desconocido o dato contractual invalido: se propaga y la ruta responde 500 saneado.

No se devuelven resultados parciales falsos.

## Observabilidad

Los logs son agregados y saneados: estado, bucket de productos distintos (`zero`, `one`, `multiple`), presencia de productos repetidos, disponibilidad de concentracion, duracion, razon degradada y outcome.

No se loguean IDs de cliente, IDs de producto, nombres, referencias, montos, shares, HHI, fechas, cantidades, SQL ni mensajes crudos.

## Limitaciones

- No incluye RFM.
- No incluye clustering.
- No incluye comunidades.
- No incluye recomendaciones.
- No incluye categorias.
- No incluye familias comerciales.
- No incluye lifecycle stage.
- No incluye score compuesto.
- No clasifica concentracion en `low` / `medium` / `high`.
- No determina ciclos esperados de recompra.
- No incluye taxonomia comercial.
- No usa `categoryId` como feature principal.
- No integra Product Relationship Engine.
- No incluye `communityId` ni `clusterId`.
- No incluye campanas.
- No incluye scoring predictivo.
- No hace writes.
- No agrega migraciones.
- No agrega backfill.
- No usa cache ni snapshot.
- No modifica `/profile`.
- No modifica T07.
- No modifica T08.
