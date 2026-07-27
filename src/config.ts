import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3010),
  CRM_DB_HOST: z.string().optional().default(''),
  CRM_DB_PORT: z.coerce.number().int().positive().default(3306),
  CRM_DB_USER: z.string().optional().default(''),
  CRM_DB_PASSWORD: z.string().optional().default(''),
  CRM_DB_NAME: z.string().default('main_management'),
  PRESTASHOP_DB_HOST: z.string().optional().default(''),
  PRESTASHOP_DB_PORT: z.coerce.number().int().positive().default(3306),
  PRESTASHOP_DB_USER: z.string().optional().default(''),
  PRESTASHOP_DB_PASSWORD: z.string().optional().default(''),
  PRESTASHOP_DB_NAME: z.string().default('pesas_productiva'),
  PRESTASHOP_DB_PREFIX: z.string().default('ps_'),
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
  },
  prestashopDb: {
    host: raw.PRESTASHOP_DB_HOST,
    port: raw.PRESTASHOP_DB_PORT,
    user: raw.PRESTASHOP_DB_USER,
    password: raw.PRESTASHOP_DB_PASSWORD,
    database: raw.PRESTASHOP_DB_NAME,
    prefix: raw.PRESTASHOP_DB_PREFIX,
  },
} as const;
