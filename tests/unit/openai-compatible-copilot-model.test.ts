import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerateAnalysisPlanInput, GenerateAnswerInput } from '../../src/application/customer-intelligence-copilot/index.js';
import {
  CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_INSTRUCTIONS,
} from '../../src/domain/customer-intelligence-copilot/index.js';
import { CUSTOMER_INTELLIGENCE_QUERY_SCHEMA_VERSION } from '../../src/domain/customer-intelligence-query/contracts.js';
import {
  createConfiguredCustomerIntelligenceCopilotModel,
  createOpenAiCompatibleCopilotModel,
} from '../../src/infrastructure/customer-intelligence-copilot/index.js';

const config = {
  endpoint: 'https://api.vendor.example/chat/completions',
  apiKey: 'secret',
  model: 'vendor-model',
  timeoutMs: 1000,
};

const plan = {
  planVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
  status: 'unsupported_data',
  message: 'No hay datos suficientes.',
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function chatResponse(content: string) {
  return {
    choices: [
      {
        message: { content },
      },
    ],
  };
}

function mockFetchJson(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock as unknown as ReturnType<typeof vi.fn>;
}

function plannerInput(): GenerateAnalysisPlanInput {
  return {
    question: 'Cuantos clientes hay?',
    schema: { schemaVersion: CUSTOMER_INTELLIGENCE_QUERY_SCHEMA_VERSION, readModelVersion: 'r', fields: [] },
    plannerPromptVersion: 'planner-v1',
    maxQueries: 3,
  };
}

function answerInput(): GenerateAnswerInput {
  return {
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
  };
}

function firstPayload(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init, payload: JSON.parse(String(init.body)) as Record<string, unknown> };
}

describe('openai_compatible Customer Intelligence Copilot model adapter', () => {
  it('serializes planner requests as OpenAI-compatible chat completions', async () => {
    const fetchMock = mockFetchJson(chatResponse(JSON.stringify(plan)));
    const model = createOpenAiCompatibleCopilotModel(config);

    const result = await model.generateAnalysisPlan(plannerInput());

    expect(result).toEqual({ plan, metadata: { provider: 'openai_compatible', model: 'vendor-model' } });
    const { url, init, payload } = firstPayload(fetchMock);
    expect(url).toBe(config.endpoint);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret' });
    expect(payload.model).toBe('vendor-model');
    expect(payload.stream).toBe(false);
    expect(payload.response_format).toEqual({ type: 'json_object' });
    expect(payload.messages).toEqual([
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining(CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_INSTRUCTIONS[0]),
      }),
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('"task": "generate_analysis_plan"'),
      }),
    ]);
    expect(String((payload.messages as { content: string }[])[0]?.content)).toMatch(/valid JSON object/);
    expect(JSON.parse(String((payload.messages as { content: string }[])[1]?.content))).toMatchObject({
      input: { question: 'Cuantos clientes hay?', maxQueries: 3 },
      task: 'generate_analysis_plan',
    });
  });

  it('serializes repair requests with previous plan and validation errors', async () => {
    const fetchMock = mockFetchJson(chatResponse(JSON.stringify(plan)));
    const model = createOpenAiCompatibleCopilotModel({ ...config, apiKey: null });

    await model.repairAnalysisPlan({
      ...plannerInput(),
      previousPlan: { bad: true },
      validationErrors: ['query 0 requires a structured AnalyticalQueryPlan'],
    });

    const { init, payload } = firstPayload(fetchMock);
    expect(init.headers).not.toMatchObject({ Authorization: expect.any(String) });
    expect(payload.response_format).toEqual({ type: 'json_object' });
    expect((payload.messages as { content: string }[])[0]?.content).toContain(CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_INSTRUCTIONS[0]);
    const userInput = JSON.parse(String((payload.messages as { content: string }[])[1]?.content));
    expect(userInput.task).toBe('repair_analysis_plan');
    expect(userInput.input.previousPlan).toEqual({ bad: true });
    expect(userInput.input.validationErrors).toEqual(['query 0 requires a structured AnalyticalQueryPlan']);
  });

  it('extracts answer content and returns fixed provider metadata', async () => {
    mockFetchJson(chatResponse('Respuesta grounded.'));
    const model = createOpenAiCompatibleCopilotModel(config);

    const result = await model.generateAnswer(answerInput());

    expect(result).toEqual({
      answer: 'Respuesta grounded.',
      metadata: { provider: 'openai_compatible', model: 'vendor-model' },
    });
  });

  it('throws on HTTP errors', async () => {
    mockFetchJson({ error: 'bad' }, false, 500);
    const model = createOpenAiCompatibleCopilotModel(config);

    await expect(model.generateAnalysisPlan(plannerInput())).rejects.toThrow(/HTTP 500/);
  });

  it('throws when choices are missing', async () => {
    mockFetchJson({});
    const model = createOpenAiCompatibleCopilotModel(config);

    await expect(model.generateAnswer(answerInput())).rejects.toThrow(/no choices/);
  });

  it('throws when the message is missing', async () => {
    mockFetchJson({ choices: [{}] });
    const model = createOpenAiCompatibleCopilotModel(config);

    await expect(model.generateAnswer(answerInput())).rejects.toThrow(/malformed message/);
  });

  it('throws when message content is empty', async () => {
    mockFetchJson(chatResponse('   '));
    const model = createOpenAiCompatibleCopilotModel(config);

    await expect(model.generateAnswer(answerInput())).rejects.toThrow(/empty message content/);
  });

  it('throws when planner content is not valid JSON', async () => {
    mockFetchJson(chatResponse('not json'));
    const model = createOpenAiCompatibleCopilotModel(config);

    await expect(model.generateAnalysisPlan(plannerInput())).rejects.toThrow(/invalid planner JSON/);
  });

  it('aborts requests after the configured timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    const model = createOpenAiCompatibleCopilotModel(config);

    const promise = model.generateAnswer(answerInput());
    const expectation = expect(promise).rejects.toThrow(/aborted/);
    await vi.advanceTimersByTimeAsync(config.timeoutMs);

    await expectation;
  });
});

describe('configured Customer Intelligence Copilot model provider selection', () => {
  it('keeps http_json configured with the existing default model', () => {
    const result = createConfiguredCustomerIntelligenceCopilotModel({
      CUSTOMER_INTELLIGENCE_COPILOT_PROVIDER: 'http_json',
      CUSTOMER_INTELLIGENCE_COPILOT_ENDPOINT: 'https://llm.internal/copilot',
    });

    expect(result.status).toBe('configured');
    expect(result).toMatchObject({ provider: 'http_json', modelName: 'customer-intelligence-copilot' });
  });

  it('selects the openai_compatible adapter', async () => {
    mockFetchJson(chatResponse('Respuesta.'));
    const result = createConfiguredCustomerIntelligenceCopilotModel({
      CUSTOMER_INTELLIGENCE_COPILOT_PROVIDER: 'openai_compatible',
      CUSTOMER_INTELLIGENCE_COPILOT_ENDPOINT: config.endpoint,
      CUSTOMER_INTELLIGENCE_COPILOT_MODEL: config.model,
      CUSTOMER_INTELLIGENCE_COPILOT_API_KEY: config.apiKey,
      CUSTOMER_INTELLIGENCE_COPILOT_TIMEOUT_MS: String(config.timeoutMs),
    });

    expect(result.status).toBe('configured');
    if (result.status !== 'configured') throw new Error('expected configured provider');
    expect(result.provider).toBe('openai_compatible');
    expect(await result.model.generateAnswer(answerInput())).toMatchObject({
      metadata: { provider: 'openai_compatible', model: config.model },
    });
  });

  it('fails closed for unknown providers', () => {
    const result = createConfiguredCustomerIntelligenceCopilotModel({
      CUSTOMER_INTELLIGENCE_COPILOT_PROVIDER: 'unknown',
      CUSTOMER_INTELLIGENCE_COPILOT_ENDPOINT: config.endpoint,
      CUSTOMER_INTELLIGENCE_COPILOT_MODEL: config.model,
    });

    expect(result).toEqual({ status: 'not_configured', reason: 'Unsupported CUSTOMER_INTELLIGENCE_COPILOT_PROVIDER: unknown' });
  });

  it('fails closed when endpoint is missing', () => {
    const result = createConfiguredCustomerIntelligenceCopilotModel({
      CUSTOMER_INTELLIGENCE_COPILOT_PROVIDER: 'openai_compatible',
      CUSTOMER_INTELLIGENCE_COPILOT_MODEL: config.model,
    });

    expect(result).toEqual({ status: 'not_configured', reason: 'CUSTOMER_INTELLIGENCE_COPILOT_ENDPOINT is required for openai_compatible provider' });
  });

  it('fails closed when timeout is invalid', () => {
    const result = createConfiguredCustomerIntelligenceCopilotModel({
      CUSTOMER_INTELLIGENCE_COPILOT_PROVIDER: 'openai_compatible',
      CUSTOMER_INTELLIGENCE_COPILOT_ENDPOINT: config.endpoint,
      CUSTOMER_INTELLIGENCE_COPILOT_MODEL: config.model,
      CUSTOMER_INTELLIGENCE_COPILOT_TIMEOUT_MS: '0',
    });

    expect(result).toEqual({ status: 'not_configured', reason: 'CUSTOMER_INTELLIGENCE_COPILOT_TIMEOUT_MS must be a positive integer' });
  });

  it('fails closed when the OpenAI-compatible model is missing', () => {
    const result = createConfiguredCustomerIntelligenceCopilotModel({
      CUSTOMER_INTELLIGENCE_COPILOT_PROVIDER: 'openai_compatible',
      CUSTOMER_INTELLIGENCE_COPILOT_ENDPOINT: config.endpoint,
    });

    expect(result).toEqual({ status: 'not_configured', reason: 'CUSTOMER_INTELLIGENCE_COPILOT_MODEL is required for openai_compatible provider' });
  });
});
