import mysql from 'mysql2/promise';
import { config } from '../../config.js';
import { createQueryExecutor, type QueryExecutor } from '../shared/query-executor.js';

let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: config.rfmSnapshotDb.host,
      port: config.rfmSnapshotDb.port,
      user: config.rfmSnapshotDb.user,
      password: config.rfmSnapshotDb.password,
      database: config.rfmSnapshotDb.database,
      connectionLimit: config.rfmSnapshotDb.connectionLimit,
      supportBigNumbers: true,
      bigNumberStrings: true,
      timezone: 'Z',
    });
  }
  return pool;
}

export function getRfmSnapshotQueryExecutor(): QueryExecutor {
  return createQueryExecutor(getPool(), config.rfmSnapshotDb.queryTimeoutMs);
}

export async function closeRfmSnapshotPool(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}
