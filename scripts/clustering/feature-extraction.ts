// CP-R2-T01 — Behavioral Clustering V1: read-only TypeScript feature extraction.
//
// Boundary (task Section 20): this script connects read-only to PrestaShop, computes Feature
// Set A/B raw inputs, applies the population policy, and writes a local, gitignored,
// PII-free feature matrix + manifest. It does NOT train anything and NEVER writes to the
// PrestaShop RDS. Preprocessing (log1p/robust-scale/winsorize) happens downstream in Python.
//
// Usage:
//   npx tsx scripts/clustering/feature-extraction.ts [--reference-time=2026-08-19T00:00:00.000Z]
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPrestashopPoolIsReadOnly,
  createPrestashopPool,
  createRfmSnapshotPool,
  loadPrestashopConnectionConfig,
  loadRfmSnapshotConnectionConfig,
} from './lib/db.js';
import { createClusteringPopulationReader } from './lib/population-reader.js';
import { assertNoNaNOrInfinite, buildRawFeatureRow, RAW_FEATURE_COLUMNS, type RawFeatureRow } from './lib/feature-builder.js';
import { resolveReferenceTime, toMysqlDateTime, windowStart365dInclusive } from './lib/reference-time.js';
import { buildDatasetManifest } from './lib/manifest.js';
import { assertNoPiiInClusterManifest, assertNoPiiInFeatureRow } from './lib/pii-guard.js';
import { toCsv } from './lib/csv.js';
import { createRfmSegmentReader } from './lib/rfm-segment-reader.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(SCRIPT_DIR, 'outputs');

async function main(): Promise<void> {
  const startedAt = Date.now();
  const referenceTimeArg = process.argv.find((arg) => arg.startsWith('--reference-time='))?.split('=')[1];
  const referenceTime = resolveReferenceTime(referenceTimeArg ?? process.env.CLUSTERING_REFERENCE_TIME);
  const window365Start = windowStart365dInclusive(referenceTime);

  const prestashopConfig = loadPrestashopConnectionConfig(process.env);
  const prestashopPool = createPrestashopPool(prestashopConfig);

  const rfmSnapshotConfig = loadRfmSnapshotConnectionConfig(process.env);
  const rfmSnapshotPool = rfmSnapshotConfig ? createRfmSnapshotPool(rfmSnapshotConfig) : null;

  try {
    console.info('[clustering] confirming PrestaShop credentials are read-only (SHOW GRANTS)...');
    const grantCheck = await assertPrestashopPoolIsReadOnly(prestashopPool);
    console.info(
      `[clustering] READ_ONLY_CONFIRMED — grantStatements=${grantCheck.grantStatementCount} disallowedPrivileges=[${grantCheck.disallowedPrivileges.join(', ')}]`,
    );

    const reader = createClusteringPopulationReader(
      prestashopPool,
      prestashopConfig.prefix,
      toMysqlDateTime(referenceTime),
      toMysqlDateTime(window365Start),
    );

    console.info(`[clustering] extracting features — referenceTime=${referenceTime}`);
    const extractionStart = Date.now();
    const [orderAggregates, orderStateAggregates, tenureRows, productAggregates] = await Promise.all([
      reader.readOrderAggregates(),
      reader.readOrderStateAggregates(),
      reader.readCustomerTenure(),
      reader.readProductAggregates(),
    ]);
    const extractionDurationMs = Date.now() - extractionStart;

    if (orderAggregates.length === 0) {
      throw new Error('FAIL_FAST: population B′ is empty — aborting rather than producing an empty dataset');
    }

    const stateByCustomer = new Map(orderStateAggregates.map((row) => [row.customerId, row]));
    const tenureByCustomer = new Map(tenureRows.map((row) => [row.customerId, row]));
    const productsByCustomer = new Map<number, (typeof productAggregates)[number][]>();
    for (const row of productAggregates) {
      const group = productsByCustomer.get(row.customerId) ?? [];
      group.push(row);
      productsByCustomer.set(row.customerId, group);
    }

    const seenCustomerIds = new Set<number>();
    const rows: RawFeatureRow[] = orderAggregates.map((orderAggregate) => {
      if (seenCustomerIds.has(orderAggregate.customerId)) {
        throw new Error(`FAIL_FAST: duplicate customerId in population: ${orderAggregate.customerId}`);
      }
      seenCustomerIds.add(orderAggregate.customerId);
      return buildRawFeatureRow({
        referenceTime,
        orderAggregate,
        stateAggregate: stateByCustomer.get(orderAggregate.customerId),
        tenure: tenureByCustomer.get(orderAggregate.customerId),
        productRows: productsByCustomer.get(orderAggregate.customerId) ?? [],
      });
    });

    assertNoNaNOrInfinite(rows);
    for (const row of rows) {
      assertNoPiiInFeatureRow(row as unknown as Record<string, unknown>, RAW_FEATURE_COLUMNS);
    }

    const expectedApprox = 10_139; // audit's 2026-08-18 live estimate — informational only, never hardcoded as a filter
    if (rows.length < expectedApprox * 0.5 || rows.length > expectedApprox * 2) {
      console.warn(
        `[clustering] WARNING: population size ${rows.length} deviates >2x from the readiness audit's 2026-08-18 estimate (${expectedApprox}). Not aborting — re-derived live, not hardcoded — but flag this in the report.`,
      );
    }

    const generatedAt = new Date().toISOString();
    const manifest = buildDatasetManifest({
      referenceTime,
      window365dStartInclusive: window365Start,
      window365dEndExclusive: referenceTime,
      generatedAt,
      rows,
      extractionDurationMs,
    });
    assertNoPiiInClusterManifest(manifest);

    await mkdir(OUTPUT_DIR, { recursive: true });
    const csvRows = rows
      .slice()
      .sort((a, b) => a.customerId - b.customerId)
      .map((row) => row as unknown as Record<string, number>);
    await writeFile(path.join(OUTPUT_DIR, 'features-raw.csv'), toCsv(RAW_FEATURE_COLUMNS as string[], csvRows), 'utf8');
    await writeFile(path.join(OUTPUT_DIR, 'dataset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    let rfmSegmentInfo: Awaited<ReturnType<ReturnType<typeof createRfmSegmentReader>['readCurrentSnapshotInfo']>> = null;
    if (rfmSnapshotPool) {
      console.info('[clustering] reading current published RFM snapshot (read-only, local snapshot DB) for cross-tab...');
      const segmentReader = createRfmSegmentReader(rfmSnapshotPool);
      rfmSegmentInfo = await segmentReader.readCurrentSnapshotInfo();
      const segments = await segmentReader.readCurrentSegments();
      const populationIds = new Set(rows.map((row) => row.customerId));
      const intersected = segments.filter((segment) => populationIds.has(segment.customerId));
      await writeFile(
        path.join(OUTPUT_DIR, 'rfm-segments.csv'),
        toCsv(
          ['customerId', 'rfmCode', 'segmentCode'],
          intersected
            .slice()
            .sort((a, b) => a.customerId - b.customerId)
            .map((row) => ({ customerId: row.customerId, rfmCode: row.rfmCode, segmentCode: row.segmentCode ?? '' })),
        ),
        'utf8',
      );
      console.info(
        `[clustering] RFM cross-tab source: snapshot ${rfmSegmentInfo ? rfmSegmentInfo.snapshotId : 'none'}, ${intersected.length}/${rows.length} population customers matched to a published RFM row`,
      );
    } else {
      console.warn('[clustering] RFM_SNAPSHOT_DB_* not configured — skipping RFM cross-tab source export.');
    }

    const totalDurationMs = Date.now() - startedAt;
    console.info(
      JSON.stringify(
        {
          status: 'ok',
          referenceTime,
          populationSize: rows.length,
          featureNames: manifest.featureNames,
          datasetChecksum: manifest.datasetChecksum,
          extractionDurationMs,
          totalDurationMs,
          rfmSnapshotId: rfmSegmentInfo ? rfmSegmentInfo.snapshotId : null,
          outputDir: OUTPUT_DIR,
        },
        null,
        2,
      ),
    );
  } finally {
    await prestashopPool.end();
    if (rfmSnapshotPool) {
      await rfmSnapshotPool.end();
    }
  }
}

main().catch((error) => {
  console.error('[clustering] FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
