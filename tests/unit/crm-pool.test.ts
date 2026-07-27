import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const createPoolMock = vi.fn(() => ({
  query: queryMock,
  execute: vi.fn(),
  end: vi.fn(async () => undefined),
}));

vi.mock('mysql2/promise', () => ({
  default: { createPool: createPoolMock },
}));

vi.mock('../../src/config.js', () => ({
  config: {
    port: 3010,
    crmDb: {
      host: 'crm-host',
      port: 3306,
      user: 'crm-user',
      password: 'crm-pass',
      database: 'main_management',
      connectionLimit: 5,
      queryTimeoutMs: 3000,
    },
    prestashopDb: {
      host: 'ps-host',
      port: 3306,
      user: 'ps-user',
      password: 'ps-pass',
      database: 'pesas_productiva',
      prefix: 'ps_',
      connectionLimit: 5,
      queryTimeoutMs: 3000,
    },
  },
}));

describe('crm-pool', () => {
  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
    createPoolMock.mockClear();
  });

  it('closeCrmPool() does not throw and does not create a pool when never initialized', async () => {
    const { closeCrmPool } = await import('../../src/infrastructure/crm/crm-pool.js');

    await expect(closeCrmPool()).resolves.toBeUndefined();
    expect(createPoolMock).not.toHaveBeenCalled();
  });

  it('is ready when the connectivity + schema probe succeeds, using a LIMIT 0 probe', async () => {
    queryMock.mockResolvedValueOnce([[], []]);
    const { checkCrmReadiness } = await import('../../src/infrastructure/crm/crm-pool.js');

    await expect(checkCrmReadiness()).resolves.toEqual({ status: 'ready' });
    const [sql] = queryMock.mock.calls[0] as [string];
    expect(sql).toContain('prestashop_customer_id');
    expect(sql).toContain('LIMIT 0');
  });

  it('is not_ready / crm_schema_incompatible on ER_BAD_FIELD_ERROR', async () => {
    queryMock.mockRejectedValueOnce(Object.assign(new Error('Unknown column'), { code: 'ER_BAD_FIELD_ERROR' }));
    const { checkCrmReadiness } = await import('../../src/infrastructure/crm/crm-pool.js');

    await expect(checkCrmReadiness()).resolves.toEqual({ status: 'not_ready', reason: 'crm_schema_incompatible' });
  });

  it('is not_ready / crm_schema_incompatible on ER_NO_SUCH_TABLE', async () => {
    queryMock.mockRejectedValueOnce(Object.assign(new Error('no such table'), { code: 'ER_NO_SUCH_TABLE' }));
    const { checkCrmReadiness } = await import('../../src/infrastructure/crm/crm-pool.js');

    await expect(checkCrmReadiness()).resolves.toEqual({ status: 'not_ready', reason: 'crm_schema_incompatible' });
  });

  it('is not_ready / crm_unavailable on ECONNREFUSED, without leaking the driver message', async () => {
    queryMock.mockRejectedValueOnce(
      Object.assign(new Error('connect ECONNREFUSED crm-host:3306'), { code: 'ECONNREFUSED' }),
    );
    const { checkCrmReadiness } = await import('../../src/infrastructure/crm/crm-pool.js');

    await expect(checkCrmReadiness()).resolves.toEqual({ status: 'not_ready', reason: 'crm_unavailable' });
  });

  it('is not_ready / crm_timeout on ETIMEDOUT', async () => {
    queryMock.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    const { checkCrmReadiness } = await import('../../src/infrastructure/crm/crm-pool.js');

    await expect(checkCrmReadiness()).resolves.toEqual({ status: 'not_ready', reason: 'crm_timeout' });
  });
});
