# CP-R1-T06A State Catalog

Fecha: 2026-07-28.

Estado: **ejecutado read-only contra la base real**. Fuente: `scripts/audits/order-state-semantics/outputs/state-catalog.json` y `state-distribution.json`.

## Idioma Operativo

- Único idioma con traducciones en `ps_order_state_lang`: **`id_lang = 1`** (30 de 30 estados traducidos — cobertura 100%).
- `PRESTASHOP_ORDER_STATE_LANG_ID=1` (ya configurado en el servicio desde T05) **coincide exactamente** con el idioma operativo real. Sin discrepancia, sin acción requerida.
- Estados sin traducción en el idioma operativo: **0** (los 30 estados del catálogo tienen fila en `ps_order_state_lang` para `id_lang = 1`).

## Catálogo Completo (30 estados, `id_lang = 1`)

| stateId | name | paid | shipped | delivery | hidden | loggable | invoice | sendEmail | moduleName | deleted | unremovable | orderCount (% del total) |
|---:|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|:---:|:---:|---:|
| 1 | En espera de pago por cheque | 0 | 0 | 0 | 0 | 0 | 0 | 1 | ps_checkpayment | 0 | 1 | 1 (0.00%) |
| 2 | Pago aceptado | 1 | 0 | 0 | 0 | 1 | 1 | 1 | | 0 | 1 | 15.876 (19.79%) |
| 3 | Preparación en curso | 1 | 0 | 0 | 0 | 1 | 1 | 1 | | 0 | 1 | 0 (0.00%) |
| 4 | Entregado a Transportista | 1 | 1 | 0 | 0 | 1 | 1 | 1 | | 0 | 1 | 19.227 (23.97%) |
| 5 | Entregado | 1 | 1 | 0 | 0 | 1 | 1 | 0 | | 0 | 1 | 42.314 (52.75%) |
| 6 | Cancelado | 0 | 0 | 0 | 0 | 0 | 0 | 1 | | 0 | 1 | 955 (1.19%) |
| 7 | Reembolsado | 0 | 0 | 0 | 0 | 0 | 1 | 1 | | 0 | 1 | 16 (0.02%) |
| 8 | Error en pago | 0 | 0 | 0 | 0 | 0 | 0 | 1 | | 0 | 1 | 23 (0.03%) |
| 9 | Pedido pendiente por falta de stock (pagado) | 1 | 0 | 0 | 0 | 0 | 1 | 1 | | 0 | 1 | 1 (0.00%) |
| 10 | En espera de pago por transferencia bancaria | 0 | 0 | 0 | 0 | 0 | 0 | 1 | ps_wirepayment | 0 | 1 | 7 (0.01%) |
| 11 | Pago remoto aceptado | 1 | 0 | 0 | 0 | 1 | 1 | 1 | | 0 | 1 | 0 (0.00%) |
| 12 | Pedido pendiente por falta de stock (no pagado) | 0 | 0 | 0 | 0 | 0 | 0 | 1 | | 0 | 1 | 1 (0.00%) |
| 13 | En espera de validación por contra reembolso. | 0 | 0 | 0 | 0 | 0 | 0 | 0 | ps_cashondelivery | 0 | 1 | 0 (0.00%) |
| 14 | "1" *(nombre placeholder)* | 0 | 0 | 0 | 1 | 1 | 0 | 0 | | 0 | 0 | 0 (0.00%) |
| 16 | Embalando | 0 | 0 | 0 | 0 | 1 | 0 | 1 | | 0 | 0 | 42 (0.05%) |
| 17 | Listo para despacho | 0 | 0 | 0 | 0 | 1 | 0 | 0 | | 0 | 0 | 0 (0.00%) |
| 19 | Etiquetando | 0 | 0 | 0 | 0 | 1 | 1 | 1 | | 0 | 0 | 9 (0.01%) |
| 23 | Espera de consolidar | 1 | 0 | 0 | 1 | 1 | 1 | 0 | | 0 | 0 | 0 (0.00%) |
| 25 | Consolidando Ruta | 0 | 0 | 0 | 0 | 1 | 0 | 0 | | 0 | 0 | 46 (0.06%) |
| 26 | Pedido con Insidencia *(sic)* | 0 | 0 | 0 | 0 | 1 | 0 | 0 | | 0 | 0 | 2 (0.00%) |
| 27 | En Reparto | 1 | 1 | 0 | 0 | 1 | 1 | 0 | | 0 | 0 | 12 (0.01%) |
| 28 | Entregado a Transportista old | 1 | 0 | 0 | 0 | 1 | 1 | 0 | | 0 | 0 | 60 (0.07%) |
| 29 | "2" *(nombre placeholder)* | 0 | 0 | 0 | 1 | 1 | 0 | 0 | | 0 | 0 | 0 (0.00%) |
| 30 | Listo para retiro | 1 | 0 | 0 | 0 | 1 | 1 | 1 | | 0 | 0 | 26 (0.03%) |
| 31 | Listo para retiro en tienda | 1 | 0 | 0 | 0 | 1 | 1 | 1 | | 0 | 0 | 57 (0.07%) |
| 32 | Picking RB | 0 | 0 | 0 | 1 | 1 | 0 | 0 | | 0 | 0 | 0 (0.00%) |
| 33 | Picking RT | 0 | 0 | 0 | 1 | 1 | 0 | 0 | | 0 | 0 | 0 (0.00%) |
| 34 | En Transito a Tienda | 0 | 0 | 0 | **1** | 1 | 0 | 0 | | 0 | 0 | **9 (0.01%)** |
| 35 | Embalando BE | 0 | 0 | 0 | 0 | 1 | 0 | 0 | | 0 | 0 | 89 (0.11%) |
| 36 | Entregado a BlueExpress | 0 | 0 | 0 | 0 | 1 | 0 | 0 | | 0 | 0 | 1.438 (1.79%) |

Fila 34 resaltada: único caso de `hidden = 1` con volumen actual &gt; 0 (ver "Cruce Con Volumen Y Flags").

Nota sobre huecos en la tabla: los IDs 15, 18, 20, 21, 22, 24 **no existen** como fila en `ps_order_state` — ni siquiera como `deleted = 1`. Ninguno de los 30 estados devueltos tiene `deleted = 1`.

`template`: presente (`has_template = 1`) en los 30 estados; longitud entre 0 (plantilla vacía, ej. estados 5, 14, 17, 23, 25, 26, 27, 28, 29, 32–36) y 14 caracteres (estados 6, 13). Contenido nunca se leyó.

## current_state Sin Correspondencia

- `current_state = 0` o `NULL`: **0 órdenes**.
- `current_state` que no existe en `ps_order_state`: **0 órdenes**.
- **Estados configurados pero sin ninguna orden actual (`unusedConfiguredStates`)**: `3` (Preparación en curso), `11` (Pago remoto aceptado), `13` (En espera de validación por contra reembolso), `14` ("1"), `17` (Listo para despacho), `23` (Espera de consolidar), `29` ("2"), `32` (Picking RB), `33` (Picking RT) — 9 de 30.

## Cruce Con Volumen Y Flags

Inconsistencias detectadas (`detectStateInconsistencies`, `weak_signal` = solo el nombre lo sugiere; `flag_evidence` = basado en flags/volumen):

| stateId | name | tipo | detalle |
|---:|---|---|---|
| 1 | En espera de pago por cheque | flag_evidence | `paid=0` en estado usado (1 orden) — no alineado con la regla PesasChile de T04/T05 |
| 4 | Entregado a Transportista | weak_signal + flag_evidence | nombre sugiere entrega pero `delivery=0`; `shipped=1` sin `delivery=1` |
| 5 | Entregado | weak_signal + flag_evidence | nombre sugiere entrega pero `delivery=0`; `shipped=1` sin `delivery=1` |
| 6 | Cancelado | flag_evidence | `paid=0` en estado usado (955 órdenes) |
| 7 | Reembolsado | flag_evidence | `paid=0` en estado usado (16 órdenes) |
| 8 | Error en pago | flag_evidence | `paid=0` en estado usado (23 órdenes) |
| 10 | En espera de pago por transferencia bancaria | flag_evidence | `paid=0` en estado usado (7 órdenes) |
| 12 | Pedido pendiente por falta de stock (no pagado) | flag_evidence | `paid=0` en estado usado (1 orden) |
| 16 | Embalando | flag_evidence | `paid=0` en estado usado (42 órdenes) |
| 19 | Etiquetando | flag_evidence | `paid=0` en estado usado (9 órdenes) |
| 25 | Consolidando Ruta | flag_evidence | `paid=0` en estado usado (46 órdenes) |
| 26 | Pedido con Insidencia | flag_evidence | `paid=0` en estado usado (2 órdenes) |
| 27 | En Reparto | flag_evidence | `shipped=1` sin `delivery=1` |
| 28 | Entregado a Transportista old | weak_signal | nombre sugiere entrega pero `delivery=0` (0 órdenes actuales, solo histórico) |
| 34 | En Transito a Tienda | *(no marcado por el detector — ver nota)* | `hidden=1` con 9 órdenes; el detector de inconsistencias solo marca `hidden` como evidencia cuando el volumen es ≥1% del total (0.01% aquí no llega al umbral) — pero `proposeClassification` sí lo excluye del pool operacional por esta misma razón, con umbral más estricto (`orderCount > 0`) |
| 36 | Entregado a BlueExpress | weak_signal + flag_evidence | nombre sugiere entrega pero `delivery=0`; `paid=0` en estado usado (1.438 órdenes) |

**Lectura clave**: la regla `paid=0 en estado usado` dispara para 12 de los 21 estados en uso — no es una anomalía puntual, es la norma en esta instalación: el flag nativo `paid` de PrestaShop refleja el flujo de pago de PrestaShop, mientras que la regla de negocio de PesasChile (T04/T05) considera pagada *toda* fila de `ps_orders` sin importar `current_state`/`paid`. Ambas cosas coexisten intencionalmente — T04/T05 ya documentan que no se usa `paid` como filtro.

**`delivery = 1` no aparece en ningún estado del catálogo.** Por eso la señal "`shipped=1` sin `delivery=1`" se dispara para los tres estados de mayor volumen relacionados con entrega (4, 5, 27) — ver la propuesta de clasificación para la implicancia completa.

## Propuesta De Clasificación (resultado real)

Ver `CP-R1-T06A-proposed-operational-map.md` para la tabla completa y su interpretación — incluye el hallazgo central de esta auditoría: los estados 4, 5 y 27 reciben el mismo `candidateStage: dispatched` / `confidence: high` pese a representar etapas reales distintas, porque comparten flags técnicos idénticos.
