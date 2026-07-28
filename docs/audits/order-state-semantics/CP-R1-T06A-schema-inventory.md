# CP-R1-T06A Schema Inventory

Fecha: 2026-07-28.

Estado: **ejecutado read-only contra la base real** (`pesas_productiva`, motor MariaDB 10.6.25). Fuente: `scripts/audits/order-state-semantics/outputs/schema-inventory.json`. Ninguna fila de datos se muestra aquí — solo estructura (columnas, tipos, índices, FKs).

## Descubrimiento De Prefijo

- **Prefijo detectado: `ps_`**. Único candidato (`candidates: ["ps_"]`), sin ambigüedad.
- Las 6 tablas requeridas existen bajo ese prefijo: `ps_orders`, `ps_order_state`, `ps_order_state_lang`, `ps_order_history`, `ps_order_carrier`, `ps_carrier`. `missingTables`: ninguna.
- **Tabla de detalle de orden: `ps_order_detail`** (forma singular). Se comprobaron ambas variantes contra `information_schema.tables` (`ps_order_detail`, `ps_order_details`) antes de usar cualquiera — la forma plural no existe en esta instalación.
- Ninguna de las 7 tablas auditadas tiene **foreign keys declaradas** (`foreignKeys: []` en las 7) — PrestaShop mantiene la integridad a nivel de aplicación, no de motor, consistente con lo ya observado en `docs/audits/CP-R1-T01-schema-inventory.md` para `master_customer`.

## Inventario Por Tabla

### `ps_orders`

47 columnas. Selección relevante para esta auditoría:

| Columna | Tipo | Null | Key |
| --- | --- | --- | --- |
| `id_order` | `int(10) unsigned` | NO | PRI |
| `id_customer` | `int(10) unsigned` | NO | MUL |
| `current_state` | `int(10) unsigned` | NO | MUL |
| `id_carrier` | `int(10) unsigned` | NO | MUL |
| `reference` | `varchar(9)` | — | MUL |
| `valid` | `int(1) unsigned` | NO | — |
| `date_add` | `datetime` | NO | MUL |
| `date_upd` | `datetime` | NO | — |
| `total_products_wt` | `decimal(20,6)` | NO | — |
| `total_paid_tax_incl` | `decimal(20,6)` | NO | — |

Nota: `valid` es `int(1) unsigned`, no `tinyint(1)` — no cambia el manejo ya implementado en T04 (`Boolean(row.valid)` sigue siendo correcto para cualquier entero 0/1).

Índices: `PRIMARY`, `reference`, `id_customer`, `id_cart`, `invoice_number`, `id_carrier`, `id_lang`, `id_currency`, `id_address_delivery`, `id_address_invoice`, `id_shop_group`, `current_state`, `id_shop`, `date_add`, más 3 índices compuestos custom: `idx_orders_shop_idorder`, `idx_orders_customer_idorder`, `idx_orders_idorder_shop` — evidencia de tuning de performance ya realizado sobre esta tabla.

### `ps_order_state`

13 columnas, todas las requeridas por la sección 8 presentes: `id_order_state` (PK), `invoice`, `send_email`, `module_name` (indexado), `color`, `unremovable`, `hidden`, `logable`, `delivery`, `shipped`, `paid`, `pdf_invoice`, `pdf_delivery`, `deleted` — todas `tinyint(1) unsigned` salvo `module_name` (`varchar(255)`) y `color` (`varchar(32)`).

### `ps_order_state_lang`

4 columnas: `id_order_state` + `id_lang` (PK compuesta), `name` (`varchar(64) NOT NULL`), `template` (`varchar(64) NOT NULL`). `template` nunca es `NULL` en esta instalación (columna `NOT NULL`) — puede ser cadena vacía, que es lo que se observó para varios estados (ver `CP-R1-T06A-state-catalog.md`).

### `ps_order_history`

5 columnas, todas presentes: `id_order_history` (PK), `id_employee` (indexado), `id_order` (indexado, índice `order_history_order`), `id_order_state` (indexado), `date_add`.

### `ps_order_carrier`

9 columnas, todas presentes: `id_order_carrier` (PK), `id_order` (indexado), `id_carrier` (indexado), `id_order_invoice` (indexado), `weight`, `shipping_cost_tax_excl`, `shipping_cost_tax_incl`, `tracking_number` (`varchar(64)`), `date_add`.

### `ps_carrier`

20 columnas — las 9 de interés listadas por la tarea están todas presentes (`id_carrier`, `id_reference`, `name`, `active`, `deleted`, `shipping_external`, `is_module`, `external_module_name`, `need_range`), más columnas adicionales de configuración de envío (`url`, `shipping_handling`, `range_behavior`, `is_free`, `shipping_method`, `position`, `max_width`/`max_height`/`max_depth`/`max_weight`, `grade`, `id_tax_rules_group`). Índices: `PRIMARY`, `deleted`, `id_tax_rules_group`, `reference`.

### `ps_order_detail`

**46 columnas** — las 21 mínimas pedidas por la tarea están todas presentes:

`id_order_detail` (PK), `id_order` (indexado, índices `order_detail_order` e `id_order_id_order_detail`), `product_id` (indexado), `product_attribute_id` (indexado), `product_name`, `product_quantity`, `product_quantity_refunded`, `product_quantity_return`, `product_quantity_reinjected`, `product_price`, `unit_price_tax_incl`, `unit_price_tax_excl`, `total_price_tax_incl`, `total_price_tax_excl`, `reduction_percent`, `reduction_amount`, `reduction_amount_tax_incl`, `reduction_amount_tax_excl`, `product_reference`, `product_supplier_reference`, `tax_rate`, `id_shop`.

Columnas adicionales encontradas, relevantes para una futura T07: `id_order_invoice`, `id_warehouse`, `id_customization`, `product_quantity_in_stock`, `group_reduction`, `product_quantity_discount`, `product_ean13`/`product_isbn`/`product_upc`/`product_mpn`, `product_weight`, `id_tax_rules_group` (indexado), `tax_computation_method`, `tax_name`, `ecotax`/`ecotax_tax_rate`, `discount_quantity_applied`, `download_hash`/`download_nb`/`download_deadline` (productos descargables), `total_shipping_price_tax_incl`/`_excl`, `purchase_supplier_price`, `original_product_price`, `original_wholesale_price`, **`total_refunded_tax_excl`/`total_refunded_tax_incl`** (útiles para una futura interpretación de reembolsos, no usadas en esta auditoría).

## Tablas Faltantes

Ninguna. Las 6 tablas originales y `ps_order_detail` existen todas bajo el prefijo `ps_`.

## Dependencias Inferidas

Sin FKs declaradas en ninguna de las 7 tablas auditadas. Relaciones inferidas exclusivamente por nombre de columna (mismo criterio que T01 usó para `customer_master_id`):

- `ps_orders.current_state` → `ps_order_state.id_order_state`
- `ps_order_state_lang.id_order_state` → `ps_order_state.id_order_state`
- `ps_order_history.id_order` → `ps_orders.id_order`; `ps_order_history.id_order_state` → `ps_order_state.id_order_state`
- `ps_order_carrier.id_order` → `ps_orders.id_order`; `ps_order_carrier.id_carrier` → `ps_carrier.id_carrier`
- `ps_order_detail.id_order` → `ps_orders.id_order`; `ps_order_detail.product_id` → `ps_product.id_product` (tabla `ps_product` confirmada existente, ver `CP-R1-T06A-order-detail-coverage.md`)

Todas estas relaciones se comprobaron empíricamente (integridad referencial de facto, ver hallazgos de "0 filas huérfanas" en los demás documentos), no solo por nombre.
