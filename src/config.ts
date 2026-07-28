import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3010),

  // No silent defaults for host/user/password: a misconfigured deployment must fail at
  // startup, not connect with an empty credential or hide the problem behind a fallback.
  CRM_DB_HOST: z.string().min(1),
  CRM_DB_PORT: z.coerce.number().int().positive().default(3306),
  CRM_DB_USER: z.string().min(1),
  CRM_DB_PASSWORD: z.string().min(1),
  CRM_DB_NAME: z.string().min(1).default('main_management'),
  CRM_DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(5),
  CRM_DB_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),

  PRESTASHOP_DB_HOST: z.string().min(1),
  PRESTASHOP_DB_PORT: z.coerce.number().int().positive().default(3306),
  PRESTASHOP_DB_USER: z.string().min(1),
  PRESTASHOP_DB_PASSWORD: z.string().min(1),
  PRESTASHOP_DB_NAME: z.string().min(1).default('pesas_productiva'),
  // ps_ default already an existing decision (see .env.example); still validated as a
  // safe SQL identifier fragment, never trusted as-is when built into table names.
  PRESTASHOP_DB_PREFIX: z
    .string()
    .min(1)
    .regex(/^[A-Za-z0-9_]+$/, 'PRESTASHOP_DB_PREFIX must match ^[A-Za-z0-9_]+$')
    .default('ps_'),
  PRESTASHOP_DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(5),
  PRESTASHOP_DB_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

const raw = parsed.data;

export const config = {
  port: raw.PORT,
  crmDb: {
    host: raw.CRM_DB_HOST,
    port: raw.CRM_DB_PORT,
    user: raw.CRM_DB_USER,
    password: raw.CRM_DB_PASSWORD,
    database: raw.CRM_DB_NAME,
    connectionLimit: raw.CRM_DB_CONNECTION_LIMIT,
    queryTimeoutMs: raw.CRM_DB_QUERY_TIMEOUT_MS,
  },
  prestashopDb: {
    host: raw.PRESTASHOP_DB_HOST,
    port: raw.PRESTASHOP_DB_PORT,
    user: raw.PRESTASHOP_DB_USER,
    password: raw.PRESTASHOP_DB_PASSWORD,
    database: raw.PRESTASHOP_DB_NAME,
    prefix: raw.PRESTASHOP_DB_PREFIX,
    connectionLimit: raw.PRESTASHOP_DB_CONNECTION_LIMIT,
    queryTimeoutMs: raw.PRESTASHOP_DB_QUERY_TIMEOUT_MS,
  },
} as const;
