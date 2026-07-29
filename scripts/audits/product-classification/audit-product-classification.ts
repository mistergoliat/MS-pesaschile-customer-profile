// CP-R1-T09A - Product Classification Coverage Audit.
//
// Standalone, read-only, one-shot tool. It does not import runtime src/ modules, does
// not create endpoints, does not mutate contracts, and writes only ignored aggregate
// outputs under scripts/audits/product-classification/outputs/.
//
// Run with:
//   npx tsx scripts/audits/product-classification/audit-product-classification.ts

import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { catalogShopExists, CATALOG_SHOP_ID_ENV, resolveCatalogShopId } from './lib/config.js';
import { buildCoverageBreakdown, normalizePublicName, summarizeHistogram } from './lib/coverage.js';
import { addDecimalStrings, formatScaledDecimal, parseNonNegativeDecimalToScaled, percentage } from './lib/decimal.js';
import { assessGrants, assertSafeSql, detectPrefix, evaluateLoad, parseServerVersion } from './lib/guardrails.js';
import { auditCategoryHierarchy } from './lib/hierarchy.js';
import {
  buildTables,
  catalogShopExistsSql,
  categoryCoverageSql,
  categoryHierarchySql,
  categoryRankingSql,
  combinedCustomerPreferenceCandidateSql,
  customerCategoryPreferenceCandidateSql,
  customerCoverageCandidateSql,
  customerManufacturerPreferenceCandidateSql,
  manufacturerCoverageSql,
  manufacturerRankingSql,
  multicategorySql,
  productCoverageSql,
  productShopDivergenceSql,
  reconciliationSql,
  requiredProductClassificationSuffixes,
  universeSummarySql,
  type ProductClassificationTables,
} from './lib/sql.js';
import type { CategoryNode, CountAndSpend, HistogramBucket } from './lib/types.js';
import { buildObservedPreferencesContractDocs } from './lib/contract-proposal.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(SCRIPT_DIR, 'outputs');
const QUERY_TIMEOUT_MS = 20000;
const TOP_LIMIT = 100;
const REQUIRED_ENV_VARS = ['PRESTASHOP_DB_HOST', 'PRESTASHOP_DB_USER', 'PRESTASHOP_DB_PASSWORD'] as const;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;

type QueryLogEntry = {
  readonly name: string;
  readonly purpose: string;
  readonly durationMs: number;
  readonly rowCount: number;
};

const queryLog: QueryLogEntry[] = [];
const explains: Record<string, unknown> = {};

async function main(): Promise<void> {
  const credentials = checkCredentials();
  const catalogShopId = resolveCatalogShopId(process.env);
  if (!credentials.available) {
    await writeJson('preflight.json', {
      executedAt: new Date().toISOString(),
      status: 'aborted',
      reason: 'missing_credentials',
      missingEnvVars: credentials.missing,
    });
    console.error(`[audit-product-classification] Aborted: missing env vars (${credentials.missing.join(', ')}).`);
    process.exitCode = 1;
    return;
  }
  if (!catalogShopId.ok) {
    await writeJson('preflight.json', {
      executedAt: new Date().toISOString(),
      status: 'aborted',
      reason: `catalog_shop_id_${catalogShopId.reason}`,
      requiredEnvVar: CATALOG_SHOP_ID_ENV,
    });
    console.error(`[audit-product-classification] Aborted: ${CATALOG_SHOP_ID_ENV} is ${catalogShopId.reason}.`);
    process.exitCode = 1;
    return;
  }

  const connection = await mysql.createConnection({
    host: process.env.PRESTASHOP_DB_HOST,
    port: process.env.PRESTASHOP_DB_PORT ? Number(process.env.PRESTASHOP_DB_PORT) : 3306,
    user: process.env.PRESTASHOP_DB_USER,
    password: process.env.PRESTASHOP_DB_PASSWORD,
    database: process.env.PRESTASHOP_DB_NAME || 'pesas_productiva',
    connectTimeout: QUERY_TIMEOUT_MS,
    dateStrings: true,
    timezone: 'Z',
  });

  try {
    const startedAt = Date.now();
    await runQuery(connection, 'preflight.select-1', 'lightweight connectivity check', 'SELECT 1 AS ok');
    const grantRows = await runQuery<Record<string, string>>(
      connection,
      'preflight.show-grants',
      'read-only grant verification',
      'SHOW GRANTS FOR CURRENT_USER()',
    );
    const grants = assessGrants(grantRows.map((row) => Object.values(row)[0] as string));
    const [threadsRow] = await runQuery<{ Value: string }>(
      connection,
      'preflight.threads-running',
      'server load guardrail input',
      "SHOW GLOBAL STATUS LIKE 'Threads_running'",
    );
    const [maxConnRow] = await runQuery<{ Value: string }>(
      connection,
      'preflight.max-connections',
      'server load guardrail input',
      "SHOW VARIABLES LIKE 'max_connections'",
    );
    const load = evaluateLoad(Number(threadsRow?.Value ?? 0), Number(maxConnRow?.Value ?? 0));
    const [versionRow] = await runQuery<{ version: string }>(
      connection,
      'preflight.version',
      'server engine and version',
      'SELECT VERSION() AS version',
    );
    const serverVersion = parseServerVersion(versionRow?.version ?? '');

    const preflight = {
      executedAt: new Date().toISOString(),
      status: grants.safe && load.safe ? 'ok' : 'aborted',
      engine: serverVersion,
      grants,
      load,
      catalogShopId: catalogShopId.shopId,
      queryTimeoutMs: QUERY_TIMEOUT_MS,
      connectionLimit: 1,
    };
    await writeJson('preflight.json', preflight);

    if (!grants.safe || !load.safe) {
      console.error('[audit-product-classification] Aborted: read-only grant or load guardrail failed.');
      process.exitCode = 1;
      return;
    }

    const tableRows = await runQuery<{ TABLE_NAME: string }>(
      connection,
      'discovery.tables',
      'discover PrestaShop-prefixed tables',
      'SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()',
    );
    const tableNames = tableRows.map((row) => row.TABLE_NAME);
    const configuredPrefix = process.env.PRESTASHOP_DB_PREFIX;
    const discovery = configuredPrefix
      ? detectPrefix(tableNames, requiredProductClassificationSuffixes()).prefix === configuredPrefix
        ? {
            prefix: configuredPrefix,
            candidates: [configuredPrefix],
            found: Object.fromEntries(requiredProductClassificationSuffixes().map((suffix) => [suffix, `${configuredPrefix}${suffix}`])),
            missing: [],
            ambiguous: false,
          }
        : detectPrefix(tableNames, requiredProductClassificationSuffixes())
      : detectPrefix(tableNames, requiredProductClassificationSuffixes());

    if (!discovery.prefix || discovery.missing.length > 0) {
      await writeJson('schema-inventory.json', { discovery });
      await writeQueryLogAndExplains();
      console.error('[audit-product-classification] Aborted: required PrestaShop classification tables were not found.');
      process.exitCode = 1;
      return;
    }

    const tables = buildTables(discovery.prefix);
    const shopRow = await firstRow(
      connection,
      'preflight.catalog-shop-exists',
      'verify configured catalog shop exists in product_shop',
      catalogShopExistsSql(tables),
      [catalogShopId.shopId],
    );
    if (!catalogShopExists(shopRow)) {
      await writeJson('preflight.json', {
        ...preflight,
        status: 'aborted',
        reason: 'catalog_shop_not_found',
      });
      await writeQueryLogAndExplains();
      console.error(`[audit-product-classification] Aborted: configured catalog shop id ${catalogShopId.shopId} was not found.`);
      process.exitCode = 1;
      return;
    }
    const schemaInventory = await buildSchemaInventory(connection, tables, discovery);
    await writeJson('schema-inventory.json', schemaInventory);

    const languageId = readPositiveIntegerEnv('PRESTASHOP_ORDER_STATE_LANG_ID') ?? 1;
    const shopId = catalogShopId.shopId;

    const [universe] = await runQuery<Record<string, unknown>>(
      connection,
      'universe.summary',
      'valid-order line universe',
      universeSummarySql(tables),
    );
    const universeSummary = normalizeUniverse(universe);
    await writeJson('universe-summary.json', universeSummary);

    const productRows = await runQuery<Record<string, unknown>>(
      connection,
      'coverage.product-current-catalog',
      'current product existence coverage',
      productCoverageSql(tables),
    );
    const productCoverage = withUniverseEntityDenominators(
      summarizeStatusCoverage(productRows, 'catalogStatus', ['linked']),
      universeSummary,
    );
    await writeJson('product-coverage.json', productCoverage);

    const categoryRows = await runQuery<Record<string, unknown>>(
      connection,
      'coverage.category-default',
      'default-category classification coverage',
      categoryCoverageSql(tables),
      [shopId, languageId, shopId],
    );
    const categoryCoverage = withUniverseEntityDenominators(
      summarizeStatusCoverage(categoryRows, 'categoryStatus', ['classified']),
      universeSummary,
    );
    await writeJson('category-coverage.json', {
      authority: 'configured product_shop default when present, single product_shop default when unambiguous, else ps_product default',
      configuredShopIdUsed: shopId,
      languageIdUsed: languageId,
      ...categoryCoverage,
      productShopDivergence: await firstRow(
        connection,
        'category.product-shop-divergence',
        'multishop category-default divergence',
        productShopDivergenceSql(tables),
        [shopId],
      ),
    });

    const hierarchyRows = await runQuery<Record<string, unknown>>(
      connection,
      'category.hierarchy',
      'category hierarchy reconstruction',
      categoryHierarchySql(tables),
      [languageId, shopId],
    );
    const hierarchy = auditCategoryHierarchy(hierarchyRows.map(toCategoryNode));
    await writeJson('category-hierarchy.json', { languageIdUsed: languageId, hierarchy, categories: hierarchyRows });

    const categoryRanking = await runQuery<Record<string, unknown>>(
      connection,
      'category.ranking',
      'observed category ranking over valid purchases',
      categoryRankingSql(tables),
      [shopId, languageId, shopId, TOP_LIMIT],
    );
    await writeJson('category-ranking.json', {
      topLimit: TOP_LIMIT,
      rows: categoryRanking,
      duplicateNames: duplicateNames(categoryRanking, 'categoryName'),
    });

    const multicategoryRows = await runQuery<Record<string, unknown>>(
      connection,
      'category.multicategory',
      'category_product multiplicity histogram',
      multicategorySql(tables),
    );
    await writeJson('multicategory-analysis.json', summarizeMulticategory(multicategoryRows));

    const manufacturerRows = await runQuery<Record<string, unknown>>(
      connection,
      'coverage.manufacturer',
      'manufacturer classification coverage',
      manufacturerCoverageSql(tables),
    );
    const manufacturerCoverage = withUniverseEntityDenominators(
      summarizeStatusCoverage(manufacturerRows, 'manufacturerStatus', ['classified']),
      universeSummary,
    );
    await writeJson('manufacturer-coverage.json', manufacturerCoverage);

    const manufacturerRanking = await runQuery<Record<string, unknown>>(
      connection,
      'manufacturer.ranking',
      'observed manufacturer ranking over valid purchases',
      manufacturerRankingSql(tables),
      [TOP_LIMIT],
    );
    await writeJson('manufacturer-ranking.json', {
      topLimit: TOP_LIMIT,
      rows: manufacturerRanking,
      duplicateNames: duplicateNames(manufacturerRanking, 'manufacturerName'),
    });

    const reconciliation = await firstRow(
      connection,
      'reconciliation.t07-t08',
      'global aggregate comparison with T07/T08 semantics',
      reconciliationSql(tables),
    );
    await writeJson('reconciliation.json', {
      ...reconciliation,
      explanation:
        'Order paid totals can differ from order_detail totals because orders may include shipping, wrapping, discounts, or other order-level components.',
    });

    await explainCandidateQueries(connection, tables, shopId, languageId);
    const performance = {
      queryTimeoutMs: QUERY_TIMEOUT_MS,
      topLimitRecommended: 20,
      maxTopLimitRecommended: 100,
      runtimeDirectViable: true,
      cacheNeeded: false,
      snapshotNeeded: false,
      recommendedQueries: 2,
      notes: [
        'Use one category aggregate query and one manufacturer aggregate query for T09 runtime.',
        'Keep unclassified spend in separate counters; do not join category_product for financial attribution.',
        'Revisit indexes only if EXPLAIN shows full scans on large customer-specific reads.',
      ],
      explains,
    };
    await writeJson('explains.json', explains);
    await writeJson('performance-analysis.json', performance);

    const auditResult = {
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      universe: universeSummary,
      categoryCoverage: categoryCoverage.coverage,
      manufacturerCoverage: manufacturerCoverage.coverage,
      productCoverage: productCoverage.coverage,
      contractFields: buildObservedPreferencesContractDocs(),
      decisions: buildDecisions(categoryCoverage.coverage.percentages.spentTaxIncl, manufacturerCoverage.coverage.percentages.spentTaxIncl),
    };
    await writeJson('audit-result.json', auditResult);
    await writeQueryLogAndExplains();
    console.info('[audit-product-classification] Completed. Aggregate outputs written under ignored outputs/.');
  } finally {
    await connection.end();
  }
}

async function runQuery<Row = Record<string, unknown>>(
  connection: mysql.Connection,
  name: string,
  purpose: string,
  sql: string,
  params: readonly unknown[] = [],
): Promise<Row[]> {
  assertSafeSql(sql, name);
  const startedAt = Date.now();
  const [rows] = await connection.query({ sql, timeout: QUERY_TIMEOUT_MS }, params as unknown[]);
  queryLog.push({
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

async function firstRow<Row = Record<string, unknown>>(
  connection: mysql.Connection,
  name: string,
  purpose: string,
  sql: string,
  params: readonly unknown[] = [],
): Promise<Row | null> {
  const rows = await runQuery<Row>(connection, name, purpose, sql, params);
  return rows[0] ?? null;
}

async function explainCandidateQueries(
  connection: mysql.Connection,
  tables: ProductClassificationTables,
  shopId: number,
  languageId: number,
): Promise<void> {
  await explainQuery(connection, 'customer.categories', customerCategoryPreferenceCandidateSql(tables), [
    shopId,
    1,
    languageId,
    shopId,
    TOP_LIMIT,
  ]);
  await explainQuery(connection, 'customer.manufacturers', customerManufacturerPreferenceCandidateSql(tables), [1, TOP_LIMIT]);
  await explainQuery(connection, 'customer.coverage', customerCoverageCandidateSql(tables), [shopId, 1, languageId, shopId]);
  await explainQuery(connection, 'global.top-categories', categoryRankingSql(tables), [shopId, languageId, shopId, TOP_LIMIT]);
  await explainQuery(connection, 'combined.customer-preferences', combinedCustomerPreferenceCandidateSql(tables), [
    shopId,
    1,
    1,
    TOP_LIMIT,
  ]);
}

async function buildSchemaInventory(
  connection: mysql.Connection,
  tables: ProductClassificationTables,
  discovery: unknown,
): Promise<Record<string, unknown>> {
  const inventory: Record<string, unknown> = { discovery, tables: {} };
  for (const [suffix, tableName] of Object.entries(tables)) {
    assertSafeIdentifier(tableName, 'table name');
    const columns = await runQuery(
      connection,
      `inventory.columns.${suffix}`,
      `column inventory for ${suffix}`,
      'SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA ' +
        'FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
      [tableName],
    );
    const indexes = await runQuery(connection, `inventory.indexes.${suffix}`, `index inventory for ${suffix}`, `SHOW INDEX FROM \`${tableName}\``);
    (inventory.tables as Record<string, unknown>)[suffix] = { tableName, columns, indexes };
  }
  return inventory;
}

function summarizeStatusCoverage(
  rows: readonly Record<string, unknown>[],
  statusField: string,
  classifiedStatuses: readonly string[],
): { readonly rows: readonly Record<string, unknown>[]; readonly coverage: ReturnType<typeof buildCoverageBreakdown> } {
  const classified = rows.filter((row) => classifiedStatuses.includes(String(row[statusField])));
  const unclassified = rows.filter((row) => !classifiedStatuses.includes(String(row[statusField])));
  return {
    rows,
    coverage: buildCoverageBreakdown(sumRows(classified), sumRows(unclassified)),
  };
}

function withUniverseEntityDenominators(
  summary: ReturnType<typeof summarizeStatusCoverage>,
  universe: Record<string, unknown>,
): ReturnType<typeof summarizeStatusCoverage> {
  const validOrders = Number(universe.validOrders ?? 0);
  const distinctCustomers = Number(universe.distinctCustomers ?? 0);
  const classifiedOrders = summary.coverage.classified.orders ?? 0;
  const classifiedCustomers = summary.coverage.classified.customers ?? 0;

  return {
    ...summary,
    coverage: {
      ...summary.coverage,
      totals: {
        ...summary.coverage.totals,
        orders: validOrders,
        customers: distinctCustomers,
      },
      percentages: {
        ...summary.coverage.percentages,
        orders: percentage(classifiedOrders, validOrders),
        customers: percentage(classifiedCustomers, distinctCustomers),
      },
    },
  };
}

function sumRows(rows: readonly Record<string, unknown>[]): CountAndSpend {
  return {
    lines: sumNumber(rows, 'lineCount'),
    units: sumNumber(rows, 'unitCount'),
    spentTaxIncl: addDecimalStrings(rows.map((row) => String(row.spentTaxIncl ?? '0'))),
    products: sumNumber(rows, 'productCount'),
    orders: sumNumber(rows, 'orderCount'),
    customers: sumNumber(rows, 'customerCount'),
  };
}

function normalizeUniverse(row: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    validOrders: Number(row?.validOrderCount ?? 0),
    orderLines: Number(row?.orderLineCount ?? 0),
    units: Number(row?.unitCount ?? 0),
    spentTaxIncl: formatScaledDecimal(parseNonNegativeDecimalToScaled(String(row?.spentTaxIncl ?? '0'))),
    distinctProducts: Number(row?.distinctProducts ?? 0),
    distinctVariants: Number(row?.distinctVariants ?? 0),
    distinctCustomers: Number(row?.distinctCustomers ?? 0),
  };
}

function summarizeMulticategory(rows: readonly Record<string, unknown>[]): Record<string, unknown> {
  const histogram: HistogramBucket[] = rows.map((row) => ({
    value: Number(row.categoryCount ?? 0),
    count: Number(row.productCount ?? 0),
  }));
  const totalProducts = histogram.reduce((total, bucket) => total + bucket.count, 0);
  const multipleCategoryProducts = histogram
    .filter((bucket) => bucket.value > 1)
    .reduce((total, bucket) => total + bucket.count, 0);
  const defaultMissingProducts = sumNumber(rows, 'defaultMissingProducts');

  return {
    rows,
    summary: summarizeHistogram(histogram),
    buckets: {
      zero: sumBucket(histogram, 0),
      one: sumBucket(histogram, 1),
      two: sumBucket(histogram, 2),
      three: sumBucket(histogram, 3),
      fourOrMore: histogram.filter((bucket) => bucket.value >= 4).reduce((total, bucket) => total + bucket.count, 0),
    },
    multipleCategoryProducts,
    multipleCategoryProductShare: totalProducts === 0 ? 0 : Math.round((multipleCategoryProducts / totalProducts) * 10000) / 100,
    defaultMissingProducts,
  };
}

function duplicateNames(rows: readonly Record<string, unknown>[], field: string): readonly Record<string, unknown>[] {
  const grouped = new Map<string, { rawNames: Set<string>; count: number }>();
  for (const row of rows) {
    const raw = String(row[field] ?? '').trim();
    if (!raw) continue;
    const normalized = normalizePublicName(raw);
    const entry = grouped.get(normalized) ?? { rawNames: new Set<string>(), count: 0 };
    entry.rawNames.add(raw);
    entry.count += 1;
    grouped.set(normalized, entry);
  }
  return Array.from(grouped.entries())
    .filter(([, entry]) => entry.count > 1 || entry.rawNames.size > 1)
    .map(([normalizedName, entry]) => ({
      normalizedName,
      variants: Array.from(entry.rawNames).sort(),
      rowCount: entry.count,
    }));
}

function toCategoryNode(row: Record<string, unknown>): CategoryNode {
  return {
    id: Number(row.categoryId),
    parentId: Number(row.parentId ?? 0),
    name: row.categoryName === null || row.categoryName === undefined ? null : String(row.categoryName),
    active: Number(row.active ?? 0) === 1,
    levelDepth: row.levelDepth === null || row.levelDepth === undefined ? null : Number(row.levelDepth),
  };
}

function buildDecisions(
  categorySpendCoverage: number,
  brandSpendCoverage: number,
): readonly Record<string, string>[] {
  return [
    { decision: 'Fuente de categoria principal', answer: 'usar categoria default resuelta por product_shop operativo cuando exista; si no, ps_product.id_category_default' },
    { decision: 'Tratamiento multishop', answer: 'preferir shop configurado y auditar divergencias; no duplicar filas por multiples shops' },
    { decision: 'Default versus todas las categorias', answer: 'usar solo default para agregados financieros runtime' },
    { decision: 'Productos eliminados', answer: 'conservar historial como no clasificable salvo mapping curado posterior' },
    { decision: 'Cobertura minima categorias', answer: `${categorySpendCoverage}% de gasto clasificado observado; recomendar umbral >= 80% antes de clustering` },
    { decision: 'Cobertura minima marcas', answer: `${brandSpendCoverage}% de gasto clasificado observado; recomendar umbral >= 70% antes de usar marca como feature fuerte` },
    { decision: 'Denominador spendShare', answer: 'gasto total valido de lineas del cliente, incluyendo no clasificable en el denominador' },
    { decision: 'Gasto no clasificable', answer: 'exponer contadores separados y no redistribuir' },
    { decision: 'Ordenamiento tops', answer: 'spent desc, unidades desc, id asc' },
    { decision: 'Top default y maximo', answer: 'default 10, maximo 20 para endpoint futuro; auditoria global usa 100' },
    { decision: 'Runtime directo o snapshot', answer: 'runtime directo viable inicialmente; snapshot no necesario para T09' },
    { decision: 'Numero de consultas', answer: 'dos consultas principales: categorias y marcas, mas cobertura si se expone diagnostico' },
    { decision: 'Endpoint separado o profile', answer: 'endpoint separado; no integrar en profile' },
    { decision: 'Taxonomia comercial propia', answer: 'conveniente antes de clustering si defaults mezclan contenedores, tecnicas o hojas dispares' },
    { decision: 'Campos definitivos T09', answer: 'usar contrato propuesto sin preferredProductType hasta tener taxonomia comercial confiable' },
    { decision: 'Features para clustering', answer: 'preparar categoryId raw, familyId derivado, manufacturerId, spendShare, diversity y unclassified share' },
  ];
}

function sumNumber(rows: readonly Record<string, unknown>[], field: string): number {
  return rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
}

function sumBucket(histogram: readonly HistogramBucket[], value: number): number {
  return histogram.find((bucket) => bucket.value === value)?.count ?? 0;
}

function assertSafeIdentifier(identifier: string, label: string): void {
  if (!SAFE_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Unsafe ${label}: ${identifier}`);
  }
}

function readPositiveIntegerEnv(name: string): number | null {
  const raw = process.env[name];
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
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

async function writeQueryLogAndExplains(): Promise<void> {
  await writeJson('query-log.json', queryLog);
  await writeJson('explains.json', explains);
}

main().catch((error: unknown) => {
  console.error({ error: sanitizeError(error) }, '[audit-product-classification] Failed.');
  process.exitCode = 1;
});
