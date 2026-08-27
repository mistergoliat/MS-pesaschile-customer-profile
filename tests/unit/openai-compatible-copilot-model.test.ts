import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerateAnalysisPlanInput, GenerateAnswerInput, GenerateConversationalTurnInput, GenerateConversationDecisionInput, GenerateConversationPlanInput } from '../../src/application/customer-intelligence-copilot/index.js';
import {
  CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_INSTRUCTIONS,
  CUSTOMER_INTELLIGENCE_COPILOT_SESSION_CONTEXT_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_RUN_ANALYTICAL_QUERIES_TOOL,
  CUSTOMER_INTELLIGENCE_COPILOT_UNIFIED_PLANNER_INSTRUCTIONS,
  CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
  CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION,
  serializeAnalyticalQueryContractForCopilot,
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

function chatResponseWithUsage(content: string) {
  return {
    ...chatResponse(content),
    usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
  };
}

function chatToolResponse() {
  return {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: CUSTOMER_INTELLIGENCE_COPILOT_RUN_ANALYTICAL_QUERIES_TOOL,
                arguments: JSON.stringify({ queries: [{ id: 'q1', plan: { metrics: [{ aggregation: 'count', alias: 'customers' }] } }] }),
              },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 60, prompt_cache_miss_tokens: 40 },
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
    schema: { schemaVersion: CUSTOMER_INTELLIGENCE_QUERY_SCHEMA_VERSION, readModelVersion: 'r', fields: {} },
    queryContract: serializeAnalyticalQueryContractForCopilot(),
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

function orchestratorInput(): GenerateConversationDecisionInput {
  return {
    question: 'q',
    orchestratorPromptVersion: 'orchestrator-v1',
    sessionContext: {
      sessionVersion: 'customer-intelligence-copilot-session-v1',
      recentTurns: [],
      analyticalReferences: [],
      recentResults: [],
      semanticFocus: { activeEntity: null, activeMetric: null, activeComparison: null, unresolvedClarification: null, lastAnalyticalResult: null },
    },
    actionConstraints: {
      allowedActions: ['run_analytics'],
      answerFromContextAllowed: false,
      availableSourceQueryIds: [],
      sessionReferenceCount: 0,
      sessionResultCount: 0,
      freshBusinessFactQuestion: true,
    },
  } as unknown as GenerateConversationDecisionInput;
}

function unifiedPlannerInput(): GenerateConversationPlanInput {
  return {
    question: 'Cuantos clientes hay?',
    schema: { schemaVersion: CUSTOMER_INTELLIGENCE_QUERY_SCHEMA_VERSION, readModelVersion: 'r', fields: {} },
    queryContract: serializeAnalyticalQueryContractForCopilot(),
    unifiedPlannerPromptVersion: 'unified-planner-v1',
    maxQueries: 3,
    sessionContext: {
      contextVersion: CUSTOMER_INTELLIGENCE_COPILOT_SESSION_CONTEXT_VERSION,
      pinnedContext: answerInput().context,
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
  };
}

function conversationalTurnInput(stage: 'tool_selection' | 'tool_synthesis' = 'tool_selection'): GenerateConversationalTurnInput {
  return {
    stage,
    toolChoice: stage === 'tool_selection' ? 'auto' : 'none',
    tools: [
      {
        type: 'function',
        function: {
          name: CUSTOMER_INTELLIGENCE_COPILOT_RUN_ANALYTICAL_QUERIES_TOOL,
          description: 'Run analytics',
          parameters: { type: 'object' },
        },
      },
    ],
    messages: [
      { role: 'system', content: 'Use tools when analytics is needed.' },
      { role: 'user', content: '{"currentQuestion":"Cuantos clientes hay?"}' },
    ],
  };
}

function firstPayload(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init, payload: JSON.parse(String(init.body)) as Record<string, unknown> };
}

describe('openai_compatible Customer Intelligence Copilot model adapter', () => {
  it('serializes native tool selection and parses tool calls plus cache usage', async () => {
    const fetchMock = mockFetchJson(chatToolResponse());
    const model = createOpenAiCompatibleCopilotModel(config);

    const result = await model.generateConversationalTurn!(conversationalTurnInput());

    expect(result).toEqual({
      content: null,
      toolCalls: [
        {
          id: 'call_1',
          name: CUSTOMER_INTELLIGENCE_COPILOT_RUN_ANALYTICAL_QUERIES_TOOL,
          arguments: { queries: [{ id: 'q1', plan: { metrics: [{ aggregation: 'count', alias: 'customers' }] } }] },
        },
      ],
      metadata: expect.objectContaining({
        provider: 'openai_compatible',
        model: 'vendor-model',
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        promptCacheHitTokens: 60,
        promptCacheMissTokens: 40,
      }),
    });
    const { payload } = firstPayload(fetchMock);
    expect(payload.tools).toEqual(conversationalTurnInput().tools);
    expect(payload.tool_choice).toBe('auto');
    expect(payload.response_format).toBeUndefined();
  });

  it('serializes tool result messages for native synthesis without allowing a second tool round', async () => {
    const fetchMock = mockFetchJson(chatResponse('Respuesta final.'));
    const model = createOpenAiCompatibleCopilotModel(config);

    await model.generateConversationalTurn!({
      ...conversationalTurnInput('tool_synthesis'),
      maxTokens: 321,
      messages: [
        ...conversationalTurnInput('tool_synthesis').messages,
        {
          role: 'assistant',
          content: null,
          toolCalls: [{ id: 'call_1', name: CUSTOMER_INTELLIGENCE_COPILOT_RUN_ANALYTICAL_QUERIES_TOOL, arguments: { queries: [] } }],
        },
        { role: 'tool', toolCallId: 'call_1', content: '{"queries":[]}' },
      ],
    });

    const { payload } = firstPayload(fetchMock);
    expect(payload.tool_choice).toBe('none');
    expect(payload.max_tokens).toBe(321);
    expect(payload.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', tool_call_id: 'call_1', content: '{"queries":[]}' }),
    ]));
  });

  it('surfaces the provider finish_reason (stop vs length) as safe metadata, defaulting to null when absent (task MARKETING-R1-T05.8.6 Section 3)', async () => {
    mockFetchJson({ choices: [{ message: { content: 'Respuesta final.' }, finish_reason: 'length' }] });
    const truncatedModel = createOpenAiCompatibleCopilotModel(config);
    const truncated = await truncatedModel.generateConversationalTurn!(conversationalTurnInput('tool_synthesis'));
    expect(truncated.metadata).toMatchObject({ finishReason: 'length' });

    mockFetchJson({ choices: [{ message: { content: 'Respuesta final.' }, finish_reason: 'stop' }] });
    const normalModel = createOpenAiCompatibleCopilotModel(config);
    const normal = await normalModel.generateConversationalTurn!(conversationalTurnInput('tool_synthesis'));
    expect(normal.metadata).toMatchObject({ finishReason: 'stop' });

    mockFetchJson(chatResponse('Respuesta final.'));
    const missingModel = createOpenAiCompatibleCopilotModel(config);
    const missing = await missingModel.generateConversationalTurn!(conversationalTurnInput('tool_synthesis'));
    expect(missing.metadata).toMatchObject({ finishReason: null });
  });

  it('reports malformed tool arguments as parsed tool-call data for application validation', async () => {
    mockFetchJson({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: CUSTOMER_INTELLIGENCE_COPILOT_RUN_ANALYTICAL_QUERIES_TOOL, arguments: '{bad' } },
            ],
          },
        },
      ],
    });
    const model = createOpenAiCompatibleCopilotModel(config);

    const result = await model.generateConversationalTurn!(conversationalTurnInput());

    expect(result.toolCalls[0]).toMatchObject({
      id: 'call_1',
      name: CUSTOMER_INTELLIGENCE_COPILOT_RUN_ANALYTICAL_QUERIES_TOOL,
      arguments: null,
      argumentsParseError: expect.any(String),
    });
  });

  it('serializes unified planner requests as a single structured chat completion', async () => {
    const conversationPlan = {
      version: CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION,
      action: 'run_analytics',
      analyticalQuestion: 'Cuantos clientes hay?',
      analysisPlan: { planVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION, status: 'query_plan', queries: [] },
    };
    const fetchMock = mockFetchJson(chatResponse(JSON.stringify(conversationPlan)));
    const model = createOpenAiCompatibleCopilotModel(config);

    const result = await model.generateConversationPlan!(unifiedPlannerInput());

    expect(result.conversationPlan).toEqual(conversationPlan);
    const { payload } = firstPayload(fetchMock);
    expect(payload.response_format).toEqual({ type: 'json_object' });
    expect(payload.messages).toEqual([
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining(CUSTOMER_INTELLIGENCE_COPILOT_UNIFIED_PLANNER_INSTRUCTIONS[0]),
      }),
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('"task": "generate_conversation_plan"'),
      }),
    ]);
    expect(JSON.parse(String((payload.messages as { content: string }[])[1]?.content))).toMatchObject({
      input: { question: 'Cuantos clientes hay?', maxQueries: 3 },
      task: 'generate_conversation_plan',
    });
  });

  it('classifies malformed unified planner JSON with the unified planner stage', async () => {
    mockFetchJson(chatResponse('not json'));
    const model = createOpenAiCompatibleCopilotModel(config);

    await expect(model.generateConversationPlan!(unifiedPlannerInput())).rejects.toMatchObject({
      category: 'provider_invalid_response',
      metadata: { provider: 'openai_compatible', model: 'vendor-model', stage: 'unified_planner' },
    });
  });

  it('serializes planner requests as OpenAI-compatible chat completions', async () => {
    const fetchMock = mockFetchJson(chatResponse(JSON.stringify(plan)));
    const model = createOpenAiCompatibleCopilotModel(config);

    const result = await model.generateAnalysisPlan(plannerInput());

    expect(result).toEqual({
      plan,
      metadata: expect.objectContaining({
        provider: 'openai_compatible',
        model: 'vendor-model',
        promptCharCount: expect.any(Number),
        responseCharCount: expect.any(Number),
      }),
    });
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
    expect(JSON.parse(String((payload.messages as { content: string }[])[1]?.content))).toMatchObject({
      input: { queryContract: { contractVersion: 'customer-intelligence-compact-query-v1', metrics: { alias: { pattern: '^[A-Za-z_][A-Za-z0-9_]*$' } } } },
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
    expect(userInput.input.queryContract.queryShape.aggregate).toBe('dimensions? + metrics');
  });

  it('extracts answer content and returns fixed provider metadata', async () => {
    mockFetchJson(chatResponseWithUsage('Respuesta grounded.'));
    const model = createOpenAiCompatibleCopilotModel(config);

    const result = await model.generateAnswer(answerInput());

    expect(result).toEqual({
      answer: 'Respuesta grounded.',
      metadata: expect.objectContaining({
        provider: 'openai_compatible',
        model: 'vendor-model',
        promptCharCount: expect.any(Number),
        responseCharCount: 19,
        promptTokens: 11,
        completionTokens: 7,
        totalTokens: 18,
      }),
    });
  });

  it('treats answer content as plain text without JSON response format or parsing', async () => {
    const fetchMock = mockFetchJson(chatResponse('{"answer":"still plain text"}'));
    const model = createOpenAiCompatibleCopilotModel(config);

    const result = await model.generateAnswer(answerInput());

    expect(result.answer).toBe('{"answer":"still plain text"}');
    const { payload } = firstPayload(fetchMock);
    expect(payload.response_format).toBeUndefined();
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

    await expect(model.generateAnalysisPlan(plannerInput())).rejects.toMatchObject({
      category: 'provider_invalid_response',
      metadata: { provider: 'openai_compatible', model: 'vendor-model', stage: 'planner' },
    });
  });

  it('classifies malformed orchestrator JSON with the orchestrator stage', async () => {
    mockFetchJson(chatResponse('not json'));
    const model = createOpenAiCompatibleCopilotModel(config);

    await expect(model.generateConversationDecision(orchestratorInput())).rejects.toMatchObject({
      category: 'provider_invalid_response',
      metadata: { provider: 'openai_compatible', model: 'vendor-model', stage: 'orchestrator' },
    });
  });

  it('classifies malformed answer provider envelopes with the answerer stage', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    const model = createOpenAiCompatibleCopilotModel(config);

    await expect(model.generateAnswer(answerInput())).rejects.toMatchObject({
      category: 'provider_invalid_response',
      metadata: { provider: 'openai_compatible', model: 'vendor-model', stage: 'answerer' },
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
    const model = createOpenAiCompatibleCopilotModel(config);

    await expect(model.generateAnalysisPlan(plannerInput())).rejects.toMatchObject({
      category: 'provider_timeout',
      metadata: { provider: 'openai_compatible', model: 'vendor-model', stage: 'planner' },
    });
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
    const expectation = expect(promise).rejects.toMatchObject({ category: 'provider_timeout' });
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

  it('routes configured stage-specific model overrides without changing provider abstraction', async () => {
    const fetchMock = mockFetchJson(chatResponse('Respuesta.'));
    const result = createConfiguredCustomerIntelligenceCopilotModel({
      CUSTOMER_INTELLIGENCE_COPILOT_PROVIDER: 'openai_compatible',
      CUSTOMER_INTELLIGENCE_COPILOT_ENDPOINT: config.endpoint,
      CUSTOMER_INTELLIGENCE_COPILOT_MODEL: 'deepseek-v4-flash',
      CUSTOMER_INTELLIGENCE_COPILOT_ANSWERER_MODEL: 'deepseek-v4-pro',
      CUSTOMER_INTELLIGENCE_COPILOT_TIMEOUT_MS: String(config.timeoutMs),
    });

    expect(result.status).toBe('configured');
    if (result.status !== 'configured') throw new Error('expected configured provider');
    await result.model.generateAnswer(answerInput());

    const { payload } = firstPayload(fetchMock);
    expect(payload.model).toBe('deepseek-v4-pro');
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

  it('defaults tool_selection/tool_synthesis stage timeouts to 45000ms when unset', () => {
    const result = createConfiguredCustomerIntelligenceCopilotModel({
      CUSTOMER_INTELLIGENCE_COPILOT_PROVIDER: 'openai_compatible',
      CUSTOMER_INTELLIGENCE_COPILOT_ENDPOINT: config.endpoint,
      CUSTOMER_INTELLIGENCE_COPILOT_MODEL: config.model,
    });

    expect(result).toMatchObject({ status: 'configured', toolSelectionTimeoutMs: 45000, toolSynthesisTimeoutMs: 45000 });
  });

  it('applies stage-specific timeout env overrides independently of each other and of the legacy timeout', () => {
    const result = createConfiguredCustomerIntelligenceCopilotModel({
      CUSTOMER_INTELLIGENCE_COPILOT_PROVIDER: 'openai_compatible',
      CUSTOMER_INTELLIGENCE_COPILOT_ENDPOINT: config.endpoint,
      CUSTOMER_INTELLIGENCE_COPILOT_MODEL: config.model,
      CUSTOMER_INTELLIGENCE_COPILOT_TIMEOUT_MS: '30000',
      CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SELECTION_TIMEOUT_MS: '40000',
      CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SYNTHESIS_TIMEOUT_MS: '55000',
    });

    expect(result).toMatchObject({ status: 'configured', toolSelectionTimeoutMs: 40000, toolSynthesisTimeoutMs: 55000 });
  });

  it('fails closed when a stage timeout exceeds the 60000ms bound (D)', () => {
    const overMax = createConfiguredCustomerIntelligenceCopilotModel({
      CUSTOMER_INTELLIGENCE_COPILOT_PROVIDER: 'openai_compatible',
      CUSTOMER_INTELLIGENCE_COPILOT_ENDPOINT: config.endpoint,
      CUSTOMER_INTELLIGENCE_COPILOT_MODEL: config.model,
      CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SELECTION_TIMEOUT_MS: '60001',
    });
    expect(overMax).toEqual({ status: 'not_configured', reason: 'CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SELECTION_TIMEOUT_MS must not exceed 60000' });

    const invalid = createConfiguredCustomerIntelligenceCopilotModel({
      CUSTOMER_INTELLIGENCE_COPILOT_PROVIDER: 'openai_compatible',
      CUSTOMER_INTELLIGENCE_COPILOT_ENDPOINT: config.endpoint,
      CUSTOMER_INTELLIGENCE_COPILOT_MODEL: config.model,
      CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SYNTHESIS_TIMEOUT_MS: '0',
    });
    expect(invalid).toEqual({ status: 'not_configured', reason: 'CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SYNTHESIS_TIMEOUT_MS must be a positive integer' });
  });
});

describe('Customer Intelligence Copilot stage-specific provider timeouts at the adapter (task MARKETING-R1-T05.8.8 Section 1/2/3)', () => {
  function abortingFetchMock() {
    return vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
  }

  it('uses the configured tool_selection timeout instead of the legacy timeout (A)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', abortingFetchMock());
    const model = createOpenAiCompatibleCopilotModel({ ...config, toolSelectionTimeoutMs: 45000, toolSynthesisTimeoutMs: 45000 });

    const promise = model.generateConversationalTurn!(conversationalTurnInput('tool_selection'));
    const expectation = expect(promise).rejects.toMatchObject({ category: 'provider_timeout', metadata: { configuredTimeoutMs: 45000 } });
    await vi.advanceTimersByTimeAsync(45000);

    await expectation;
  });

  it('uses the configured tool_synthesis timeout instead of the legacy timeout (B)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', abortingFetchMock());
    const model = createOpenAiCompatibleCopilotModel({ ...config, toolSelectionTimeoutMs: 45000, toolSynthesisTimeoutMs: 50000 });

    const promise = model.generateConversationalTurn!(conversationalTurnInput('tool_synthesis'));
    const expectation = expect(promise).rejects.toMatchObject({ category: 'provider_timeout', metadata: { configuredTimeoutMs: 50000 } });
    await vi.advanceTimersByTimeAsync(50000);

    await expectation;
  });

  it('keeps the legacy timeout as fallback/default for orchestrator/planner/answerer/unified_planner (C)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', abortingFetchMock());
    const model = createOpenAiCompatibleCopilotModel({ ...config, toolSelectionTimeoutMs: 45000, toolSynthesisTimeoutMs: 45000 });

    const promise = model.generateAnswer(answerInput());
    const expectation = expect(promise).rejects.toMatchObject({ category: 'provider_timeout', metadata: { stage: 'answerer', configuredTimeoutMs: config.timeoutMs } });
    await vi.advanceTimersByTimeAsync(config.timeoutMs);

    await expectation;
  });

  it('falls back to the legacy timeout when no stage-specific override is configured on the adapter config', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', abortingFetchMock());
    const model = createOpenAiCompatibleCopilotModel(config);

    const promise = model.generateConversationalTurn!(conversationalTurnInput('tool_selection'));
    const expectation = expect(promise).rejects.toMatchObject({ category: 'provider_timeout', metadata: { configuredTimeoutMs: config.timeoutMs } });
    await vi.advanceTimersByTimeAsync(config.timeoutMs);

    await expectation;
  });
});

describe('Customer Intelligence Copilot invalid-response taxonomy (task MARKETING-R1-T05.8.8 Section 4/5)', () => {
  it('classifies malformed transport JSON as provider_invalid_json (H)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchMock);
    const model = createOpenAiCompatibleCopilotModel(config);

    await expect(model.generateConversationalTurn!(conversationalTurnInput('tool_synthesis'))).rejects.toMatchObject({
      category: 'provider_invalid_response',
      metadata: { invalidResponseSubtype: 'provider_invalid_json' },
    });
  });

  it('classifies missing choices as provider_missing_choices (I)', async () => {
    mockFetchJson({});
    const model = createOpenAiCompatibleCopilotModel(config);

    await expect(model.generateConversationalTurn!(conversationalTurnInput('tool_synthesis'))).rejects.toMatchObject({
      category: 'provider_invalid_response',
      metadata: { invalidResponseSubtype: 'provider_missing_choices' },
    });
  });

  it('classifies a missing message as provider_missing_message (J)', async () => {
    mockFetchJson({ choices: [{}] });
    const model = createOpenAiCompatibleCopilotModel(config);

    await expect(model.generateConversationalTurn!(conversationalTurnInput('tool_synthesis'))).rejects.toMatchObject({
      category: 'provider_invalid_response',
      metadata: { invalidResponseSubtype: 'provider_missing_message' },
    });
  });

  it('distinguishes missing content (no key) from empty/whitespace content (K)', async () => {
    mockFetchJson({ choices: [{ message: { content: null } }] });
    const missing = createOpenAiCompatibleCopilotModel(config);
    await expect(missing.generateConversationalTurn!(conversationalTurnInput('tool_synthesis'))).rejects.toMatchObject({
      category: 'provider_invalid_response',
      metadata: { invalidResponseSubtype: 'provider_missing_content' },
    });

    mockFetchJson({ choices: [{ message: { content: '   ' } }] });
    const blank = createOpenAiCompatibleCopilotModel(config);
    await expect(blank.generateConversationalTurn!(conversationalTurnInput('tool_synthesis'))).rejects.toMatchObject({
      category: 'provider_invalid_response',
      metadata: { invalidResponseSubtype: 'provider_empty_response' },
    });
  });

  it('classifies a finish_reason=length truncation with no usable content as provider_invalid_finish_reason', async () => {
    mockFetchJson({ choices: [{ message: { content: '' }, finish_reason: 'length' }] });
    const model = createOpenAiCompatibleCopilotModel(config);

    await expect(model.generateConversationalTurn!(conversationalTurnInput('tool_synthesis'))).rejects.toMatchObject({
      category: 'provider_invalid_response',
      metadata: { invalidResponseSubtype: 'provider_invalid_finish_reason' },
    });
  });

  it('classifies malformed tool_calls as provider_invalid_tool_calls (L)', async () => {
    mockFetchJson({ choices: [{ message: { content: 'algo de texto', tool_calls: 'not-an-array' } }] });
    const model = createOpenAiCompatibleCopilotModel(config);

    await expect(model.generateConversationalTurn!(conversationalTurnInput('tool_selection'))).rejects.toMatchObject({
      category: 'provider_invalid_response',
      metadata: { invalidResponseSubtype: 'provider_invalid_tool_calls' },
    });
  });

  it('does not classify a valid plain-text synthesis response as any invalid-response subtype (M)', async () => {
    mockFetchJson(chatResponse('Cluster 3 presenta el mayor ticket promedio observado.'));
    const model = createOpenAiCompatibleCopilotModel(config);

    const output = await model.generateConversationalTurn!(conversationalTurnInput('tool_synthesis'));
    expect(output.content).toBe('Cluster 3 presenta el mayor ticket promedio observado.');
  });

  it('never exposes the raw provider payload in the error message or metadata (O)', async () => {
    mockFetchJson({ choices: [{ message: { content: null }, secretApiKey: 'sk-super-secret', rawPromptEcho: 'the full system prompt text' }] });
    const model = createOpenAiCompatibleCopilotModel(config);

    const error = await model.generateConversationalTurn!(conversationalTurnInput('tool_synthesis')).catch((caught: unknown) => caught);
    expect(String((error as Error).message)).not.toMatch(/secretApiKey|sk-super-secret|rawPromptEcho|the full system prompt text/);
    expect(JSON.stringify((error as { metadata: unknown }).metadata)).not.toMatch(/secretApiKey|sk-super-secret|rawPromptEcho/);
  });
});
