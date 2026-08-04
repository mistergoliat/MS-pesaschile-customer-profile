import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { createRfmSnapshot } from '../../src/application/customer-rfm/create-rfm-snapshot.js';
import { config } from '../../src/config.js';
import { stableStringify } from '../../src/domain/customer-rfm/index.js';
import { createMysqlRfmSnapshotRepository } from '../../src/infrastructure/rfm/mysql-rfm-snapshot-repository.js';
import { createQueryExecutor } from '../../src/infrastructure/shared/query-executor.js';
import { createMysqlRfmPopulationReader } from '../../src/infrastructure/prestashop/mysql-rfm-population-reader.js';

const dryRun = process.env.RFM_DRY_RUN === 'true';
const referenceTime = requiredEnv('RFM_REFERENCE_TIME');
const calculationVersion = requiredEnv('RFM_CALCULATION_VERSION');
const generatedAt = new Date().toISOString();

const prestashopPool = mysql.createPool({
  host: config.prestashopDb.host,
  port: config.prestashopDb.port,
  user: config.prestashopDb.user,
  password: config.prestashopDb.password,
  database: config.prestashopDb.database,
  connectionLimit: 1,
  dateStrings: true,
  timezone: 'Z',
});

const snapshotPool = dryRun
  ? null
  : mysql.createPool({
      host: requiredEnv('RFM_SNAPSHOT_DB_HOST'),
      port: Number(process.env.RFM_SNAPSHOT_DB_PORT || 3306),
      user: requiredEnv('RFM_SNAPSHOT_DB_USER'),
      password: requiredEnv('RFM_SNAPSHOT_DB_PASSWORD'),
      database: requiredEnv('RFM_SNAPSHOT_DB_NAME'),
      connectionLimit: Number(process.env.RFM_SNAPSHOT_DB_CONNECTION_LIMIT || 1),
      supportBigNumbers: true,
      bigNumberStrings: true,
      timezone: 'Z',
    });

try {
  const result = await createRfmSnapshot(
    {
      referenceTime,
      calculationVersion,
      generatedAt,
      dryRun,
    },
    {
      reader: createMysqlRfmPopulationReader(
        createQueryExecutor(prestashopPool, config.prestashopDb.queryTimeoutMs),
        config.prestashopDb.prefix,
      ),
      repository: snapshotPool ? createMysqlRfmSnapshotRepository(snapshotPool) : undefined,
    },
  );

  const output = {
    mode: result.mode,
    snapshotKey: result.snapshotKey,
    snapshotId: result.snapshotId,
    manifest: result.manifest,
  };
  await writeDryRunOutput(output);
  console.info(stableStringify(output));
} finally {
  await prestashopPool.end();
  if (snapshotPool) {
    await snapshotPool.end();
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function writeDryRunOutput(output: unknown): Promise<void> {
  if (!dryRun) return;
  const outputDir = path.resolve('scripts/snapshots/rfm/outputs');
  await mkdir(outputDir, { recursive: true });
  const fileName = `rfm-snapshot-${referenceTime.replace(/[:.]/g, '-')}-${calculationVersion}.json`;
  await writeFile(path.join(outputDir, fileName), `${stableStringify(output)}\n`, 'utf8');
}
