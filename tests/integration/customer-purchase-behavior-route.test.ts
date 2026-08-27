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
import type { GetCustomerOrderStatus } from '../../src/application/customer-order-status/get-customer-order-status.js';
import type { GetCustomerProfile } from '../../src/application/customer-profile/get-customer-profile.js';
import { buildApp } from '../../src/app.js';
import { CUSTOMER_PROFILE_CONTRACT_VERSION, type CustomerDataProvenance } from '../../src/domain/customer-identity/index.js';
import type { GetCustomerPurchaseBehaviorResult } from '../../src/domain/customer-purchase-behavior/index.js';
import type { ReadinessCheck } from '../../src/http/routes/index.js';

let server: Server | undefined;

const unreachableGetCustomerProfile: GetCustomerProfile = async () => {
  throw new Error('getCustomerProfile must not be called from the purchase behavior route tests');
};
const unreachableGetCustomerOrderStatus: GetCustomerOrderStatus = async () => {
  throw new Error('getCustomerOrderStatus must not be called from the purchase behavior route tests');
};
const unreachableGetCustomerCommercialSummary: GetCustomerCommercialSummary = async () => {
  throw new Error('getCustomerCommercialSummary must not be called from the purchase behavior route tests');
};
const unreachableGetCustomerPurchasedProducts: GetCustomerPurchasedProducts = async () => {
  throw new Error('getCustomerPurchasedProducts must not be called from the purchase behavior route tests');
};
const unreachableGetCustomerRfm: GetCustomerRfm = async () => {
  throw new Error('getCustomerRfm must not be called from the purchase behavior route tests');
};
const unreachableGetCustomerRfmByCustomerId: GetCustomerRfmByCustomerId = async () => {
  throw new Error('getCustomerRfmByCustomerId must not be called from the purchase behavior route tests');
};

const unreachableGetCustomerCluster: GetCustomerCluster = async () => {
  throw new Error('getCustomerCluster must not be called from the purchase behavior route tests');
};

const unreachableGetClusterSnapshotSummary: GetClusterSnapshotSummary = async () => {
  throw new Error('getClusterSnapshotSummary must not be called from the purchase behavior route tests');
};

const unreachableGetRfmClusterCrossTab: GetRfmClusterCrossTab = async () => {
  throw new Error('getRfmClusterCrossTab must not be called from the purchase behavior route tests');
};

const unreachableGetDashboardContext: GetDashboardContext = async () => {
  throw new Error('getDashboardContext must not be called from the purchase behavior route tests');
};
const unreachableGetDashboardOverview: GetDashboardOverview = async () => {
  throw new Error('getDashboardOverview must not be called from the purchase behavior route tests');
};
const unreachableGetDashboardRfm: GetDashboardRfm = async () => {
  throw new Error('getDashboardRfm must not be called from the purchase behavior route tests');
};
const unreachableGetDashboardClusters: GetDashboardClusters = async () => {
  throw new Error('getDashboardClusters must not be called from the purchase behavior route tests');
};

async function startApp(
  getCustomerPurchaseBehavior: GetCustomerPurchaseBehavior,
  checkReadiness: ReadinessCheck = async () => ({ crm: false, prestashop: { status: 'ready' } }),
): Promise<string> {
  const app = buildApp({
    getCustomerProfile: unreachableGetCustomerProfile,
    getCustomerOrderStatus: unreachableGetCustomerOrderStatus,
    getCustomerCommercialSummary: unreachableGetCustomerCommercialSummary,
    getCustomerPurchasedProducts: unreachableGetCustomerPurchasedProducts,
    getCustomerPurchaseBehavior,
    getCustomerRfm: unreachableGetCustomerRfm,
    getCustomerRfmByCustomerId: unreachableGetCustomerRfmByCustomerId,
    getCustomerCluster: unreachableGetCustomerCluster,
    getClusterSnapshotSummary: unreachableGetClusterSnapshotSummary,
    getRfmClusterCrossTab: unreachableGetRfmClusterCrossTab,
    getDashboardContext: unreachableGetDashboardContext,
    getDashboardOverview: unreachableGetDashboardOverview,
    getDashboardRfm: unreachableGetDashboardRfm,
    getDashboardClusters: unreachableGetDashboardClusters,
    checkReadiness,
  });
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server?.listen(0, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind test server');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (server) {
    await closeServer();
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
      { source: 'PRESTASHOP', entity: 'ps_orders', purpose: 'purchase_behavior' },
      { source: 'PRESTASHOP', entity: 'ps_order_detail', purpose: 'purchase_behavior' },
      { source: 'PRESTASHOP', entity: 'derived_purchase_behavior', purpose: 'purchase_behavior' },
    ],
    generatedAt: '2026-08-05T00:00:00.000Z',
    contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
  };
}

const emptyAvailableResult: GetCustomerPurchaseBehaviorResult = {
  status: 'available',
  customerId: 1,
  currencyIsoCode: 'CLP',
  calculatedAt: '2026-01-10T00:00:00.000Z',
  summary: {
    validOrderCount: 0,
    distinctProductCount: 0,
    distinctVariantCount: 0,
    repeatedProductCount: 0,
    repeatedVariantCount: 0,
    repeatProductRate: '0.000000',
    repeatVariantRate: '0.000000',
    repeatedVariantSpendShare: '0.000000',
    productSpendConcentration: emptyConcentration(),
    variantSpendConcentration: emptyConcentration(),
  },
  topProducts: [],
  topVariants: [],
  provenance: provenance(1),
};

describe('GET /v1/customers/:customerId/purchase-behavior', () => {
  it('uses default topProducts/topVariants 10 and returns an empty payload', async () => {
    let input: Parameters<GetCustomerPurchaseBehavior>[0] | null = null;
    const baseUrl = await startApp(async (request) => {
      input = request;
      return emptyAvailableResult;
    });

    const response = await fetch(`${baseUrl}/v1/customers/1/purchase-behavior`);
    const body = (await response.json()) as GetCustomerPurchaseBehaviorResult;

    expect(response.status).toBe(200);
    expect(input).toEqual({ customerId: 1, topProducts: 10, topVariants: 10 });
    expect(body).toEqual(emptyAvailableResult);
  });

  it('rejects invalid query params and customer ids without calling the use case', async () => {
    let called = false;
    const baseUrl = await startApp(async () => {
      called = true;
      return emptyAvailableResult;
    });

    for (const query of ['topProducts=0', 'topVariants=11', 'limit=10', 'email=a@example.com']) {
      expect((await fetch(`${baseUrl}/v1/customers/1/purchase-behavior?${query}`)).status).toBe(400);
    }
    expect((await fetch(`${baseUrl}/v1/customers/0/purchase-behavior`)).status).toBe(400);
    expect(await rawGetWithJsonBody(`${baseUrl}/v1/customers/1/purchase-behavior`)).toBe(400);
    expect(called).toBe(false);
  });

  it('maps result statuses to HTTP status codes', async () => {
    const notFoundBaseUrl = await startApp(async () => ({ status: 'customer_not_found', customerId: 999 }));
    expect((await fetch(`${notFoundBaseUrl}/v1/customers/999/purchase-behavior`)).status).toBe(404);
    await closeServer();

    const unavailableBaseUrl = await startApp(async () => ({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_unavailable',
    }));
    expect((await fetch(`${unavailableBaseUrl}/v1/customers/1/purchase-behavior`)).status).toBe(503);
    await closeServer();

    const incompatibleBaseUrl = await startApp(async () => ({
      status: 'degraded',
      customerId: 1,
      reason: 'prestashop_schema_incompatible',
    }));
    expect((await fetch(`${incompatibleBaseUrl}/v1/customers/1/purchase-behavior`)).status).toBe(503);
  });

  it('logs only allowed aggregate fields', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const baseUrl = await startApp(async () => emptyAvailableResult);

    await fetch(`${baseUrl}/v1/customers/1/purchase-behavior`);

    const loggedArgs = spy.mock.calls[0] ?? [];
    expect(loggedArgs[0]).toMatchObject({
      customerId: 1,
      endpoint: 'purchase-behavior',
      identitySource: 'PRESTASHOP',
      identityStatus: 'DIRECT_SOURCE',
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
      status: 'available',
      distinctProductBucket: 'zero',
      hasRepeatedProducts: false,
      concentrationAvailable: false,
    });
  });
});

function emptyConcentration() {
  return {
    top1Share: '0.000000',
    top3Share: '0.000000',
    hhi: '0.000000',
    effectiveDiversity: '0.000000',
  };
}

async function closeServer(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
}

async function rawGetWithJsonBody(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ prestashopCustomerId: 555 });
    const request = httpRequest(
      url,
      {
        method: 'GET',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
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
