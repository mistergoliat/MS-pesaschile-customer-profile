import 'dotenv/config';
import { z } from 'zod';

const emptyStringToUndefined = (value: unknown): unknown => {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
};

const baseSnapshotEnvSchema = z.object({
  PRESTASHOP_DB_HOST: z.string().min(1),
  PRESTASHOP_DB_PORT: z.coerce.number().int().positive().default(3306),
  PRESTASHOP_DB_USER: z.string().min(1),
  PRESTASHOP_DB_PASSWORD: z.string().min(1),
  PRESTASHOP_DB_NAME: z.string().min(1).default('pesas_productiva'),
  PRESTASHOP_DB_PREFIX: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9_]+$/, 'PRESTASHOP_DB_PREFIX must match ^[A-Za-z0-9_]+$')
    .default('ps_'),
  PRESTASHOP_DB_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  CRM_DB_HOST: z.string().min(1),
  CRM_DB_PORT: z.coerce.number().int().positive().default(3306),
  CRM_DB_USER: z.string().min(1),
  CRM_DB_PASSWORD: z.string().min(1),
  CRM_DB_NAME: z.string().min(1).default('main_management'),
  CRM_DB_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  RFM_CALCULATION_VERSION: z.string().min(1),
  RFM_SNAPSHOT_DB_HOST: z.string().optional(),
  RFM_SNAPSHOT_DB_PORT: z.preprocess(emptyStringToUndefined, z.coerce.number().int().positive().optional()),
  RFM_SNAPSHOT_DB_USER: z.string().optional(),
  RFM_SNAPSHOT_DB_PASSWORD: z.string().optional(),
  RFM_SNAPSHOT_DB_NAME: z.string().optional(),
  RFM_SNAPSHOT_DB_CONNECTION_LIMIT: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
});

type SnapshotDbConfig = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly connectionLimit: number;
};

type CrmDbConfig = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly queryTimeoutMs: number;
};

type PrestashopDbConfig = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly prefix: string;
  readonly queryTimeoutMs: number;
};

type RfmSnapshotExecutionConfig = {
  readonly calculationVersion: string;
  readonly prestashopDb: PrestashopDbConfig;
  readonly crmDb: CrmDbConfig;
  readonly snapshotDb: SnapshotDbConfig | null;
};

export type RfmSnapshotCliConfig = RfmSnapshotExecutionConfig & {
  readonly dryRun: boolean;
  readonly referenceTime: string;
};

export type RfmSnapshotScheduledConfig = RfmSnapshotExecutionConfig;

export function loadRfmSnapshotCliConfig(env: NodeJS.ProcessEnv = process.env): RfmSnapshotCliConfig {
  const parsed = baseSnapshotEnvSchema
    .extend({
      RFM_DRY_RUN: z.string().optional(),
      RFM_REFERENCE_TIME: z.string().min(1),
    })
    .safeParse(env);

  if (!parsed.success) {
    throw new Error(`Invalid RFM snapshot environment variables: ${parsed.error.message}`);
  }

  const raw = parsed.data;
  const dryRun = raw.RFM_DRY_RUN === 'true';

  return {
    dryRun,
    referenceTime: raw.RFM_REFERENCE_TIME,
    ...buildExecutionConfig(raw, dryRun),
  };
}

export function loadRfmSnapshotScheduledConfig(env: NodeJS.ProcessEnv = process.env): RfmSnapshotScheduledConfig {
  const parsed = baseSnapshotEnvSchema.safeParse(env);

  if (!parsed.success) {
    throw new Error(`Invalid RFM snapshot environment variables: ${parsed.error.message}`);
  }

  return buildExecutionConfig(parsed.data, false);
}

function buildExecutionConfig(
  raw: z.infer<typeof baseSnapshotEnvSchema>,
  dryRun: boolean,
): RfmSnapshotExecutionConfig {
  return {
    calculationVersion: raw.RFM_CALCULATION_VERSION,
    prestashopDb: {
      host: raw.PRESTASHOP_DB_HOST,
      port: raw.PRESTASHOP_DB_PORT,
      user: raw.PRESTASHOP_DB_USER,
      password: raw.PRESTASHOP_DB_PASSWORD,
      database: raw.PRESTASHOP_DB_NAME,
      prefix: raw.PRESTASHOP_DB_PREFIX,
      queryTimeoutMs: raw.PRESTASHOP_DB_QUERY_TIMEOUT_MS,
    },
    crmDb: {
      host: raw.CRM_DB_HOST,
      port: raw.CRM_DB_PORT,
      user: raw.CRM_DB_USER,
      password: raw.CRM_DB_PASSWORD,
      database: raw.CRM_DB_NAME,
      queryTimeoutMs: raw.CRM_DB_QUERY_TIMEOUT_MS,
    },
    snapshotDb: dryRun
      ? null
      : {
          host: requiredEnv(raw.RFM_SNAPSHOT_DB_HOST, 'RFM_SNAPSHOT_DB_HOST'),
          port: raw.RFM_SNAPSHOT_DB_PORT ?? 3306,
          user: requiredEnv(raw.RFM_SNAPSHOT_DB_USER, 'RFM_SNAPSHOT_DB_USER'),
          password: requiredEnv(raw.RFM_SNAPSHOT_DB_PASSWORD, 'RFM_SNAPSHOT_DB_PASSWORD'),
          database: requiredEnv(raw.RFM_SNAPSHOT_DB_NAME, 'RFM_SNAPSHOT_DB_NAME'),
          connectionLimit: raw.RFM_SNAPSHOT_DB_CONNECTION_LIMIT ?? 1,
        },
  };
}

function requiredEnv(value: string | undefined, name: string): string {
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value;
}
