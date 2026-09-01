import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same rationale as bootstrap-readiness.test.ts: bootstrap() only wires factories over a
// dummy executor at construction time — no I/O happens until a query actually runs.
const dummyExecutor = { query: vi.fn(), execute: vi.fn() };

const getRfmSnapshotQueryExecutorMock = vi.fn(() => dummyExecutor);
const createMysqlRfmSnapshotReaderMock = vi.fn();

let rfmSnapshotDbConfig: unknown = null;

vi.mock('../../src/config.js', () => ({
  get config() {
    return {
      prestashopDb: { prefix: 'ps_' },
      customerProfile: { recentOrdersLimit: 10, orderStateLanguageId: 1 },
      customerOrderStatus: { carrierLanguageId: 1, carrierShopId: 1 },
      get rfmSnapshotDb() {
        return rfmSnapshotDbConfig;
      },
    };
  },
}));

vi.mock('../../src/infrastructure/prestashop/prestashop-pool.js', () => ({
  checkPrestashopReadiness: vi.fn(async () => ({ status: 'ready' })),
  closePrestashopPool: vi.fn(async () => undefined),
  getPrestashopQueryExecutor: vi.fn(() => dummyExecutor),
  pingPrestashop: vi.fn(async () => true),
}));

vi.mock('../../src/infrastructure/crm/index.js', () => ({
  checkCrmReadiness: vi.fn(async () => ({ status: 'ready' })),
  closeCrmPool: vi.fn(async () => undefined),
  createMysqlMasterCustomerReader: vi.fn(() => ({ findById: vi.fn() })),
  getCrmQueryExecutor: vi.fn(() => dummyExecutor),
}));

vi.mock('../../src/infrastructure/rfm/rfm-snapshot-pool.js', () => ({
  closeRfmSnapshotPool: vi.fn(async () => undefined),
  getRfmSnapshotPool: vi.fn(() => dummyExecutor),
  getRfmSnapshotQueryExecutor: getRfmSnapshotQueryExecutorMock,
}));

vi.mock('../../src/infrastructure/rfm/mysql-rfm-snapshot-reader.js', () => ({
  createMysqlRfmSnapshotReader: createMysqlRfmSnapshotReaderMock,
}));

describe('bootstrap() — RFM optional wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    getRfmSnapshotQueryExecutorMock.mockClear();
    createMysqlRfmSnapshotReaderMock.mockReset();
    rfmSnapshotDbConfig = null;
  });

  it('never creates an RFM pool/reader when RFM_SNAPSHOT_DB_* is unconfigured', async () => {
    rfmSnapshotDbConfig = null;
    const { bootstrap } = await import('../../src/bootstrap.js');

    const app = bootstrap();

    expect(getRfmSnapshotQueryExecutorMock).not.toHaveBeenCalled();
    expect(createMysqlRfmSnapshotReaderMock).not.toHaveBeenCalled();

    await expect(app.getCustomerRfm({ masterCustomerId: '9001' })).resolves.toEqual({
      status: 'degraded',
      masterCustomerId: '9001',
      reason: 'rfm_not_configured',
      contractVersion: 'customer-rfm-runtime-v1',
    });
    await expect(app.getCustomerRfmByCustomerId({ customerId: 777 })).resolves.toEqual({
      status: 'degraded',
      customerId: 777,
      reason: 'rfm_not_configured',
      contractVersion: 'customer-rfm-runtime-v1',
    });
  }, 10_000);

  it('shuts down cleanly with no RFM pool ever created', async () => {
    rfmSnapshotDbConfig = null;
    const { bootstrap } = await import('../../src/bootstrap.js');

    await expect(bootstrap().shutdown()).resolves.toBeUndefined();
  }, 10_000);

  it('wires a real RFM reader against the configured pool when RFM_SNAPSHOT_DB_* is set', async () => {
    rfmSnapshotDbConfig = {
      host: 'rfm-host',
      port: 3306,
      user: 'rfm-user',
      password: 'rfm-password',
      database: 'rfm_snapshot',
      connectionLimit: 5,
      queryTimeoutMs: 3000,
    };
    const fakeReader = {
      getCurrentSnapshot: vi.fn(async () => null),
      getCurrentPrestashopCustomerRfm: vi.fn(async () => null),
      getCurrentPrestashopCustomerRfmLookup: vi.fn(async () => ({ snapshot: null, record: null })),
      getCurrentMasterCustomerRfm: vi.fn(async () => null),
      getCurrentMasterCustomerRfmLookup: vi.fn(async () => ({ snapshot: null, record: null })),
    };
    createMysqlRfmSnapshotReaderMock.mockReturnValue(fakeReader);

    const { bootstrap } = await import('../../src/bootstrap.js');
    const app = bootstrap();

    expect(getRfmSnapshotQueryExecutorMock).toHaveBeenCalledTimes(1);
    expect(createMysqlRfmSnapshotReaderMock).toHaveBeenCalledWith(dummyExecutor);

    // Reaches the real reader (not the constant "not configured" fallback): the degraded
    // reason comes from the reader reporting no published snapshot, not from a config gap.
    await expect(app.getCustomerRfmByCustomerId({ customerId: 777 })).resolves.toEqual({
      status: 'degraded',
      customerId: 777,
      reason: 'no_published_rfm_snapshot',
      contractVersion: 'customer-rfm-runtime-v1',
    });
    expect(fakeReader.getCurrentPrestashopCustomerRfmLookup).toHaveBeenCalledWith(777);
  }, 10_000);
});
