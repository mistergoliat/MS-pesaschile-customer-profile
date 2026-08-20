import mysql from 'mysql2/promise';
import { config } from '../../config.js';
import { createQueryExecutor, type QueryExecutor } from '../shared/query-executor.js';

// Mirrors src/infrastructure/clustering/cluster-db-pool.ts / rfm/rfm-snapshot-pool.ts exactly
// — same lazy-singleton pattern, independent credential family (config.analyticsDb, never
// config.clusterDb/config.rfmSnapshotDb/config.prestashopDb).
let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (!pool) {
    if (!config.analyticsDb) {
      throw new Error('Analytics DB pool requested but ANALYTICS_DB_* is not configured');
    }
    pool = mysql.createPool({
      host: config.analyticsDb.host,
      port: config.analyticsDb.port,
      user: config.analyticsDb.user,
      password: config.analyticsDb.password,
      database: config.analyticsDb.database,
      connectionLimit: config.analyticsDb.connectionLimit,
      supportBigNumbers: true,
      bigNumberStrings: true,
      timezone: 'Z',
    });
  }
  return pool;
}

export function getAnalyticsPool(): mysql.Pool {
  if (!config.analyticsDb) {
    throw new Error('Analytics DB pool requested but ANALYTICS_DB_* is not configured');
  }
  return getPool();
}

export function getAnalyticsQueryExecutor(): QueryExecutor {
  if (!config.analyticsDb) {
    throw new Error('Analytics DB query executor requested but ANALYTICS_DB_* is not configured');
  }
  return createQueryExecutor(getPool(), config.analyticsDb.queryTimeoutMs);
}

export async function closeAnalyticsPool(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}
