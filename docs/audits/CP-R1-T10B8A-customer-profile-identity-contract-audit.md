# CP-R1-T10B8A - Customer Profile Identity Contract Audit

Fecha: 2026-08-04

Estado: congelado para T10B8A. No habilita implementar consumo de compras, comportamiento, `CustomerRecommendationContext`, `SearchProducts V2`, tool registration ni cambios en el Agent Loop.

## Veredicto

**Caso D: equivalencia no demostrable.**

Customer Profile espera un `masterCustomerId` que contractualmente representa `master_customer.id`, en formato string numerico. El repositorio no demuestra que `NativeCustomerSession.identity.customerId`, `conversation.customer_id`, `customerMasterId` de continuidad ni el id historico de `POST /api/pc-users` sean intercambiables con ese valor en runtime productivo.

Regla congelada para T10B8A: no enviar un ID probable a Customer Profile como `masterCustomerId`. Si no existe prueba estructural de equivalencia en el turno, el resultado debe ser modo generico con `identity_unresolved`.

## Inventario de Customer Profile

Archivos principales auditados:

- `src/http/routes/index.ts`: rutas HTTP, validacion de path/query/body y mapeo HTTP.
- `src/domain/customer-profile/contracts.ts`: contrato de perfil y nota explicita de que Customer Profile no resuelve identidad.
- `src/domain/customer-commercial-summary/contracts.ts`: contrato de resumen comercial.
- `src/domain/customer-purchased-products/contracts.ts`: contrato de productos comprados.
- `src/domain/customer-purchase-behavior/contracts.ts`: contrato de comportamiento de compra.
- `src/domain/customer-order-status/contracts.ts`: contrato de estado de orden.
- `src/domain/customer-profile/master-customer-record.ts`: tipo local de `master_customer`.
- `src/infrastructure/crm/mysql-master-customer-reader.ts`: lectura SQL de `master_customer`.
- `src/application/customer-profile/get-customer-profile.ts`: lookup de perfil.
- `src/application/customer-commercial-summary/get-customer-commercial-summary.ts`: lookup de resumen comercial.
- `src/application/customer-purchased-products/get-customer-purchased-products.ts`: lookup de compras por producto.
- `src/application/customer-purchase-behavior/get-customer-purchase-behavior.ts`: lookup de comportamiento.
- `src/application/customer-order-status/get-customer-order-status.ts`: lookup de orden por referencia.
- `docs/architecture/overview.md`: define `masterCustomerId` como identificador publico y PrestaShop como referencia interna.
- `docs/design/CP-R1-T02-master-customer-population-and-prestashop-link-contract.md`: contrato de poblacion/link y frontera de identidad.
- `migrations/001_add_master_customer_prestashop_customer_id.sql`: migracion de link PrestaShop, marcada como artefacto de diseno no ejecutado.

No se encontraron en Customer Profile implementaciones runtime de:

- `POST /api/pc-users`
- endpoint de lookup/resolucion de identidad
- `customer_identity`
- `customer_link`
- `prestashop_customer`
- `external_identity`
- `customer_reference`
- `customer_not_linked` como endpoint de resolucion; solo como status de lectura comercial

## Definicion Real de `masterCustomerId`

Tipo de contrato HTTP: `string`, trim, minimo 1, maximo 20, regex `^[0-9]+$`.

Tipo de persistencia esperado: `master_customer.id`, `bigint(20) unsigned`. El tipo local se mantiene como string para evitar perdida de precision de JavaScript.

Origen esperado: upstream ya confirmado por onboarding / Identity Resolver / Customer Service. Customer Profile no lo crea, no lo resuelve por email y no lo vincula.

Tabla propietaria esperada: `master_customer` en CRM / `main_management`.

Link a PrestaShop: `master_customer.prestashop_customer_id`, `INT UNSIGNED NULL`, unico. Si es `NULL`, existe master pero no hay vinculo PrestaShop.

Estado real local verificado: la base visible tiene `master_customer` con `id`, `firstname`, `lastname`, `email`, `platform_origin`, `rut`, pero no tiene `prestashop_customer_id`. La app reporta `crm_schema_incompatible` en readiness.

## Endpoints Consumibles por Sales Agent

Estos endpoints existen en Customer Profile:

| Endpoint | Uso posible para Sales Agent | Parametros | Respuesta util |
|---|---|---|---|
| `GET /health` | smoke tecnico | ninguno | `200 { "status": "ok" }` |
| `GET /health/ready` | readiness de dependencias | ninguno | `200 ready/ready_degraded` o `503 not_ready` |
| `GET /v1/customers/:masterCustomerId/profile` | perfil comercial basico y ordenes recientes | path `masterCustomerId` | `available`, `partial`, `not_found`, `degraded` |
| `GET /v1/customers/:masterCustomerId/commercial-summary` | RFM operativo simple sin score RFM | path `masterCustomerId` | totales, gasto, AOV, fechas, frecuencia |
| `GET /v1/customers/:masterCustomerId/purchased-products` | evidencia historica de productos comprados | path `masterCustomerId`; query `limit`, `offset` | lista paginada de productos historicos |
| `GET /v1/customers/:masterCustomerId/purchase-behavior` | repeticion/diversidad/concentracion de compra | path `masterCustomerId`; query `topProducts`, `topVariants` | resumen y rankings |
| `GET /v1/customers/:masterCustomerId/orders/:reference/status` | estado de una orden especifica del cliente | path `masterCustomerId`, `reference` | estado PrestaShop actual, metodo/estimacion de entrega |

No existe endpoint de resolucion o lookup como:

- `GET /v1/customers/resolve`
- `GET /v1/customers/by-email`
- `GET /v1/customers/by-phone`
- `POST /api/pc-users`

## Contrato de Path Param

`masterCustomerId`:

- acepta solo digitos ASCII;
- acepta leading zeros por regex, pero no hay canonicalizacion explicita;
- maximo 20 caracteres;
- no acepta email, UUID, prefijos como `cm_123`, signos ni espacios internos;
- se trimea antes de validar;
- se pasa como string al repositorio SQL.

Riesgo de leading zeros: aunque HTTP acepta `"0001"`, MySQL comparara contra `BIGINT` si la columna es numerica. No hay test que congele si `"0001"` debe equivaler o no a `"1"`. Para T10B8A, canonicalizar a entero positivo string sin leading zeros solo si el resolver de identidad lo define explicitamente.

## Semantica de 404

Customer Profile distingue los estados en el body, pero varios endpoints colapsan a HTTP 404:

- `customer_not_found`: no existe fila `master_customer.id = masterCustomerId`.
- `customer_not_linked`: existe `master_customer`, pero `prestashop_customer_id` es `NULL`.
- `order_not_found`: no hay orden con esa referencia para el cliente PrestaShop vinculado, o la orden pertenece a otro cliente.

La diferencia entre no encontrado y no vinculado queda en `status`, no en el HTTP code, salvo `profile`:

- `GET /profile`: master no vinculado devuelve `200 partial` con `linkStatus: "not_linked"`.
- endpoints comerciales / compras / comportamiento / orden: no vinculado devuelve `404 { "status": "customer_not_linked" }`.

## Fuente de Datos e Identidad

Customer Profile lee:

- CRM: `master_customer` por `id`.
- PrestaShop: cliente, ordenes, productos, comportamiento y estado de orden usando `prestashopCustomerId`.

Customer Profile no lee ni posee, en el contrato runtime auditado:

- `customer_identity`
- `customer_link`
- `prestashop_customer`
- `external_identity`
- `customer_reference`

La base local visible tampoco contiene esas tablas en el esquema consultado. Si existen en otro servicio o ambiente, no estan demostradas por este repositorio.

## Relacion con Customer Service / `pc-users`

En Customer Profile no hay referencia a `POST /api/pc-users`.

En Customer 360 actual se encontro una evolucion contractual relevante:

- Customer Service es autoridad de `resolve_customer`, `create_customer` y `link_external_identity`.
- Los resultados exitosos devuelven `customerMasterId`, no `customerId`.
- `customerMasterId` se define como identificador canonico compatible con `master_customer.id`.
- Antes de completar onboarding, Customer 360 verifica que exista `master_customer.id = customerMasterId` via `CustomerMasterProjectionReader`.
- Si la proyeccion local no existe, Customer 360 no fabrica filas y deja la identidad temporalmente no disponible.

Esto apoya la hipotesis de equivalencia entre Customer Service `customerMasterId` y Customer Profile `masterCustomerId`, pero no demuestra que el endpoint historico `POST /api/pc-users` devuelva el mismo campo/espacio de ID en el ambiente real.

## Matriz de Identificadores

| Identificador | Sistema propietario | Tabla/origen | Significado | Equivale a `masterCustomerId` |
|---|---|---|---|---|
| `conversation.customer_id` | CRM / Customer 360 | conversacion runtime | cliente local asociado al turno | por demostrar |
| `NativeCustomerSession.identity.customerId` | Customer 360 | resolucion nativa | identidad resuelta para el turno | por demostrar; puede representar `master_customer.id` si la fuente/gate lo prueban |
| `customerMasterId` | Customer 360 / Customer Service v2 | contrato de Customer Service y continuidad | id canonico compatible con `master_customer.id` | por demostrar contra Customer Profile/ambiente |
| `customer_master_id` | CRM / Customer 360 | oportunidades/estado comercial | referencia comercial local | por demostrar |
| `masterCustomerId` | Customer Profile | contrato HTTP | `master_customer.id` publico | referencia |
| `pc-users.id` | Customers service historico | `POST /api/pc-users` | identidad canonica potencial | no demostrado en este repositorio |

## Fixtures y Pruebas

Fixtures de Customer Profile:

- cliente vinculado: `masterCustomerId: "1"`, `prestashopCustomerId: 555`.
- cliente sin vinculo PrestaShop: `masterCustomerId: "1"`, `prestashopCustomerId: null`.
- cliente inexistente: `masterCustomerId: "999"`, reader devuelve `null`.
- cliente con compras: fixtures unitarios/integracion simulados, no datos productivos.

Pruebas de contrato ejecutadas:

```powershell
npx vitest run --config vitest.config.ts tests/integration/customer-profile-route.test.ts tests/integration/customer-order-status-route.test.ts tests/integration/customer-commercial-summary-route.test.ts tests/integration/customer-purchased-products-route.test.ts tests/integration/customer-purchase-behavior-route.test.ts
```

Resultado: 5 archivos, 53 tests pasados.

Pruebas live locales ejecutadas:

- `GET /health` -> `200 { "status": "ok" }`.
- `GET /health/ready` -> `503 { "status": "not_ready", "crm": false, "prestashop": true, "reason": "crm_schema_incompatible" }`.
- `GET /v1/customers/not-a-number/profile` -> `400 { "error": "invalid_master_customer_id" }`.
- `GET /v1/customers/1/purchased-products?limit=0` -> `400 { "error": "invalid_limit" }`.
- `GET /v1/customers/1/purchase-behavior?topProducts=11` -> `400 { "error": "invalid_top_products" }`.

Prueba live de cliente vinculado: bloqueada. La consulta directa a `master_customer.prestashop_customer_id` fallo con `ER_BAD_FIELD_ERROR`, consistente con readiness `crm_schema_incompatible`.

No existe fixture real auditado de:

- respuesta de cliente existente con datos productivos;
- cliente sin vinculo PrestaShop real;
- cliente inexistente real mas alla de contrato;
- cliente con compras real;
- respuesta real de `POST /api/pc-users`;
- comparacion real `pc-users.id == Customer Profile masterCustomerId`.

## Decisiones que Customer Profile Puede Soportar

Con identidad verificada y link PrestaShop disponible, Customer Profile puede soportar:

- cliente nuevo vs recurrente;
- cliente valioso por gasto historico;
- cliente inactivo por `lastOrderAt` / `daysSinceLastOrder`;
- busqueda de segunda compra por historial;
- reactivacion;
- priorizacion comercial basada en valor/frecuencia/recencia historica;
- evidencia de productos ya comprados;
- concentracion, repeticion y diversidad historica de compra;
- seguimiento de una orden por referencia cuando el cliente esta identificado.

No puede decidir:

- producto concreto a recomendar;
- compatibilidad entre productos;
- complemento o sustituto;
- necesidad actual del cliente;
- intencion del turno;
- propiedad de una identidad sin resolver;
- resolucion por email/telefono/WhatsApp;
- creacion o vinculacion de clientes.

## Relacion con T08, T09, Catalog Service y Sales Agent

T08/T09: los endpoints de compras/comportamiento son validos como lectura historica posterior a identidad verificada. No son resolvers de identidad y no deben recibir IDs inferidos.

Catalog Service: Customer Profile entrega evidencia historica (`productId`, `productAttributeId`, referencias, cantidades, gasto). No resuelve compatibilidad, complementos ni disponibilidad actual. Cualquier recomendacion concreta debe pasar por Catalog/SearchProducts.

Sales Agent: primer consumidor recomendado solo despues de T10B8A debe ser un adapter interno server-side, no una tool expuesta directamente al modelo. El adapter debe recibir `masterCustomerId` solo cuando la sesion nativa lo marque como verificado.

## Patron de Consulta Esperado

Primer patron valido:

1. Resolver identidad del turno en Customer 360.
2. Verificar que el ID es `master_customer.id` local o que Customer Service entrega `customerMasterId` con proyeccion local existente.
3. Llamar Customer Profile bajo demanda.
4. Si Customer Profile responde `customer_not_found`, `customer_not_linked` o `partial`, degradar contexto comercial sin inventar identidad.

No se justifica todavia:

- endpoint nuevo de Customer Profile;
- persistencia nueva;
- Parquet;
- notebook productivo;
- snapshot historico;
- cache de read model;
- descarga preventiva de compras/comportamiento en T10B8A.

Frecuencia de actualizacion esperada: bajo demanda por turno identificado. Snapshots historicos solo se justifican cuando exista consumidor analitico batch o auditoria temporal definida; no son requisito para Sales Agent.

## Trabajo Valido vs Sobreaquitectura

Conservar:

- contratos HTTP actuales;
- validacion estricta de `masterCustomerId`;
- separacion entre `not_found` y `not_linked` en status;
- lectura por `master_customer.id`;
- aislamiento de PrestaShop como source reference;
- tests de contrato y degradacion;
- postura de no resolver identidad dentro de Customer Profile.

Postergar o eliminar de T10B8A:

- consumo de compras/comportamiento antes de resolver identidad;
- nuevas decisiones de persistencia;
- endpoints nuevos;
- notebooks;
- Parquet/object storage;
- read model SQL;
- snapshots historicos;
- normalizacion de IDs por heuristica;
- uso directo de `conversation.customer_id` como `masterCustomerId` sin prueba.

## Roadmap Corregido

1. Obtener contrato o muestra real de Customer Service para el endpoint vigente que reemplaza/confirma `POST /api/pc-users`.
2. Confirmar si la respuesta trae `customerMasterId` o solo `id/customerId`.
3. Verificar en Customer 360 que `NativeCustomerSession.identity.customerId` proviene de una fuente con gate contra `master_customer.id`.
4. Implementar en T10B8A solo el resolver de identidad estructurado:
   - `status: "resolved"` con `masterCustomerId` verificado;
   - `status: "identity_unresolved"` sin llamadas a Customer Profile.
5. Recien despues, agregar un adapter de lectura Customer Profile para Sales Agent, iniciando por `commercial-summary` y `profile`.
6. Dejar `purchased-products` y `purchase-behavior` para una tarea posterior con objetivo comercial especifico.

## Conclusion Congelada

Customer Profile tiene endpoints suficientes para que Sales Agent consuma contexto comercial, pero solo despues de que Customer 360 entregue un `masterCustomerId` verificado. Con la evidencia actual, T10B8A debe aplicar **Caso D** y no personalizar con identidad probable.

