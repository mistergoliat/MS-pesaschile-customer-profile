# CP-R1-T11A0 RFM and Segmentation Source Audit

Fecha: 2026-08-03.

Repositorio: `MS-pesaschile-customer-profile`.
Rama: `audit/cp-r1-t11a0-rfm-segmentation-source`.

Esta auditoria es solo tecnica y de datos. No implementa RFM, clustering,
snapshots, endpoints, jobs, migrations, writes, CRM integration ni Catalog
integration.

## Executive Verdict

Veredicto: **NOT_READY**.

PrestaShop esta listo como fuente transaccional para construir un dataset RFM
provisional: `ps_orders`, `ps_customer`, `ps_order_detail`, `ps_currency`,
estados, devoluciones, multishop y columnas monetarias existen y fueron
confirmadas contra la base real. El bloqueo esta en la identidad canonica: la
base CRM real todavia no tiene `master_customer.prestashop_customer_id`, aunque
el repositorio contiene una migracion de diseno para agregarla.

Con ese estado, T11A no puede producir el output requerido por
`masterCustomerId` sin caer de vuelta a `id_customer` de PrestaShop. Ese modo
provisional ya fue usado por T10A para auditar distribuciones, pero no debe
publicarse como identidad canonica.

## Repository State

El servicio es TypeScript/Express, read-oriented, con dos pools MySQL logicos:
CRM (`master_customer`) y PrestaShop (`ps_` configurable por
`PRESTASHOP_DB_PREFIX`). No hay ORM.

Endpoints runtime actuales:

- `GET /v1/customers/{masterCustomerId}/profile`
- `GET /v1/customers/{masterCustomerId}/orders/{reference}/status`
- `GET /v1/customers/{masterCustomerId}/commercial-summary`
- `GET /v1/customers/{masterCustomerId}/purchased-products`
- `GET /v1/customers/{masterCustomerId}/purchase-behavior`
- `GET /health`
- `GET /health/ready`

Archivos relevantes encontrados:

- `src/infrastructure/crm/mysql-master-customer-reader.ts`
- `src/infrastructure/prestashop/mysql-commercial-orders-summary-reader.ts`
- `src/infrastructure/prestashop/mysql-commercial-products-summary-reader.ts`
- `src/infrastructure/prestashop/mysql-purchased-products-reader.ts`
- `src/infrastructure/prestashop/mysql-customer-product-behavior-reader.ts`
- `src/http/routes/index.ts`
- `src/bootstrap.ts`
- `migrations/001_add_master_customer_prestashop_customer_id.sql`
- `scripts/audits/rfm-population/*`
- `docs/audits/rfm-population/*`
- `docs/audits/commercial-summary/*`
- `docs/releases/CP-R1-T07-customer-commercial-summary.md`
- `docs/releases/CP-R1-T08-purchased-products.md`
- `docs/releases/CP-R1-T09-customer-product-behavior.md`

## Existing Capabilities

Customer Profile ya resuelve `masterCustomerId` leyendo `master_customer` por
`id` y, cuando existe link, lee PrestaShop por `prestashopCustomerId`. El
contrato publico ya evita exponer `ps_customer.id_customer`.

T07 implementa resumen comercial por cliente con:

- `valid = 1`
- `SUM(total_paid_tax_incl)`
- `MIN(date_add)` / `MAX(date_add)`
- conteos de cancelaciones (`current_state = 6`) y reembolsos (`current_state = 7`)

T08 implementa productos comprados desde `ps_order_detail` unido a ordenes
validas.

T09 implementa comportamiento de compra por producto/variante con historial
valido completo, concentracion y diversidad de producto.

T10A ya dejo una auditoria RFM poblacional con scripts y documentos, pero su
modo ejecutado fue `prestashop_customer` provisional, no canonico.

## Missing Capabilities

No existe pipeline productivo RFM.

No existe clustering.

No existen tablas productivas de snapshots RFM o segmentacion.

No existe scheduler, job runner ni command-line entrypoint productivo para
publicar snapshots.

No existen endpoints RFM, segmentation, clustering o customer metrics.

No existe contrato de segmentos consumible por CRM.

No existe columna real `master_customer.prestashop_customer_id` en CRM al
momento de esta auditoria.

## Data Sources

PrestaShop disponible con prefijo real `ps_`.

Tablas confirmadas en la base real:

- `ps_orders`
- `ps_customer`
- `ps_order_detail`
- `ps_currency`
- `ps_order_state`
- `ps_order_state_lang`
- `ps_order_history`
- `ps_order_slip`
- `ps_order_slip_detail`
- `ps_shop`
- `ps_product`
- `ps_category_product`
- `ps_manufacturer`

Columnas confirmadas en `ps_orders`:

- `id_order`
- `reference`
- `id_shop`
- `id_customer`
- `id_currency`
- `current_state`
- `conversion_rate`
- `total_discounts`
- `total_paid`
- `total_paid_tax_incl`
- `total_paid_tax_excl`
- `total_products`
- `total_products_wt`
- `total_shipping`
- `valid`
- `date_add`
- `date_upd`

Columnas confirmadas en `ps_order_detail`:

- `id_order_detail`
- `id_order`
- `product_id`
- `product_attribute_id`
- `product_name`
- `product_quantity`
- `product_quantity_refunded`
- `product_reference`
- `total_price_tax_incl`
- `total_price_tax_excl`
- `total_refunded_tax_incl`

## Identity Model

Modelo aprobado:

```text
master_customer.prestashop_customer_id
-> ps_customer.id_customer
-> ps_orders.id_customer
```

Estado real observado:

- `master_customer.id`: `bigint(20) unsigned`, primary key.
- `master_customer.email`: `varchar(255)`, unique, PII.
- `master_customer.rut`: `varchar(11)`, nullable, PII.
- `master_customer.prestashop_customer_id`: no existe en la base CRM real.

La relacion 1:1 es esperada por la migracion del repo, pero no verificable en
produccion porque la columna no existe aun.

## Coverage

Ejecucion read-only de agregados con `referenceDate = 2026-08-03`:

- `master_customer`: 1 fila.
- `prestashop_customer_id` en CRM: ausente.
- `ps_customer`: 72.180 filas.
- `ps_customer.is_guest = 1`: 0 filas.
- `ps_orders`: 80.472 filas.
- `ps_orders.valid = 1`: 79.422 filas.
- `ps_orders.valid = 0`: 1.050 filas.
- compradores PrestaShop con orden valida: 44.474.
- ordenes validas sin customer utilizable (`NULL` o `0`): 0.

Cobertura por `masterCustomerId`: no medible todavia. El porcentaje canonico es
0% en terminos operativos porque no existe la columna de link necesaria.

## Order Validity

La evidencia de repo y datos reales sostiene `ps_orders.valid = 1` como filtro
base:

- 79.422 ordenes validas contra 1.050 invalidas.
- `current_state = 6` cancelado: 959 ordenes, 0 validas.
- `current_state = 7` reembolsado: 16 ordenes, 0 validas.
- ordenes validas con fecha nula: 0.
- ordenes validas futuras contra `2026-08-03`: 0.
- ordenes validas sin customer utilizable: 0.

Hay 9 ordenes validas con `total_paid_tax_incl = 0`; deben permanecer medidas
como caso de calidad y decidirse antes de congelar `rfm-v1`.

## Monetary Definition

El campo recomendado preliminarmente sigue siendo
`ps_orders.total_paid_tax_incl`, por consistencia con T07 y porque representa
monto pagado bruto con impuestos, despacho y descuentos ya aplicados.

Comparacion live sobre ordenes validas:

- `SUM(total_paid)`: 11.298.238.842,25
- `SUM(total_paid_tax_incl)`: 11.298.238.842,25
- `SUM(total_products)`: 8.977.945.280,02
- `SUM(total_products_wt)`: 10.683.761.359,25
- `SUM(total_discounts)`: 105.091.904,00
- `SUM(total_shipping)`: 719.572.535,00

No elegir una definicion neta de devoluciones aun: hay evidencia de lineas
refunded, pero `ps_order_slip` sigue vacia, y las ordenes terminales
reembolsadas no son validas.

## Currency

Moneda live:

- `id_currency = 1`, `iso_code = CLP`
- 79.422 ordenes validas
- 100% del monetary valido observado

No se debe hardcodear CLP en un pipeline futuro. La consulta debe resolver
moneda desde `ps_currency` y abortar o separar poblaciones si aparecen monedas
distintas o `conversion_rate` distinto de 1.

## Returns and Cancellations

Representacion encontrada:

- cancelaciones por `current_state = 6`.
- reembolsos terminales por `current_state = 7`.
- `ps_order_slip`: 0 filas.
- `ps_order_detail.product_quantity_refunded`: suma live 34.
- `ps_order_detail.total_refunded_tax_incl`: suma live 528.978,25.

Conclusion: `valid = 1` es suficiente para excluir cancelaciones y reembolsos
terminales actuales, pero no basta para decidir monetary neto. T11A debe
publicar gasto bruto o incorporar una decision explicita de ajuste por lineas
refunded si negocio exige neto.

## RFM Window

Con `referenceDate = 2026-08-03`:

| Ventana | Clientes | Ordenes validas | Monetary `total_paid_tax_incl` |
|---|---:|---:|---:|
| Historial completo | 44.474 | 79.422 | 11.298.238.842,25 |
| Ultimos 365 dias | 14.188 | 19.616 | 3.062.422.680,17 |
| Ultimos 730 dias | 27.039 | 43.906 | 6.198.572.696,16 |

Clientes con historial valido que desaparecen del universo operativo 365:
30.286.

Recomendacion preliminar: mantener 365 dias para RFM operativo y todo el
historial para capa historica/reactivacion.

## Population Definition

Universo principal T11A:

```text
Clientes con al menos una orden valid = 1
dentro de [referenceTime - 365 dias, referenceTime + 1 dia)
y con identidad canonica masterCustomerId -> prestashopCustomerId.
```

No incluir cuentas registradas sin compras en el universo principal. Deben
quedar en cobertura/lifecycle, no en RFM scoring.

## Distribution Readiness

Distribucion live 365 dias:

- poblacion provisional PrestaShop: 14.188 clientes.
- recency: min 0, avg 182,6974, max 365, 366 valores unicos.
- frequency: min 1, avg 1,3826, max 2.033, 15 valores unicos.
- monetary: min 0, avg 215.845,9741, max 94.211.374,77, 9.513 valores unicos.

Percentiles live:

- recency p20/p40/p60/p80/p90/p95/p99: 64 / 149 / 228 / 290 / 325 / 346 / 362.
- frequency p20/p40/p60/p80/p90/p95/p99: 1 / 1 / 1 / 1 / 2 / 2 / 4.
- monetary p20/p40/p60/p80/p90/p95/p99: 19.990 / 38.606 / 82.084 / 208.856 / 399.951 / 747.033 / 2.358.439.

Frequency esta dominada por valor 1: 11.982 de 14.188 clientes (84,45%).
Quintiles row-based o `NTILE(5)` no son viables para F porque rompen empates o
generan grupos artificiales.

## Scoring Options

Opciones evaluadas:

- A. Quintiles poblacionales: aceptable para R/M si se implementa tie-safe; mala
  para F por empates.
- B. Percent rank: bueno para R/M, reproducible y explicable; requiere mapear a
  1..5.
- C. `NTILE(5)`: no recomendado porque puede partir clientes con mismo valor.
- D. Thresholds fijos: recomendado para F si se versionan y se congelan con
  evidencia.
- E. Hybrid ranking con tratamiento de empates: recomendado como arquitectura.

Recomendacion: hybrid. R invertida y M con percent rank/tie-safe por valor; F
con thresholds versionados derivados de distribucion real. Valores identicos
siempre deben recibir el mismo score.

## Clustering Feature Availability

Disponibles ahora desde PrestaShop:

- total de ordenes.
- total gastado bruto.
- recency.
- frequency.
- ticket promedio.
- diversidad de productos.
- cantidad de productos unicos.
- cantidad de variantes unicas.
- concentracion de gasto.
- producto dominante.
- recurrencia por producto.
- intervalo entre compras.
- antiguedad como cliente.
- share de gasto por producto.

Disponibles con query adicional:

- share de gasto por categoria.
- share de gasto por marca.
- cantidad de categorias.
- estacionalidad.
- tasa de recompra.

Bloqueadas por falta de decision/taxonomia:

- categorias y marcas como features estables para modelos comerciales, aunque
  `ps_category_product` y `ps_manufacturer` existen.
- separacion B2B/B2C.
- tratamiento multishop.

Bloqueadas por identidad:

- todo feature set canonico por `masterCustomerId`.

No recomendable ahora:

- features que usen email, RUT, telefono, direccion, notas de pago o payloads
  individuales de orden.

## Snapshot Readiness

No existen tablas productivas de snapshot RFM, contrato runtime, writer,
scheduler, active snapshot, `referenceTime`, `generatedAt`,
`calculationVersion`, `sourceVersion` ni checksum implementados.

Estructura minima futura:

- snapshotId.
- calculationVersion.
- referenceTime.
- windowStart.
- windowEnd.
- generatedAt.
- populationSize.
- masterCustomerId.
- prestashopCustomerId interno.
- recencyDays.
- frequencyOrders.
- monetaryValue.
- recencyScore.
- frequencyScore.
- monetaryScore.
- rfmCode.
- coverageStatus.

`prestashopCustomerId` debe permanecer interno salvo contrato administrativo
explicito.

## Runtime Constraints

No existe calculo RFM runtime. Los endpoints actuales calculan resumenes por
cliente bajo demanda, pero no percentiles poblacionales ni segmentacion.

Arquitectura futura recomendada:

```text
read-only extraction -> deterministic offline dataset -> scoring versionado
-> immutable snapshot -> latest/by-version reader -> Customer Profile/CRM consumers
```

No calcular segmentacion por request.

## Security

Outputs futuros no deben exponer:

- email.
- telefono.
- RUT/DNI.
- direcciones.
- payloads de orden.
- detalles de pago.
- `prestashop_customer_id` como identidad publica.

Riesgos actuales:

- `mysql-master-customer-reader` lee PII para el perfil actual; eso existe antes
  de T11A0 y no debe propagarse a docs de RFM.
- logs actuales agregan buckets, estados y duraciones; no imprimen SQL ni PII en
  los paths auditados.
- las queries de este audit documentan agregados solamente.

## Risks

- Identidad canonica ausente en base real.
- `master_customer` contiene una sola fila; aun no representa la poblacion de
  compradores PrestaShop.
- Frequency extremadamente concentrada en 1 orden.
- Outlier de frequency: max 2.033 ordenes en ventana 365.
- Multishop real: 3 shops con comportamientos muy distintos.
- Devoluciones parciales aparecen en `ps_order_detail`, pero `ps_order_slip`
  esta vacia; monetary neto no esta cerrado.
- 30.286 compradores historicos quedan fuera del universo 365.
- `referenceTime` y timezone deben congelarse; no usar `NOW()`.

## Blockers

1. Aplicar y poblar `master_customer.prestashop_customer_id`.
2. Medir cobertura canonica buyers linked/unlinked.
3. Resolver duplicados, orfanos y multiples links si aparecen despues de poblar.
4. Decidir monetary bruto vs ajuste por refunds line-level.
5. Decidir politica multishop.
6. Congelar thresholds de F y version de scoring.
7. Disenar tablas/snapshot writer en una tarea posterior.

## Decisions Required

- `referenceTime`: formato, timezone y calendario operacional.
- Monetary: `total_paid_tax_incl` bruto o neto ajustado.
- Ordenes validas con monto cero: incluir o excluir.
- Devoluciones parciales en `ps_order_detail`: diagnostico solamente o ajuste.
- Multishop: pooled, primary shop, per-shop score o dimension de shop.
- F scoring: thresholds finales.
- R/M scoring: percent-rank exacto y mapeo 1..5.
- Snapshot retention y publicacion atomica.
- Contrato publico de segmentos para CRM.

## Recommended Architecture

Mantener Customer Profile como owner de historia individual y datasets
analiticos offline.

T11A debe construir dataset poblacional read-only, deterministico y canonico por
`masterCustomerId`, con `referenceTime` fijo, `windowStart`, `windowEnd`,
`calculationVersion` y `coverageStatus`.

T11B debe construir dataset historico de features, no modelo, usando las mismas
fuentes transaccionales y sin PII.

T11C debe entrenar o definir segmentacion solo despues de tener snapshots
versionados y cobertura canonica medible.

Catalog Service y CRM no deben modificarse en T11A0.

## Proposed T11A Scope

Incluir:

- extraction read-only desde PrestaShop.
- join canonico con `master_customer.prestashop_customer_id`.
- dataset `active_365` con R/F/M metrics.
- reporte de cobertura y exclusions.
- guardrails de moneda, multishop, dates y refunds.
- scoring solo si la tarea T11A lo aprueba explicitamente; T11A0 no lo hizo.

Excluir:

- clustering.
- endpoints.
- CRM writes.
- Catalog integration.
- segmentos comerciales nombrados.

## Proposed T11B Scope

Construir dataset historico por cliente canonico con features disponibles:
ordenes, gasto, recency, frecuencia, ticket promedio, diversidad,
concentracion, productos/variantes, intervalos, antiguedad, estacionalidad y
shares por producto. Categoria/marca deben quedar condicionadas a decision de
taxonomia.

## Acceptance Criteria

- La auditoria referencia codigo y SQL real del repo.
- Las queries diagnosticas son read-only y comentadas.
- Se confirma si existen fuentes PrestaShop para RFM.
- Se confirma el bloqueo de identidad canonica.
- Se documentan coverage, validity, monetary, currency, refunds, windows,
  distributions, scoring options, clustering readiness y snapshot readiness.
- No hay cambios runtime.
- Solo se agregan documentos de auditoria.
- `npm run typecheck`, `npm run lint`, `npm run build` y `npm test` quedan
  ejecutados o documentados si fallan/no existen.

## Validation Run

Ejecutado en esta rama:

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npm run build`: pass.
- `npm test`: fail.

Falla observada:

```text
tests/unit/audit-rfm-population-t10a3-corrections.test.ts
commercial-validity-analysis.json basis blocks carry an explicit P0_all_shops populationScope
AssertionError: expected null not to be null
source.match(/function buildCommercialValidityAnalysis[\s\S]*?\n}\n/) returned null
```

No se modifico el archivo auditado por ese test
`scripts/audits/rfm-population/audit-rfm-population.ts`. La falla parece estar
en una expectativa fragil del test sobre la forma textual de una funcion
existente, no en los documentos T11A0 agregados.

## Next Task

Proxima tarea esperada: **CP-R1-T11A - Population RFM Dataset**.

Antes de arrancarla, aplicar/poblar el link `master_customer.prestashop_customer_id`
o aceptar formalmente un modo provisional no canonico. La recomendacion de esta
auditoria es no publicar T11A canonico sin el link.
