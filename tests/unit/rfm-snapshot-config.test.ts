import { describe, expect, it } from 'vitest';
import {
  loadRfmSnapshotCliConfig,
  loadRfmSnapshotScheduledConfig,
} from '../../src/rfm-snapshot-config.js';

describe('loadRfmSnapshotCliConfig', () => {
  it('loads dry-run config with PrestaShop and CRM only, without carrier runtime variables', () => {
    const config = loadRfmSnapshotCliConfig({
      CRM_DB_HOST: 'crm-host',
      CRM_DB_PORT: '3306',
      CRM_DB_USER: 'crm-reader',
      CRM_DB_PASSWORD: 'crm-secret',
      CRM_DB_NAME: 'main_management',
      CRM_DB_QUERY_TIMEOUT_MS: '4000',
      PRESTASHOP_DB_HOST: 'localhost',
      PRESTASHOP_DB_PORT: '3306',
      PRESTASHOP_DB_USER: 'reader',
      PRESTASHOP_DB_PASSWORD: 'secret',
      PRESTASHOP_DB_NAME: 'pesas_productiva',
      PRESTASHOP_DB_PREFIX: 'ps_',
      PRESTASHOP_DB_QUERY_TIMEOUT_MS: '5000',
      RFM_DRY_RUN: 'true',
      RFM_REFERENCE_TIME: '2026-08-03T00:00:00.000Z',
      RFM_CALCULATION_VERSION: 'rfm-population-v1',
    });

    expect(config.dryRun).toBe(true);
    expect(config.referenceTime).toBe('2026-08-03T00:00:00.000Z');
    expect(config.calculationVersion).toBe('rfm-population-v1');
    expect(config.snapshotDb).toBeNull();
    expect(config.prestashopDb.queryTimeoutMs).toBe(5000);
    expect(config.crmDb.queryTimeoutMs).toBe(4000);
  });

  it('requires snapshot persistence variables only outside dry-run', () => {
    expect(() =>
      loadRfmSnapshotCliConfig({
        CRM_DB_HOST: 'crm-host',
        CRM_DB_PORT: '3306',
        CRM_DB_USER: 'crm-reader',
        CRM_DB_PASSWORD: 'crm-secret',
        CRM_DB_NAME: 'main_management',
        CRM_DB_QUERY_TIMEOUT_MS: '4000',
        PRESTASHOP_DB_HOST: 'localhost',
        PRESTASHOP_DB_PORT: '3306',
        PRESTASHOP_DB_USER: 'reader',
        PRESTASHOP_DB_PASSWORD: 'secret',
        PRESTASHOP_DB_NAME: 'pesas_productiva',
        PRESTASHOP_DB_PREFIX: 'ps_',
        PRESTASHOP_DB_QUERY_TIMEOUT_MS: '5000',
        RFM_DRY_RUN: 'false',
        RFM_REFERENCE_TIME: '2026-08-03T00:00:00.000Z',
        RFM_CALCULATION_VERSION: 'rfm-population-v1',
      }),
    ).toThrow('RFM_SNAPSHOT_DB_HOST is required');
  });

  it('requires CRM config because canonical identity wiring is part of the snapshot pipeline', () => {
    expect(() =>
      loadRfmSnapshotCliConfig({
        CRM_DB_HOST: '',
        CRM_DB_PORT: '3306',
        CRM_DB_USER: '',
        CRM_DB_PASSWORD: '',
        CRM_DB_NAME: 'main_management',
        CRM_DB_QUERY_TIMEOUT_MS: '4000',
        PRESTASHOP_DB_HOST: 'localhost',
        PRESTASHOP_DB_PORT: '3306',
        PRESTASHOP_DB_USER: 'reader',
        PRESTASHOP_DB_PASSWORD: 'secret',
        PRESTASHOP_DB_NAME: 'pesas_productiva',
        PRESTASHOP_DB_PREFIX: 'ps_',
        PRESTASHOP_DB_QUERY_TIMEOUT_MS: '5000',
        RFM_DRY_RUN: 'true',
        RFM_REFERENCE_TIME: '2026-08-03T00:00:00.000Z',
        RFM_CALCULATION_VERSION: 'rfm-population-v1',
      }),
    ).toThrow(/CRM_DB_HOST|CRM_DB_USER|CRM_DB_PASSWORD/);
  });

  it('loads scheduled execution config without requiring a manual referenceTime override', () => {
    const config = loadRfmSnapshotScheduledConfig({
      CRM_DB_HOST: 'crm-host',
      CRM_DB_PORT: '3306',
      CRM_DB_USER: 'crm-reader',
      CRM_DB_PASSWORD: 'crm-secret',
      CRM_DB_NAME: 'main_management',
      CRM_DB_QUERY_TIMEOUT_MS: '4000',
      PRESTASHOP_DB_HOST: 'localhost',
      PRESTASHOP_DB_PORT: '3306',
      PRESTASHOP_DB_USER: 'reader',
      PRESTASHOP_DB_PASSWORD: 'secret',
      PRESTASHOP_DB_NAME: 'pesas_productiva',
      PRESTASHOP_DB_PREFIX: 'ps_',
      PRESTASHOP_DB_QUERY_TIMEOUT_MS: '5000',
      RFM_CALCULATION_VERSION: 'rfm-population-v1',
      RFM_SNAPSHOT_DB_HOST: 'snapshot-host',
      RFM_SNAPSHOT_DB_PORT: '3306',
      RFM_SNAPSHOT_DB_USER: 'snapshot-user',
      RFM_SNAPSHOT_DB_PASSWORD: 'snapshot-secret',
      RFM_SNAPSHOT_DB_NAME: 'customer_profile',
      RFM_SNAPSHOT_DB_CONNECTION_LIMIT: '2',
    });

    expect(config.calculationVersion).toBe('rfm-population-v1');
    expect(config.snapshotDb).toMatchObject({
      host: 'snapshot-host',
      connectionLimit: 2,
    });
  });

  // CP-R1-TRACK-A-A3B: connectionLimit=1 deadlocks forever on the first run-log write —
  // tryAcquireExecutionLock() holds the pool's only connection for the whole run, so
  // createRun()'s own pool.execute() can never get a connection. Confirmed directly against
  // a real DB, not theoretical. This locks in the safe default so it can't silently regress.
  it('defaults connectionLimit to a value that cannot deadlock the execution lock + run log', () => {
    const config = loadRfmSnapshotScheduledConfig({
      CRM_DB_HOST: 'crm-host',
      CRM_DB_PORT: '3306',
      CRM_DB_USER: 'crm-reader',
      CRM_DB_PASSWORD: 'crm-secret',
      CRM_DB_NAME: 'main_management',
      CRM_DB_QUERY_TIMEOUT_MS: '4000',
      PRESTASHOP_DB_HOST: 'localhost',
      PRESTASHOP_DB_PORT: '3306',
      PRESTASHOP_DB_USER: 'reader',
      PRESTASHOP_DB_PASSWORD: 'secret',
      PRESTASHOP_DB_NAME: 'pesas_productiva',
      PRESTASHOP_DB_PREFIX: 'ps_',
      PRESTASHOP_DB_QUERY_TIMEOUT_MS: '5000',
      RFM_CALCULATION_VERSION: 'rfm-population-v1',
      RFM_SNAPSHOT_DB_HOST: 'snapshot-host',
      RFM_SNAPSHOT_DB_PORT: '3306',
      RFM_SNAPSHOT_DB_USER: 'snapshot-user',
      RFM_SNAPSHOT_DB_PASSWORD: 'snapshot-secret',
      RFM_SNAPSHOT_DB_NAME: 'customer_profile',
      // RFM_SNAPSHOT_DB_CONNECTION_LIMIT deliberately omitted.
    });

    expect(config.snapshotDb?.connectionLimit).toBeGreaterThanOrEqual(2);
  });
});
