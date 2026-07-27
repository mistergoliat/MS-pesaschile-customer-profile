# CP-R1-T01 Customer Account And Identity Foundation Audit

Fecha de auditoria: 2026-07-27.

Estado: completado read-only.

## Resumen Ejecutivo

`master_customer` existe en `main_management`, pero hoy contiene solo 1 fila. Esa fila tiene email unico, pero no coincide por email exacto normalizado con ningun `ps_customer`.

No existe vinculo explicito `master_customer <-> ps_customer`: no hay columna `prestashop_customer_id` y no hay tabla `customer_source_link`/`customer_external_identity` visible. `platform_origin` existe, pero no es un external id y no debe reutilizarse como vinculo.

La cobertura comercial actual de `master_customer` contra compradores PrestaShop es 0%. Esto no invalida la arquitectura, pero significa que Customer Profile no puede producir cobertura real sobre la cartera PrestaShop hasta que exista poblacion de `master_customer` y/o un backfill explicito.

## Artefactos

- Script: `scripts/audits/customer-profile/audit-customer-account-identity.ts`
- Outputs locales ignorados por git:
  - `scripts/audits/customer-profile/outputs/audit-result.json`
  - `scripts/audits/customer-profile/outputs/preflight.json`
  - `scripts/audits/customer-profile/outputs/query-log.json`
  - `scripts/audits/customer-profile/outputs/explains.json`
  - `scripts/audits/customer-profile/outputs/repository-scan.json`
- Inventario: `docs/audits/customer-profile/CP-R1-T01-schema-inventory.md`
- Consumidores: `docs/audits/customer-profile/CP-R1-T01-runtime-consumers.md`

## Guardrails

- Read-only: confirmado por `SHOW GRANTS FOR CURRENT_USER()`, solo `SELECT`.
- Host logico: `pesas-productiva.cz0wkq9tvrby.us-east-1.rds.amazonaws.com`.
- Base configurada: `pesas_productiva`.
- Schema CRM visible: `main_management`.
- Sin credenciales nuevas en archivos.
- Sin SELECT de PII completa; emails, telefonos, nombres, RUT y direcciones no se listaron.
- Agregados solamente.
- `connectionLimit=1`.
- Timeout de query: 15s.
- Guardrail de carga: bloquea antes de consultas costosas si `Threads_running >= 50` o `Threads_running / max_connections >= 0.7`.
- `EXPLAIN FORMAT=JSON` ejecutado para consultas agregadas/join costosas.
- Sin writes a PrestaShop ni CRM.
- Sin migraciones.
- Sin endpoints ni modulos productivos Customer Profile.

## Consultas Utilizadas

Las consultas completas y su orden estan en `query-log.json`; los planes estan en `explains.json`.

Consultas principales:

| Nombre | Proposito |
| --- | --- |
| `preflight.select-1` | Prueba ligera de conexion |
| `preflight.database-user` | Base seleccionada, usuario y host servidor |
| `preflight.show-grants` | Verificacion read-only |
| `discovery.prestashop-prefix` | Deteccion de prefijo PrestaShop por `information_schema` |
| `discovery.identity-tables` | Busqueda de tablas `master_customer` y equivalentes |
| `inventory.columns` | Inventario de columnas |
| `inventory.indexes` | Inventario de indices |
| `inventory.foreign-keys` | Foreign keys declaradas visibles |
| `inventory.inferred-master-dependents` | Dependencias por columnas `master_customer_id`/`customer_master_id` |
| `prestashop.baseline-counts` | Customers, buyers y emails distintos PrestaShop |
| `prestashop.valid-orders` | Ordenes validas preliminares |
| `prestashop.duplicate-emails` | Duplicidad de email PrestaShop y multishop |
| `master.count` | Filas en `master_customer` |
| `master.email-facts` | Unicidad/cobertura agregada de email master |
| `master.platform-origin-facts` | Verificacion de `platform_origin` como no-vinculo |
| `coverage.email-and-order-coverage` | Cobertura master vs PrestaShop por email exacto |
| `coverage.resolution-policy-validation` | Validacion de estados de resolucion |
| `variability.prestashop-account-variability` | Variabilidad de cuenta/direcciones/telefonos/multishop |

Consulta mas lenta: `coverage.email-and-order-coverage`, 7.405ms, bajo el timeout de 15s.

## Estructura Real De Identidad

`master_customer`:

- Schema: `main_management`
- Tabla: `master_customer`
- Filas: 1
- PK: `id`
- Email: `email`, unico por `uq_master_customer_email`
- `platform_origin`: existe, indexado, default `'unknown'`
- PII presente: `firstname`, `lastname`, `email`, `rut`

No existe:

- `master_customer.prestashop_customer_id`
- `master_customer.ps_customer_id`
- `master_customer.id_customer`
- `customer_source_link`
- `customer_external_identity`
- `customer_identity`

Dependencias inferidas:

- `main_management.crm_opportunities.customer_master_id`
- `main_management.n8n_conversation_messages.customer_master_id`

## Metricas De Cobertura

Definiciones:

- `prestashopBuyerCount`: `COUNT(DISTINCT ps_orders.id_customer)` excluyendo `NULL/0`.
- `validOrdersTotal`: orden con `id_customer`, `total_paid > 0`, estado `paid = 1` y al menos una linea `ps_order_detail`.
- Match por email: `LOWER(TRIM(master_customer.email)) = LOWER(TRIM(ps_customer.email))`.

```ts
const coverage = {
  masterCustomerCount: 1,
  prestashopCustomerCount: 71822,
  prestashopBuyerCount: 44739,
  masterCustomersMatchedByExactEmail: 0,
  masterCustomersWithSinglePrestashopMatch: 0,
  masterCustomersWithMultiplePrestashopMatches: 0,
  masterCustomersWithoutPrestashopMatch: 1,
  prestashopBuyersMatchedToMasterCustomer: 0,
  prestashopBuyersWithoutMasterCustomer: 44739,
  validOrdersTotal: 77576,
  validOrdersLinkedToMatchedCustomers: 0,
  buyerCoveragePct: 0,
  validOrderCoveragePct: 0,
  duplicateEmailsInPrestashop: 385,
  conflictingMatchCount: 0,
};
```

Lectura:

- La cobertura actual es 0% porque existe solo 1 `master_customer` y no matchea con PrestaShop.
- El denominador comercial correcto es 44.739 compradores, no 71.822 registros `ps_customer`.
- Hay 77.576 ordenes validas preliminares, ninguna ligada a `master_customer`.

## Variabilidad De Cuenta

| Metrica | Valor |
| --- | ---: |
| Cuentas con multiples direcciones activas | 5.678 |
| Cuentas con mas de un telefono observado | 564 |
| Cuentas donde nombre de direccion difiere del nombre customer | 5.176 |
| Cuentas con multiples destinatarios | 727 |
| Compradores con ordenes pero sin direccion activa | 33 |
| `ps_customer` eliminados | 1 |
| Ordenes con customer faltante/invalido | 8 |
| Emails repetidos dentro del mismo shop | 16 |
| Emails repetidos entre multiples shops | 373 |
| Cuentas con ordenes en mas de un shop | 1 |

Estas variaciones se deben documentar y medir, pero no justifican crear todavia grafos, personas, hogares, recipients o motores probabilisticos.

## Politica Minima De Resolucion

Politica evaluada:

1. Vinculo explicito `master_customer <-> ps_customer` -> `resolved`.
2. Sin vinculo explicito, exactamente un email normalizado coincidente -> `provisional` / candidato seguro para backfill.
3. Mas de un `ps_customer` coincidente -> `conflicted`.
4. `master_customer` existente sin vinculo definitivo -> `provisional`.
5. Identidad entrante que no resuelve ningun `master_customer` -> `unlinked`.

Resultado contra datos reales:

| Estado | Conteo |
| --- | ---: |
| `resolved` por vinculo explicito | 0 |
| candidato seguro por email unico | 0 |
| `conflicted` por email | 0 |
| `provisional` sin vinculo PrestaShop | 1 |

Correccion recomendada: mientras no exista vinculo explicito persistido, el caso de email unico debe tratarse como `provisional_safe_for_backfill`, no como `resolved`. El worker autonomo no debe recibir perfiles resueltos por email en runtime.

`unlinked` queda reservado para una identidad entrante que no logra resolver ningun `master_customer`; no describe la fila actual de `master_customer`.

Estado propuesto:

```ts
type IdentityResolutionStatus =
  | 'resolved'
  | 'provisional'
  | 'unlinked'
  | 'conflicted';
```

Con subrazon operativa:

```ts
type IdentityResolutionReason =
  | 'explicit_prestashop_link'
  | 'single_exact_email_match_safe_for_backfill'
  | 'multiple_exact_email_matches'
  | 'no_exact_email_match'
  | 'missing_or_unusable_email';
```

## Alternativa A vs B

### Alternativa A: `master_customer.prestashop_customer_id`

Ventajas:

- Calza con el estado real: no hay tabla de vinculo ni evidencia concreta de multiples fuentes externas.
- Es el camino minimo para dejar explicito el vinculo fuerte transaccional `ps_customer.id_customer`.
- Facilita el endpoint futuro `GET /v1/customers/{masterCustomerId}/profile`.
- Evita introducir abstraccion generica antes de tener otra fuente real.

Riesgos:

- Si despues aparecen varias fuentes transaccionales reales, habra que migrar a tabla de links.
- Debe tener constraint unica para evitar que dos master apunten al mismo `ps_customer`.

### Alternativa B: `customer_source_link`

Ventajas:

- Mejor si existen varias fuentes externas reales o multiples IDs por master.
- Modela naturalmente `source_system` y `external_customer_id`.

Riesgos:

- No existe hoy y agregaria complejidad prematura.
- No hay evidencia concreta en esta auditoria de una segunda fuente de identidad externa que necesite el modelo.
- Para v1 puede distraer de resolver el problema principal: poblar master y linkear PrestaShop.

### Recomendacion

Recomiendo Alternativa A para CP-R1-T02: agregar un campo directo `prestashop_customer_id` en `master_customer` dentro del CRM, con indice/unique constraint y FK si la infraestructura lo permite.

No reutilizar `platform_origin` como vinculo. No usar `ps_customer.id_customer` como identificador publico del futuro servicio.

## Conflictos Y Limitaciones

- `master_customer` tiene solo 1 fila, por lo que no representa la base comercial real.
- La fila existente no matchea por email con `ps_customer`.
- `ps_customer` tiene 385 emails duplicados; 373 ocurren entre multiples shops.
- La cobertura PrestaShop cambia levemente porque la base esta viva.
- La clasificacion de orden valida es preliminar; requiere definicion comercial de estados en una tarea posterior.
- No se inspecciono texto ni PII completa.
- No hay foreign keys declaradas visibles para dependencias CRM.

## Decision Para CP-R1-T02

Puede pasar a CP-R1-T02:

- Disenar migracion CRM para `master_customer.prestashop_customer_id`.
- Definir constraint unica sobre `prestashop_customer_id` cuando no sea null.
- Preparar backfill read-only por email exacto, pero solo como propuesta; con los datos actuales no hay candidatos.
- Definir contrato del Identity Resolver para devolver `masterCustomerId` y estado de resolucion.
- Definir clasificacion comercial de estados PrestaShop antes de construir perfiles productivos.

No debe pasar aun:

- Implementacion de Customer Profile en este repo.
- Worker autonomo.
- Repositorio nuevo.
- Backfill persistente.
- Tabla generica `customer_source_link` sin otra fuente real.

## Confirmacion Read-only

La tarea se ejecuto sin escrituras. No se crearon endpoints, modulos productivos, migraciones, tablas, vistas, merges ni PR.
