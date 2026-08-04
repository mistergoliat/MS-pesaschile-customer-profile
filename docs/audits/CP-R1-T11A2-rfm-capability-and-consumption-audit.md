# CP-R1-T11A2 RFM Capability and Consumption Audit

Fecha: 2026-08-04.

Estado: **AUDIT_ONLY_INFRASTRUCTURE_DECISIONS_PAUSED**.

## Veredicto Ejecutivo

La capacidad analitica RFM existe y es aprovechable como dataset offline
deterministico: calcula Recency, Frequency, Monetary, scores, distribuciones,
checksums, fingerprints y diagnostico de outliers. Esa parte debe conservarse.

La persistencia MySQL service-owned, el repositorio transaccional y las
migraciones existen como implementacion local/no trackeada y pruebas unitarias,
pero no fueron ejecutadas contra una base real, no estan conectadas al runtime,
no tienen primer consumidor definido y T11A.1B estaba mal planteada al asumir
persistencia antes de definir consumo. Esa parte debe quedar congelada.

El primer consumidor recomendado es **analista**, mediante artefactos offline
versionados y restringidos. Customer Profile, CRM, Sales Agent y marketing no
deben asumirse consumidores directos del mismo contrato hasta cerrar identidad,
timezone, frecuencia de uso y patron de acceso.

## Alcance De La Auditoria

Esta auditoria detiene temporalmente nuevas decisiones de infraestructura. No
se implementan base, Parquet, endpoint, notebook, object storage, DuckDB ni
scheduler.

La auditoria responde:

- que esta implementado realmente;
- que parte sigue siendo valida;
- que objetivo operativo puede tener;
- quien debe consumir primero;
- que artefactos son necesarios;
- que trabajo fue sobrearquitectura.

## Inventario De Archivos Y Codigo

Estado observado del worktree: los archivos RFM T11A/T11A.1 aparecen como
archivos nuevos no trackeados; `package.json`, `.gitignore` y
`src/infrastructure/prestashop/index.ts` aparecen modificados. Por lo tanto el
estado tecnico existe localmente, pero no debe tratarse como baseline productivo
consolidado.

### Documentos

| Archivo | Estado | Lectura |
|---|---|---|
| `docs/releases/CP-R1-T11A-population-rfm-dataset.md` | Implementacion descrita | Describe dataset offline, versionado, sin endpoints, scheduler ni consumo runtime. |
| `docs/releases/CP-R1-T11A.1-rfm-snapshot-operational-validation.md` | Validacion parcial | Confirma determinismo dry-run y bloqueo por falta de `RFM_SNAPSHOT_DB_*`; timezone `UNVERIFIED`. |
| `docs/releases/CP-R1-T11A.1A-rfm-source-drift-timezone-resolution.md` | Auditoria de drift | Confirma baseline historico no comparable y timezone aun `UNVERIFIED`. |
| `docs/audits/CP-R1-T11A0-rfm-segmentation-source-audit.md` | Baseline agregado | Util para contexto, no comparable fila-a-fila. |

### Dominio RFM

| Archivo | Estado | Lectura |
|---|---|---|
| `src/domain/customer-rfm/date-window.ts` | Valido con reserva | Ventana `[referenceTime - 365d, referenceTime)` en UTC explicito; no verifica timezone comercial de PrestaShop. |
| `src/domain/customer-rfm/dataset.ts` | Valido | Construye rows RFM, manifest, distribuciones, checksums y guardrails. |
| `src/domain/customer-rfm/scoring.ts` | Valido | R/M tie-safe percent rank; F por thresholds versionados candidate v1. |
| `src/domain/customer-rfm/source-drift.ts` | Valido para auditoria | Row artifacts, fingerprints y comparacion de datasets. |
| `src/domain/customer-rfm/timezone-policy.ts` | Valido para investigacion | Variantes temporales; no resuelve la timezone de negocio. |
| `src/domain/customer-rfm/decimal.ts` y `checksum.ts` | Valido | Normalizacion decimal y checksum deterministico. |
| `src/domain/customer-rfm/contracts.ts` | Valido con reserva | Contrato de snapshot provisional basado en `prestashopCustomerId`, no `masterCustomerId`. |

### Aplicacion, Infraestructura Y Scripts

| Archivo | Estado | Lectura |
|---|---|---|
| `src/application/customer-rfm/create-rfm-snapshot.ts` | Valido para batch offline | Orquesta lectura, diagnosticos, build y dry-run/persistencia opcional. |
| `src/infrastructure/prestashop/mysql-rfm-population-reader.ts` | Valido como reader read-only | Extrae poblacion desde PrestaShop y diagnosticos agregados. |
| `scripts/snapshots/rfm-snapshot.ts` | Valido para dry-run; persistencia congelada | Ejecuta CLI; dry-run escribe outputs locales ignorados. Real mode exige `RFM_SNAPSHOT_DB_*`. |
| `scripts/snapshots/rfm-source-drift.ts` | Valido para auditoria | Genera fingerprints, variantes y analisis de drift. |
| `scripts/snapshots/rfm-compare-source-artifacts.ts` | Valido para auditoria | Compara dos artifacts row-level. |
| `src/infrastructure/rfm/mysql-rfm-snapshot-repository.ts` | Sobredisenado hasta definir consumidor | Publicacion transaccional, supersede y checksum persistido existen, pero no fueron probados contra DB real ni conectados a consumo. |
| `migrations/002_create_customer_rfm_snapshot_tables*.sql` | Congelar | SQL existe, no aplicado en base service-owned; no decidir persistencia todavia. |

### Runtime Customer Profile

No hay endpoint RFM ni wiring runtime RFM en:

- `src/bootstrap.ts`;
- `src/http/routes/index.ts`;
- `src/app.ts`.

Los endpoints existentes son profile, commercial-summary, purchased-products,
purchase-behavior y order-status. RFM no es consumido por ninguno.

## Estado De Cada Componente

| Componente | Estado real | Decision |
|---|---|---|
| Dataset RFM | Implementado localmente y probado unitariamente | Conservar. |
| Scoring R/F/M | Implementado localmente | Conservar como `candidate v1`, no como segmentacion comercial final. |
| Determinismo dry-run | Validado en T11A.1A | Conservar evidencia. |
| Baseline historico | No comparable | No usar para regresion ni cierre operacional. |
| Timezone | `UNVERIFIED` | Bloquea uso operacional fino. |
| Identidad | `prestashop_customer` provisional | Valida para analisis offline; no valida como contrato publico Customer Profile. |
| Persistencia MySQL | Codigo y SQL existen; no ejecutados real | Congelar/postergar. |
| Endpoint runtime | No existe | No implementar hasta definir consumidor. |
| Scheduler | No existe | No implementar. |
| Parquet/object storage/DuckDB/notebook | No existe | Evaluar solo tras consumidor. |

## Contrato Actual De Entrada

Entrada del batch RFM:

```text
RFM_REFERENCE_TIME = UTC ISO explicito
RFM_CALCULATION_VERSION = version de calculo
RFM_DRY_RUN = true|false
```

Fuente:

```text
ps_orders
ps_customer
ps_currency
ps_order_detail
```

Ventana:

```text
[referenceTime - 365 dias, referenceTime)
```

Filtros:

```text
ps_orders.valid = 1
id_customer > 0
date_add dentro de ventana
id_customer debe existir en ps_customer
```

Restricciones:

- `referenceTime` debe ser UTC ISO explicito;
- una sola moneda;
- una sola `conversion_rate`;
- sin customer ids inutilizables;
- sin duplicados por customer en el dataset;
- timezone de origen sigue no verificada.

## Contrato Actual De Salida

Salida principal:

- `snapshotKey`;
- `manifest`;
- rows RFM en memoria;
- en dry-run, JSON agregado bajo `scripts/snapshots/rfm/outputs/`.

Row RFM:

```text
prestashopCustomerId
masterCustomerId = null
identityResolutionStatus = provisional
firstValidOrderAt
lastValidOrderAt
recencyDays
frequencyOrders
grossOrderValueTaxIncl
averageOrderValueTaxIncl
distinctShopCount
recencyScore
frequencyScore
monetaryScore
rfmCode
```

Manifest:

- identidad y versiones de politicas;
- ventana;
- conteos activos/historicos/excluidos;
- moneda;
- refunds observados;
- shops;
- distribuciones;
- score cutoffs;
- outlier diagnostics;
- `sourceChecksum`;
- `datasetChecksum`;
- `timezoneStatus = UNVERIFIED`.

No es contrato actual:

- `masterCustomerId` poblado;
- etiquetas comerciales;
- producto recomendado;
- endpoint HTTP;
- read model runtime;
- snapshot publicado real.

## Metricas Realmente Calculadas

Capacidad analitica implementada:

- Recency: dias calendario UTC entre `referenceTime` y ultima orden valida;
- Frequency: `COUNT(DISTINCT id_order)`;
- Monetary: `SUM(total_paid_tax_incl)`, bruto tax-incl;
- Average order value tax-incl;
- R score tie-safe;
- F score por thresholds `1`, `2`, `3`, `4-5`, `6+`;
- M score tie-safe;
- `rfmCode` tecnico `R#F#M#`;
- distribuciones R/F/M;
- distribuciones de scores;
- distribucion de `rfmCode`;
- percentiles p20/p40/p60/p80/p90/p95/p99;
- score cutoffs;
- source checksum;
- dataset checksum;
- source row checksum/fingerprint para drift;
- diagnostico de outliers de frecuencia;
- diagnosticos de moneda, shops, refunds y exclusiones.

No calcula:

- revenue neto;
- refunds neteados;
- margen;
- producto concreto;
- compatibilidad;
- sustitutos o complementos;
- necesidad actual;
- probabilidad predictiva de recompra;
- lifecycle label comercial validado;
- clusters o comunidades.

## Utilidad Comercial

RFM puede soportar decisiones gruesas de priorizacion:

| Decision | Soporte RFM | Condicion |
|---|---|---|
| Cliente nuevo | Parcial | Requiere definir si "nuevo" es primera compra en ventana o primera compra historica. |
| Cliente recurrente | Si | F > 1 dentro de ventana. |
| Cliente valioso | Parcial | M alto, pero es gasto bruto tax-incl, no margen ni net revenue. |
| Cliente inactivo | Parcial | Recency alta dentro de poblacion scoreada; clientes sin compras en ventana no aparecen en rows. |
| Busqueda de segunda compra | Si | F1 con recency reciente puede priorizar follow-up. |
| Reactivacion | Si, grueso | Recency alta y valor historico/monetary; falta consumo runtime. |
| Priorizacion | Si | Ranking agregado por R/F/M y outliers. |

RFM no puede decidir:

- que producto ofrecer;
- si un producto es compatible con compras previas;
- si corresponde complemento o sustituto;
- si existe necesidad actual;
- si un cliente esta en una conversacion de compra activa;
- que mensaje debe redactar Sales Agent.

## Relacion Con T08 Y T09

T08 Purchased Products responde **que compro** el cliente historicamente por
producto/variante. T09 Customer Product Behavior responde **como se distribuye**
ese consumo: repeticion, concentracion, diversidad y shares.

RFM responde **cuan reciente, frecuente y monetariamente intenso** es el cliente
frente a la poblacion. No reemplaza T08/T09. Para uso comercial sano:

- RFM prioriza **a quien mirar primero**;
- T08/T09 explican **que historial de productos tiene**;
- Catalog Service o un motor comercial futuro decide **que oferta/producto es
viable**.

## Relacion Con Catalog Service

La evidencia del repo indica que Catalog Service no consume `master_customer` ni
Customer Profile como flujo productivo. En este servicio, T08 conserva nombres y
referencias historicas; T09 no usa catalogo actual para sustituir historial.

Por lo tanto RFM no debe acoplarse a Catalog Service ahora. Catalog puede ser un
consumidor indirecto futuro solo si existe un caso de uso definido, por ejemplo:

- recibir `masterCustomerId` ya resuelto;
- recibir contexto RFM coarse;
- combinarlo con disponibilidad, precio, compatibilidad y taxonomia.

RFM por si solo no contiene atributos de catalogo.

## Relacion Con Sales Agent

El flujo objetivo documentado es:

```text
incoming message -> Identity Resolver -> master_customer -> Customer Profile
-> active opportunity -> conversational context -> Sales Agent
```

RFM aun no esta en ese flujo. Sales Agent podria consumirlo despues como senal
de priorizacion o tono comercial, no como instruccion de producto.

Contrato futuro seguro para Sales Agent deberia ser derivado, compacto y sin
PII, por ejemplo:

```text
rfmPriority: low|medium|high
recencyBucket
frequencyBucket
monetaryBucket
timezoneStatus
calculationVersion
calculatedAt/referenceTime
```

No debe recibir rows poblacionales, checksums internos ni `prestashopCustomerId`
como identificador publico.

## Consumidores Posibles

| Consumidor | Patron esperado | Contrato recomendado | Estado |
|---|---|---|---|
| Analista | Batch offline, lectura agregada y row artifact restringido | Manifest + source artifact tecnico + notebook opcional futuro | Primer consumidor recomendado. |
| Customer Profile | Lookup por `masterCustomerId` | Read model canonico por cliente, no snapshot provisional PrestaShop | Futuro; requiere identidad canonica. |
| CRM | Segmentos/campos periodicos | Export controlado o tabla CRM-owned | Futuro; requiere definicion comercial y governance. |
| Sales Agent | Contexto por cliente en conversacion | Buckets/priority derivados, no RFM crudo | Futuro; requiere contrato de tool/context. |
| Marketing | Audiencias/lists | Segmentos congelados y trazabilidad de snapshot | Futuro; requiere snapshots historicos y exclusiones. |

## Patron De Consulta Esperado

Decision actual: **no asumir un endpoint**.

Patrones razonables por consumidor:

- Analista: batch offline, lectura de manifest y artifact restringido.
- Customer Profile: lookup puntual por `masterCustomerId`, solo cuando exista
  read model canonico.
- CRM/marketing: export periodico de segmentos, no necesariamente endpoint.
- Sales Agent: contexto por cliente a traves de Customer Profile o Context
  Service, no lectura directa de tabla poblacional.

## Frecuencia De Actualizacion

La frecuencia no debe decidirse desde infraestructura. Debe salir del consumidor:

- Analista: bajo demanda o corrida semanal mientras se valida.
- Marketing: semanal/mensual si hay campanas.
- CRM: diaria solo si se usa para priorizacion operacional real.
- Sales Agent/Customer Profile: no mas fresca que lo necesario para la
  conversacion; probablemente daily snapshot si se justifica, no por request.

Antes de decidir frecuencia debe cerrarse timezone y mutabilidad de fuente.

## Necesidad De Snapshots Historicos

Para analisis y auditoria: si, conviene conservar al menos artifacts
normalizados restringidos para comparar drift futuro.

Para runtime: no demostrado. Snapshots historicos solo son necesarios si:

- marketing necesita audiencias reproducibles;
- CRM necesita explicar por que un cliente entro/salio de un segmento;
- se mediran transiciones RFM en el tiempo;
- se auditara impacto de campanas.

Sin esos consumidores, historicos completos en SQL son prematuros.

## Evaluacion De Persistencia

| Opcion | Evaluacion actual |
|---|---|
| Query bajo demanda | Adecuada para un cliente si se define endpoint y se mide EXPLAIN; no sirve para scores poblacionales tie-safe sin poblacion completa. |
| Notebook | Buen primer paso para analista, pero no debe convertirse en runtime. |
| Parquet | Bueno para artifacts analiticos versionados; no decidir hasta saber volumen/gobierno. |
| Object storage | Util para guardar artifacts restringidos; prematuro sin politica de acceso. |
| DuckDB | Util para analista sobre Parquet/JSON; prematuro como dependencia oficial. |
| Read model SQL | Posible para Customer Profile/CRM, pero requiere identidad canonica y consumidor. |
| Endpoint | No implementar todavia; contrato y consumidor no estan definidos. |
| MySQL snapshot service-owned | Sobredisenado en T11A.1B mientras no exista consumo ni DB real validada. |

## Que Conservar

- Dominio RFM puro: ventana, scoring, dataset, decimales y checksums.
- Reader read-only de poblacion PrestaShop.
- CLI dry-run como herramienta analitica.
- Source fingerprint y comparador row-level.
- Manifest sin PII.
- Tests de determinismo, guardrails, checksum y source drift.
- Documentacion de timezone `UNVERIFIED`.
- Evidencia de baseline no comparable.

## Que Postergar O Eliminar

Postergar:

- migraciones `customer_rfm_snapshot*`;
- repositorio MySQL de snapshot;
- real mode `RFM_DRY_RUN=false`;
- stream supersede/publicacion transaccional;
- endpoint RFM;
- scheduler;
- read model SQL;
- Parquet/object storage/DuckDB/notebook oficial.

Eliminar o reabrir si se quiere limpiar scope:

- cualquier decision que trate `prestashopCustomerId` como identidad publica;
- cualquier roadmap que exija `RFM_SNAPSHOT_DB_*` antes de definir consumidor;
- cualquier promesa de consumo por Customer Profile, CRM, Sales Agent y
  marketing al mismo tiempo.

## Roadmap Corregido

1. Cerrar esta auditoria como freeze de infraestructura.
2. Declarar primer consumidor: analista.
3. Mantener `npm run snapshot:rfm` solo en dry-run para reproducir manifest y
   dataset agregado.
4. Generar y conservar artifact row-level restringido para futuras
   comparaciones de drift.
5. Verificar timezone operacional de `ps_orders.date_add` con evidencia externa
   a MySQL session timezone.
6. Definir etiquetas comerciales solo si negocio acepta reglas derivadas de
   RFM.
7. Decidir si el segundo consumidor sera Customer Profile, CRM, Sales Agent o
   marketing.
8. Para ese consumidor, definir contrato minimo y patron de acceso.
9. Evaluar persistencia recien entonces: archivo analitico, read model SQL,
   export CRM o endpoint.
10. Reabrir migraciones/repositorio solo si el patron elegido necesita SQL
    service-owned.

## Objetivo Operativo Recomendado

Objetivo v1: **priorizacion comercial poblacional offline**.

RFM debe servir para responder:

- quienes compraron recientemente;
- quienes compran repetidamente;
- quienes concentran mayor gasto bruto;
- que clientes F1 recientes conviene empujar hacia segunda compra;
- que clientes con alto valor y alta recency pueden entrar a reactivacion.

No debe servir todavia para:

- recomendar productos;
- disparar mensajes automaticos;
- alimentar runtime Customer Profile;
- publicar audiencias de marketing sin revision;
- tomar decisiones de infraestructura.

## Veredicto Final

**KEEP_ANALYTICAL_CORE__FREEZE_PERSISTENCE__FIRST_CONSUMER_ANALYST**.

T11A es valido como capacidad analitica offline. T11A.1A deja determinismo
actual validado, baseline historico no comparable y timezone sin verificar.
T11A.1B debe considerarse bloqueada y probablemente mal planteada: intento
resolver persistencia antes de resolver consumo.

La siguiente decision no es "donde guardarlo"; es "quien lo consume, para que,
con que contrato y con que frescura".
