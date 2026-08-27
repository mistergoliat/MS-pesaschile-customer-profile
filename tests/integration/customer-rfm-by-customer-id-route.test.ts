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
import type { GetCustomerRfmByCustomerIdResult } from '../../src/domain/customer-rfm/index.js';
import type { ReadinessCheck } from '../../src/http/routes/index.js';

let server: Server | undefined;

const unreachableGetCustomerProfile: GetCustomerProfile = async () => {
  throw new Error('getCustomerProfile must not be called from the customer RFM-by-customerId route tests');
};
const unreachableGetCustomerOrderStatus: GetCustomerOrderStatus = async () => {
  throw new Error('getCustomerOrderStatus must not be called from the customer RFM-by-customerId route tests');
};
const unreachableGetCustomerCommercialSummary: GetCustomerCommercialSummary = async () => {
  throw new Error('getCustomerCommercialSummary must not be called from the customer RFM-by-customerId route tests');
};
const unreachableGetCustomerPurchasedProducts: GetCustomerPurchasedProducts = async () => {
  throw new Error('getCustomerPurchasedProducts must not be called from the customer RFM-by-customerId route tests');
};
const unreachableGetCustomerPurchaseBehavior: GetCustomerPurchaseBehavior = async () => {
  throw new Error('getCustomerPurchaseBehavior must not be called from the customer RFM-by-customerId route tests');
};
const unreachableGetCustomerRfm: GetCustomerRfm = async () => {
  throw new Error('getCustomerRfm (legacy masterCustomerId path) must not be called from the primary RFM route tests');
};
const unreachableGetCustomerCluster: GetCustomerCluster = async () => {
  throw new Error('getCustomerCluster must not be called from the customer RFM-by-customerId route tests');
};

const unreachableGetClusterSnapshotSummary: GetClusterSnapshotSummary = async () => {
  throw new Error('getClusterSnapshotSummary must not be called from the customer RFM-by-customerId route tests');
};

const unreachableGetRfmClusterCrossTab: GetRfmClusterCrossTab = async () => {
  throw new Error('getRfmClusterCrossTab must not be called from the customer RFM-by-customerId route tests');
};

const unreachableGetDashboardContext: GetDashboardContext = async () => {
  throw new Error('getDashboardContext must not be called from the customer RFM-by-customerId route tests');
};
const unreachableGetDashboardOverview: GetDashboardOverview = async () => {
  throw new Error('getDashboardOverview must not be called from the customer RFM-by-customerId route tests');
};
const unreachableGetDashboardRfm: GetDashboardRfm = async () => {
  throw new Error('getDashboardRfm must not be called from the customer RFM-by-customerId route tests');
};
const unreachableGetDashboardClusters: GetDashboardClusters = async () => {
  throw new Error('getDashboardClusters must not be called from the customer RFM-by-customerId route tests');
};
const unreachableGetDashboardIntersection: GetDashboardIntersection = async () => {
  throw new Error('getDashboardIntersection must not be called from the customer RFM-by-customerId route tests');
};

async function startApp(
  getCustomerRfmByCustomerId: GetCustomerRfmByCustomerId,
  checkReadiness: ReadinessCheck = async () => ({ crm: false, prestashop: { status: 'ready' } }),
): Promise<string> {
  const app = buildApp({
    getCustomerProfile: unreachableGetCustomerProfile,
    getCustomerOrderStatus: unreachableGetCustomerOrderStatus,
    getCustomerCommercialSummary: unreachableGetCustomerCommercialSummary,
    getCustomerPurchasedProducts: unreachableGetCustomerPurchasedProducts,
    getCustomerPurchaseBehavior: unreachableGetCustomerPurchaseBehavior,
    getCustomerRfm: unreachableGetCustomerRfm,
    getCustomerRfmByCustomerId,
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

const availableResult: GetCustomerRfmByCustomerIdResult = {
  status: 'available',
  customerId: 777,
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

describe('GET /v1/customers/:customerId/rfm (primary, CRM-independent)', () => {
  it('returns 200 with metrics, scores, segment and snapshot metadata for a found customer', async () => {
    const baseUrl = await startApp(async () => availableResult);

    const response = await fetch(`${baseUrl}/v1/customers/777/rfm`);
    const body = (await response.json()) as GetCustomerRfmByCustomerIdResult;

    expect(response.status).toBe(200);
    expect(body).toEqual(availableResult);
    expect(JSON.stringify(body)).not.toContain('masterCustomerId');
  });

  it('returns 404 when the customer has no current RFM row', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'rfm_not_available',
      customerId: 777,
      reason: 'no_current_rfm_record',
      contractVersion: 'customer-rfm-runtime-v1',
    }));

    const response = await fetch(`${baseUrl}/v1/customers/777/rfm`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      status: 'rfm_not_available',
      customerId: 777,
      reason: 'no_current_rfm_record',
      contractVersion: 'customer-rfm-runtime-v1',
    });
  });

  it('returns 404 when the customer does not exist in PrestaShop', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'customer_not_found',
      customerId: 999999,
      contractVersion: 'customer-rfm-runtime-v1',
    }));

    expect((await fetch(`${baseUrl}/v1/customers/999999/rfm`)).status).toBe(404);
  });

  it('returns 503 when no published RFM snapshot exists', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'degraded',
      customerId: 777,
      reason: 'no_published_rfm_snapshot',
      contractVersion: 'customer-rfm-runtime-v1',
    }));

    expect((await fetch(`${baseUrl}/v1/customers/777/rfm`)).status).toBe(503);
  });

  it('returns 503 rfm_not_configured when RFM_SNAPSHOT_DB_* is absent', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'degraded',
      customerId: 777,
      reason: 'rfm_not_configured',
      contractVersion: 'customer-rfm-runtime-v1',
    }));

    const response = await fetch(`${baseUrl}/v1/customers/777/rfm`);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'degraded', reason: 'rfm_not_configured' });
  });

  it('returns 503 rfm_unavailable when the RFM DB is configured but unreachable', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'degraded',
      customerId: 777,
      reason: 'rfm_unavailable',
      contractVersion: 'customer-rfm-runtime-v1',
    }));

    const response = await fetch(`${baseUrl}/v1/customers/777/rfm`);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'degraded', reason: 'rfm_unavailable' });
  });

  it('preserves null segment fields for historical pre-T11E rows', async () => {
    const baseUrl = await startApp(async () => ({
      ...availableResult,
      segment: {
        code: null,
        version: null,
      },
    }));

    const response = await fetch(`${baseUrl}/v1/customers/777/rfm`);
    const body = (await response.json()) as GetCustomerRfmByCustomerIdResult;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: 'available',
      segment: {
        code: null,
        version: null,
      },
    });
  });

  it('returns 400 for invalid customerId, query params or JSON body without calling the use case', async () => {
    let called = false;
    const baseUrl = await startApp(async () => {
      called = true;
      return availableResult;
    });

    expect((await fetch(`${baseUrl}/v1/customers/not-a-valid-id/rfm`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/0/rfm`)).status).toBe(400);
    expect((await fetch(`${baseUrl}/v1/customers/777/rfm?foo=bar`)).status).toBe(400);
    expect(await rawGetWithJsonBody(`${baseUrl}/v1/customers/777/rfm`)).toBe(400);
    expect(called).toBe(false);
  });

  it('returns 500 with no internal details when the use case throws an unexpected error', async () => {
    const baseUrl = await startApp(async () => {
      throw new Error('RFM snapshot DB failed: host=secret-rfm-host user=admin');
    });

    const response = await fetch(`${baseUrl}/v1/customers/777/rfm`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret-rfm-host');
    expect(body).toEqual({ error: 'internal_error' });
  });

  it('does not implement in-repo auth and keeps the same behavior with or without Authorization headers', async () => {
    const baseUrl = await startApp(async () => availableResult);

    expect((await fetch(`${baseUrl}/v1/customers/777/rfm`)).status).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/v1/customers/777/rfm`, {
          headers: { authorization: 'Bearer definitely-not-validated-here' },
        })
      ).status,
    ).toBe(200);
  });

  it('logs only safe aggregate fields', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const baseUrl = await startApp(async () => availableResult);

    await fetch(`${baseUrl}/v1/customers/777/rfm`);

    const loggedArgs = spy.mock.calls[0] ?? [];
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toContain('123456.780000');
    expect(serialized).not.toContain('R5F3M4');
    expect(loggedArgs[0]).toMatchObject({
      customerId: 777,
      endpoint: 'rfm',
      contractVersion: 'customer-rfm-runtime-v1',
      status: 'available',
      hasSegment: true,
      segmentCode: 'LOYAL',
      snapshotId: '55',
    });
  });

  it('never reaches the legacy masterCustomerId path', async () => {
    // getCustomerRfm (legacy) is wired to unreachableGetCustomerRfm above — this route
    // firing at all without throwing proves the two paths stay fully separated.
    const baseUrl = await startApp(async () => availableResult);

    expect((await fetch(`${baseUrl}/v1/customers/777/rfm`)).status).toBe(200);
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
