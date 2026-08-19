// CP-R2-T02 — validates a Python-produced model artifact and, with --persist, registers it in
// the local cluster model registry (task Section 30's "load/train approved model" step).
//
// Usage:
//   npx tsx scripts/clustering/register-model.ts [--artifact=path] [--persist]
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { registerClusterModel } from '../../src/application/customer-clustering/register-cluster-model.js';
import { createMysqlClusterModelRepository } from '../../src/infrastructure/clustering/mysql-cluster-model-repository.js';
import { createMysqlClusterInterpretationRepository } from '../../src/infrastructure/clustering/mysql-cluster-interpretation-repository.js';
import { config } from '../../src/config.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ARTIFACT_PATH = path.join(SCRIPT_DIR, 'outputs', 'model-artifact.json');

async function main(): Promise<void> {
  const artifactArg = process.argv.find((arg) => arg.startsWith('--artifact='))?.split('=')[1];
  const persist = process.argv.includes('--persist');
  const artifactPath = artifactArg ?? DEFAULT_ARTIFACT_PATH;

  console.info(`[register-model] reading artifact from ${artifactPath}`);
  const rawArtifact = JSON.parse(await readFile(artifactPath, 'utf8'));

  if (!persist) {
    const result = await registerClusterModel({ rawArtifact, persist: false }, {});
    console.info(JSON.stringify(result, null, 2));
    console.info('[register-model] validated only (pass --persist to write to the model registry)');
    return;
  }

  // Uses config.ts (env-driven) rather than an ad-hoc pool builder — config.clusterDb is the
  // exact same config the HTTP server itself resolves from (never PrestaShop credentials).
  if (!config.clusterDb) {
    throw new Error('CLUSTER_DB_* is not configured — cannot persist (see .env.example)');
  }
  const pool = mysql.createPool({
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

  try {
    const modelRepository = createMysqlClusterModelRepository(pool);
    const interpretationRepository = createMysqlClusterInterpretationRepository(pool);
    const result = await registerClusterModel({ rawArtifact, persist: true }, { modelRepository, interpretationRepository });
    console.info(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[register-model] FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
