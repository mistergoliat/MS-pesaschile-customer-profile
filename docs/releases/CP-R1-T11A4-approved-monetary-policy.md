# CP-R1-T11A4 Approved RFM Monetary Policy

Fecha: 2026-08-05.

Veredicto: **APPROVED_WITH_CHANGES_IMPLEMENTED**.

## Origen

Auditoria comparativa (2026-08-05) de la implementacion existente de Monetary
contra un modelo analitico construido con pruebas directas de solo lectura
sobre `pesas_productiva`, usando el mismo `snapshot_at` que el runtime. La
auditoria confirmo que la formula base (`SUM(total_paid_tax_incl)`, ventana,
identidad, IVA, no uso de `total_paid_real`, no reconstruccion desde
`ps_order_detail`, no doble resta de devoluciones) ya coincidia exactamente
con el modelo, verificado en vivo, no solo por lectura de codigo. Encontro
tres brechas puntuales, medidas en vivo contra la misma base, y este release
las cierra.

## Que cambia

1. **Ordenes neutralizadas excluidas.** `o.total_paid_tax_incl > 0` se agrego
   al universo elegible. Antes, 4 ordenes `valid = 1` con
   `total_paid_tax_incl = 0` (2 `free_order`, 1 `webpay` neutralizada
   post-venta con `total_paid_real` historico, 1 `linkify`) aparecian como
   clientes fantasma con `frequency = 1` y `monetary = 0`.
2. **Cuatro cuentas operacionales excluidas explicitamente.** Lista
   versionada (`operational-account-exclusion-v1`), no heuristica:

   ```text
   85980  Ventas Pesas Chile
   39617  Nicolas Solar Paez
   90890  Evento Wodstock
   86421  Gimnasio Nuevo Amanecer SPA
   ```

   Medido en la ventana `[2025-08-05, 2026-08-05)`: `85980` solo aporta 2.023
   ordenes / $92.701.129,27; `39617` aporta 57 ordenes / $73.697.300,00.
   Juntas: 2.080 ordenes (10,6% de la ventana) y $166.398.429,27 (5,4% del
   Monetary agregado). `90890` y `86421` no tuvieron actividad en esta
   ventana especifica, pero quedan configuradas para ventanas futuras y para
   la capa historica.
3. **Lineas seller-service excluidas del Monetary de orden.** Se reutiliza la
   clasificacion ya validada en `order-monetary-composition.ts` /
   `analytical-order.ts` (auditorias T11A3.2/T11A3.3): producto confirmado
   `444` (referencia `SVPC`). Impacto medido en la ventana actual: 1.394
   lineas en 1.393 ordenes, $1.414,00 en total — material para la
   trazabilidad, irrelevante para el agregado (0,00005% del Monetary).

## Formula final

```text
eligible_order_monetary_tax_incl =
  GREATEST(total_paid_tax_incl - seller_service_tax_incl_neto, 0)

seller_service_tax_incl_neto =
  SUM(ps_order_detail.total_price_tax_incl)
  para lineas con product_id en la politica confirmada de seller service

customer_monetary = SUM(eligible_order_monetary_tax_incl)
  sobre ordenes con:
    valid = 1
    AND total_paid_tax_incl > 0
    AND id_customer > 0
    AND id_customer NOT IN (85980, 39617, 90890, 86421)
    AND date_add IN [windowStart, windowEnd)
```

`total_price_tax_incl` se usa tal cual persistido (no se recalcula desde
`unit_price_tax_incl x product_quantity`; ver el caso conocido de
`id_order_detail = 87706` donde la cantidad se modifico post-venta sin
recalcular el total historico de la linea).

## Decision sobre el descuento global asignado a seller-service

Se investigo si un descuento global de orden (cart rule) podria estar
recayendo especificamente sobre una linea seller-service, lo que haria
incorrecto restar el valor bruto sin netear. Verificado en vivo sobre la
ventana actual:

```text
Lineas seller-service con reduction_amount/reduction_percent propios: 0
Cart rules con reduction_product apuntando a un producto seller-service: 0
Cart rules con reduction_product > 0 de cualquier tipo, en toda la ventana: 0
```

El mecanismo de descuento dirigido a un producto especifico (`reduction_product`)
no se usa en absoluto en los datos actuales. Por construccion, el modelo de
composicion ya validado (`order-monetary-composition.ts`) tampoco asigna
descuentos de orden a lineas seller-service (quedan fuera de la base de
prorrateo). Por lo tanto restar el valor bruto de la linea es exacto hoy:
`seller_service_tax_incl_neto = seller_service_tax_incl_bruto`.

Este punto no se resuelve por diseno permanente sino por medicion: si en el
futuro aparece un `reduction_product` apuntando a un producto seller-service,
el diagnostico `sellerService.productTargetedDiscountOrderCount` (manifest)
dejara de ser 0 y la resta bruta dejara de ser exacta para esas ordenes
especificas. Reevaluar con `npm run audit:rfm-order-monetary` si eso ocurre.

## Decisiones que se mantienen sin cambio

```text
Shipping incluido en Monetary (implicito en total_paid_tax_incl)
IVA incluido
Wrapping incluido cuando corresponde
Descuentos generales y de envio reflejados en total_paid_tax_incl
total_paid_real no es fuente canonica
No reconstruir la orden completa desde ps_order_detail
No consultar precios actuales del catalogo
No restar de nuevo ps_order_return, ps_order_slip ni refunds de linea
No excluir clientes reales por ser outliers (Francisco Yanez, id_customer =
  103237, verificado en vivo: permanece, 15 ordenes, ~$3,83M en la ventana)
No aplicar heuristica automatica de cuentas operacionales
No adoptar integramente netEligibleProductValueTaxIncl como Monetary
  productivo (ese modelo excluye shipping; ver seccion siguiente)
```

## Modelo alternativo de productos elegibles: sigue no productivo

`order-monetary-composition.ts` y `analytical-order.ts` implementan un
Monetary distinto y mas granular (`netEligibleProductValueTaxIncl`) que
excluye shipping ademas de seller-service, construido en T11A3.2/T11A3.2A/
T11A3.3 sobre la misma base. Esta tarea **no lo adopta**: el brief de esta
auditoria cierra explicitamente que shipping se incluye. Ambos modelos
coexisten a proposito:

- `mysql-rfm-population-reader.ts` (productivo): `total_paid_tax_incl` menos
  seller-service, shipping incluido.
- `order-monetary-composition.ts` / `analytical-order.ts` (auditoria/
  candidato, no importado por el reader productivo ni por
  `create-rfm-snapshot.ts`): valor neto de producto elegible, shipping
  excluido.

Si en el futuro se decide reabrir la inclusion de shipping, esta es la
implementacion candidata a evaluar — no se debe reinventar una tercera.

## Aplicacion uniforme

Los tres filtros nuevos (`total_paid_tax_incl > 0`, exclusion de cuentas,
neteo de seller-service) se aplican de forma identica en:

- CTE `eligible_orders` (poblacion, Frequency, Monetary, Recency);
- diagnosticos de moneda, shops, cross-shop y seller-service (misma CTE);
- diagnostico de refunds (misma CTE, join adicional solo sobre
  `ps_order_detail` para sumar campos de linea, sin multiplicar totales de
  cabecera).

Se mantienen deliberadamente **fuera** de los tres filtros nuevos (por ser
diagnosticos de "que se excluyo", no del universo final):

- el conteo de ordenes en cero (`excludedZeroValueOrderCount`, medido antes
  del filtro de monto);
- el conteo de cuentas operacionales excluidas (medido antes de la propia
  exclusion, para que su impacto sea auditable);
- el guardrail de calidad de datos (`unusableCustomerOrderCount`,
  `missingPrestashopCustomerOrderCount`), que debe abortar el snapshot sin
  importar si esa orden habria sido excluida despues por otra razon.

## Manifest

Campos nuevos o modificados en `RfmSnapshotManifest`:

```text
monetaryDefinition
shippingIncluded = true
sellerServiceExcluded = true
sellerServiceExclusionPolicyVersion = seller-service-exclusion-v1
operationalAccountPolicyVersion = operational-account-exclusion-v1
  (reemplaza operationalAccountPolicy = 'none')
excludedOperationalAccountCount
excludedZeroValueOrderCount (reemplaza zeroAmountOrderCount)
ordersWithSellerServiceCount
sellerServiceLineCount
excludedSellerServiceValueTaxIncl
grossOrderValueBeforeSellerServiceExclusion
monetaryAfterSellerServiceExclusion
```

Ninguno de estos campos publica IDs de cliente ni de cuenta — solo conteos y
montos agregados, consistente con la politica ya vigente de no publicar
identidad de cuentas excluidas.

## Versionado

```text
populationPolicyVersion:
  active-365-valid-prestashop-customer-v1 -> ...-v2
monetaryPolicyVersion:
  gross-order-value-tax-incl-v1 -> gross-order-value-tax-incl-minus-seller-service-v2
```

`snapshotKey` cambia automaticamente (se compone de estas versiones), por lo
que un snapshot calculado con la politica anterior nunca colisiona con uno
calculado con esta.

## Validacion en vivo

`RFM_REFERENCE_TIME = 2026-08-05T00:00:00.000Z`, comparando el dry-run del
reader productivo contra una query canonica independiente, solo lectura,
ejecutada directamente contra `pesas_productiva`:

| Metrica | Reader productivo | Query canonica independiente |
|---|---:|---:|
| Clientes elegibles | 14.182 | 14.182 |
| Ordenes elegibles | 17.522 | 17.522 |
| Monetary final | 2.901.342.226,20 | 2.901.342.226,20 |
| Monetary antes de seller-service | 2.901.343.640,20 | 2.901.343.640,20 |

Coinciden exactamente. Controles adicionales confirmados en vivo:

```text
85980, 39617, 90890, 86421 -> ausentes del universo elegible
103237 (Francisco Yanez)   -> presente, 15 ordenes, $3.827.767,00
ordenes elegibles con total_paid_tax_incl <= 0 -> 0
shipping total dentro de ordenes elegibles -> $180.600.585,00 (> 0, no se excluyo)
```

No se escribio nada en `pesas_productiva`. Los scripts usados para esta
validacion fueron temporales y se eliminaron al terminar.

## Riesgos pendientes

- `productTargetedDiscountOrderCount` es un diagnostico, no un guardrail que
  aborte el snapshot: si en el futuro aparece un descuento dirigido a un
  producto seller-service, el Monetary de esas ordenes especificas dejara de
  ser exacto hasta que se revise. Ver seccion "Decision sobre el descuento
  global" arriba.
- Timezone de origen (`ps_orders.date_add`) sigue `UNVERIFIED` (sin cambios
  respecto de `CP-R1-T11A.1A`); no bloquea Monetary.
- `90890` y `86421` no tienen actividad verificable en la ventana actual;
  su exclusion queda configurada pero no fue observable con datos reales en
  esta corrida.
- La fuente sigue siendo un sistema productivo vivo: una recorrida posterior
  con el mismo `referenceTime` puede diferir en un puñado de clientes/ordenes
  por actualizaciones posteriores, ya documentado como riesgo conocido
  (`CP-R1-T11A.1A`), no un defecto de esta implementacion.
