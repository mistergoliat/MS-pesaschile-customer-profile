import mysql, { type Pool } from 'mysql2/promise';
import { assessGrants } from '../../audits/order-state-semantics/lib/guardrails.js';

export type PrestashopConnectionConfig = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly prefix: string;
  readonly queryTimeoutMs: number;
};

export type RfmSnapshotConnectionConfig = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly queryTimeoutMs: number;
};

export function loadPrestashopConnectionConfig(env: NodeJS.ProcessEnv): PrestashopConnectionConfig {
  return {
    host: requiredEnv(env.PRESTASHOP_DB_HOST, 'PRESTASHOP_DB_HOST'),
    port: Number(env.PRESTASHOP_DB_PORT ?? '3306'),
    user: requiredEnv(env.PRESTASHOP_DB_USER, 'PRESTASHOP_DB_USER'),
    password: requiredEnv(env.PRESTASHOP_DB_PASSWORD, 'PRESTASHOP_DB_PASSWORD'),
    database: env.PRESTASHOP_DB_NAME?.trim() || 'pesas_productiva',
    prefix: env.PRESTASHOP_DB_PREFIX?.trim() || 'ps_',
    // Deliberately independent from PRESTASHOP_DB_QUERY_TIMEOUT_MS (3000ms, tuned for the
    // production HTTP path). This is an offline experimental script running population-scale
    // aggregate queries; a short HTTP-tuned timeout is the wrong constraint here. Override via
    // CLUSTERING_QUERY_TIMEOUT_MS if needed. Does not touch the production runtime's config.
    queryTimeoutMs: Number(env.CLUSTERING_QUERY_TIMEOUT_MS ?? '30000'),
  };
}

export function loadRfmSnapshotConnectionConfig(env: NodeJS.ProcessEnv): RfmSnapshotConnectionConfig | null {
  const host = env.RFM_SNAPSHOT_DB_HOST?.trim();
  const user = env.RFM_SNAPSHOT_DB_USER?.trim();
  const password = env.RFM_SNAPSHOT_DB_PASSWORD;
  const database = env.RFM_SNAPSHOT_DB_NAME?.trim();
  if (!host || !user || !password || !database) {
    return null;
  }
  return {
    host,
    port: Number(env.RFM_SNAPSHOT_DB_PORT ?? '3306'),
    user,
    password,
    database,
    queryTimeoutMs: Number(env.CLUSTERING_QUERY_TIMEOUT_MS ?? '30000'),
  };
}

export function createPrestashopPool(config: PrestashopConnectionConfig): Pool {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    // Q1/Q2/Q3/Q4 run concurrently via Promise.all; >=2 avoids the same
    // connectionLimit=1-deadlocks-concurrent-queries failure mode documented for the RFM
    // snapshot CLI (src/rfm-snapshot-config.ts).
    connectionLimit: 4,
    dateStrings: true,
    timezone: 'Z',
  });
}

export function createRfmSnapshotPool(config: RfmSnapshotConnectionConfig): Pool {
  return mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    connectionLimit: 2,
    dateStrings: true,
    timezone: 'Z',
  });
}

export type ReadOnlyGrantCheck = {
  readonly safe: boolean;
  readonly disallowedPrivileges: readonly string[];
  readonly hasGrantOption: boolean;
  readonly grantStatementCount: number;
};

// Fail-fast guardrail required by the task (Section 5 / Section 55): abort before any data
// query if the PrestaShop credentials carry anything beyond SELECT/USAGE. Reuses the exact,
// already-audited grant-parsing logic from the order-state-semantics audit rather than
// reimplementing it.
export async function assertPrestashopPoolIsReadOnly(pool: Pool): Promise<ReadOnlyGrantCheck> {
  const [rows] = await pool.query('SHOW GRANTS FOR CURRENT_USER()');
  const statements = (rows as Record<string, string>[]).map((row) => Object.values(row)[0] as string);
  const assessment = assessGrants(statements);
  if (!assessment.safe) {
    throw new Error(
      `PrestaShop DB credentials are not read-only: disallowedPrivileges=[${assessment.disallowedPrivileges.join(', ')}] hasGrantOption=${String(assessment.hasGrantOption)}`,
    );
  }
  return {
    safe: assessment.safe,
    disallowedPrivileges: assessment.disallowedPrivileges,
    hasGrantOption: assessment.hasGrantOption,
    grantStatementCount: statements.length,
  };
}

function requiredEnv(value: string | undefined, name: string): string {
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}
