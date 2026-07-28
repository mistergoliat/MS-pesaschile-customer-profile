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

export async function pingPrestashop(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePrestashopPool(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}
