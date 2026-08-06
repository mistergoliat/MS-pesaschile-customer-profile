import mysql from 'mysql2/promise';
import { config } from '../../config.js';
import { createQueryExecutor, type QueryExecutor } from '../shared/query-executor.js';

// Separate pool from CRM on purpose: same physical infrastructure today, but CRM and
// PrestaShop stay separate logical sources (see README "Sources"). Read-only, no writes.
let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: config.prestashopDb.host,
      port: config.prestashopDb.port,
      user: config.prestashopDb.user,
      password: config.prestashopDb.password,
      database: config.prestashopDb.database,
      connectionLimit: config.prestashopDb.connectionLimit,
      // date_add/date_upd as plain strings instead of JS Date objects.
      dateStrings: true,
      timezone: 'Z',
    });
  }
  return pool;
}

export function getPrestashopQueryExecutor(): QueryExecutor {
  return createQueryExecutor(getPool(), config.prestashopDb.queryTimeoutMs);
}

export type PrestashopReadinessReason = 'prestashop_unavailable' | 'prestashop_schema_incompatible';

export type PrestashopReadinessResult =
  | { readonly status: 'ready' }
  | { readonly status: 'not_ready'; readonly reason: PrestashopReadinessReason };

export async function pingPrestashop(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function checkPrestashopReadiness(tablePrefix: string): Promise<PrestashopReadinessResult> {
  try {
    await getPool().query(`SELECT id_customer FROM ${tablePrefix}customer LIMIT 0`);
    await getPool().query(`SELECT id_order, id_customer, reference FROM ${tablePrefix}orders LIMIT 0`);
    await getPool().query(`SELECT id_order, product_id, product_quantity FROM ${tablePrefix}order_detail LIMIT 0`);
    return { status: 'ready' };
  } catch (error) {
    return { status: 'not_ready', reason: classifyPrestashopReadinessError(error) };
  }
}

function classifyPrestashopReadinessError(error: unknown): PrestashopReadinessReason {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;

  if (code === 'ER_BAD_FIELD_ERROR' || code === 'ER_NO_SUCH_TABLE') {
    return 'prestashop_schema_incompatible';
  }
  return 'prestashop_unavailable';
}

export async function closePrestashopPool(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}
