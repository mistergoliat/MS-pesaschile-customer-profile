# CP-R1-T07A Customer Commercial Summary Audit

Fecha: 2026-07-29.

Estado: **auditoría read-only ejecutada contra la base real** (`pesas_productiva`, MariaDB 10.6.25, grants `SELECT`/`USAGE` únicamente). Host y usuario de conexión no se incluyen en este documento por instrucción explícita de la tarea — ambos quedan solo en `outputs/preflight.json`, que está ignorado por Git. Esta tarea **audita**, no implementa: no existe `CustomerCommercialSummary` en `src/`, no se agregó ningún endpoint, no se ejecutó ninguna escritura, migración ni backfill.

Documentos relacionados: [`CP-R1-T07A-order-validity.md`](CP-R1-T07A-order-validity.md), [`CP-R1-T07A-monetary-semantics.md`](CP-R1-T07A-monetary-semantics.md), [`CP-R1-T07A-customer-distribution.md`](CP-R1-T07A-customer-distribution.md), [`CP-R1-T07A-runtime-recommendation.md`](CP-R1-T07A-runtime-recommendation.md).

## Facts

### Conexión y guardrails

- Conexión única (`mysql.createConnection`, nunca un pool) contra `pesas_productiva`.
- `SHOW GRANTS FOR CURRENT_USER()`: solo `SELECT`/`USAGE`, sin `WITH GRANT OPTION` — `grants.safe: true`. La auditoría habría abortado antes de tocar cualquier tabla de datos si esto fuera falso (ver `scripts/audits/commercial-summary/lib/guardrails.ts`, reutilizado literalmente de CP-R1-T06A).
- Carga del servidor al momento de ejecutar: `Threads_running = 3`, `max_connections = 646` (ratio 0,46%) — muy por debajo de los límites de aborto (50 threads absolutos, o 70% de `max_connections`).
- Motor: **MariaDB 10.6.25** — soporta funciones de ventana (`LAG`, `ROW_NUMBER`, etc.), confirmado por `lib/version.ts` (que corrige el criterio de T06A: MariaDB necesita 10.2+, no "major version >= 8" como en el script de T06A, que solo era correcto por coincidencia numérica).
- 48 queries ejecutadas, ~20,1 segundos de tiempo total (ver `outputs/query-log.json`). La más costosa fue la agregación poblacional `GROUP BY id_customer` sobre las 79.190 órdenes válidas (~7s) — ver `CP-R1-T07A-runtime-recommendation.md` para por qué esto no aplica a una consulta runtime por cliente.

### Tablas

- Prefijo detectado sin ambigüedad: `ps_`.
- Tablas requeridas (`orders`, `order_state`, `order_state_lang`, `customer`, `currency`): **las 5 existen**, sin faltantes.
- `order_detail`: variante singular `ps_order_detail` encontrada (mismo hallazgo que T06A).
- `order_slip` / `order_slip_detail`: **ambas existen** como tablas, pero `ps_order_slip` tiene **0 filas** — nunca usadas operativamente.
- Idioma operativo: `id_lang = 1` (coincide con `PRESTASHOP_ORDER_STATE_LANG_ID` ya configurado en `.env`).

### Queries ejecutadas

Todas registradas en `outputs/query-log.json` (nombre, propósito, duración, cantidad de filas) y sus planes en `outputs/explains.json`. Ninguna consulta pasó el chequeo `assertSafeSql` con hallazgos (ver `lib/sql-guardrails.ts`) — de haberlo hecho, la ejecución se habría detenido con una excepción antes de llegar a la base.

## Semántica (resumen — detalle completo en los documentos por tema)

### Filtro de órdenes válidas

`valid = 1` (79.190 de 80.237 órdenes, 98,70%) es un filtro **casi limpio**: ningún estado de cancelación (`6`), reembolso (`7`), pago fallido (`8`) o pago pendiente (`1, 9, 10, 12`) aparece jamás con `valid = 1`. Existe una excepción de 40 órdenes (0,05%) en estados "Entregado"/"Pago aceptado" marcadas `valid = 0`, sin explicación disponible en los datos auditados. Ver [`CP-R1-T07A-order-validity.md`](CP-R1-T07A-order-validity.md).

### Montos

`total_paid_tax_incl` es la columna correcta para `totalSpentTaxIncl`: incluye despacho, descuentos e impuestos; sin montos negativos; 9 órdenes válidas en cero (0,011%). Ver [`CP-R1-T07A-monetary-semantics.md`](CP-R1-T07A-monetary-semantics.md).

### Moneda

100% CLP (`id_currency = 1`), `conversion_rate` siempre exactamente 1 — sin necesidad de conversión de moneda en esta fase.

### Cancelaciones y reembolsos

956 órdenes canceladas (`current_state = 6`), 16 reembolsadas (`current_state = 7`) — ninguna con `valid = 1`. **Cero** evidencia de reembolsos parciales en ninguna fuente (`product_quantity_refunded`, `total_refunded_tax_incl`, `ps_order_slip` — las tres en cero). El gasto neto de reembolsos **no es calculable** con precisión porque no hay datos de reembolsos parciales — se recomienda exponer solo gasto bruto.

### Frecuencia

Fórmula A y fórmula B son **matemáticamente idénticas** para la historia de un mismo cliente (demostrado analíticamente y confirmado empíricamente: diferencia absoluta = 0 en los 10.000 clientes con 2+ compras). Se recomienda la fórmula A por ser más simple y no requerir funciones de ventana. Ver [`CP-R1-T07A-runtime-recommendation.md`](CP-R1-T07A-runtime-recommendation.md).

### Unidades y productos distintos

276.070 unidades brutas, 0 reembolsadas → unidades netas = unidades brutas. 1.705 productos distintos. Cobertura de `order_detail` sobre órdenes válidas: 99,999%.

## Contrato propuesto

`CustomerCommercialSummary` (propuesto, **no implementado**):

```ts
type CustomerCommercialSummary = {
  totalOrders: number;
  totalSpentTaxIncl: string;
  averageOrderValueTaxIncl: string;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  daysSinceLastOrder: number | null;
  purchaseFrequencyDays: number | null;
  totalUnitsPurchased: number;
  distinctProductsPurchased: number;
  cancelledOrderCount: number;
  refundedOrderCount: number;
  currencyIsoCode: string | null;
};
```

La documentación campo-por-campo (fuente, filtro, fórmula, nullability, precisión, limitaciones) vive como **código testeado**, no solo como prosa: [`scripts/audits/commercial-summary/lib/contract-proposal.ts`](../../../scripts/audits/commercial-summary/lib/contract-proposal.ts) (`buildContractFieldDocs()`), verificado por `tests/unit/audit-commercial-summary-contract-proposal.test.ts`, y embebido íntegramente en `outputs/audit-result.json` para trazabilidad. Resumen:

| Campo | Fuente | Filtro | Fórmula |
|---|---|---|---|
| `totalOrders` | `ps_orders` | `valid = 1` | `COUNT(*)` por `id_customer` |
| `totalSpentTaxIncl` | `ps_orders.total_paid_tax_incl` | `valid = 1` | `SUM(...)`, string decimal |
| `averageOrderValueTaxIncl` | `ps_orders.total_paid_tax_incl` | `valid = 1` | `SUM(...) / COUNT(*)`, string decimal |
| `firstOrderAt` / `lastOrderAt` | `ps_orders.date_add` | `valid = 1` | `MIN`/`MAX`, ISO-8601 |
| `daysSinceLastOrder` | derivado de `lastOrderAt` | — | `(ahora - lastOrderAt)` en días |
| `purchaseFrequencyDays` | derivado de `ps_orders.date_add` | `valid = 1` | fórmula A, `null` si `totalOrders < 2` |
| `totalUnitsPurchased` | `ps_order_detail.product_quantity` | órdenes válidas | `SUM(...)` bruto |
| `distinctProductsPurchased` | `ps_order_detail.product_id` | órdenes válidas | `COUNT(DISTINCT ...)` |
| `cancelledOrderCount` | `ps_orders.current_state` | `current_state = 6` | `COUNT(*)` |
| `refundedOrderCount` | `ps_orders.current_state` | `current_state = 7` | `COUNT(*)` |
| `currencyIsoCode` | `ps_currency.iso_code` | `valid = 1` | moneda dominante del cliente |

## Recommendations

Ver la sección "Recommendations" de cada documento por tema. Resumen accionable para una futura tarea de implementación (candidata: **CP-R1-T07 — Customer Commercial Summary**):

1. Filtro base: `valid = 1`, sin excepción especial para las 40 órdenes atípicas.
2. `totalSpentTaxIncl`/`averageOrderValueTaxIncl` desde `total_paid_tax_incl`, gasto **bruto**, documentado como tal.
3. `purchaseFrequencyDays` con fórmula A únicamente.
4. `totalUnitsPurchased` bruto (sin restar reembolsos — no hay reembolsos que restar).
5. Consulta runtime directa por `id_customer` es viable — sin necesidad de snapshot, cache ni índice nuevo para el caso de un solo cliente.
6. `currencyIsoCode` resuelto dinámicamente vía `ps_currency`, nunca hardcodeado a `"CLP"`.

## Open decisions

Respuesta de esta auditoría a las 13 preguntas de la sección 12 del encargo:

1. **¿Qué filtro define una compra comercial válida?** → `ps_orders.valid = 1`, confirmado con 99,95% de limpieza; 40 órdenes de excepción sin explicación disponible (ver order-validity.md).
2. **¿Qué columna monetaria alimenta `totalSpent`?** → `ps_orders.total_paid_tax_incl`.
3. **¿El gasto incluye despacho?** → Sí, confirmado por reconciliación contra `total_products_wt`.
4. **¿El gasto será bruto o neto de reembolsos?** → **Bruto** — no hay datos suficientes para calcular neto (cero reembolsos parciales registrados en ninguna fuente).
5. **¿Cómo se tratan las cancelaciones?** → Excluidas de `totalOrders`/`totalSpent` por el filtro `valid = 1` (ninguna cancelación es `valid = 1`); contadas aparte en `cancelledOrderCount` vía `current_state = 6`.
6. **¿Cómo se tratan los reembolsos parciales?** → **No son calculables** con los datos disponibles — no se exponen en la v1 del contrato; `refundedOrderCount` solo cuenta órdenes en estado terminal reembolsado.
7. **¿Qué significa `totalOrders`?** → Cantidad de órdenes con `valid = 1` (no líneas de producto, no visitas, no carritos).
8. **¿Cómo se calcula la frecuencia?** → Fórmula A (`span / (totalOrders - 1)`) — matemáticamente idéntica a la fórmula B, confirmado empíricamente.
9. **¿Qué ocurre con clientes de una sola compra?** → `purchaseFrequencyDays = null`; es el caso más común (77% de los clientes), no una excepción rara.
10. **¿Qué moneda se expone?** → `ps_currency.iso_code` de la moneda dominante del cliente (hoy siempre CLP, pero resuelto dinámicamente).
11. **¿Las unidades son brutas o netas?** → Brutas — seguro porque no hay reembolsos de unidades registrados.
12. **¿La consulta debe ejecutarse en runtime o publicarse como snapshot?** → **Runtime directo**, confirmado viable por los 4 `EXPLAIN` de consultas candidato (todas usan el índice `id_customer` existente, `rows: 1` estimadas). Ver runtime-recommendation.md.
13. **¿Debe formar parte del profile endpoint principal o de uno separado?** → **Endpoint separado**: `GET /v1/customers/:masterCustomerId/commercial-summary`. Sigue el patrón ya establecido por T06 (`GET /v1/customers/:masterCustomerId/orders/:reference/status` como endpoint propio en vez de anexarse a `/profile`) — el perfil principal ya agrega varias fuentes (T03–T05) y sumarle las ~4-5 consultas adicionales del resumen comercial degradaría su latencia sin necesidad, dado que "perfil básico" y "resumen comercial" pueden tener consumidores distintos (ej. Sales AI vs. CRM Customer 360). El resumen se calculará **en runtime directo, sin snapshot ni cache inicial**: los 4 `EXPLAIN` de la sección de performance confirman que `WHERE id_customer = ?` usa el índice existente (`id_customer` / `idx_orders_customer_idorder`) al mismo costo que cualquier otra consulta ya usada por T03–T06. Cache/snapshot quedan fuera de la v1 — se reconsideran solo si el patrón de acceso real en producción lo justifica.

Preguntas adicionales que quedan abiertas y requieren confirmación operativa de PesasChile (no resolubles solo con los datos auditados):

- ¿Qué explica las 40 órdenes "Entregado"/"Pago aceptado" con `valid = 0`?
- ¿El cliente con 14.331 órdenes es una cuenta legítima o un artefacto de datos?
- ¿Debe excluirse el estado `26` ("Pedido con Insidencia") de algún filtro futuro?

## Implementación

### Script

`scripts/audits/commercial-summary/audit-commercial-summary.ts` — standalone, no importa nada de `src/`, misma filosofía que `scripts/audits/order-state-semantics/audit-order-state-semantics.ts` (CP-R1-T06A). Reutiliza literalmente `assessGrants`/`evaluateLoad` (guardrails) y `computePercentileStats`/`isWithinTolerance` (stats) de T06A vía re-export — no hay una segunda implementación de esa lógica. Módulos nuevos en `lib/`: `schema-discovery.ts` (descubrimiento de prefijo generalizado, parametrizado por el set de tablas requeridas de T07A), `version.ts` (detección de motor/soporte de funciones de ventana, corrigiendo el criterio de T06A para MariaDB), `validity.ts`, `monetary.ts`, `frequency.ts`, `distribution.ts`, `contract-proposal.ts`, `sql-guardrails.ts` (chequeo estático de PII/writes aplicado a cada SQL antes de ejecutarse).

Ejecutar con: `npx tsx scripts/audits/commercial-summary/audit-commercial-summary.ts`.

### Outputs

`scripts/audits/commercial-summary/outputs/` (ignorados por Git, `.gitkeep` es el único archivo trackeado): `preflight.json`, `schema-inventory.json`, `order-validity-analysis.json`, `monetary-analysis.json`, `refund-analysis.json`, `customer-distribution.json` (incluye `frequency` y `unitsAndProducts` — no hay archivos dedicados para esas dos secciones en la lista fija de outputs de la tarea, así que se anidaron temáticamente ahí), `performance-analysis.json`, `query-log.json`, `explains.json`, `audit-result.json`.

### Guardrails aplicados

- Grants `SELECT`/`USAGE` verificados antes de cualquier query de datos.
- Carga del servidor verificada (`Threads_running` / `max_connections`) antes de cualquier query de datos.
- Conexión única, sin pool.
- Timeout de 20s por query.
- Cada SQL pasa por `assertSafeSql` (sin `SELECT *`, sin keywords de escritura, sin columnas de PII: email/firstname/lastname/address/phone/reference de orden) antes de ejecutarse — no solo una revisión manual.
- Ningún `id_order`, `id_customer` o `reference` individual aparece en ningún archivo de `outputs/` — todo es `COUNT`/`SUM`/`MIN`/`MAX`/percentiles agregados. Las consultas por-cliente usan `GROUP BY id_customer` sin seleccionar `id_customer` en el resultado (mismo patrón que T06A usa para `id_order`).
- `schema-inventory.json` incluye el listado completo de columnas de `ps_customer` (necesario para confirmar su cobertura, sección 2 del encargo), lo que significa que **nombres** de columna con forma de PII (`email`, `firstname`, `lastname`, `birthday`) aparecen ahí — nunca un **valor** real de ningún cliente. Es metadato de esquema (`information_schema.columns`), no dato. Vive únicamente en el output ignorado, igual que el resto.
- `outputs/*.json` están en `.gitignore` (excepto `.gitkeep`) — nunca se commitean, mismo criterio que T06A.

## Validación

```
npm run typecheck   → OK
npm run lint        → OK
npm test             → 378 tests, todos verdes (93 nuevos para esta tarea)
npm run build        → OK
```

Ninguna prueba depende de una base de datos real ni de credenciales productivas — toda la lógica en `lib/*.ts` es pura y se testea con datos sintéticos. La ejecución real contra `pesas_productiva` se hizo una sola vez, de forma manual, fuera de la suite de tests.
