import type {
  CustomerIntelligenceCopilotModel,
  GenerateConversationalTurnOutput,
  GenerateConversationPlanOutput,
  GenerateConversationDecisionOutput,
  GenerateAnalysisPlanOutput,
  GenerateAnswerOutput,
  CopilotConversationalMessage,
  CopilotToolDefinition,
} from '../../application/customer-intelligence-copilot/index.js';
import {
  CUSTOMER_INTELLIGENCE_COPILOT_ANSWER_INSTRUCTIONS,
  CUSTOMER_INTELLIGENCE_COPILOT_ORCHESTRATOR_INSTRUCTIONS,
  CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_INSTRUCTIONS,
  CUSTOMER_INTELLIGENCE_COPILOT_UNIFIED_PLANNER_INSTRUCTIONS,
} from '../../domain/customer-intelligence-copilot/index.js';

export type OpenAiCompatibleCopilotModelConfig = {
  readonly endpoint: string;
  readonly apiKey: string | null;
  readonly model: string;
  readonly timeoutMs: number;
  // Stage-specific overrides (task MARKETING-R1-T05.8.8 Section 2): tool_selection and
  // tool_synthesis are native-tool-calling calls that can legitimately take longer than the
  // shared legacy `timeoutMs` used by orchestrator/planner/answerer/unified_planner. When
  // absent, both fall back to `timeoutMs` so existing callers/tests that only set `timeoutMs`
  // keep working unchanged.
  readonly toolSelectionTimeoutMs?: number;
  readonly toolSynthesisTimeoutMs?: number;
};

type ChatMessage = {
  readonly role: 'system' | 'user';
  readonly content: string;
};

type ChatCompletionOutput = {
  readonly content: string;
  readonly toolCalls: readonly {
    readonly id: string;
    readonly name: string;
    readonly arguments: unknown;
    readonly argumentsParseError?: string;
  }[];
  readonly metadata: {
    readonly provider: 'openai_compatible';
    readonly model: string;
    readonly promptCharCount: number;
    readonly responseCharCount: number;
    readonly promptTokens?: number;
    readonly completionTokens?: number;
    readonly totalTokens?: number;
    readonly promptCacheHitTokens?: number;
    readonly promptCacheMissTokens?: number;
    readonly finishReason: string | null;
    readonly configuredTimeoutMs: number;
  };
};

export type CopilotProviderErrorCategory =
  | 'provider_authentication_error'
  | 'provider_billing_error'
  | 'provider_rate_limited'
  | 'provider_timeout'
  | 'provider_network_error'
  | 'provider_invalid_response';

// Internal safe subtypes of `provider_invalid_response` (task MARKETING-R1-T05.8.8 Section 4).
// The public `category` stays `provider_invalid_response` for compatibility; this subtype is
// carried only in `CopilotProviderError.metadata` for internal diagnostics, never surfaced as a
// new public status. It never contains raw provider payload, prompt, or credential content -
// only which structural expectation failed.
export type CopilotProviderInvalidResponseSubtype =
  | 'provider_invalid_json'
  | 'provider_unexpected_envelope'
  | 'provider_missing_choices'
  | 'provider_missing_message'
  | 'provider_missing_content'
  | 'provider_empty_response'
  | 'provider_invalid_finish_reason'
  | 'provider_invalid_tool_calls';

export type CopilotProviderCallStage =
  | 'tool_selection'
  | 'tool_synthesis'
  | 'orchestrator'
  | 'orchestrator_repair'
  | 'planner'
  | 'planner_repair'
  | 'unified_planner'
  | 'unified_planner_repair'
  | 'answerer';

export class CopilotProviderError extends Error {
  constructor(
    readonly category: CopilotProviderErrorCategory,
    message: string,
    readonly metadata: {
      readonly provider: string;
      readonly model: string;
      readonly stage: CopilotProviderCallStage;
      readonly httpStatus?: number | null;
      readonly invalidResponseSubtype?: CopilotProviderInvalidResponseSubtype | null;
      readonly configuredTimeoutMs?: number | null;
    },
  ) {
    super(message);
    this.name = 'CopilotProviderError';
  }
}

export function createOpenAiCompatibleCopilotModel(config: OpenAiCompatibleCopilotModelConfig): CustomerIntelligenceCopilotModel {
  return {
    async generateConversationalTurn(input) {
      const output = await postChatCompletion(config, {
        messages: input.messages,
        tools: input.tools,
        toolChoice: input.toolChoice,
        stage: input.stage,
        maxTokens: input.maxTokens,
      });
      return conversationalTurnOutput(output, input.stage);
    },

    async generateConversationPlan(input) {
      const output = await postChatCompletion(config, {
        messages: [
          { role: 'system', content: unifiedPlannerSystemPrompt() },
          { role: 'user', content: serializeUserInput({ task: 'generate_conversation_plan', input }) },
        ],
        responseFormat: 'json_object',
        stage: 'unified_planner',
      });
      return conversationPlanOutput(output, 'unified_planner');
    },

    async repairConversationPlan(input) {
      const output = await postChatCompletion(config, {
        messages: [
          { role: 'system', content: unifiedPlannerSystemPrompt() },
          { role: 'user', content: serializeUserInput({ task: 'repair_conversation_plan', input }) },
        ],
        responseFormat: 'json_object',
        stage: 'unified_planner_repair',
      });
      return conversationPlanOutput(output, 'unified_planner_repair');
    },

    async generateConversationDecision(input) {
      const output = await postChatCompletion(config, {
        messages: [
          { role: 'system', content: orchestratorSystemPrompt() },
          { role: 'user', content: serializeUserInput({ task: 'generate_conversation_decision', input }) },
        ],
        responseFormat: 'json_object',
        stage: 'orchestrator',
      });
      return decisionOutput(output, 'orchestrator');
    },

    async repairConversationDecision(input) {
      const output = await postChatCompletion(config, {
        messages: [
          { role: 'system', content: orchestratorSystemPrompt() },
          { role: 'user', content: serializeUserInput({ task: 'repair_conversation_decision', input }) },
        ],
        responseFormat: 'json_object',
        stage: 'orchestrator_repair',
      });
      return decisionOutput(output, 'orchestrator_repair');
    },

    async generateAnalysisPlan(input) {
      const output = await postChatCompletion(config, {
        messages: [
          { role: 'system', content: plannerSystemPrompt() },
          { role: 'user', content: serializeUserInput({ task: 'generate_analysis_plan', input }) },
        ],
        responseFormat: 'json_object',
        stage: 'planner',
      });
      return planOutput(output, 'planner');
    },

    async repairAnalysisPlan(input) {
      const output = await postChatCompletion(config, {
        messages: [
          { role: 'system', content: plannerSystemPrompt() },
          { role: 'user', content: serializeUserInput({ task: 'repair_analysis_plan', input }) },
        ],
        responseFormat: 'json_object',
        stage: 'planner_repair',
      });
      return planOutput(output, 'planner_repair');
    },

    async generateAnswer(input) {
      const output = await postChatCompletion(config, {
        messages: [
          { role: 'system', content: answerSystemPrompt() },
          { role: 'user', content: serializeUserInput({ task: 'generate_answer', input }) },
        ],
        stage: 'answerer',
      });
      return answerOutput(output);
    },
  };
}

async function postChatCompletion(
  config: OpenAiCompatibleCopilotModelConfig,
  request: {
    readonly messages: readonly (ChatMessage | CopilotConversationalMessage)[];
    readonly responseFormat?: 'json_object';
    readonly tools?: readonly CopilotToolDefinition[];
    readonly toolChoice?: 'auto' | 'none';
    readonly stage: CopilotProviderCallStage;
    readonly maxTokens?: number;
  },
): Promise<ChatCompletionOutput> {
  const timeoutMs = resolveTimeoutMsForStage(config, request.stage);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const promptCharCount = request.messages.reduce((sum, message) => sum + messageCharCount(message), 0);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    const body: Record<string, unknown> = {
      model: config.model,
      messages: request.messages.map(openAiMessage),
      stream: false,
    };
    if (request.responseFormat) body.response_format = { type: request.responseFormat };
    if (request.tools && request.tools.length > 0) body.tools = request.tools;
    if (request.toolChoice) body.tool_choice = request.toolChoice;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch((error: unknown) => {
      if (isAbortError(error)) {
        throw providerError(config, request.stage, 'provider_timeout', 'Copilot model provider timed out', null, null, timeoutMs);
      }
      throw providerError(config, request.stage, 'provider_network_error', 'Copilot model provider network error', null, null, timeoutMs);
    });
    if (!response.ok) {
      throw providerError(config, request.stage, categoryForHttpStatus(response.status), `Copilot model provider returned HTTP ${response.status}`, response.status, null, timeoutMs);
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch (error) {
      if (isAbortError(error)) {
        throw providerError(config, request.stage, 'provider_timeout', 'Copilot model provider timed out', response.status, null, timeoutMs);
      }
      throw providerError(config, request.stage, 'provider_invalid_response', 'Copilot model provider returned malformed JSON', response.status, 'provider_invalid_json', timeoutMs);
    }
    const { message, finishReason } = extractMessage(raw, config, request.stage, timeoutMs);
    const content = typeof message.content === 'string' ? message.content : '';
    return {
      content,
      toolCalls: extractToolCalls(message, config, request.stage, timeoutMs),
      metadata: {
        provider: 'openai_compatible',
        model: config.model,
        promptCharCount,
        responseCharCount: content.length,
        finishReason,
        configuredTimeoutMs: timeoutMs,
        ...usageMetadata(raw),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function resolveTimeoutMsForStage(config: OpenAiCompatibleCopilotModelConfig, stage: CopilotProviderCallStage): number {
  if (stage === 'tool_selection' && typeof config.toolSelectionTimeoutMs === 'number') return config.toolSelectionTimeoutMs;
  if (stage === 'tool_synthesis' && typeof config.toolSynthesisTimeoutMs === 'number') return config.toolSynthesisTimeoutMs;
  return config.timeoutMs;
}

function conversationalTurnOutput(output: ChatCompletionOutput, stage: Extract<CopilotProviderCallStage, 'tool_selection' | 'tool_synthesis'>): GenerateConversationalTurnOutput {
  if (output.content.trim().length === 0 && output.toolCalls.length === 0) {
    // A `finish_reason: 'length'` here means the provider was cut off by max_tokens before it
    // produced usable content or a tool call (task MARKETING-R1-T05.8.8 Section 5) - a distinct,
    // actionable cause (raise/bound max_tokens) from a genuinely empty completion.
    const subtype = output.metadata.finishReason === 'length' ? 'provider_invalid_finish_reason' : 'provider_empty_response';
    throw providerError({ model: output.metadata.model }, stage, 'provider_invalid_response', 'Copilot model provider returned neither content nor tool calls', null, subtype, output.metadata.configuredTimeoutMs);
  }
  return {
    content: output.content.trim().length > 0 ? output.content : null,
    toolCalls: output.toolCalls,
    metadata: output.metadata,
  };
}

function messageCharCount(message: ChatMessage | CopilotConversationalMessage): number {
  if (message.role === 'assistant') {
    return (message.content ?? '').length + (message.toolCalls ? JSON.stringify(message.toolCalls).length : 0);
  }
  return message.content.length;
}

function conversationPlanOutput(output: ChatCompletionOutput, stage: Extract<CopilotProviderCallStage, 'unified_planner' | 'unified_planner_repair'>): GenerateConversationPlanOutput {
  try {
    return {
      conversationPlan: JSON.parse(output.content),
      metadata: output.metadata,
    };
  } catch (error) {
    throw providerError({ model: output.metadata.model }, stage, 'provider_invalid_response', `Copilot model provider returned invalid unified planner JSON: ${errorMessage(error)}`, null, 'provider_invalid_json', output.metadata.configuredTimeoutMs);
  }
}

function decisionOutput(output: ChatCompletionOutput, stage: Extract<CopilotProviderCallStage, 'orchestrator' | 'orchestrator_repair'>): GenerateConversationDecisionOutput {
  try {
    return {
      decision: JSON.parse(output.content),
      metadata: output.metadata,
    };
  } catch {
    throw providerError({ model: output.metadata.model }, stage, 'provider_invalid_response', 'Copilot model provider returned invalid orchestrator JSON', null, 'provider_invalid_json', output.metadata.configuredTimeoutMs);
  }
}

function planOutput(output: ChatCompletionOutput, stage: Extract<CopilotProviderCallStage, 'planner' | 'planner_repair'>): GenerateAnalysisPlanOutput {
  try {
    return {
      plan: JSON.parse(output.content),
      metadata: output.metadata,
    };
  } catch (error) {
    throw providerError({ model: output.metadata.model }, stage, 'provider_invalid_response', `Copilot model provider returned invalid planner JSON: ${errorMessage(error)}`, null, 'provider_invalid_json', output.metadata.configuredTimeoutMs);
  }
}

function answerOutput(output: ChatCompletionOutput): GenerateAnswerOutput {
  return {
    answer: output.content,
    metadata: output.metadata,
  };
}

// task MARKETING-R1-T05.8.8 Section 5 audit: this is the exact tool_selection/tool_synthesis
// parsing path. It expects `choices[0].message.content` (a string) or, for tool_selection,
// native `message.tool_calls`. Deliberately does not read `message.reasoning_content` - some
// OpenAI-compatible reasoning variants emit chain-of-thought there, and this codebase never
// surfaces reasoning content to users or logs (Section 4 requirements), so a response carrying
// only `reasoning_content` and no usable `content`/`tool_calls` is correctly treated the same as
// an empty response, not specially unwrapped.
function extractMessage(
  raw: unknown,
  config: OpenAiCompatibleCopilotModelConfig,
  stage: CopilotProviderCallStage,
  configuredTimeoutMs: number,
): { readonly message: Record<string, unknown>; readonly finishReason: string | null } {
  const obj = expectObject(raw, 'Copilot model provider returned a non-object response', config, stage, configuredTimeoutMs, 'provider_unexpected_envelope');
  if (!Array.isArray(obj.choices) || obj.choices.length === 0) {
    throw providerError(config, stage, 'provider_invalid_response', 'Copilot model provider returned no choices', null, 'provider_missing_choices', configuredTimeoutMs);
  }
  const [firstChoice] = obj.choices;
  const choice = expectObject(firstChoice, 'Copilot model provider returned a malformed choice', config, stage, configuredTimeoutMs, 'provider_unexpected_envelope');
  const message = expectObject(choice.message, 'Copilot model provider returned a malformed message', config, stage, configuredTimeoutMs, 'provider_missing_message');
  if (message.content !== null && message.content !== undefined && typeof message.content !== 'string') {
    throw providerError(config, stage, 'provider_invalid_response', 'Copilot model provider returned non-string message content', null, 'provider_unexpected_envelope', configuredTimeoutMs);
  }
  const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null;
  const contentMissing = message.content === null || message.content === undefined;
  const contentBlank = typeof message.content === 'string' && message.content.trim().length === 0;
  if ((contentMissing || contentBlank) && !Array.isArray(message.tool_calls)) {
    if (finishReason === 'length') {
      throw providerError(config, stage, 'provider_invalid_response', 'Copilot model provider truncated the response before producing content', null, 'provider_invalid_finish_reason', configuredTimeoutMs);
    }
    throw providerError(
      config,
      stage,
      'provider_invalid_response',
      contentMissing ? 'Copilot model provider returned missing message content' : 'Copilot model provider returned empty message content',
      null,
      contentMissing ? 'provider_missing_content' : 'provider_empty_response',
      configuredTimeoutMs,
    );
  }
  return { message, finishReason };
}

function extractToolCalls(message: Record<string, unknown>, config: OpenAiCompatibleCopilotModelConfig, stage: CopilotProviderCallStage, configuredTimeoutMs: number): GenerateConversationalTurnOutput['toolCalls'] {
  if (message.tool_calls === undefined) return [];
  if (!Array.isArray(message.tool_calls)) {
    throw providerError(config, stage, 'provider_invalid_response', 'Copilot model provider returned malformed tool_calls', null, 'provider_invalid_tool_calls', configuredTimeoutMs);
  }
  return message.tool_calls.map((rawCall) => {
    const call = expectObject(rawCall, 'Copilot model provider returned malformed tool call', config, stage, configuredTimeoutMs, 'provider_invalid_tool_calls');
    const fn = expectObject(call.function, 'Copilot model provider returned malformed tool function', config, stage, configuredTimeoutMs, 'provider_invalid_tool_calls');
    const id = typeof call.id === 'string' && call.id.trim().length > 0 ? call.id : null;
    const name = typeof fn.name === 'string' && fn.name.trim().length > 0 ? fn.name : null;
    const rawArguments = typeof fn.arguments === 'string' ? fn.arguments : null;
    if (!id || !name || rawArguments === null) {
      throw providerError(config, stage, 'provider_invalid_response', 'Copilot model provider returned incomplete tool call', null, 'provider_invalid_tool_calls', configuredTimeoutMs);
    }
    try {
      return { id, name, arguments: JSON.parse(rawArguments) };
    } catch (error) {
      return { id, name, arguments: null, argumentsParseError: errorMessage(error) };
    }
  });
}

function openAiMessage(message: ChatMessage | CopilotConversationalMessage): Record<string, unknown> {
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content ?? null,
      ...(message.toolCalls
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            })),
          }
        : {}),
    };
  }
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
  return { role: message.role, content: message.content };
}

function expectObject(
  value: unknown,
  message: string,
  config: Pick<OpenAiCompatibleCopilotModelConfig, 'model'>,
  stage: CopilotProviderCallStage,
  configuredTimeoutMs: number,
  invalidResponseSubtype: CopilotProviderInvalidResponseSubtype = 'provider_unexpected_envelope',
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw providerError(config, stage, 'provider_invalid_response', message, null, invalidResponseSubtype, configuredTimeoutMs);
  }
  return value as Record<string, unknown>;
}

function usageMetadata(raw: unknown): {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly promptCacheHitTokens?: number;
  readonly promptCacheMissTokens?: number;
} {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const usage = (raw as { readonly usage?: unknown }).usage;
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) return {};
  return {
    ...positiveIntegerField(usage, 'prompt_tokens', 'promptTokens'),
    ...positiveIntegerField(usage, 'completion_tokens', 'completionTokens'),
    ...positiveIntegerField(usage, 'total_tokens', 'totalTokens'),
    ...positiveIntegerField(usage, 'prompt_cache_hit_tokens', 'promptCacheHitTokens'),
    ...positiveIntegerField(usage, 'prompt_cache_miss_tokens', 'promptCacheMissTokens'),
  };
}

function positiveIntegerField(source: unknown, sourceKey: string, targetKey: 'promptTokens' | 'completionTokens' | 'totalTokens' | 'promptCacheHitTokens' | 'promptCacheMissTokens'): Record<typeof targetKey, number> | Record<string, never> {
  const value = (source as Record<string, unknown>)[sourceKey];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? { [targetKey]: value } as Record<typeof targetKey, number> : {};
}

function orchestratorSystemPrompt(): string {
  return CUSTOMER_INTELLIGENCE_COPILOT_ORCHESTRATOR_INSTRUCTIONS.join('\n');
}

function plannerSystemPrompt(): string {
  return [
    ...CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_INSTRUCTIONS,
    'Return only one valid JSON object that matches the existing CopilotAnalysisPlan contract.',
  ].join('\n');
}

function unifiedPlannerSystemPrompt(): string {
  return CUSTOMER_INTELLIGENCE_COPILOT_UNIFIED_PLANNER_INSTRUCTIONS.join('\n');
}

function answerSystemPrompt(): string {
  return CUSTOMER_INTELLIGENCE_COPILOT_ANSWER_INSTRUCTIONS.join('\n');
}

function serializeUserInput(input: unknown): string {
  return JSON.stringify(toStableJson(input), null, 2);
}

function toStableJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => toStableJson(item));

  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    result[key] = toStableJson(source[key]);
  }
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function categoryForHttpStatus(status: number): CopilotProviderErrorCategory {
  if (status === 401 || status === 403) return 'provider_authentication_error';
  if (status === 402) return 'provider_billing_error';
  if (status === 429) return 'provider_rate_limited';
  return 'provider_invalid_response';
}

function providerError(
  config: Pick<OpenAiCompatibleCopilotModelConfig, 'model'>,
  stage: CopilotProviderCallStage,
  category: CopilotProviderErrorCategory,
  message: string,
  httpStatus: number | null,
  invalidResponseSubtype?: CopilotProviderInvalidResponseSubtype | null,
  configuredTimeoutMs?: number | null,
): CopilotProviderError {
  return new CopilotProviderError(category, message, {
    provider: 'openai_compatible',
    model: config.model,
    stage,
    httpStatus,
    invalidResponseSubtype: category === 'provider_invalid_response' ? (invalidResponseSubtype ?? 'provider_unexpected_envelope') : null,
    configuredTimeoutMs: configuredTimeoutMs ?? null,
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message));
}
