# CP-R1-T07A Order Validity

Fecha: 2026-07-29.

Estado: **ejecutado read-only contra la base real** (`pesas_productiva`, MariaDB 10.6.25). Fuente: `scripts/audits/commercial-summary/outputs/order-validity-analysis.json`. Todos los números son agregados (`COUNT`/`SUM`/`MIN`/`MAX` por `(valid, current_state)`) — ningún `id_order`, `reference` ni `id_customer` individual aparece en este documento ni en el output.

## Facts

- Total de órdenes en `ps_orders` al momento de la ejecución: **80.237**.
- `valid = 1`: **79.190** órdenes (98,70%).
- `valid = 0`: **1.047** órdenes (1,30%).
- Estados observados con `valid = 1`: `2, 4, 5, 25, 27, 28, 30, 31, 34, 35, 36` (11 estados distintos).
- Estados observados con `valid = 0`: `1, 2, 5, 6, 7, 8, 9, 10, 12, 26` (10 estados distintos).
- **Estados que aparecen bajo ambas validaciones**: `2` ("Pago aceptado") y `5` ("Entregado") — `cleanSplit: false`.
  - Estado `2`: 15.892 órdenes con `valid=1`, **5** órdenes con `valid=0`.
  - Estado `5`: 42.295 órdenes con `valid=1`, **35** órdenes con `valid=0`.
  - Total de la excepción: **40 órdenes** (0,05% de las 80.237 totales).
- Estado `6` ("Cancelado"): **956** órdenes totales, **0** con `valid = 1`. `cancelledStateHasValidOrders: false`.
- Estado `7` ("Reembolsado"): **16** órdenes totales, **0** con `valid = 1`. `refundedStateHasValidOrders: false`.
- Estados exclusivamente `valid = 0` y nunca `valid = 1`, además de 6/7: `1` ("En espera de pago por cheque", 1 orden), `8` ("Error en pago", 23), `9` ("Pedido pendiente por falta de stock (pagado)", 1), `10` ("En espera de pago por transferencia bancaria", 7), `12` ("Pedido pendiente por falta de stock (no pagado)", 1), `26` ("Pedido con Insidencia", 2).
- `os.paid` y `os.logable` (flags nativos de `ps_order_state`) para los 11 estados con `valid=1`: todos tienen `logable = true`; `paid` es `true` para 7 de los 11 (`2,4,5,28,30,31,27`) y `false` para 4 (`25,34,35,36` — estados operacionales custom de despacho/BlueExpress sin el flag nativo activado, consistente con el hallazgo de T06A de que el flag `paid` no está confiablemente configurado en los estados custom).
- Todos los estados con `valid=0` tienen `logable=false`, **excepto** el estado `26` ("Pedido con Insidencia", `logable=true`, 2 órdenes) y el caso de excepción de los estados `2`/`5` ya descrito arriba.

## Interpretations

### `valid = 1` es un filtro casi limpio, no perfecto, para "compra comercial real"

La hipótesis inicial (`ps_orders.valid = 1 → orden comercial válida`) se sostiene en el **99,95%** de los casos: ningún estado exclusivamente de pago fallido/pendiente (`1, 8, 9, 10, 12`) ni cancelación/reembolso (`6, 7`) aparece jamás con `valid = 1`. Esto confirma la parte más importante de la hipótesis: **usar `valid = 1` nunca cuenta una cancelación o un reembolso como compra válida**.

Sin embargo, existe una excepción real y medible: 40 órdenes (35 en estado "Entregado", 5 en "Pago aceptado") están marcadas `valid = 0` a pesar de estar en un estado que, en el 99,9%+ de los casos, es `valid = 1`. Esto **no se explica** por los datos disponibles en esta auditoría — podría ser una corrección manual, una orden de prueba marcada retroactivamente, o una inconsistencia de un proceso batch (ver el hallazgo similar de T06A sobre `current_state` actualizado sin pasar por `order_history`). No se puede determinar la causa sin evidencia adicional (log de auditoría de PrestaShop, que esta tarea no audita).

### El estado `26` ("Pedido con Insidencia") es una anomalía menor, no una categoría a excluir explícitamente

Es el único estado `valid=0` con `logable=true`, y solo tiene 2 órdenes — volumen insuficiente para cambiar cualquier recomendación, pero documentado para que una futura revisión no lo pase por alto.

### Nombre de estado usado únicamente como interpretación documental

Ningún número de este documento se calculó a partir de `stateName` — toda cifra proviene de `valid` y `current_state` (IDs), tal como exige la sección 4 de la tarea. `stateName` solo se usa aquí, en prosa, para que un humano entienda qué representa cada ID.

## Recommendations

1. **Usar `valid = 1` como filtro primario** de "compra comercial válida" para todos los campos del `CustomerCommercialSummary` propuesto (`totalOrders`, `totalSpentTaxIncl`, fechas, frecuencia, unidades, productos distintos).
2. **No intentar "corregir" las 40 órdenes de excepción** en esta fase — su volumen (0,05%) es demasiado bajo para justificar una regla especial, y no hay evidencia suficiente para saber si `valid=0` o el `current_state` observado es el dato "correcto" en esos 40 casos.
3. Mantener `current_state = 6` / `current_state = 7` como la definición operativa de `cancelledOrderCount` / `refundedOrderCount` — están 100% desacoplados de `valid = 1`, así que no hay riesgo de que una orden cancelada/reembolsada contamine `totalSpentTaxIncl` bajo la recomendación anterior.

## Open decisions

1. ¿Qué explica las 40 órdenes en estado "Entregado"/"Pago aceptado" con `valid = 0`? Requiere a alguien de PesasChile con acceso a los logs de PrestaShop o memoria operativa del caso — no resoluble solo con los datos de `ps_orders`.
2. ¿El estado `26` ("Pedido con Insidencia") debería excluirse explícitamente de un futuro cálculo runtime, o su volumen (2 órdenes) es negligible indefinidamente?
