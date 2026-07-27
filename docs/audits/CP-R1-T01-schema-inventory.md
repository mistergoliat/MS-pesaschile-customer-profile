# CP-R1-T01 Schema Inventory

Fecha de auditoria: 2026-07-27.

Fuente read-only usada: conexion MySQL existente del repositorio. No se agregaron credenciales ni se escribio en PrestaShop ni CRM.

## Conexion

- Host logico: `pesas-productiva.cz0wkq9tvrby.us-east-1.rds.amazonaws.com`
- Base configurada: `pesas_productiva`
- Schema CRM visible: `main_management`
- Grants observados: solo `SELECT` (`SHOW GRANTS` con hash redactado)
- Conexion del script: `connectionLimit=1`, timeout por query `15000ms`

## PrestaShop

El prefijo fue detectado desde `information_schema.tables`, no desde configuracion.

- Schema: `pesas_productiva`
- Prefijo detectado: `ps_`
- Tablas core verificadas:
  - `ps_customer`
  - `ps_orders`
  - `ps_order_detail`
  - `ps_order_state`
  - `ps_address`
  - `ps_cart`

Metricas base:

| Metrica | Valor |
| --- | ---: |
| `ps_customer` | 71.822 |
| Compradores por `ps_orders.id_customer` | 44.739 |
| Emails distintos en `ps_customer` | 71.428 |
| Ordenes validas preliminares | 77.576 |
| Compradores con orden valida preliminar | 43.354 |
| Emails repetidos en PrestaShop | 385 |
| Emails repetidos entre multiples shops | 373 |

Distribucion multishop en `ps_customer`:

| Shop | Customers |
| ---: | ---: |
| 1 | 71.135 |
| 2 | 682 |
| 3 | 5 |

## `master_customer`

Tabla encontrada:

- Schema: `main_management`
- Tabla: `master_customer`
- Filas: 1

Columnas:

| Columna | Tipo | Null | Key | Default | Extra |
| --- | --- | --- | --- | --- | --- |
| `id` | `bigint(20) unsigned` | NO | PRI | null | `auto_increment` |
| `firstname` | `varchar(100)` | NO |  | null |  |
| `lastname` | `varchar(100)` | NO |  | null |  |
| `email` | `varchar(255)` | NO | UNI | null |  |
| `platform_origin` | `varchar(32)` | NO | MUL | `'unknown'` |  |
| `rut` | `varchar(11)` | YES |  | `NULL` |  |

Indices:

| Indice | Unico | Columnas |
| --- | --- | --- |
| `PRIMARY` | si | `id` |
| `uq_master_customer_email` | si | `email` |
| `idx_master_customer_platform_origin` | no | `platform_origin` |

Observaciones:

- `email` es unico en `master_customer`.
- No existe columna `prestashop_customer_id`, `ps_customer_id` ni `id_customer`.
- `platform_origin` existe y esta indexado, pero no parece ser un vinculo a PrestaShop: no tiene valores numericos observados.
- No se observaron foreign keys declaradas desde/contra `master_customer`.
- `rut` existe como PII; no fue extraido.

## Tabla De Vinculo Externo

No se encontro ninguna de estas tablas accesibles:

- `customer_source_link`
- `customer_external_identity`
- `customer_identity`

Por lo tanto, hoy no hay vinculo explicito modelado entre `master_customer` y `ps_customer`.

## Dependencias Detectadas

No hay foreign keys declaradas, pero se encontraron columnas inferidas por nombre:

| Schema | Tabla | Columna | Tipo | Key |
| --- | --- | --- | --- | --- |
| `main_management` | `crm_opportunities` | `customer_master_id` | `bigint(20) unsigned` | MUL |
| `main_management` | `n8n_conversation_messages` | `customer_master_id` | `bigint(20)` | MUL |

Estas tablas dependen conceptualmente de `master_customer.id`, aunque no hay constraints declaradas visibles.

## Riesgos De Schema

- El CRM tiene solo 1 `master_customer`; no representa aun la base comercial PrestaShop.
- No hay tabla de vinculo ni campo directo a `ps_customer`.
- La relacion actual con oportunidades/conversaciones depende de una columna llamada `customer_master_id`, sin FK declarada visible.
- `platform_origin` no debe reutilizarse como external id; su forma y tipo indican origen/plataforma, no identidad externa.
