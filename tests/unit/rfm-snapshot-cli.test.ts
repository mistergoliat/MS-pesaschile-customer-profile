import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('rfm snapshot CLI', () => {
  it('requires RFM_SNAPSHOT_DB_* in real mode and does not fall back to CRM_DB_*', () => {
    const env = {
      ...process.env,
      RFM_DRY_RUN: 'false',
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
});
