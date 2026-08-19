import mysql from 'mysql2/promise';
import { config } from '../../config.js';
import { createQueryExecutor, type QueryExecutor } from '../shared/query-executor.js';

// Mirrors src/infrastructure/rfm/rfm-snapshot-pool.ts exactly — same lazy-singleton pattern,
// independent credential family (config.clusterDb, never config.prestashopDb).
let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (!pool) {
    if (!config.clusterDb) {
      throw new Error('Cluster DB pool requested but CLUSTER_DB_* is not configured');
    }
    pool = mysql.createPool({
      host: config.clusterDb.host,
      port: config.clusterDb.port,
      user: config.clusterDb.user,
      password: config.clusterDb.password,
      database: config.clusterDb.database,
      connectionLimit: config.clusterDb.connectionLimit,
      supportBigNumbers: true,
      bigNumberStrings: true,
      timezone: 'Z',
    });
  }
  return pool;
}

export function getClusterPool(): mysql.Pool {
  if (!config.clusterDb) {
    throw new Error('Cluster DB pool requested but CLUSTER_DB_* is not configured');
  }
  return getPool();
}

export function getClusterQueryExecutor(): QueryExecutor {
  if (!config.clusterDb) {
    throw new Error('Cluster DB query executor requested but CLUSTER_DB_* is not configured');
  }
  return createQueryExecutor(getPool(), config.clusterDb.queryTimeoutMs);
}

export async function closeClusterPool(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}
