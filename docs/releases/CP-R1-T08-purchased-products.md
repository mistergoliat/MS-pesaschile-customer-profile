# CP-R1-T08 Purchased Products

## Objetivo

Agregar una capacidad read-only para consultar los productos historicos comprados por un cliente, agregados por producto y variante:

```text
GET /v1/customers/{masterCustomerId}/purchased-products
```

El endpoint es separado de `/profile` y `/commercial-summary`; no modifica ninguno de esos contratos.

## Autoridad Historica

La fuente de verdad para nombre, referencia, producto, variante, cantidad y gasto de linea es `ps_order_detail`.

No se reemplaza `product_name` ni `product_reference` por datos actuales del catalogo. Tampoco se usa precio actual, stock, imagenes ni URL publica.

## Compra Valida

Solo se incluyen lineas pertenecientes a ordenes con:

```sql
ps_orders.valid = 1
```

No se usa `current_state = 2`, `ps_order_state.paid`, nombres de estados, keywords ni `ps_order_history`.

## Agrupacion

La unidad de agregacion es:

- `product_id`
- `product_attribute_id`

Una variante distinta produce un elemento distinto. `product_attribute_id = 0` representa un producto sin variante.

## Nombre Y Referencia

Dentro de una agrupacion puede haber cambios historicos de nombre o referencia. El endpoint devuelve el valor de la linea historica mas reciente de esa agrupacion, resuelto de forma deterministica por:

1. `o.date_add DESC`
2. `o.id_order DESC`
3. `od.id_order_detail DESC`

## Cantidades Y Montos

- `totalQuantityPurchased`: suma bruta historica de `product_quantity`.
- `orderCount`: cantidad de ordenes distintas donde aparece el producto/variante.
- `totalSpentTaxIncl`: suma bruta historica de `total_price_tax_incl`, como string con seis decimales.

Los montos reutilizan las utilidades decimales seguras de CP-R1-T07. No se usa `Number`, `parseFloat` ni `Math.round` para dinero.

No se calcula gasto neto.

## Productos Eliminados

El historial se conserva aunque el producto haya sido eliminado o no este disponible en el catalogo actual.

`catalogStatus` se determina con `LEFT JOIN ps_product`:

- `linked`: existe `ps_product.id_product`.
- `deleted_or_unavailable`: no existe actualmente en `ps_product`.

## Paginacion

Query params permitidos:

- `limit`, default `20`, minimo `1`, maximo `100`.
- `offset`, default `0`, minimo `0`.

El reader solicita `limit + 1` filas para calcular `hasMore` sin hacer `COUNT` total y devuelve solo las primeras `limit`.

Se rechazan parametros desconocidos, duplicados, vacios, negativos y decimales.

## Ordenamiento

El unico ordenamiento es:

```text
lastPurchasedAt DESC
productId DESC
productAttributeId DESC
```

No hay sort dinamico.

## Errores

- Master inexistente: `customer_not_found` con HTTP 404.
- Master sin link PrestaShop: `customer_not_linked` con HTTP 404.
- Cliente vinculado sin compras validas: `available` con `products: []`.
- Timeout PrestaShop: `degraded / prestashop_timeout` con HTTP 503.
- Indisponibilidad PrestaShop: `degraded / prestashop_unavailable` con HTTP 503.
- Error desconocido o dato contractual invalido: se propaga y la ruta responde 500 saneado.

## Observabilidad

Los logs son agregados y saneados: estado, bucket de filas devueltas (`zero`, `one`, `multiple`), `hasMore`, duracion, razon degradada y outcome.

No se loguean IDs de cliente, IDs de producto, nombres, referencias, montos, fechas, cantidades, SQL ni mensajes crudos.

## Limitaciones

- No incluye categorias.
- No incluye marcas.
- No incluye imagenes.
- No incluye precio actual.
- No incluye stock.
- No incluye URL publica.
- No incluye recomendaciones.
- No incluye afinidad.
- No incluye Product Relationship Engine.
- No incluye clustering.
- No incluye gasto neto.
- No incluye reembolsos externos.
- No modifica `/profile`.
- No modifica `/commercial-summary`.
