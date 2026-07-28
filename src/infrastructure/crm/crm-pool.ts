import mysql from 'mysql2/promise';
import { config } from '../../config.js';
import { createQueryExecutor, type QueryExecutor } from '../shared/query-executor.js';

// Lazy singleton: one reusable pool, not a new connection per request. Read-only usage
// throughout this service — no writes, no SET GLOBAL, no migrations run from here.
let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: config.crmDb.host,
      port: config.crmDb.port,
      user: config.crmDb.user,
      password: config.crmDb.password,
      database: config.crmDb.database,
      connectionLimit: config.crmDb.connectionLimit,
      // master_customer.id is bigint(20) unsigned: keep it as a string end-to-end
      // instead of risking precision loss on a JS number.
      supportBigNumbers: true,
      bigNumberStrings: true,
      timezone: 'Z',
    });
  }
  return pool;
}

export function getCrmQueryExecutor(): QueryExecutor {
  return createQueryExecutor(getPool(), config.crmDb.queryTimeoutMs);
}

export type CrmReadinessReason = 'crm_unavailable' | 'crm_timeout' | 'crm_schema_incompatible';

export type CrmReadinessResult =
  | { readonly status: 'ready' }
  | { readonly status: 'not_ready'; readonly reason: CrmReadinessReason };

const READINESS_TIMEOUT_CODES = new Set(['ETIMEDOUT', 'PROTOCOL_SEQUENCE_TIMEOUT']);
const READINESS_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
]);
const READINESS_SCHEMA_CODES = new Set(['ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE']);

// Connectivity + minimal schema contract in one cheap, read-only probe: selecting the
// column with LIMIT 0 fails with ER_BAD_FIELD_ERROR if prestashop_customer_id is missing
// (migration 001 not applied) without ever scanning a row. Never returns the raw driver
// message — only a closed set of reasons.
export async function checkCrmReadiness(): Promise<CrmReadinessResult> {
  try {
    await getPool().query('SELECT prestashop_customer_id FROM master_customer LIMIT 0');
    return { status: 'ready' };
  } catch (error) {
    return { status: 'not_ready', reason: classifyReadinessError(error) };
  }
}

function classifyReadinessError(error: unknown): CrmReadinessReason {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : null;

  if (code && READINESS_SCHEMA_CODES.has(code)) {
    return 'crm_schema_incompatible';
  }
  if (code && READINESS_TIMEOUT_CODES.has(code)) {
    return 'crm_timeout';
  }
  if (code && READINESS_UNAVAILABLE_CODES.has(code)) {
    return 'crm_unavailable';
  }
  // Unclassified failure: readiness always reports one of the three known reasons — it
  // never propagates like the data-read path does — so default to unavailable.
  return 'crm_unavailable';
}

export async function closeCrmPool(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}
