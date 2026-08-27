import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { RouteDependencies } from '../../src/http/routes/index.js';
import type { DashboardIntersectionResult } from '../../src/domain/customer-intelligence-dashboard/index.js';

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
  getDashboardIntersection: async () => { throw new Error('unreachable'); },
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

const context = {
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
};

const availableResponse: DashboardIntersectionResult = {
  status: 'available',
  contractVersion: 'customer-intelligence-dashboard-intersection-response-v1',
  context,
  intersection: {
    matchingPopulation: 30,
    featurePopulation: 100,
    rfmMatchedPopulation: 40,
    clusterMatchedPopulation: 35,
    bothMatchedPopulation: 20,
    rfmCoveragePct: 40,
    clusterCoveragePct: 35,
    requiredDimensions: ['rfm'],
  },
  metrics: {
    totalSpentTaxIncl: '900000.000000',
    averageOrderValueTaxIncl: '10000.000000',
    averageTotalSpentTaxIncl: '30000.000000',
    averageValidOrders: '3.000000',
    averageOrders365d: '1.500000',
    averageDaysSinceLastOrder: '10.000000',
    averagePurchaseFrequencyDays: '45.000000',
    purchaseFrequencyDaysSampleSize: 25,
    averageEffectiveDiversity: '1.800000',
    averageRepeatProductRate: '0.400000',
  },
  analyticalDefinition: { queryPlanHash: 'a'.repeat(64), filters: { field: 'rfm.segmentCode', operator: 'eq', value: 'CHAMPION' } },
  execution: { queryCount: 2, filterLeafCount: 1, filterDepth: 1 },
};

const zeroResponse: DashboardIntersectionResult = {
  ...availableResponse,
  intersection: { ...availableResponse.intersection, matchingPopulation: 0 },
  metrics: {
    totalSpentTaxIncl: '0.000000',
    averageOrderValueTaxIncl: null,
    averageTotalSpentTaxIncl: null,
    averageValidOrders: null,
    averageOrders365d: null,
    averageDaysSinceLastOrder: null,
    averagePurchaseFrequencyDays: null,
    purchaseFrequencyDaysSampleSize: 0,
    averageEffectiveDiversity: null,
    averageRepeatProductRate: null,
  },
  execution: { queryCount: 1, filterLeafCount: 1, filterDepth: 1 },
};

async function post(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/v1/customer-intelligence/dashboard/intersections`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /v1/customer-intelligence/dashboard/intersections', () => {
  it('returns 200 with the intersection result for a valid request', async () => {
    const getDashboardIntersection = vi.fn(async () => availableResponse);
    const baseUrl = await startApp({ getDashboardIntersection });
    const response = await post(baseUrl, { filters: { field: 'rfm.segmentCode', operator: 'eq', value: 'CHAMPION' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(availableResponse);
    expect(getDashboardIntersection).toHaveBeenCalledWith({ featureSnapshotId: null, filters: { field: 'rfm.segmentCode', operator: 'eq', value: 'CHAMPION' } });
  });

  it('returns 200 with matchingPopulation: 0 for a valid filter matching nobody (not a 404)', async () => {
    const baseUrl = await startApp({ getDashboardIntersection: async () => zeroResponse });
    const response = await post(baseUrl, { filters: { field: 'commercial.validOrders', operator: 'gt', value: 999999 } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as DashboardIntersectionResult;
    expect(body.status).toBe('available');
    if (body.status === 'available') expect(body.intersection.matchingPopulation).toBe(0);
  });

  it('passes an explicit featureSnapshotId through', async () => {
    const getDashboardIntersection = vi.fn(async () => availableResponse);
    const baseUrl = await startApp({ getDashboardIntersection });
    await post(baseUrl, { featureSnapshotId: '17', filters: { field: 'cluster.clusterId', operator: 'eq', value: 3 } });
    expect(getDashboardIntersection).toHaveBeenCalledWith({ featureSnapshotId: '17', filters: { field: 'cluster.clusterId', operator: 'eq', value: 3 } });
  });

  it('returns 400 for a malformed body (unknown top-level key)', async () => {
    const baseUrl = await startApp({});
    const response = await post(baseUrl, { filters: {}, unknownKey: true });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_dashboard_intersection_request' });
  });

  it('returns 400 for an invalid (non-numeric) featureSnapshotId', async () => {
    const baseUrl = await startApp({});
    const response = await post(baseUrl, { featureSnapshotId: 'not-a-number', filters: {} });
    expect(response.status).toBe(400);
  });

  it('returns 400 for unsupported query params', async () => {
    const baseUrl = await startApp({});
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/dashboard/intersections?foo=bar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  it('returns 400 invalid_intersection for a filter validation error', async () => {
    const baseUrl = await startApp({
      getDashboardIntersection: async () => ({
        status: 'invalid_intersection',
        errors: ['unknown field: rfm.doesNotExist'],
        contractVersion: 'customer-intelligence-dashboard-intersection-response-v1',
      }),
    });
    const response = await post(baseUrl, { filters: { field: 'rfm.doesNotExist', operator: 'eq', value: 'X' } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ status: 'invalid_intersection', errors: ['unknown field: rfm.doesNotExist'] });
  });

  it('returns 503 when the analytics DB is unavailable/not configured', async () => {
    const baseUrl = await startApp({
      getDashboardIntersection: async () => ({
        status: 'degraded',
        reason: 'dashboard_not_configured',
        contractVersion: 'customer-intelligence-dashboard-intersection-response-v1',
      }),
    });
    const response = await post(baseUrl, { filters: {} });
    expect(response.status).toBe(503);
  });

  it('returns 404 when a filter requires an RFM snapshot that is unavailable', async () => {
    const baseUrl = await startApp({
      getDashboardIntersection: async () => ({
        status: 'required_rfm_snapshot_unavailable',
        context,
        contractVersion: 'customer-intelligence-dashboard-intersection-response-v1',
      }),
    });
    const response = await post(baseUrl, { filters: { field: 'rfm.segmentCode', operator: 'eq', value: 'CHAMPION' } });
    expect(response.status).toBe(404);
  });

  it('returns 404 when a filter requires a cluster snapshot that is unavailable', async () => {
    const baseUrl = await startApp({
      getDashboardIntersection: async () => ({
        status: 'required_cluster_snapshot_unavailable',
        context,
        contractVersion: 'customer-intelligence-dashboard-intersection-response-v1',
      }),
    });
    const response = await post(baseUrl, { filters: { field: 'cluster.clusterId', operator: 'eq', value: 3 } });
    expect(response.status).toBe(404);
  });

  it('returns 404 when no published feature snapshot exists', async () => {
    const baseUrl = await startApp({
      getDashboardIntersection: async () => ({ status: 'no_published_feature_snapshot', contractVersion: 'customer-intelligence-dashboard-intersection-response-v1' }),
    });
    const response = await post(baseUrl, { filters: {} });
    expect(response.status).toBe(404);
  });
});
