import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { RouteDependencies } from '../../src/http/routes/index.js';
import type { CustomerIntelligenceCopilotResponse } from '../../src/domain/customer-intelligence-copilot/index.js';

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

const answered: CustomerIntelligenceCopilotResponse = {
  status: 'answered',
  finalResponseState: 'success',
  answer: 'Cluster 0 tiene 10 clientes.',
  analysis: {
    contractVersion: 'customer-intelligence-copilot-v1',
    analysisPlanVersion: 'customer-intelligence-copilot-analysis-plan-v1',
    finalResponseState: 'success',
    queryCount: 1,
    queryPlanHashes: ['a'.repeat(64)],
    resultRowCount: 1,
    executionDurationMs: 12,
    plannerModel: 'fake:planner',
    answerModel: 'fake:answerer',
  },
  provenance: {
    featureSnapshot: { snapshotId: '17', referenceTime: '2026-08-19T00:00:00.000Z', featureVersion: 'customer-analytics-features-v1', populationPolicyVersion: 'customer-analytics-population-b-v1' },
    rfmSnapshot: null,
    clusterSnapshot: { snapshotId: '5', referenceTime: '2026-08-18T00:00:00.000Z', modelId: '2', modelVersion: 'behavioral-kmeans-k4-v1' },
    population: { featurePopulation: 10, rfmMatched: 0, clusterMatched: 4, bothMatched: 0, neitherMatched: 6, rfmCoveragePct: 0, clusterCoveragePct: 40 },
    contractVersion: 'customer-intelligence-read-model-v1',
  },
};

async function post(baseUrl: string, body: unknown, token = 'secret-token-1234'): Promise<Response> {
  return fetch(`${baseUrl}/v1/customer-intelligence/copilot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-copilot-token': token },
    body: JSON.stringify(body),
  });
}

describe('POST /v1/customer-intelligence/copilot', () => {
  it('returns 404 when the feature flag is disabled', async () => {
    const baseUrl = await startApp({});
    const response = await post(baseUrl, { question: 'Cuantos clientes hay?' });
    expect(response.status).toBe(404);
  });

  it('requires the internal token', async () => {
    const baseUrl = await startApp({ marketingCopilot: { enabled: true, internalToken: 'secret-token-1234' }, answerCustomerIntelligenceQuestion: async () => answered });
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/copilot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Cuantos clientes hay?' }),
    });
    expect(response.status).toBe(401);
  });

  it('rejects blank questions and overlong questions before calling the use case', async () => {
    const answerCustomerIntelligenceQuestion = vi.fn(async () => answered);
    const baseUrl = await startApp({ marketingCopilot: { enabled: true, internalToken: 'secret-token-1234' }, answerCustomerIntelligenceQuestion });
    expect((await post(baseUrl, { question: '   ' })).status).toBe(400);
    expect((await post(baseUrl, { question: 'x'.repeat(4001) })).status).toBe(400);
    expect(answerCustomerIntelligenceQuestion).not.toHaveBeenCalled();
  });

  it('returns answered response with provenance and passes only question/featureSnapshotId to the use case', async () => {
    const answerCustomerIntelligenceQuestion = vi.fn(async () => answered);
    const baseUrl = await startApp({ marketingCopilot: { enabled: true, internalToken: 'secret-token-1234' }, answerCustomerIntelligenceQuestion });
    const response = await post(baseUrl, { question: 'Cuantos clientes hay en cada cluster?', featureSnapshotId: '17' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(answered);
    expect(answerCustomerIntelligenceQuestion).toHaveBeenCalledWith({ question: 'Cuantos clientes hay en cada cluster?', featureSnapshotId: '17' });
  });

  it.each([
    [{ status: 'clarification_required', finalResponseState: 'success', message: 'Define criterio.', contractVersion: 'customer-intelligence-copilot-v1' }, 200],
    [{ status: 'unsupported_data', finalResponseState: 'success', message: 'No hay carritos.', contractVersion: 'customer-intelligence-copilot-v1' }, 422],
    [{ status: 'unsupported_operation', finalResponseState: 'success', message: 'Mediana no soportada.', contractVersion: 'customer-intelligence-copilot-v1' }, 422],
    [{ status: 'planner_invalid', finalResponseState: 'failure', errors: ['bad plan'], contractVersion: 'customer-intelligence-copilot-v1' }, 502],
    [{ status: 'analytics_unavailable', finalResponseState: 'failure', message: 'down', contractVersion: 'customer-intelligence-copilot-v1' }, 503],
    [{ status: 'analytics_timeout', finalResponseState: 'failure', message: 'timeout', contractVersion: 'customer-intelligence-copilot-v1' }, 504],
    [{ status: 'answer_generation_failed', finalResponseState: 'failure', message: 'bad answer', contractVersion: 'customer-intelligence-copilot-v1' }, 502],
  ] satisfies readonly [CustomerIntelligenceCopilotResponse, number][])('maps %s to HTTP %s', async (result, expectedStatus) => {
    const baseUrl = await startApp({ marketingCopilot: { enabled: true, internalToken: 'secret-token-1234' }, answerCustomerIntelligenceQuestion: async () => result });
    const response = await post(baseUrl, { question: 'Pregunta' });
    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toEqual(result);
  });
});
