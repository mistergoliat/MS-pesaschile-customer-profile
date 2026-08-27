import { createServer, request as httpRequest, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GetCustomerCommercialSummary } from '../../src/application/customer-commercial-summary/get-customer-commercial-summary.js';
import type { GetCustomerPurchaseBehavior } from '../../src/application/customer-purchase-behavior/get-customer-purchase-behavior.js';
import type { GetCustomerPurchasedProducts } from '../../src/application/customer-purchased-products/get-customer-purchased-products.js';
import type { GetCustomerRfm } from '../../src/application/customer-rfm/get-customer-rfm.js';
import type { GetCustomerRfmByCustomerId } from '../../src/application/customer-rfm/get-customer-rfm-by-customer-id.js';
import type { GetCustomerCluster } from '../../src/application/customer-clustering/get-customer-cluster.js';
import type { GetClusterSnapshotSummary } from '../../src/application/customer-clustering/get-cluster-snapshot-summary.js';
import type { GetRfmClusterCrossTab } from '../../src/application/customer-clustering/get-rfm-cluster-cross-tab.js';
import type { GetDashboardContext } from '../../src/application/customer-intelligence-dashboard/get-dashboard-context.js';
import type { GetDashboardOverview } from '../../src/application/customer-intelligence-dashboard/get-dashboard-overview.js';
import type { GetDashboardRfm } from '../../src/application/customer-intelligence-dashboard/get-dashboard-rfm.js';
import type { GetDashboardClusters } from '../../src/application/customer-intelligence-dashboard/get-dashboard-clusters.js';
import type { GetDashboardIntersection } from '../../src/application/customer-intelligence-dashboard/get-dashboard-intersection.js';
import type { GetCustomerOrderStatus } from '../../src/application/customer-order-status/get-customer-order-status.js';
import type { GetCustomerProfile } from '../../src/application/customer-profile/get-customer-profile.js';
import { buildApp } from '../../src/app.js';
import { CUSTOMER_PROFILE_CONTRACT_VERSION, type CustomerDataProvenance } from '../../src/domain/customer-identity/index.js';
import type { GetCustomerCommercialSummaryResult } from '../../src/domain/customer-commercial-summary/index.js';
import type { ReadinessCheck } from '../../src/http/routes/index.js';

let server: Server | undefined;

const unreachableGetCustomerProfile: GetCustomerProfile = async () => {
  throw new Error('getCustomerProfile must not be called from the commercial summary route tests');
};

const unreachableGetCustomerOrderStatus: GetCustomerOrderStatus = async () => {
  throw new Error('getCustomerOrderStatus must not be called from the commercial summary route tests');
};

const unreachableGetCustomerPurchasedProducts: GetCustomerPurchasedProducts = async () => {
  throw new Error('getCustomerPurchasedProducts must not be called from the commercial summary route tests');
};

const unreachableGetCustomerPurchaseBehavior: GetCustomerPurchaseBehavior = async () => {
  throw new Error('getCustomerPurchaseBehavior must not be called from the commercial summary route tests');
};
const unreachableGetCustomerRfm: GetCustomerRfm = async () => {
  throw new Error('getCustomerRfm must not be called from the commercial summary route tests');
};
const unreachableGetCustomerRfmByCustomerId: GetCustomerRfmByCustomerId = async () => {
  throw new Error('getCustomerRfmByCustomerId must not be called from the commercial summary route tests');
};

const unreachableGetCustomerCluster: GetCustomerCluster = async () => {
  throw new Error('getCustomerCluster must not be called from the commercial summary route tests');
};

const unreachableGetClusterSnapshotSummary: GetClusterSnapshotSummary = async () => {
  throw new Error('getClusterSnapshotSummary must not be called from the commercial summary route tests');
};

const unreachableGetRfmClusterCrossTab: GetRfmClusterCrossTab = async () => {
  throw new Error('getRfmClusterCrossTab must not be called from the commercial summary route tests');
};

const unreachableGetDashboardContext: GetDashboardContext = async () => {
  throw new Error('getDashboardContext must not be called from the commercial summary route tests');
};
const unreachableGetDashboardOverview: GetDashboardOverview = async () => {
  throw new Error('getDashboardOverview must not be called from the commercial summary route tests');
};
const unreachableGetDashboardRfm: GetDashboardRfm = async () => {
  throw new Error('getDashboardRfm must not be called from the commercial summary route tests');
};
const unreachableGetDashboardClusters: GetDashboardClusters = async () => {
  throw new Error('getDashboardClusters must not be called from the commercial summary route tests');
};
const unreachableGetDashboardIntersection: GetDashboardIntersection = async () => {
  throw new Error('getDashboardIntersection must not be called from the commercial summary route tests');
};

async function startApp(
  getCustomerCommercialSummary: GetCustomerCommercialSummary,
  checkReadiness: ReadinessCheck = async () => ({ crm: false, prestashop: { status: 'ready' } }),
): Promise<string> {
  const app = buildApp({
    getCustomerProfile: unreachableGetCustomerProfile,
    getCustomerOrderStatus: unreachableGetCustomerOrderStatus,
    getCustomerCommercialSummary,
    getCustomerPurchasedProducts: unreachableGetCustomerPurchasedProducts,
    getCustomerPurchaseBehavior: unreachableGetCustomerPurchaseBehavior,
    getCustomerRfm: unreachableGetCustomerRfm,
    getCustomerRfmByCustomerId: unreachableGetCustomerRfmByCustomerId,
    getCustomerCluster: unreachableGetCustomerCluster,
    getClusterSnapshotSummary: unreachableGetClusterSnapshotSummary,
    getRfmClusterCrossTab: unreachableGetRfmClusterCrossTab,
    getDashboardContext: unreachableGetDashboardContext,
    getDashboardOverview: unreachableGetDashboardOverview,
    getDashboardRfm: unreachableGetDashboardRfm,
    getDashboardClusters: unreachableGetDashboardClusters,
    getDashboardIntersection: unreachableGetDashboardIntersection,
    checkReadiness,
  });
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server?.listen(0, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to bind test server');
  }
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  }
  vi.restoreAllMocks();
});

function provenance(customerId: number): CustomerDataProvenance {
  return {
    customerIdentity: {
      customerId,
      source: 'PRESTASHOP',
      externalCustomerId: String(customerId),
      status: 'DIRECT_SOURCE',
    },
    dataSources: [
      { source: 'PRESTASHOP', entity: 'ps_customer', purpose: 'customer_identity' },
      { source: 'PRESTASHOP', entity: 'ps_orders', purpose: 'commercial_summary' },
      { source: 'PRESTASHOP', entity: 'ps_order_detail', purpose: 'commercial_summary' },
    ],
    generatedAt: '2026-08-05T00:00:00.000Z',
    contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
  };
}

const emptyAvailableResult: GetCustomerCommercialSummaryResult = {
  status: 'available',
  customerId: 1,
  summary: {
    totalOrders: 0,
    totalSpentTaxIncl: '0.000000',
    averageOrderValueTaxIncl: '0.000000',
    firstOrderAt: null,
    lastOrderAt: null,
    daysSinceLastOrder: null,
    purchaseFrequencyDays: null,
    totalUnitsPurchased: 0,
    distinctProductsPurchased: 0,
    cancelledOrderCount: 0,
    refundedOrderCount: 0,
    currencyIsoCode: 'CLP',
  },
  provenance: provenance(1),
};

describe('GET /v1/customers/:customerId/commercial-summary', () => {
  it('returns 200 with the documented available shape, customerId and provenance', async () => {
    const baseUrl = await startApp(async () => ({
      ...emptyAvailableResult,
      summary: {
        ...emptyAvailableResult.summary,
        totalOrders: 2,
        totalSpentTaxIncl: '142177.121231',
        averageOrderValueTaxIncl: '71088.560616',
        firstOrderAt: '2026-01-02T10:00:00.000Z',
        lastOrderAt: '2026-01-05T10:00:00.000Z',
        daysSinceLastOrder: 205,
        purchaseFrequencyDays: 3,
        totalUnitsPurchased: 5,
        distinctProductsPurchased: 3,
      },
    }));

    const response = await fetch(`${baseUrl}/v1/customers/1/commercial-summary`);
    const body = (await response.json()) as GetCustomerCommercialSummaryResult;

    expect(response.status).toBe(200);
    expect(body.status).toBe('available');
    if (body.status !== 'available') throw new Error('expected available');
    expect(body.customerId).toBe(1);
    expect(body.provenance.contractVersion).toBe(CUSTOMER_PROFILE_CONTRACT_VERSION);
    expect(body.summary.totalSpentTaxIncl).toBe('142177.121231');
    expect(typeof body.summary.totalSpentTaxIncl).toBe('string');
  });

  it('serializes the empty summary with JSON null fields', async () => {
    const baseUrl = await startApp(async () => emptyAvailableResult);

    const response = await fetch(`${baseUrl}/v1/customers/1/commercial-summary`);
    const body = (await response.json()) as GetCustomerCommercialSummaryResult;

    expect(response.status).toBe(200);
    expect(body).toEqual(emptyAvailableResult);
  });

  it('returns 404 for customer_not_found', async () => {
    const baseUrl = await startApp(async () => ({ status: 'customer_not_found', customerId: 999 }));

    const response = await fetch(`${baseUrl}/v1/customers/999/commercial-summary`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ status: 'customer_not_found', customerId: 999 });
  });

  it('returns 503 for degraded PrestaShop unavailable or schema incompatible', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_unavailable',
    }));

    expect((await fetch(`${baseUrl}/v1/customers/1/commercial-summary`)).status).toBe(503);

    await closeServer();

    const incompatibleBaseUrl = await startApp(async () => ({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_schema_incompatible',
    }));

    expect((await fetch(`${incompatibleBaseUrl}/v1/customers/1/commercial-summary`)).status).toBe(503);
  });

  it('returns 400 for invalid customerId, query params or JSON body without calling the use case', async () => {
    let called = false;
    const baseUrl = await startApp(async () => {
      called = true;
      return emptyAvailableResult;
    });

    expect((await fetch(`${baseUrl}/v1/customers/a@b.com/commercial-summary`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/0/commercial-summary`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/1/commercial-summary?currency=USD`)).status).toBe(400);
    expect(await rawGetWithJsonBody(`${baseUrl}/v1/customers/1/commercial-summary`)).toBe(400);
    expect(called).toBe(false);
  });

  it('returns 500 with no stack trace or internals when the use case throws', async () => {
    const baseUrl = await startApp(async () => {
      throw new Error('PrestaShop connection failed: host=secret-internal-host user=admin');
    });

    const response = await fetch(`${baseUrl}/v1/customers/1/commercial-summary`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret-internal-host');
    expect(body).toEqual({ error: 'internal_error' });
  });

  it('logs success without money, dates, product detail or PII, but includes safe identity metadata', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const baseUrl = await startApp(async () => ({
      ...emptyAvailableResult,
      summary: {
        ...emptyAvailableResult.summary,
        totalOrders: 2,
        totalSpentTaxIncl: '999999.123456',
        averageOrderValueTaxIncl: '499999.561728',
        firstOrderAt: '2026-01-02T10:00:00.000Z',
        lastOrderAt: '2026-01-05T10:00:00.000Z',
        daysSinceLastOrder: 205,
        purchaseFrequencyDays: 3,
        totalUnitsPurchased: 77,
        distinctProductsPurchased: 12,
        cancelledOrderCount: 5,
        refundedOrderCount: 4,
      },
    }));

    await fetch(`${baseUrl}/v1/customers/1/commercial-summary`);

    const loggedArgs = spy.mock.calls[0] ?? [];
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain('999999.123456');
    expect(serialized).not.toContain('2026-01-02');
    expect(loggedArgs[0]).toMatchObject({
      customerId: 1,
      endpoint: 'commercial-summary',
      identitySource: 'PRESTASHOP',
      identityStatus: 'DIRECT_SOURCE',
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
      status: 'available',
      totalOrdersBucket: 'multiple',
      hasCommercialHistory: true,
    });
  });
});

async function closeServer(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
}

async function rawGetWithJsonBody(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ from: '2026-01-01' });
    const request = httpRequest(
      url,
      {
        method: 'GET',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      },
    );
    request.on('error', reject);
    request.end(payload);
  });
}
