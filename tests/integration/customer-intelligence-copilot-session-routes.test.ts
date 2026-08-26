import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { RouteDependencies } from '../../src/http/routes/index.js';
import type { CustomerIntelligenceCopilotSessionService } from '../../src/application/customer-intelligence-copilot-session/index.js';

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
  checkReadiness: async () => ({ crm: false, prestashop: { status: 'ready' } }),
  marketingCopilot: { enabled: true, internalToken: 'secret-token-1234' },
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

function authHeaders(extra: Record<string, string> = {}) {
  return { 'content-type': 'application/json', 'x-internal-copilot-token': 'secret-token-1234', ...extra };
}

function fakeService(overrides: Partial<CustomerIntelligenceCopilotSessionService> = {}): CustomerIntelligenceCopilotSessionService {
  return {
    createSession: vi.fn(async () => ({
      status: 'created',
      session: {
        sessionId: '00000000-0000-4000-8000-000000000001',
        sessionVersion: 'customer-intelligence-copilot-session-v1',
        createdAt: '2026-08-20T12:00:00.000Z',
        lastActivityAt: '2026-08-20T12:00:00.000Z',
        expiresAt: '2026-08-20T13:00:00.000Z',
        pinnedContext: {
          featureSnapshot: { snapshotId: '17', referenceTime: '2026-08-19T00:00:00.000Z', featureVersion: 'customer-analytics-features-v1', populationPolicyVersion: 'customer-analytics-population-b-v1' },
          rfmSnapshot: null,
          clusterSnapshot: null,
          population: { featurePopulation: 10, rfmMatched: 0, clusterMatched: 0, bothMatched: 0, neitherMatched: 10, rfmCoveragePct: 0, clusterCoveragePct: 0 },
          contractVersion: 'customer-intelligence-read-model-v1',
        },
        turnCount: 0,
        resultCount: 0,
      },
    })),
    listSessions: vi.fn(async () => ({
      status: 'ok',
      sessions: [
        {
          sessionId: '00000000-0000-4000-8000-000000000001',
          sessionVersion: 'customer-intelligence-copilot-session-v1',
          createdAt: '2026-08-20T12:00:00.000Z',
          lastActivityAt: '2026-08-20T12:00:00.000Z',
          expiresAt: '2026-08-20T13:00:00.000Z',
          status: 'active',
          title: null,
          summary: null,
          pinnedContext: {
            featureSnapshot: { snapshotId: '17', referenceTime: '2026-08-19T00:00:00.000Z', featureVersion: 'customer-analytics-features-v1', populationPolicyVersion: 'customer-analytics-population-b-v1' },
            rfmSnapshot: null,
            clusterSnapshot: null,
            population: { featurePopulation: 10, rfmMatched: 0, clusterMatched: 0, bothMatched: 0, neitherMatched: 10, rfmCoveragePct: 0, clusterCoveragePct: 0 },
            contractVersion: 'customer-intelligence-read-model-v1',
          },
          turnCount: 0,
          resultCount: 0,
        },
      ],
    })),
    getSession: vi.fn(async () => ({
      status: 'ok',
      session: {
        sessionId: '00000000-0000-4000-8000-000000000001',
        sessionVersion: 'customer-intelligence-copilot-session-v1',
        createdAt: '2026-08-20T12:00:00.000Z',
        lastActivityAt: '2026-08-20T12:00:00.000Z',
        expiresAt: '2026-08-20T13:00:00.000Z',
        status: 'active',
        title: null,
        summary: null,
        pinnedContext: {
          featureSnapshot: { snapshotId: '17', referenceTime: '2026-08-19T00:00:00.000Z', featureVersion: 'customer-analytics-features-v1', populationPolicyVersion: 'customer-analytics-population-b-v1' },
          rfmSnapshot: null,
          clusterSnapshot: null,
          population: { featurePopulation: 10, rfmMatched: 0, clusterMatched: 0, bothMatched: 0, neitherMatched: 10, rfmCoveragePct: 0, clusterCoveragePct: 0 },
          contractVersion: 'customer-intelligence-read-model-v1',
        },
        turnCount: 0,
        resultCount: 0,
        turns: [],
        analyticalReferences: [],
      },
    })),
    processSessionTurn: vi.fn(async () => ({
      status: 'ok',
      sessionContext: {
        contextVersion: 'customer-intelligence-copilot-session-context-v1',
        pinnedContext: {
          featureSnapshot: { snapshotId: '17', referenceTime: '2026-08-19T00:00:00.000Z', featureVersion: 'customer-analytics-features-v1', populationPolicyVersion: 'customer-analytics-population-b-v1' },
          rfmSnapshot: null,
          clusterSnapshot: null,
          population: { featurePopulation: 10, rfmMatched: 0, clusterMatched: 0, bothMatched: 0, neitherMatched: 10, rfmCoveragePct: 0, clusterCoveragePct: 0 },
          contractVersion: 'customer-intelligence-read-model-v1',
        },
        recentTurns: [],
        analyticalReferences: [],
        recentResults: [],
      },
      response: {
        sessionId: '00000000-0000-4000-8000-000000000001',
        turnId: '00000000-0000-4000-8000-000000000002',
        queryIds: ['q1'],
        sourceQueryIds: [],
        status: 'answered',
        finalResponseState: 'success',
        answer: 'Hay 10 clientes.',
        analysis: {
          contractVersion: 'customer-intelligence-copilot-v1',
          analysisPlanVersion: 'customer-intelligence-copilot-analysis-plan-v1',
          finalResponseState: 'success',
          queryCount: 1,
          queryPlanHashes: ['a'.repeat(64)],
          resultRowCount: 1,
          executionDurationMs: 7,
          plannerModel: 'fake:planner',
          answerModel: 'fake:answerer',
        },
        provenance: {
          featureSnapshot: { snapshotId: '17', referenceTime: '2026-08-19T00:00:00.000Z', featureVersion: 'customer-analytics-features-v1', populationPolicyVersion: 'customer-analytics-population-b-v1' },
          rfmSnapshot: null,
          clusterSnapshot: null,
          population: { featurePopulation: 10, rfmMatched: 0, clusterMatched: 0, bothMatched: 0, neitherMatched: 10, rfmCoveragePct: 0, clusterCoveragePct: 0 },
          contractVersion: 'customer-intelligence-read-model-v1',
        },
      },
    })),
    refreshSessionContext: vi.fn(async () => ({ status: 'session_not_found' })),
    resetSession: vi.fn(async () => ({ status: 'session_not_found' })),
    deleteSession: vi.fn(async () => ({ status: 'session_not_found' })),
    exportSessionQuery: vi.fn(async () => ({
      status: 'ok',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'customer-intelligence-2026-08-20T120000Z.xlsx',
      buffer: Buffer.from('PK-test-xlsx'),
      metadata: {
        sessionId: '00000000-0000-4000-8000-000000000001',
        queryId: 'q1',
        queryPlanHash: 'a'.repeat(64),
        rowCount: 1,
        durationMs: 7,
        exportComplete: true,
      },
    })),
    ...overrides,
  } as unknown as CustomerIntelligenceCopilotSessionService;
}

describe('Customer Intelligence Copilot session HTTP routes', () => {
  it('creates sessions behind the existing internal gate', async () => {
    const service = fakeService();
    const baseUrl = await startApp({ customerIntelligenceCopilotSessionService: service });
    const unauthorized = await fetch(`${baseUrl}/v1/customer-intelligence/copilot/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(unauthorized.status).toBe(401);

    const created = await fetch(`${baseUrl}/v1/customer-intelligence/copilot/sessions`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ featureSnapshotId: '17' }),
    });
    expect(created.status).toBe(201);
    expect((await created.json()).session.sessionId).toBe('00000000-0000-4000-8000-000000000001');
    expect(service.createSession).toHaveBeenCalledWith({ featureSnapshotId: '17' });
  });

  it('sends session messages and returns queryIds for later export', async () => {
    const service = fakeService();
    const baseUrl = await startApp({ customerIntelligenceCopilotSessionService: service });
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/copilot/sessions/00000000-0000-4000-8000-000000000001/messages`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ question: 'Cuantos clientes hay?' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.queryIds).toEqual(['q1']);
    expect(service.processSessionTurn).toHaveBeenCalledWith({
      sessionId: '00000000-0000-4000-8000-000000000001',
      question: 'Cuantos clientes hay?',
    });
  });

  it('lists and fetches durable session metadata behind the same internal gate', async () => {
    const service = fakeService();
    const baseUrl = await startApp({ customerIntelligenceCopilotSessionService: service });
    const listed = await fetch(`${baseUrl}/v1/customer-intelligence/copilot/sessions?limit=10`, {
      headers: authHeaders(),
    });
    expect(listed.status).toBe(200);
    expect((await listed.json()).sessions[0].sessionId).toBe('00000000-0000-4000-8000-000000000001');

    const fetched = await fetch(`${baseUrl}/v1/customer-intelligence/copilot/sessions/00000000-0000-4000-8000-000000000001`, {
      headers: authHeaders(),
    });
    expect(fetched.status).toBe(200);
    expect((await fetched.json()).session.turns).toEqual([]);
    expect(service.listSessions).toHaveBeenCalledWith(10);
    expect(service.getSession).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001');
  });

  it('returns XLSX attachment headers for session-owned exports', async () => {
    const service = fakeService();
    const baseUrl = await startApp({ customerIntelligenceCopilotSessionService: service });
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/copilot/sessions/00000000-0000-4000-8000-000000000001/export`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ queryId: 'q1', format: 'xlsx' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(response.headers.get('content-disposition')).toContain('attachment; filename="customer-intelligence-2026-08-20T120000Z.xlsx"');
  });

  it('maps expired sessions to 410', async () => {
    const service = fakeService({ processSessionTurn: vi.fn(async () => ({ status: 'session_expired' as const })) });
    const baseUrl = await startApp({ customerIntelligenceCopilotSessionService: service });
    const response = await fetch(`${baseUrl}/v1/customer-intelligence/copilot/sessions/00000000-0000-4000-8000-000000000001/messages`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ question: 'Pregunta' }),
    });
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: 'session_expired' });
  });
});
