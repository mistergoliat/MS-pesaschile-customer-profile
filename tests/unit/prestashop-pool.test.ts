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
});
