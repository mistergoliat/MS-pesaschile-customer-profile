import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('rfm snapshot CLI', () => {
  it('requires RFM_SNAPSHOT_DB_* in real mode once CRM and PrestaShop config are present', () => {
    const env = {
      ...process.env,
      CRM_DB_HOST: 'crm-host',
      CRM_DB_PORT: '3306',
      CRM_DB_USER: 'crm-reader',
      CRM_DB_PASSWORD: 'crm-secret',
      CRM_DB_NAME: 'main_management',
      CRM_DB_QUERY_TIMEOUT_MS: '3000',
      PRESTASHOP_CARRIER_LANG_ID: '',
      PRESTASHOP_CARRIER_SHOP_ID: '',
      RFM_DRY_RUN: 'false',
      PRESTASHOP_DB_HOST: 'localhost',
      PRESTASHOP_DB_PORT: '3306',
      PRESTASHOP_DB_USER: 'reader',
      PRESTASHOP_DB_PASSWORD: 'secret',
      PRESTASHOP_DB_NAME: 'pesas_productiva',
      PRESTASHOP_DB_PREFIX: 'ps_',
      PRESTASHOP_DB_QUERY_TIMEOUT_MS: '3000',
      RFM_REFERENCE_TIME: '2026-08-03T00:00:00.000Z',
      RFM_CALCULATION_VERSION: 'rfm-population-v1',
      RFM_SNAPSHOT_DB_HOST: '',
      RFM_SNAPSHOT_DB_PORT: '',
      RFM_SNAPSHOT_DB_USER: '',
      RFM_SNAPSHOT_DB_PASSWORD: '',
      RFM_SNAPSHOT_DB_NAME: '',
      RFM_SNAPSHOT_DB_CONNECTION_LIMIT: '',
    };

    const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const result = spawnSync(process.execPath, [tsxCli, 'scripts/snapshots/rfm-snapshot.ts'], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
      timeout: 20_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('RFM_SNAPSHOT_DB_HOST is required');
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(String(process.env.CRM_DB_PASSWORD ?? 'not-a-real-secret'));
  }, 30_000);

  it('fails on missing CRM config before external access, without requiring carrier/order-state vars', () => {
    const env = {
      ...process.env,
      CRM_DB_HOST: '',
      CRM_DB_USER: '',
      CRM_DB_PASSWORD: '',
      CRM_DB_NAME: 'main_management',
      CRM_DB_QUERY_TIMEOUT_MS: '3000',
      PRESTASHOP_CARRIER_LANG_ID: '',
      PRESTASHOP_CARRIER_SHOP_ID: '',
      RFM_DRY_RUN: 'true',
      PRESTASHOP_DB_HOST: 'localhost',
      PRESTASHOP_DB_PORT: '3306',
      PRESTASHOP_DB_USER: 'reader',
      PRESTASHOP_DB_PASSWORD: 'secret',
      PRESTASHOP_DB_NAME: 'pesas_productiva',
      PRESTASHOP_DB_PREFIX: 'ps_',
      PRESTASHOP_DB_QUERY_TIMEOUT_MS: '3000',
      RFM_REFERENCE_TIME: '2026-08-03T00:00:00.000Z',
      RFM_CALCULATION_VERSION: 'rfm-population-v1',
    };

    const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const result = spawnSync(process.execPath, [tsxCli, 'scripts/snapshots/rfm-snapshot.ts'], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
      timeout: 20_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('CRM_DB_HOST');
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('PRESTASHOP_CARRIER_LANG_ID');
  }, 30_000);

  it('scheduled worker does not require a manual RFM_REFERENCE_TIME override', () => {
    const env = {
      ...process.env,
      CRM_DB_HOST: 'crm-host',
      CRM_DB_PORT: '3306',
      CRM_DB_USER: 'crm-reader',
      CRM_DB_PASSWORD: 'crm-secret',
      CRM_DB_NAME: 'main_management',
      CRM_DB_QUERY_TIMEOUT_MS: '3000',
      PRESTASHOP_CARRIER_LANG_ID: '',
      PRESTASHOP_CARRIER_SHOP_ID: '',
      PRESTASHOP_DB_HOST: 'localhost',
      PRESTASHOP_DB_PORT: '3306',
      PRESTASHOP_DB_USER: 'reader',
      PRESTASHOP_DB_PASSWORD: 'secret',
      PRESTASHOP_DB_NAME: 'pesas_productiva',
      PRESTASHOP_DB_PREFIX: 'ps_',
      PRESTASHOP_DB_QUERY_TIMEOUT_MS: '3000',
      RFM_CALCULATION_VERSION: 'rfm-population-v1',
      RFM_REFERENCE_TIME: '',
      RFM_SNAPSHOT_DB_HOST: '',
      RFM_SNAPSHOT_DB_PORT: '',
      RFM_SNAPSHOT_DB_USER: '',
      RFM_SNAPSHOT_DB_PASSWORD: '',
      RFM_SNAPSHOT_DB_NAME: '',
      RFM_SNAPSHOT_DB_CONNECTION_LIMIT: '',
    };

    const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const result = spawnSync(process.execPath, [tsxCli, 'scripts/snapshots/rfm-snapshot-scheduled.ts'], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
      timeout: 20_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('RFM_SNAPSHOT_DB_HOST is required');
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('RFM_REFERENCE_TIME');
  }, 30_000);
});
