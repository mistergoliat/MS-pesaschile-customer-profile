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

  // RFM is an optional runtime capability (see CP-R1-RFM-data-ownership-crm-architecture-
  // audit.md §21): the HTTP server must boot and the other five endpoints must keep working
  // even when RFM_SNAPSHOT_DB_* is entirely absent. Individually optional here; enforced
  // all-or-nothing below so a partially-set family fails fast instead of booting half-wired.
  RFM_SNAPSHOT_DB_HOST: z.string().min(1).optional(),
  RFM_SNAPSHOT_DB_PORT: z.coerce.number().int().positive().default(3306),
  RFM_SNAPSHOT_DB_USER: z.string().min(1).optional(),
  RFM_SNAPSHOT_DB_PASSWORD: z.string().min(1).optional(),
  RFM_SNAPSHOT_DB_NAME: z.string().min(1).optional(),
  RFM_SNAPSHOT_DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(5),
  RFM_SNAPSHOT_DB_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),

  // Behavioral clustering persistence (CP-R2-T02) — an independent credential family from
  // RFM_SNAPSHOT_DB_*, deliberately not reused (task Section 32: "NO reutilizar credenciales
  // PrestaShop para escribir" / own config for clustering). Optional, same all-or-nothing
  // pattern as RFM: the HTTP server boots and every other endpoint keeps working with
  // clustering absent — the cluster endpoint alone degrades to "not configured". In this
  // environment CLUSTER_DB_NAME currently points at the same physical schema as
  // RFM_SNAPSHOT_DB_NAME (`rfm_snapshot`) because that's the only schema the available local
  // MariaDB credential can write to — see migrations/005_create_customer_cluster_tables.sql
  // for the full infrastructure note. The tables are clearly namespaced
  // (`customer_cluster_*`) so the two capabilities stay logically independent even while
  // sharing a schema; pointing CLUSTER_DB_NAME at a dedicated schema later is a config change.
  CLUSTER_DB_HOST: z.string().min(1).optional(),
  CLUSTER_DB_PORT: z.coerce.number().int().positive().default(3306),
  CLUSTER_DB_USER: z.string().min(1).optional(),
  CLUSTER_DB_PASSWORD: z.string().min(1).optional(),
  CLUSTER_DB_NAME: z.string().min(1).optional(),
  CLUSTER_DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(5),
  CLUSTER_DB_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),

  // Customer Analytics Data Layer persistence (CP-R3-T01) — a third independent credential
  // family, deliberately not reusing CLUSTER_DB_* or RFM_SNAPSHOT_DB_* even though, in this
  // environment, it currently points at the same physical local MariaDB instance/schema those
  // two already use (no CREATE DATABASE privilege has been provisioned yet — see
  // migrations/008_create_customer_feature_snapshot_tables.sql for the full infrastructure
  // note, same constraint T02 documented for CLUSTER_DB_*). Same optional, all-or-nothing
  // pattern: leave every ANALYTICS_DB_* variable unset and the HTTP server still boots with
  // every existing capability unaffected — only the Data Layer itself is unavailable. Fails
  // closed (task Section 48), never silently falls back to CLUSTER_DB_*/RFM_SNAPSHOT_DB_*.
  ANALYTICS_DB_HOST: z.string().min(1).optional(),
  ANALYTICS_DB_PORT: z.coerce.number().int().positive().default(3306),
  ANALYTICS_DB_USER: z.string().min(1).optional(),
  ANALYTICS_DB_PASSWORD: z.string().min(1).optional(),
  ANALYTICS_DB_NAME: z.string().min(1).optional(),
  ANALYTICS_DB_CONNECTION_LIMIT: z.coerce.number().int().positive().default(5),
  ANALYTICS_DB_QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),

  MARKETING_COPILOT_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((value) => value === 'true' || value === '1'),
  MARKETING_COPILOT_INTERNAL_TOKEN: z.string().min(16).optional(),
  CUSTOMER_INTELLIGENCE_COPILOT_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  CUSTOMER_INTELLIGENCE_COPILOT_MAX_ACTIVE_SESSIONS: z.coerce.number().int().positive().default(100),
  CUSTOMER_INTELLIGENCE_COPILOT_MAX_TURNS: z.coerce.number().int().positive().default(20),
  CUSTOMER_INTELLIGENCE_COPILOT_CONTEXT_RECENT_TURNS: z.coerce.number().int().positive().default(6),
  CUSTOMER_INTELLIGENCE_COPILOT_SUMMARY_AFTER_TURNS: z.coerce.number().int().positive().default(12),
  CUSTOMER_INTELLIGENCE_COPILOT_MAX_STORED_RESULTS: z.coerce.number().int().positive().default(12),
  CUSTOMER_INTELLIGENCE_COPILOT_MAX_RESULT_ROWS_RETAINED: z.coerce.number().int().positive().max(1000).default(50),
  CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUESTION_CHARS: z.coerce.number().int().positive().max(4000).default(4000),
  CUSTOMER_INTELLIGENCE_COPILOT_MAX_ANSWER_CHARS: z.coerce.number().int().positive().default(8000),
  CUSTOMER_INTELLIGENCE_COPILOT_EXPORT_MAX_ROWS: z.coerce.number().int().positive().default(50000),
  CUSTOMER_INTELLIGENCE_COPILOT_EXPORT_BATCH_SIZE: z.coerce.number().int().positive().default(1000),
  CUSTOMER_INTELLIGENCE_COPILOT_UNIFIED_PLANNER_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((value) => value === 'true' || value === '1'),
  CUSTOMER_INTELLIGENCE_COPILOT_TOOL_RUNTIME_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((value) => value === 'true' || value === '1'),

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

  // How many recent orders the snapshot carries — not the customer's full order history.
  CUSTOMER_PROFILE_RECENT_ORDERS_LIMIT: z.coerce.number().int().min(1).max(50).default(10),

  // No silent default: unlike PRESTASHOP_DB_PREFIX ('ps_'), there is no prior recorded
  // decision about which ps_lang.id_lang PesasChile operates in, so guessing 1 here would
  // be a silent, unverified assumption baked into every order state translation. Must be
  // set explicitly to the operational language PesasChile actually uses in PrestaShop.
  PRESTASHOP_ORDER_STATE_LANG_ID: z.coerce.number().int().positive(),

  // Deliberately independent from PRESTASHOP_ORDER_STATE_LANG_ID (CP-R1-T06 section 8):
  // both may end up pointing at the same PrestaShop language in practice, but that is an
  // operational fact to confirm, not an assumption to bake in by reusing one variable
  // for two different catalogs. No silent default, same reasoning as above.
  PRESTASHOP_CARRIER_LANG_ID: z.coerce.number().int().positive(),
  // ps_carrier_lang is also keyed by id_shop; no prior recorded decision about which
  // shop PesasChile operates as for carrier delay text, so this must be set explicitly.
  PRESTASHOP_CARRIER_SHOP_ID: z.coerce.number().int().positive(),
}).superRefine((data, ctx) => {
  const rfmFields = {
    RFM_SNAPSHOT_DB_HOST: data.RFM_SNAPSHOT_DB_HOST,
    RFM_SNAPSHOT_DB_USER: data.RFM_SNAPSHOT_DB_USER,
    RFM_SNAPSHOT_DB_PASSWORD: data.RFM_SNAPSHOT_DB_PASSWORD,
    RFM_SNAPSHOT_DB_NAME: data.RFM_SNAPSHOT_DB_NAME,
  } as const;
  const presentCount = Object.values(rfmFields).filter((value) => value !== undefined).length;
  // All-or-nothing: either RFM is fully unconfigured (runs degraded) or fully configured.
  // A partially-set family is always a misconfiguration, never a valid intermediate state.
  if (presentCount !== 0 && presentCount !== Object.keys(rfmFields).length) {
    for (const [field, value] of Object.entries(rfmFields)) {
      if (value === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is required once any RFM_SNAPSHOT_DB_* variable is set (all-or-nothing)`,
        });
      }
    }
  }

  const clusterFields = {
    CLUSTER_DB_HOST: data.CLUSTER_DB_HOST,
    CLUSTER_DB_USER: data.CLUSTER_DB_USER,
    CLUSTER_DB_PASSWORD: data.CLUSTER_DB_PASSWORD,
    CLUSTER_DB_NAME: data.CLUSTER_DB_NAME,
  } as const;
  const clusterPresentCount = Object.values(clusterFields).filter((value) => value !== undefined).length;
  if (clusterPresentCount !== 0 && clusterPresentCount !== Object.keys(clusterFields).length) {
    for (const [field, value] of Object.entries(clusterFields)) {
      if (value === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is required once any CLUSTER_DB_* variable is set (all-or-nothing)`,
        });
      }
    }
  }

  const analyticsFields = {
    ANALYTICS_DB_HOST: data.ANALYTICS_DB_HOST,
    ANALYTICS_DB_USER: data.ANALYTICS_DB_USER,
    ANALYTICS_DB_PASSWORD: data.ANALYTICS_DB_PASSWORD,
    ANALYTICS_DB_NAME: data.ANALYTICS_DB_NAME,
  } as const;
  const analyticsPresentCount = Object.values(analyticsFields).filter((value) => value !== undefined).length;
  if (analyticsPresentCount !== 0 && analyticsPresentCount !== Object.keys(analyticsFields).length) {
    for (const [field, value] of Object.entries(analyticsFields)) {
      if (value === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is required once any ANALYTICS_DB_* variable is set (all-or-nothing)`,
        });
      }
    }
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment variables: ${parsed.error.message}`);
}

const raw = parsed.data;

export type RfmSnapshotDbConfig = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly connectionLimit: number;
  readonly queryTimeoutMs: number;
};

const rfmSnapshotDb: RfmSnapshotDbConfig | null =
  raw.RFM_SNAPSHOT_DB_HOST !== undefined &&
  raw.RFM_SNAPSHOT_DB_USER !== undefined &&
  raw.RFM_SNAPSHOT_DB_PASSWORD !== undefined &&
  raw.RFM_SNAPSHOT_DB_NAME !== undefined
    ? {
        host: raw.RFM_SNAPSHOT_DB_HOST,
        port: raw.RFM_SNAPSHOT_DB_PORT,
        user: raw.RFM_SNAPSHOT_DB_USER,
        password: raw.RFM_SNAPSHOT_DB_PASSWORD,
        database: raw.RFM_SNAPSHOT_DB_NAME,
        connectionLimit: raw.RFM_SNAPSHOT_DB_CONNECTION_LIMIT,
        queryTimeoutMs: raw.RFM_SNAPSHOT_DB_QUERY_TIMEOUT_MS,
      }
    : null;

export type ClusterDbConfig = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly connectionLimit: number;
  readonly queryTimeoutMs: number;
};

const clusterDb: ClusterDbConfig | null =
  raw.CLUSTER_DB_HOST !== undefined &&
  raw.CLUSTER_DB_USER !== undefined &&
  raw.CLUSTER_DB_PASSWORD !== undefined &&
  raw.CLUSTER_DB_NAME !== undefined
    ? {
        host: raw.CLUSTER_DB_HOST,
        port: raw.CLUSTER_DB_PORT,
        user: raw.CLUSTER_DB_USER,
        password: raw.CLUSTER_DB_PASSWORD,
        database: raw.CLUSTER_DB_NAME,
        connectionLimit: raw.CLUSTER_DB_CONNECTION_LIMIT,
        queryTimeoutMs: raw.CLUSTER_DB_QUERY_TIMEOUT_MS,
      }
    : null;

export type AnalyticsDbConfig = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly connectionLimit: number;
  readonly queryTimeoutMs: number;
};

const analyticsDb: AnalyticsDbConfig | null =
  raw.ANALYTICS_DB_HOST !== undefined &&
  raw.ANALYTICS_DB_USER !== undefined &&
  raw.ANALYTICS_DB_PASSWORD !== undefined &&
  raw.ANALYTICS_DB_NAME !== undefined
    ? {
        host: raw.ANALYTICS_DB_HOST,
        port: raw.ANALYTICS_DB_PORT,
        user: raw.ANALYTICS_DB_USER,
        password: raw.ANALYTICS_DB_PASSWORD,
        database: raw.ANALYTICS_DB_NAME,
        connectionLimit: raw.ANALYTICS_DB_CONNECTION_LIMIT,
        queryTimeoutMs: raw.ANALYTICS_DB_QUERY_TIMEOUT_MS,
      }
    : null;

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
  rfmSnapshotDb,
  clusterDb,
  analyticsDb,
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
  customerProfile: {
    recentOrdersLimit: raw.CUSTOMER_PROFILE_RECENT_ORDERS_LIMIT,
    orderStateLanguageId: raw.PRESTASHOP_ORDER_STATE_LANG_ID,
  },
  customerOrderStatus: {
    carrierLanguageId: raw.PRESTASHOP_CARRIER_LANG_ID,
    carrierShopId: raw.PRESTASHOP_CARRIER_SHOP_ID,
  },
  marketingCopilot: {
    enabled: raw.MARKETING_COPILOT_ENABLED,
    internalToken: raw.MARKETING_COPILOT_INTERNAL_TOKEN ?? null,
    unifiedPlannerEnabled: raw.CUSTOMER_INTELLIGENCE_COPILOT_UNIFIED_PLANNER_ENABLED,
    toolRuntimeEnabled: raw.CUSTOMER_INTELLIGENCE_COPILOT_TOOL_RUNTIME_ENABLED,
    session: {
      ttlMinutes: raw.CUSTOMER_INTELLIGENCE_COPILOT_SESSION_TTL_MINUTES,
      maxActiveSessions: raw.CUSTOMER_INTELLIGENCE_COPILOT_MAX_ACTIVE_SESSIONS,
      maxTurns: raw.CUSTOMER_INTELLIGENCE_COPILOT_MAX_TURNS,
      contextRecentTurns: raw.CUSTOMER_INTELLIGENCE_COPILOT_CONTEXT_RECENT_TURNS,
      summaryAfterTurns: raw.CUSTOMER_INTELLIGENCE_COPILOT_SUMMARY_AFTER_TURNS,
      maxStoredResults: raw.CUSTOMER_INTELLIGENCE_COPILOT_MAX_STORED_RESULTS,
      maxResultRowsRetained: raw.CUSTOMER_INTELLIGENCE_COPILOT_MAX_RESULT_ROWS_RETAINED,
      maxQuestionChars: raw.CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUESTION_CHARS,
      maxAnswerChars: raw.CUSTOMER_INTELLIGENCE_COPILOT_MAX_ANSWER_CHARS,
      exportMaxRows: raw.CUSTOMER_INTELLIGENCE_COPILOT_EXPORT_MAX_ROWS,
      exportBatchSize: raw.CUSTOMER_INTELLIGENCE_COPILOT_EXPORT_BATCH_SIZE,
    },
  },
} as const;
