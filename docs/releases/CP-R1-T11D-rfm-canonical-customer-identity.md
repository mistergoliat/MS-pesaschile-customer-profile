# CP-R1-T11D RFM Canonical Customer Identity Wiring

Fecha: 2026-08-14.

## Problema

T11C dejo disponible la lectura del snapshot RFM vigente, pero la identidad del
dataset seguia siendo solo `prestashop_customer_id`.

Eso dejaba pendiente el cableado canonico hacia `master_customer`, que es la
identidad publica real del servicio y la unica que puede interoperar de forma
determinista con el resto del dominio.

La tarea de T11D fue completar ese cableado sin introducir heuristicas de
matching, sin mover segmentacion comercial, sin clustering y sin agregar
endpoints HTTP.

## Auditoria

Archivos y documentos auditados:

- `docs/design/CP-R1-T02-master-customer-population-and-prestashop-link-contract.md`
- `docs/audits/CP-R1-T10B8A-customer-profile-identity-contract-audit.md`
- `src/infrastructure/crm/mysql-master-customer-reader.ts`
- `src/infrastructure/crm/crm-pool.ts`
- `migrations/001_add_master_customer_prestashop_customer_id.sql`
- `src/domain/master-customer-population/classify-match.ts`

Hallazgos confirmados:

- El identificador canonico real es `master_customer.id`.
- El vinculo determinista disponible en este repo es
  `master_customer.prestashop_customer_id`.
- La migracion `001_add_master_customer_prestashop_customer_id.sql` define ese
  link como `UNIQUE`, pero sigue documentada como artefacto de diseno; por eso
  el runtime debe seguir defendiendo el caso ambiguo aunque no deberia ocurrir.
- `classifyIdentityMatch` no es fuente valida para T11D: es un clasificador
  offline por email para poblacion historica, no una resolucion canonica
  runtime.
- No existe en el repo otra tabla o contrato mas autoritativo que demuestre una
  identidad canonica distinta de `master_customer.id` enlazada por
  `prestashop_customer_id`.

Conclusion de auditoria:

```text
masterCustomerId = master_customer.id
fuente de matching = master_customer.prestashop_customer_id
```

## Decision Arquitectonica

Se adopto wiring canonico en generacion de snapshot, no en lectura.

Flujo resultante:

```text
RFM population rows (prestashop_customer_id)
  -> resolver canonico CRM por master_customer.prestashop_customer_id
  -> persistir master_customer_id en customer_rfm_snapshot_row
  -> congelar coverage en manifest y mapping en dataset checksum
```

Justificacion:

- congela historicamente el mapping usado al momento del snapshot;
- evita depender del CRM cada vez que se consulta RFM;
- permite consultar el snapshot vigente por `prestashopCustomerId` y por
  `masterCustomerId`;
- mantiene trazabilidad explicita hacia la identidad PrestaShop original.

No se hizo wiring por heuristica ni read-time lookup por email.

## Tratamiento De Resolucion Canonica

Estados soportados:

- `matched`: existe exactamente una fila `master_customer` para el
  `prestashop_customer_id`.
- `unmatched`: no existe fila canonica.
- `ambiguous`: aparecen multiples filas canonicas para el mismo
  `prestashop_customer_id` de forma defensiva.

Tratamiento operativo:

- `matched` -> se persiste `master_customer_id`.
- `unmatched` -> se persiste `master_customer_id = null`.
- `ambiguous` -> se persiste `master_customer_id = null` y queda auditado en la
  cobertura.
- error de infraestructura/schema/DB -> el snapshot aborta; no se degrada a
  `unmatched`.

## Cambios Implementados

### 1. Resolver canonico CRM

Nuevo adapter:

- `src/infrastructure/crm/mysql-rfm-canonical-identity-resolver.ts`

Comportamiento:

- consulta `master_customer` por lotes usando `prestashop_customer_id IN (...)`;
- devuelve resoluciones por `prestashopCustomerId`;
- resume cobertura:
  `populationSize`, `canonicalMatchedCount`, `canonicalUnmatchedCount`,
  `canonicalAmbiguousCount`, `canonicalCoveragePct`;
- mapea fallas a errores tipados CRM via `crm-read-error.ts`.

### 2. Wiring del snapshot

Archivos principales:

- `src/application/customer-rfm/create-rfm-snapshot.ts`
- `src/domain/customer-rfm/dataset.ts`
- `src/domain/customer-rfm/contracts.ts`
- `src/infrastructure/rfm/mysql-rfm-snapshot-repository.ts`

Cambios:

- `createRfmSnapshot` ahora puede resolver identidad canonica antes de construir
  el dataset.
- cada `RfmSnapshotRow` persiste `masterCustomerId`.
- el `datasetChecksum` ya incluye ese mapping y por lo tanto congela el wiring
  historico.
- el manifest expone:
  `canonicalIdentitySource`, `canonicalMatchedCount`,
  `canonicalUnmatchedCount`, `canonicalAmbiguousCount`,
  `canonicalCoveragePct`.

### 3. Lectura por identidad canonica

Archivos:

- `src/application/customer-rfm/ports.ts`
- `src/application/customer-rfm/get-current-master-customer-rfm.ts`
- `src/infrastructure/rfm/mysql-rfm-snapshot-reader.ts`

Cambios:

- el reader interno ahora soporta:
  `getCurrentMasterCustomerRfm(masterCustomerId)`;
- el contrato sigue soportando lectura por `prestashopCustomerId`;
- si el snapshot vigente contiene mas de una fila para el mismo
  `master_customer_id`, la lectura falla explicitamente.

### 4. CLI offline/manual

Archivos:

- `src/rfm-snapshot-config.ts`
- `scripts/snapshots/rfm-snapshot.ts`

Cambio relevante:

- el CLI de snapshot ahora requiere configuracion CRM porque T11D hace el
  wiring canonico durante la generacion.

Esto no reintroduce acoplamiento con HTTP/carrier/scheduler. El CLI sigue
cargando solo lo necesario para:

- PrestaShop population source;
- CRM canonical identity source;
- snapshot DB solo cuando no es dry-run.

## Schema Y Migraciones

No fue necesaria una migracion nueva en T11D.

Razon:

- `customer_rfm_snapshot_row.master_customer_id` ya existia en el esquema de
  snapshots;
- T11D solo paso de no poblarlo a poblarlo de forma determinista.

## Tests

Cobertura agregada o extendida:

- `tests/unit/mysql-rfm-canonical-identity-resolver.test.ts`
- `tests/unit/create-rfm-snapshot.test.ts`
- `tests/unit/customer-rfm-dataset.test.ts`
- `tests/unit/mysql-rfm-snapshot-reader.test.ts`
- `tests/unit/get-current-prestashop-customer-rfm.test.ts`
- `tests/unit/get-current-rfm-snapshot.test.ts`
- `tests/unit/mysql-rfm-snapshot-repository.test.ts`
- `tests/unit/rfm-snapshot-config.test.ts`
- `tests/unit/rfm-snapshot-cli.test.ts`

Casos cubiertos:

1. match canonico exacto;
2. cliente canonico ausente;
3. duplicidad defensiva `ambiguous`;
4. deduplicacion de ids de entrada al resolver;
5. persistencia y lectura de `master_customer_id`;
6. lectura del snapshot vigente por `masterCustomerId`;
7. colision defensiva si el snapshot vigente contiene mas de una fila para el
   mismo `master_customer_id`;
8. propagacion de errores CRM reales;
9. checksum distinto cuando cambia el wiring canonico;
10. arranque del CLI sin variables ajenas a PrestaShop/CRM/snapshot DB.

## Validacion Ejecutada

Comandos ejecutados:

```bash
npm run typecheck
npm run lint
npm test
```

Resultado:

- `typecheck`: verde
- `lint`: verde
- `tests`: verde (`98` archivos, `756` tests)

Smoke del CLI:

1. `npm run snapshot:rfm`
   - falla fail-fast en config local porque faltan `RFM_REFERENCE_TIME`,
     `RFM_CALCULATION_VERSION` y credenciales CRM obligatorias.

2. `npm run snapshot:rfm` con override minimo de
   `RFM_DRY_RUN`, `RFM_REFERENCE_TIME`, `RFM_CALCULATION_VERSION`,
   `CRM_DB_HOST`, `CRM_DB_USER`, `CRM_DB_PASSWORD`
   - el CLI arranca, entra al flujo de snapshot y falla recien en infraestructura
     externa con `CrmUnavailableError` / `ECONNREFUSED`.

Eso valida que el wiring canonico ya esta integrado en el path real del CLI y
que los errores CRM no se esconden.

## Riesgos Y Deuda Restante

- La cobertura real de `master_customer_id` no pudo medirse en este entorno
  porque no hay credenciales CRM operativas para consultar la fuente canonica.
- El caso `ambiguous` deberia ser imposible si la restriccion unica de
  `master_customer.prestashop_customer_id` esta realmente aplicada en produccion;
  se mantiene defensivamente porque el repo no prueba ese estado del schema real.
- El reader actual sigue definiendo "snapshot vigente" como el ultimo
  `published` global (`published_at DESC, id DESC`), no por stream/version.
- Todavia no existe endpoint HTTP RFM ni scheduler ni integracion Sales Agent.

## Fuera De Alcance Confirmado

T11D no implementa:

- clustering;
- segmentacion comercial;
- endpoint HTTP RFM;
- scheduler;
- integracion CRM/Sales Agent adicional;
- heuristicas por email;
- refactors amplios fuera del wiring canonico.

## Next Task

**CP-R1-T11E - Deterministic RFM Commercial Segmentation**

La siguiente tarea debe apoyarse en el snapshot ya cableado con identidad
canonica persistida, sin rehacer el mapping en runtime.
