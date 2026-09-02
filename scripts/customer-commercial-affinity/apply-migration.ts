import 'dotenv/config';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { loadRfmSnapshotConnectionConfig } from '../clustering/lib/db.js';

const config = loadRfmSnapshotConnectionConfig(process.env);
if (!config) throw new Error('RFM_SNAPSHOT_DB_* local analytics configuration is required');
const connection = await mysql.createConnection({ host: config.host, port: config.port, user: config.user, password: config.password, database: config.database, multipleStatements: true, timezone: 'Z' });
try {
  const [tables] = await connection.query<RowDataPacket[]>("SHOW TABLES LIKE 'customer_commercial_affinity_snapshot'");
  if (tables.length === 0) {
    await connection.query(await readFile('migrations/013_create_customer_commercial_affinity_snapshot_tables.sql', 'utf8'));
    console.log('Affinity migration 013 applied');
  } else {
    console.log('Affinity migration 013 already applied');
  }

  const [columns] = await connection.query<RowDataPacket[]>("SHOW COLUMNS FROM customer_commercial_affinity_snapshot LIKE 'eligible_population_checksum'");
  const [populationTables] = await connection.query<RowDataPacket[]>("SHOW TABLES LIKE 'customer_commercial_affinity_snapshot_population'");
  if (columns.length === 0 && populationTables.length === 0) {
    await connection.query(await readFile('migrations/014_add_customer_commercial_affinity_snapshot_population.sql', 'utf8'));
    console.log('Affinity migration 014 applied');
  } else if (columns.length > 0 && populationTables.length > 0) {
    console.log('Affinity migration 014 already applied');
  } else {
    throw new Error('Affinity migration 014 is partially applied; inspect the analytics schema before continuing');
  }
} finally {
  await connection.end();
}
