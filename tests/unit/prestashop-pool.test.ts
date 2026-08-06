import { beforeEach, describe, expect, it, vi } from 'vitest';

const createPoolMock = vi.fn(() => ({
  query: vi.fn(),
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

describe('prestashop-pool', () => {
  beforeEach(() => {
    vi.resetModules();
    createPoolMock.mockClear();
  });

  it('closePrestashopPool() does not throw and does not create a pool when never initialized', async () => {
    const { closePrestashopPool } = await import('../../src/infrastructure/prestashop/prestashop-pool.js');

    await expect(closePrestashopPool()).resolves.toBeUndefined();
    expect(createPoolMock).not.toHaveBeenCalled();
  });

  it('checkPrestashopReadiness() is ready when the required tables are compatible', async () => {
    const queryMock = vi.fn(async () => undefined);
    createPoolMock.mockReturnValue({
      query: queryMock,
      execute: vi.fn(),
      end: vi.fn(async () => undefined),
    });
    const { checkPrestashopReadiness } = await import('../../src/infrastructure/prestashop/prestashop-pool.js');

    await expect(checkPrestashopReadiness('ps_')).resolves.toEqual({ status: 'ready' });
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it('checkPrestashopReadiness() returns prestashop_schema_incompatible for schema errors', async () => {
    createPoolMock.mockReturnValue({
      query: vi.fn(async () => {
        throw { code: 'ER_BAD_FIELD_ERROR' };
      }),
      execute: vi.fn(),
      end: vi.fn(async () => undefined),
    });
    const { checkPrestashopReadiness } = await import('../../src/infrastructure/prestashop/prestashop-pool.js');

    await expect(checkPrestashopReadiness('ps_')).resolves.toEqual({
      status: 'not_ready',
      reason: 'prestashop_schema_incompatible',
    });
  });

  it('checkPrestashopReadiness() returns prestashop_unavailable for connectivity failures', async () => {
    createPoolMock.mockReturnValue({
      query: vi.fn(async () => {
        throw { code: 'ECONNREFUSED' };
      }),
      execute: vi.fn(),
      end: vi.fn(async () => undefined),
    });
    const { checkPrestashopReadiness } = await import('../../src/infrastructure/prestashop/prestashop-pool.js');

    await expect(checkPrestashopReadiness('ps_')).resolves.toEqual({
      status: 'not_ready',
      reason: 'prestashop_unavailable',
    });
  });
});
