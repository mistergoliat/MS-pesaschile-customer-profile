# CP-R1-T11B RFM Snapshot Configuration Decoupling

Fecha: 2026-08-14.

## Resumen

CP-R1-T11B desacopla `npm run snapshot:rfm` de la configuracion runtime
general del microservicio. El CLI RFM ya no importa `src/config.ts`, por lo
que deja de exigir variables de CRM, carrier y otras dependencias HTTP ajenas
al snapshot offline.

No agrega clustering, segmentacion comercial, endpoint RFM, scheduler,
integracion Sales Agent ni cambios de identidad canonica.

## Problema Exacto

Antes de T11B, el flujo era:

```text
scripts/snapshots/rfm-snapshot.ts
  -> import ../../src/config.js
     -> valida TODO el runtime del servicio
        -> CRM_DB_*
        -> PRESTASHOP_ORDER_STATE_LANG_ID
        -> PRESTASHOP_CARRIER_LANG_ID
        -> PRESTASHOP_CARRIER_SHOP_ID
```

Ese acoplamiento era incorrecto para T11A, porque el snapshot RFM:

- no consulta CRM;
- no traduce estados de orden;
- no consulta carriers;
- no levanta HTTP.

El efecto visible era el fallo de `tests/unit/rfm-snapshot-cli.test.ts`: el
CLI abortaba por config runtime no relacionada antes de llegar a validar las
variables realmente necesarias para el snapshot.

## Variables Realmente Necesarias Para `snapshot:rfm`

Siempre:

- `PRESTASHOP_DB_HOST`
- `PRESTASHOP_DB_PORT`
- `PRESTASHOP_DB_USER`
- `PRESTASHOP_DB_PASSWORD`
- `PRESTASHOP_DB_NAME`
- `PRESTASHOP_DB_PREFIX`
- `PRESTASHOP_DB_QUERY_TIMEOUT_MS`
- `RFM_REFERENCE_TIME`
- `RFM_CALCULATION_VERSION`
- `RFM_DRY_RUN` (interpretable; `true` habilita dry-run, cualquier otro valor
  mantiene modo persistente)

Solo en persistencia (`RFM_DRY_RUN=false` o ausente):

- `RFM_SNAPSHOT_DB_HOST`
- `RFM_SNAPSHOT_DB_PORT`
- `RFM_SNAPSHOT_DB_USER`
- `RFM_SNAPSHOT_DB_PASSWORD`
- `RFM_SNAPSHOT_DB_NAME`
- `RFM_SNAPSHOT_DB_CONNECTION_LIMIT`

No requeridas por este CLI:

- `CRM_DB_*`
- `PRESTASHOP_ORDER_STATE_LANG_ID`
- `PRESTASHOP_CARRIER_LANG_ID`
- `PRESTASHOP_CARRIER_SHOP_ID`
- `PORT`
- `CUSTOMER_PROFILE_RECENT_ORDERS_LIMIT`

## Decision Arquitectonica

Se agrega un loader dedicado:

- `src/rfm-snapshot-config.ts`

Este modulo valida solo:

- la conexion fuente PrestaShop requerida por el snapshot;
- las variables `RFM_*` del CLI;
- la conexion service-owned de snapshots solo cuando no hay dry-run.

El runtime HTTP conserva su validacion estricta e independiente en:

- `src/config.ts`

El resultado conceptual queda asi:

```text
HTTP runtime
  -> src/config.ts
  -> validacion completa del servicio

RFM snapshot CLI
  -> src/rfm-snapshot-config.ts
  -> validacion minima y especifica del snapshot
```

## Cambios

- `scripts/snapshots/rfm-snapshot.ts`
  ahora carga `loadRfmSnapshotCliConfig()` en vez de importar `src/config.ts`.
- `src/rfm-snapshot-config.ts`
  nuevo modulo de configuracion dedicada para el snapshot RFM.
- `tests/unit/rfm-snapshot-config.test.ts`
  cubre carga dry-run sin CRM/carrier y fail-fast de persistencia.
- `tests/unit/rfm-snapshot-cli.test.ts`
  ahora demuestra que el CLI:
  - no requiere CRM/carrier;
  - sigue fallando rapido cuando falta config realmente necesaria.

## Guardrails Conservados

- No se relajaron validaciones del runtime HTTP.
- El snapshot sigue fallando rapido si falta config PrestaShop requerida.
- La persistencia sigue exigiendo `RFM_SNAPSHOT_DB_*` y no reutiliza `CRM_DB_*`.
- No se agregaron defaults inseguros para CRM, carrier ni runtime HTTP.

## Riesgos Y Deuda Restante

- Otros scripts RFM auxiliares (`rfm-use-case-analysis`, `rfm-source-drift`,
  `rfm-order-monetary-audit`, etc.) todavia importan `src/config.ts`; T11B
  corrige solo el entrypoint productivo `snapshot:rfm`.
- Este cambio no valida conectividad real de PrestaShop o snapshot DB por si
  mismo; solo corrige el desacople de configuracion previo a infraestructura.
- La identidad del snapshot sigue siendo provisional (`prestashop_customer`).

## Out Of Scope Confirmado

T11B no implementa:

- clustering;
- segmentacion comercial;
- endpoint HTTP RFM;
- scheduler;
- integracion Sales Agent;
- migracion a `master_customer`.

## Next Task

**Next Task: CP-R1-T11C — RFM Snapshot Reader and Consumption Contract**

T11C debe agregar el contrato interno/read repository para recuperar el
snapshot RFM vigente y consultar metricas por cliente, antes de exponerlas via
HTTP.
