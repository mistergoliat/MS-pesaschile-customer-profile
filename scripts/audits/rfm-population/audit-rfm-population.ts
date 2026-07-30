// CP-R1-T10A - RFM Population Distribution Audit (extended).
//
// Standalone read-only audit. It does not import runtime src/ modules, does not modify
// contracts, and writes only ignored aggregate outputs under
// scripts/audits/rfm-population/outputs/.
//
// ps_customer is NOT yet the canonical customer identity — master_customer is. This
// script supports two explicit identity modes (see lib/identity-mode.ts):
//   RFM_IDENTITY_MODE=prestashop_customer  -> provisional, ps_customer-keyed, no CRM query
//   RFM_IDENTITY_MODE=master_customer      -> canonical, requires CRM, unchanged from the
//                                             original T10A behavior
//
// Run only with approved read-only credentials:
//   RFM_IDENTITY_MODE=prestashop_customer RFM_AS_OF_DATE=YYYY-MM-DD \
//     npx tsx scripts/audits/rfm-population/audit-rfm-population.ts
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { buildRfmWindow, parseAsOfDate, recencyDays, type RfmWindow } from './lib/dates.js';
import { addAuditDecimals, divideAuditDecimal, formatAuditDecimal, percentage } from './lib/decimal.js';
import {
  describeNumericDistribution,
  frequentFrequencyBuckets,
  monetaryOutlierSummary,
  scoreBucketSizes,
  scoreBucketSizesForDecimal,
  scoreTieSafe,
  scoreTieSafeDecimal,
} from './lib/distribution.js';
import { classifyEligibility, classifyLifecycle, isFutureOnlyCustomer, type EligibilityStatus, type LifecycleStage } from './lib/lifecycle.js';
import { assessGrants, assertSafeSql, detectPrefix, evaluateLoad, parseServerVersion } from './lib/guardrails.js';
import { buildSnapshotProposal } from './lib/snapshot-proposal.js';
import {
  identityModeMetadata,
  parseIdentityMode,
  requiredEnvVarsForMode,
  type IdentityMode,
  type IdentityModeMetadata,
} from './lib/identity-mode.js';
import { assertAggregateOnlySql, assertNoPiiInResult, type ResultField } from './lib/pii-guard.js';
import {
  activePopulationSql,
  buildPrestashopTables,
  crossShopCustomerCountSql,
  duplicatePrestashopLinksCrmSql,
  identityCoverageCrmSql,
  identityCoveragePrestashopSql,
  populationDatasetParams,
  populationDatasetSql,
  requiredRfmPrestashopSuffixes,
  shopLabelsSql,
  shopLifetimeTotalsSql,
  shopScopedActivePopulationSql,
  validOrderEvidenceSql,
  type RfmPrestashopTables,
} from './lib/sql.js';
import {
  duplicateEmailGroupsSql,
  duplicateEmailOrderImpactSql,
  emailQualitySql,
  identityCoreCountsSql,
  lifetimeFrequencyThresholdsSql,
  potentialSharedAccountsSql,
} from './lib/identity-quality-sql.js';
import {
  frequencyOutlierAccountFlagsSql,
  frequencyOutlierProfileSql,
  frequencyOutlierShopBreakdownSql,
} from './lib/outlier-sql.js';
import {
  buildFrequencyModelGroups,
  classifyFrequencyModelA,
  classifyFrequencyModelB,
  FREQUENCY_MODEL_DEFINITIONS,
  modelCClassifier,
  type FrequencyModelRow,
} from './lib/frequency-models.js';
import { buildCommercialGroupTable, evaluateDistinguishability, type CommercialRow } from './lib/commercial-validity.js';
import { shiftAsOfDateByDays } from './lib/temporal.js';
import { buildScoreSnapshot, compareScoreSnapshots, type TemporalSnapshotRow } from './lib/temporal-stability.js';
import { buildMasterMigrationComparisonPlan } from './lib/master-migration-plan.js';
import { runCommercialPopulationFinalization } from './rfm-finalization.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(SCRIPT_DIR, 'outputs');
const QUERY_TIMEOUT_MS = 20000;
const OUTLIER_LIFETIME_THRESHOLD_OVER_100 = 100;
const OUTLIER_LIFETIME_THRESHOLD_OVER_500 = 500;

type QueryLogEntry = {
  readonly source: 'crm' | 'prestashop';
  readonly name: string;
  readonly purpose: string;
  readonly durationMs: number;
  readonly rowCount: number;
};

type PopulationRow = {
  readonly prestashopCustomerId: number | string;
  readonly firstValidOrderAt: string | null;
  readonly lastValidOrderAt: string | null;
  readonly lifetimeValidOrderCount: number | string;
  readonly lifetimeGrossMonetaryTaxIncl: string | number;
  readonly windowValidOrderCount: number | string;
  readonly windowGrossMonetaryTaxIncl: string | number;
  readonly lastValidOrderAtInWindow: string | null;
  readonly lifetimeDistinctShops: number | string;
  readonly hasFutureOnlyOrderFlag: number | string;
  readonly customerDeletedFlag: number | string | null;
  readonly customerActiveFlag: number | string | null;
  readonly customerGuestFlag: number | string | null;
};

type NormalizedPopulationRow = {
  readonly prestashopCustomerId: number;
  readonly firstValidOrderAt: string | null;
  readonly lastValidOrderAt: string | null;
  readonly lifetimeValidOrderCount: number;
  readonly lifetimeGrossMonetaryTaxIncl: string;
  readonly windowValidOrderCount: number;
  readonly windowGrossMonetaryTaxIncl: string;
  readonly recencyDays: number | null;
  readonly eligibilityStatus: EligibilityStatus;
  readonly lifecycleStage: LifecycleStage;
  readonly lifetimeDistinctShops: number;
  // CP-R1-T10A-3 correction: true when this identity's only valid order activity is dated
  // on/after windowEndExclusive. lib/sql.ts's lifetime bound already makes such an identity
  // resolve to eligibilityStatus 'no_valid_purchases' with zero special-casing — this flag
  // exists purely so it can be counted separately (futureOnlyCustomersExcluded), never to
  // change classification.
  readonly isFutureOnlyCustomer: boolean;
  readonly customerDeletedFlag: boolean;
  readonly customerActiveFlag: boolean;
  readonly customerGuestFlag: boolean;
};

type ActiveRow = {
  readonly prestashopCustomerId: number;
  readonly frequencyOrders: number;
  readonly grossMonetaryTaxIncl: string;
  readonly recencyDays: number;
};

type ActivePopulationSqlRow = {
  readonly prestashopCustomerId: number | string;
  readonly frequencyOrders: number | string;
  readonly grossMonetaryTaxIncl: string | number;
  readonly lastValidOrderAtInWindow: string | null;
};

const queryLog: QueryLogEntry[] = [];
const explains: Record<string, unknown> = {};

async function main(): Promise<void> {
  const startedAt = Date.now();
  const identityModeResolution = parseIdentityMode(process.env);
  const asOf = parseAsOfDate(process.env);

  if (!identityModeResolution.ok || !asOf.ok) {
    await writeJson('preflight.json', {
      executedAt: new Date().toISOString(),
      status: 'aborted',
      reason: !identityModeResolution.ok
        ? `rfm_identity_mode_${identityModeResolution.reason}`
        : `rfm_as_of_date_${asOf.ok ? 'ok' : asOf.reason}`,
      requiredIdentityModeEnv: 'RFM_IDENTITY_MODE',
      allowedIdentityModes: ['prestashop_customer', 'master_customer'],
      requiredAsOfDateEnv: 'RFM_AS_OF_DATE',
    });
    process.exitCode = 1;
    return;
  }

  const identityMode = identityModeResolution.mode;
  const identityMeta = identityModeMetadata(identityMode);
  const credentials = checkCredentials(identityMode);
  if (!credentials.available) {
    await writeJson('preflight.json', {
      executedAt: new Date().toISOString(),
      status: 'aborted',
      reason: 'missing_credentials',
      missingEnvVars: credentials.missing,
      identityMode,
    });
    process.exitCode = 1;
    return;
  }

  const window = buildRfmWindow(asOf.asOfDate);
  const prestashop = await createConnection('prestashop');
  const crm = identityMode === 'master_customer' ? await createConnection('crm') : null;

  try {
    const prestashopPreflight = await preflightConnection(prestashop, 'prestashop');
    const crmPreflight = crm ? await preflightConnection(crm, 'crm') : null;
    const safe = prestashopPreflight.safe && (crmPreflight ? crmPreflight.safe : true);
    const preflight = {
      executedAt: new Date().toISOString(),
      status: safe ? 'ok' : 'aborted',
      identityMode,
      identityMetadata: identityMeta,
      sources: {
        prestashop: prestashopPreflight,
        crm: crmPreflight ?? { skipped: true, reason: 'RFM_IDENTITY_MODE=prestashop_customer does not require or query CRM' },
      },
      asOfDate: window.asOfDate,
      timezone: window.timezone,
      windowStartInclusive: window.windowStartInclusive,
      windowEndExclusive: window.windowEndExclusive,
      queryTimeoutMs: QUERY_TIMEOUT_MS,
      connectionLimitPerSource: 1,
    };
    await writeJson('preflight.json', preflight);
    if (!safe) {
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
    const shopTableName = `${discovery.prefix}shop`;
    const hasShopTable = tableRows.some((row) => row.TABLE_NAME === shopTableName);
    await writeJson('schema-inventory.json', await buildSchemaInventory(prestashop, crm, tables, discovery, hasShopTable, shopTableName));

    const [validOrderEvidenceRow] = await runQuery<Record<string, unknown>>(
      prestashop,
      'prestashop',
      'valid-order.evidence',
      'revalidate valid-order operational assumptions',
      validOrderEvidenceSql(tables),
    );
    const validOrderEvidence = normalizeValidOrderEvidence(validOrderEvidenceRow);
    await writeJson('valid-order-evidence.json', validOrderEvidence);

    const populationRows = await runQuery<PopulationRow>(
      prestashop,
      'prestashop',
      'population.dataset',
      'per-PrestaShop-customer RFM population dataset',
      populationDatasetSql(tables),
      populationDatasetParams(window.windowStartInclusive, window.windowEndExclusive),
    );
    const normalized = normalizePopulationRows(populationRows, window.asOfDate);
    const futureOnlyCustomersExcludedCount = normalized.filter((row) => row.isFutureOnlyCustomer).length;
    const active = normalized.filter((row) => row.eligibilityStatus === 'active');
    const activeRows: ActiveRow[] = active
      .filter((row): row is NormalizedPopulationRow & { recencyDays: number } => row.recencyDays !== null)
      .map((row) => ({
        prestashopCustomerId: row.prestashopCustomerId,
        frequencyOrders: row.windowValidOrderCount,
        grossMonetaryTaxIncl: row.windowGrossMonetaryTaxIncl,
        recencyDays: row.recencyDays,
      }));
    const activeRowsMissingRecency = active.length - activeRows.length;

    const population = summarizePopulation(normalized, identityMeta);
    await writeJson('population-summary.json', population.summary);
    await writeJson('recency-distribution.json', population.recency);
    await writeJson('frequency-distribution.json', population.frequency);
    await writeJson('monetary-distribution.json', population.monetary);
    await writeJson('score-simulations.json', population.scoring);
    await writeJson('lifecycle-simulation.json', population.lifecycle);

    // ---- Section 2: PrestaShop identity quality (aggregate only, no PII published) ----
    const identityQuality = await buildPrestashopIdentityQuality(prestashop, tables, validOrderEvidence, identityMeta);
    await writeJson('prestashop-identity-quality.json', identityQuality);

    // ---- Section 3: frequency outlier analysis (no individual identity published) ----
    const outlierAnalysis = await buildFrequencyOutlierAnalysis(prestashop, tables, window, activeRows, identityMeta);
    await writeJson('frequency-outlier-analysis.json', outlierAnalysis);

    // ---- Section 4: multishop analysis ----
    const multishopAnalysis = await buildMultishopAnalysis(prestashop, tables, window, hasShopTable, shopTableName, identityMeta);
    await writeJson('multishop-analysis.json', multishopAnalysis);

    // ---- Section 6: frequency threshold simulation (Models A/B/C, no NTILE) ----
    const frequencyThresholdSimulation = buildFrequencyThresholdSimulation(activeRows, outlierAnalysis, identityMeta);
    await writeJson('frequency-threshold-simulation.json', frequencyThresholdSimulation);

    // ---- Section 8: commercial validity ----
    const commercialValidity = buildCommercialValidityAnalysis(activeRows, normalized, identityQuality, outlierAnalysis, identityMeta);
    await writeJson('commercial-validity-analysis.json', commercialValidity);

    // ---- Section 9: real temporal stability (asOfDate, -30, -60, -90) ----
    const temporalStability = await buildTemporalStabilityReal(prestashop, tables, window, activeRows, activeRowsMissingRecency, identityMeta);
    await writeJson('temporal-stability-real.json', temporalStability);
    await writeJson('temporal-stability.json', {
      status: 'completed',
      identityMode: identityMeta.identityMode,
      simulatedAsOfDates: temporalStability.simulatedAsOfDates,
      identicalCodePercent: temporalStability.summary,
      seeFullDetail: 'temporal-stability-real.json',
    });

    // ---- Section 10: master_customer migration comparison plan (design only) ----
    await writeJson('master-migration-comparison-plan.json', {
      ...identityMeta,
      ...buildMasterMigrationComparisonPlan(),
    });

    // ---- CP-R1-T10A-3: commercial population finalization (rfm-v1-provisional) ----
    const finalization = await runCommercialPopulationFinalization({
      prestashop,
      tables,
      window,
      normalized,
      activeRows,
      identityMeta,
      hasShopTable,
      shopTableName,
      futureOnlyCustomersExcludedCount,
      runQuery,
      explainQuery,
    });
    await writeJson('commercial-population-comparison.json', finalization.commercialPopulationComparison);
    await writeJson('multishop-final-decision.json', finalization.multishopFinalDecision);
    await writeJson('cross-shop-customer-policy.json', finalization.crossShopCustomerPolicy);
    await writeJson('operational-account-policy.json', finalization.operationalAccountPolicyOutput);
    await writeJson('operational-account-sensitivity.json', finalization.operationalAccountSensitivity);
    await writeJson('recency-method-comparison.json', finalization.recencyMethodComparison);
    await writeJson('frequency-final-comparison.json', finalization.frequencyFinalComparison);
    await writeJson('monetary-method-comparison.json', finalization.monetaryMethodComparison);
    await writeJson('temporal-stability-final.json', finalization.temporalStabilityFinal);
    await writeJson('commercial-score-validity.json', finalization.commercialScoreValidity);
    await writeJson('historical-inactive-analysis.json', finalization.historicalInactiveAnalysis);
    await writeJson('rfm-v1-provisional-manifest.json', finalization.rfmV1ProvisionalManifest);
    await writeJson('finalization-performance.json', finalization.finalizationPerformance);
    await writeJson('t10a3-audit-result.json', {
      generatedAt: new Date().toISOString(),
      identityMode,
      identityMetadata: identityMeta,
      window,
      verdict: finalization.verdict,
      decisionsClosed: finalization.decisionsClosed,
      outputs: [
        'commercial-population-comparison.json',
        'multishop-final-decision.json',
        'cross-shop-customer-policy.json',
        'operational-account-policy.json',
        'operational-account-sensitivity.json',
        'recency-method-comparison.json',
        'frequency-final-comparison.json',
        'monetary-method-comparison.json',
        'temporal-stability-final.json',
        'commercial-score-validity.json',
        'historical-inactive-analysis.json',
        'rfm-v1-provisional-manifest.json',
        'finalization-performance.json',
      ],
    });

    // ---- Identity coverage: canonical (master_customer mode) vs skipped (provisional) ----
    if (identityMode === 'master_customer' && crm) {
      const identityCoverage = await buildIdentityCoverage(crm, prestashop, tables);
      await writeJson('identity-coverage.json', identityCoverage);
    } else {
      await writeJson('identity-coverage.json', {
        ...identityMeta,
        status: 'skipped',
        reason: 'RFM_IDENTITY_MODE=prestashop_customer does not query master_customer',
        seeInstead: 'prestashop-identity-quality.json',
      });
    }

    await explainQuery(
      prestashop,
      'prestashop.population-extraction',
      populationDatasetSql(tables),
      populationDatasetParams(window.windowStartInclusive, window.windowEndExclusive),
    );
    await explainQuery(prestashop, 'prestashop.active-window-aggregate', activePopulationSql(tables), [
      window.windowStartInclusive,
      window.windowEndExclusive,
    ]);
    if (crm) {
      await explainQuery(crm, 'crm.master-customer-link-coverage', identityCoverageCrmSql());
    }
    await writeJson('explains.json', explains);
    await writeJson('performance-analysis.json', {
      dailyCalculationViable: 'verify with explains from approved live run',
      snapshotRequiredForRuntime: true,
      cacheRequiredForRuntime: false,
      futureIndexReview: [
        `${tables.orders}.id_customer`,
        `${tables.orders}.date_add`,
        `${tables.orders}.valid`,
        `${tables.orders}.id_shop`,
        'master_customer.prestashop_customer_id',
      ],
      batchingRecommended: true,
      productionBlockingRisk: 'run off-peak with read-only credentials and query timeouts; never write during audit',
      extendedQueryCount: 'section 2/3/4/9 add ~13 aggregate queries beyond the original T10A set; all remain COUNT/SUM-shaped',
      explains,
    });
    await writeJson('snapshot-proposal.json', buildSnapshotProposal());
    await writeJson('audit-result.json', {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      identityMode,
      identityMetadata: identityMeta,
      preflight,
      window,
      population: population.summary,
      decisions: buildDecisions(),
      decisionsClosed: buildSection12Decisions(identityMode),
      snapshotProposal: buildSnapshotProposal(),
      outputs: [
        'preflight.json',
        'schema-inventory.json',
        'valid-order-evidence.json',
        'population-summary.json',
        'recency-distribution.json',
        'frequency-distribution.json',
        'monetary-distribution.json',
        'score-simulations.json',
        'lifecycle-simulation.json',
        'prestashop-identity-quality.json',
        'frequency-outlier-analysis.json',
        'multishop-analysis.json',
        'frequency-threshold-simulation.json',
        'commercial-validity-analysis.json',
        'temporal-stability-real.json',
        'temporal-stability.json',
        'master-migration-comparison-plan.json',
        'identity-coverage.json',
        'explains.json',
        'performance-analysis.json',
        'snapshot-proposal.json',
        'query-log.json',
      ],
    });
    await writeQueryLog();
    console.info('[audit-rfm-population] Completed. Aggregate outputs written under ignored outputs/.');
  } finally {
    await Promise.all([prestashop.end(), ...(crm ? [crm.end()] : [])]);
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

// Distinct from runQuery: used only by section 2 queries that legitimately reference
// `email` for aggregation (see lib/identity-quality-sql.ts header). Safety comes from
// checking the *materialized result* (field names + row values), not the SQL text — see
// lib/pii-guard.ts.
async function runAggregateOnlyQuery<Row = Record<string, unknown>>(
  connection: mysql.Connection,
  name: string,
  purpose: string,
  sql: string,
  params: readonly unknown[] = [],
): Promise<Row[]> {
  assertAggregateOnlySql(sql, name);
  const startedAt = Date.now();
  const [rows, fields] = await connection.query({ sql, timeout: QUERY_TIMEOUT_MS }, params as unknown[]);
  const rowArray = rows as Row[];
  assertNoPiiInResult(fields as unknown as ResultField[], rowArray as unknown as Record<string, unknown>[], name);
  queryLog.push({
    source: 'prestashop',
    name,
    purpose,
    durationMs: Date.now() - startedAt,
    rowCount: Array.isArray(rowArray) ? rowArray.length : 0,
  });
  return rowArray;
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
  crm: mysql.Connection | null,
  tables: RfmPrestashopTables,
  discovery: unknown,
  hasShopTable: boolean,
  shopTableName: string,
): Promise<Record<string, unknown>> {
  const prestashopIndexes: Record<string, unknown> = {};
  for (const tableName of Object.values(tables)) {
    prestashopIndexes[tableName] = await runQuery(prestashop, 'prestashop', `inventory.indexes.${tableName}`, `index inventory for ${tableName}`, `SHOW INDEX FROM \`${tableName}\``);
  }
  if (hasShopTable) {
    prestashopIndexes[shopTableName] = await runQuery(prestashop, 'prestashop', `inventory.indexes.${shopTableName}`, `index inventory for ${shopTableName} (optional, non-PII shop labels)`, `SHOW INDEX FROM \`${shopTableName}\``);
  }
  if (!crm) {
    return { prestashop: { discovery, tables, hasShopTable, indexes: prestashopIndexes }, crm: { skipped: true, reason: 'RFM_IDENTITY_MODE=prestashop_customer' } };
  }
  const crmMasterIndexes = await runQuery(crm, 'crm', 'inventory.indexes.master_customer', 'index inventory for master_customer', 'SHOW INDEX FROM `master_customer`');
  return { prestashop: { discovery, tables, hasShopTable, indexes: prestashopIndexes }, crm: { masterCustomerIndexes: crmMasterIndexes } };
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

function normalizePopulationRows(rows: readonly PopulationRow[], asOfDate: string): readonly NormalizedPopulationRow[] {
  return rows.map((row) => {
    // lifetimeValidOrderCount is now bounded to date_add < windowEndExclusive (see
    // lib/sql.ts populationDatasetSql), so an identity whose only valid order(s) are dated
    // on/after windowEndExclusive already has lifetimeValidOrderCount = 0 here — and
    // classifyEligibility(0, 0) already resolves that to 'no_valid_purchases', never
    // 'historical_inactive', with no special-casing required.
    const lifetimeValidOrderCount = Number(row.lifetimeValidOrderCount);
    const windowValidOrderCount = Number(row.windowValidOrderCount);
    const eligibilityStatus = classifyEligibility(lifetimeValidOrderCount, windowValidOrderCount);
    const futureOnly = isFutureOnlyCustomer(Number(row.hasFutureOnlyOrderFlag) === 1, lifetimeValidOrderCount);
    return {
      prestashopCustomerId: Number(row.prestashopCustomerId),
      firstValidOrderAt: row.firstValidOrderAt,
      lastValidOrderAt: row.lastValidOrderAt,
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
      lifetimeDistinctShops: Number(row.lifetimeDistinctShops),
      isFutureOnlyCustomer: futureOnly,
      customerDeletedFlag: Number(row.customerDeletedFlag ?? 0) === 1,
      customerActiveFlag: Number(row.customerActiveFlag ?? 1) === 1,
      customerGuestFlag: Number(row.customerGuestFlag ?? 0) === 1,
    };
  });
}

function summarizePopulation(normalized: readonly NormalizedPopulationRow[], identityMeta: IdentityModeMetadata): Record<string, unknown> {
  const active = normalized.filter((row) => row.eligibilityStatus === 'active');
  const recencies = active.map((row) => row.recencyDays).filter((value): value is number => value !== null);
  const frequencies = active.map((row) => row.windowValidOrderCount);
  const monetary = active.map((row) => row.windowGrossMonetaryTaxIncl);
  const recencyScores = scoreTieSafe(recencies, 'lower_value_better');
  const frequencyScores = scoreTieSafe(frequencies, 'higher_value_better');
  const monetaryRanks = scoreTieSafeDecimal(monetary, 'higher_value_better');

  return {
    summary: {
      ...identityMeta,
      // P0_all_shops: this summary pools every shop (1, 2 and 3) — see
      // commercial-population-comparison.json / multishop-final-decision.json for the
      // P1_main_commercial_shop (shop 1 only) equivalent used by rfm-v1-provisional scoring.
      populationScope: 'P0_all_shops',
      totalIdentityCandidates: normalized.length,
      active: active.length,
      historicalInactive: normalized.filter((row) => row.eligibilityStatus === 'historical_inactive').length,
      noValidPurchases: normalized.filter((row) => row.eligibilityStatus === 'no_valid_purchases').length,
      // CP-R1-T10A-3 correction: identities whose only valid order(s) are dated on/after
      // windowEndExclusive. Already counted inside noValidPurchases above (that is their
      // correct classification as of asOfDate) — broken out separately here so they are
      // never confused with identities that truly never placed a valid order.
      futureOnlyCustomersExcluded: normalized.filter((row) => row.isFutureOnlyCustomer).length,
      inactiveExcludedFromActivePercentiles: true,
    },
    recency: {
      distribution: describeNumericDistribution(recencies),
      scoreDirection: 'lower recencyDays receives higher score',
      scoreBuckets: scoreBucketSizes(recencies, recencyScores),
      candidateCuts: buildCandidateCuts(describeNumericDistribution(recencies)),
      stabilityReference: 'see temporal-stability-real.json before freezing any cut',
    },
    frequency: {
      distribution: describeNumericDistribution(frequencies),
      frequentBuckets: frequentFrequencyBuckets(frequencies),
      scoreDirection: 'higher frequencyOrders receives higher score',
      scoreBuckets: scoreBucketSizes(frequencies, frequencyScores),
      modelsReference: 'see frequency-threshold-simulation.json for Models A/B/C comparison',
    },
    monetary: {
      outliers: monetaryOutlierSummary(monetary),
      scoreDirection: 'higher grossMonetaryTaxIncl receives higher score',
      scoreBuckets: scoreBucketSizesForDecimal(monetary, monetaryRanks),
      publishedScoreBasis: 'gross monetary tax incl, not log-transformed or winsorized',
      shopReference: 'see multishop-analysis.json for per-shop monetary distribution',
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

function buildCandidateCuts(distribution: ReturnType<typeof describeNumericDistribution>): Record<string, unknown> {
  return {
    method: 'quintile boundaries from the observed distribution (p20/p40/p60/p80), not frozen',
    p20: distribution.p20,
    p40: distribution.p40,
    p60: distribution.p60,
    p80: distribution.p80,
    frozen: false,
  };
}

// ---------------------------------------------------------------------------------------
// Section 2: PrestaShop identity quality
// ---------------------------------------------------------------------------------------
async function buildPrestashopIdentityQuality(
  prestashop: mysql.Connection,
  tables: RfmPrestashopTables,
  validOrderEvidence: Record<string, unknown>,
  identityMeta: IdentityModeMetadata,
): Promise<Record<string, unknown>> {
  const [coreCounts] = await runQuery<Record<string, unknown>>(
    prestashop,
    'prestashop',
    'identity-quality.core-counts',
    'total ps_customer, valid-order coverage, deleted/inactive/guest/company flags',
    identityCoreCountsSql(tables),
  );
  const [emailQuality] = await runAggregateOnlyQuery<Record<string, unknown>>(
    prestashop,
    'identity-quality.email-quality',
    'aggregate empty/invalid/test-pattern email counts (no email values returned)',
    emailQualitySql(tables),
  );
  const [duplicateEmails] = await runAggregateOnlyQuery<Record<string, unknown>>(
    prestashop,
    'identity-quality.duplicate-emails',
    'normalized duplicate email group counts (no email values returned)',
    duplicateEmailGroupsSql(tables),
  );
  const [duplicateEmailImpact] = await runAggregateOnlyQuery<Record<string, unknown>>(
    prestashop,
    'identity-quality.duplicate-email-order-impact',
    'orders/spend behind accounts sharing a normalized email',
    duplicateEmailOrderImpactSql(tables),
  );
  const [lifetimeThresholds] = await runQuery<Record<string, unknown>>(
    prestashop,
    'prestashop',
    'identity-quality.lifetime-frequency-thresholds',
    'accounts with lifetime valid orders over 10/50/100/500/1000',
    lifetimeFrequencyThresholdsSql(tables),
  );
  const [sharedAccounts] = await runQuery<Record<string, unknown>>(
    prestashop,
    'prestashop',
    'identity-quality.potential-shared-accounts',
    'heuristic: high lifetime frequency with high same-day order density',
    potentialSharedAccountsSql(tables),
  );
  const [zeroCustomerOrders] = await runQuery<Record<string, unknown>>(
    prestashop,
    'prestashop',
    'identity-quality.zero-customer-orders',
    'orders with id_customer = 0 (guest/unlinked)',
    identityCoveragePrestashopSql(tables),
  );

  const validOrderCount = Number(validOrderEvidence.validOrderCount ?? 0);
  const validGrossMonetary = String(validOrderEvidence.grossMonetaryTaxIncl ?? '0.000000');
  const duplicateOrders = Number(duplicateEmailImpact?.validOrdersFromDuplicateEmailAccounts ?? 0);
  const duplicateSpend = formatAuditDecimal(String(duplicateEmailImpact?.validGrossMonetaryTaxInclFromDuplicateEmailAccounts ?? '0'));

  return {
    ...identityMeta,
    totals: {
      totalPrestashopCustomers: Number(coreCounts?.totalPrestashopCustomers ?? 0),
      customersWithValidOrders: Number(coreCounts?.customersWithValidOrders ?? 0),
      customersWithoutValidOrders: Number(coreCounts?.customersWithoutValidOrders ?? 0),
    },
    emailQuality: {
      emptyEmails: Number(emailQuality?.emptyEmails ?? 0),
      invalidEmails: Number(emailQuality?.invalidEmails ?? 0),
      testOrInternalPatternEmails: Number(emailQuality?.testOrInternalPatternEmails ?? 0),
    },
    duplicateEmails: {
      duplicateEmailGroups: Number(duplicateEmails?.duplicateEmailGroups ?? 0),
      accountsInDuplicateEmailGroups: Number(duplicateEmails?.accountsInDuplicateEmailGroups ?? 0),
      maxAccountsSharingOneEmail: Number(duplicateEmails?.maxAccountsSharingOneEmail ?? 0),
      validOrdersFromDuplicateEmailAccounts: duplicateOrders,
      validGrossMonetaryTaxInclFromDuplicateEmailAccounts: duplicateSpend,
      percentOfValidOrders: percentage(duplicateOrders, validOrderCount),
      percentOfValidGrossMonetary: divideAuditDecimal(duplicateSpend, validGrossMonetary),
    },
    lifetimeFrequencyThresholds: {
      accountsOver10: Number(lifetimeThresholds?.accountsOver10 ?? 0),
      accountsOver50: Number(lifetimeThresholds?.accountsOver50 ?? 0),
      accountsOver100: Number(lifetimeThresholds?.accountsOver100 ?? 0),
      accountsOver500: Number(lifetimeThresholds?.accountsOver500 ?? 0),
      accountsOver1000: Number(lifetimeThresholds?.accountsOver1000 ?? 0),
    },
    testOrInternalAccounts: {
      deletedAccounts: Number(coreCounts?.deletedAccounts ?? 0),
      inactiveAccounts: Number(coreCounts?.inactiveAccounts ?? 0),
      guestAccounts: Number(coreCounts?.guestAccounts ?? 0),
      accountsWithCompanyName: Number(coreCounts?.accountsWithCompanyName ?? 0),
      testOrInternalPatternEmails: Number(emailQuality?.testOrInternalPatternEmails ?? 0),
      method: 'aggregate CASE/COUNT flags only; no individual account is published',
    },
    zeroCustomerOrders: Number(zeroCustomerOrders?.guestOrZeroCustomerOrders ?? 0),
    potentialSharedAccounts: {
      count: Number(sharedAccounts?.potentialSharedOrInstitutionalAccounts ?? 0),
      heuristic: 'lifetime valid orders > 50 AND average orders per distinct order day > 2',
      caveat: 'diagnostic signal only, not a determination of fact — see docs Interpretations',
    },
    noPiiPublished: true,
  };
}

// ---------------------------------------------------------------------------------------
// Section 3: frequency outlier analysis
// ---------------------------------------------------------------------------------------
async function buildFrequencyOutlierAnalysis(
  prestashop: mysql.Connection,
  tables: RfmPrestashopTables,
  window: RfmWindow,
  activeRows: readonly ActiveRow[],
  identityMeta: IdentityModeMetadata,
): Promise<Record<string, unknown>> {
  const windowParams = [window.windowStartInclusive, window.windowEndExclusive] as const;
  const [profile] = await runQuery<Record<string, unknown>>(
    prestashop,
    'prestashop',
    'outlier.profile',
    'aggregate profile of the single highest window-frequency customer (id never selected)',
    frequencyOutlierProfileSql(tables),
    [...windowParams, ...windowParams, ...windowParams, ...windowParams],
  );
  const [accountFlags] = await runQuery<Record<string, unknown>>(
    prestashop,
    'prestashop',
    'outlier.account-flags',
    'non-identifying account-state flags for the same customer',
    frequencyOutlierAccountFlagsSql(tables),
    [...windowParams],
  );
  const shopBreakdownRows = await runQuery<Record<string, unknown>>(
    prestashop,
    'prestashop',
    'outlier.shop-breakdown',
    'lifetime order split by shop for the same customer',
    frequencyOutlierShopBreakdownSql(tables),
    [...windowParams],
  );

  const windowValidOrders = Number(profile?.windowValidOrders ?? 0);
  const windowGrossMonetary = formatAuditDecimal(String(profile?.windowGrossMonetaryTaxIncl ?? '0'));
  const lastValidOrderAt = profile?.lastValidOrderAt ? String(profile.lastValidOrderAt) : null;
  const windowRecencyDays = lastValidOrderAt ? recencyDaysClamped(window.asOfDate, lastValidOrderAt) : null;

  const sortedByFrequencyDesc = [...activeRows].sort((a, b) => b.frequencyOrders - a.frequencyOrders);
  const topOutlierRow: ActiveRow | undefined = sortedByFrequencyDesc[0];

  const variantA = describePopulationVariant(activeRows);
  const variantB = describePopulationVariant(activeRows.filter((row) => row.frequencyOrders <= OUTLIER_LIFETIME_THRESHOLD_OVER_100));
  const variantC = describePopulationVariant(activeRows.filter((row) => row.frequencyOrders <= OUTLIER_LIFETIME_THRESHOLD_OVER_500));
  const variantExcludeTopOnly = topOutlierRow
    ? describePopulationVariant(activeRows.filter((row) => row.prestashopCustomerId !== topOutlierRow.prestashopCustomerId))
    : variantA;

  const winsorCap = variantA.frequency.p99 ?? variantA.frequency.max ?? 0;
  const winsorized = activeRows.map((row) => Math.min(row.frequencyOrders, winsorCap));

  return {
    ...identityMeta,
    outlierProfile: {
      lifetimeValidOrders: Number(profile?.lifetimeValidOrders ?? 0),
      lifetimeShopCount: Number(profile?.lifetimeShopCount ?? 0),
      firstValidOrderAt: profile?.firstValidOrderAt ?? null,
      lastValidOrderAt,
      lifetimeDistinctDays: Number(profile?.lifetimeDistinctDays ?? 0),
      lifetimeGrossMonetaryTaxIncl: formatAuditDecimal(String(profile?.lifetimeGrossMonetaryTaxIncl ?? '0')),
      windowValidOrders,
      windowGrossMonetaryTaxIncl: windowGrossMonetary,
      windowAverageTicket: windowValidOrders > 0 ? divideAuditDecimal(windowGrossMonetary, String(windowValidOrders)) : '0.000000',
      windowDistinctDays: Number(profile?.windowDistinctDays ?? 0),
      windowRecencyDays,
      matchesTaskReportedOutlier: windowValidOrders === 2080,
      accountFlags: {
        isGuest: Number(accountFlags?.isGuest ?? 0) === 1,
        isActive: Number(accountFlags?.isActive ?? 1) === 1,
        isDeleted: Number(accountFlags?.isDeleted ?? 0) === 1,
        hasCompanyName: Number(accountFlags?.hasCompanyName ?? 0) === 1,
        customerCreatedAt: accountFlags?.customerCreatedAt ?? null,
      },
      shopBreakdown: shopBreakdownRows.map((row) => ({ shopId: Number(row.shopId), lifetimeOrders: Number(row.lifetimeOrders) })),
      interpretation:
        'High lifetime frequency concentrated in non-webstore shop id(s), low distinct-day-to-order ratio, and no company name on file are consistent with a point-of-sale/wholesale-style account rather than a single retail shopper; not a definitive classification — see docs Interpretations.',
    },
    populationComparison: {
      A_fullActivePopulation: variantA,
      B_excludeWindowFrequencyOver100: variantB,
      C_excludeWindowFrequencyOver500: variantC,
      D_winsorizationDiagnosticOnly: {
        cap: winsorCap,
        method: 'frequencyOrders capped at p99 of the full active population; diagnostic only, never applied to published scores',
        frequency: describeNumericDistribution(winsorized),
      },
      E_excludeSingleTopOutlierOnly: variantExcludeTopOnly,
    },
    impactOfExcludingOutlier: {
      activeCountDelta: variantExcludeTopOnly.activeCount - variantA.activeCount,
      frequencyMaxDelta: (variantExcludeTopOnly.frequency.max ?? 0) - (variantA.frequency.max ?? 0),
      frequencyP95Delta: (variantExcludeTopOnly.frequency.p95 ?? 0) - (variantA.frequency.p95 ?? 0),
      frequencyP99Delta: (variantExcludeTopOnly.frequency.p99 ?? 0) - (variantA.frequency.p99 ?? 0),
      monetaryTop1ShareRatio: divideAuditDecimal(variantExcludeTopOnly.monetary.top1Share, variantA.monetary.top1Share === '0.000000' ? '1.000000' : variantA.monetary.top1Share),
      note: 'the *Delta fields are (excluding-outlier variant) minus (full population); monetaryTop1ShareRatio is (excluding-outlier variant) divided by (full population) — see raw variant objects for absolute values',
    },
    noIndividualIdentityPublished: true,
  };
}

function describePopulationVariant(rows: readonly ActiveRow[]): {
  readonly activeCount: number;
  readonly frequency: ReturnType<typeof describeNumericDistribution>;
  readonly recency: ReturnType<typeof describeNumericDistribution>;
  readonly monetary: ReturnType<typeof monetaryOutlierSummary>;
} {
  return {
    activeCount: rows.length,
    frequency: describeNumericDistribution(rows.map((row) => row.frequencyOrders)),
    recency: describeNumericDistribution(rows.map((row) => row.recencyDays)),
    monetary: monetaryOutlierSummary(rows.map((row) => row.grossMonetaryTaxIncl)),
  };
}

function recencyDaysClamped(asOfDate: string, lastValidOrderAt: string): number {
  // The outlier's lastValidOrderAt may fall outside the RFM window (it can be a lifetime
  // date, not lastValidOrderAtInWindow) — recencyDays() only accepts dates on/before
  // asOfDate, which lifetime dates always are by construction, so this is a direct call.
  return recencyDays(asOfDate, lastValidOrderAt);
}

// ---------------------------------------------------------------------------------------
// Section 4: multishop analysis
// ---------------------------------------------------------------------------------------
async function buildMultishopAnalysis(
  prestashop: mysql.Connection,
  tables: RfmPrestashopTables,
  window: RfmWindow,
  hasShopTable: boolean,
  shopTableName: string,
  identityMeta: IdentityModeMetadata,
): Promise<Record<string, unknown>> {
  const lifetimeRows = await runQuery<Record<string, unknown>>(
    prestashop,
    'prestashop',
    'multishop.lifetime-totals',
    'lifetime customers/orders/spend per shop, bounded to date_add < windowEndExclusive',
    shopLifetimeTotalsSql(tables),
    [window.windowEndExclusive],
  );
  const [crossShop] = await runQuery<Record<string, unknown>>(
    prestashop,
    'prestashop',
    'multishop.cross-shop-customers',
    'customers with valid orders in more than one shop, bounded to date_add < windowEndExclusive',
    crossShopCustomerCountSql(tables),
    [window.windowEndExclusive],
  );
  const windowRows = await runQuery<Record<string, unknown>>(
    prestashop,
    'prestashop',
    'multishop.window-population',
    'per-shop window-scoped R/F/M population',
    shopScopedActivePopulationSql(tables),
    [window.windowStartInclusive, window.windowEndExclusive],
  );

  let shopLabels = new Map<number, string>();
  if (hasShopTable) {
    const labelRows = await runQuery<Record<string, unknown>>(
      prestashop,
      'prestashop',
      'multishop.shop-labels',
      'non-PII shop display names',
      shopLabelsSql(shopTableName),
    );
    shopLabels = new Map(labelRows.map((row) => [Number(row.shopId), String(row.shopName)]));
  }

  const byShop = new Map<number, { frequencyOrders: number; grossMonetaryTaxIncl: string; recencyDays: number }[]>();
  for (const row of windowRows) {
    const shopId = Number(row.shopId);
    const list = byShop.get(shopId) ?? [];
    const lastValidOrderAtInWindow = row.lastValidOrderAtInWindow ? String(row.lastValidOrderAtInWindow) : null;
    if (!lastValidOrderAtInWindow) continue;
    list.push({
      frequencyOrders: Number(row.frequencyOrders),
      grossMonetaryTaxIncl: formatAuditDecimal(String(row.grossMonetaryTaxIncl)),
      recencyDays: recencyDays(window.asOfDate, lastValidOrderAtInWindow),
    });
    byShop.set(shopId, list);
  }

  const perShopWindow = Array.from(byShop.entries()).map(([shopId, rows]) => ({
    shopId,
    shopName: shopLabels.get(shopId) ?? null,
    activeCustomers: rows.length,
    frequency: describeNumericDistribution(rows.map((row) => row.frequencyOrders)),
    monetary: monetaryOutlierSummary(rows.map((row) => row.grossMonetaryTaxIncl)),
    recency: describeNumericDistribution(rows.map((row) => row.recencyDays)),
  }));

  const customersWithValidOrders = Number(crossShop?.customersWithValidOrders ?? 0);
  const customersInMultipleShops = Number(crossShop?.customersInMultipleShops ?? 0);

  return {
    ...identityMeta,
    shopCount: lifetimeRows.length,
    lifetime: {
      perShop: lifetimeRows.map((row) => ({
        shopId: Number(row.shopId),
        shopName: shopLabels.get(Number(row.shopId)) ?? null,
        customers: Number(row.customers),
        validOrders: Number(row.validOrders),
        grossMonetaryTaxIncl: formatAuditDecimal(String(row.grossMonetaryTaxIncl)),
      })),
      customersWithValidOrders,
      customersInMultipleShops,
      multiShopSharePercent: percentage(customersInMultipleShops, customersWithValidOrders),
    },
    window: {
      perShop: perShopWindow,
    },
    sameCommercialOperationAssessment:
      'Shops differ materially in lifetime order volume and (per lifetime.perShop) in customer overlap; treat each shop as a distinct commercial channel until confirmed otherwise, not an equivalent duplicate of the main storefront.',
    currentT10Treatment: 'T10A aggregates all shops into a single population dataset (no shop filter, no shop dimension published in population-summary.json)',
    impactOfGroupingAllShops:
      'A single high-frequency account concentrated in one non-primary shop (see frequency-outlier-analysis.json) can dominate the tail of the pooled F/M distributions; grouping without a shop dimension hides this.',
    impactOfAnalyzingSeparately:
      'Per-shop R/F/M (window.perShop) shows whether cut points and score distributions would differ by channel; if they do, a shared rfm-v1 model risks misclassifying customers whose channel has structurally different order cadence.',
    decision: 'Open: T10A does not yet freeze whether rfm-v1 aggregates, filters to a primary shop, or publishes a shop dimension — see docs Decisions.',
  };
}

// ---------------------------------------------------------------------------------------
// Section 6: frequency threshold simulation (Models A/B/C)
// ---------------------------------------------------------------------------------------
function buildFrequencyThresholdSimulation(
  activeRows: readonly ActiveRow[],
  outlierAnalysis: Record<string, unknown>,
  identityMeta: IdentityModeMetadata,
): Record<string, unknown> {
  const modelRows: FrequencyModelRow[] = activeRows.map((row) => ({
    frequencyOrders: row.frequencyOrders,
    grossMonetaryTaxIncl: row.grossMonetaryTaxIncl,
    recencyDays: row.recencyDays,
  }));
  const modelCClassify = modelCClassifier(modelRows);

  const modelAGroups = buildFrequencyModelGroups(modelRows, classifyFrequencyModelA);
  const modelBGroups = buildFrequencyModelGroups(modelRows, classifyFrequencyModelB);
  const modelCGroups = buildFrequencyModelGroups(modelRows, modelCClassify);

  const populationComparison = outlierAnalysis.populationComparison as Record<string, { activeCount: number }> | undefined;
  const excludingTopOutlier = populationComparison?.E_excludeSingleTopOutlierOnly;

  return {
    ...identityMeta,
    noNtile: true,
    activePopulationCount: activeRows.length,
    models: {
      A: { definition: FREQUENCY_MODEL_DEFINITIONS.A, groups: modelAGroups },
      B: { definition: FREQUENCY_MODEL_DEFINITIONS.B, groups: modelBGroups },
      C: { definition: FREQUENCY_MODEL_DEFINITIONS.C, groups: modelCGroups },
    },
    sensitivityToOutliers: {
      method: 'sizes/shares recomputed excluding the single top window-frequency outlier (see frequency-outlier-analysis.json populationComparison.E)',
      excludingTopOutlierActivePopulationCount: excludingTopOutlier?.activeCount ?? null,
      note: 'Model A/C top bucket (F5) is the most exposed to a single high-frequency account; compare F5 customerCount/percentOfActiveSpend above against the excluded-population active count to gauge concentration.',
    },
    temporalStabilityReference: 'see temporal-stability-real.json — Model B is used there as the single reference F model for RFM-code migration; Models A and C are reported here for comparison only, not carried into temporal stability',
    commercialUtilityNotes: {
      A: 'Coarser at the top (6+ collapses everything from 6 to 2080 orders into one bucket) — likely to bury the outlier inside F5 without flagging it.',
      B: 'Middle ground; separates casual repeat buyers (3-4) from frequent ones (5-9) from extreme ones (10+), still one bucket for very large accounts.',
      C: 'Maximizes separation by construction (rank over distinct values) but bucket boundaries move every time the population changes, which works against a stable, versioned rfm-v1 threshold.',
    },
  };
}

// ---------------------------------------------------------------------------------------
// Section 8: commercial validity
// ---------------------------------------------------------------------------------------
function buildCommercialValidityAnalysis(
  activeRows: readonly ActiveRow[],
  normalized: readonly NormalizedPopulationRow[],
  identityQuality: Record<string, unknown>,
  outlierAnalysis: Record<string, unknown>,
  identityMeta: IdentityModeMetadata,
): Record<string, unknown> {
  const commercialRows: CommercialRow[] = activeRows.map((row) => ({
    frequencyOrders: row.frequencyOrders,
    grossMonetaryTaxIncl: row.grossMonetaryTaxIncl,
    recencyDays: row.recencyDays,
  }));

  const rScores = scoreTieSafe(commercialRows.map((row) => row.recencyDays), 'lower_value_better');
  const mScores = scoreTieSafeDecimal(commercialRows.map((row) => row.grossMonetaryTaxIncl), 'higher_value_better');
  const modelCClassify = modelCClassifier(commercialRows.map((row) => ({ frequencyOrders: row.frequencyOrders, grossMonetaryTaxIncl: row.grossMonetaryTaxIncl, recencyDays: row.recencyDays })));

  const rGroups = buildCommercialGroupTable(commercialRows, (row) => {
    const score = rScores.get(row.recencyDays);
    if (!score) throw new Error('Missing R score in commercial validity table');
    return score;
  });
  const mGroups = buildCommercialGroupTable(commercialRows, (row) => {
    const score = mScores.get(row.grossMonetaryTaxIncl);
    if (!score) throw new Error('Missing M score in commercial validity table');
    return score;
  });
  const fGroupsA = buildCommercialGroupTable(commercialRows, (row) => classifyFrequencyModelA(row.frequencyOrders));
  const fGroupsB = buildCommercialGroupTable(commercialRows, (row) => classifyFrequencyModelB(row.frequencyOrders));
  const fGroupsC = buildCommercialGroupTable(commercialRows, (row) => modelCClassify(row.frequencyOrders));

  const historicalInactive = normalized.filter((row) => row.eligibilityStatus === 'historical_inactive');
  const historicalInactiveLifetimeSpend = historicalInactive.length === 0 ? '0.000000' : addAuditDecimals(historicalInactive.map((row) => row.lifetimeGrossMonetaryTaxIncl));

  const accountsWithCompanyName = Number((identityQuality.testOrInternalAccounts as Record<string, unknown> | undefined)?.accountsWithCompanyName ?? 0);
  const outlierProfile = outlierAnalysis.outlierProfile as Record<string, unknown> | undefined;
  const outlierWindowSpend = String(outlierProfile?.windowGrossMonetaryTaxIncl ?? '0.000000');
  const m5 = mGroups.find((group) => group.score === 5);
  const outlierShareOfM5Spend = m5 && m5.grossMonetaryTaxInclTotal !== '0.000000' ? divideAuditDecimal(outlierWindowSpend, m5.grossMonetaryTaxInclTotal) : '0.000000';

  const fB2 = fGroupsB.find((group) => group.score === 2);
  const fB1 = fGroupsB.find((group) => group.score === 1);
  const fA5 = fGroupsA.find((group) => group.score === 5);
  const fA4 = fGroupsA.find((group) => group.score === 4);
  const r1 = rGroups.find((group) => group.score === 1);

  return {
    ...identityMeta,
    scoreGroups: {
      recency: rGroups,
      monetary: mGroups,
      frequencyModelA: fGroupsA,
      frequencyModelB: fGroupsB,
      frequencyModelC: fGroupsC,
    },
    distinguishability: {
      recency: evaluateDistinguishability(rGroups),
      monetary: evaluateDistinguishability(mGroups),
      frequencyModelA: evaluateDistinguishability(fGroupsA),
      frequencyModelB: evaluateDistinguishability(fGroupsB),
      frequencyModelC: evaluateDistinguishability(fGroupsC),
      method: 'higher score average spend >= 1.2x lower score average spend',
    },
    answers: {
      isF2UsefulRecurrenceSignal: {
        answer: fB2 && fB1 ? compareDataDriven(fB2.averageGrossMonetaryTaxIncl, fB1.averageGrossMonetaryTaxIncl) : 'insufficient_data',
        basis: { f1: fB1, f2: fB2 },
      },
      isF6PlusHighRecurrence: {
        answer: fA5 && fA4 ? compareDataDriven(fA5.averageGrossMonetaryTaxIncl, fA4.averageGrossMonetaryTaxIncl) : 'insufficient_data',
        basis: { f4: fA4, f5: fA5, note: 'Model A F5 = 6+ orders in window' },
      },
      areM5CustomersLegitimateOrOutlierDominated: {
        answer: outlierShareOfM5Spend,
        interpretation: 'share of M5 group total spend contributed by the single frequency-outlier account alone (see frequency-outlier-analysis.json)',
      },
      doesLowRIdentifyRealInactivity: {
        answer: 'R=1 describes the least-recent slice of the ACTIVE population (still >=1 valid order inside the 12-month window); it is not the same as historical_inactive, which has zero orders inside the window',
        basis: { r1CustomerCount: r1?.customerCount ?? 0, historicalInactiveCount: historicalInactive.length, populationScope: 'P0_all_shops' },
      },
      doesHistoricalInactiveHaveReactivationValue: {
        answer: historicalInactive.length > 0 ? 'non-zero lifetime spend exists outside the window; see basis' : 'no historical_inactive customers found',
        basis: { historicalInactiveCount: historicalInactive.length, historicalInactiveLifetimeGrossMonetaryTaxIncl: historicalInactiveLifetimeSpend, populationScope: 'P0_all_shops' },
      },
      shouldB2BB2CBeSeparated: {
        answer: accountsWithCompanyName === 0
          ? 'company field is unused (0 accounts) in this dataset — it cannot be used as a B2B signal; a shop-based or frequency-based heuristic would be needed instead (see multishop-analysis.json)'
          : `${accountsWithCompanyName} accounts have a company name on file — usable as a partial B2B signal`,
        basis: { accountsWithCompanyName },
      },
    },
    noDefinitiveCommercialLabels: true,
  };
}

function compareDataDriven(higherGroupAvg: string, lowerGroupAvg: string): string {
  const ratio = divideAuditDecimal(higherGroupAvg, lowerGroupAvg === '0.000000' ? '1.000000' : lowerGroupAvg);
  return `average spend ratio ${ratio} (higher-score group average / lower-score group average)`;
}

// ---------------------------------------------------------------------------------------
// Section 9: real temporal stability
// ---------------------------------------------------------------------------------------
async function buildTemporalStabilityReal(
  prestashop: mysql.Connection,
  tables: RfmPrestashopTables,
  window: RfmWindow,
  activeRows: readonly ActiveRow[],
  activeRowsMissingRecency: number,
  identityMeta: IdentityModeMetadata,
): Promise<Record<string, unknown>> {
  const currentSnapshotRows: TemporalSnapshotRow[] = activeRows.map((row) => ({
    prestashopCustomerId: row.prestashopCustomerId,
    frequencyOrders: row.frequencyOrders,
    grossMonetaryTaxIncl: row.grossMonetaryTaxIncl,
    recencyDays: row.recencyDays,
  }));
  const currentSnapshot = buildScoreSnapshot(currentSnapshotRows, classifyFrequencyModelB);

  const runShifted = async (daysBack: number) => {
    const shiftedAsOfDate = shiftAsOfDateByDays(window.asOfDate, daysBack);
    const shiftedWindow = buildRfmWindow(shiftedAsOfDate);
    const rows = await runQuery<ActivePopulationSqlRow>(
      prestashop,
      'prestashop',
      `temporal.active-population.minus${daysBack}d`,
      `re-run active population at asOfDate-${daysBack}d for real temporal stability`,
      activePopulationSql(tables),
      [shiftedWindow.windowStartInclusive, shiftedWindow.windowEndExclusive],
    );
    const snapshotRows: TemporalSnapshotRow[] = rows
      .filter((row) => row.lastValidOrderAtInWindow !== null)
      .map((row) => ({
        prestashopCustomerId: Number(row.prestashopCustomerId),
        frequencyOrders: Number(row.frequencyOrders),
        grossMonetaryTaxIncl: formatAuditDecimal(String(row.grossMonetaryTaxIncl)),
        recencyDays: recencyDays(shiftedAsOfDate, row.lastValidOrderAtInWindow as string),
      }));
    return {
      asOfDate: shiftedAsOfDate,
      window: shiftedWindow,
      activeCount: snapshotRows.length,
      snapshot: buildScoreSnapshot(snapshotRows, classifyFrequencyModelB),
    };
  };

  const minus30 = await runShifted(30);
  const minus60 = await runShifted(60);
  const minus90 = await runShifted(90);

  const vs30 = compareScoreSnapshots(currentSnapshot, minus30.snapshot);
  const vs60 = compareScoreSnapshots(currentSnapshot, minus60.snapshot);
  const vs90 = compareScoreSnapshots(currentSnapshot, minus90.snapshot);

  return {
    ...identityMeta,
    referenceFrequencyModel: 'B (F1=1, F2=2, F3=3-4, F4=5-9, F5=10+) — Models A and C are compared only in frequency-threshold-simulation.json, not carried into this migration analysis',
    simulatedAsOfDates: [window.asOfDate, minus30.asOfDate, minus60.asOfDate, minus90.asOfDate],
    activePopulationCounts: {
      current: currentSnapshotRows.length,
      minus30: minus30.activeCount,
      minus60: minus60.activeCount,
      minus90: minus90.activeCount,
    },
    dataQuality: {
      activeRowsMissingRecencyInWindow: activeRowsMissingRecency,
      note: activeRowsMissingRecency > 0 ? 'some active rows had no computable window recency and were excluded from every snapshot' : 'no anomalies',
    },
    migration: {
      currentVsMinus30: vs30,
      currentVsMinus60: vs60,
      currentVsMinus90: vs90,
    },
    summary: {
      identicalCodePercentVsMinus30: vs30.identicalCodePercent,
      identicalCodePercentVsMinus60: vs60.identicalCodePercent,
      identicalCodePercentVsMinus90: vs90.identicalCodePercent,
    },
    seasonalityCaveat:
      'A 90-day lookback cannot distinguish genuine model instability from calendar seasonality (e.g. promotional periods); confirming seasonality effects requires comparing the same calendar window across multiple years, which this run does not do.',
    stabilityVerdict:
      Number(vs90.identicalCodePercent) >= 0.8
        ? 'stable enough to propose candidate cuts, not yet stable enough to freeze without a longer observation window'
        : 'not stable — do not freeze rfm-v1 cuts from this run alone',
    noIndividualCustomerDataPublished: true,
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
    { decision: 'Canonical identity', answer: 'in RFM_IDENTITY_MODE=master_customer, masterCustomerId with one confirmed prestashop_customer_id' },
    { decision: 'Unconsolidated identity', answer: 'excluded from T10 v1 snapshot and reported as coverage pending (master_customer mode only)' },
    { decision: 'Provisional identity (prestashop_customer mode)', answer: 'ps_customer.id_customer used directly; identityCanonical=false, migrationPending=true on every output' },
    { decision: 'totalIdentityCandidates', answer: 'renamed from totalCanonicalCandidates — the population is not asserted canonical in prestashop_customer mode' },
    { decision: 'Pipeline frequency', answer: 'daily off-peak calculation' },
    { decision: 'Model versioning', answer: 'persist modelVersion with asOfDate and window bounds' },
    { decision: 'Snapshot structure', answer: 'CustomerRfmSnapshot proposal in snapshot-proposal.json and docs' },
    { decision: 'Indexes/batches', answer: 'review EXPLAIN; batch if full population extraction exceeds safe timeout' },
    { decision: 'Future endpoint fields', answer: 'status, modelVersion, calculatedAt, asOfDate, window bounds, metrics, scores, percentiles, lifecycleStage' },
    { decision: 'Out of T10', answer: 'no commercial segment names, no RFM endpoint in T10A, no writes, no migrations, no backfill' },
  ];
}

function buildSection12Decisions(identityMode: IdentityMode): readonly Record<string, string>[] {
  return [
    { decision: '1. ps_customer as provisional identity', answer: 'Valid provisionally for building/testing rfm-v1 mechanics; not valid as canonical — see identity-coverage.json (skipped in prestashop_customer mode) and master-migration-comparison-plan.json' },
    { decision: '2. Conditions for 1:1 equivalence', answer: 'See master-migration-comparison-plan.json acceptanceCriteria (coverage >=99.9%, zero duplicate links, zero order/spend delta on 1:1 mappings, zero score change except documented merges)' },
    { decision: '3. Duplicate treatment', answer: 'Diagnosed only in this run (prestashop-identity-quality.json duplicateEmails); not deduplicated or merged — no write capability in this audit' },
    { decision: '4. Outlier treatment', answer: 'Diagnosed with A/B/C/D/E population variants (frequency-outlier-analysis.json); not excluded from the published population in this run' },
    { decision: '5. Multishop treatment', answer: 'Open — see multishop-analysis.json decision field; T10A currently pools all shops without a shop dimension' },
    { decision: '6. R method', answer: 'Unchanged: tie-safe percentile rank by recencyDays, lower is better' },
    { decision: '7. F method', answer: 'Unchanged: discrete versioned thresholds; Model B used as this run\'s working reference (see frequency-threshold-simulation.json)' },
    { decision: '8. M method', answer: 'Unchanged: tie-safe percentile rank over raw gross grossMonetaryTaxIncl' },
    { decision: '9. F candidate cuts', answer: 'Not frozen — three models simulated (frequency-threshold-simulation.json); selection pending commercial + stability review' },
    { decision: '10. Temporal stability', answer: 'Measured for real at asOfDate/-30/-60/-90 (temporal-stability-real.json); see stabilityVerdict field for this run' },
    { decision: '11. Commercial validity', answer: 'Data-driven answers computed in commercial-validity-analysis.json answers; no definitive commercial segment labels assigned' },
    { decision: '12. Conditions to freeze rfm-v1', answer: 'Not met in this run: multishop treatment undecided, F cuts unfrozen, outlier treatment unresolved, identity still provisional' },
    { decision: '13. Migration criteria to master_customer', answer: 'See master-migration-comparison-plan.json acceptanceCriteria' },
    { decision: `14. Still provisional (identityMode=${identityMode})`, answer: 'Everything produced by this run: population totals, R/F/M distributions, all section 2-9 outputs — identityCanonical=false, migrationPending=true' },
  ];
}

function checkCredentials(mode: IdentityMode): { readonly available: boolean; readonly missing: readonly string[] } {
  const required = requiredEnvVarsForMode(mode);
  const missing = required.filter((name) => !process.env[name] || process.env[name]!.trim() === '');
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
