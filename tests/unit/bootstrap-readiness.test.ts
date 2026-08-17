import { beforeEach, describe, expect, it, vi } from 'vitest';

// bootstrap() is the composition root: constructing it wires every reader/repository via
// factory functions that just close over an executor (no I/O at construction time), so a
// dummy executor is enough — only the two readiness probes below actually run.
const dummyExecutor = { query: vi.fn(), execute: vi.fn() };

const checkPrestashopReadinessMock = vi.fn();
const checkCrmReadinessMock = vi.fn();
// Kept mocked (and always resolving true) so this file can also run against the pre-fix
// bootstrap.ts, where the `crm` slot called this instead of checkCrmReadiness(): with this
// wired, that old code produces a genuine wrong *value* (crm mirrors this, not CRM's own
// health) rather than crashing on a missing mock — a real regression signal, not a fixture gap.
const pingPrestashopMock = vi.fn(async () => true);

vi.mock('../../src/config.js', () => ({
  config: {
    prestashopDb: { prefix: 'ps_' },
    customerProfile: { recentOrdersLimit: 10, orderStateLanguageId: 1 },
    customerOrderStatus: { carrierLanguageId: 1, carrierShopId: 1 },
  },
}));

vi.mock('../../src/infrastructure/prestashop/prestashop-pool.js', () => ({
  checkPrestashopReadiness: checkPrestashopReadinessMock,
  closePrestashopPool: vi.fn(async () => undefined),
  getPrestashopQueryExecutor: vi.fn(() => dummyExecutor),
  pingPrestashop: pingPrestashopMock,
}));

vi.mock('../../src/infrastructure/crm/index.js', () => ({
  checkCrmReadiness: checkCrmReadinessMock,
  closeCrmPool: vi.fn(async () => undefined),
  createMysqlMasterCustomerReader: vi.fn(() => ({})),
  getCrmQueryExecutor: vi.fn(() => dummyExecutor),
}));

vi.mock('../../src/infrastructure/rfm/rfm-snapshot-pool.js', () => ({
  closeRfmSnapshotPool: vi.fn(async () => undefined),
  getRfmSnapshotQueryExecutor: vi.fn(() => dummyExecutor),
}));

describe('bootstrap().checkReadiness', () => {
  beforeEach(() => {
    vi.resetModules();
    checkPrestashopReadinessMock.mockReset();
    checkCrmReadinessMock.mockReset();
  });

  it('reports prestashop=true, crm=true when both dependencies are healthy', async () => {
    checkPrestashopReadinessMock.mockResolvedValueOnce({ status: 'ready' });
    checkCrmReadinessMock.mockResolvedValueOnce({ status: 'ready' });
    const { bootstrap } = await import('../../src/bootstrap.js');

    await expect(bootstrap().checkReadiness()).resolves.toEqual({
      prestashop: { status: 'ready' },
      crm: true,
    });
  });

  // TD-001 regression: checkReadiness() used to source `crm` from a second PrestaShop ping
  // instead of the real CRM probe, so it always mirrored `prestashop` and never reflected
  // an actual CRM outage. This asserts the `crm` field is genuinely wired to checkCrmReadiness().
  it('reports crm=false when PrestaShop is up but CRM is down, without flipping overall readiness', async () => {
    checkPrestashopReadinessMock.mockResolvedValueOnce({ status: 'ready' });
    checkCrmReadinessMock.mockResolvedValueOnce({ status: 'not_ready', reason: 'crm_unavailable' });
    const { bootstrap } = await import('../../src/bootstrap.js');

    const readiness = await bootstrap().checkReadiness();

    expect(readiness.prestashop).toEqual({ status: 'ready' });
    expect(readiness.crm).toBe(false);
  });

  // Proves the two signals are independent in the other direction too: a PrestaShop outage
  // must not be masked or mirrored by CRM's (unrelated) health.
  it('reports crm=true when CRM is up but PrestaShop is down', async () => {
    checkPrestashopReadinessMock.mockResolvedValueOnce({ status: 'not_ready', reason: 'prestashop_unavailable' });
    checkCrmReadinessMock.mockResolvedValueOnce({ status: 'ready' });
    const { bootstrap } = await import('../../src/bootstrap.js');

    const readiness = await bootstrap().checkReadiness();

    expect(readiness.prestashop).toEqual({ status: 'not_ready', reason: 'prestashop_unavailable' });
    expect(readiness.crm).toBe(true);
  });

  it('reports crm=false when the CRM probe itself throws', async () => {
    checkPrestashopReadinessMock.mockResolvedValueOnce({ status: 'ready' });
    checkCrmReadinessMock.mockRejectedValueOnce(new Error('unexpected'));
    const { bootstrap } = await import('../../src/bootstrap.js');

    await expect(bootstrap().checkReadiness()).resolves.toEqual({
      prestashop: { status: 'ready' },
      crm: false,
    });
  });
});
