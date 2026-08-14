# CP-R1-T11C RFM Snapshot Reader and Consumption Contract

Fecha: 2026-08-14.

## Problema

T11A y T11B dejaron resuelto el pipeline offline/manual de snapshots RFM, pero
no existia una capa interna de lectura para consumir esos snapshots desde la
aplicacion.

Sin T11C, cualquier consumidor futuro de RFM tendria que:

- conocer el esquema SQL de `customer_rfm_snapshot`;
- resolver por su cuenta que snapshot se considera vigente;
- leer filas de `customer_rfm_snapshot_row` directamente;
- reimplementar validaciones de fechas, IDs y decimales.

Eso era un acoplamiento indebido entre persistencia y futuros consumidores
HTTP/CRM/Sales Agent.

## Auditoria De Persistencia Actual

Persistencia actual auditada:

- `customer_rfm_snapshot`
- `customer_rfm_snapshot_row`
- `src/infrastructure/rfm/mysql-rfm-snapshot-repository.ts`
- `migrations/002_create_customer_rfm_snapshot_tables.sql`

Hallazgos:

- El header persiste `status`, `reference_time`, `calculation_version`,
  `generated_at`, `published_at`, `population_size`, `currency_code` y
  `dataset_checksum`.
- Las rows persisten `prestashop_customer_id`, `master_customer_id nullable`,
  `identity_resolution_status`, fechas de primera/ultima compra valida, metricas
  R/F/M, scores y `rfm_code`.
- La publicacion real del writer es transaccional:
  `building -> rows -> checksum -> manifest -> supersede previous -> validated -> published`.
- El writer marca como `superseded` solo snapshots `published` del mismo
  publication stream (`identity + policy versions + scoring + calculationVersion`).
- El esquema permite coexistencia de multiples snapshots `published` globales si
  pertenecen a streams/versiones diferentes.
- No existe un `created_at` en el header; la marca temporal materializada es
  `generated_at`, y al publicarse se copia a `published_at`.
- Un cliente ausente del snapshot no tiene fila; no existe representacion de
  R=0/F=0/M=0.

## Arquitectura

T11C agrega esta separacion:

```text
Persistence
  customer_rfm_snapshot
  customer_rfm_snapshot_row
        ↓
CurrentRfmSnapshotReader
        ↓
Application queries
  getCurrentRfmSnapshot
  getCurrentPrestashopCustomerRfm
        ↓
future HTTP / CRM / Sales Agent consumers
```

No se agrega endpoint HTTP en esta tarea.

## Semantica De Current Snapshot

Ambiguedad encontrada:

- el modelo actual garantiza un unico snapshot `published` por stream;
- pero no garantiza un unico snapshot `published` global entre
  `calculationVersion`/policy versions diferentes.

Regla adoptada en T11C:

```text
current snapshot = snapshot con status = 'published'
ordenado por published_at DESC, id DESC
tomando LIMIT 1
```

Justificacion:

- `published` es el unico estado persistido que expresa activacion efectiva;
- `published_at` es la unica marca temporal persistida del acto de publicacion;
- `reference_time` por si solo no expresa vigencia operativa, porque un run
  tardio o un backfill pueden publicar un `reference_time` mas antiguo y el
  writer igual lo deja como `published` en su stream;
- `id DESC` cierra el tie-break de forma determinista.

Limitacion explicita:

- esta semantica resuelve un **current snapshot global**;
- no resuelve todavia “current snapshot por calculationVersion/stream”.

Por eso el contrato expone `calculationVersion`, `identityAuthorityVersion` y
otros metadatos suficientes para que un consumidor sepa exactamente que esta
leyendo.

## Contrato Del Reader

Puerto agregado:

- `src/application/customer-rfm/ports.ts`

Metodos:

```ts
interface CurrentRfmSnapshotReader {
  getCurrentSnapshot(): Promise<CurrentRfmSnapshotMetadata | null>;
  getCurrentPrestashopCustomerRfm(
    prestashopCustomerId: number
  ): Promise<CurrentPrestashopCustomerRfmRecord | null>;
}
```

Semanticas:

- sin snapshots `published` -> `null`
- snapshot vigente existe pero el cliente no esta en ese snapshot -> `null`
- error real de DB -> se propaga

## Identidad Utilizada

La identidad del reader sigue siendo **provisional PrestaShop**.

El identificador de lectura es:

```text
prestashopCustomerId = customer_rfm_snapshot_row.prestashop_customer_id
```

No se presenta como identidad canonica.

`master_customer_id` se expone solo como referencia nullable de trazabilidad,
no como clave primaria del contrato.

## Precision Monetaria

T11C preserva monetary como string decimal:

- `grossOrderValueTaxIncl: string`
- `averageOrderValueTaxIncl: string`

No se convierte a `number`.

La lectura normaliza con el helper decimal RFM existente para mantener formato
determinista sin introducir perdida de precision.

## Tests

Cobertura agregada:

- `tests/unit/mysql-rfm-snapshot-reader.test.ts`
- `tests/unit/get-current-rfm-snapshot.test.ts`
- `tests/unit/get-current-prestashop-customer-rfm.test.ts`

Casos cubiertos:

1. ningun snapshot persistido;
2. snapshot vigente disponible;
3. seleccion determinista del vigente (`published_at DESC, id DESC`);
4. cliente presente;
5. cliente ausente;
6. preservacion de `calculationVersion`;
7. preservacion de `referenceTime`;
8. precision monetaria;
9. aislamiento entre snapshots via `snapshot_id`;
10. propagacion de fallo real de DB.

## Resultados

Validaciones ejecutadas:

```bash
npm run typecheck
npm run lint
npm test
```

T11C no agrego tests de integracion con DB real porque este repo sigue sin una
base service-owned `RFM_SNAPSHOT_DB_*` disponible para validacion real del
adapter.

## Limitaciones

- No hay endpoint HTTP RFM.
- No hay scheduler.
- No hay segmentacion comercial ni clustering.
- No existe todavia reader parametrizado por stream/version.
- La identidad sigue siendo `prestashop_customer`.
- La semantica de timezone comercial de `reference_time` y `date_add` sigue
  dependiendo de las conclusiones previas T11A/T11A.1.

## Deuda Restante

- Si en el futuro conviven multiples streams `published`, un consumidor que
  necesite escoger uno especifico debera usar un contrato mas explicito por
  stream/version.
- Aun falta cablear identidad canonica `master_customer`.
- Aun falta exponer el reader hacia un contrato HTTP o consumidor externo.

## Next Task

**CP-R1-T11D — RFM Canonical Customer Identity Wiring**

Objetivo de T11D:

alinear los registros RFM con `master_customer` / `masterCustomerId`,
manteniendo trazabilidad hacia la identidad PrestaShop original.
