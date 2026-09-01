import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { RouteDependencies } from '../../src/http/routes/index.js';
import type { GetCustomerClvResult } from '../../src/application/customer-clv/get-customer-clv.js';
import type { GetCustomerIntelligenceRowResult } from '../../src/application/customer-intelligence/get-customer-intelligence-row.js';

let server: Server | undefined;
const unreachable = async (): Promise<never> => { throw new Error('unreachable'); };
const baseDeps: RouteDependencies = {
  getCustomerProfile: unreachable, getCustomerOrderStatus: unreachable, getCustomerCommercialSummary: unreachable,
  getCustomerPurchasedProducts: unreachable, getCustomerPurchaseBehavior: unreachable, getCustomerRfm: unreachable,
  getCustomerRfmByCustomerId: unreachable, getCustomerCluster: unreachable, getClusterSnapshotSummary: unreachable,
  getRfmClusterCrossTab: unreachable, getDashboardContext: unreachable, getDashboardOverview: unreachable,
  getDashboardRfm: unreachable, getDashboardClusters: unreachable, getDashboardIntersection: unreachable,
  checkReadiness: async () => ({ crm: false, prestashop: { status: 'ready' } }),
};

async function startApp(overrides: Partial<RouteDependencies>): Promise<string> {
  server = createServer(buildApp({ ...baseDeps, ...overrides }));
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const address = server!.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind test server');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
  vi.restoreAllMocks();
});

const availableClv: GetCustomerClvResult = {
  status: 'available', customerId: 42,
  clv: {
    horizonMonths: 12, expectedRevenueTaxIncl: '123.450000', expectedOrders: '2.000000', currencyIsoCode: 'CLP',
    estimateSupportLevel: 'SUPPORTED', modelVersion: 'customer-clv-two-stage-cohort-v1', estimatorPolicyVersion: 'estimator-v1',
    referenceTime: '2026-08-01T00:00:00.000Z', generatedAt: '2026-08-01T01:00:00.000Z', snapshotId: '1', snapshotKey: 'snapshot-1', sourceAvailableDataThrough: '2026-07-31T23:59:59.000Z',
  }, contractVersion: 'customer-clv-runtime-v1',
};

describe('A07 CLV routes', () => {
  it('returns direct CLV and preserves its envelope', async () => {
    const getCustomerClv = vi.fn(async () => availableClv);
    const baseUrl = await startApp({ getCustomerClv });
    const response = await fetch(`${baseUrl}/v1/customers/42/clv`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(availableClv);
    expect(getCustomerClv).toHaveBeenCalledWith({ customerId: 42 });
  });

  it('maps missing CLV and invalid ids consistently', async () => {
    const missing: GetCustomerClvResult = { status: 'customer_clv_not_found', customerId: 42, error: 'CUSTOMER_CLV_NOT_FOUND', contractVersion: 'customer-clv-runtime-v1' };
    const baseUrl = await startApp({ getCustomerClv: async () => missing });
    expect((await fetch(`${baseUrl}/v1/customers/42/clv`)).status).toBe(404);
    expect(await (await fetch(`${baseUrl}/v1/customers/nope/clv`)).json()).toEqual({ error: 'invalid_customer_id' });
  });

  it('exposes the same intelligence endpoint with nullable CLV', async () => {
    const result: GetCustomerIntelligenceRowResult = { status: 'available', context: {} as never, row: { clv: null } as never };
    const getCustomerIntelligenceRow = vi.fn(async () => result);
    const baseUrl = await startApp({ getCustomerIntelligenceRow });
    const response = await fetch(`${baseUrl}/v1/customers/42/intelligence`);
    expect(response.status).toBe(200);
    expect((await response.json()).row.clv).toBeNull();
    expect(getCustomerIntelligenceRow).toHaveBeenCalledWith({ featureSnapshotId: null, prestashopCustomerId: 42 });
  });
});
