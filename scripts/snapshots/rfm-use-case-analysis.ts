import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { createRfmSnapshot } from '../../src/application/customer-rfm/create-rfm-snapshot.js';
import { config } from '../../src/config.js';
import {
  buildRfmUseCaseAnalysis,
  parseReferenceTime,
  stableStringify,
  type HistoricalRfmOrderInput,
  type RfmStabilitySnapshotInput,
  type RfmUseCaseAnalysis,
} from '../../src/domain/customer-rfm/index.js';
import { createMysqlRfmPopulationReader } from '../../src/infrastructure/prestashop/mysql-rfm-population-reader.js';
import { createQueryExecutor } from '../../src/infrastructure/shared/query-executor.js';

const referenceTime = requiredUtcReferenceTime('RFM_REFERENCE_TIME');
const calculationVersion = requiredEnv('RFM_CALCULATION_VERSION');
const analysisReferenceTimes = parseOptionalReferenceTimes(process.env.RFM_ANALYSIS_REFERENCE_TIMES);
const outputDir = path.resolve('scripts/snapshots/rfm/use-case-outputs');
const tables = {
  orders: `${config.prestashopDb.prefix}orders`,
  customer: `${config.prestashopDb.prefix}customer`,
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
  const base = await readAnalysisInputs(referenceTime);
  const stabilitySnapshots: RfmStabilitySnapshotInput[] = [];
  for (const stabilityReferenceTime of analysisReferenceTimes) {
    if (stabilityReferenceTime === referenceTime) continue;
    stabilitySnapshots.push(await readAnalysisInputs(stabilityReferenceTime));
  }

  const analysis = buildRfmUseCaseAnalysis({
    referenceTime,
    calculationVersion,
    operationalRows: base.operationalRows,
    historicalOrders: base.historicalOrders,
    stabilitySnapshots,
    t08T09SignalsAvailable: false,
  });

  await writeOutputs(analysis);
  console.info(stableStringify({
    populationSummary: analysis.populationSummary,
    primaryVerdict: analysis.useCaseValidationVerdict.primaryVerdict,
    secondaryConditions: analysis.useCaseValidationVerdict.secondaryConditions,
  }));
} finally {
  await pool.end();
}

async function readAnalysisInputs(referenceTimeForRun: string): Promise<RfmStabilitySnapshotInput> {
  const snapshot = await createRfmSnapshot(
    {
      referenceTime: referenceTimeForRun,
      calculationVersion,
      generatedAt: new Date().toISOString(),
      dryRun: true,
    },
    {
      reader: createMysqlRfmPopulationReader(
        createQueryExecutor(pool, config.prestashopDb.queryTimeoutMs),
        config.prestashopDb.prefix,
      ),
    },
  );
  return {
    referenceTime: referenceTimeForRun,
    operationalRows: snapshot.rows,
    historicalOrders: await readHistoricalOrders(referenceTimeForRun),
  };
}

async function readHistoricalOrders(referenceTimeForRun: string): Promise<readonly HistoricalRfmOrderInput[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
      SELECT
        o.id_customer AS prestashopCustomerId,
        o.id_order AS orderId,
        o.date_add AS validOrderAt,
        o.total_paid_tax_incl AS grossOrderValueTaxIncl,
        o.id_shop AS shopId
      FROM ${tables.orders} o
      INNER JOIN ${tables.customer} c
        ON c.id_customer = o.id_customer
      WHERE o.valid = 1
        AND o.id_customer > 0
        AND o.date_add < ?
      ORDER BY o.id_customer ASC, o.date_add ASC, o.id_order ASC
    `,
    [toMysqlDateTime(referenceTimeForRun)],
  );
  return rows.map((row) => ({
    prestashopCustomerId: Number(row.prestashopCustomerId),
    orderId: Number(row.orderId),
    validOrderAt: String(row.validOrderAt),
    grossOrderValueTaxIncl: String(row.grossOrderValueTaxIncl ?? '0'),
    shopId: Number(row.shopId),
  }));
}

async function writeOutputs(analysis: RfmUseCaseAnalysis): Promise<void> {
  await writeJson('population-summary.json', analysis.populationSummary);
  await writeJson('operational-vs-lifetime.json', analysis.operationalVsLifetime);
  await writeJson('second-purchase-analysis.json', analysis.secondPurchaseAnalysis);
  await writeJson('candidate-cohorts.json', analysis.candidateCohorts);
  await writeJson('threshold-sensitivity.json', analysis.thresholdSensitivity);
  await writeJson('rfm-incremental-value.json', analysis.rfmIncrementalValue);
  await writeJson('cohort-stability.json', analysis.cohortStability);
  await writeJson('t08-t09-cross-analysis.json', analysis.t08T09CrossAnalysis);
  await writeJson('use-case-validation-verdict.json', analysis.useCaseValidationVerdict);
}

async function writeJson(fileName: string, value: unknown): Promise<void> {
  await writeFile(path.join(outputDir, fileName), `${stableStringify(value)}\n`, 'utf8');
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}

function requiredUtcReferenceTime(name: string): string {
  const value = requiredEnv(name);
  parseReferenceTime(value);
  return new Date(value).toISOString();
}

function parseOptionalReferenceTimes(value: string | undefined): readonly string[] {
  if (!value || value.trim() === '') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      parseReferenceTime(entry);
      return new Date(entry).toISOString();
    });
}

function toMysqlDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}
