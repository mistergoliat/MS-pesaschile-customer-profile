import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { RouteDependencies } from '../../src/http/routes/index.js';
import type {
  DashboardClustersResult,
  DashboardContextResult,
  DashboardOverviewResult,
  DashboardRfmResult,
} from '../../src/domain/customer-intelligence-dashboard/index.js';

let server: Server | undefined;

const baseDeps: RouteDependencies = {
  getCustomerProfile: async () => { throw new Error('unreachable'); },
  getCustomerOrderStatus: async () => { throw new Error('unreachable'); },
  getCustomerCommercialSummary: async () => { throw new Error('unreachable'); },
  getCustomerPurchasedProducts: async () => { throw new Error('unreachable'); },
  getCustomerPurchaseBehavior: async () => { throw new Error('unreachable'); },
  getCustomerRfm: async () => { throw new Error('unreachable'); },
  getCustomerRfmByCustomerId: async () => { throw new Error('unreachable'); },
  getCustomerCluster: async () => { throw new Error('unreachable'); },
  getClusterSnapshotSummary: async () => { throw new Error('unreachable'); },
  getRfmClusterCrossTab: async () => { throw new Error('unreachable'); },
  getDashboardContext: async () => { throw new Error('unreachable'); },
  getDashboardOverview: async () => { throw new Error('unreachable'); },
  getDashboardRfm: async () => { throw new Error('unreachable'); },
  getDashboardClusters: async () => { throw new Error('unreachable'); },
  checkReadiness: async () => ({ crm: false, prestashop: { status: 'ready' } }),
};

async function startApp(overrides: Partial<RouteDependencies>): Promise<string> {
  const app = buildApp({ ...baseDeps, ...overrides });
  server = createServer(app);
  await new Promise<void>((resolve) => server?.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind test server');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => server?.close((error) => (error ? reject(error) : resolve())));
    server = undefined;
  }
  vi.restoreAllMocks();
});

const availableContext: DashboardContextResult = {
  status: 'available',
  contractVersion: 'customer-intelligence-dashboard-context-v1',
  context: {
    featureSnapshotId: '17',
    featureReferenceTime: '2026-08-19T00:00:00.000Z',
    featureVersion: 'customer-analytics-features-v1',
    populationPolicyVersion: 'customer-analytics-population-b-v1',
    rfmSnapshotId: '9',
    rfmReferenceTime: '2026-08-18T00:00:00.000Z',
    rfmCalculationVersion: 'rfm-v1',
    clusterSnapshotId: '5',
    clusterReferenceTime: '2026-08-17T00:00:00.000Z',
    clusterModelVersion: 'behavioral-kmeans-k4-v1',
    clusterInterpretationVersion: 'v1',
  },
  population: { featurePopulation: 100, rfmMatched: 40, clusterMatched: 35, bothMatched: 20, neitherMatched: 45, rfmCoveragePct: 40, clusterCoveragePct: 35 },
};

const availableOverview: DashboardOverviewResult = {
  status: 'available',
  contractVersion: 'customer-intelligence-dashboard-overview-v1',
  context: availableContext.status === 'available' ? availableContext.context : (undefined as never),
  population: availableContext.status === 'available' ? availableContext.population : (undefined as never),
  commercial: {
    totalSpentTaxIncl: '1000000.000000',
    totalValidOrders: 250,
    averageOrderValueTaxIncl: '4000.000000',
    averageValidOrders: '2.5000',
    averageOrders365d: '1.2000',
    averageDaysSinceLastOrder: '30.0000',
    averagePurchaseFrequencyDays: '45.5000',
    purchaseFrequencyDaysSampleSize: 60,
  },
};

const availableRfm: DashboardRfmResult = {
  status: 'available',
  contractVersion: 'customer-intelligence-dashboard-rfm-v1',
  context: availableContext.status === 'available' ? availableContext.context : (undefined as never),
  analyzedPopulation: 40,
  fullFeaturePopulation: 100,
  coveragePct: 40,
  segments: [],
};

const availableClusters: DashboardClustersResult = {
  status: 'available',
  contractVersion: 'customer-intelligence-dashboard-clusters-v1',
  context: availableContext.status === 'available' ? availableContext.context : (undefined as never),
  analyzedPopulation: 35,
  fullFeaturePopulation: 100,
  coveragePct: 35,
  rfmCrossSectionAvailable: true,
  clusters: [],
};

describe('GET /v1/customer-intelligence/dashboard/context', () => {
  it('returns 200 with the resolved context', async () => {
    const getDashboardContext = vi.fn(async () => availableContext);
    const baseUrl = await startApp({ getDashboardContext });
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/dashboard/context`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(availableContext);
    expect(getDashboardContext).toHaveBeenCalledWith({ featureSnapshotId: null });
  });

  it('passes an explicit ?featureSnapshotId= through to the pinning input', async () => {
    const getDashboardContext = vi.fn(async () => availableContext);
    const baseUrl = await startApp({ getDashboardContext });
    await fetch(`${baseUrl}/v1/customer-intelligence/dashboard/context?featureSnapshotId=17`);
    expect(getDashboardContext).toHaveBeenCalledWith({ featureSnapshotId: '17' });
  });

  it('returns 404 when no published feature snapshot exists', async () => {
    const baseUrl = await startApp({
      getDashboardContext: async () => ({ status: 'no_published_feature_snapshot', contractVersion: 'customer-intelligence-dashboard-context-v1' }),
    });
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/dashboard/context`);
    expect(response.status).toBe(404);
  });

  it('returns 503 when the dashboard is not configured', async () => {
    const baseUrl = await startApp({
      getDashboardContext: async () => ({ status: 'degraded', reason: 'dashboard_not_configured', contractVersion: 'customer-intelligence-dashboard-context-v1' }),
    });
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/dashboard/context`);
    expect(response.status).toBe(503);
  });

  it('returns 400 for an unsupported query param', async () => {
    const baseUrl = await startApp({});
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/dashboard/context?foo=bar`);
    expect(response.status).toBe(400);
  });
});

describe('GET /v1/customer-intelligence/dashboard/overview', () => {
  it('returns 200 with population and commercial KPIs', async () => {
    const getDashboardOverview = vi.fn(async () => availableOverview);
    const baseUrl = await startApp({ getDashboardOverview });
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/dashboard/overview`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(availableOverview);
  });
});

describe('GET /v1/customer-intelligence/dashboard/rfm', () => {
  it('returns 200 with the RFM distribution', async () => {
    const baseUrl = await startApp({ getDashboardRfm: async () => availableRfm });
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/dashboard/rfm`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(availableRfm);
  });

  it('returns 404 when no compatible RFM snapshot exists (never a generic 500/503)', async () => {
    const baseUrl = await startApp({
      getDashboardRfm: async () => ({
        status: 'no_compatible_rfm_snapshot',
        context: availableContext.status === 'available' ? availableContext.context : (undefined as never),
        contractVersion: 'customer-intelligence-dashboard-rfm-v1',
      }),
    });
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/dashboard/rfm`);
    expect(response.status).toBe(404);
  });
});

describe('GET /v1/customer-intelligence/dashboard/clusters', () => {
  it('returns 200 with the cluster distribution', async () => {
    const baseUrl = await startApp({ getDashboardClusters: async () => availableClusters });
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/dashboard/clusters`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(availableClusters);
  });

  it('returns 404 when no compatible cluster snapshot exists', async () => {
    const baseUrl = await startApp({
      getDashboardClusters: async () => ({
        status: 'no_compatible_cluster_snapshot',
        context: availableContext.status === 'available' ? availableContext.context : (undefined as never),
        contractVersion: 'customer-intelligence-dashboard-clusters-v1',
      }),
    });
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/dashboard/clusters`);
    expect(response.status).toBe(404);
  });
});
