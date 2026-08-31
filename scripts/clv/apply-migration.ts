import 'dotenv/config';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { loadRfmSnapshotConnectionConfig } from '../clustering/lib/db.js';

const connectionConfig = loadRfmSnapshotConnectionConfig(process.env);
if (!connectionConfig) throw new Error('RFM_SNAPSHOT_DB_* local analytics configuration is required');
const mysqlConfig = {
  host: connectionConfig.host,
  port: connectionConfig.port,
  user: connectionConfig.user,
  password: connectionConfig.password,
  database: connectionConfig.database,
};

const connection = await mysql.createConnection({
  ...mysqlConfig,
  multipleStatements: true,
  timezone: 'Z',
});
try {
  const [tables] = await connection.query<RowDataPacket[]>("SHOW TABLES LIKE 'customer_clv_snapshot'");
  if (tables.length > 0) {
    console.log('CLV migration 012 already applied');
  } else {
    await connection.query(await readFile('migrations/012_create_customer_clv_snapshot_tables.sql', 'utf8'));
    console.log('CLV migration 012 applied');
  }
} finally {
  await connection.end();
}
