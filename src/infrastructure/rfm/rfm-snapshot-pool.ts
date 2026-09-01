import mysql from 'mysql2/promise';
import { config } from '../../config.js';
import { createQueryExecutor, type QueryExecutor } from '../shared/query-executor.js';

let pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (!pool) {
    // Bootstrap only calls getRfmSnapshotQueryExecutor() when config.rfmSnapshotDb is
    // non-null (RFM is an optional runtime capability — see config.ts) — this guard exists
    // for type safety and to fail loudly, not as an expected runtime path.
    if (!config.rfmSnapshotDb) {
      throw new Error('RFM snapshot DB pool requested but RFM_SNAPSHOT_DB_* is not configured');
    }
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
  if (!config.rfmSnapshotDb) {
    throw new Error('RFM snapshot DB query executor requested but RFM_SNAPSHOT_DB_* is not configured');
  }
  return createQueryExecutor(getPool(), config.rfmSnapshotDb.queryTimeoutMs);
}

// A06 CLV snapshots are stored in the same service-owned local analytics schema as RFM,
// configured by RFM_SNAPSHOT_DB_*. Expose the pool seam for read-only A06 consumers without
// creating a second connection family.
export function getRfmSnapshotPool(): mysql.Pool {
  if (!config.rfmSnapshotDb) {
    throw new Error('RFM snapshot DB pool requested but RFM_SNAPSHOT_DB_* is not configured');
  }
  return getPool();
}

export async function closeRfmSnapshotPool(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = null;
    await current.end();
  }
}
