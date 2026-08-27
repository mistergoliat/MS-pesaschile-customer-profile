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
import type { GetCustomerRfmResult } from '../../src/domain/customer-rfm/index.js';
import type { ReadinessCheck } from '../../src/http/routes/index.js';

let server: Server | undefined;

const unreachableGetCustomerProfile: GetCustomerProfile = async () => {
  throw new Error('getCustomerProfile must not be called from the customer RFM route tests');
};
const unreachableGetCustomerOrderStatus: GetCustomerOrderStatus = async () => {
  throw new Error('getCustomerOrderStatus must not be called from the customer RFM route tests');
};
const unreachableGetCustomerCommercialSummary: GetCustomerCommercialSummary = async () => {
  throw new Error('getCustomerCommercialSummary must not be called from the customer RFM route tests');
};
const unreachableGetCustomerPurchasedProducts: GetCustomerPurchasedProducts = async () => {
  throw new Error('getCustomerPurchasedProducts must not be called from the customer RFM route tests');
};
const unreachableGetCustomerPurchaseBehavior: GetCustomerPurchaseBehavior = async () => {
  throw new Error('getCustomerPurchaseBehavior must not be called from the customer RFM route tests');
};
const unreachableGetCustomerRfmByCustomerId: GetCustomerRfmByCustomerId = async () => {
  throw new Error('getCustomerRfmByCustomerId must not be called from the legacy master-customer RFM route tests');
};

const unreachableGetCustomerCluster: GetCustomerCluster = async () => {
  throw new Error('getCustomerCluster must not be called from the customer RFM route tests');
};

const unreachableGetClusterSnapshotSummary: GetClusterSnapshotSummary = async () => {
  throw new Error('getClusterSnapshotSummary must not be called from the customer RFM route tests');
};

const unreachableGetRfmClusterCrossTab: GetRfmClusterCrossTab = async () => {
  throw new Error('getRfmClusterCrossTab must not be called from the customer RFM route tests');
};

const unreachableGetDashboardContext: GetDashboardContext = async () => {
  throw new Error('getDashboardContext must not be called from the customer RFM route tests');
};
const unreachableGetDashboardOverview: GetDashboardOverview = async () => {
  throw new Error('getDashboardOverview must not be called from the customer RFM route tests');
};
const unreachableGetDashboardRfm: GetDashboardRfm = async () => {
  throw new Error('getDashboardRfm must not be called from the customer RFM route tests');
};
const unreachableGetDashboardClusters: GetDashboardClusters = async () => {
  throw new Error('getDashboardClusters must not be called from the customer RFM route tests');
};
const unreachableGetDashboardIntersection: GetDashboardIntersection = async () => {
  throw new Error('getDashboardIntersection must not be called from the customer RFM route tests');
};

async function startApp(
  getCustomerRfm: GetCustomerRfm,
  checkReadiness: ReadinessCheck = async () => ({ crm: false, prestashop: { status: 'ready' } }),
): Promise<string> {
  const app = buildApp({
    getCustomerProfile: unreachableGetCustomerProfile,
    getCustomerOrderStatus: unreachableGetCustomerOrderStatus,
    getCustomerCommercialSummary: unreachableGetCustomerCommercialSummary,
    getCustomerPurchasedProducts: unreachableGetCustomerPurchasedProducts,
    getCustomerPurchaseBehavior: unreachableGetCustomerPurchaseBehavior,
    getCustomerRfm,
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

const availableResult: GetCustomerRfmResult = {
  status: 'available',
  masterCustomerId: '9001',
  snapshot: {
    snapshotId: '55',
    calculationVersion: 'rfm-population-v1',
    referenceTime: '2026-08-03T00:00:00.000Z',
    publishedAt: '2026-08-03T01:00:00.000Z',
    currencyCode: 'CLP',
  },
  rfm: {
    recencyDays: 2,
    frequencyOrders: 3,
    grossOrderValueTaxIncl: '123456.780000',
    averageOrderValueTaxIncl: '41152.260000',
    recencyScore: 5,
    frequencyScore: 3,
    monetaryScore: 4,
    rfmCode: 'R5F3M4',
  },
  segment: {
    code: 'LOYAL',
    version: 'rfm-commercial-v1',
  },
  contractVersion: 'customer-rfm-runtime-v1',
};

describe('GET /v1/master-customers/:masterCustomerId/rfm', () => {
  it('returns 200 with metrics, scores, segment and snapshot metadata for a found customer', async () => {
    const baseUrl = await startApp(async () => availableResult);

    const response = await fetch(`${baseUrl}/v1/master-customers/9001/rfm`);
    const body = (await response.json()) as GetCustomerRfmResult;

    expect(response.status).toBe(200);
    expect(body).toEqual(availableResult);
    expect(JSON.stringify(body)).not.toContain('prestashopCustomerId');
  });

  it('returns 404 when the master customer has no current RFM row', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'rfm_not_available',
      masterCustomerId: '9001',
      reason: 'no_current_rfm_record',
      contractVersion: 'customer-rfm-runtime-v1',
    }));

    const response = await fetch(`${baseUrl}/v1/master-customers/9001/rfm`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      status: 'rfm_not_available',
      masterCustomerId: '9001',
      reason: 'no_current_rfm_record',
      contractVersion: 'customer-rfm-runtime-v1',
    });
  });

  it('returns 404 when the master customer does not exist', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'customer_not_found',
      masterCustomerId: '9999',
      contractVersion: 'customer-rfm-runtime-v1',
    }));

    expect((await fetch(`${baseUrl}/v1/master-customers/9999/rfm`)).status).toBe(404);
  });

  it('returns 503 when no published RFM snapshot exists', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'degraded',
      masterCustomerId: '9001',
      reason: 'no_published_rfm_snapshot',
      contractVersion: 'customer-rfm-runtime-v1',
    }));

    expect((await fetch(`${baseUrl}/v1/master-customers/9001/rfm`)).status).toBe(503);
  });

  it('preserves null segment fields for historical pre-T11E rows', async () => {
    const baseUrl = await startApp(async () => ({
      ...availableResult,
      segment: {
        code: null,
        version: null,
      },
    }));

    const response = await fetch(`${baseUrl}/v1/master-customers/9001/rfm`);
    const body = (await response.json()) as GetCustomerRfmResult;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 'available',
      segment: {
        code: null,
        version: null,
      },
    });
  });

  it('returns 400 for invalid masterCustomerId, query params or JSON body without calling the use case', async () => {
    let called = false;
    const baseUrl = await startApp(async () => {
      called = true;
      return availableResult;
    });

    expect((await fetch(`${baseUrl}/v1/master-customers/not-a-valid-id/rfm`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/master-customers/0/rfm`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/master-customers/9001/rfm?foo=bar`)).status).toBe(400);
    expect(await rawGetWithJsonBody(`${baseUrl}/v1/master-customers/9001/rfm`)).toBe(400);
    expect(called).toBe(false);
  });

  it('returns 500 with no internal details when the use case throws', async () => {
    const baseUrl = await startApp(async () => {
      throw new Error('RFM snapshot DB failed: host=secret-rfm-host user=admin');
    });

    const response = await fetch(`${baseUrl}/v1/master-customers/9001/rfm`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret-rfm-host');
    expect(body).toEqual({ error: 'internal_error' });
  });

  it('does not implement in-repo auth and keeps the same behavior with or without Authorization headers', async () => {
    const baseUrl = await startApp(async () => availableResult);

    expect((await fetch(`${baseUrl}/v1/master-customers/9001/rfm`)).status).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/v1/master-customers/9001/rfm`, {
          headers: { authorization: 'Bearer definitely-not-validated-here' },
        })
      ).status,
    ).toBe(200);
  });

  it('logs only safe aggregate fields', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const baseUrl = await startApp(async () => availableResult);

    await fetch(`${baseUrl}/v1/master-customers/9001/rfm`);

    const loggedArgs = spy.mock.calls[0] ?? [];
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain('123456.780000');
    expect(serialized).not.toContain('R5F3M4');
    expect(loggedArgs[0]).toMatchObject({
      masterCustomerId: '9001',
      endpoint: 'rfm',
      contractVersion: 'customer-rfm-runtime-v1',
      status: 'available',
      hasSegment: true,
      segmentCode: 'LOYAL',
      snapshotId: '55',
    });
  });
});

async function rawGetWithJsonBody(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ customerId: 1 });
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
