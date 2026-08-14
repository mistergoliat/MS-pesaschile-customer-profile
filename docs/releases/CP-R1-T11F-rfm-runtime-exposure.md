# CP-R1-T11F RFM Runtime Exposure

Fecha: 2026-08-14.

## Objetivo

Exponer la capacidad RFM ya persistida como contrato runtime del servicio,
manteniendo:

- identidad canonica por `masterCustomerId`;
- metricas crudas R/F/M;
- scores;
- `rfmCode`;
- segmento persistido;
- metadata del snapshot vigente;
- semantica historica cuando un snapshot viejo no tenga segmento.

No se implemento automatizacion comercial, scheduler, clustering ni consumo
desde Sales Agent.

## Auditoria HTTP

Se audito:

- `src/http/routes/index.ts`
- `src/app.ts`
- `src/bootstrap.ts`
- `README.md`
- `tests/integration/customer-profile-route.test.ts`
- `tests/integration/customer-order-status-route.test.ts`
- `tests/integration/customer-commercial-summary-route.test.ts`
- `tests/integration/customer-purchased-products-route.test.ts`
- `tests/integration/customer-purchase-behavior-route.test.ts`

Hallazgos:

- El repo no usa controllers separados ni middleware de auth propio; el patron es
  `route -> use-case -> adapters`.
- La validacion HTTP vive inline en `src/http/routes/index.ts` con Zod y parsing
  explicito.
- Las rutas existentes mapean errores de input a `400`, ausencia funcional a
  `404`, degradacion conocida a `503` y excepciones inesperadas a `500`.
- Las respuestas actuales usan contratos JSON explicitos por endpoint, sin
  OpenAPI local.
- El repo no implementa autenticacion service-to-service interna; esto ya estaba
  documentado en T03/T06/T12A y se mantiene igual en T11F.
- Los endpoints actuales expuestos en runtime usan `customerId` directo de
  PrestaShop, pero T11F necesitaba una excepcion deliberada: RFM se construye y
  se consume contra identidad canonica `master_customer.id`.

## Endpoint Final

Ruta agregada:

```http
GET /v1/customers/:masterCustomerId/rfm
```

Identidad publica del endpoint:

```text
masterCustomerId = master_customer.id
```

Se eligio este path para mantener consistencia de familia `/v1/customers/...`
sin romper los endpoints existentes por `customerId`.

## Contrato De Respuesta

Caso disponible:

```json
{
  "status": "available",
  "masterCustomerId": "9001",
  "snapshot": {
    "snapshotId": "55",
    "calculationVersion": "rfm-population-v1",
    "referenceTime": "2026-08-03T00:00:00.000Z",
    "publishedAt": "2026-08-03T01:00:00.000Z",
    "currencyCode": "CLP"
  },
  "rfm": {
    "recencyDays": 2,
    "frequencyOrders": 3,
    "grossOrderValueTaxIncl": "123456.780000",
    "averageOrderValueTaxIncl": "41152.260000",
    "recencyScore": 5,
    "frequencyScore": 3,
    "monetaryScore": 4,
    "rfmCode": "R5F3M4"
  },
  "segment": {
    "code": "LOYAL",
    "version": "rfm-commercial-v1"
  },
  "contractVersion": "customer-rfm-runtime-v1"
}
```

Propiedades:

- preserva metricas crudas;
- preserva precision monetaria como string decimal;
- expone scores y `rfmCode`;
- expone el segmento persistido, no recalculado en request-time;
- expone metadata suficiente para que un consumidor calcule staleness si lo
  necesita luego.

## Identidad Usada

El endpoint no usa `prestashopCustomerId` como identidad publica.

Internamente:

```text
masterCustomerId
-> current RFM snapshot lookup por master_customer_id
```

Puede seguir existiendo soporte interno por PrestaShop en adapters/test fixtures,
pero el contrato publico preferido del endpoint es canonico.

## Semantica De Ausencia

### 1. Cliente sin RFM

Si existe snapshot publicado pero el cliente canonico no tiene fila en ese
snapshot:

```json
{
  "status": "rfm_not_available",
  "masterCustomerId": "9001",
  "reason": "no_current_rfm_record",
  "contractVersion": "customer-rfm-runtime-v1"
}
```

HTTP:

```text
404
```

### 2. Master customer inexistente

```json
{
  "status": "customer_not_found",
  "masterCustomerId": "9999",
  "contractVersion": "customer-rfm-runtime-v1"
}
```

HTTP:

```text
404
```

### 3. Ningun snapshot publicado

Esto no se trata como 404 de cliente.

```json
{
  "status": "degraded",
  "masterCustomerId": "9001",
  "reason": "no_published_rfm_snapshot",
  "contractVersion": "customer-rfm-runtime-v1"
}
```

HTTP:

```text
503
```

## Snapshots Pre-T11E

Si el snapshot vigente es historico y no trae segmentacion materializada:

```json
{
  "segment": {
    "code": null,
    "version": null
  }
}
```

No se recalcula el segmento silenciosamente en runtime.

Esto preserva la semantica historica y evita reinterpretar snapshots viejos con
reglas nuevas.

## Manejo De Errores

Politica aplicada:

- `400` para `masterCustomerId` invalido, query params no soportados o body en
  GET;
- `404` para `customer_not_found` y `rfm_not_available`;
- `503` para `no_published_rfm_snapshot`;
- `500` para errores inesperados de infraestructura o lectura.

Los errores de DB no se convierten en `404`.

Las respuestas `500` siguen devolviendo:

```json
{ "error": "internal_error" }
```

sin filtrar detalles internos.

## Auth

T11F mantiene exactamente el modelo actual del repo:

```text
no hay autenticacion service-to-service implementada dentro del servicio
```

Consecuencia:

- el endpoint no agrega auth propia;
- un header `Authorization` no cambia el comportamiento del handler;
- cualquier control de acceso debe seguir viviendo fuera de este repo.

Esto se documento en README y se cubrio en integracion para no inventar una
politica especial solo para RFM.

## Performance / Query Path

Path implementado:

```text
HTTP route
-> getCustomerRfm use-case
-> CurrentRfmSnapshotReader.getCurrentMasterCustomerRfmLookup(masterCustomerId)
-> MasterCustomerReader.findById(masterCustomerId) solo si falta la row
```

Coste esperado:

- caso encontrado: 2 queries (`current snapshot` + `row por master_customer_id`);
- caso sin row: 3 queries maximas (`current snapshot` + `row` + `master_customer`);
- sin N+1;
- sin recalculo RFM;
- sin lecturas a PrestaShop para este endpoint.

La semantica de snapshot vigente se conserva exactamente:

```sql
status = 'published'
ORDER BY published_at DESC, id DESC
LIMIT 1
```

## Cambios Implementados

Archivos principales:

- `src/application/customer-rfm/get-customer-rfm.ts`
- `src/application/customer-rfm/ports.ts`
- `src/domain/customer-rfm/contracts.ts`
- `src/http/routes/index.ts`
- `src/bootstrap.ts`
- `src/index.ts`
- `src/config.ts`
- `src/infrastructure/rfm/mysql-rfm-snapshot-reader.ts`
- `src/infrastructure/rfm/rfm-snapshot-pool.ts`
- `README.md`

Soporte adicional:

- exportes en `src/contracts/index.ts`
- wiring de tests/integracion existentes por la nueva dependencia `getCustomerRfm`

## Tests

Tests agregados:

- `tests/unit/get-customer-rfm.test.ts`
- `tests/integration/customer-rfm-route.test.ts`

Tests actualizados:

- `tests/unit/get-current-prestashop-customer-rfm.test.ts`
- `tests/unit/get-current-rfm-snapshot.test.ts`
- `tests/integration/customer-profile-route.test.ts`
- `tests/integration/customer-order-status-route.test.ts`
- `tests/integration/customer-commercial-summary-route.test.ts`
- `tests/integration/customer-purchased-products-route.test.ts`
- `tests/integration/customer-purchase-behavior-route.test.ts`

Cobertura relevante:

1. master customer con RFM vigente;
2. presencia de metricas R/F/M;
3. presencia de scores;
4. presencia de `rfmCode`;
5. presencia de `segmentCode`;
6. presencia de `segmentVersion`;
7. presencia de snapshot metadata;
8. cliente sin row RFM;
9. ningun snapshot publicado;
10. snapshot historico con segmento `null`;
11. error DB no mapeado a not-found;
12. `masterCustomerId` invalido;
13. comportamiento sin auth interna;
14. header `Authorization` sin efecto dentro del repo;
15. precision monetaria preservada;
16. no exposicion de `prestashopCustomerId` como identidad principal;
17. semantica T11C de current snapshot intacta;
18. no recalculo de segmentacion en request-time.

## Resultados

Validaciones ejecutadas:

```bash
npm run typecheck
npm run lint
npm test
npx vitest run --config vitest.config.ts tests/integration/customer-rfm-route.test.ts
```

Resultado:

- `typecheck`: PASS
- `lint`: PASS
- `tests`: PASS (`101` files, `785` tests)
- smoke HTTP de la ruta RFM: PASS (`9` tests)

## Limitaciones

- no existe auth service-to-service dentro del repo;
- `/health/ready` no fue rediseñado para reflejar explicitamente la dependencia
  del snapshot RFM;
- el endpoint nuevo convive con rutas existentes por `customerId`, por lo que la
  identidad publica del servicio queda mixta hasta una tarea de unificacion
  posterior;
- snapshots historicos pre-T11E siguen pudiendo devolver `segment.code = null`.

## Fuera De Alcance

T11F no implementa:

- clustering;
- scheduler;
- Sales Agent;
- Campaign Agent;
- campañas;
- descuentos;
- recomendaciones;
- consumo CRM automático;
- cambios de scoring;
- `rfm-commercial-v2`;
- cambios a identidad canonica.

## Siguiente Decision

T11F no fija clustering como siguiente paso.

Las alternativas naturales quedan:

- **CP-R1-T11G - RFM Snapshot Scheduling and Publication Operations**
- **CP-R1-T11H - CRM / Sales Agent RFM Consumption Adapter**

La eleccion debe depender de si el mecanismo operacional de snapshots ya es
fiable sin CLI manual.
