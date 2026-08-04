import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { config } from '../../src/config.js';
import {
  buildDriftWindowVariants,
  buildRfmSnapshotDataset,
  buildRfmSnapshotWindow,
  buildRfmSourceArtifactRow,
  buildRfmSourceFingerprint,
  classifyBaselineComparability,
  compareRfmSourceArtifacts,
  addRfmDecimals,
  divideRfmDecimal,
  formatRfmDecimal,
  rowChecksumVersion,
  sha256Stable,
  stableStringify,
  type RfmSourceArtifactRow,
} from '../../src/domain/customer-rfm/index.js';
import { createMysqlRfmPopulationReader } from '../../src/infrastructure/prestashop/mysql-rfm-population-reader.js';
import { createQueryExecutor } from '../../src/infrastructure/shared/query-executor.js';

const referenceTime = requiredEnv('RFM_REFERENCE_TIME');
const calculationVersion = process.env.RFM_CALCULATION_VERSION || 'rfm-population-v1';
const outputDir = path.resolve('scripts/snapshots/rfm/drift-outputs');
const tables = {
  orders: `${config.prestashopDb.prefix}orders`,
  customer: `${config.prestashopDb.prefix}customer`,
  currency: `${config.prestashopDb.prefix}currency`,
};

const pool = mysql.createPool({
  host: config.prestashopDb.host,
  port: config.prestashopDb.port,
  user: config.prestashopDb.user,
  password: config.prestashopDb.password,
  database: config.prestashopDb.database,
  connectionLimit: 2,
  dateStrings: true,
  timezone: 'Z',
});

try {
  await mkdir(outputDir, { recursive: true });
  const window = buildRfmSnapshotWindow(referenceTime);
  const connection = await pool.getConnection();
  try {
    const rows = await readCurrentSourceRows(connection, window.windowStartInclusive, window.windowEndExclusive);
    const reader = createMysqlRfmPopulationReader(
      createQueryExecutor(pool, config.prestashopDb.queryTimeoutMs),
      config.prestashopDb.prefix,
    );
    await reader.verifySchema();
    const diagnostics = await reader.readDiagnostics(toMysqlDateTime(window.windowStartInclusive), toMysqlDateTime(window.windowEndExclusive));
    const sourceRows = await reader.readPopulation(toMysqlDateTime(window.windowStartInclusive), toMysqlDateTime(window.windowEndExclusive));
    const built = buildRfmSnapshotDataset({
      ...window,
      generatedAt: new Date().toISOString(),
      calculationVersion,
      sourceRows,
      diagnostics,
    });
    const postReference = await readPostReferenceUpdateAnalysis(connection, window.windowStartInclusive, window.windowEndExclusive);
    const postReferenceSummary = postReference.summary as { readonly ordersUpdatedAfterReferenceTime?: string | number };
    const sourceBounds = await readSourceBounds(connection, window.windowStartInclusive, window.windowEndExclusive);
    const fingerprint = buildRfmSourceFingerprint({
      referenceTime: window.referenceTime,
      windowStartInclusive: window.windowStartInclusive,
      windowEndExclusive: window.windowEndExclusive,
      rows,
      validOrderCount: built.manifest.validOrderCount,
      minOrderDateAdd: sourceBounds.minOrderDateAdd,
      maxOrderDateAdd: sourceBounds.maxOrderDateAdd,
      maxOrderDateUpd: sourceBounds.maxOrderDateUpd,
      distinctShopCount: built.manifest.distinctShopCount,
      distinctCurrencyCount: built.manifest.distinctCurrencyCount,
      distinctConversionRateCount: diagnostics.currency.distinctConversionRateCount,
      zeroAmountOrderCount: built.manifest.zeroAmountOrderCount,
      ordersUpdatedAfterReferenceTime: Number(postReferenceSummary.ordersUpdatedAfterReferenceTime ?? 0),
      sourceChecksum: built.sourceChecksum,
    });
    const variants = await readWindowVariants(connection, referenceTime);
    const boundary = await readBoundaryAnalysis(connection, window.windowStartInclusive, window.windowEndExclusive);
    const timezone = await readTimezoneAnalysis(connection);
    const comparison = await compareBaselineIfPresent(rows);
    const verdict = {
      verdict: comparison.baselineComparability === 'ROW_ARTIFACT' ? 'BLOCKED_BY_INSUFFICIENT_EVIDENCE' : 'SOURCE_DRIFT_BASELINE_NOT_COMPARABLE',
      timezoneStatus: timezone.timezoneStatus,
      baselineComparability: comparison.baselineComparability,
      likelyFactors: [
        'T11A0 aggregate used end_plus_one_utc_day window semantics',
        'baseline row artifact is not available',
        'current source is mutable and current +1 day variant no longer reproduces the T11A0 aggregate',
      ],
      generatedAt: new Date().toISOString(),
    };

    await writeJson('current-source-rows.json', rows);
    await writeJson('current-source-fingerprint.json', fingerprint);
    await writeJson('window-variant-comparison.json', variants);
    await writeJson('post-reference-update-analysis.json', postReference);
    await writeJson('boundary-analysis.json', boundary);
    await writeJson('timezone-analysis.json', timezone);
    await writeJson('dataset-comparison.json', comparison);
    await writeJson('drift-verdict.json', verdict);
    console.info(stableStringify({ fingerprint, comparison, verdict }));
  } finally {
    connection.release();
  }
} finally {
  await pool.end();
}

async function readCurrentSourceRows(
  connection: mysql.PoolConnection,
  windowStartInclusive: string,
  windowEndExclusive: string,
): Promise<readonly RfmSourceArtifactRow[]> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `
      SELECT
        o.id_customer AS prestashopCustomerId,
        MIN(o.date_add) AS firstValidOrderAtInWindow,
        MAX(o.date_add) AS lastValidOrderAtInWindow,
        COUNT(DISTINCT o.id_order) AS frequencyOrders,
        COALESCE(SUM(o.total_paid_tax_incl), 0) AS grossOrderValueTaxIncl,
        COUNT(DISTINCT o.id_shop) AS distinctShopCount
      FROM ${tables.orders} o
      INNER JOIN ${tables.customer} c
        ON c.id_customer = o.id_customer
      WHERE o.valid = 1
        AND o.id_customer > 0
        AND o.date_add >= ?
        AND o.date_add < ?
      GROUP BY o.id_customer
      ORDER BY o.id_customer ASC
    `,
    [toMysqlDateTime(windowStartInclusive), toMysqlDateTime(windowEndExclusive)],
  );
  return rows.map((row) => {
    const frequencyOrders = Number(row.frequencyOrders);
    const grossOrderValueTaxIncl = formatRfmDecimal(String(row.grossOrderValueTaxIncl ?? '0'));
    return buildRfmSourceArtifactRow({
      prestashopCustomerId: Number(row.prestashopCustomerId),
      firstValidOrderAtInWindow: String(row.firstValidOrderAtInWindow),
      lastValidOrderAtInWindow: String(row.lastValidOrderAtInWindow),
      frequencyOrders,
      grossOrderValueTaxIncl,
      averageOrderValueTaxIncl: divideRfmDecimal(grossOrderValueTaxIncl, frequencyOrders),
      distinctShopCount: Number(row.distinctShopCount),
    });
  });
}

async function readWindowVariants(connection: mysql.PoolConnection, referenceTimeRaw: string): Promise<readonly Record<string, unknown>[]> {
  const variants = buildDriftWindowVariants(referenceTimeRaw);
  const current = variants.find((variant) => variant.name === 'current_utc');
  if (!current) throw new Error('current_utc variant missing');
  const currentAggregate = await readVariantAggregate(connection, current.windowStartInclusive, current.windowEndExclusive, current.endComparison);
  const outputs: Record<string, unknown>[] = [];
  for (const variant of variants) {
    const aggregate = await readVariantAggregate(connection, variant.windowStartInclusive, variant.windowEndExclusive, variant.endComparison);
    outputs.push({
      ...variant,
      ...aggregate,
      differenceVersusCurrent: {
        activeCustomerCount: aggregate.activeCustomerCount - currentAggregate.activeCustomerCount,
        validOrderCount: aggregate.validOrderCount - currentAggregate.validOrderCount,
        grossOrderValueTaxIncl: signedDecimalDifference(aggregate.grossOrderValueTaxIncl, currentAggregate.grossOrderValueTaxIncl),
      },
    });
  }
  return outputs;
}

async function readVariantAggregate(
  connection: mysql.PoolConnection,
  windowStartInclusive: string,
  windowEndExclusive: string,
  endComparison: '<' | '<=',
): Promise<{
  readonly activeCustomerCount: number;
  readonly validOrderCount: number;
  readonly grossOrderValueTaxIncl: string;
  readonly sourceChecksum: string;
}> {
  const rows = await readVariantRows(connection, windowStartInclusive, windowEndExclusive, endComparison);
  return {
    activeCustomerCount: rows.length,
    validOrderCount: rows.reduce((sum, row) => sum + row.frequencyOrders, 0),
    grossOrderValueTaxIncl: addRfmDecimals(rows.map((row) => row.grossOrderValueTaxIncl)),
    sourceChecksum: sha256Stable({
      rowChecksumVersion,
      windowStartInclusive,
      windowEndExclusive,
      endComparison,
      rows,
    }),
  };
}

async function readVariantRows(
  connection: mysql.PoolConnection,
  windowStartInclusive: string,
  windowEndExclusive: string,
  endComparison: '<' | '<=',
): Promise<readonly RfmSourceArtifactRow[]> {
  const endPredicate = endComparison === '<=' ? 'o.date_add <= ?' : 'o.date_add < ?';
  const [rows] = await connection.execute<RowDataPacket[]>(
    `
      SELECT
        o.id_customer AS prestashopCustomerId,
        MIN(o.date_add) AS firstValidOrderAtInWindow,
        MAX(o.date_add) AS lastValidOrderAtInWindow,
        COUNT(DISTINCT o.id_order) AS frequencyOrders,
        COALESCE(SUM(o.total_paid_tax_incl), 0) AS grossOrderValueTaxIncl,
        COUNT(DISTINCT o.id_shop) AS distinctShopCount
      FROM ${tables.orders} o
      INNER JOIN ${tables.customer} c
        ON c.id_customer = o.id_customer
      WHERE o.valid = 1
        AND o.id_customer > 0
        AND o.date_add >= ?
        AND ${endPredicate}
      GROUP BY o.id_customer
      ORDER BY o.id_customer ASC
    `,
    [toMysqlDateTime(windowStartInclusive), toMysqlDateTime(windowEndExclusive)],
  );
  return rows.map((row) => {
    const frequencyOrders = Number(row.frequencyOrders);
    const grossOrderValueTaxIncl = formatRfmDecimal(String(row.grossOrderValueTaxIncl ?? '0'));
    return buildRfmSourceArtifactRow({
      prestashopCustomerId: Number(row.prestashopCustomerId),
      firstValidOrderAtInWindow: String(row.firstValidOrderAtInWindow),
      lastValidOrderAtInWindow: String(row.lastValidOrderAtInWindow),
      frequencyOrders,
      grossOrderValueTaxIncl,
      averageOrderValueTaxIncl: divideRfmDecimal(grossOrderValueTaxIncl, frequencyOrders),
      distinctShopCount: Number(row.distinctShopCount),
    });
  });
}

async function readPostReferenceUpdateAnalysis(
  connection: mysql.PoolConnection,
  windowStartInclusive: string,
  windowEndExclusive: string,
): Promise<Record<string, unknown>> {
  const params = [toMysqlDateTime(windowStartInclusive), toMysqlDateTime(windowEndExclusive), toMysqlDateTime(windowEndExclusive)];
  const [summaryRows] = await connection.execute<RowDataPacket[]>(
    `
      SELECT
        COUNT(*) AS ordersUpdatedAfterReferenceTime,
        COUNT(DISTINCT id_customer) AS customersAffectedByPostReferenceUpdates,
        COALESCE(SUM(total_paid_tax_incl), 0) AS grossMonetaryOfOrdersUpdatedAfterReferenceTime,
        COALESCE(SUM(CASE WHEN valid = 1 THEN 1 ELSE 0 END), 0) AS validOrdersUpdatedAfterReferenceTime,
        COALESCE(SUM(CASE WHEN valid = 0 THEN 1 ELSE 0 END), 0) AS invalidOrdersUpdatedAfterReferenceTime
      FROM ${tables.orders}
      WHERE date_add >= ?
        AND date_add < ?
        AND date_upd >= ?
    `,
    params,
  );
  const [byValid] = await connection.execute<RowDataPacket[]>(
    `
      SELECT valid, COUNT(*) AS orders, COUNT(DISTINCT id_customer) AS customers, COALESCE(SUM(total_paid_tax_incl), 0) AS monetary
      FROM ${tables.orders}
      WHERE date_add >= ? AND date_add < ? AND date_upd >= ?
      GROUP BY valid
      ORDER BY valid
    `,
    params,
  );
  const [byState] = await connection.execute<RowDataPacket[]>(
    `
      SELECT current_state AS currentState, COUNT(*) AS orders, COUNT(DISTINCT id_customer) AS customers, COALESCE(SUM(total_paid_tax_incl), 0) AS monetary
      FROM ${tables.orders}
      WHERE date_add >= ? AND date_add < ? AND date_upd >= ?
      GROUP BY current_state
      ORDER BY current_state
    `,
    params,
  );
  const [byShop] = await connection.execute<RowDataPacket[]>(
    `
      SELECT id_shop AS shopId, COUNT(*) AS orders, COUNT(DISTINCT id_customer) AS customers, COALESCE(SUM(total_paid_tax_incl), 0) AS monetary
      FROM ${tables.orders}
      WHERE date_add >= ? AND date_add < ? AND date_upd >= ?
      GROUP BY id_shop
      ORDER BY id_shop
    `,
    params,
  );
  const [byUpdateDate] = await connection.execute<RowDataPacket[]>(
    `
      SELECT DATE(date_upd) AS updateDate, COUNT(*) AS orders, COUNT(DISTINCT id_customer) AS customers, COALESCE(SUM(total_paid_tax_incl), 0) AS monetary
      FROM ${tables.orders}
      WHERE date_add >= ? AND date_add < ? AND date_upd >= ?
      GROUP BY DATE(date_upd)
      ORDER BY updateDate
    `,
    params,
  );
  return {
    summary: normalizeObject(summaryRows[0] ?? {}),
    byValid: byValid.map(normalizeObject),
    byCurrentState: byState.map(normalizeObject),
    byShop: byShop.map(normalizeObject),
    byUpdateDate: byUpdateDate.map(normalizeObject),
    note: 'date_upd proves a post-reference update happened, not which RFM-relevant column changed.',
  };
}

async function readBoundaryAnalysis(
  connection: mysql.PoolConnection,
  windowStartInclusive: string,
  windowEndExclusive: string,
): Promise<readonly Record<string, unknown>[]> {
  const windows = [
    ['start_minus_24h', addMysqlHours(windowStartInclusive, -24), toMysqlDateTime(windowStartInclusive)],
    ['start_minus_1h', addMysqlHours(windowStartInclusive, -1), toMysqlDateTime(windowStartInclusive)],
    ['start_plus_1h', toMysqlDateTime(windowStartInclusive), addMysqlHours(windowStartInclusive, 1)],
    ['start_plus_24h', toMysqlDateTime(windowStartInclusive), addMysqlHours(windowStartInclusive, 24)],
    ['end_minus_24h', addMysqlHours(windowEndExclusive, -24), toMysqlDateTime(windowEndExclusive)],
    ['end_minus_1h', addMysqlHours(windowEndExclusive, -1), toMysqlDateTime(windowEndExclusive)],
    ['end_plus_1h', toMysqlDateTime(windowEndExclusive), addMysqlHours(windowEndExclusive, 1)],
    ['end_plus_24h', toMysqlDateTime(windowEndExclusive), addMysqlHours(windowEndExclusive, 24)],
  ] as const;
  const outputs: Record<string, unknown>[] = [];
  for (const [name, start, end] of windows) {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `
        SELECT
          COUNT(DISTINCT id_order) AS orderCount,
          COUNT(DISTINCT id_customer) AS customerCount,
          COALESCE(SUM(total_paid_tax_incl), 0) AS grossMonetary,
          MIN(date_add) AS minDateAdd,
          MAX(date_add) AS maxDateAdd
        FROM ${tables.orders}
        WHERE valid = 1
          AND id_customer > 0
          AND date_add >= ?
          AND date_add < ?
      `,
      [start, end],
    );
    outputs.push({ interval: name, start, end, ...normalizeObject(rows[0] ?? {}) });
  }
  return outputs;
}

async function readTimezoneAnalysis(connection: mysql.PoolConnection): Promise<Record<string, unknown>> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    'SELECT @@global.time_zone AS globalTimeZone, @@session.time_zone AS sessionTimeZone, NOW() AS nowValue, UTC_TIMESTAMP() AS utcTimestamp',
  );
  return {
    mysql: normalizeObject(rows[0] ?? {}),
    connectionTimezone: 'mysql2 timezone Z with dateStrings true',
    phpTimezoneEvidence: 'not available in repository/runtime evidence',
    prestashopBackofficeTimezoneEvidence: 'not available in repository/runtime evidence',
    timezoneStatus: 'UNVERIFIED',
  };
}

async function readSourceBounds(
  connection: mysql.PoolConnection,
  windowStartInclusive: string,
  windowEndExclusive: string,
): Promise<{ readonly minOrderDateAdd: string | null; readonly maxOrderDateAdd: string | null; readonly maxOrderDateUpd: string | null }> {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `
      SELECT MIN(o.date_add) AS minOrderDateAdd, MAX(o.date_add) AS maxOrderDateAdd, MAX(o.date_upd) AS maxOrderDateUpd
      FROM ${tables.orders} o
      INNER JOIN ${tables.customer} c ON c.id_customer = o.id_customer
      WHERE o.valid = 1
        AND o.id_customer > 0
        AND o.date_add >= ?
        AND o.date_add < ?
    `,
    [toMysqlDateTime(windowStartInclusive), toMysqlDateTime(windowEndExclusive)],
  );
  return {
    minOrderDateAdd: nullableString(rows[0]?.minOrderDateAdd),
    maxOrderDateAdd: nullableString(rows[0]?.maxOrderDateAdd),
    maxOrderDateUpd: nullableString(rows[0]?.maxOrderDateUpd),
  };
}

async function compareBaselineIfPresent(currentRows: readonly RfmSourceArtifactRow[]): Promise<Record<string, unknown>> {
  const baselinePath = process.env.RFM_DRIFT_BASELINE_FILE;
  if (baselinePath) {
    const parsed = JSON.parse(await readFile(baselinePath, 'utf8')) as unknown;
    const baselineComparability = classifyBaselineComparability(parsed);
    return baselineComparability === 'ROW_ARTIFACT'
      ? { baselineComparability, comparison: compareRfmSourceArtifacts(parsed as RfmSourceArtifactRow[], currentRows) }
      : { baselineComparability };
  }
  return {
    baselineComparability: 'AGGREGATE_ONLY',
    baselineEvidence: {
      source: 'docs/audits/CP-R1-T11A0-rfm-segmentation-source-audit.md',
      activeCustomerCount: 14188,
      validOrderCount: 19616,
      grossOrderValueTaxIncl: '3062422680.170000',
    },
  };
}

async function writeJson(fileName: string, value: unknown): Promise<void> {
  await writeFile(path.join(outputDir, fileName), `${stableStringify(value)}\n`, 'utf8');
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') throw new Error(`${name} is required`);
  return value;
}

function toMysqlDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

function addMysqlHours(iso: string, hours: number): string {
  return toMysqlDateTime(new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString());
}

function normalizeObject(row: RowDataPacket | Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === 'bigint' ? value.toString() : typeof value === 'number' || value === null ? value : String(value),
    ]),
  );
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function signedDecimalDifference(left: string, right: string): string {
  const diff = Number(left) - Number(right);
  return formatRfmDecimal(Math.abs(diff).toFixed(6)).replace(/^/, diff < 0 ? '-' : '');
}
