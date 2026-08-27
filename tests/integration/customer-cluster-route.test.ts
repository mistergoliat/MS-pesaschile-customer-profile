import { createServer, type Server } from 'node:http';
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
import type { GetCustomerClusterResult } from '../../src/domain/customer-clustering/index.js';
import type { ReadinessCheck } from '../../src/http/routes/index.js';

let server: Server | undefined;

const unreachableGetCustomerProfile: GetCustomerProfile = async () => {
  throw new Error('getCustomerProfile must not be called from the customer cluster route tests');
};
const unreachableGetCustomerOrderStatus: GetCustomerOrderStatus = async () => {
  throw new Error('getCustomerOrderStatus must not be called from the customer cluster route tests');
};
const unreachableGetCustomerCommercialSummary: GetCustomerCommercialSummary = async () => {
  throw new Error('getCustomerCommercialSummary must not be called from the customer cluster route tests');
};
const unreachableGetCustomerPurchasedProducts: GetCustomerPurchasedProducts = async () => {
  throw new Error('getCustomerPurchasedProducts must not be called from the customer cluster route tests');
};
const unreachableGetCustomerPurchaseBehavior: GetCustomerPurchaseBehavior = async () => {
  throw new Error('getCustomerPurchaseBehavior must not be called from the customer cluster route tests');
};
const unreachableGetCustomerRfm: GetCustomerRfm = async () => {
  throw new Error('getCustomerRfm must not be called from the customer cluster route tests');
};
const unreachableGetCustomerRfmByCustomerId: GetCustomerRfmByCustomerId = async () => {
  throw new Error('getCustomerRfmByCustomerId must not be called from the customer cluster route tests');
};
const unreachableGetClusterSnapshotSummary: GetClusterSnapshotSummary = async () => {
  throw new Error('getClusterSnapshotSummary must not be called from the customer cluster route tests');
};
const unreachableGetRfmClusterCrossTab: GetRfmClusterCrossTab = async () => {
  throw new Error('getRfmClusterCrossTab must not be called from the customer cluster route tests');
};
const unreachableGetDashboardContext: GetDashboardContext = async () => {
  throw new Error('getDashboardContext must not be called from the customer cluster route tests');
};
const unreachableGetDashboardOverview: GetDashboardOverview = async () => {
  throw new Error('getDashboardOverview must not be called from the customer cluster route tests');
};
const unreachableGetDashboardRfm: GetDashboardRfm = async () => {
  throw new Error('getDashboardRfm must not be called from the customer cluster route tests');
};
const unreachableGetDashboardClusters: GetDashboardClusters = async () => {
  throw new Error('getDashboardClusters must not be called from the customer cluster route tests');
};
const unreachableGetDashboardIntersection: GetDashboardIntersection = async () => {
  throw new Error('getDashboardIntersection must not be called from the customer cluster route tests');
};

async function startApp(
  getCustomerCluster: GetCustomerCluster,
  checkReadiness: ReadinessCheck = async () => ({ crm: false, prestashop: { status: 'ready' } }),
): Promise<string> {
  const app = buildApp({
    getCustomerProfile: unreachableGetCustomerProfile,
    getCustomerOrderStatus: unreachableGetCustomerOrderStatus,
    getCustomerCommercialSummary: unreachableGetCustomerCommercialSummary,
    getCustomerPurchasedProducts: unreachableGetCustomerPurchasedProducts,
    getCustomerPurchaseBehavior: unreachableGetCustomerPurchaseBehavior,
    getCustomerRfm: unreachableGetCustomerRfm,
    getCustomerRfmByCustomerId: unreachableGetCustomerRfmByCustomerId,
    getCustomerCluster,
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

const availableResult: GetCustomerClusterResult = {
  status: 'available',
  customerId: 22066,
  cluster: { clusterId: 3, label: 'NEW_BURST_THEN_LAPSED_BUYERS', description: 'x' },
  model: {
    modelVersion: 'behavioral-kmeans-k4-v1',
    algorithm: 'kmeans',
    k: 4,
    featureVersion: 'behavioral-clustering-features-v1',
    preprocessingVersion: 'behavioral-clustering-preprocessing-v1',
  },
  snapshot: { snapshotId: '7', referenceTime: '2026-08-19T21:23:24.000Z' },
  assignment: { distanceToCentroid: 1.086622607 },
  contractVersion: 'customer-cluster-runtime-v1',
};

describe('GET /v1/customers/:customerId/cluster', () => {
  it('returns 200 with cluster/model/snapshot/assignment for a clustered customer', async () => {
    const baseUrl = await startApp(async () => availableResult);
    const response = await fetch(`${baseUrl}/v1/customers/22066/cluster`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(availableResult);
  });

  it('returns 404 customer_not_found for an unknown customerId', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'customer_not_found',
      customerId: 999999999,
      contractVersion: 'customer-cluster-runtime-v1',
    }));
    const response = await fetch(`${baseUrl}/v1/customers/999999999/cluster`);
    expect(response.status).toBe(404);
  });

  it('returns 404 cluster_not_available for a one-time buyer (insufficient repeat purchase history)', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'cluster_not_available',
      customerId: 22092,
      reason: 'insufficient_repeat_purchase_history',
      contractVersion: 'customer-cluster-runtime-v1',
    }));
    const response = await fetch(`${baseUrl}/v1/customers/22092/cluster`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ reason: 'insufficient_repeat_purchase_history' });
  });

  it('returns 503 when clustering is not configured', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'degraded',
      customerId: 22066,
      reason: 'cluster_not_configured',
      contractVersion: 'customer-cluster-runtime-v1',
    }));
    const response = await fetch(`${baseUrl}/v1/customers/22066/cluster`);
    expect(response.status).toBe(503);
  });

  it('returns 503 when no cluster snapshot has ever been published', async () => {
    const baseUrl = await startApp(async () => ({
      status: 'degraded',
      customerId: 22066,
      reason: 'no_published_cluster_snapshot',
      contractVersion: 'customer-cluster-runtime-v1',
    }));
    expect((await fetch(`${baseUrl}/v1/customers/22066/cluster`)).status).toBe(503);
  });

  it('returns 400 for a non-numeric customerId', async () => {
    const baseUrl = await startApp(async () => availableResult);
    const response = await fetch(`${baseUrl}/v1/customers/not-a-number/cluster`);
    expect(response.status).toBe(400);
  });

  it('returns 400 for unsupported query params', async () => {
    const baseUrl = await startApp(async () => availableResult);
    const response = await fetch(`${baseUrl}/v1/customers/22066/cluster?foo=bar`);
    expect(response.status).toBe(400);
  });

  it('returns 500 and logs safely when the use case throws unexpectedly', async () => {
    const baseUrl = await startApp(async () => {
      throw new Error('boom');
    });
    const response = await fetch(`${baseUrl}/v1/customers/22066/cluster`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error' });
  });
});
