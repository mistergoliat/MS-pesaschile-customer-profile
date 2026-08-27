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
import type {
  GetClusterSnapshotSummaryResult,
  GetRfmClusterCrossTabResult,
} from '../../src/domain/customer-clustering/index.js';
import type { ReadinessCheck } from '../../src/http/routes/index.js';

let server: Server | undefined;

const unreachableGetCustomerProfile: GetCustomerProfile = async () => {
  throw new Error('getCustomerProfile must not be called from the cluster analytics route tests');
};
const unreachableGetCustomerOrderStatus: GetCustomerOrderStatus = async () => {
  throw new Error('getCustomerOrderStatus must not be called from the cluster analytics route tests');
};
const unreachableGetCustomerCommercialSummary: GetCustomerCommercialSummary = async () => {
  throw new Error('getCustomerCommercialSummary must not be called from the cluster analytics route tests');
};
const unreachableGetCustomerPurchasedProducts: GetCustomerPurchasedProducts = async () => {
  throw new Error('getCustomerPurchasedProducts must not be called from the cluster analytics route tests');
};
const unreachableGetCustomerPurchaseBehavior: GetCustomerPurchaseBehavior = async () => {
  throw new Error('getCustomerPurchaseBehavior must not be called from the cluster analytics route tests');
};
const unreachableGetCustomerRfm: GetCustomerRfm = async () => {
  throw new Error('getCustomerRfm must not be called from the cluster analytics route tests');
};
const unreachableGetCustomerRfmByCustomerId: GetCustomerRfmByCustomerId = async () => {
  throw new Error('getCustomerRfmByCustomerId must not be called from the cluster analytics route tests');
};
const unreachableGetCustomerCluster: GetCustomerCluster = async () => {
  throw new Error('getCustomerCluster must not be called from the cluster analytics route tests');
};
const unreachableGetDashboardContext: GetDashboardContext = async () => {
  throw new Error('getDashboardContext must not be called from the cluster analytics route tests');
};
const unreachableGetDashboardOverview: GetDashboardOverview = async () => {
  throw new Error('getDashboardOverview must not be called from the cluster analytics route tests');
};
const unreachableGetDashboardRfm: GetDashboardRfm = async () => {
  throw new Error('getDashboardRfm must not be called from the cluster analytics route tests');
};
const unreachableGetDashboardClusters: GetDashboardClusters = async () => {
  throw new Error('getDashboardClusters must not be called from the cluster analytics route tests');
};
const unreachableGetDashboardIntersection: GetDashboardIntersection = async () => {
  throw new Error('getDashboardIntersection must not be called from the cluster analytics route tests');
};

async function startApp(
  getClusterSnapshotSummary: GetClusterSnapshotSummary,
  getRfmClusterCrossTab: GetRfmClusterCrossTab,
): Promise<string> {
  const checkReadiness: ReadinessCheck = async () => ({ crm: false, prestashop: { status: 'ready' } });
  const app = buildApp({
    getCustomerProfile: unreachableGetCustomerProfile,
    getCustomerOrderStatus: unreachableGetCustomerOrderStatus,
    getCustomerCommercialSummary: unreachableGetCustomerCommercialSummary,
    getCustomerPurchasedProducts: unreachableGetCustomerPurchasedProducts,
    getCustomerPurchaseBehavior: unreachableGetCustomerPurchaseBehavior,
    getCustomerRfm: unreachableGetCustomerRfm,
    getCustomerRfmByCustomerId: unreachableGetCustomerRfmByCustomerId,
    getCustomerCluster: unreachableGetCustomerCluster,
    getClusterSnapshotSummary,
    getRfmClusterCrossTab,
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

const availableSummary: GetClusterSnapshotSummaryResult = {
  status: 'available',
  contractVersion: 'customer-cluster-analytics-v1',
  snapshot: {
    snapshotId: '1',
    referenceTime: '2026-08-19T21:20:00.000Z',
    publishedAt: '2026-08-19T21:25:00.000Z',
    populationSize: 10147,
    status: 'published',
  },
  model: {
    modelVersion: 'behavioral-kmeans-k4-v1',
    algorithm: 'kmeans',
    k: 4,
    featureVersion: 'behavioral-clustering-features-v1',
    preprocessingVersion: 'behavioral-clustering-preprocessing-v1',
    temporalStabilityStatus: 'not_yet_validated',
    metrics: {
      silhouette: 0.2292,
      daviesBouldin: 1.3348,
      calinskiHarabasz: 2000,
      seedAriMean: 0.9926,
      seedAriMin: 0.987,
      resampleAriMean: 0.9807,
      resampleAriMin: 0.9471,
    },
  },
  clusters: [],
};

const availableCrossTab: GetRfmClusterCrossTabResult = {
  status: 'available',
  contractVersion: 'customer-cluster-analytics-v1',
  clusterSnapshot: { snapshotId: '1', referenceTime: '2026-08-19T21:20:00.000Z' },
  rfmSnapshot: { snapshotId: '9', referenceTime: '2026-08-18T00:00:00.000Z' },
  coverage: { clusterPopulation: 6, comparablePopulation: 5, unmatchedPopulation: 1, coveragePct: 83.33 },
  rows: [],
};

const unreachableSummary: GetClusterSnapshotSummary = async () => {
  throw new Error('getClusterSnapshotSummary must not be called for this test');
};
const unreachableCrossTab: GetRfmClusterCrossTab = async () => {
  throw new Error('getRfmClusterCrossTab must not be called for this test');
};

describe('GET /v1/clustering/snapshots/latest/summary', () => {
  it('returns 200 with the summary and passes snapshotId: null', async () => {
    const getClusterSnapshotSummary = vi.fn(async () => availableSummary);
    const baseUrl = await startApp(getClusterSnapshotSummary, unreachableCrossTab);
    const response = await fetch(`${baseUrl}/v1/clustering/snapshots/latest/summary`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(availableSummary);
    expect(getClusterSnapshotSummary).toHaveBeenCalledWith({ snapshotId: null });
  });

  it('returns 404 when no cluster snapshot has ever been published', async () => {
    const baseUrl = await startApp(
      async () => ({ status: 'no_published_cluster_snapshot', contractVersion: 'customer-cluster-analytics-v1' }),
      unreachableCrossTab,
    );
    const response = await fetch(`${baseUrl}/v1/clustering/snapshots/latest/summary`);
    expect(response.status).toBe(404);
  });

  it('returns 503 when clustering is degraded', async () => {
    const baseUrl = await startApp(
      async () => ({ status: 'degraded', reason: 'cluster_analytics_unavailable', contractVersion: 'customer-cluster-analytics-v1' }),
      unreachableCrossTab,
    );
    const response = await fetch(`${baseUrl}/v1/clustering/snapshots/latest/summary`);
    expect(response.status).toBe(503);
  });

  it('returns 400 for unsupported query params', async () => {
    const baseUrl = await startApp(unreachableSummary, unreachableCrossTab);
    const response = await fetch(`${baseUrl}/v1/clustering/snapshots/latest/summary?foo=bar`);
    expect(response.status).toBe(400);
  });
});

describe('GET /v1/clustering/snapshots/:snapshotId/summary', () => {
  it('returns 200 and passes the parsed numeric snapshotId', async () => {
    const getClusterSnapshotSummary = vi.fn(async () => availableSummary);
    const baseUrl = await startApp(getClusterSnapshotSummary, unreachableCrossTab);
    const response = await fetch(`${baseUrl}/v1/clustering/snapshots/1/summary`);
    expect(response.status).toBe(200);
    expect(getClusterSnapshotSummary).toHaveBeenCalledWith({ snapshotId: '1' });
  });

  it('returns 404 cluster_snapshot_not_found for an unknown id', async () => {
    const baseUrl = await startApp(
      async () => ({ status: 'cluster_snapshot_not_found', snapshotId: '999', contractVersion: 'customer-cluster-analytics-v1' }),
      unreachableCrossTab,
    );
    const response = await fetch(`${baseUrl}/v1/clustering/snapshots/999/summary`);
    expect(response.status).toBe(404);
  });

  it('returns 400 invalid_snapshot_id for a non-numeric id', async () => {
    const baseUrl = await startApp(unreachableSummary, unreachableCrossTab);
    const response = await fetch(`${baseUrl}/v1/clustering/snapshots/abc/summary`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_snapshot_id' });
  });

  it('returns 400 invalid_snapshot_id for "0"', async () => {
    const baseUrl = await startApp(unreachableSummary, unreachableCrossTab);
    const response = await fetch(`${baseUrl}/v1/clustering/snapshots/0/summary`);
    expect(response.status).toBe(400);
  });
});

describe('GET /v1/clustering/snapshots/latest/rfm-cross-tab', () => {
  it('returns 200 with the cross-tab and passes snapshotId: null', async () => {
    const getRfmClusterCrossTab = vi.fn(async () => availableCrossTab);
    const baseUrl = await startApp(unreachableSummary, getRfmClusterCrossTab);
    const response = await fetch(`${baseUrl}/v1/clustering/snapshots/latest/rfm-cross-tab`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(availableCrossTab);
    expect(getRfmClusterCrossTab).toHaveBeenCalledWith({ snapshotId: null });
  });

  it('returns 404 when there is no compatible RFM snapshot, without touching cluster summary', async () => {
    const baseUrl = await startApp(
      unreachableSummary,
      async () => ({
        status: 'no_compatible_rfm_snapshot',
        clusterSnapshot: { snapshotId: '1', referenceTime: '2026-08-19T21:20:00.000Z' },
        contractVersion: 'customer-cluster-analytics-v1',
      }),
    );
    const response = await fetch(`${baseUrl}/v1/clustering/snapshots/latest/rfm-cross-tab`);
    expect(response.status).toBe(404);
  });

  it('returns 503 when RFM is unavailable', async () => {
    const baseUrl = await startApp(unreachableSummary, async () => ({
      status: 'degraded',
      reason: 'rfm_unavailable',
      contractVersion: 'customer-cluster-analytics-v1',
    }));
    const response = await fetch(`${baseUrl}/v1/clustering/snapshots/latest/rfm-cross-tab`);
    expect(response.status).toBe(503);
  });
});
