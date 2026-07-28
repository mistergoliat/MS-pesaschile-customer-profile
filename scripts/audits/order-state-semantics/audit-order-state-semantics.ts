// CP-R1-T06A — Order State Semantics Audit.
//
// Standalone, read-only, one-shot tool. Deliberately does NOT import anything from
// src/ (no src/config.ts, no src/infrastructure/*): this script is not part of the
// running service, has its own credential/guardrail handling, and must stay runnable
// even if the app's config contract changes independently. See docs/audits/
// order-state-semantics/CP-R1-T06A-order-state-semantics-audit.md for the full report.
//
// Run with: npx tsx scripts/audits/order-state-semantics/audit-order-state-semantics.ts
//
// Aborts before touching any data table if: credentials are missing, grants are not
// SELECT/USAGE-only, or the server is already under load. See lib/guardrails.ts.

import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { assessGrants, evaluateLoad } from './lib/guardrails.js';
import { detectOrderDetailTable, detectPrefix } from './lib/schema-discovery.js';
import {
  buildHistoryEventsPerOrderSql,
  buildLatestHistoryDuplicatesSql,
  buildLatestHistorySql,
  buildOrphanedHistorySql,
} from './lib/history-sql.js';
import { detectStateInconsistencies, proposeClassification } from './lib/classification.js';
import { computePercentileStats } from './lib/stats.js';
import type { OrderStateFlags, StateVolumeInput } from './lib/types.js';

// Order lines are compared against orders.total_products_wt within this relative
// tolerance to account for rounding — explicit, not hidden. Documented in
// docs/audits/order-state-semantics/CP-R1-T06A-order-detail-coverage.md.
const MONEY_TOLERANCE_RATIO = 0.005; // 0.5%

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(SCRIPT_DIR, 'outputs');
const QUERY_TIMEOUT_MS = 15000;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;
const REQUIRED_ENV_VARS = ['PRESTASHOP_DB_HOST', 'PRESTASHOP_DB_USER', 'PRESTASHOP_DB_PASSWORD'] as const;

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

// Every error surfaced to stdout/JSON goes through this — never a raw driver message,
// which can carry host/user/password in its text. Mirrors src/observability's
// instanceof-only classification pattern, kept local since this script must not
// depend on src/.
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
  const startedAt = Date.now();
  const [rows] = await connection.query({ sql, timeout: QUERY_TIMEOUT_MS }, params as unknown[]);
  const durationMs = Date.now() - startedAt;
  const rowCount = Array.isArray(rows) ? rows.length : 0;
  queryLog.push({ name, purpose, durationMs, rowCount });
  return rows as Row[];
}

async function explainQuery(connection: mysql.Connection, name: string, sql: string, params: readonly unknown[] = []): Promise<void> {
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
      `[audit-order-state-semantics] Aborted: missing required env vars (${credentials.missing.join(', ')}). ` +
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

    const [versionRow] = await runQuery<{ version: string }>(
      connection,
      'preflight.version',
      'MySQL version, to decide window-function support for order_history queries',
      'SELECT VERSION() AS version',
    );
    const majorVersion = Number(versionRow?.version.split('.')[0] ?? 0);
    const supportsWindowFunctions = majorVersion >= 8;

    const preflight = {
      executedAt: new Date().toISOString(),
      status: grants.safe && load.safe ? 'ok' : 'aborted',
      connection: { database: identity?.db, user: identity?.user, hostname: identity?.hostname },
      grants,
      load,
      mysqlVersion: versionRow?.version ?? null,
      supportsWindowFunctions,
    };
    await writeJson('preflight.json', preflight);

    if (!grants.safe) {
      console.error(
        `[audit-order-state-semantics] Aborted: grants are not SELECT/USAGE-only ` +
          `(disallowed: ${grants.disallowedPrivileges.join(', ') || 'WITH GRANT OPTION'}). No data query was run.`,
      );
      process.exitCode = 1;
      return;
    }
    if (!load.safe) {
      console.error(`[audit-order-state-semantics] Aborted: server load guardrail tripped (${load.reason}). No data query was run.`);
      process.exitCode = 1;
      return;
    }

    // --- Table & prefix discovery (section 5/6) ---
    const tableRows = await runQuery<{ TABLE_NAME: string }>(
      connection,
      'discovery.tables',
      'enumerate all tables in the connected schema to detect the PrestaShop prefix',
      'SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()',
    );
    const tableNames = tableRows.map((row) => row.TABLE_NAME);
    const discovery = detectPrefix(tableNames);

    const schemaInventory: Record<string, unknown> = { discovery, tables: {} as Record<string, unknown> };

    if (!discovery.prefix) {
      await writeJson('schema-inventory.json', schemaInventory);
      console.error(
        '[audit-order-state-semantics] No unambiguous PrestaShop prefix found for the required tables ' +
          '(orders/order_state/order_state_lang/order_history/order_carrier/carrier). ' +
          'See outputs/schema-inventory.json for candidates. Nothing further was audited.',
      );
      await writeQueryLogAndExplains();
      return;
    }

    const prefix = discovery.prefix;
    assertSafeIdentifier(prefix, 'table prefix');

    for (const [suffix, tableName] of Object.entries(discovery.found)) {
      assertSafeIdentifier(tableName, 'table name');
      const columns = await runQuery(
        connection,
        `inventory.columns.${suffix}`,
        `column inventory for ${tableName}`,
        'SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA ' +
          'FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
        [tableName],
      );
      const indexes = await runQuery(connection, `inventory.indexes.${suffix}`, `index inventory for ${tableName}`, `SHOW INDEX FROM \`${tableName}\``);
      const foreignKeys = await runQuery(
        connection,
        `inventory.foreign-keys.${suffix}`,
        `declared foreign keys for ${tableName}`,
        'SELECT COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME ' +
          'FROM information_schema.key_column_usage ' +
          'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL',
        [tableName],
      );
      (schemaInventory.tables as Record<string, unknown>)[suffix] = { tableName, columns, indexes, foreignKeys };
    }
    if (discovery.missing.length > 0) {
      schemaInventory.missingTables = discovery.missing;
    }

    // --- Order detail table discovery (order_detail vs order_details) ---
    // Not one of the 6 originally-required tables — its name is never assumed, checked
    // via information_schema.tables like everything else in this script.
    const orderDetailDiscovery = detectOrderDetailTable(tableNames, prefix);
    schemaInventory.orderDetailDiscovery = orderDetailDiscovery;
    let orderDetailColumns = new Set<string>();
    if (orderDetailDiscovery.tableName) {
      const odTableName = orderDetailDiscovery.tableName;
      assertSafeIdentifier(odTableName, 'table name');
      const columns = await runQuery(
        connection,
        'inventory.columns.order_detail',
        `column inventory for ${odTableName}`,
        'SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA ' +
          'FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
        [odTableName],
      );
      const indexes = await runQuery(connection, 'inventory.indexes.order_detail', `index inventory for ${odTableName}`, `SHOW INDEX FROM \`${odTableName}\``);
      const foreignKeys = await runQuery(
        connection,
        'inventory.foreign-keys.order_detail',
        `declared foreign keys for ${odTableName}`,
        'SELECT COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME ' +
          'FROM information_schema.key_column_usage ' +
          'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL',
        [odTableName],
      );
      (schemaInventory.tables as Record<string, unknown>).order_detail = { tableName: odTableName, columns, indexes, foreignKeys };
      orderDetailColumns = new Set((columns as Array<{ COLUMN_NAME: string }>).map((c) => c.COLUMN_NAME));
    }

    await writeJson('schema-inventory.json', schemaInventory);

    const hasTable = (suffix: string): boolean => Boolean(discovery.found[suffix]);
    const hasOrderDetailColumn = (name: string): boolean => orderDetailColumns.has(name);

    // --- Language discovery (section 7) ---
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

    // --- State catalog (section 8) ---
    let stateCatalogRows: Array<Record<string, unknown>> = [];
    if (hasTable('order_state')) {
      stateCatalogRows = await runQuery(
        connection,
        'catalog.states-all-languages',
        'full order_state x order_state_lang catalog (template content never selected, only presence/length)',
        `SELECT
          os.id_order_state, osl.id_lang, osl.name,
          CASE WHEN osl.template IS NULL THEN 0 ELSE 1 END AS has_template,
          LENGTH(osl.template) AS template_length,
          os.invoice, os.send_email, os.module_name, os.color, os.unremovable, os.hidden,
          os.logable, os.delivery, os.shipped, os.paid, os.pdf_invoice, os.pdf_delivery, os.deleted
        FROM ${prefix}order_state os
        LEFT JOIN ${prefix}order_state_lang osl ON osl.id_order_state = os.id_order_state
        ORDER BY os.id_order_state, osl.id_lang`,
      );
    }
    await writeJson('state-catalog.json', { operativeLanguageId, languageDistribution, states: stateCatalogRows });

    // --- current_state distribution (section 9) + flags cross-matrix (section 10) ---
    let distribution: Array<Record<string, unknown>> = [];
    let totalOrders = 0;
    let zeroOrNullCurrentState = 0;
    let orphanedCurrentState = 0;
    let unusedConfiguredStates: number[] = [];
    let matrix: Array<StateVolumeInput & { inconsistencies: ReturnType<typeof detectStateInconsistencies> }> = [];
    let classificationProposals: ReturnType<typeof proposeClassification>[] = [];

    if (hasTable('orders') && operativeLanguageId !== null) {
      const distributionSql = `
        SELECT o.current_state, osl.name, COUNT(*) AS order_count, MIN(o.date_add) AS first_seen_at, MAX(o.date_add) AS last_seen_at
        FROM ${prefix}orders o
        LEFT JOIN ${prefix}order_state_lang osl ON osl.id_order_state = o.current_state AND osl.id_lang = ?
        GROUP BY o.current_state, osl.name
        ORDER BY order_count DESC
      `;
      distribution = await runQuery(connection, 'distribution.current-state', 'order volume per current_state for the operative language', distributionSql, [
        operativeLanguageId,
      ]);
      await explainQuery(connection, 'distribution.current-state', distributionSql, [operativeLanguageId]);

      const [totalRow] = await runQuery<{ total: number }>(connection, 'distribution.total-orders', 'total order count', `SELECT COUNT(*) AS total FROM ${prefix}orders`);
      totalOrders = Number(totalRow?.total ?? 0);

      const [zeroNullRow] = await runQuery<{ c: number }>(
        connection,
        'distribution.zero-or-null-current-state',
        'orders with current_state = 0 or NULL',
        `SELECT COUNT(*) AS c FROM ${prefix}orders WHERE current_state = 0 OR current_state IS NULL`,
      );
      zeroOrNullCurrentState = Number(zeroNullRow?.c ?? 0);

      if (hasTable('order_state')) {
        const [orphanRow] = await runQuery<{ c: number }>(
          connection,
          'distribution.orphaned-current-state',
          'orders whose current_state does not exist in order_state',
          `SELECT COUNT(*) AS c FROM ${prefix}orders o
           LEFT JOIN ${prefix}order_state os ON os.id_order_state = o.current_state
           WHERE o.current_state IS NOT NULL AND o.current_state <> 0 AND os.id_order_state IS NULL`,
        );
        orphanedCurrentState = Number(orphanRow?.c ?? 0);

        const unusedRows = await runQuery<{ id_order_state: number }>(
          connection,
          'distribution.unused-configured-states',
          'states configured in order_state but never used by any order',
          `SELECT os.id_order_state FROM ${prefix}order_state os
           LEFT JOIN ${prefix}orders o ON o.current_state = os.id_order_state
           WHERE o.id_order IS NULL`,
        );
        unusedConfiguredStates = unusedRows.map((row) => row.id_order_state);

        // --- Flags cross-matrix + classification proposal (sections 10, 14) ---
        const flagsByStateId = new Map<number, OrderStateFlags>();
        for (const row of stateCatalogRows) {
          const stateId = Number(row.id_order_state);
          if (!flagsByStateId.has(stateId)) {
            flagsByStateId.set(stateId, {
              invoice: Boolean(row.invoice),
              sendEmail: Boolean(row.send_email),
              moduleName: row.module_name ? String(row.module_name) : null,
              unremovable: Boolean(row.unremovable),
              hidden: Boolean(row.hidden),
              logable: Boolean(row.logable),
              delivery: Boolean(row.delivery),
              shipped: Boolean(row.shipped),
              paid: Boolean(row.paid),
              pdfInvoice: Boolean(row.pdf_invoice),
              pdfDelivery: Boolean(row.pdf_delivery),
              deleted: Boolean(row.deleted),
            });
          }
        }

        const orderCountByStateId = new Map<number | null, number>();
        for (const row of distribution) {
          const key = row.current_state === null ? null : Number(row.current_state);
          orderCountByStateId.set(key, Number(row.order_count));
        }

        for (const [stateId, flagsForState] of flagsByStateId) {
          const distributionRow = distribution.find((row) => Number(row.current_state) === stateId);
          const input: StateVolumeInput = {
            stateId,
            name: (distributionRow?.name as string | null | undefined) ?? null,
            flags: flagsForState,
            orderCount: orderCountByStateId.get(stateId) ?? 0,
            totalOrders,
          };
          matrix.push({ ...input, inconsistencies: detectStateInconsistencies(input) });
          classificationProposals.push(proposeClassification(input));
        }
      }
    }

    // --- order_history (section 11) ---
    // Folded into state-distribution.json below: CP-R1-T06A section 4 lists a fixed
    // set of 8 output files with no dedicated history file, and current_state vs
    // latest-order_history-state is thematically part of the same distribution.
    const historyResult: Record<string, unknown> = { available: hasTable('order_history') && hasTable('orders') };
    if (hasTable('order_history') && hasTable('orders')) {
      const latestHistorySql = buildLatestHistorySql(prefix, supportsWindowFunctions);
      historyResult.latestStateMatch = await runQuery(connection, 'history.latest-state-match', 'current_state vs latest order_history state, aggregated', latestHistorySql);
      await explainQuery(connection, 'history.latest-state-match', latestHistorySql);

      const [dupRow] = await runQuery<{ orders_with_duplicate_latest_history: number }>(
        connection,
        'history.duplicate-latest',
        'orders whose latest order_history is ambiguous (tied date_add, different states)',
        buildLatestHistoryDuplicatesSql(prefix),
      );
      historyResult.ordersWithDuplicateLatestHistory = Number(dupRow?.orders_with_duplicate_latest_history ?? 0);

      const [eventsRow] = await runQuery(connection, 'history.events-per-order', 'total/min/avg/max history events per order', buildHistoryEventsPerOrderSql(prefix));
      historyResult.eventsPerOrder = eventsRow ?? null;

      const [orphanRow] = await runQuery(connection, 'history.orphaned-rows', 'order_history rows referencing a missing order or state', buildOrphanedHistorySql(prefix));
      historyResult.orphanedRows = orphanRow ?? null;
    }

    await writeJson('state-distribution.json', {
      operativeLanguageId,
      totalOrders,
      zeroOrNullCurrentState,
      orphanedCurrentState,
      unusedConfiguredStates,
      distribution,
      matrix,
      classificationProposals,
      history: historyResult,
    });

    // --- carrier / order_carrier / tracking (sections 12, 13) ---
    const trackingCoverage: Record<string, unknown> = {
      available: hasTable('order_carrier') && hasTable('carrier') && hasTable('orders'),
    };
    if (hasTable('order_carrier')) {
      const [orderCarrierStats] = await runQuery(
        connection,
        'carrier.order-carrier-coverage',
        'orders with at least one / more than one order_carrier row',
        `SELECT
          COUNT(DISTINCT id_order) AS orders_with_any_carrier,
          SUM(CASE WHEN cnt > 1 THEN 1 ELSE 0 END) AS orders_with_multiple_carriers,
          MAX(cnt) AS max_order_carrier_rows_per_order
        FROM (
          SELECT id_order, COUNT(*) AS cnt FROM ${prefix}order_carrier GROUP BY id_order
        ) per_order`,
      );
      trackingCoverage.orderCarrierCoverage = orderCarrierStats ?? null;

      const [trackingStats] = await runQuery(
        connection,
        'carrier.tracking-coverage',
        'tracking_number presence/length stats — never the raw value',
        `SELECT
          COUNT(*) AS total_order_carrier_rows,
          SUM(CASE WHEN tracking_number IS NOT NULL AND tracking_number <> '' THEN 1 ELSE 0 END) AS rows_with_tracking,
          MIN(LENGTH(tracking_number)) AS min_tracking_length,
          MAX(LENGTH(tracking_number)) AS max_tracking_length
        FROM ${prefix}order_carrier`,
      );
      trackingCoverage.trackingStats = trackingStats ?? null;

      const [dupTrackingRow] = await runQuery(
        connection,
        'carrier.duplicate-tracking',
        'count of tracking_number values shared by more than one order_carrier row (counts only, never the value)',
        `SELECT COUNT(*) AS duplicate_tracking_groups FROM (
          SELECT tracking_number FROM ${prefix}order_carrier
          WHERE tracking_number IS NOT NULL AND tracking_number <> ''
          GROUP BY tracking_number HAVING COUNT(*) > 1
        ) dup`,
      );
      trackingCoverage.duplicateTrackingGroups = dupTrackingRow?.duplicate_tracking_groups ?? 0;

      if (hasTable('orders')) {
        const [mismatchRow] = await runQuery(
          connection,
          'carrier.id-carrier-mismatch',
          'orders.id_carrier vs the most recent order_carrier.id_carrier for that order',
          `SELECT COUNT(*) AS mismatched_orders FROM (
            SELECT oc.id_order, oc.id_carrier
            FROM ${prefix}order_carrier oc
            INNER JOIN (
              SELECT id_order, MAX(id_order_carrier) AS latest_id FROM ${prefix}order_carrier GROUP BY id_order
            ) latest ON latest.id_order = oc.id_order AND latest.latest_id = oc.id_order_carrier
          ) latest_carrier
          INNER JOIN ${prefix}orders o ON o.id_order = latest_carrier.id_order
          WHERE o.id_carrier <> latest_carrier.id_carrier`,
        );
        trackingCoverage.idCarrierMismatchCount = mismatchRow?.mismatched_orders ?? 0;
      }
    }
    if (hasTable('carrier')) {
      const [carrierStats] = await runQuery(
        connection,
        'carrier.carrier-catalog-stats',
        'active/deleted/module carrier counts',
        `SELECT
          COUNT(*) AS total_carriers,
          SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active_carriers,
          SUM(CASE WHEN deleted = 1 THEN 1 ELSE 0 END) AS deleted_carriers,
          SUM(CASE WHEN is_module = 1 THEN 1 ELSE 0 END) AS module_carriers
        FROM ${prefix}carrier`,
      );
      trackingCoverage.carrierCatalogStats = carrierStats ?? null;

      if (hasTable('order_carrier')) {
        const [deletedReferencedRow] = await runQuery(
          connection,
          'carrier.deleted-carrier-still-referenced',
          'carriers marked deleted but still referenced by order_carrier',
          `SELECT COUNT(DISTINCT c.id_carrier) AS deleted_carriers_still_referenced
          FROM ${prefix}carrier c
          INNER JOIN ${prefix}order_carrier oc ON oc.id_carrier = c.id_carrier
          WHERE c.deleted = 1`,
        );
        trackingCoverage.deletedCarriersStillReferenced = deletedReferencedRow?.deleted_carriers_still_referenced ?? 0;
      }
    }
    await writeJson('tracking-coverage.json', trackingCoverage);

    // --- Order detail coverage (order_detail scope extension) ---
    const orderDetail: Record<string, unknown> = {
      available: Boolean(orderDetailDiscovery.tableName) && hasTable('orders'),
      tableName: orderDetailDiscovery.tableName,
      candidatesChecked: orderDetailDiscovery.candidatesChecked,
    };
    if (orderDetailDiscovery.tableName && hasTable('orders')) {
      const od = orderDetailDiscovery.tableName;

      const [totalsRow] = await runQuery<{ total_rows: number }>(
        connection,
        'order-detail.total-rows',
        'total rows in order_detail',
        `SELECT COUNT(*) AS total_rows FROM ${od}`,
      );
      orderDetail.totalRows = Number(totalsRow?.total_rows ?? 0);

      // Consistency (section 4): orphans in both directions, via NOT EXISTS — no join
      // fan-out, no individual order ids in the result.
      const [ordersWithoutLinesRow] = await runQuery<{ c: number }>(
        connection,
        'order-detail.orders-without-lines',
        'orders in ps_orders with no order_detail row at all',
        `SELECT COUNT(*) AS c FROM ${prefix}orders o WHERE NOT EXISTS (SELECT 1 FROM ${od} WHERE ${od}.id_order = o.id_order)`,
      );
      const ordersWithoutLines = Number(ordersWithoutLinesRow?.c ?? 0);
      orderDetail.ordersWithoutLines = ordersWithoutLines;
      orderDetail.ordersWithLines = totalOrders - ordersWithoutLines;

      const [orphanedLinesRow] = await runQuery<{ c: number }>(
        connection,
        'order-detail.orphaned-lines',
        'order_detail rows whose id_order does not exist in ps_orders',
        `SELECT COUNT(*) AS c FROM ${od} WHERE NOT EXISTS (SELECT 1 FROM ${prefix}orders o WHERE o.id_order = ${od}.id_order)`,
      );
      orderDetail.orphanedLines = Number(orphanedLinesRow?.c ?? 0);

      // Lines-per-order and distinct-products-per-order distributions: fetched as bare
      // counts (no id_order in the SELECT list at all), summarized in JS via
      // computePercentileStats — works on any MySQL version, never exposes an order id.
      if (hasOrderDetailColumn('id_order')) {
        const lineCounts = await runQuery<{ line_count: number }>(
          connection,
          'order-detail.lines-per-order',
          'distribution of line count per order (no id_order selected)',
          `SELECT COUNT(*) AS line_count FROM ${od} GROUP BY id_order`,
        );
        orderDetail.linesPerOrder = computePercentileStats(lineCounts.map((row) => Number(row.line_count)));

        if (hasOrderDetailColumn('product_id')) {
          const distinctProductCounts = await runQuery<{ distinct_products: number }>(
            connection,
            'order-detail.distinct-products-per-order',
            'distribution of distinct product_id count per order (no id_order selected)',
            `SELECT COUNT(DISTINCT product_id) AS distinct_products FROM ${od} GROUP BY id_order`,
          );
          orderDetail.distinctProductsPerOrder = computePercentileStats(distinctProductCounts.map((row) => Number(row.distinct_products)));

          const [multiProductRow] = await runQuery<{ c: number }>(
            connection,
            'order-detail.orders-with-multiple-products',
            'orders with more than one distinct product_id',
            `SELECT COUNT(*) AS c FROM (SELECT id_order FROM ${od} GROUP BY id_order HAVING COUNT(DISTINCT product_id) > 1) x`,
          );
          orderDetail.ordersWithMultipleProducts = Number(multiProductRow?.c ?? 0);
        }

        if (hasOrderDetailColumn('product_attribute_id')) {
          const [duplicateRow] = await runQuery<{ c: number }>(
            connection,
            'order-detail.duplicate-line-groups',
            'apparent duplicate lines within the same order (same order+product+attribute more than once)',
            `SELECT COUNT(*) AS c FROM (
              SELECT id_order, product_id, product_attribute_id
              FROM ${od}
              GROUP BY id_order, product_id, product_attribute_id
              HAVING COUNT(*) > 1
            ) x`,
          );
          orderDetail.duplicateLineGroups = Number(duplicateRow?.c ?? 0);
        }
      }

      if (hasOrderDetailColumn('product_quantity')) {
        const [unitsRow] = await runQuery<{ total_units: number; lines_with_non_positive_quantity: number }>(
          connection,
          'order-detail.units-and-non-positive-quantity',
          'total units sold and lines with quantity <= 0',
          `SELECT
            SUM(product_quantity) AS total_units,
            SUM(CASE WHEN product_quantity <= 0 THEN 1 ELSE 0 END) AS lines_with_non_positive_quantity
          FROM ${od}`,
        );
        orderDetail.totalUnits = unitsRow?.total_units ?? null;
        orderDetail.linesWithNonPositiveQuantity = Number(unitsRow?.lines_with_non_positive_quantity ?? 0);
      }

      if (hasOrderDetailColumn('product_id')) {
        const [productIdRow] = await runQuery<{ c: number }>(
          connection,
          'order-detail.zero-or-null-product-id',
          'lines with product_id = 0 or NULL',
          `SELECT COUNT(*) AS c FROM ${od} WHERE product_id = 0 OR product_id IS NULL`,
        );
        orderDetail.linesWithZeroOrNullProductId = Number(productIdRow?.c ?? 0);

        if (hasOrderDetailColumn('product_attribute_id')) {
          const [attrRow] = await runQuery<{ c: number }>(
            connection,
            'order-detail.lines-with-attribute',
            'lines with a product_attribute_id (a variant), i.e. not a simple product line',
            `SELECT COUNT(*) AS c FROM ${od} WHERE product_attribute_id IS NOT NULL AND product_attribute_id <> 0`,
          );
          orderDetail.linesWithProductAttribute = Number(attrRow?.c ?? 0);
        }

        // Historical products no longer in the current catalog — opportunistic: <prefix>product
        // is not one of the 6 originally-required tables, checked here via the same
        // table-name set already fetched for prefix discovery.
        const productTableName = `${prefix}product`;
        orderDetail.productCatalogTableFound = tableNames.includes(productTableName);
        if (orderDetail.productCatalogTableFound) {
          const [missingProductRow] = await runQuery<{ lines_with_missing_product: number; distinct_missing_products: number }>(
            connection,
            'order-detail.missing-products',
            'lines/distinct products referenced by order_detail but absent from the current product catalog',
            `SELECT
              COUNT(*) AS lines_with_missing_product,
              COUNT(DISTINCT od.product_id) AS distinct_missing_products
            FROM ${od} od
            LEFT JOIN ${productTableName} p ON p.id_product = od.product_id
            WHERE od.product_id IS NOT NULL AND od.product_id <> 0 AND p.id_product IS NULL`,
          );
          orderDetail.linesWithMissingProduct = Number(missingProductRow?.lines_with_missing_product ?? 0);
          orderDetail.distinctMissingProducts = Number(missingProductRow?.distinct_missing_products ?? 0);
        }
      }

      if (hasOrderDetailColumn('product_name')) {
        const [noNameRow] = await runQuery<{ c: number }>(
          connection,
          'order-detail.lines-without-name',
          'lines with no product_name (empty or NULL)',
          `SELECT COUNT(*) AS c FROM ${od} WHERE product_name IS NULL OR product_name = ''`,
        );
        orderDetail.linesWithoutProductName = Number(noNameRow?.c ?? 0);
      }
      if (hasOrderDetailColumn('product_reference')) {
        const [noRefRow] = await runQuery<{ c: number }>(
          connection,
          'order-detail.lines-without-reference',
          'lines with no product_reference (empty or NULL)',
          `SELECT COUNT(*) AS c FROM ${od} WHERE product_reference IS NULL OR product_reference = ''`,
        );
        orderDetail.linesWithoutProductReference = Number(noRefRow?.c ?? 0);
      }
      if (hasOrderDetailColumn('total_price_tax_incl')) {
        const [negativeRow] = await runQuery<{ c: number }>(
          connection,
          'order-detail.negative-total-price',
          'lines with a negative total_price_tax_incl',
          `SELECT COUNT(*) AS c FROM ${od} WHERE total_price_tax_incl < 0`,
        );
        orderDetail.linesWithNegativeTotalPrice = Number(negativeRow?.c ?? 0);
      }
      if (hasOrderDetailColumn('product_quantity_refunded')) {
        const [refundedRow] = await runQuery<{ lines_with_refunded_qty: number; total_refunded_units: number }>(
          connection,
          'order-detail.refunded-quantities',
          'lines/units with a refunded quantity',
          `SELECT
            SUM(CASE WHEN product_quantity_refunded > 0 THEN 1 ELSE 0 END) AS lines_with_refunded_qty,
            SUM(product_quantity_refunded) AS total_refunded_units
          FROM ${od}`,
        );
        orderDetail.linesWithRefundedQuantity = Number(refundedRow?.lines_with_refunded_qty ?? 0);
        orderDetail.totalRefundedUnits = refundedRow?.total_refunded_units ?? 0;
      }
      if (hasOrderDetailColumn('product_quantity_return')) {
        const [returnedRow] = await runQuery<{ lines_with_returned_qty: number; total_returned_units: number }>(
          connection,
          'order-detail.returned-quantities',
          'lines/units with a returned quantity',
          `SELECT
            SUM(CASE WHEN product_quantity_return > 0 THEN 1 ELSE 0 END) AS lines_with_returned_qty,
            SUM(product_quantity_return) AS total_returned_units
          FROM ${od}`,
        );
        orderDetail.linesWithReturnedQuantity = Number(returnedRow?.lines_with_returned_qty ?? 0);
        orderDetail.totalReturnedUnits = returnedRow?.total_returned_units ?? 0;
      }
      if (hasOrderDetailColumn('product_quantity_reinjected')) {
        const [reinjectedRow] = await runQuery<{ lines_with_reinjected_qty: number; total_reinjected_units: number }>(
          connection,
          'order-detail.reinjected-quantities',
          'lines/units with a reinjected (restocked) quantity',
          `SELECT
            SUM(CASE WHEN product_quantity_reinjected > 0 THEN 1 ELSE 0 END) AS lines_with_reinjected_qty,
            SUM(product_quantity_reinjected) AS total_reinjected_units
          FROM ${od}`,
        );
        orderDetail.linesWithReinjectedQuantity = Number(reinjectedRow?.lines_with_reinjected_qty ?? 0);
        orderDetail.totalReinjectedUnits = reinjectedRow?.total_reinjected_units ?? 0;
      }
      if (hasOrderDetailColumn('reduction_amount_tax_incl')) {
        const [discountRow] = await runQuery<{ lines_with_discount: number; total_line_level_discount: number }>(
          connection,
          'order-detail.line-level-discounts',
          'lines with a line-level discount, and the total discount amount — kept separate from the monetary reconciliation below, not merged into it',
          `SELECT
            SUM(CASE WHEN reduction_amount_tax_incl <> 0 THEN 1 ELSE 0 END) AS lines_with_discount,
            SUM(reduction_amount_tax_incl) AS total_line_level_discount
          FROM ${od}`,
        );
        orderDetail.linesWithLineLevelDiscount = Number(discountRow?.lines_with_discount ?? 0);
        orderDetail.totalLineLevelDiscount = discountRow?.total_line_level_discount ?? 0;
      }

      // Monetary reconciliation (section 4): SUM(total_price_tax_incl) per order vs
      // orders.total_products_wt, bucketed server-side with an explicit relative
      // tolerance (MONEY_TOLERANCE_RATIO) — never computed by listing individual orders.
      if (hasOrderDetailColumn('total_price_tax_incl') && hasOrderDetailColumn('id_order')) {
        const reconciliationSql = `
          SELECT
            COUNT(*) AS orders_compared,
            SUM(CASE WHEN ABS(ld.line_sum - o.total_products_wt) = 0 THEN 1 ELSE 0 END) AS exact_matches,
            SUM(CASE
              WHEN ABS(ld.line_sum - o.total_products_wt) / NULLIF(ABS(o.total_products_wt), 0) <= ?
                OR ABS(ld.line_sum - o.total_products_wt) = 0
              THEN 1 ELSE 0 END) AS within_tolerance,
            AVG(ABS(ld.line_sum - o.total_products_wt)) AS avg_abs_diff,
            MAX(ABS(ld.line_sum - o.total_products_wt)) AS max_abs_diff
          FROM ${prefix}orders o
          INNER JOIN (
            SELECT id_order, SUM(total_price_tax_incl) AS line_sum
            FROM ${od}
            GROUP BY id_order
          ) ld ON ld.id_order = o.id_order
        `;
        const [reconciliationRow] = await runQuery(connection, 'order-detail.money-reconciliation', 'line sum vs orders.total_products_wt, bucketed with explicit tolerance', reconciliationSql, [
          MONEY_TOLERANCE_RATIO,
        ]);
        await explainQuery(connection, 'order-detail.money-reconciliation', reconciliationSql, [MONEY_TOLERANCE_RATIO]);
        orderDetail.moneyReconciliation = {
          toleranceRatio: MONEY_TOLERANCE_RATIO,
          ...(reconciliationRow as Record<string, unknown> | undefined),
        };
      }
    }
    await writeJson('order-detail-coverage.json', orderDetail);

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
      outputs: [
        'preflight.json',
        'schema-inventory.json',
        'state-catalog.json',
        'state-distribution.json',
        'tracking-coverage.json',
        'order-detail-coverage.json',
        'query-log.json',
        'explains.json',
      ],
    });

    console.info(`[audit-order-state-semantics] Completed. Outputs written to ${OUTPUT_DIR}`);
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
  console.error(`[audit-order-state-semantics] Failed: ${safe.type}${safe.code ? ` (${safe.code})` : ''}`);
  await writeJson('audit-result.json', { executedAt: new Date().toISOString(), status: 'failed', error: safe }).catch(() => undefined);
  process.exitCode = 1;
});
