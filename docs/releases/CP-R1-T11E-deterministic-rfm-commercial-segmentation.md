# CP-R1-T11E Deterministic RFM Commercial Segmentation

Fecha: 2026-08-14.

## Problema

T11D dejo resuelto el pipeline de snapshot RFM con identidad canonica
determinista, pero el resultado seguia terminando en metricas y scores
tecnicos:

```text
recencyDays
frequencyOrders
grossOrderValueTaxIncl
recencyScore
frequencyScore
monetaryScore
rfmCode
```

Faltaba una capa de segmentacion comercial:

- determinista;
- versionada;
- explicable;
- materializable;
- apta para CRM / Sales Agent / Campaigns futuros;
- distinta de cualquier clustering estadistico.

## Auditoria Previa

Fuentes auditadas antes de definir reglas:

- `src/domain/customer-rfm/contracts.ts`
- `src/domain/customer-rfm/dataset.ts`
- `src/domain/customer-rfm/scoring.ts`
- `scripts/snapshots/rfm/outputs/rfm-snapshot-2026-08-03T00-00-00-000Z-rfm-population-v1.json`
- `docs/releases/CP-R1-T11A-population-rfm-dataset.md`
- `docs/releases/CP-R1-T11A.1-rfm-snapshot-operational-validation.md`
- `docs/releases/CP-R1-T11B-rfm-snapshot-config-decoupling.md`
- `docs/releases/CP-R1-T11C-rfm-snapshot-reader.md`
- `docs/releases/CP-R1-T11D-rfm-canonical-customer-identity.md`
- `docs/releases/CP-R1-T11A3-rfm-analytical-use-case-validation.md`
- `docs/audits/CP-R1-T11A0-rfm-segmentation-source-audit.md`
- `docs/audits/CP-R1-T11A2-rfm-capability-and-consumption-audit.md`

Hallazgos:

- No existia una taxonomia comercial previa implementada en runtime.
- `rfmCode` ya existia como codigo tecnico `R#F#M#`, no como segmento.
- Los docs previos fueron consistentes en no introducir segmentos nombrados
  antes de contar con snapshot persistible.
- El scoring vigente era:
  - Recency: tie-safe percentile rank por valor distinto, menor recency mejor.
  - Frequency: thresholds discretos versionados.
  - Monetary: tie-safe percentile rank por valor distinto, mayor monetary mejor.
- Los thresholds F vigentes en codigo son:
  - F1 = 1 orden
  - F2 = 2 ordenes
  - F3 = 3 ordenes
  - F4 = 4-5 ordenes
  - F5 = 6+ ordenes
- La definicion monetaria vigente es:
  `total_paid_tax_incl` con IVA y shipping incluidos, menos seller-service
  confirmado, sin bajar de 0.

Conclusion de auditoria:

- habia que crear una primera taxonomia comercial nueva;
- no habia una anterior valida que reutilizar;
- la base correcta para T11E era el snapshot RFM offline ya generado, no una
  heuristica teorica.

## Distribucion RFM Observada

Artefacto usado:

`scripts/snapshots/rfm/outputs/rfm-snapshot-2026-08-03T00-00-00-000Z-rfm-population-v1.json`

Fuente:

- snapshot dry-run generado el 2026-08-14;
- sin filas individuales en el repo;
- con manifest y distribuciones agregadas suficientes para medir R/F/M y
  `rfmCodeDistribution`.

Resumen observado:

```text
populationSize = 14164
canonicalCoveragePct = 0.000000
```

Distribucion por `rScore`:

```text
R1 = 2731
R2 = 3385
R3 = 2513
R4 = 2558
R5 = 2977
```

Distribucion por `fScore`:

```text
F1 = 11966
F2 = 1564
F3 = 389
F4 = 186
F5 = 59
```

Distribucion por `mScore`:

```text
M1 = 4294
M2 = 2951
M3 = 2538
M4 = 2440
M5 = 1941
```

Top `rfmCode` observados:

```text
R2F1M1 = 1141
R1F1M1 = 937
R4F1M1 = 714
R3F1M1 = 708
R5F1M1 = 687
R2F1M2 = 648
R1F1M2 = 599
R2F1M4 = 509
R3F1M2 = 492
R2F1M3 = 491
```

`rfmCode` raros (`count <= 3`):

```text
R1F3M2 = 1
R1F4M5 = 1
R2F4M2 = 1
R2F4M3 = 1
R2F4M4 = 1
R3F5M3 = 1
R4F4M3 = 1
R5F3M1 = 1
R5F5M4 = 1
R1F3M4 = 2
R2F5M5 = 2
R3F3M1 = 2
R2F3M2 = 3
R3F5M5 = 3
R4F3M2 = 3
```

Observacion estructural clave:

- `F1` domina el 84,48% de la poblacion;
- por lo tanto, una taxonomia util para PesasChile tenia que distinguir clientes
  recientes de una sola compra, no solo "alto valor" vs "bajo valor";
- habia evidencia suficiente para separar:
  - clientes muy recientes de una compra;
  - clientes recientes de alto valor;
  - repetidores activos / leales;
  - clientes tibios (`R3`);
  - clientes con valor o repeticion historica pero baja recency;
  - hibernantes.

## Taxonomia Seleccionada

Version:

```text
segmentVersion = rfm-commercial-v1
```

Codigos finales:

```ts
type RfmCommercialSegmentCode =
  | 'CHAMPION'
  | 'LOYAL'
  | 'POTENTIAL_LOYAL'
  | 'RECENT_HIGH_VALUE'
  | 'RECENT_ONE_TIME'
  | 'NEEDS_ATTENTION'
  | 'AT_RISK_HIGH_VALUE'
  | 'HIBERNATING';
```

Numero de segmentos:

```text
8
```

## Reglas Exactas

La fuente unica de verdad es `classifyRfmCommercialSegment` en
`src/domain/customer-rfm/segmentation.ts`.

Jerarquia exacta:

```ts
if (r >= 4 && f >= 4 && m >= 4) return 'CHAMPION';
if (r >= 3 && f >= 3) return 'LOYAL';
if (r >= 4 && f === 2) return 'POTENTIAL_LOYAL';
if (r >= 4 && f === 1 && m >= 4) return 'RECENT_HIGH_VALUE';
if (r >= 4 && f === 1) return 'RECENT_ONE_TIME';
if (r === 3) return 'NEEDS_ATTENTION';
if (r <= 2 && (m >= 4 || f >= 3)) return 'AT_RISK_HIGH_VALUE';
return 'HIBERNATING';
```

Propiedades del clasificador:

- cobertura total del dominio valido `5 x 5 x 5 = 125`;
- sin overlap por orden jerarquico explicito;
- sin fallback arbitrario para combinaciones validas;
- reproducible;
- versionado.

## Justificacion Comercial

### CHAMPION

Criterio:

```text
R >= 4 AND F >= 4 AND M >= 4
```

Significado:

- clientes muy recientes;
- repeticion alta;
- gasto alto relativo;
- poblacion pequena y claramente premium.

### LOYAL

Criterio:

```text
R >= 3 AND F >= 3
```

Significado:

- repetidores activos o tibios con evidencia consistente de recurrencia;
- no exige `M >= 4` para no ocultar lealtad real detras del spend relativo.

### POTENTIAL_LOYAL

Criterio:

```text
R >= 4 AND F = 2
```

Significado:

- clientes recientes que ya repitieron al menos una vez;
- todavia no tienen suficiente recurrencia para entrar en `LOYAL`;
- buen candidato futuro a fidelizacion manual.

### RECENT_HIGH_VALUE

Criterio:

```text
R >= 4 AND F = 1 AND M >= 4
```

Significado:

- clientes muy recientes de una sola compra;
- valor relativo alto desde la primera compra;
- conviene separarlos de `RECENT_ONE_TIME`.

### RECENT_ONE_TIME

Criterio:

```text
R >= 4 AND F = 1 AND M <= 3
```

Significado:

- clientes recientes de primera compra o compra unica reciente;
- segmento amplio, coherente con la fuerte concentracion en `F1`.

### NEEDS_ATTENTION

Criterio:

```text
R = 3
```

Significado:

- clientes de recency intermedia;
- ni claramente recientes ni claramente inactivos;
- grupo puente entre activo y en riesgo.

### AT_RISK_HIGH_VALUE

Criterio:

```text
R <= 2 AND (M >= 4 OR F >= 3)
```

Significado:

- clientes con baja recency, pero con senal historica de valor o repeticion;
- la senal comercial importante es que dejaron de comprar recientemente pese a
  haber demostrado calidad historica.

### HIBERNATING

Criterio:

```text
todo lo demas
```

Equivale practicamente a:

```text
R <= 2 AND F <= 2 AND M <= 3
```

Significado:

- baja recency;
- sin suficiente repeticion ni valor relativo para priorizar como `AT_RISK`.

## Distribucion Real Por Segmento

Medida offline aplicando el clasificador T11E sobre `rfmCodeDistribution` del
snapshot exportado:

```text
HIBERNATING       = 4515  (31.876589%)
RECENT_ONE_TIME   = 3142  (22.182999%)
NEEDS_ATTENTION   = 2405  (16.979667%)
AT_RISK_HIGH_VALUE= 1601  (11.303304%)
RECENT_HIGH_VALUE = 1148  ( 8.105055%)
POTENTIAL_LOYAL   =  809  ( 5.711663%)
LOYAL             =  348  ( 2.456933%)
CHAMPION          =  196  ( 1.383790%)
```

Evaluacion:

- la taxonomia no colapsa artificialmente todo en `CHAMPION` o `LOST`;
- reconoce la realidad de PesasChile: gran masa `F1`, pocos repetidores altos,
  y un bloque importante de clientes dormidos;
- `CHAMPION + LOYAL + POTENTIAL_LOYAL` suman 9,55%, lo que deja una capa activa
  util sin inflarla artificialmente;
- `AT_RISK_HIGH_VALUE` es lo bastante grande para ser util, pero no absorbe a
  todos los clientes de baja recency.

## Decision Arquitectonica

Se eligio **materializar durante snapshot**.

Pipeline resultante:

```text
RFM calculation
-> canonical identity resolution
-> deterministic commercial segmentation
-> persisted snapshot row
```

Razon:

- congela la clasificacion historica junto con el snapshot;
- deja `datasetChecksum` sensible al segmento materializado;
- evita re-interpretar silenciosamente scores historicos si una version futura
  cambia reglas;
- mantiene una sola fuente de verdad para `scores -> segment`.

No se implemento derivacion duplicada al leer.

## Schema Y Persistencia

Se agrego migracion aditiva:

- `migrations/003_add_customer_rfm_snapshot_row_segments.sql`
- `migrations/003_add_customer_rfm_snapshot_row_segments.rollback.sql`

Cambios:

- `customer_rfm_snapshot_row.segment_code VARCHAR(64) NULL`
- `customer_rfm_snapshot_row.segment_version VARCHAR(100) NULL`
- indice `(snapshot_id, segment_code)`

Compatibilidad:

- columnas `NULL` para que snapshots historicos sigan legibles;
- no se rellena retroactivamente `segment_code` en filas viejas;
- el reader devuelve `segmentCode = null` / `segmentVersion = null` si la fila
  historica no fue segmentada.

No se agregaron columnas nuevas al header porque el resumen agregado de
segmentos vive en `manifest_json`:

- `segmentVersion`
- `segmentCounts`
- `segmentPercentages`

## Cambios Implementados

Archivos principales:

- `src/domain/customer-rfm/segmentation.ts`
- `src/domain/customer-rfm/contracts.ts`
- `src/domain/customer-rfm/dataset.ts`
- `src/domain/customer-rfm/index.ts`
- `src/infrastructure/rfm/mysql-rfm-snapshot-repository.ts`
- `src/infrastructure/rfm/mysql-rfm-snapshot-reader.ts`
- `migrations/003_add_customer_rfm_snapshot_row_segments.sql`
- `migrations/003_add_customer_rfm_snapshot_row_segments.rollback.sql`

Efectos:

- cada `RfmSnapshotRow` nuevo ahora incluye `segmentCode` y `segmentVersion`;
- el manifest del snapshot expone conteos y porcentajes por segmento;
- el reader interno devuelve segmento cuando la fila lo tiene persistido;
- snapshots historicos sin segmento siguen siendo legibles.

## Tests

Tests agregados o actualizados:

- `tests/unit/customer-rfm-segmentation.test.ts`
- `tests/unit/customer-rfm-dataset.test.ts`
- `tests/unit/create-rfm-snapshot.test.ts`
- `tests/unit/mysql-rfm-snapshot-reader.test.ts`
- `tests/unit/mysql-rfm-snapshot-repository.test.ts`
- `tests/unit/get-current-prestashop-customer-rfm.test.ts`
- `tests/unit/customer-rfm-use-case-analysis.test.ts`
- `tests/unit/customer-rfm-migrations.test.ts`

Cobertura relevante:

1. las 125 combinaciones validas `R x F x M` clasifican exactamente una vez;
2. versionado fijo `rfm-commercial-v1`;
3. limites de cada segmento;
4. reproducibilidad;
5. identidad matched/unmatched no altera la clasificacion;
6. precision monetaria original intacta;
7. metricas R/F/M originales intactas;
8. checksum cambia cuando la row materializada cambia;
9. snapshots historicos con segmento `NULL` siguen legibles;
10. reader devuelve segmento correctamente cuando existe;
11. errores reales de DB siguen propagandose.

## Resultados

Comandos ejecutados:

```bash
npm run typecheck
npm run lint
npm test
```

Resultado:

- `typecheck`: PASS
- `lint`: PASS
- `tests`: PASS (`99` files, `770` tests)

Analisis offline ejecutado:

- lectura del snapshot exportado del repo;
- clasificacion usando `classifyRfmCommercialSegment`;
- medicion real de distribucion por segmento.

`npm run snapshot:rfm` en este entorno:

- no pudo ejecutarse live por falta de
  `RFM_REFERENCE_TIME`, `RFM_CALCULATION_VERSION`,
  `CRM_DB_HOST`, `CRM_DB_USER`, `CRM_DB_PASSWORD`.

Por lo tanto, para T11E la validacion real se hizo sobre el snapshot offline ya
presente en el repo, no sobre una corrida live nueva contra DB.

## Limitaciones

- la distribucion de segmentos reportada viene de un snapshot dry-run offline,
  no de una corrida live nueva en este workspace;
- `canonicalCoveragePct` del artefacto analizado sigue en `0.000000`;
- sigue pendiente la exposicion runtime controlada de estos segmentos;
- la semantica de `current snapshot` no cambia en T11E;
- no hay nombres amigables localizados para usuario final; solo codigos estables.

## Riesgos

- `F1` domina la poblacion; cualquier uso comercial futuro debe reconocer que la
  masa principal es de compra unica reciente o dormida, no de clientes leales;
- `AT_RISK_HIGH_VALUE` mezcla valor alto y repeticion alta en una sola regla; si
  el futuro consumidor necesita separar ambas senales, eso debera ser una
  version nueva (`rfm-commercial-v2`), no una reinterpretacion silenciosa;
- el segmento depende del scoring actual; si R/F/M cambian en una tarea futura,
  debe revisarse la taxonomia completa;
- snapshots historicos pre-T11E seguiran sin segmento persistido.

## Fuera De Alcance

T11E no implementa:

- clustering;
- endpoint HTTP;
- scheduler;
- Sales Agent;
- Campaign Agent;
- descuentos;
- recomendaciones;
- acciones automaticas;
- cambios de identidad canonica;
- recalibracion del scoring R/F/M.

## Deterministic Segment Vs Cluster

Se deja explicito:

```text
RFM deterministic segment != statistical cluster
```

El segmento comercial define una semantica de negocio estable y versionada.
Un clustering futuro, si alguna vez existe, debera convivir en un eje separado
sin redefinir estos codigos.

## Next Task

**CP-R1-T11F - RFM Runtime Exposure and Commercial Consumption Contract**

Objetivo sugerido:

exponer al runtime, por `masterCustomerId`, de forma controlada:

- metricas RFM;
- `segmentCode`;
- `segmentVersion`;
- metadata del snapshot vigente.

No se implementa T11F en esta tarea.
