import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_SESSION_CONTEXT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_UNIFIED_PLANNER_INSTRUCTIONS,
  CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
  CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION,
  serializeAnalyticalQueryContractForCopilot,
} from '../../src/domain/customer-intelligence-copilot/index.js';
import { CUSTOMER_INTELLIGENCE_QUERY_SCHEMA_VERSION } from '../../src/domain/customer-intelligence-query/contracts.js';
import { createHttpJsonCopilotModel } from '../../src/infrastructure/customer-intelligence-copilot/index.js';

const config = {
  endpoint: 'https://llm.internal/copilot',
  apiKey: 'secret',
  model: 'demo-model',
  timeoutMs: 1000,
};

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchJson(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

describe('http_json Customer Intelligence Copilot model adapter', () => {
  it('serializes unified planner requests with the unified instructions', async () => {
    const conversationPlan = {
      version: CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION,
      action: 'run_analytics',
      analyticalQuestion: 'Cuantos clientes hay?',
      analysisPlan: { planVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION, status: 'query_plan', queries: [] },
    };
    const fetchMock = mockFetchJson({ conversationPlan, provider: 'test', model: 'unified' });
    const model = createHttpJsonCopilotModel(config);

    const result = await model.generateConversationPlan!({
      question: 'Cuantos clientes hay?',
      schema: { schemaVersion: CUSTOMER_INTELLIGENCE_QUERY_SCHEMA_VERSION, readModelVersion: 'r', fields: [] },
      queryContract: serializeAnalyticalQueryContractForCopilot(),
      unifiedPlannerPromptVersion: 'unified-planner-v1',
      maxQueries: 3,
      sessionContext: {
        contextVersion: CUSTOMER_INTELLIGENCE_COPILOT_SESSION_CONTEXT_VERSION,
        pinnedContext: {
          featureSnapshot: { snapshotId: '1', referenceTime: '2026-01-01T00:00:00.000Z', featureVersion: 'f', populationPolicyVersion: 'p' },
          rfmSnapshot: null,
          clusterSnapshot: null,
          population: { featurePopulation: 1, rfmMatched: 0, clusterMatched: 0, bothMatched: 0, neitherMatched: 1, rfmCoveragePct: 0, clusterCoveragePct: 0 },
          contractVersion: 'customer-intelligence-read-model-v1',
        },
        recentTurns: [],
        analyticalReferences: [],
        recentResults: [],
        semanticFocus: { activeEntity: null, activeMetric: null, activeComparison: null, unresolvedClarification: null, lastAnalyticalResult: null },
      },
      actionConstraints: {
        decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
        allowedActions: ['run_analytics'],
        answerFromContextAllowed: false,
        availableSourceQueryIds: [],
        sessionReferenceCount: 0,
        sessionResultCount: 0,
        freshBusinessFactQuestion: true,
        rules: [],
        allowedActionEnvelopes: [],
      },
    });

    expect(result.conversationPlan).toEqual(conversationPlan);
    const payload = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(payload.task).toBe('generate_conversation_plan');
    expect(payload.instructions).toEqual(CUSTOMER_INTELLIGENCE_COPILOT_UNIFIED_PLANNER_INSTRUCTIONS);
    expect(payload.input.queryContract.metricSchema.alias.pattern).toBe('^[A-Za-z_][A-Za-z0-9_]*$');
  });

  it('serializes planner requests with instructions, model, and authorization', async () => {
    const fetchMock = mockFetchJson({ plan: { status: 'unsupported_data' }, provider: 'test', model: 'm1' });
    const model = createHttpJsonCopilotModel(config);

    const result = await model.generateAnalysisPlan({
      question: 'Cuantos clientes hay?',
      schema: { schemaVersion: CUSTOMER_INTELLIGENCE_QUERY_SCHEMA_VERSION, readModelVersion: 'r', fields: [] },
      queryContract: serializeAnalyticalQueryContractForCopilot(),
      plannerPromptVersion: 'planner-v1',
      maxQueries: 3,
    });

    expect(result.plan).toEqual({ status: 'unsupported_data' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(config.endpoint);
    expect(init.headers).toMatchObject({ authorization: 'Bearer secret' });
    const payload = JSON.parse(String(init.body));
    expect(payload.task).toBe('generate_analysis_plan');
    expect(payload.model).toBe('demo-model');
    expect(payload.instructions).toEqual(expect.arrayContaining([expect.stringMatching(/Never SQL|never SQL/i)]));
    expect(payload.input.queryContract.metricSchema.alias.pattern).toBe('^[A-Za-z_][A-Za-z0-9_]*$');
  });

  it('serializes repair requests', async () => {
    const fetchMock = mockFetchJson({ plan: { status: 'query_plan', queries: [] } });
    const model = createHttpJsonCopilotModel(config);
    await model.repairAnalysisPlan({
      question: 'q',
      schema: { schemaVersion: CUSTOMER_INTELLIGENCE_QUERY_SCHEMA_VERSION, readModelVersion: 'r', fields: [] },
      queryContract: serializeAnalyticalQueryContractForCopilot(),
      plannerPromptVersion: 'planner-v1',
      maxQueries: 3,
      previousPlan: { bad: true },
      validationErrors: ['bad'],
    });
    const payload = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(payload.task).toBe('repair_analysis_plan');
    expect(payload.input.validationErrors).toEqual(['bad']);
    expect(payload.input.queryContract.modes.row.forbidden).toEqual(['metrics']);
  });

  it('parses answer responses', async () => {
    mockFetchJson({ answer: 'Respuesta grounded.', provider: 'test', model: 'answerer' });
    const model = createHttpJsonCopilotModel(config);
    const result = await model.generateAnswer({
      question: 'q',
      answerPromptVersion: 'answer-v1',
      context: {
        featureSnapshot: { snapshotId: '1', referenceTime: '2026-01-01T00:00:00.000Z', featureVersion: 'f', populationPolicyVersion: 'p' },
        rfmSnapshot: null,
        clusterSnapshot: null,
        population: { featurePopulation: 1, rfmMatched: 0, clusterMatched: 0, bothMatched: 0, neitherMatched: 1, rfmCoveragePct: 0, clusterCoveragePct: 0 },
        contractVersion: 'customer-intelligence-read-model-v1',
      },
      executions: [],
    });
    expect(result.answer).toBe('Respuesta grounded.');
    expect(result.metadata).toEqual(expect.objectContaining({
      provider: 'test',
      model: 'answerer',
      promptCharCount: expect.any(Number),
      responseCharCount: expect.any(Number),
    }));
  });

  it('throws on HTTP errors', async () => {
    mockFetchJson({ error: 'bad' }, false, 500);
    const model = createHttpJsonCopilotModel(config);
    await expect(model.generateAnalysisPlan({ question: 'q', schema: { schemaVersion: CUSTOMER_INTELLIGENCE_QUERY_SCHEMA_VERSION, readModelVersion: 'r', fields: [] }, queryContract: serializeAnalyticalQueryContractForCopilot(), plannerPromptVersion: 'p', maxQueries: 3 })).rejects.toMatchObject({
      category: 'provider_invalid_response',
      metadata: { provider: 'http_json', model: 'demo-model', stage: 'planner', httpStatus: 500 },
    });
  });

  it('throws on malformed answer responses', async () => {
    mockFetchJson({ output: '' });
    const model = createHttpJsonCopilotModel(config);
    await expect(model.generateAnswer({
      question: 'q',
      answerPromptVersion: 'a',
      context: {
        featureSnapshot: { snapshotId: '1', referenceTime: '2026-01-01T00:00:00.000Z', featureVersion: 'f', populationPolicyVersion: 'p' },
        rfmSnapshot: null,
        clusterSnapshot: null,
        population: { featurePopulation: 1, rfmMatched: 0, clusterMatched: 0, bothMatched: 0, neitherMatched: 1, rfmCoveragePct: 0, clusterCoveragePct: 0 },
        contractVersion: 'customer-intelligence-read-model-v1',
      },
      executions: [],
    })).rejects.toMatchObject({
      category: 'provider_invalid_response',
      metadata: { provider: 'http_json', model: 'demo-model', stage: 'answerer' },
    });
  });

  it('classifies malformed answer provider JSON with the answerer stage', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    const model = createHttpJsonCopilotModel(config);
    await expect(model.generateAnswer({
      question: 'q',
      answerPromptVersion: 'a',
      context: {
        featureSnapshot: { snapshotId: '1', referenceTime: '2026-01-01T00:00:00.000Z', featureVersion: 'f', populationPolicyVersion: 'p' },
        rfmSnapshot: null,
        clusterSnapshot: null,
        population: { featurePopulation: 1, rfmMatched: 0, clusterMatched: 0, bothMatched: 0, neitherMatched: 1, rfmCoveragePct: 0, clusterCoveragePct: 0 },
        contractVersion: 'customer-intelligence-read-model-v1',
      },
      executions: [],
    })).rejects.toMatchObject({
      category: 'provider_invalid_response',
      metadata: { provider: 'http_json', model: 'demo-model', stage: 'answerer' },
    });
  });

  it('classifies aborted provider JSON parsing as provider_timeout', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('aborted');
      },
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    const model = createHttpJsonCopilotModel(config);
    await expect(model.generateAnalysisPlan({
      question: 'q',
      schema: { schemaVersion: CUSTOMER_INTELLIGENCE_QUERY_SCHEMA_VERSION, readModelVersion: 'r', fields: [] },
      queryContract: serializeAnalyticalQueryContractForCopilot(),
      plannerPromptVersion: 'p',
      maxQueries: 3,
    })).rejects.toMatchObject({
      category: 'provider_timeout',
      metadata: { provider: 'http_json', model: 'demo-model', stage: 'planner' },
    });
  });
});
