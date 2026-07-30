// CP-R1-T10A - RFM Population Distribution Audit.
//
// Standalone read-only audit. It does not import runtime src/ modules, does not
// modify contracts, and writes only ignored aggregate outputs under
// scripts/audits/rfm-population/outputs/.
//
// Run only with approved read-only credentials:
//   RFM_AS_OF_DATE=YYYY-MM-DD npx tsx scripts/audits/rfm-population/audit-rfm-population.ts

import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { buildRfmWindow, parseAsOfDate, recencyDays } from './lib/dates.js';
import { formatAuditDecimal } from './lib/decimal.js';
import {
  describeNumericDistribution,
  frequentFrequencyBuckets,
  monetaryOutlierSummary,
  scoreBucketSizes,
  scoreBucketSizesForDecimal,
  scoreTieSafe,
  scoreTieSafeDecimal,
} from './lib/distribution.js';
import { classifyEligibility, classifyLifecycle } from './lib/lifecycle.js';
import { assessGrants, assertSafeSql, detectPrefix, evaluateLoad, parseServerVersion } from './lib/guardrails.js';
import { buildSnapshotProposal } from './lib/snapshot-proposal.js';
import {
  activePopulationSql,
  buildPrestashopTables,
  duplicatePrestashopLinksCrmSql,
  identityCoverageCrmSql,
  identityCoveragePrestashopSql,
  populationDatasetSql,
  requiredRfmPrestashopSuffixes,
  validOrderEvidenceSql,
  type RfmPrestashopTables,
} from './lib/sql.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(SCRIPT_DIR, 'outputs');
const QUERY_TIMEOUT_MS = 20000;
const REQUIRED_ENV_VARS = [
  'CRM_DB_HOST',
  'CRM_DB_USER',
  'CRM_DB_PASSWORD',
  'PRESTASHOP_DB_HOST',
  'PRESTASHOP_DB_USER',
  'PRESTASHOP_DB_PASSWORD',
] as const;

type QueryLogEntry = {
  readonly source: 'crm' | 'prestashop';
  readonly name: string;
  readonly purpose: string;
  readonly durationMs: number;
  readonly rowCount: number;
};

type PopulationRow = {
  readonly firstValidOrderAt: string | null;
  readonly lastValidOrderAt: string | null;
  readonly lifetimeValidOrderCount: number | string;
  readonly lifetimeGrossMonetaryTaxIncl: string | number;
  readonly windowValidOrderCount: number | string;
  readonly windowGrossMonetaryTaxIncl: string | number;
  readonly lastValidOrderAtInWindow: string | null;
};

const queryLog: QueryLogEntry[] = [];
const explains: Record<string, unknown> = {};

async function main(): Promise<void> {
  const startedAt = Date.now();
  const credentials = checkCredentials();
  const asOf = parseAsOfDate(process.env);
  if (!credentials.available || !asOf.ok) {
    await writeJson('preflight.json', {
      executedAt: new Date().toISOString(),
      status: 'aborted',
      reason: !credentials.available ? 'missing_credentials' : `rfm_as_of_date_${asOf.ok ? 'ok' : asOf.reason}`,
      missingEnvVars: credentials.missing,
      requiredAsOfDateEnv: 'RFM_AS_OF_DATE',
    });
    process.exitCode = 1;
    return;
  }

  const window = buildRfmWindow(asOf.asOfDate);
  const crm = await createConnection('crm');
  const prestashop = await createConnection('prestashop');

  try {
    const [crmPreflight, prestashopPreflight] = await Promise.all([
      preflightConnection(crm, 'crm'),
      preflightConnection(prestashop, 'prestashop'),
    ]);
    const preflight = {
      executedAt: new Date().toISOString(),
      status: crmPreflight.safe && prestashopPreflight.safe ? 'ok' : 'aborted',
      sources: {
        crm: crmPreflight,
        prestashop: prestashopPreflight,
      },
      asOfDate: window.asOfDate,
      timezone: window.timezone,
      windowStartInclusive: window.windowStartInclusive,
      windowEndExclusive: window.windowEndExclusive,
      queryTimeoutMs: QUERY_TIMEOUT_MS,
      connectionLimitPerSource: 1,
    };
    await writeJson('preflight.json', preflight);
    if (!crmPreflight.safe || !prestashopPreflight.safe) {
      process.exitCode = 1;
      return;
    }

    const tableRows = await runQuery<{ TABLE_NAME: string }>(
      prestashop,
      'prestashop',
      'schema.tables',
      'discover PrestaShop order/customer tables',
      'SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()',
    );
    const discovery = detectPrefix(
      tableRows.map((row) => row.TABLE_NAME),
      requiredRfmPrestashopSuffixes(),
    );
    if (!discovery.prefix || discovery.missing.length > 0) {
      await writeJson('schema-inventory.json', { prestashop: { discovery } });
      process.exitCode = 1;
      return;
    }
    const tables = buildPrestashopTables(discovery.prefix);
    await writeJson('schema-inventory.json', await buildSchemaInventory(prestashop, crm, tables, discovery));

    const [validOrderEvidence] = await runQuery<Record<string, unknown>>(
      prestashop,
      'prestashop',
      'valid-order.evidence',
      'revalidate valid-order operational assumptions',
      validOrderEvidenceSql(tables),
    );
    await writeJson('valid-order-evidence.json', normalizeValidOrderEvidence(validOrderEvidence));

    const populationRows = await runQuery<PopulationRow>(
      prestashop,
      'prestashop',
      'population.dataset',
      'per-PrestaShop-customer RFM population dataset',
      populationDatasetSql(tables),
      [
        window.windowStartInclusive,
        window.windowEndExclusive,
        window.windowStartInclusive,
        window.windowEndExclusive,
        window.windowStartInclusive,
        window.windowEndExclusive,
      ],
    );
    const population = summarizePopulation(populationRows, window.asOfDate);
    await writeJson('population-summary.json', population.summary);
    await writeJson('recency-distribution.json', population.recency);
    await writeJson('frequency-distribution.json', population.frequency);
    await writeJson('monetary-distribution.json', population.monetary);
    await writeJson('score-simulations.json', population.scoring);
    await writeJson('lifecycle-simulation.json', population.lifecycle);
    await writeJson('temporal-stability.json', {
      simulatedAsOfDates: [window.asOfDate, 'asOfDate - 30 days', 'asOfDate - 60 days', 'asOfDate - 90 days'],
      recommendation: 're-run the same deterministic extraction for each date; reuse immutable outputs for score migration analysis',
      status: 'requires approved live read-only run',
    });

    const identityCoverage = await buildIdentityCoverage(crm, prestashop, tables);
    await writeJson('identity-coverage.json', identityCoverage);

    await explainQuery(prestashop, 'prestashop.population-extraction', populationDatasetSql(tables), [
      window.windowStartInclusive,
      window.windowEndExclusive,
      window.windowStartInclusive,
      window.windowEndExclusive,
      window.windowStartInclusive,
      window.windowEndExclusive,
    ]);
    await explainQuery(prestashop, 'prestashop.active-window-aggregate', activePopulationSql(tables), [
      window.windowStartInclusive,
      window.windowEndExclusive,
    ]);
    await explainQuery(crm, 'crm.master-customer-link-coverage', identityCoverageCrmSql());
    await writeJson('explains.json', explains);
    await writeJson('performance-analysis.json', {
      dailyCalculationViable: 'verify with explains from approved live run',
      snapshotRequiredForRuntime: true,
      cacheRequiredForRuntime: false,
      futureIndexReview: [
        `${tables.orders}.id_customer`,
        `${tables.orders}.date_add`,
        `${tables.orders}.valid`,
        'master_customer.prestashop_customer_id',
      ],
      batchingRecommended: true,
      productionBlockingRisk: 'run off-peak with read-only credentials and query timeouts; never write during audit',
      explains,
    });
    await writeJson('snapshot-proposal.json', buildSnapshotProposal());
    await writeJson('audit-result.json', {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      preflight,
      window,
      population: population.summary,
      decisions: buildDecisions(),
      snapshotProposal: buildSnapshotProposal(),
    });
    await writeQueryLog();
    console.info('[audit-rfm-population] Completed. Aggregate outputs written under ignored outputs/.');
  } finally {
    await Promise.all([crm.end(), prestashop.end()]);
  }
}

async function createConnection(source: 'crm' | 'prestashop'): Promise<mysql.Connection> {
  const prefix = source === 'crm' ? 'CRM' : 'PRESTASHOP';
  return mysql.createConnection({
    host: process.env[`${prefix}_DB_HOST`],
    port: process.env[`${prefix}_DB_PORT`] ? Number(process.env[`${prefix}_DB_PORT`]) : 3306,
    user: process.env[`${prefix}_DB_USER`],
    password: process.env[`${prefix}_DB_PASSWORD`],
    database: process.env[`${prefix}_DB_NAME`] || (source === 'crm' ? 'main_management' : 'pesas_productiva'),
    connectTimeout: QUERY_TIMEOUT_MS,
    dateStrings: true,
    timezone: 'Z',
  });
}

async function preflightConnection(connection: mysql.Connection, source: 'crm' | 'prestashop'): Promise<Record<string, unknown> & { readonly safe: boolean }> {
  await runQuery(connection, source, 'preflight.select-1', 'lightweight connectivity check', 'SELECT 1 AS ok');
  const grantsRows = await runQuery<Record<string, string>>(
    connection,
    source,
    'preflight.show-grants',
    'read-only grant verification',
    'SHOW GRANTS FOR CURRENT_USER()',
  );
  const grants = assessGrants(grantsRows.map((row) => Object.values(row)[0] as string));
  const [threadsRow] = await runQuery<{ Value: string }>(
    connection,
    source,
    'preflight.threads-running',
    'server load guardrail input',
    "SHOW GLOBAL STATUS LIKE 'Threads_running'",
  );
  const [maxConnRow] = await runQuery<{ Value: string }>(
    connection,
    source,
    'preflight.max-connections',
    'server load guardrail input',
    "SHOW VARIABLES LIKE 'max_connections'",
  );
  const load = evaluateLoad(Number(threadsRow?.Value ?? 0), Number(maxConnRow?.Value ?? 0));
  const [versionRow] = await runQuery<{ version: string }>(
    connection,
    source,
    'preflight.version',
    'server engine and version',
    'SELECT VERSION() AS version',
  );
  return {
    safe: grants.safe && load.safe,
    engine: parseServerVersion(versionRow?.version ?? ''),
    grants,
    load,
  };
}

async function runQuery<Row = Record<string, unknown>>(
  connection: mysql.Connection,
  source: 'crm' | 'prestashop',
  name: string,
  purpose: string,
  sql: string,
  params: readonly unknown[] = [],
): Promise<Row[]> {
  assertSafeSql(sql, name);
  const startedAt = Date.now();
  const [rows] = await connection.query({ sql, timeout: QUERY_TIMEOUT_MS }, params as unknown[]);
  queryLog.push({
    source,
    name,
    purpose,
    durationMs: Date.now() - startedAt,
    rowCount: Array.isArray(rows) ? rows.length : 0,
  });
  return rows as Row[];
}

async function explainQuery(
  connection: mysql.Connection,
  name: string,
  sql: string,
  params: readonly unknown[] = [],
): Promise<void> {
  assertSafeSql(sql, `${name}.explain`);
  try {
    const [rows] = await connection.query({ sql: `EXPLAIN FORMAT=JSON ${sql}`, timeout: QUERY_TIMEOUT_MS }, params as unknown[]);
    explains[name] = Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    explains[name] = sanitizeError(error);
  }
}

async function buildSchemaInventory(
  prestashop: mysql.Connection,
  crm: mysql.Connection,
  tables: RfmPrestashopTables,
  discovery: unknown,
): Promise<Record<string, unknown>> {
  const prestashopIndexes: Record<string, unknown> = {};
  for (const tableName of Object.values(tables)) {
    prestashopIndexes[tableName] = await runQuery(prestashop, 'prestashop', `inventory.indexes.${tableName}`, `index inventory for ${tableName}`, `SHOW INDEX FROM \`${tableName}\``);
  }
  const crmMasterIndexes = await runQuery(crm, 'crm', 'inventory.indexes.master_customer', 'index inventory for master_customer', 'SHOW INDEX FROM `master_customer`');
  return { prestashop: { discovery, tables, indexes: prestashopIndexes }, crm: { masterCustomerIndexes: crmMasterIndexes } };
}

async function buildIdentityCoverage(
  crm: mysql.Connection,
  prestashop: mysql.Connection,
  tables: RfmPrestashopTables,
): Promise<Record<string, unknown>> {
  const [crmCoverage] = await runQuery<Record<string, unknown>>(crm, 'crm', 'identity.crm-coverage', 'master_customer link coverage', identityCoverageCrmSql());
  const [duplicates] = await runQuery<Record<string, unknown>>(
    crm,
    'crm',
    'identity.duplicate-prestashop-links',
    'duplicate PrestaShop link detection',
    duplicatePrestashopLinksCrmSql(),
  );
  const [prestashopCoverage] = await runQuery<Record<string, unknown>>(
    prestashop,
    'prestashop',
    'identity.prestashop-valid-orders',
    'PrestaShop customers with valid orders',
    identityCoveragePrestashopSql(tables),
  );
  return {
    crm: crmCoverage ?? {},
    prestashop: prestashopCoverage ?? {},
    duplicatePrestashopLinks: Number(duplicates?.duplicatePrestashopLinks ?? 0),
    decision:
      'T10 v1 uses only masterCustomerId records with exactly one confirmed prestashop_customer_id; unconsolidated PrestaShop history is excluded and reported as coverage pending.',
    noIndividualIdsPublished: true,
  };
}

function summarizePopulation(rows: readonly PopulationRow[], asOfDate: string): Record<string, unknown> {
  const normalized = rows.map((row) => {
    const lifetimeValidOrderCount = Number(row.lifetimeValidOrderCount);
    const windowValidOrderCount = Number(row.windowValidOrderCount);
    const eligibilityStatus = classifyEligibility(lifetimeValidOrderCount, windowValidOrderCount);
    return {
      lifetimeValidOrderCount,
      lifetimeGrossMonetaryTaxIncl: formatAuditDecimal(String(row.lifetimeGrossMonetaryTaxIncl)),
      windowValidOrderCount,
      windowGrossMonetaryTaxIncl: formatAuditDecimal(String(row.windowGrossMonetaryTaxIncl)),
      recencyDays:
        eligibilityStatus === 'active' && row.lastValidOrderAtInWindow
          ? recencyDays(asOfDate, row.lastValidOrderAtInWindow)
          : null,
      eligibilityStatus,
      lifecycleStage: classifyLifecycle({
        eligibilityStatus,
        firstValidOrderAt: row.firstValidOrderAt,
        lifetimeValidOrderCount,
        asOfDate,
      }),
    };
  });

  const active = normalized.filter((row) => row.eligibilityStatus === 'active');
  const recencies = active.map((row) => row.recencyDays).filter((value): value is number => value !== null);
  const frequencies = active.map((row) => row.windowValidOrderCount);
  const monetary = active.map((row) => row.windowGrossMonetaryTaxIncl);
  const recencyScores = scoreTieSafe(recencies, 'lower_value_better');
  const frequencyScores = scoreTieSafe(frequencies, 'higher_value_better');
  const monetaryRanks = scoreTieSafeDecimal(monetary, 'higher_value_better');

  return {
    summary: {
      totalCanonicalCandidates: normalized.length,
      active: active.length,
      historicalInactive: normalized.filter((row) => row.eligibilityStatus === 'historical_inactive').length,
      noValidPurchases: normalized.filter((row) => row.eligibilityStatus === 'no_valid_purchases').length,
      inactiveExcludedFromActivePercentiles: true,
    },
    recency: {
      distribution: describeNumericDistribution(recencies),
      scoreDirection: 'lower recencyDays receives higher score',
      scoreBuckets: scoreBucketSizes(recencies, recencyScores),
    },
    frequency: {
      distribution: describeNumericDistribution(frequencies),
      frequentBuckets: frequentFrequencyBuckets(frequencies),
      scoreDirection: 'higher frequencyOrders receives higher score',
      scoreBuckets: scoreBucketSizes(frequencies, frequencyScores),
    },
    monetary: {
      outliers: monetaryOutlierSummary(monetary),
      scoreDirection: 'higher grossMonetaryTaxIncl receives higher score',
      scoreBuckets: scoreBucketSizesForDecimal(monetary, monetaryRanks),
      publishedScoreBasis: 'gross monetary tax incl, not log-transformed or winsorized',
    },
    scoring: {
      recommendedR: 'tie-safe percentile rank by recencyDays value, lower is better',
      recommendedF: 'discrete versioned thresholds informed by real frequency table; never NTILE over rows',
      recommendedM: 'tie-safe percentile rank over gross monetary tax incl, higher is better',
      tiePolicy: 'same exact metric value receives same score',
      noNamedCommercialSegments: true,
    },
    lifecycle: {
      separatedFromRfm: true,
      candidateRules: {
        newCustomer: 'firstValidOrderAt within last 90 days AND lifetimeValidOrderCount = 1',
        active: 'at least one valid purchase inside RFM window',
        historicalInactive: 'historical valid purchases but none inside RFM window',
        noPurchaseHistory: 'no valid purchase',
      },
      counts: lifecycleCounts(normalized.map((row) => row.lifecycleStage)),
    },
  };
}

function normalizeValidOrderEvidence(row: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    validOrderCount: Number(row?.validOrderCount ?? 0),
    validOrderCustomerCount: Number(row?.validOrderCustomerCount ?? 0),
    grossMonetaryTaxIncl: formatAuditDecimal(String(row?.grossMonetaryTaxIncl ?? '0')),
    zeroAmountOrders: Number(row?.zeroAmountOrders ?? 0),
    negativeAmountOrders: Number(row?.negativeAmountOrders ?? 0),
    cancelledOrRefundedValidOrders: Number(row?.cancelledOrRefundedValidOrders ?? 0),
    shopCount: Number(row?.shopCount ?? 0),
    currencyCount: Number(row?.currencyCount ?? 0),
    conversionRateCount: Number(row?.conversionRateCount ?? 0),
    validFilterDecision: 'retain ps_orders.valid = 1 unless live evidence contradicts T07A assumptions',
  };
}

function lifecycleCounts(stages: readonly string[]): Record<string, number> {
  return {
    new_customer: stages.filter((stage) => stage === 'new_customer').length,
    active: stages.filter((stage) => stage === 'active').length,
    historical_inactive: stages.filter((stage) => stage === 'historical_inactive').length,
    no_purchase_history: stages.filter((stage) => stage === 'no_purchase_history').length,
  };
}

function buildDecisions(): readonly Record<string, string>[] {
  return [
    { decision: 'Active population', answer: 'customers with >= 1 valid order inside the 12-month window' },
    { decision: 'Historical inactive population', answer: 'customers with lifetime valid purchases and zero valid orders inside the window' },
    { decision: 'No RFM population', answer: 'customers without any valid order history' },
    { decision: 'Window', answer: 'windowStartInclusive = asOfDate minus 12 calendar months; windowEndExclusive = day after asOfDate' },
    { decision: 'asOfDate', answer: 'explicit RFM_AS_OF_DATE=YYYY-MM-DD in UTC, never server current date' },
    { decision: 'R', answer: 'complete days between asOfDate and last valid order inside the window' },
    { decision: 'F', answer: 'COUNT(DISTINCT id_order) inside the window' },
    { decision: 'M', answer: 'gross SUM(total_paid_tax_incl) inside the window, tax included, not net refunds' },
    { decision: 'R score', answer: 'tie-safe percentile rank by value; lower recency gets higher score' },
    { decision: 'F score', answer: 'versioned discrete thresholds selected from observed frequency distribution' },
    { decision: 'M score', answer: 'tie-safe percentile rank on raw gross monetary value' },
    { decision: 'Ties', answer: 'same exact metric value receives the same score; never split ties with NTILE' },
    { decision: 'RFM/lifecycle separation', answer: 'lifecycle remains separate from RFM scores and code' },
    { decision: 'Initial lifecycle rule', answer: 'new_customer when first valid order is within 90 days and lifetime order count is 1' },
    { decision: 'Canonical identity', answer: 'masterCustomerId with one confirmed prestashop_customer_id' },
    { decision: 'Unconsolidated identity', answer: 'excluded from T10 v1 snapshot and reported as coverage pending' },
    { decision: 'Pipeline frequency', answer: 'daily off-peak calculation' },
    { decision: 'Model versioning', answer: 'persist modelVersion with asOfDate and window bounds' },
    { decision: 'Snapshot structure', answer: 'CustomerRfmSnapshot proposal in snapshot-proposal.json and docs' },
    { decision: 'Indexes/batches', answer: 'review EXPLAIN; batch if full population extraction exceeds safe timeout' },
    { decision: 'Future endpoint fields', answer: 'status, modelVersion, calculatedAt, asOfDate, window bounds, metrics, scores, percentiles, lifecycleStage' },
    { decision: 'Out of T10', answer: 'no commercial segment names, no RFM endpoint in T10A, no writes, no migrations, no backfill' },
  ];
}

function checkCredentials(): { readonly available: boolean; readonly missing: readonly string[] } {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name] || process.env[name]!.trim() === '');
  return { available: missing.length === 0, missing };
}

function sanitizeError(error: unknown): { readonly type: string; readonly code: string | null } {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : null;
  const type = error instanceof Error ? error.constructor.name : 'UnknownError';
  return { type, code };
}

async function writeJson(filename: string, data: unknown): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, filename), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function writeQueryLog(): Promise<void> {
  await writeJson('query-log.json', queryLog);
}

main().catch((error: unknown) => {
  console.error({ error: sanitizeError(error) }, '[audit-rfm-population] Failed.');
  process.exitCode = 1;
});
