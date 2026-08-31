import 'dotenv/config';
import { loadRfmSnapshotConnectionConfig, createRfmSnapshotPool } from '../clustering/lib/db.js';
import { createMysqlCustomerClvSnapshotStore } from '../../src/infrastructure/clv/mysql-customer-clv-snapshot-store.js';

const config = loadRfmSnapshotConnectionConfig(process.env);
if (!config) throw new Error('RFM_SNAPSHOT_DB_* local analytics configuration is required');
const pool = createRfmSnapshotPool(config);
try {
  const store = createMysqlCustomerClvSnapshotStore(pool);
  const snapshot = await store.getActiveSnapshotMetadata();
  if (!snapshot || snapshot.snapshotId === null) throw new Error('No active published CLV snapshot');
  const firstCustomerId = Number(process.argv.find((arg) => arg.startsWith('--customer-id='))?.slice('--customer-id='.length) ?? '1');
  const row = await store.getCustomerClv(snapshot.snapshotId, firstCustomerId);
  const page = await store.getRows(snapshot.snapshotId, 1, 0);
  console.log(JSON.stringify({ snapshotId: snapshot.snapshotId, status: snapshot.status, snapshotKey: snapshot.snapshotKey, populationSize: snapshot.populationSize, firstPageRow: page[0] ?? null, requestedCustomerId: firstCustomerId, requestedCustomerFound: row !== null }, null, 2));
} finally {
  await pool.end();
}
