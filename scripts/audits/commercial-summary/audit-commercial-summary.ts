// CP-R1-T07A — Customer Commercial Summary Audit.
//
// Standalone, read-only, one-shot tool. Deliberately does NOT import anything from
// src/ (no src/config.ts, no src/infrastructure/*) — same reasoning as CP-R1-T06A's
// script: this tool is not part of the running service and must stay runnable even if
// the app's config contract changes independently. See docs/audits/commercial-summary/
// CP-R1-T07A-commercial-summary-audit.md for the full report.
//
// Run with: npx tsx scripts/audits/commercial-summary/audit-commercial-summary.ts
//
// Aborts before touching any data table if: credentials are missing, grants are not
// SELECT/USAGE-only, or the server is already under load. See lib/guardrails.ts (reused
// from CP-R1-T06A) and lib/sql-guardrails.ts (new: static no-PII/no-write check applied
// to every SQL string this script builds, before it runs).

import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { assessGrants, evaluateLoad } from './lib/guardrails.js';
import { assertSafeSql } from './lib/sql-guardrails.js';
import { detectPrefix, detectVariantTable } from './lib/schema-discovery.js';
import { parseServerVersion } from './lib/version.js';
import { summarizeValidityMatrix } from './lib/validity.js';
import { detectCurrencyMix, formatDecimalString } from './lib/monetary.js';
import { computePercentileStats, bucketOrderCounts, bucketRecency } from './lib/distribution.js';
import { buildContractFieldDocs } from './lib/contract-proposal.js';
import type { ValidityMatrixRow } from './lib/types.js';

const REQUIRED_SUFFIXES = ['orders', 'order_state', 'order_state_lang', 'customer', 'currency'] as const;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(SCRIPT_DIR, 'outputs');
const QUERY_TIMEOUT_MS = 20000;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;
const REQUIRED_ENV_VARS = ['PRESTASHOP_DB_HOST', 'PRESTASHOP_DB_USER', 'PRESTASHOP_DB_PASSWORD'] as const;

// Section 1/6: the state ids operations confirmed by name in CP-R1-T06A (6 = "Cancelado",
// 7 = "Reembolsado") — used here as the working definition, per this task's explicit
// instruction ("Auditar por separado: current_state = 6; current_state = 7"), never
// re-derived from the name at runtime. This script still looks the name up and records it
// in the output for a human to confirm — it never branches on that name.
const CANCELLED_STATE_ID = 6;
const REFUNDED_STATE_ID = 7;

type QueryLogEntry = {
  readonly name: string;
  readonly purpose: string;
  readonly durationMs: number;
  readonly rowCount: number;
};

const queryLog: QueryLogEntry[] = [];
const explains: Record<string, unknown> = {};

async function writeJson(filename: string, data: unknown): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, filename), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

// Never a raw driver message (can carry host/user/password) — mirrors src/observability's
// instanceof-only classification pattern, kept local since this script must not depend
// on src/.
function sanitizeError(error: unknown): { type: string; code: string | null } {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : null;
  const type = error instanceof Error ? error.constructor.name : 'UnknownError';
  return { type, code };
}

function checkCredentials(): { available: boolean; missing: string[] } {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name] || process.env[name]!.trim() === '');
  return { available: missing.length === 0, missing };
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
  const durationMs = Date.now() - startedAt;
  const rowCount = Array.isArray(rows) ? rows.length : 0;
  queryLog.push({ name, purpose, durationMs, rowCount });
  return rows as Row[];
}

async function explainQuery(connection: mysql.Connection, name: string, sql: string, params: readonly unknown[] = []): Promise<void> {
  assertSafeSql(sql, `${name} (explain)`);
  try {
    const [rows] = await connection.query(`EXPLAIN FORMAT=JSON ${sql}`, params as unknown[]);
    explains[name] = Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    explains[name] = { error: sanitizeError(error) };
  }
}

function assertSafeIdentifier(identifier: string, label: string): void {
  if (!SAFE_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Unsafe ${label}: "${identifier}" does not match ^[A-Za-z0-9_]+$`);
  }
}

async function columnInventory(
  connection: mysql.Connection,
  logKey: string,
  tableName: string,
): Promise<{ columns: unknown[]; indexes: unknown[]; foreignKeys: unknown[]; columnNames: Set<string> }> {
  assertSafeIdentifier(tableName, 'table name');
  const columns = await runQuery(
    connection,
    `inventory.columns.${logKey}`,
    `column inventory for ${tableName}`,
    'SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA ' +
      'FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
    [tableName],
  );
  const indexes = await runQuery(connection, `inventory.indexes.${logKey}`, `index inventory for ${tableName}`, `SHOW INDEX FROM \`${tableName}\``);
  const foreignKeys = await runQuery(
    connection,
    `inventory.foreign-keys.${logKey}`,
    `declared foreign keys for ${tableName}`,
    'SELECT COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME ' +
      'FROM information_schema.key_column_usage ' +
      'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL',
    [tableName],
  );
  const columnNames = new Set((columns as Array<{ COLUMN_NAME: string }>).map((c) => c.COLUMN_NAME));
  return { columns, indexes, foreignKeys, columnNames };
}

async function main(): Promise<void> {
  const credentials = checkCredentials();
  if (!credentials.available) {
    await writeJson('preflight.json', {
      executedAt: new Date().toISOString(),
      status: 'aborted',
      reason: 'missing_credentials',
      missingEnvVars: credentials.missing,
    });
    console.error(
      `[audit-commercial-summary] Aborted: missing required env vars (${credentials.missing.join(', ')}). ` +
        'Nothing was queried. See outputs/preflight.json.',
    );
    process.exitCode = 1;
    return;
  }

  const connection = await mysql.createConnection({
    host: process.env.PRESTASHOP_DB_HOST,
    port: process.env.PRESTASHOP_DB_PORT ? Number(process.env.PRESTASHOP_DB_PORT) : 3306,
    user: process.env.PRESTASHOP_DB_USER,
    password: process.env.PRESTASHOP_DB_PASSWORD,
    database: process.env.PRESTASHOP_DB_NAME || 'pesas_productiva',
    // Single connection, never a pool: this IS the connectionLimit=1 guardrail.
    connectTimeout: QUERY_TIMEOUT_MS,
    dateStrings: true,
    timezone: 'Z',
  });

  try {
    // --- Preflight ---
    await runQuery(connection, 'preflight.select-1', 'lightweight connectivity check', 'SELECT 1 AS ok');
    const [identity] = await runQuery<{ db: string; user: string; hostname: string }>(
      connection,
      'preflight.database-user',
      'selected database, user and server host',
      'SELECT DATABASE() AS db, CURRENT_USER() AS user, @@hostname AS hostname',
    );
    const grantRows = await runQuery<Record<string, string>>(
      connection,
      'preflight.show-grants',
      'read-only verification',
      'SHOW GRANTS FOR CURRENT_USER()',
    );
    const grantStatements = grantRows.map((row) => Object.values(row)[0] as string);
    const grants = assessGrants(grantStatements);

    const [threadsRow] = await runQuery<{ Variable_name: string; Value: string }>(
      connection,
      'preflight.threads-running',
      'server load guardrail input',
      "SHOW GLOBAL STATUS LIKE 'Threads_running'",
    );
    const [maxConnRow] = await runQuery<{ Variable_name: string; Value: string }>(
      connection,
      'preflight.max-connections',
      'server load guardrail input',
      "SHOW VARIABLES LIKE 'max_connections'",
    );
    const load = evaluateLoad(Number(threadsRow?.Value ?? 0), Number(maxConnRow?.Value ?? 0));

    const [versionRow] = await runQuery<{ version: string }>(connection, 'preflight.version', 'server version, to decide window-function support', 'SELECT VERSION() AS version');
    const serverVersion = parseServerVersion(versionRow?.version ?? '');

    const preflight = {
      executedAt: new Date().toISOString(),
      status: grants.safe && load.safe ? 'ok' : 'aborted',
      connection: { database: identity?.db, user: identity?.user, hostname: identity?.hostname },
      grants,
      load,
      serverVersion,
    };
    await writeJson('preflight.json', preflight);

    if (!grants.safe) {
      console.error(`[audit-commercial-summary] Aborted: grants are not SELECT/USAGE-only (disallowed: ${grants.disallowedPrivileges.join(', ') || 'WITH GRANT OPTION'}). No data query was run.`);
      process.exitCode = 1;
      return;
    }
    if (!load.safe) {
      console.error(`[audit-commercial-summary] Aborted: server load guardrail tripped (${load.reason}). No data query was run.`);
      process.exitCode = 1;
      return;
    }

    // --- Table & prefix discovery (section 2) ---
    const tableRows = await runQuery<{ TABLE_NAME: string }>(
      connection,
      'discovery.tables',
      'enumerate all tables in the connected schema to detect the PrestaShop prefix',
      'SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()',
    );
    const tableNames = tableRows.map((row) => row.TABLE_NAME);
    const discovery = detectPrefix(tableNames, REQUIRED_SUFFIXES);

    const schemaInventory: Record<string, unknown> = { discovery, tables: {} as Record<string, unknown> };

    if (!discovery.prefix) {
      await writeJson('schema-inventory.json', schemaInventory);
      console.error(
        '[audit-commercial-summary] No unambiguous PrestaShop prefix found for the required tables ' +
          '(orders/order_state/order_state_lang/customer/currency). See outputs/schema-inventory.json. Nothing further was audited.',
      );
      await writeQueryLogAndExplains();
      return;
    }

    const prefix = discovery.prefix;
    assertSafeIdentifier(prefix, 'table prefix');

    for (const [suffix, tableName] of Object.entries(discovery.found)) {
      const { columns, indexes, foreignKeys } = await columnInventory(connection, suffix, tableName);
      (schemaInventory.tables as Record<string, unknown>)[suffix] = { tableName, columns, indexes, foreignKeys };
    }
    if (discovery.missing.length > 0) {
      schemaInventory.missingTables = discovery.missing;
    }

    const hasTable = (suffix: string): boolean => Boolean(discovery.found[suffix]);

    // order_detail: known naming variants, never assumed (same discipline as T06A).
    const orderDetailDiscovery = detectVariantTable(tableNames, [`${prefix}order_detail`, `${prefix}order_details`]);
    schemaInventory.orderDetailDiscovery = orderDetailDiscovery;
    let orderDetailColumns = new Set<string>();
    if (orderDetailDiscovery.tableName) {
      const { columns, indexes, foreignKeys, columnNames } = await columnInventory(connection, 'order_detail', orderDetailDiscovery.tableName);
      (schemaInventory.tables as Record<string, unknown>).order_detail = { tableName: orderDetailDiscovery.tableName, columns, indexes, foreignKeys };
      orderDetailColumns = columnNames;
    }
    const hasOrderDetailColumn = (name: string): boolean => orderDetailColumns.has(name);

    // ps_order_slip / ps_order_slip_detail: optional per section 2 ("si existen y son
    // necesarias para entender reembolsos") — checked, never assumed present.
    const orderSlipDiscovery = detectVariantTable(tableNames, [`${prefix}order_slip`]);
    const orderSlipDetailDiscovery = detectVariantTable(tableNames, [`${prefix}order_slip_detail`]);
    schemaInventory.orderSlipDiscovery = orderSlipDiscovery;
    schemaInventory.orderSlipDetailDiscovery = orderSlipDetailDiscovery;
    let orderSlipColumns = new Set<string>();
    if (orderSlipDiscovery.tableName) {
      const { columns, indexes, foreignKeys, columnNames } = await columnInventory(connection, 'order_slip', orderSlipDiscovery.tableName);
      (schemaInventory.tables as Record<string, unknown>).order_slip = { tableName: orderSlipDiscovery.tableName, columns, indexes, foreignKeys };
      orderSlipColumns = columnNames;
    }
    if (orderSlipDetailDiscovery.tableName) {
      const { columns, indexes, foreignKeys } = await columnInventory(connection, 'order_slip_detail', orderSlipDetailDiscovery.tableName);
      (schemaInventory.tables as Record<string, unknown>).order_slip_detail = { tableName: orderSlipDetailDiscovery.tableName, columns, indexes, foreignKeys };
    }

    await writeJson('schema-inventory.json', schemaInventory);

    // --- Operative language (reused pattern from T06A) ---
    let operativeLanguageId: number | null = null;
    let languageDistribution: Array<{ id_lang: number; translated_states: number }> = [];
    if (hasTable('order_state_lang')) {
      languageDistribution = await runQuery(
        connection,
        'language.distribution',
        'translated state count per id_lang',
        `SELECT id_lang, COUNT(*) AS translated_states FROM ${prefix}order_state_lang GROUP BY id_lang ORDER BY translated_states DESC`,
      );
      const configuredLangId = process.env.PRESTASHOP_ORDER_STATE_LANG_ID ? Number(process.env.PRESTASHOP_ORDER_STATE_LANG_ID) : null;
      const configuredLangPresent = configuredLangId !== null && languageDistribution.some((row) => row.id_lang === configuredLangId);
      operativeLanguageId = configuredLangPresent ? configuredLangId : (languageDistribution[0]?.id_lang ?? null);
    }

    // ================================================================
    // Section 4: order validity matrix
    // ================================================================
    let orderValidityOutput: Record<string, unknown> = { available: false };
    let totalOrders = 0;
    if (hasTable('orders') && operativeLanguageId !== null) {
      const matrixSql = `
        SELECT
          o.valid,
          o.current_state,
          osl.name AS state_name,
          os.paid,
          os.logable,
          COUNT(*) AS order_count,
          SUM(o.total_paid_tax_incl) AS sum_total_paid_tax_incl,
          SUM(o.total_products_wt) AS sum_total_products_wt,
          MIN(o.date_add) AS first_seen_at,
          MAX(o.date_add) AS last_seen_at
        FROM ${prefix}orders o
        LEFT JOIN ${hasTable('order_state') ? `${prefix}order_state os` : `${prefix}orders os`} ON ${hasTable('order_state') ? 'os.id_order_state = o.current_state' : '1 = 0'}
        LEFT JOIN ${prefix}order_state_lang osl ON osl.id_order_state = o.current_state AND osl.id_lang = ?
        GROUP BY o.valid, o.current_state, osl.name, os.paid, os.logable
        ORDER BY o.valid DESC, order_count DESC
      `;
      const matrixRows = await runQuery<Record<string, unknown>>(connection, 'validity.matrix', 'order counts per (valid, current_state), with state flags and monetary sums', matrixSql, [operativeLanguageId]);
      await explainQuery(connection, 'validity.matrix', matrixSql, [operativeLanguageId]);

      const matrix: ValidityMatrixRow[] = matrixRows.map((row) => ({
        valid: Boolean(row.valid),
        currentStateId: row.current_state === null ? null : Number(row.current_state),
        stateName: (row.state_name as string | null) ?? null,
        paid: row.paid === null ? null : Boolean(row.paid),
        logable: row.logable === null ? null : Boolean(row.logable),
        orderCount: Number(row.order_count),
        sumTotalPaidTaxIncl: formatDecimalString(row.sum_total_paid_tax_incl as string | number | null),
        sumTotalProductsWt: formatDecimalString(row.sum_total_products_wt as string | number | null),
        firstSeenAt: (row.first_seen_at as string | null) ?? null,
        lastSeenAt: (row.last_seen_at as string | null) ?? null,
      }));

      const summary = summarizeValidityMatrix(matrix, { cancelledStateId: CANCELLED_STATE_ID, refundedStateId: REFUNDED_STATE_ID });
      totalOrders = summary.totalOrders;

      const cancelledRow = matrix.find((row) => row.currentStateId === CANCELLED_STATE_ID);
      const refundedRow = matrix.find((row) => row.currentStateId === REFUNDED_STATE_ID);

      orderValidityOutput = {
        available: true,
        operativeLanguageId,
        matrix,
        summary,
        cancelledStateId: CANCELLED_STATE_ID,
        cancelledStateNameObserved: cancelledRow?.stateName ?? null,
        refundedStateId: REFUNDED_STATE_ID,
        refundedStateNameObserved: refundedRow?.stateName ?? null,
      };
    }
    await writeJson('order-validity-analysis.json', orderValidityOutput);

    // ================================================================
    // Section 5: monetary analysis (over valid = 1 orders)
    // ================================================================
    let monetaryOutput: Record<string, unknown> = { available: false };
    if (hasTable('orders')) {
      const ordersColumns = ((schemaInventory.tables as Record<string, { columnNames?: Set<string> }>).orders as unknown as { columns: Array<{ COLUMN_NAME: string }> }).columns;
      const orderColumnSet = new Set(ordersColumns.map((c) => c.COLUMN_NAME));
      const candidateMoneyColumns = [
        'total_paid',
        'total_paid_tax_incl',
        'total_paid_tax_excl',
        'total_products',
        'total_products_wt',
        'total_discounts',
        'total_discounts_tax_incl',
        'total_shipping',
        'total_shipping_tax_incl',
        'total_wrapping',
        'conversion_rate',
      ].filter((column) => orderColumnSet.has(column));

      const selectFragments = candidateMoneyColumns.flatMap((column) => [
        `MIN(${column}) AS min_${column}`,
        `MAX(${column}) AS max_${column}`,
        `AVG(${column}) AS avg_${column}`,
        `SUM(${column}) AS sum_${column}`,
        `SUM(CASE WHEN ${column} < 0 THEN 1 ELSE 0 END) AS negative_${column}`,
        `SUM(CASE WHEN ${column} = 0 THEN 1 ELSE 0 END) AS zero_${column}`,
      ]);
      const columnStatsSql = `SELECT COUNT(*) AS order_count, ${selectFragments.join(', ')} FROM ${prefix}orders WHERE valid = 1`;
      const [columnStatsRow] = await runQuery<Record<string, unknown>>(connection, 'monetary.column-stats', 'single-pass MIN/MAX/AVG/SUM/negative/zero for every candidate monetary column, valid orders only', columnStatsSql);

      const columnStats: Record<string, unknown> = {};
      for (const column of candidateMoneyColumns) {
        columnStats[column] = {
          min: columnStatsRow?.[`min_${column}`] ?? null,
          max: columnStatsRow?.[`max_${column}`] ?? null,
          avg: columnStatsRow?.[`avg_${column}`] ?? null,
          sum: columnStatsRow ? formatDecimalString(columnStatsRow[`sum_${column}`] as string | number | null) : null,
          negativeCount: Number(columnStatsRow?.[`negative_${column}`] ?? 0),
          zeroCount: Number(columnStatsRow?.[`zero_${column}`] ?? 0),
        };
      }

      let reconciliation: Record<string, unknown> | null = null;
      if (orderColumnSet.has('total_paid_tax_incl') && orderColumnSet.has('total_products_wt')) {
        const [reconciliationRow] = await runQuery<{ avg_diff: number; min_diff: number; max_diff: number; avg_shipping: number | null }>(
          connection,
          'monetary.reconciliation-vs-products-wt',
          'total_paid_tax_incl - total_products_wt, compared against average shipping (descriptive, not a tolerance check — these two columns are not expected to be equal)',
          `SELECT
            AVG(total_paid_tax_incl - total_products_wt) AS avg_diff,
            MIN(total_paid_tax_incl - total_products_wt) AS min_diff,
            MAX(total_paid_tax_incl - total_products_wt) AS max_diff,
            ${orderColumnSet.has('total_shipping_tax_incl') ? 'AVG(total_shipping_tax_incl)' : 'NULL'} AS avg_shipping
          FROM ${prefix}orders WHERE valid = 1`,
        );
        reconciliation = {
          avgDiff: reconciliationRow?.avg_diff ?? null,
          minDiff: reconciliationRow?.min_diff ?? null,
          maxDiff: reconciliationRow?.max_diff ?? null,
          avgShippingTaxIncl: reconciliationRow?.avg_shipping ?? null,
        };
      }

      let currencyDetection = null;
      if (hasTable('currency')) {
        const currencyRows = await runQuery<{ id_currency: number; iso_code: string | null; order_count: number }>(
          connection,
          'monetary.currency-distribution',
          'order counts per id_currency, resolved to iso_code, valid orders only',
          `SELECT o.id_currency, c.iso_code, COUNT(*) AS order_count
           FROM ${prefix}orders o
           LEFT JOIN ${prefix}currency c ON c.id_currency = o.id_currency
           WHERE o.valid = 1
           GROUP BY o.id_currency, c.iso_code
           ORDER BY order_count DESC`,
        );
        currencyDetection = detectCurrencyMix(currencyRows.map((row) => ({ idCurrency: row.id_currency, isoCode: row.iso_code, orderCount: Number(row.order_count) })));
      }

      monetaryOutput = {
        available: true,
        candidateColumnsPresent: candidateMoneyColumns,
        candidateColumnsMissing: ['total_paid', 'total_paid_tax_incl', 'total_paid_tax_excl', 'total_products', 'total_products_wt', 'total_discounts', 'total_discounts_tax_incl', 'total_shipping', 'total_shipping_tax_incl', 'total_wrapping', 'conversion_rate'].filter(
          (c) => !candidateMoneyColumns.includes(c),
        ),
        idCurrencyColumnPresent: orderColumnSet.has('id_currency'),
        orderCount: Number(columnStatsRow?.order_count ?? 0),
        columnStats,
        reconciliationVsTotalProductsWt: reconciliation,
        currencyDetection,
      };
    }
    await writeJson('monetary-analysis.json', monetaryOutput);

    // ================================================================
    // Section 6: cancellations & refunds
    // ================================================================
    const refundOutput: Record<string, unknown> = { available: hasTable('orders') };
    if (hasTable('orders')) {
      const [stateCountsRow] = await runQuery<{ cancelled_total: number; cancelled_valid: number; refunded_total: number; refunded_valid: number }>(
        connection,
        'refund.state-counts',
        'order counts for the cancelled/refunded state ids, split by valid',
        `SELECT
          SUM(CASE WHEN current_state = ? THEN 1 ELSE 0 END) AS cancelled_total,
          SUM(CASE WHEN current_state = ? AND valid = 1 THEN 1 ELSE 0 END) AS cancelled_valid,
          SUM(CASE WHEN current_state = ? THEN 1 ELSE 0 END) AS refunded_total,
          SUM(CASE WHEN current_state = ? AND valid = 1 THEN 1 ELSE 0 END) AS refunded_valid
        FROM ${prefix}orders`,
        [CANCELLED_STATE_ID, CANCELLED_STATE_ID, REFUNDED_STATE_ID, REFUNDED_STATE_ID],
      );
      refundOutput.stateCounts = {
        cancelledStateId: CANCELLED_STATE_ID,
        cancelledTotal: Number(stateCountsRow?.cancelled_total ?? 0),
        cancelledValid: Number(stateCountsRow?.cancelled_valid ?? 0),
        refundedStateId: REFUNDED_STATE_ID,
        refundedTotal: Number(stateCountsRow?.refunded_total ?? 0),
        refundedValid: Number(stateCountsRow?.refunded_valid ?? 0),
      };

      if (orderDetailDiscovery.tableName && hasOrderDetailColumn('product_quantity_refunded') && hasOrderDetailColumn('product_quantity') && hasOrderDetailColumn('id_order')) {
        const od = orderDetailDiscovery.tableName;
        const [refundQtyRow] = await runQuery<{
          lines_with_refund: number;
          lines_full_refund: number;
          lines_partial_refund: number;
          total_refunded_units: number;
          orders_with_any_refunded_line: number;
        }>(
          connection,
          'refund.order-detail-quantities',
          'refunded-quantity lines/units for order_detail lines belonging to valid orders (full vs partial refund lines)',
          `SELECT
            SUM(CASE WHEN od.product_quantity_refunded > 0 THEN 1 ELSE 0 END) AS lines_with_refund,
            SUM(CASE WHEN od.product_quantity_refunded > 0 AND od.product_quantity_refunded >= od.product_quantity THEN 1 ELSE 0 END) AS lines_full_refund,
            SUM(CASE WHEN od.product_quantity_refunded > 0 AND od.product_quantity_refunded < od.product_quantity THEN 1 ELSE 0 END) AS lines_partial_refund,
            SUM(od.product_quantity_refunded) AS total_refunded_units,
            COUNT(DISTINCT CASE WHEN od.product_quantity_refunded > 0 THEN od.id_order END) AS orders_with_any_refunded_line
          FROM ${od} od
          INNER JOIN ${prefix}orders o ON o.id_order = od.id_order
          WHERE o.valid = 1`,
        );
        refundOutput.orderDetailRefundQuantities = {
          linesWithRefund: Number(refundQtyRow?.lines_with_refund ?? 0),
          linesFullRefund: Number(refundQtyRow?.lines_full_refund ?? 0),
          linesPartialRefund: Number(refundQtyRow?.lines_partial_refund ?? 0),
          totalRefundedUnits: refundQtyRow?.total_refunded_units ?? 0,
          ordersWithAnyRefundedLine: Number(refundQtyRow?.orders_with_any_refunded_line ?? 0),
        };
      }

      if (orderDetailDiscovery.tableName && hasOrderDetailColumn('total_refunded_tax_incl') && hasOrderDetailColumn('id_order')) {
        const od = orderDetailDiscovery.tableName;
        const [refundAmountRow] = await runQuery<{ lines_with_refund_amount: number; sum_total_refunded_tax_incl: string | number | null }>(
          connection,
          'refund.order-detail-amounts',
          'total_refunded_tax_incl coverage on order_detail, valid orders only',
          `SELECT
            SUM(CASE WHEN od.total_refunded_tax_incl > 0 THEN 1 ELSE 0 END) AS lines_with_refund_amount,
            SUM(od.total_refunded_tax_incl) AS sum_total_refunded_tax_incl
          FROM ${od} od
          INNER JOIN ${prefix}orders o ON o.id_order = od.id_order
          WHERE o.valid = 1`,
        );
        refundOutput.orderDetailRefundAmounts = {
          linesWithRefundAmount: Number(refundAmountRow?.lines_with_refund_amount ?? 0),
          sumTotalRefundedTaxIncl: formatDecimalString((refundAmountRow?.sum_total_refunded_tax_incl as string | number | null) ?? null),
        };
      } else {
        refundOutput.orderDetailRefundAmounts = { available: false, reason: 'total_refunded_tax_incl column not found on the order_detail table' };
      }

      if (orderSlipDiscovery.tableName) {
        const slip = orderSlipDiscovery.tableName;
        const [slipCoverageRow] = await runQuery<{ total_rows: number; distinct_orders: number }>(
          connection,
          'refund.order-slip-coverage',
          'row count and distinct orders referenced in order_slip',
          `SELECT COUNT(*) AS total_rows, COUNT(DISTINCT id_order) AS distinct_orders FROM ${slip}`,
        );
        const slipOutput: Record<string, unknown> = {
          available: true,
          tableName: slip,
          totalRows: Number(slipCoverageRow?.total_rows ?? 0),
          distinctOrdersReferenced: Number(slipCoverageRow?.distinct_orders ?? 0),
        };
        const candidateAmountColumns = ['total_products_tax_incl', 'amount', 'total_shipping_tax_incl'].filter((c) => orderSlipColumns.has(c));
        if (candidateAmountColumns.length > 0) {
          const amountFragments = candidateAmountColumns.map((c) => `SUM(${c}) AS sum_${c}`);
          const [amountRow] = await runQuery<Record<string, unknown>>(connection, 'refund.order-slip-amounts', 'sum of any known amount-like columns on order_slip', `SELECT ${amountFragments.join(', ')} FROM ${slip}`);
          slipOutput.amountColumnsFound = candidateAmountColumns;
          slipOutput.amountSums = Object.fromEntries(candidateAmountColumns.map((c) => [c, formatDecimalString((amountRow?.[`sum_${c}`] as string | number | null) ?? null)]));
        } else {
          slipOutput.amountColumnsFound = [];
        }
        refundOutput.orderSlip = slipOutput;
      } else {
        refundOutput.orderSlip = { available: false };
      }
    }
    await writeJson('refund-analysis.json', refundOutput);

    // ================================================================
    // Section 7 + 8: customer distribution + purchase frequency
    // ================================================================
    let customerDistributionOutput: Record<string, unknown> = { available: false };
    if (hasTable('orders')) {
      const [buyerCountRow] = await runQuery<{ c: number }>(connection, 'distribution.total-buyers', 'distinct customers with >= 1 valid order', `SELECT COUNT(DISTINCT id_customer) AS c FROM ${prefix}orders WHERE valid = 1`);
      const totalBuyers = Number(buyerCountRow?.c ?? 0);

      // Per-customer aggregates, one anonymous row per customer — id_customer is used only
      // for GROUP BY, never selected. Mirrors T06A's "lines-per-order" pattern exactly.
      const perCustomerRows = await runQuery<{ order_count: number; total_spent: string | number | null; avg_order_value: string | number | null; days_span: number | null; days_since_last: number }>(
        connection,
        'distribution.per-customer-aggregates',
        'order_count, total_spent, avg_order_value, days_span (first-to-last), days_since_last per customer (no id_customer selected)',
        `SELECT
          COUNT(*) AS order_count,
          SUM(total_paid_tax_incl) AS total_spent,
          AVG(total_paid_tax_incl) AS avg_order_value,
          DATEDIFF(MAX(date_add), MIN(date_add)) AS days_span,
          DATEDIFF(NOW(), MAX(date_add)) AS days_since_last
        FROM ${prefix}orders
        WHERE valid = 1
        GROUP BY id_customer`,
      );
      await explainQuery(
        connection,
        'distribution.per-customer-aggregates',
        `SELECT COUNT(*) AS order_count, SUM(total_paid_tax_incl) AS total_spent FROM ${prefix}orders WHERE valid = 1 GROUP BY id_customer`,
      );

      const orderCounts = perCustomerRows.map((row) => Number(row.order_count));
      const spendValues = perCustomerRows.map((row) => Number(row.total_spent ?? 0));
      const aovValues = perCustomerRows.map((row) => Number(row.avg_order_value ?? 0));
      const recencyDays = perCustomerRows.map((row) => Number(row.days_since_last));
      const daysSpanValues = perCustomerRows.filter((row) => row.order_count >= 2).map((row) => Number(row.days_span ?? 0));

      // Frequency formula A: computed per customer from the same anonymous rows above
      // (days_span / (order_count - 1)), for customers with >= 2 orders.
      const frequencyAValues = perCustomerRows.filter((row) => row.order_count >= 2).map((row) => Number(row.days_span ?? 0) / (row.order_count - 1));

      let frequencyB: Record<string, unknown> = { computed: false };
      if (discovery.prefix && (identity || true)) {
        const supportsWindowFunctions = parseServerVersion(versionRow?.version ?? '').supportsWindowFunctions;
        if (supportsWindowFunctions) {
          const frequencySql = `
            SELECT frequency_a, avg_interval_b AS frequency_b
            FROM (
              SELECT
                (DATEDIFF(MAX(date_add), MIN(date_add)) / (COUNT(*) - 1)) AS frequency_a,
                AVG(interval_days) AS avg_interval_b
              FROM (
                SELECT
                  id_customer,
                  date_add,
                  DATEDIFF(date_add, LAG(date_add) OVER (PARTITION BY id_customer ORDER BY date_add)) AS interval_days
                FROM ${prefix}orders
                WHERE valid = 1
              ) with_intervals
              GROUP BY id_customer
              HAVING COUNT(*) >= 2
            ) per_customer
          `;
          const frequencyRows = await runQuery<{ frequency_a: number; frequency_b: number }>(
            connection,
            'frequency.per-customer-a-vs-b',
            'formula A vs formula B computed per customer (window function LAG), no id_customer selected',
            frequencySql,
          );
          await explainQuery(connection, 'frequency.per-customer-a-vs-b', frequencySql);

          const diffs = frequencyRows.map((row) => Math.abs(Number(row.frequency_a) - Number(row.frequency_b)));
          frequencyB = {
            computed: true,
            method: 'window_function',
            customersWithBothMetrics: frequencyRows.length,
            frequencyAStats: computePercentileStats(frequencyRows.map((row) => Number(row.frequency_a))),
            frequencyBStats: computePercentileStats(frequencyRows.map((row) => Number(row.frequency_b))),
            absoluteDifferenceStats: computePercentileStats(diffs),
          };
        } else {
          frequencyB = {
            computed: false,
            method: 'fallback_not_executed',
            reason: 'Server does not support window functions per parseServerVersion(); fallback SQL exists (see lib) but was not run against production data in this session.',
          };
        }
      }

      customerDistributionOutput = {
        available: true,
        totalBuyers,
        ordersPerCustomer: { stats: computePercentileStats(orderCounts), buckets: bucketOrderCounts(orderCounts) },
        spendPerCustomerTaxIncl: computePercentileStats(spendValues),
        averageOrderValuePerCustomerTaxIncl: computePercentileStats(aovValues),
        daysBetweenFirstAndLastOrder: { customersWithMultipleOrders: daysSpanValues.length, customersWithSingleOrder: totalBuyers - daysSpanValues.length, stats: computePercentileStats(daysSpanValues) },
        recencyDaysSinceLastOrder: { stats: computePercentileStats(recencyDays), buckets: bucketRecency(recencyDays) },
        frequency: {
          formulaADescription: '(lastOrderAt - firstOrderAt) / (totalOrders - 1), customers with >= 2 valid orders only',
          formulaAStatsFromDistributionQuery: computePercentileStats(frequencyAValues),
          formulaBAndComparison: frequencyB,
        },
      };
    }

    // ================================================================
    // Section 9: units and distinct products (folded into customer-distribution.json —
    // no dedicated output file exists for this in the fixed list, see CP-R1-T07A section 13)
    // ================================================================
    let unitsAndProducts: Record<string, unknown> = { available: false };
    if (orderDetailDiscovery.tableName && hasTable('orders')) {
      const od = orderDetailDiscovery.tableName;
      if (hasOrderDetailColumn('product_quantity') && hasOrderDetailColumn('id_order')) {
        const [unitsRow] = await runQuery<{ total_units: number; total_refunded_units: number | null; distinct_products: number; orders_with_lines: number }>(
          connection,
          'units.gross-and-distinct',
          'gross units purchased, refunded units, distinct product_id, for order_detail lines belonging to valid orders',
          `SELECT
            SUM(od.product_quantity) AS total_units,
            ${hasOrderDetailColumn('product_quantity_refunded') ? 'SUM(od.product_quantity_refunded)' : 'NULL'} AS total_refunded_units,
            ${hasOrderDetailColumn('product_id') ? 'COUNT(DISTINCT od.product_id)' : 'NULL'} AS distinct_products,
            COUNT(DISTINCT od.id_order) AS orders_with_lines
          FROM ${od} od
          INNER JOIN ${prefix}orders o ON o.id_order = od.id_order
          WHERE o.valid = 1`,
        );

        const [ordersWithoutLinesRow] = await runQuery<{ c: number }>(
          connection,
          'units.orders-without-lines',
          'valid orders with no order_detail row at all',
          `SELECT COUNT(*) AS c FROM ${prefix}orders o WHERE o.valid = 1 AND NOT EXISTS (SELECT 1 FROM ${od} WHERE ${od}.id_order = o.id_order)`,
        );

        let variantStats: { linesWithAttribute: number } | null = null;
        if (hasOrderDetailColumn('product_attribute_id')) {
          const [variantRow] = await runQuery<{ c: number }>(
            connection,
            'units.lines-with-attribute',
            'order_detail lines with a non-zero product_attribute_id (a variant), valid orders only',
            `SELECT COUNT(*) AS c FROM ${od} od INNER JOIN ${prefix}orders o ON o.id_order = od.id_order WHERE o.valid = 1 AND od.product_attribute_id IS NOT NULL AND od.product_attribute_id <> 0`,
          );
          variantStats = { linesWithAttribute: Number(variantRow?.c ?? 0) };
        }

        let missingProducts: { linesWithMissingProduct: number; distinctMissingProducts: number } | null = null;
        const productTableName = `${prefix}product`;
        if (hasOrderDetailColumn('product_id') && tableNames.includes(productTableName)) {
          assertSafeIdentifier(productTableName, 'table name');
          const [missingRow] = await runQuery<{ lines_with_missing_product: number; distinct_missing_products: number }>(
            connection,
            'units.missing-products',
            'order_detail lines (valid orders) referencing a product_id absent from the current product catalog',
            `SELECT COUNT(*) AS lines_with_missing_product, COUNT(DISTINCT od.product_id) AS distinct_missing_products
             FROM ${od} od
             INNER JOIN ${prefix}orders o ON o.id_order = od.id_order
             LEFT JOIN ${productTableName} p ON p.id_product = od.product_id
             WHERE o.valid = 1 AND od.product_id IS NOT NULL AND od.product_id <> 0 AND p.id_product IS NULL`,
          );
          missingProducts = { linesWithMissingProduct: Number(missingRow?.lines_with_missing_product ?? 0), distinctMissingProducts: Number(missingRow?.distinct_missing_products ?? 0) };
        }

        const grossUnits = Number(unitsRow?.total_units ?? 0);
        const refundedUnits = unitsRow?.total_refunded_units === null || unitsRow?.total_refunded_units === undefined ? null : Number(unitsRow.total_refunded_units);

        unitsAndProducts = {
          available: true,
          orderDetailTableName: od,
          totalUnitsGross: grossUnits,
          totalUnitsRefunded: refundedUnits,
          totalUnitsNetPotential: refundedUnits === null ? null : grossUnits - refundedUnits,
          distinctProductsPurchased: unitsRow?.distinct_products === null || unitsRow?.distinct_products === undefined ? null : Number(unitsRow.distinct_products),
          ordersWithLines: Number(unitsRow?.orders_with_lines ?? 0),
          ordersWithoutLines: Number(ordersWithoutLinesRow?.c ?? 0),
          variantStats,
          missingProducts,
        };
      }
    }
    if (customerDistributionOutput.available) {
      customerDistributionOutput.unitsAndProducts = unitsAndProducts;
    }
    await writeJson('customer-distribution.json', customerDistributionOutput);

    // ================================================================
    // Section 10: performance — EXPLAIN on the 4 candidate query shapes
    // ================================================================
    const performanceOutput: Record<string, unknown> = { available: hasTable('orders') };
    if (hasTable('orders')) {
      await explainQuery(connection, 'performance.candidate-a-direct-summary', `SELECT COUNT(*), SUM(total_paid_tax_incl) FROM ${prefix}orders WHERE id_customer = ? AND valid = 1`, [1]);
      if (orderDetailDiscovery.tableName) {
        await explainQuery(
          connection,
          'performance.candidate-b-orders-join-detail',
          `SELECT SUM(od.product_quantity), COUNT(DISTINCT od.product_id) FROM ${prefix}orders o INNER JOIN ${orderDetailDiscovery.tableName} od ON od.id_order = o.id_order WHERE o.id_customer = ? AND o.valid = 1`,
          [1],
        );
      }
      await explainQuery(
        connection,
        'performance.candidate-c-frequency-window',
        `SELECT DATEDIFF(date_add, LAG(date_add) OVER (PARTITION BY id_customer ORDER BY date_add)) FROM ${prefix}orders WHERE id_customer = ? AND valid = 1`,
        [1],
      );
      await explainQuery(
        connection,
        'performance.candidate-d-cancellations-refunds',
        `SELECT COUNT(*) FROM ${prefix}orders WHERE id_customer = ? AND current_state IN (?, ?)`,
        [1, CANCELLED_STATE_ID, REFUNDED_STATE_ID],
      );

      const ordersIndexes = ((schemaInventory.tables as Record<string, { indexes?: unknown[] }>).orders as unknown as { indexes: Array<{ Key_name: string; Column_name: string }> })?.indexes ?? [];
      performanceOutput.indexesOnOrders = Array.from(new Set(ordersIndexes.map((row) => row.Key_name)));
      performanceOutput.idCustomerIndexed = ordersIndexes.some((row) => row.Column_name === 'id_customer');
      performanceOutput.candidateQueries = ['performance.candidate-a-direct-summary', 'performance.candidate-b-orders-join-detail', 'performance.candidate-c-frequency-window', 'performance.candidate-d-cancellations-refunds'];
      performanceOutput.note = 'Full EXPLAIN FORMAT=JSON plans for each candidate are in explains.json under the same keys — this file only summarizes which indexes exist on orders.id_customer.';
    }
    await writeJson('performance-analysis.json', performanceOutput);

    // --- Final rollup ---
    await writeQueryLogAndExplains();
    await writeJson('audit-result.json', {
      executedAt: new Date().toISOString(),
      status: 'completed',
      prefix,
      missingTables: discovery.missing,
      operativeLanguageId,
      totalOrders,
      orderDetailTableName: orderDetailDiscovery.tableName,
      orderSlipTableName: orderSlipDiscovery.tableName,
      proposedContractFields: buildContractFieldDocs(),
      outputs: [
        'preflight.json',
        'schema-inventory.json',
        'order-validity-analysis.json',
        'monetary-analysis.json',
        'refund-analysis.json',
        'customer-distribution.json',
        'performance-analysis.json',
        'query-log.json',
        'explains.json',
      ],
    });

    console.info(`[audit-commercial-summary] Completed. Outputs written to ${OUTPUT_DIR}`);
  } finally {
    await connection.end();
  }

  async function writeQueryLogAndExplains(): Promise<void> {
    await writeJson('query-log.json', queryLog);
    await writeJson('explains.json', explains);
  }
}

main().catch(async (error) => {
  const safe = sanitizeError(error);
  console.error(`[audit-commercial-summary] Failed: ${safe.type}${safe.code ? ` (${safe.code})` : ''}`);
  await writeJson('audit-result.json', { executedAt: new Date().toISOString(), status: 'failed', error: safe }).catch(() => undefined);
  process.exitCode = 1;
});
