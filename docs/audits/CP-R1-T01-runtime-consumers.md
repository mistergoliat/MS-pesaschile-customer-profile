# CP-R1-T01 Runtime Consumers

Fecha de auditoria: 2026-07-27.

## Repositorio Actual

El repositorio `MS-pesaschile-catalog-service` no contiene consumidores productivos de `master_customer`.

Busqueda excluyendo `node_modules`, `dist`, `.git`, outputs y carpetas de auditoria:

| Termino | Hits | Archivos |
| --- | ---: | --- |
| `master_customer` | 0 | - |
| `customer_master` | 0 | - |
| `customer_external_identity` | 0 | - |
| `customer_identity` | 0 | - |
| `customer_conversation_link` | 0 | - |
| `customer_addresses` | 0 | - |
| `crm_customer_onboarding` | 0 | - |
| `platform_origin` | 0 | - |
| `email` | 0 | - |
| `ps_customer` | 0 | - |
| `ps_address` | 0 | - |
| `ps_orders` | 1 | `tests/unit/prestashopOrderTransactionReader.test.ts` |
| `id_customer` | 17 | catalog/pricing ports, pricing resolver, catalog readers, customer-affinity tests/docs |

## Codigo Productivo Relevante

El servicio de catalogo usa `id_customer` solo como parametro comercial PrestaShop para precios especificos y afinidad neutral/inyectada:

- `src/domain/catalog/ports.ts`
- `src/domain/pricing/types.ts`
- `src/infrastructure/repositories/mysqlCatalogRepository.ts`
- `src/infrastructure/catalog/mysqlCatalogCommercialDataReader.ts`
- `src/infrastructure/pricing/priceResolver.ts`

No se encontro:

- lectura de CRM;
- escritura de CRM;
- lectura de `master_customer`;
- escritura de `master_customer`;
- almacenamiento local de `ps_customer.id_customer` como identidad publica;
- endpoints de Customer Profile;
- modulos productivos Customer Profile.

## Consumidores En Schema CRM

Aunque no hay consumidores en este repositorio, el schema `main_management` muestra dependencias por columna:

| Tabla | Columna | Interpretacion |
| --- | --- | --- |
| `crm_opportunities` | `customer_master_id` | oportunidades dependen de cuenta master |
| `n8n_conversation_messages` | `customer_master_id` | mensajes/conversaciones dependen de cuenta master |

No hay foreign keys declaradas visibles para esas columnas.

## Conclusion

El flujo objetivo `mensaje -> Identity Resolver -> master_customer -> Customer Profile -> oportunidad -> contexto -> Sales Agent` todavia no esta implementado en este repositorio. Este repositorio solo sirve como entorno temporal de auditoria y lector PrestaShop.

Para CP-R1-T02, cualquier consumidor productivo debe vivir fuera de `MS-pesaschile-catalog-service`, idealmente en el futuro `MS-pesaschile-customer-profile` o en el Identity Resolver correspondiente.
