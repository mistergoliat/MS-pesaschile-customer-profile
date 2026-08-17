import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// config.ts side-effect-imports 'dotenv/config' at module load time — mocked out so these
// tests are deterministic and never depend on a developer's real, gitignored .env file.
vi.mock('dotenv/config', () => ({}));

const REQUIRED_BASE_ENV: Record<string, string> = {
  CRM_DB_HOST: 'crm-host',
  CRM_DB_USER: 'crm-user',
  CRM_DB_PASSWORD: 'crm-password',
  PRESTASHOP_DB_HOST: 'ps-host',
  PRESTASHOP_DB_USER: 'ps-user',
  PRESTASHOP_DB_PASSWORD: 'ps-password',
  PRESTASHOP_ORDER_STATE_LANG_ID: '1',
  PRESTASHOP_CARRIER_LANG_ID: '1',
  PRESTASHOP_CARRIER_SHOP_ID: '1',
};

const originalEnv = process.env;

beforeEach(() => {
  vi.resetModules();
  process.env = { ...REQUIRED_BASE_ENV };
});

afterEach(() => {
  process.env = originalEnv;
});

describe('config — RFM_SNAPSHOT_DB_* is an optional, all-or-nothing capability', () => {
  it('boots with rfmSnapshotDb: null when no RFM_SNAPSHOT_DB_* variable is set', async () => {
    const { config } = await import('../../src/config.js');

    expect(config.rfmSnapshotDb).toBeNull();
    // The rest of the server config still resolves normally alongside the null RFM slot.
    expect(config.prestashopDb.host).toBe('ps-host');
    expect(config.crmDb.host).toBe('crm-host');
  });

  it('boots with a fully-populated rfmSnapshotDb when every RFM_SNAPSHOT_DB_* variable is set', async () => {
    process.env.RFM_SNAPSHOT_DB_HOST = 'rfm-host';
    process.env.RFM_SNAPSHOT_DB_USER = 'rfm-user';
    process.env.RFM_SNAPSHOT_DB_PASSWORD = 'rfm-password';
    process.env.RFM_SNAPSHOT_DB_NAME = 'rfm_snapshot';

    const { config } = await import('../../src/config.js');

    expect(config.rfmSnapshotDb).toEqual({
      host: 'rfm-host',
      port: 3306,
      user: 'rfm-user',
      password: 'rfm-password',
      database: 'rfm_snapshot',
      connectionLimit: 5,
      queryTimeoutMs: 3000,
    });
  });

  it.each(['RFM_SNAPSHOT_DB_HOST', 'RFM_SNAPSHOT_DB_USER', 'RFM_SNAPSHOT_DB_PASSWORD', 'RFM_SNAPSHOT_DB_NAME'])(
    'fails fast when only %s is set (partial family)',
    async (onlySetVar) => {
      process.env[onlySetVar] = 'partial-value';

      await expect(import('../../src/config.js')).rejects.toThrow(/Invalid environment variables/);
    },
  );

  it('fails fast when three of the four required fields are set but one is missing', async () => {
    process.env.RFM_SNAPSHOT_DB_HOST = 'rfm-host';
    process.env.RFM_SNAPSHOT_DB_USER = 'rfm-user';
    process.env.RFM_SNAPSHOT_DB_PASSWORD = 'rfm-password';
    // RFM_SNAPSHOT_DB_NAME deliberately left unset.

    await expect(import('../../src/config.js')).rejects.toThrow(/RFM_SNAPSHOT_DB_NAME/);
  });
});
