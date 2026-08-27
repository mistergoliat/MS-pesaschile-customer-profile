// CUSTOMER-INTELLIGENCE-R2-A00 - Product Dataset Exploration & Export.
//
// Standalone, read-only tooling. It exports product evidence for external ontology
// discovery, but deliberately does not classify products or write back to PrestaShop.

import 'dotenv/config';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import mysql from 'mysql2/promise';
import { assessGrants, evaluateLoad } from '../order-state-semantics/lib/guardrails.js';
import { detectPrefix } from '../commercial-summary/lib/schema-discovery.js';
import { parseServerVersion } from '../commercial-summary/lib/version.js';
import {
  EXPORT_DATA_MODEL,
  PRODUCT_EXPLORATION_CSV_COLUMNS,
  PRODUCT_EXPLORATION_VERSION,
  SOURCE_TABLE_MAP,
  XLSX_REVIEW_COLUMNS,
  findPiiLikeExportFields,
  normalizeEvidenceName,
} from './lib/model.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.join(SCRIPT_DIR, 'outputs', 'product-intelligence-exploration');
const DEFAULT_QUERY_TIMEOUT_MS = 60000;
const DEFAULT_MANY_CATEGORY_THRESHOLD = 8;
const DEFAULT_SAMPLE_SIZE = 150;

const REQUIRED_SUFFIXES = [
  'orders',
  'order_detail',
  'product',
  'product_lang',
  'category',
  'category_lang',
  'category_product',
  'manufacturer',
] as const;

const OPTIONAL_SUFFIXES = [
  'product_shop',
  'stock_available',
  'feature',
  'feature_lang',
  'feature_product',
  'feature_value',
  'feature_value_lang',
  'product_attribute',
  'product_attribute_shop',
  'product_attribute_combination',
  'attribute',
  'attribute_lang',
  'attribute_group_lang',
  'product_tag',
  'tag',
] as const;

const WRITE_KEYWORD_PATTERN = /\b(INSERT|UPDATE|DELETE|ALTER|TRUNCATE|DROP|REPLACE|CREATE|GRANT|REVOKE)\b/i;
const SELECT_STAR_PATTERN = /SELECT\s+\*/i;
const PII_PATTERN = /\b(email|firstname|lastname|address\d?|phone|phone_mobile|passwd|secure_key|birthday|rut)\b/i;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;

type TableSuffix = (typeof REQUIRED_SUFFIXES)[number] | (typeof OPTIONAL_SUFFIXES)[number];
type TableMap = Partial<Record<TableSuffix, string>> & Record<(typeof REQUIRED_SUFFIXES)[number], string>;

type QueryLogEntry = {
  readonly name: string;
  readonly purpose: string;
  readonly durationMs: number;
  readonly rowCount: number;
};

type CliArgs = {
  readonly outputDir: string;
  readonly skipXlsx: boolean;
  readonly sampleSize: number;
};

type ProductRow = {
  readonly productId: number;
  readonly catalogPresence: 'current_catalog' | 'historical_order_detail_only';
  readonly reference: string | null;
  readonly name: string | null;
  readonly active: number | null;
  readonly visibility: string | null;
  readonly manufacturerId: number | null;
  readonly manufacturerName: string | null;
  readonly price: string | number | null;
  readonly wholesalePrice: string | number | null;
  readonly defaultCategoryId: number | null;
  readonly condition: string | null;
  readonly weight: string | number | null;
  readonly width: string | number | null;
  readonly height: string | number | null;
  readonly depth: string | number | null;
  readonly dateAdded: string | null;
  readonly dateUpdated: string | null;
  readonly availableForOrder: number | null;
  readonly showPrice: number | null;
  readonly defaultCombinationId: number | null;
  readonly shortDescription: string | null;
  readonly fullDescription: string | null;
  readonly slug: string | null;
  readonly stockQuantity: number | string | null;
  readonly totalStockQuantity: number | string | null;
};

type HistoricalProductIdentityRow = {
  readonly productId: number;
  readonly historicalProductName: string | null;
  readonly historicalProductReference: string | null;
};

type CategoryRow = {
  readonly categoryId: number;
  readonly parentCategoryId: number;
  readonly name: string | null;
  readonly active: number;
  readonly levelDepth: number | null;
  readonly dateAdded: string | null;
  readonly dateUpdated: string | null;
  readonly slug: string | null;
};

type ProductCategoryRow = {
  readonly productId: number;
  readonly categoryId: number;
  readonly position: number | null;
  readonly categoryName: string | null;
  readonly levelDepth: number | null;
};

type FeatureRow = {
  readonly featureId: number;
  readonly featureName: string | null;
  readonly position: number | null;
  readonly assignedProductCount: number;
};

type ProductFeatureRow = {
  readonly productId: number;
  readonly featureId: number;
  readonly featureName: string | null;
  readonly featureValueId: number;
  readonly featureValue: string | null;
  readonly custom: number | null;
};

type CombinationAttributeQueryRow = {
  readonly combinationId: number;
  readonly productId: number;
  readonly reference: string | null;
  readonly priceImpact: string | number | null;
  readonly weightImpact: string | number | null;
  readonly defaultOn: number | null;
  readonly minimalQuantity: number | null;
  readonly availableDate: string | null;
  readonly stockQuantity: string | number | null;
  readonly attributeGroupId: number | null;
  readonly attributeGroupName: string | null;
  readonly attributeId: number | null;
  readonly attributeValue: string | null;
};

type CombinationRow = {
  readonly combinationId: number;
  readonly productId: number;
  readonly reference: string | null;
  readonly priceImpact: string | number | null;
  readonly weightImpact: string | number | null;
  readonly defaultOn: number | null;
  readonly minimalQuantity: number | null;
  readonly availableDate: string | null;
  readonly stockQuantity: string | number | null;
  readonly attributeGroups: string;
  readonly attributeValues: string;
  readonly attributes_json: string;
  readonly attributes_text: string;
  readonly validOrderCount: number;
  readonly unitsSold: number;
};

type TagRow = {
  readonly productId: number;
  readonly tagId: number;
  readonly tagName: string | null;
};

type SalesAggregateRow = {
  readonly productId: number;
  readonly validOrderCount: number;
  readonly unitsSold: number;
  readonly uniqueCustomerCount: number;
  readonly totalRevenueTaxIncl: string | number;
  readonly firstSaleAt: string | null;
  readonly lastSaleAt: string | null;
  readonly averageUnitsPerOrder: number;
};

type VariantSalesRow = {
  readonly productId: number;
  readonly combinationId: number;
  readonly validOrderCount: number;
  readonly unitsSold: number;
};

type RelationshipRow = {
  readonly sourceProductId: number;
  readonly targetProductId: number;
  readonly score: number | null;
  readonly confidence: number | null;
  readonly lift: number | null;
  readonly support: number | null;
  readonly reliability: number | null;
  readonly snapshotId: string | null;
};

type ProductExportRow = Record<string, string | number | boolean | null>;
type DataQualityRow = {
  readonly metric: string;
  readonly value: string | number;
  readonly details_json: string;
};

const queryLog: QueryLogEntry[] = [];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const startedAt = Date.now();

  await mkdir(args.outputDir, { recursive: true });

  const env = resolveEnvironment();
  if (!env.ok) {
    await writeJson(path.join(args.outputDir, 'metadata.json'), {
      generatedAt,
      status: 'aborted',
      reason: env.reason,
      missingEnvVars: env.missingEnvVars,
      extractionVersion: PRODUCT_EXPLORATION_VERSION,
    });
    console.error(`[product-exploration] Aborted: ${env.reason}.`);
    process.exitCode = 1;
    return;
  }

  const connection = await mysql.createConnection({
    host: process.env.PRESTASHOP_DB_HOST,
    port: process.env.PRESTASHOP_DB_PORT ? Number(process.env.PRESTASHOP_DB_PORT) : 3306,
    user: process.env.PRESTASHOP_DB_USER,
    password: process.env.PRESTASHOP_DB_PASSWORD,
    database: process.env.PRESTASHOP_DB_NAME || 'pesas_productiva',
    connectTimeout: env.queryTimeoutMs,
    dateStrings: true,
    timezone: 'Z',
  });

  try {
    await runQuery(connection, 'preflight.select-1', 'lightweight connectivity check', 'SELECT 1 AS ok', [], env.queryTimeoutMs);
    const grantRows = await runQuery<Record<string, string>>(
      connection,
      'preflight.show-grants',
      'read-only grant verification',
      'SHOW GRANTS FOR CURRENT_USER()',
      [],
      env.queryTimeoutMs,
    );
    const grants = assessGrants(grantRows.map((row) => Object.values(row)[0] ?? ''));
    const [threadsRow] = await runQuery<{ Value: string }>(
      connection,
      'preflight.threads-running',
      'server load guardrail input',
      "SHOW GLOBAL STATUS LIKE 'Threads_running'",
      [],
      env.queryTimeoutMs,
    );
    const [maxConnRow] = await runQuery<{ Value: string }>(
      connection,
      'preflight.max-connections',
      'server load guardrail input',
      "SHOW VARIABLES LIKE 'max_connections'",
      [],
      env.queryTimeoutMs,
    );
    const load = evaluateLoad(Number(threadsRow?.Value ?? 0), Number(maxConnRow?.Value ?? 0));
    const [versionRow] = await runQuery<{ version: string }>(
      connection,
      'preflight.version',
      'server engine and version',
      'SELECT VERSION() AS version',
      [],
      env.queryTimeoutMs,
    );

    if (!grants.safe || !load.safe) {
      await writeJson(path.join(args.outputDir, 'metadata.json'), {
        generatedAt,
        status: 'aborted',
        reason: 'read_only_or_load_guardrail_failed',
        grants,
        load,
        extractionVersion: PRODUCT_EXPLORATION_VERSION,
      });
      console.error('[product-exploration] Aborted: read-only grant or load guardrail failed.');
      process.exitCode = 1;
      return;
    }

    const tableRows = await runQuery<{ TABLE_NAME: string }>(
      connection,
      'schema.tables',
      'discover PrestaShop-prefixed tables',
      'SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()',
      [],
      env.queryTimeoutMs,
    );
    const tableNames = tableRows.map((row) => row.TABLE_NAME);
    const prefixDiscovery = discoverPrefix(tableNames, process.env.PRESTASHOP_DB_PREFIX);
    if (!prefixDiscovery.ok) {
      await writeJson(path.join(args.outputDir, 'metadata.json'), {
        generatedAt,
        status: 'aborted',
        reason: prefixDiscovery.reason,
        discovery: prefixDiscovery.discovery,
        extractionVersion: PRODUCT_EXPLORATION_VERSION,
      });
      console.error(`[product-exploration] Aborted: ${prefixDiscovery.reason}.`);
      process.exitCode = 1;
      return;
    }

    const tables = buildTables(prefixDiscovery.prefix, tableNames);
    const shopResolution = await resolveCatalogShopId(connection, tables, env.shopId, env.queryTimeoutMs);
    if (!shopResolution.ok) {
      await writeJson(path.join(args.outputDir, 'metadata.json'), {
        generatedAt,
        status: 'aborted',
        reason: shopResolution.reason,
        shopCandidates: shopResolution.shopCandidates,
        extractionVersion: PRODUCT_EXPLORATION_VERSION,
      });
      console.error(`[product-exploration] Aborted: ${shopResolution.reason}.`);
      process.exitCode = 1;
      return;
    }
    const runtimeEnv = { ...env, shopId: shopResolution.shopId };
    if (tables.product_shop) {
      const [shopRow] = await runQuery<{ shopCount: number }>(
        connection,
        'preflight.catalog-shop-exists',
        'verify configured product shop exists',
        `SELECT COUNT(DISTINCT id_shop) AS shopCount FROM ${tables.product_shop} WHERE id_shop = ?`,
        [runtimeEnv.shopId],
        env.queryTimeoutMs,
      );
      if (Number(shopRow?.shopCount ?? 0) === 0) {
        throw new Error(`Configured catalog shop id ${runtimeEnv.shopId} was not found in ${tables.product_shop}.`);
      }
    } else {
      console.warn('[product-exploration] product_shop table not found; using base product defaults only.');
    }

    const extractionStartedAt = Date.now();
    const currentProductsRaw = await readProducts(connection, tables, runtimeEnv);
    const categoriesRaw = await readCategories(connection, tables, runtimeEnv);
    const productCategoriesRaw = await readProductCategories(connection, tables, runtimeEnv);
    const features = await readFeatures(connection, tables, runtimeEnv);
    const productFeatures = await readProductFeatures(connection, tables, runtimeEnv);
    const tags = await readTags(connection, tables, runtimeEnv);
    const variantSales = await readVariantSales(connection, tables, runtimeEnv);
    const combinations = await readCombinations(connection, tables, runtimeEnv, variantSales);
    const salesAggregates = await readSalesAggregates(connection, tables, runtimeEnv);
    const historicalProductIdentities = await readHistoricalProductIdentities(connection, tables, runtimeEnv);
    const productsRaw = includeHistoricalOnlyProducts(currentProductsRaw, salesAggregates, historicalProductIdentities);
    const relationships = await readRelationships();
    const extractionDurationMs = Date.now() - extractionStartedAt;

    const model = buildExportModel({
      productsRaw,
      categoriesRaw,
      productCategoriesRaw,
      features,
      productFeatures,
      tags,
      combinations,
      salesAggregates,
      relationships,
      manyCategoryThreshold: env.manyCategoryThreshold,
      sampleSize: args.sampleSize,
    });

    const exportStartedAt = Date.now();
    const csvPath = path.join(args.outputDir, 'product_catalog_exploration.csv');
    const samplePath = path.join(args.outputDir, 'representative_product_sample.csv');
    const rawJsonPath = path.join(args.outputDir, 'product_catalog_raw.json');
    const metadataPath = path.join(args.outputDir, 'metadata.json');
    const xlsxPath = path.join(args.outputDir, 'products.xlsx');

    await writeCsv(csvPath, model.products, PRODUCT_EXPLORATION_CSV_COLUMNS);
    await writeCsv(samplePath, model.representativeSample, PRODUCT_EXPLORATION_CSV_COLUMNS);
    await writeJson(rawJsonPath, {
      generatedAt,
      extractionVersion: PRODUCT_EXPLORATION_VERSION,
      dataModel: EXPORT_DATA_MODEL,
      products: model.products,
      categories: model.categories,
      productCategories: model.productCategories,
      features: model.features,
      productFeatures: model.productFeatures,
      combinations: model.combinations,
      salesAggregates: model.salesAggregates,
      relationships: model.relationships,
      dataQuality: model.dataQuality,
      representativeSample: model.representativeSample,
    });
    if (!args.skipXlsx) {
      await writeWorkbook(xlsxPath, model);
    }

    const initialOutputFiles = await summarizeOutputFiles(args.outputDir);
    const exportDurationMs = Date.now() - exportStartedAt;
    const metadata = {
      generatedAt,
      status: 'completed',
      source: 'PrestaShop RDS read-only product catalog plus optional Catalog Service relationship snapshot',
      sourceEnvironment: {
        database: process.env.PRESTASHOP_DB_NAME || 'pesas_productiva',
        tablePrefix: prefixDiscovery.prefix,
        productLanguageId: runtimeEnv.languageId,
        catalogShopId: runtimeEnv.shopId,
        catalogShopIdSource: shopResolution.source,
        server: parseServerVersion(versionRow?.version ?? ''),
      },
      extractionVersion: PRODUCT_EXPLORATION_VERSION,
      validOrderPolicyVersion: 'ps_orders.valid = 1',
      relationshipSnapshot: model.relationshipMetadata,
      productCounts: model.productCounts,
      sourceRowsRead: Object.fromEntries(queryLog.map((entry) => [entry.name, entry.rowCount])),
      queryLog,
      durationsMs: {
        total: Date.now() - startedAt,
        extraction: extractionDurationMs,
        output: exportDurationMs,
      },
      outputFiles: initialOutputFiles,
      sourceTableMap: SOURCE_TABLE_MAP,
      exportDataModel: EXPORT_DATA_MODEL,
      piiCheck: {
        exportedFieldFindings: findPiiLikeExportFields([...PRODUCT_EXPLORATION_CSV_COLUMNS]),
        rawTablesNotExported: SOURCE_TABLE_MAP.filter((entry) => entry.exportStrategy === 'do-not-export-raw').map((entry) => entry.table),
      },
      writeSafety: {
        sqlGuardrail: 'static guard rejects write/DDL keywords and direct PII columns',
        grantGuardrail: grants,
        loadGuardrail: load,
        writesToPrestashop: false,
      },
      catalogServiceAudit: {
        localPath: 'C:\\Users\\Goli\\Pesas Chile\\MS\\MS-Stock\\services',
        prestashopShopIdPolicy: 1,
        relationshipSnapshotDirectory: process.env.PRODUCT_RELATIONSHIP_SNAPSHOT_DIR ?? null,
        reusableComponentsReviewed: [
          'src/infrastructure/catalog/mysqlCatalogExploreDataReader.ts',
          'src/infrastructure/catalog/mysqlCatalogCommercialDataReader.ts',
          'src/infrastructure/recommendation/fileProductRelationshipSnapshotStore.ts',
          'src/domain/recommendation/relationship-engine/publication/contracts.ts',
        ],
        reuseDecision:
          'Do not use explore-products reader as source for A00 because it is product-discovery/runtime oriented; reuse its shop/lang policy and active relationship snapshot contract as evidence inputs.',
      },
    };
    await writeJson(metadataPath, metadata);
    await writeJson(metadataPath, {
      ...metadata,
      outputFiles: await summarizeOutputFiles(args.outputDir),
    });

    console.info(`[product-exploration] Completed ${model.products.length} products into ${args.outputDir}`);
  } finally {
    await connection.end();
  }
}

function parseArgs(argv: readonly string[]): CliArgs {
  let outputDir = DEFAULT_OUTPUT_DIR;
  let skipXlsx = false;
  let sampleSize = DEFAULT_SAMPLE_SIZE;

  for (const arg of argv) {
    if (arg.startsWith('--output-dir=')) {
      outputDir = path.resolve(arg.slice('--output-dir='.length));
    } else if (arg === '--skip-xlsx') {
      skipXlsx = true;
    } else if (arg.startsWith('--sample-size=')) {
      sampleSize = parsePositiveInteger(arg.slice('--sample-size='.length), 'sample-size');
    } else if (arg === '--help') {
      console.info('Usage: npm run product:exploration:export -- [--output-dir=<dir>] [--skip-xlsx] [--sample-size=<n>]');
      process.exit(0);
    } else {
      throw new Error(`Unsupported argument: ${arg}`);
    }
  }

  return { outputDir, skipXlsx, sampleSize };
}

function resolveEnvironment():
  | {
      readonly ok: true;
      readonly languageId: number;
      readonly shopId: number | null;
      readonly queryTimeoutMs: number;
      readonly manyCategoryThreshold: number;
    }
  | { readonly ok: false; readonly reason: string; readonly missingEnvVars: readonly string[] } {
  const missingCredentials = ['PRESTASHOP_DB_HOST', 'PRESTASHOP_DB_USER', 'PRESTASHOP_DB_PASSWORD'].filter((name) => !process.env[name]);
  const languageId = readFirstPositiveIntegerEnv(['PRESTASHOP_PRODUCT_LANG_ID', 'PRESTASHOP_ORDER_STATE_LANG_ID']);
  const shopId = readFirstPositiveIntegerEnv(['PRESTASHOP_CATALOG_SHOP_ID']);
  const missingEnvVars = [...missingCredentials];
  if (!languageId) missingEnvVars.push('PRESTASHOP_PRODUCT_LANG_ID or PRESTASHOP_ORDER_STATE_LANG_ID');

  if (missingEnvVars.length > 0) {
    return { ok: false, reason: 'missing_required_environment', missingEnvVars };
  }
  if (languageId === null) {
    return { ok: false, reason: 'invalid_required_environment', missingEnvVars };
  }

  return {
    ok: true,
    languageId,
    shopId,
    queryTimeoutMs: readPositiveIntegerEnv('PRODUCT_EXPLORATION_QUERY_TIMEOUT_MS') ?? DEFAULT_QUERY_TIMEOUT_MS,
    manyCategoryThreshold: readPositiveIntegerEnv('PRODUCT_EXPLORATION_MANY_CATEGORY_THRESHOLD') ?? DEFAULT_MANY_CATEGORY_THRESHOLD,
  };
}

function discoverPrefix(tableNames: readonly string[], configuredPrefix: string | undefined):
  | { readonly ok: true; readonly prefix: string }
  | { readonly ok: false; readonly reason: string; readonly discovery: unknown } {
  if (configuredPrefix) {
    if (!SAFE_IDENTIFIER_PATTERN.test(configuredPrefix)) {
      return { ok: false, reason: 'unsafe_configured_prefix', discovery: { configuredPrefix } };
    }
    const missing = REQUIRED_SUFFIXES.filter((suffix) => !tableNames.includes(`${configuredPrefix}${suffix}`));
    if (missing.length === 0) {
      return { ok: true, prefix: configuredPrefix };
    }
  }

  const discovery = detectPrefix(tableNames, REQUIRED_SUFFIXES);
  if (!discovery.prefix || discovery.missing.length > 0 || discovery.ambiguous) {
    return { ok: false, reason: 'required_prestashop_tables_not_found', discovery };
  }
  return { ok: true, prefix: discovery.prefix };
}

function buildTables(prefix: string, tableNames: readonly string[]): TableMap {
  if (!SAFE_IDENTIFIER_PATTERN.test(prefix)) throw new Error(`Unsafe PrestaShop prefix: ${prefix}`);
  const allSuffixes = [...REQUIRED_SUFFIXES, ...OPTIONAL_SUFFIXES];
  const tableSet = new Set(tableNames);
  const entries = allSuffixes
    .map((suffix) => [suffix, `${prefix}${suffix}`] as const)
    .filter(([, tableName]) => tableSet.has(tableName));
  const tables = Object.fromEntries(entries) as Partial<Record<TableSuffix, string>>;
  for (const suffix of REQUIRED_SUFFIXES) {
    const tableName = tables[suffix];
    if (!tableName) throw new Error(`Missing required table suffix: ${suffix}`);
  }
  return tables as TableMap;
}

async function resolveCatalogShopId(
  connection: mysql.Connection,
  tables: TableMap,
  configuredShopId: number | null,
  queryTimeoutMs: number,
): Promise<
  | { readonly ok: true; readonly shopId: number; readonly source: 'PRESTASHOP_CATALOG_SHOP_ID' | 'single_product_shop_rowset' }
  | { readonly ok: false; readonly reason: string; readonly shopCandidates: readonly Record<string, unknown>[] }
> {
  if (configuredShopId !== null) {
    return { ok: true, shopId: configuredShopId, source: 'PRESTASHOP_CATALOG_SHOP_ID' };
  }
  if (!tables.product_shop) {
    return { ok: false, reason: 'missing_prestashop_catalog_shop_id_and_product_shop_table', shopCandidates: [] };
  }
  const shopCandidates = await runQuery<{ id_shop: number; productRows: number }>(
    connection,
    'preflight.catalog-shop-candidates',
    'discover catalog shop candidates when PRESTASHOP_CATALOG_SHOP_ID is absent',
    `
      SELECT
        id_shop,
        COUNT(*) AS productRows
      FROM ${tables.product_shop}
      GROUP BY id_shop
      ORDER BY productRows DESC, id_shop ASC
    `,
    [],
    queryTimeoutMs,
  );
  if (shopCandidates.length === 1) {
    return { ok: true, shopId: Number(shopCandidates[0]!.id_shop), source: 'single_product_shop_rowset' };
  }
  return {
    ok: false,
    reason: 'missing_prestashop_catalog_shop_id_for_multishop_catalog',
    shopCandidates,
  };
}

async function readProducts(connection: mysql.Connection, t: TableMap, env: { readonly languageId: number; readonly shopId: number; readonly queryTimeoutMs: number }): Promise<ProductRow[]> {
  const activeExpression = t.product_shop ? 'COALESCE(ps.active, p.active)' : 'p.active';
  const visibilityExpression = t.product_shop ? 'COALESCE(ps.visibility, p.visibility)' : 'p.visibility';
  const priceExpression = t.product_shop ? 'COALESCE(ps.price, p.price)' : 'p.price';
  const wholesalePriceExpression = t.product_shop ? 'COALESCE(ps.wholesale_price, p.wholesale_price)' : 'p.wholesale_price';
  const defaultCategoryExpression = t.product_shop ? 'COALESCE(ps.id_category_default, p.id_category_default)' : 'p.id_category_default';
  const dateAddedExpression = t.product_shop ? 'COALESCE(ps.date_add, p.date_add)' : 'p.date_add';
  const dateUpdatedExpression = t.product_shop ? 'COALESCE(ps.date_upd, p.date_upd)' : 'p.date_upd';
  const stockQuantityExpression = t.stock_available ? 'stock.baseStockQuantity' : 'NULL';
  const totalStockQuantityExpression = t.stock_available ? 'stock.totalStockQuantity' : 'NULL';
  const stockJoin = t.stock_available
    ? `LEFT JOIN (
        SELECT
          id_product,
          SUM(CASE WHEN id_product_attribute = 0 THEN quantity ELSE 0 END) AS baseStockQuantity,
          SUM(quantity) AS totalStockQuantity
        FROM ${t.stock_available}
        WHERE id_shop = ? OR id_shop = 0
        GROUP BY id_product
      ) stock ON stock.id_product = p.id_product`
    : '';
  const productShopJoin = t.product_shop
    ? `LEFT JOIN ${t.product_shop} ps ON ps.id_product = p.id_product AND ps.id_shop = ?`
    : '';
  const sql = `
    SELECT
      p.id_product AS productId,
      'current_catalog' AS catalogPresence,
      p.reference AS reference,
      pl.name AS name,
      ${activeExpression} AS active,
      ${visibilityExpression} AS visibility,
      p.id_manufacturer AS manufacturerId,
      m.name AS manufacturerName,
      ${priceExpression} AS price,
      ${wholesalePriceExpression} AS wholesalePrice,
      ${defaultCategoryExpression} AS defaultCategoryId,
      p.condition AS \`condition\`,
      p.weight AS weight,
      p.width AS width,
      p.height AS height,
      p.depth AS depth,
      ${dateAddedExpression} AS dateAdded,
      ${dateUpdatedExpression} AS dateUpdated,
      p.available_for_order AS availableForOrder,
      p.show_price AS showPrice,
      p.cache_default_attribute AS defaultCombinationId,
      pl.description_short AS shortDescription,
      pl.description AS fullDescription,
      pl.link_rewrite AS slug,
      ${stockQuantityExpression} AS stockQuantity,
      ${totalStockQuantityExpression} AS totalStockQuantity
    FROM ${t.product} p
    LEFT JOIN ${t.product_lang} pl
      ON pl.id_product = p.id_product
     AND pl.id_lang = ?
     AND pl.id_shop = ?
    ${productShopJoin}
    LEFT JOIN ${t.manufacturer} m
      ON m.id_manufacturer = p.id_manufacturer
    ${stockJoin}
    ORDER BY p.id_product ASC
  `;
  const params: unknown[] = [env.languageId, env.shopId];
  if (t.product_shop) params.push(env.shopId);
  if (t.stock_available) params.push(env.shopId);
  return runQuery<ProductRow>(connection, 'products.base', 'base product export rows', sql, params, env.queryTimeoutMs);
}

async function readCategories(connection: mysql.Connection, t: TableMap, env: { readonly languageId: number; readonly shopId: number; readonly queryTimeoutMs: number }): Promise<CategoryRow[]> {
  return runQuery<CategoryRow>(
    connection,
    'categories.all',
    'all category nodes and preferred-language names',
    `
      SELECT
        c.id_category AS categoryId,
        c.id_parent AS parentCategoryId,
        cl.name AS name,
        c.active AS active,
        c.level_depth AS levelDepth,
        c.date_add AS dateAdded,
        c.date_upd AS dateUpdated,
        cl.link_rewrite AS slug
      FROM ${t.category} c
      LEFT JOIN ${t.category_lang} cl
        ON cl.id_category = c.id_category
       AND cl.id_lang = ?
       AND cl.id_shop = ?
      ORDER BY c.id_category ASC
    `,
    [env.languageId, env.shopId],
    env.queryTimeoutMs,
  );
}

async function readProductCategories(connection: mysql.Connection, t: TableMap, env: { readonly languageId: number; readonly shopId: number; readonly queryTimeoutMs: number }): Promise<ProductCategoryRow[]> {
  return runQuery<ProductCategoryRow>(
    connection,
    'product-categories.all',
    'all product/category assignments',
    `
      SELECT
        cp.id_product AS productId,
        cp.id_category AS categoryId,
        cp.position AS position,
        cl.name AS categoryName,
        c.level_depth AS levelDepth
      FROM ${t.category_product} cp
      LEFT JOIN ${t.category} c
        ON c.id_category = cp.id_category
      LEFT JOIN ${t.category_lang} cl
        ON cl.id_category = cp.id_category
       AND cl.id_lang = ?
       AND cl.id_shop = ?
      ORDER BY cp.id_product ASC, cp.position ASC, cp.id_category ASC
    `,
    [env.languageId, env.shopId],
    env.queryTimeoutMs,
  );
}

async function readFeatures(connection: mysql.Connection, t: TableMap, env: { readonly languageId: number; readonly queryTimeoutMs: number }): Promise<FeatureRow[]> {
  if (!t.feature || !t.feature_lang || !t.feature_product) return [];
  return runQuery<FeatureRow>(
    connection,
    'features.catalog',
    'feature definitions and assignment counts',
    `
      SELECT
        f.id_feature AS featureId,
        fl.name AS featureName,
        f.position AS position,
        COUNT(DISTINCT fp.id_product) AS assignedProductCount
      FROM ${t.feature} f
      LEFT JOIN ${t.feature_lang} fl
        ON fl.id_feature = f.id_feature
       AND fl.id_lang = ?
      LEFT JOIN ${t.feature_product} fp
        ON fp.id_feature = f.id_feature
      GROUP BY f.id_feature, fl.name, f.position
      ORDER BY f.position ASC, f.id_feature ASC
    `,
    [env.languageId],
    env.queryTimeoutMs,
  );
}

async function readProductFeatures(connection: mysql.Connection, t: TableMap, env: { readonly languageId: number; readonly queryTimeoutMs: number }): Promise<ProductFeatureRow[]> {
  if (!t.feature_product || !t.feature_lang || !t.feature_value_lang) return [];
  const featureValueJoin = t.feature_value
    ? `LEFT JOIN ${t.feature_value} fv ON fv.id_feature_value = fp.id_feature_value`
    : '';
  const customExpression = t.feature_value ? 'fv.custom' : 'NULL';
  return runQuery<ProductFeatureRow>(
    connection,
    'product-features.all',
    'all product feature values',
    `
      SELECT
        fp.id_product AS productId,
        fp.id_feature AS featureId,
        fl.name AS featureName,
        fp.id_feature_value AS featureValueId,
        fvl.value AS featureValue,
        ${customExpression} AS custom
      FROM ${t.feature_product} fp
      LEFT JOIN ${t.feature_lang} fl
        ON fl.id_feature = fp.id_feature
       AND fl.id_lang = ?
      ${featureValueJoin}
      LEFT JOIN ${t.feature_value_lang} fvl
        ON fvl.id_feature_value = fp.id_feature_value
       AND fvl.id_lang = ?
      ORDER BY fp.id_product ASC, fp.id_feature ASC, fp.id_feature_value ASC
    `,
    [env.languageId, env.languageId],
    env.queryTimeoutMs,
  );
}

async function readTags(connection: mysql.Connection, t: TableMap, env: { readonly languageId: number; readonly queryTimeoutMs: number }): Promise<TagRow[]> {
  if (!t.product_tag || !t.tag) return [];
  return runQuery<TagRow>(
    connection,
    'tags.product',
    'PrestaShop product tags',
    `
      SELECT
        pt.id_product AS productId,
        pt.id_tag AS tagId,
        tag.name AS tagName
      FROM ${t.product_tag} pt
      LEFT JOIN ${t.tag} tag
        ON tag.id_tag = pt.id_tag
       AND tag.id_lang = ?
      ORDER BY pt.id_product ASC, pt.id_tag ASC
    `,
    [env.languageId],
    env.queryTimeoutMs,
  );
}

async function readVariantSales(connection: mysql.Connection, t: TableMap, env: { readonly queryTimeoutMs: number }): Promise<VariantSalesRow[]> {
  return runQuery<VariantSalesRow>(
    connection,
    'sales.variant-aggregates',
    'valid-order sales aggregates by product combination',
    `
      SELECT
        od.product_id AS productId,
        od.product_attribute_id AS combinationId,
        COUNT(DISTINCT o.id_order) AS validOrderCount,
        COALESCE(SUM(od.product_quantity), 0) AS unitsSold
      FROM ${t.orders} o
      INNER JOIN ${t.order_detail} od
        ON od.id_order = o.id_order
      WHERE o.valid = 1
        AND od.product_id IS NOT NULL
        AND od.product_id > 0
        AND od.product_attribute_id IS NOT NULL
        AND od.product_attribute_id <> 0
      GROUP BY od.product_id, od.product_attribute_id
      ORDER BY od.product_id ASC, od.product_attribute_id ASC
    `,
    [],
    env.queryTimeoutMs,
  );
}

async function readCombinations(
  connection: mysql.Connection,
  t: TableMap,
  env: { readonly languageId: number; readonly shopId: number; readonly queryTimeoutMs: number },
  variantSales: readonly VariantSalesRow[],
): Promise<CombinationRow[]> {
  if (!t.product_attribute) return [];
  const priceImpactExpression = t.product_attribute_shop ? 'COALESCE(pas.price, pa.price)' : 'pa.price';
  const weightImpactExpression = t.product_attribute_shop ? 'COALESCE(pas.weight, pa.weight)' : 'pa.weight';
  const defaultOnExpression = t.product_attribute_shop ? 'COALESCE(pas.default_on, pa.default_on)' : 'pa.default_on';
  const minimalQuantityExpression = t.product_attribute_shop ? 'COALESCE(pas.minimal_quantity, pa.minimal_quantity)' : 'pa.minimal_quantity';
  const availableDateExpression = t.product_attribute_shop ? 'COALESCE(pas.available_date, pa.available_date)' : 'pa.available_date';
  const stockQuantityExpression = t.stock_available ? 'stock.quantity' : 'NULL';
  const attributeGroupIdExpression = t.product_attribute_combination && t.attribute && t.attribute_lang && t.attribute_group_lang ? 'attr.id_attribute_group' : 'NULL';
  const attributeGroupNameExpression = t.product_attribute_combination && t.attribute && t.attribute_lang && t.attribute_group_lang ? 'agl.name' : 'NULL';
  const attributeIdExpression = t.product_attribute_combination && t.attribute && t.attribute_lang && t.attribute_group_lang ? 'attr.id_attribute' : 'NULL';
  const attributeValueExpression = t.product_attribute_combination && t.attribute && t.attribute_lang && t.attribute_group_lang ? 'al.name' : 'NULL';
  const attributeOrderExpression = t.product_attribute_combination && t.attribute ? 'attr.position ASC, attr.id_attribute ASC' : 'pa.id_product_attribute ASC';
  const pasJoin = t.product_attribute_shop
    ? `LEFT JOIN ${t.product_attribute_shop} pas ON pas.id_product_attribute = pa.id_product_attribute AND pas.id_shop = ?`
    : '';
  const stockJoin = t.stock_available
    ? `LEFT JOIN ${t.stock_available} stock ON stock.id_product = pa.id_product AND stock.id_product_attribute = pa.id_product_attribute AND (stock.id_shop = ? OR stock.id_shop = 0)`
    : '';
  const attributeJoins =
    t.product_attribute_combination && t.attribute && t.attribute_lang && t.attribute_group_lang
      ? `
        LEFT JOIN ${t.product_attribute_combination} pac
          ON pac.id_product_attribute = pa.id_product_attribute
        LEFT JOIN ${t.attribute} attr
          ON attr.id_attribute = pac.id_attribute
        LEFT JOIN ${t.attribute_lang} al
          ON al.id_attribute = attr.id_attribute
         AND al.id_lang = ?
        LEFT JOIN ${t.attribute_group_lang} agl
          ON agl.id_attribute_group = attr.id_attribute_group
         AND agl.id_lang = ?
      `
      : '';
  const sql = `
    SELECT
      pa.id_product_attribute AS combinationId,
      pa.id_product AS productId,
      pa.reference AS reference,
      ${priceImpactExpression} AS priceImpact,
      ${weightImpactExpression} AS weightImpact,
      ${defaultOnExpression} AS defaultOn,
      ${minimalQuantityExpression} AS minimalQuantity,
      ${availableDateExpression} AS availableDate,
      ${stockQuantityExpression} AS stockQuantity,
      ${attributeGroupIdExpression} AS attributeGroupId,
      ${attributeGroupNameExpression} AS attributeGroupName,
      ${attributeIdExpression} AS attributeId,
      ${attributeValueExpression} AS attributeValue
    FROM ${t.product_attribute} pa
    ${pasJoin}
    ${stockJoin}
    ${attributeJoins}
    ORDER BY pa.id_product ASC, pa.id_product_attribute ASC, ${attributeOrderExpression}
  `;
  const params: unknown[] = [];
  if (t.product_attribute_shop) params.push(env.shopId);
  if (t.stock_available) params.push(env.shopId);
  if (attributeJoins) params.push(env.languageId, env.languageId);
  const rows = await runQuery<CombinationAttributeQueryRow>(connection, 'combinations.all', 'all product combinations and attribute values', sql, params, env.queryTimeoutMs);
  const salesByCombination = new Map(variantSales.map((row) => [row.combinationId, row]));
  const grouped = new Map<number, { base: CombinationAttributeQueryRow; attrs: { groupId: number | null; groupName: string | null; attributeId: number | null; value: string | null }[] }>();
  for (const row of rows) {
    const entry = grouped.get(row.combinationId) ?? { base: row, attrs: [] };
    if (row.attributeId !== null && row.attributeId !== undefined) {
      entry.attrs.push({
        groupId: row.attributeGroupId,
        groupName: row.attributeGroupName,
        attributeId: row.attributeId,
        value: row.attributeValue,
      });
    }
    grouped.set(row.combinationId, entry);
  }
  return Array.from(grouped.values()).map(({ base, attrs }) => {
    const sales = salesByCombination.get(base.combinationId);
    const groupNames = uniqueSorted(attrs.map((attr) => attr.groupName).filter(isPresentString));
    const values = uniqueSorted(attrs.map((attr) => attr.value).filter(isPresentString));
    return {
      combinationId: base.combinationId,
      productId: base.productId,
      reference: base.reference,
      priceImpact: base.priceImpact,
      weightImpact: base.weightImpact,
      defaultOn: base.defaultOn,
      minimalQuantity: base.minimalQuantity,
      availableDate: base.availableDate,
      stockQuantity: base.stockQuantity,
      attributeGroups: groupNames.join(' | '),
      attributeValues: values.join(' | '),
      attributes_json: JSON.stringify(attrs),
      attributes_text: attrs.map((attr) => `${attr.groupName ?? 'unknown'}: ${attr.value ?? 'unknown'}`).join(' | '),
      validOrderCount: Number(sales?.validOrderCount ?? 0),
      unitsSold: Number(sales?.unitsSold ?? 0),
    };
  });
}

async function readSalesAggregates(connection: mysql.Connection, t: TableMap, env: { readonly queryTimeoutMs: number }): Promise<SalesAggregateRow[]> {
  return runQuery<SalesAggregateRow>(
    connection,
    'sales.product-aggregates',
    'valid-order sales aggregates by base product',
    `
      SELECT
        od.product_id AS productId,
        COUNT(DISTINCT o.id_order) AS validOrderCount,
        COALESCE(SUM(od.product_quantity), 0) AS unitsSold,
        COUNT(DISTINCT o.id_customer) AS uniqueCustomerCount,
        COALESCE(SUM(od.total_price_tax_incl), 0) AS totalRevenueTaxIncl,
        MIN(o.date_add) AS firstSaleAt,
        MAX(o.date_add) AS lastSaleAt,
        COALESCE(SUM(od.product_quantity) / NULLIF(COUNT(DISTINCT o.id_order), 0), 0) AS averageUnitsPerOrder
      FROM ${t.orders} o
      INNER JOIN ${t.order_detail} od
        ON od.id_order = o.id_order
      WHERE o.valid = 1
        AND od.product_id IS NOT NULL
        AND od.product_id > 0
      GROUP BY od.product_id
      ORDER BY od.product_id ASC
    `,
    [],
    env.queryTimeoutMs,
  );
}

async function readHistoricalProductIdentities(connection: mysql.Connection, t: TableMap, env: { readonly queryTimeoutMs: number }): Promise<HistoricalProductIdentityRow[]> {
  return runQuery<HistoricalProductIdentityRow>(
    connection,
    'sales.historical-product-identities',
    'latest valid-order line identity by product for products missing from current catalog',
    `
      WITH latest_order_detail AS (
        SELECT
          od.product_id AS productId,
          MAX(od.id_order_detail) AS latestOrderDetailId
        FROM ${t.orders} o
        INNER JOIN ${t.order_detail} od
          ON od.id_order = o.id_order
        WHERE o.valid = 1
          AND od.product_id IS NOT NULL
          AND od.product_id > 0
        GROUP BY od.product_id
      )
      SELECT
        od.product_id AS productId,
        NULLIF(TRIM(od.product_name), '') AS historicalProductName,
        NULLIF(TRIM(od.product_reference), '') AS historicalProductReference
      FROM latest_order_detail latest
      INNER JOIN ${t.order_detail} od
        ON od.id_order_detail = latest.latestOrderDetailId
      ORDER BY od.product_id ASC
    `,
    [],
    env.queryTimeoutMs,
  );
}

function includeHistoricalOnlyProducts(
  currentProducts: readonly ProductRow[],
  salesAggregates: readonly SalesAggregateRow[],
  historicalIdentities: readonly HistoricalProductIdentityRow[],
): readonly ProductRow[] {
  const currentIds = new Set(currentProducts.map((product) => product.productId));
  const historicalByProduct = new Map(historicalIdentities.map((row) => [row.productId, row]));
  const historicalOnly = salesAggregates
    .filter((row) => !currentIds.has(row.productId))
    .map((row): ProductRow => {
      const historical = historicalByProduct.get(row.productId);
      return {
        productId: row.productId,
        catalogPresence: 'historical_order_detail_only',
        reference: historical?.historicalProductReference ?? null,
        name: historical?.historicalProductName ?? null,
        active: null,
        visibility: null,
        manufacturerId: null,
        manufacturerName: null,
        price: null,
        wholesalePrice: null,
        defaultCategoryId: null,
        condition: null,
        weight: null,
        width: null,
        height: null,
        depth: null,
        dateAdded: null,
        dateUpdated: null,
        availableForOrder: null,
        showPrice: null,
        defaultCombinationId: null,
        shortDescription: null,
        fullDescription: null,
        slug: null,
        stockQuantity: null,
        totalStockQuantity: null,
      };
    })
    .sort((left, right) => left.productId - right.productId);
  return [...currentProducts, ...historicalOnly];
}

async function readRelationships(): Promise<RelationshipRow[]> {
  const snapshotDirectory = process.env.PRODUCT_RELATIONSHIP_SNAPSHOT_DIR;
  if (snapshotDirectory) {
    const activeRaw = JSON.parse(await readFile(path.join(snapshotDirectory, 'active.json'), 'utf8')) as unknown;
    const snapshotId = activeRaw && typeof activeRaw === 'object' && 'snapshotId' in activeRaw ? String(activeRaw.snapshotId) : null;
    if (!snapshotId) throw new Error('PRODUCT_RELATIONSHIP_SNAPSHOT_DIR active.json does not contain snapshotId');
    const match = /^sha256:([a-f0-9]{64})$/u.exec(snapshotId);
    if (!match) throw new Error('PRODUCT_RELATIONSHIP_SNAPSHOT_DIR active snapshotId is invalid');
    const snapshot = JSON.parse(await readFile(path.join(snapshotDirectory, 'snapshots', `${match[1]}.json`), 'utf8')) as unknown;
    return normalizeRelationshipRows(snapshot);
  }

  const snapshotPath = process.env.PRODUCT_RELATIONSHIP_SNAPSHOT_PATH;
  if (!snapshotPath) return [];
  const raw = JSON.parse(await readFile(snapshotPath, 'utf8')) as unknown;
  return normalizeRelationshipRows(raw);
}

function normalizeRelationshipRows(raw: unknown): RelationshipRow[] {
  const parentSnapshotId = raw && typeof raw === 'object' && 'snapshotId' in raw ? String((raw as Record<string, unknown>).snapshotId) : null;
  const rows = Array.isArray(raw) ? raw : Array.isArray((raw as { relationships?: unknown }).relationships) ? (raw as { relationships: unknown[] }).relationships : [];
  return rows.flatMap((row): RelationshipRow[] => {
    if (!row || typeof row !== 'object') return [];
    const record = row as Record<string, unknown>;
    const sourceProduct = record.sourceProduct && typeof record.sourceProduct === 'object' ? record.sourceProduct as Record<string, unknown> : null;
    const targetProduct = record.targetProduct && typeof record.targetProduct === 'object' ? record.targetProduct as Record<string, unknown> : null;
    const evidence = record.evidence && typeof record.evidence === 'object' ? record.evidence as Record<string, unknown> : null;
    const sourceProductId = Number(record.sourceProductId ?? record.source_product_id ?? record.productId ?? sourceProduct?.productId);
    const targetProductId = Number(record.targetProductId ?? record.target_product_id ?? record.relatedProductId ?? targetProduct?.productId);
    if (!Number.isSafeInteger(sourceProductId) || !Number.isSafeInteger(targetProductId)) return [];
    const confidence = nullableNumber(record.confidence ?? evidence?.confidence ?? evidence?.transitionProbability);
    const lift = nullableNumber(record.lift ?? evidence?.lift);
    const support = nullableNumber(record.support ?? evidence?.support);
    return [
      {
        sourceProductId,
        targetProductId,
        score: nullableNumber(record.score) ?? confidence ?? support,
        confidence,
        lift,
        support,
        reliability: nullableNumber(record.reliability),
        snapshotId: valueToString(record.snapshotId ?? record.snapshot_id ?? parentSnapshotId),
      },
    ];
  });
}

function buildExportModel(args: {
  readonly productsRaw: readonly ProductRow[];
  readonly categoriesRaw: readonly CategoryRow[];
  readonly productCategoriesRaw: readonly ProductCategoryRow[];
  readonly features: readonly FeatureRow[];
  readonly productFeatures: readonly ProductFeatureRow[];
  readonly tags: readonly TagRow[];
  readonly combinations: readonly CombinationRow[];
  readonly salesAggregates: readonly SalesAggregateRow[];
  readonly relationships: readonly RelationshipRow[];
  readonly manyCategoryThreshold: number;
  readonly sampleSize: number;
}): {
  readonly products: readonly ProductExportRow[];
  readonly categories: readonly Record<string, unknown>[];
  readonly productCategories: readonly Record<string, unknown>[];
  readonly features: readonly FeatureRow[];
  readonly productFeatures: readonly ProductFeatureRow[];
  readonly combinations: readonly CombinationRow[];
  readonly salesAggregates: readonly SalesAggregateRow[];
  readonly relationships: readonly RelationshipRow[];
  readonly dataQuality: readonly DataQualityRow[];
  readonly representativeSample: readonly ProductExportRow[];
  readonly productCounts: Record<string, number>;
  readonly relationshipMetadata: Record<string, unknown>;
} {
  const categoryPaths = buildCategoryPaths(args.categoriesRaw);
  const productCategoriesByProduct = groupBy(args.productCategoriesRaw, (row) => row.productId);
  const featuresByProduct = groupBy(args.productFeatures, (row) => row.productId);
  const tagsByProduct = groupBy(args.tags, (row) => row.productId);
  const combinationsByProduct = groupBy(args.combinations, (row) => row.productId);
  const salesByProduct = new Map(args.salesAggregates.map((row) => [row.productId, row]));
  const relationshipsByProduct = groupBy(args.relationships, (row) => row.sourceProductId);
  const categoryById = new Map(args.categoriesRaw.map((row) => [row.categoryId, row]));

  const products = args.productsRaw.map((product) => {
    const categoryRows = productCategoriesByProduct.get(product.productId) ?? [];
    const featureRows = featuresByProduct.get(product.productId) ?? [];
    const tagRows = tagsByProduct.get(product.productId) ?? [];
    const combinationRows = combinationsByProduct.get(product.productId) ?? [];
    const sales = salesByProduct.get(product.productId);
    const relationshipRows = (relationshipsByProduct.get(product.productId) ?? []).sort(compareRelationships);
    const defaultCategory = product.defaultCategoryId === null ? undefined : categoryById.get(product.defaultCategoryId);
    const defaultPath = product.defaultCategoryId === null ? undefined : categoryPaths.get(product.defaultCategoryId);
    const categoryPathNames = categoryRows.map((row) => categoryPaths.get(row.categoryId)?.pathNames ?? row.categoryName ?? '').filter((value) => value !== '');
    const featuresJson = featureRows.map((row) => ({
      featureId: row.featureId,
      featureName: row.featureName,
      featureValueId: row.featureValueId,
      value: row.featureValue,
      custom: row.custom,
    }));
    const combinationSummaryJson = combinationRows.map((row) => ({
      combinationId: row.combinationId,
      reference: row.reference,
      priceImpact: row.priceImpact,
      weightImpact: row.weightImpact,
      attributeGroups: row.attributeGroups,
      attributeValues: row.attributeValues,
      validOrderCount: row.validOrderCount,
      unitsSold: row.unitsSold,
    }));
    const relationshipScores = relationshipRows.map((row) => row.score).filter((score): score is number => score !== null);
    return {
      productId: product.productId,
      catalogPresence: product.catalogPresence,
      reference: product.reference,
      name: product.name,
      active: product.active === null ? null : Number(product.active),
      visibility: product.visibility,
      manufacturerId: product.manufacturerId === null ? null : Number(product.manufacturerId),
      manufacturerName: product.manufacturerName,
      price: valueToString(product.price),
      wholesalePrice: valueToString(product.wholesalePrice),
      defaultCategoryId: product.defaultCategoryId,
      defaultCategoryName: defaultCategory?.name ?? null,
      defaultCategoryPath: defaultPath?.pathNames ?? null,
      allCategoryIds: categoryRows.map((row) => row.categoryId).join('|'),
      allCategoryNames: categoryRows.map((row) => row.categoryName ?? '').filter(Boolean).join(' | '),
      categoryHierarchyPaths: categoryPathNames.join(' || '),
      categoryDepths: categoryRows.map((row) => String(row.levelDepth ?? '')).filter(Boolean).join('|'),
      categoryCount: categoryRows.length,
      shortDescription: product.shortDescription,
      fullDescription: product.fullDescription,
      tags_json: JSON.stringify(tagRows.map((row) => ({ tagId: row.tagId, tagName: row.tagName }))),
      tags_text: tagRows.map((row) => row.tagName ?? '').filter(Boolean).join(' | '),
      condition: product.condition,
      weight: valueToString(product.weight),
      width: valueToString(product.width),
      height: valueToString(product.height),
      depth: valueToString(product.depth),
      dateAdded: product.dateAdded,
      dateUpdated: product.dateUpdated,
      availableForOrder: product.availableForOrder,
      showPrice: product.showPrice,
      stockQuantity: valueToString(product.stockQuantity),
      totalStockQuantity: valueToString(product.totalStockQuantity),
      slug: product.slug,
      productUrl: null,
      features_json: JSON.stringify(featuresJson),
      features_text: featureRows.map((row) => `${row.featureName ?? 'unknown'}: ${row.featureValue ?? 'unknown'}`).join(' | '),
      featureCount: featureRows.length,
      combinationCount: combinationRows.length,
      attributeGroups: uniqueSorted(combinationRows.flatMap((row) => row.attributeGroups.split(' | ').filter(Boolean))).join(' | '),
      attributeValues: uniqueSorted(combinationRows.flatMap((row) => row.attributeValues.split(' | ').filter(Boolean))).join(' | '),
      combinations_json: JSON.stringify(combinationSummaryJson),
      validOrderCount: Number(sales?.validOrderCount ?? 0),
      unitsSold: Number(sales?.unitsSold ?? 0),
      uniqueCustomerCount: Number(sales?.uniqueCustomerCount ?? 0),
      totalRevenueTaxIncl: valueToString(sales?.totalRevenueTaxIncl ?? 0),
      firstSaleAt: sales?.firstSaleAt ?? null,
      lastSaleAt: sales?.lastSaleAt ?? null,
      averageUnitsPerOrder: Number(sales?.averageUnitsPerOrder ?? 0),
      relationshipCount: relationshipRows.length,
      strongestRelatedProductIds: relationshipRows.slice(0, 10).map((row) => row.targetProductId).join('|'),
      strongestRelationshipScores: relationshipRows.slice(0, 10).map((row) => row.score ?? '').join('|'),
      maxRelationshipScore: relationshipScores.length > 0 ? Math.max(...relationshipScores) : null,
      avgRelationshipScore: relationshipScores.length > 0 ? round(relationshipScores.reduce((sum, score) => sum + score, 0) / relationshipScores.length) : null,
      nameLength: (product.name ?? '').length,
      shortDescriptionPresent: hasText(product.shortDescription),
      descriptionPresent: hasText(product.fullDescription),
      descriptionLength: stripHtml(product.fullDescription ?? '').length,
      withoutSales: !sales,
      hasCombinations: combinationRows.length > 0,
    };
  });

  const categories = args.categoriesRaw.map((category) => ({
    ...category,
    computedDepth: categoryPaths.get(category.categoryId)?.computedDepth ?? null,
    pathIds: categoryPaths.get(category.categoryId)?.pathIds ?? null,
    pathNames: categoryPaths.get(category.categoryId)?.pathNames ?? null,
    assignedProductCount: args.productCategoriesRaw.filter((row) => row.categoryId === category.categoryId).length,
  }));
  const productCategories = args.productCategoriesRaw.map((row) => {
    const product = args.productsRaw.find((candidate) => candidate.productId === row.productId);
    return {
      productId: row.productId,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      categoryPath: categoryPaths.get(row.categoryId)?.pathNames ?? null,
      levelDepth: row.levelDepth,
      position: row.position,
      isDefaultCategory: product?.defaultCategoryId === row.categoryId,
    };
  });

  const dataQuality = buildDataQualityRows({
    products,
    categories,
    productCategories,
    features: args.features,
    productFeatures: args.productFeatures,
    combinations: args.combinations,
    salesAggregates: args.salesAggregates,
    relationships: args.relationships,
    manyCategoryThreshold: args.manyCategoryThreshold,
  });
  const representativeSample = buildRepresentativeSample(products, args.sampleSize);

  return {
    products,
    categories,
    productCategories,
    features: args.features,
    productFeatures: args.productFeatures,
    combinations: args.combinations,
    salesAggregates: args.salesAggregates,
    relationships: args.relationships,
    dataQuality,
    representativeSample,
    productCounts: {
      total: products.length,
      active: products.filter((row) => row.active === 1).length,
      inactive: products.filter((row) => row.active === 0).length,
      activeUnknownHistoricalOnly: products.filter((row) => row.active === null).length,
      currentCatalog: products.filter((row) => row.catalogPresence === 'current_catalog').length,
      historicalOrderDetailOnly: products.filter((row) => row.catalogPresence === 'historical_order_detail_only').length,
      withCombinations: products.filter((row) => row.hasCombinations === true).length,
      withoutSales: products.filter((row) => row.withoutSales === true).length,
    },
    relationshipMetadata: {
      source: process.env.PRODUCT_RELATIONSHIP_SNAPSHOT_DIR
        ? 'PRODUCT_RELATIONSHIP_SNAPSHOT_DIR'
        : process.env.PRODUCT_RELATIONSHIP_SNAPSHOT_PATH
          ? 'PRODUCT_RELATIONSHIP_SNAPSHOT_PATH'
          : 'not_configured',
      snapshotDirectory: process.env.PRODUCT_RELATIONSHIP_SNAPSHOT_DIR ?? null,
      snapshotPath: process.env.PRODUCT_RELATIONSHIP_SNAPSHOT_PATH ?? null,
      relationshipRows: args.relationships.length,
      snapshotIds: uniqueSorted(args.relationships.map((row) => row.snapshotId).filter(isPresentString)),
    },
  };
}

function buildDataQualityRows(args: {
  readonly products: readonly ProductExportRow[];
  readonly categories: readonly Record<string, unknown>[];
  readonly productCategories: readonly Record<string, unknown>[];
  readonly features: readonly FeatureRow[];
  readonly productFeatures: readonly ProductFeatureRow[];
  readonly combinations: readonly CombinationRow[];
  readonly salesAggregates: readonly SalesAggregateRow[];
  readonly relationships: readonly RelationshipRow[];
  readonly manyCategoryThreshold: number;
}): DataQualityRow[] {
  const rows: DataQualityRow[] = [];
  const productsByCategory = groupBy(args.productCategories, (row) => Number(row.categoryId));
  const manufacturers = countValues(args.products.map((row) => valueToString(row.manufacturerName) ?? ''));
  const categoryDepths = countValues(args.categories.map((row) => valueToString(row.levelDepth) ?? 'unavailable'));
  const duplicateNames = duplicateNormalized(args.products, 'name');
  const duplicateCategoryNames = duplicateNormalized(args.categories, 'name');

  pushMetric(rows, 'totalProducts', args.products.length);
  pushMetric(rows, 'activeProducts', args.products.filter((row) => row.active === 1).length);
  pushMetric(rows, 'inactiveProducts', args.products.filter((row) => row.active === 0).length);
  pushMetric(rows, 'activeUnknownHistoricalOnlyProducts', args.products.filter((row) => row.active === null || row.active === '').length);
  pushMetric(rows, 'productsWithoutName', args.products.filter((row) => !hasText(valueToString(row.name))).length);
  pushMetric(rows, 'productsWithoutDescription', args.products.filter((row) => !row.descriptionPresent).length);
  pushMetric(rows, 'productsWithoutCategory', args.products.filter((row) => Number(row.categoryCount ?? 0) === 0).length);
  pushMetric(rows, 'productsWithManyCategories', args.products.filter((row) => Number(row.categoryCount ?? 0) > args.manyCategoryThreshold).length, {
    threshold: args.manyCategoryThreshold,
  });
  pushMetric(rows, 'productsWithoutFeatures', args.products.filter((row) => Number(row.featureCount ?? 0) === 0).length);
  pushMetric(rows, 'productsWithoutSales', args.products.filter((row) => row.withoutSales === true).length);
  pushMetric(rows, 'productsWithCombinations', args.products.filter((row) => row.hasCombinations === true).length);
  pushMetric(rows, 'duplicateNormalizedProductNames', duplicateNames.length, duplicateNames.slice(0, 100));
  pushMetric(rows, 'topCategoriesByAssignedProductCount', productsByCategory.size, topCategoryCounts(productsByCategory, args.categories).slice(0, 50));
  pushMetric(rows, 'topManufacturers', manufacturers.length, manufacturers.slice(0, 50));
  pushMetric(rows, 'categoryDepthDistribution', categoryDepths.length, categoryDepths);
  pushMetric(rows, 'featureCoverage', args.features.length, {
    featureDefinitions: args.features.length,
    productFeatureRows: args.productFeatures.length,
    productsWithFeatures: new Set(args.productFeatures.map((row) => row.productId)).size,
  });
  pushMetric(rows, 'productsAssignedToUnusuallyManyCategories', args.products.filter((row) => Number(row.categoryCount ?? 0) > args.manyCategoryThreshold).length, {
    threshold: args.manyCategoryThreshold,
    products: args.products
      .filter((row) => Number(row.categoryCount ?? 0) > args.manyCategoryThreshold)
      .sort((a, b) => Number(b.categoryCount ?? 0) - Number(a.categoryCount ?? 0) || Number(a.productId) - Number(b.productId))
      .slice(0, 100)
      .map((row) => ({ productId: row.productId, name: row.name, categoryCount: row.categoryCount, categories: row.allCategoryNames })),
  });
  pushMetric(rows, 'highlyOverlappingCategories', 0, categoryOverlapDiagnostics(args.productCategories).slice(0, 100));
  pushMetric(rows, 'categoryNamesWithCompositeTextSignals', 0, categoryTextSignals(args.categories).slice(0, 100));
  pushMetric(rows, 'orphanOrNearEmptyCategories', 0, orphanOrNearEmptyCategories(args.categories, productsByCategory).slice(0, 100));
  pushMetric(rows, 'duplicateNormalizedCategoryNames', duplicateCategoryNames.length, duplicateCategoryNames.slice(0, 100));
  pushMetric(rows, 'relationshipRows', args.relationships.length);
  pushMetric(rows, 'combinationRows', args.combinations.length);
  pushMetric(rows, 'salesAggregateRows', args.salesAggregates.length);
  return rows;
}

function buildRepresentativeSample(products: readonly ProductExportRow[], sampleSize: number): ProductExportRow[] {
  const selected = new Map<number, ProductExportRow>();
  const add = (rows: readonly ProductExportRow[], limit: number) => {
    for (const row of rows) {
      selected.set(Number(row.productId), row);
      if (selected.size >= sampleSize || selected.size >= limit) break;
    }
  };
  const byRevenue = [...products].sort((a, b) => Number(b.totalRevenueTaxIncl ?? 0) - Number(a.totalRevenueTaxIncl ?? 0) || Number(a.productId) - Number(b.productId));
  const noSales = products.filter((row) => row.withoutSales === true).sort((a, b) => Number(a.productId) - Number(b.productId));
  const inactive = products.filter((row) => row.active !== 1).sort((a, b) => Number(a.productId) - Number(b.productId));
  const manyCategories = [...products].sort((a, b) => Number(b.categoryCount ?? 0) - Number(a.categoryCount ?? 0) || Number(a.productId) - Number(b.productId));
  const fewFeatures = [...products].sort((a, b) => Number(a.featureCount ?? 0) - Number(b.featureCount ?? 0) || Number(a.productId) - Number(b.productId));
  const connected = [...products].sort((a, b) => Number(b.relationshipCount ?? 0) - Number(a.relationshipCount ?? 0) || Number(a.productId) - Number(b.productId));
  const ambiguousNames = products
    .filter((row) => String(row.name ?? '').trim().length <= 12 || duplicateNormalized(products, 'name').some((entry) => entry.normalizedName === normalizeEvidenceName(valueToString(row.name))))
    .sort((a, b) => Number(a.productId) - Number(b.productId));
  const perBucket = Math.max(5, Math.ceil(sampleSize / 8));
  add(byRevenue.slice(0, perBucket), sampleSize);
  add(noSales.slice(0, perBucket), sampleSize);
  add(inactive.slice(0, perBucket), sampleSize);
  add(manyCategories.slice(0, perBucket), sampleSize);
  add(fewFeatures.slice(0, perBucket), sampleSize);
  add(connected.slice(0, perBucket), sampleSize);
  add(ambiguousNames.slice(0, perBucket), sampleSize);
  const quantileFill = products.filter((_, index) => index % Math.max(1, Math.floor(products.length / Math.max(1, sampleSize))) === 0);
  for (const row of [...quantileFill, ...products]) {
    if (selected.size >= Math.min(sampleSize, products.length)) break;
    selected.set(Number(row.productId), row);
  }
  return Array.from(selected.values()).slice(0, Math.min(sampleSize, products.length)).sort((a, b) => Number(a.productId) - Number(b.productId));
}

function buildCategoryPaths(categories: readonly CategoryRow[]): Map<number, { readonly pathIds: string; readonly pathNames: string; readonly computedDepth: number }> {
  const byId = new Map(categories.map((category) => [category.categoryId, category]));
  const cache = new Map<number, { readonly pathIds: string; readonly pathNames: string; readonly computedDepth: number }>();
  const walk = (categoryId: number, seen = new Set<number>()): { readonly pathIds: string; readonly pathNames: string; readonly computedDepth: number } => {
    const cached = cache.get(categoryId);
    if (cached) return cached;
    const category = byId.get(categoryId);
    if (!category || seen.has(categoryId) || category.parentCategoryId === 0 || category.parentCategoryId === categoryId) {
      const base = {
        pathIds: category ? String(category.categoryId) : String(categoryId),
        pathNames: category?.name ?? String(categoryId),
        computedDepth: 0,
      };
      cache.set(categoryId, base);
      return base;
    }
    const parent = walk(category.parentCategoryId, new Set([...seen, categoryId]));
    const result = {
      pathIds: `${parent.pathIds}/${category.categoryId}`,
      pathNames: `${parent.pathNames} > ${category.name ?? category.categoryId}`,
      computedDepth: parent.computedDepth + 1,
    };
    cache.set(categoryId, result);
    return result;
  };
  for (const category of categories) walk(category.categoryId);
  return cache;
}

async function runQuery<Row>(
  connection: mysql.Connection,
  name: string,
  purpose: string,
  sql: string,
  params: readonly unknown[],
  timeout: number,
): Promise<Row[]> {
  assertSafeReadSql(sql, name);
  const startedAt = Date.now();
  const [rows] = await connection.query({ sql, timeout }, params as unknown[]);
  queryLog.push({ name, purpose, durationMs: Date.now() - startedAt, rowCount: Array.isArray(rows) ? rows.length : 0 });
  return rows as Row[];
}

function assertSafeReadSql(sql: string, name: string): void {
  const findings: string[] = [];
  if (WRITE_KEYWORD_PATTERN.test(sql)) findings.push('contains a write/DDL keyword');
  if (SELECT_STAR_PATTERN.test(sql)) findings.push('uses SELECT *');
  if (PII_PATTERN.test(sql)) findings.push('references direct PII column');
  if (findings.length > 0) throw new Error(`Unsafe SQL in query "${name}": ${findings.join('; ')}`);
}

async function writeWorkbook(
  xlsxPath: string,
  model: {
    readonly products: readonly ProductExportRow[];
    readonly categories: readonly Record<string, unknown>[];
    readonly productCategories: readonly Record<string, unknown>[];
    readonly features: readonly FeatureRow[];
    readonly productFeatures: readonly ProductFeatureRow[];
    readonly combinations: readonly CombinationRow[];
    readonly salesAggregates: readonly SalesAggregateRow[];
    readonly relationships: readonly RelationshipRow[];
    readonly dataQuality: readonly DataQualityRow[];
  },
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CUSTOMER-INTELLIGENCE-R2-A00';
  addSheet(workbook, 'Products', model.products.map((row) => ({ ...row, ...emptyReviewColumns() })), [...PRODUCT_EXPLORATION_CSV_COLUMNS, ...XLSX_REVIEW_COLUMNS]);
  addSheet(workbook, 'Categories', model.categories);
  addSheet(workbook, 'ProductCategories', model.productCategories);
  addSheet(workbook, 'Features', model.features);
  addSheet(workbook, 'ProductFeatures', model.productFeatures);
  addSheet(workbook, 'Combinations', model.combinations);
  addSheet(workbook, 'SalesAggregates', model.salesAggregates);
  addSheet(workbook, 'Relationships', model.relationships);
  addSheet(workbook, 'DataQuality', model.dataQuality);
  await workbook.xlsx.writeFile(xlsxPath);
}

function addSheet(workbook: ExcelJS.Workbook, name: string, rows: readonly Record<string, unknown>[], preferredColumns?: readonly string[]): void {
  const worksheet = workbook.addWorksheet(name);
  const keys = preferredColumns && preferredColumns.length > 0 ? [...preferredColumns] : collectKeys(rows);
  worksheet.columns = keys.map((key) => ({ header: key, key, width: Math.min(60, Math.max(12, key.length + 2)) }));
  for (const row of rows) {
    worksheet.addRow(Object.fromEntries(keys.map((key) => [key, serializeCell(row[key])])));
  }
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = { from: 'A1', to: `${columnLetter(keys.length)}1` };
}

async function writeCsv(filePath: string, rows: readonly ProductExportRow[], columns: readonly string[]): Promise<void> {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(','));
  }
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function summarizeOutputFiles(outputDir: string): Promise<readonly Record<string, unknown>[]> {
  const files = ['product_catalog_exploration.csv', 'products.xlsx', 'product_catalog_raw.json', 'metadata.json', 'representative_product_sample.csv'];
  const summaries: Record<string, unknown>[] = [];
  for (const file of files) {
    try {
      const current = await stat(path.join(outputDir, file));
      summaries.push({ file, bytes: current.size });
    } catch {
      summaries.push({ file, bytes: null, status: 'not_written' });
    }
  }
  return summaries;
}

function pushMetric(rows: DataQualityRow[], metric: string, value: string | number, details: unknown = null): void {
  rows.push({ metric, value, details_json: JSON.stringify(details) });
}

function groupBy<Row, Key>(rows: readonly Row[], keyFn: (row: Row) => Key): Map<Key, Row[]> {
  const grouped = new Map<Key, Row[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }
  return grouped;
}

function countValues(values: readonly string[]): readonly { readonly value: string; readonly count: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value || 'unavailable';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function duplicateNormalized(rows: readonly Record<string, unknown>[], field: string): readonly Record<string, unknown>[] {
  const grouped = new Map<string, { raw: Set<string>; ids: number[] }>();
  for (const row of rows) {
    const raw = valueToString(row[field]) ?? '';
    const normalized = normalizeEvidenceName(raw);
    if (!normalized) continue;
    const entry = grouped.get(normalized) ?? { raw: new Set<string>(), ids: [] };
    entry.raw.add(raw);
    entry.ids.push(Number(row.productId ?? row.categoryId ?? 0));
    grouped.set(normalized, entry);
  }
  return Array.from(grouped.entries())
    .filter(([, entry]) => entry.ids.length > 1 || entry.raw.size > 1)
    .map(([normalizedName, entry]) => ({
      normalizedName,
      variants: Array.from(entry.raw).sort(),
      ids: entry.ids.sort((a, b) => a - b),
    }));
}

function topCategoryCounts(grouped: ReadonlyMap<number, readonly Record<string, unknown>[]>, categories: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  const categoryById = new Map(categories.map((row) => [Number(row.categoryId), row]));
  return Array.from(grouped.entries())
    .map(([categoryId, rows]) => ({
      categoryId,
      categoryName: categoryById.get(categoryId)?.name ?? null,
      assignedProductCount: rows.length,
    }))
    .sort((a, b) => b.assignedProductCount - a.assignedProductCount || a.categoryId - b.categoryId);
}

function categoryOverlapDiagnostics(productCategories: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  const productsByCategory = new Map<number, Set<number>>();
  for (const row of productCategories) {
    const categoryId = Number(row.categoryId);
    const productId = Number(row.productId);
    const set = productsByCategory.get(categoryId) ?? new Set<number>();
    set.add(productId);
    productsByCategory.set(categoryId, set);
  }
  const categoryIds = Array.from(productsByCategory.keys()).sort((a, b) => a - b);
  const overlaps: Record<string, unknown>[] = [];
  for (let i = 0; i < categoryIds.length; i += 1) {
    for (let j = i + 1; j < categoryIds.length; j += 1) {
      const leftId = categoryIds[i]!;
      const rightId = categoryIds[j]!;
      const left = productsByCategory.get(leftId)!;
      const right = productsByCategory.get(rightId)!;
      const intersection = countIntersection(left, right);
      if (intersection < 2) continue;
      const union = left.size + right.size - intersection;
      const jaccard = union === 0 ? 0 : intersection / union;
      if (jaccard >= 0.5 || intersection >= 10) {
        overlaps.push({ categoryIdA: leftId, categoryIdB: rightId, sharedProducts: intersection, jaccard: round(jaccard) });
      }
    }
  }
  return overlaps.sort((a, b) => Number(b.jaccard) - Number(a.jaccard) || Number(b.sharedProducts) - Number(a.sharedProducts));
}

function categoryTextSignals(categories: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  return categories
    .map((category) => {
      const name = String(category.name ?? '');
      const signals = [
        /[\/|+&]/.test(name) ? 'separator' : null,
        /\b(y|o|para|con)\b/i.test(name) ? 'connector_word' : null,
        name.length > 40 ? 'long_name' : null,
        /\d/.test(name) ? 'contains_number' : null,
      ].filter(isPresentString);
      return { categoryId: category.categoryId, name, signals };
    })
    .filter((row) => row.signals.length > 0)
    .sort((a, b) => b.signals.length - a.signals.length || Number(a.categoryId) - Number(b.categoryId));
}

function orphanOrNearEmptyCategories(categories: readonly Record<string, unknown>[], productsByCategory: ReadonlyMap<number, readonly Record<string, unknown>[]>): readonly Record<string, unknown>[] {
  const categoryIds = new Set(categories.map((row) => Number(row.categoryId)));
  return categories
    .map((category) => {
      const parentCategoryId = Number(category.parentCategoryId ?? 0);
      const assignedProductCount = productsByCategory.get(Number(category.categoryId))?.length ?? 0;
      return {
        categoryId: category.categoryId,
        name: category.name,
        parentCategoryId,
        assignedProductCount,
        orphanParent: parentCategoryId !== 0 && parentCategoryId !== Number(category.categoryId) && !categoryIds.has(parentCategoryId),
      };
    })
    .filter((row) => row.orphanParent || row.assignedProductCount <= 1)
    .sort((a, b) => Number(a.assignedProductCount) - Number(b.assignedProductCount) || Number(a.categoryId) - Number(b.categoryId));
}

function compareRelationships(a: RelationshipRow, b: RelationshipRow): number {
  return Number(b.score ?? 0) - Number(a.score ?? 0) || a.targetProductId - b.targetProductId;
}

function countIntersection(left: ReadonlySet<number>, right: ReadonlySet<number>): number {
  let count = 0;
  const smaller = left.size <= right.size ? left : right;
  const larger = left.size <= right.size ? right : left;
  for (const value of smaller) if (larger.has(value)) count += 1;
  return count;
}

function hasText(value: string | null | undefined): boolean {
  return stripHtml(value ?? '').trim().length > 0;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function csvEscape(value: unknown): string {
  const serialized = serializeCell(value);
  if (serialized === null || serialized === undefined) return '';
  const text = String(serialized);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function serializeCell(value: unknown): string | number | boolean | null {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return JSON.stringify(value);
}

function collectKeys(rows: readonly Record<string, unknown>[]): readonly string[] {
  const keys = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) keys.add(key);
  return Array.from(keys);
}

function columnLetter(columnCount: number): string {
  let dividend = Math.max(1, columnCount);
  let columnName = '';
  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return columnName;
}

function emptyReviewColumns(): Record<string, ''> {
  return Object.fromEntries(XLSX_REVIEW_COLUMNS.map((column) => [column, ''])) as Record<string, ''>;
}

function valueToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function isPresentString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parsePositiveInteger(raw: string, label: string): number {
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid ${label}: ${raw}`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid ${label}: ${raw}`);
  return parsed;
}

function readPositiveIntegerEnv(name: string): number | null {
  const raw = process.env[name];
  return raw ? parsePositiveInteger(raw, name) : null;
}

function readFirstPositiveIntegerEnv(names: readonly string[]): number | null {
  for (const name of names) {
    const value = readPositiveIntegerEnv(name);
    if (value !== null) return value;
  }
  return null;
}

main().catch((error: unknown) => {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;
  console.error({ type: error instanceof Error ? error.constructor.name : 'UnknownError', code, message: error instanceof Error ? error.message : String(error) }, '[product-exploration] Failed.');
  process.exitCode = 1;
});
