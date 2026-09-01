import 'dotenv/config';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { loadRfmSnapshotConnectionConfig } from '../clustering/lib/db.js';

const config = loadRfmSnapshotConnectionConfig(process.env);
if (!config) throw new Error('RFM_SNAPSHOT_DB_* local analytics configuration is required');
const connection = await mysql.createConnection({ host: config.host, port: config.port, user: config.user, password: config.password, database: config.database, multipleStatements: true, timezone: 'Z' });
try {
  const [tables] = await connection.query<RowDataPacket[]>("SHOW TABLES LIKE 'customer_commercial_affinity_snapshot'");
  if (tables.length > 0) {
    console.log('Affinity migration 013 already applied');
  } else {
    await connection.query(await readFile('migrations/013_create_customer_commercial_affinity_snapshot_tables.sql', 'utf8'));
    console.log('Affinity migration 013 applied');
  }
} finally {
  await connection.end();
}
