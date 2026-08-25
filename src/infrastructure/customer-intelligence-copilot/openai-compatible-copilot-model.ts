import type {
  CustomerIntelligenceCopilotModel,
  GenerateConversationDecisionOutput,
  GenerateAnalysisPlanOutput,
  GenerateAnswerOutput,
} from '../../application/customer-intelligence-copilot/index.js';
import {
  CUSTOMER_INTELLIGENCE_COPILOT_ANSWER_INSTRUCTIONS,
  CUSTOMER_INTELLIGENCE_COPILOT_ORCHESTRATOR_INSTRUCTIONS,
  CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_INSTRUCTIONS,
} from '../../domain/customer-intelligence-copilot/index.js';

export type OpenAiCompatibleCopilotModelConfig = {
  readonly endpoint: string;
  readonly apiKey: string | null;
  readonly model: string;
  readonly timeoutMs: number;
};

type ChatMessage = {
  readonly role: 'system' | 'user';
  readonly content: string;
};

type ChatCompletionOutput = {
  readonly content: string;
  readonly metadata: {
    readonly provider: 'openai_compatible';
    readonly model: string;
    readonly promptCharCount: number;
    readonly responseCharCount: number;
    readonly promptTokens?: number;
    readonly completionTokens?: number;
    readonly totalTokens?: number;
  };
};

export type CopilotProviderErrorCategory =
  | 'provider_authentication_error'
  | 'provider_billing_error'
  | 'provider_rate_limited'
  | 'provider_timeout'
  | 'provider_network_error'
  | 'provider_invalid_response';

export type CopilotProviderCallStage =
  | 'orchestrator'
  | 'orchestrator_repair'
  | 'planner'
  | 'planner_repair'
  | 'answerer';

export class CopilotProviderError extends Error {
  constructor(
    readonly category: CopilotProviderErrorCategory,
    message: string,
    readonly metadata: { readonly provider: string; readonly model: string; readonly stage: CopilotProviderCallStage; readonly httpStatus?: number | null },
  ) {
    super(message);
    this.name = 'CopilotProviderError';
  }
}

export function createOpenAiCompatibleCopilotModel(config: OpenAiCompatibleCopilotModelConfig): CustomerIntelligenceCopilotModel {
  return {
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
  request: { readonly messages: readonly ChatMessage[]; readonly responseFormat?: 'json_object'; readonly stage: CopilotProviderCallStage },
): Promise<ChatCompletionOutput> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const promptCharCount = request.messages.reduce((sum, message) => sum + message.content.length, 0);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    const body: Record<string, unknown> = {
      model: config.model,
      messages: request.messages,
      stream: false,
    };
    if (request.responseFormat) body.response_format = { type: request.responseFormat };

    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch((error: unknown) => {
      if (isAbortError(error)) {
        throw providerError(config, request.stage, 'provider_timeout', 'Copilot model provider timed out', null);
      }
      throw providerError(config, request.stage, 'provider_network_error', 'Copilot model provider network error', null);
    });
    if (!response.ok) {
      throw providerError(config, request.stage, categoryForHttpStatus(response.status), `Copilot model provider returned HTTP ${response.status}`, response.status);
    }
    let raw: unknown;
    try {
      raw = await response.json();
    } catch (error) {
      if (isAbortError(error)) {
        throw providerError(config, request.stage, 'provider_timeout', 'Copilot model provider timed out', response.status);
      }
      throw providerError(config, request.stage, 'provider_invalid_response', 'Copilot model provider returned malformed JSON', response.status);
    }
    const content = extractMessageContent(raw, config, request.stage);
    return {
      content,
      metadata: {
        provider: 'openai_compatible',
        model: config.model,
        promptCharCount,
        responseCharCount: content.length,
        ...usageMetadata(raw),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function decisionOutput(output: ChatCompletionOutput, stage: Extract<CopilotProviderCallStage, 'orchestrator' | 'orchestrator_repair'>): GenerateConversationDecisionOutput {
  try {
    return {
      decision: JSON.parse(output.content),
      metadata: output.metadata,
    };
  } catch {
    throw providerError({ model: output.metadata.model }, stage, 'provider_invalid_response', 'Copilot model provider returned invalid orchestrator JSON', null);
  }
}

function planOutput(output: ChatCompletionOutput, stage: Extract<CopilotProviderCallStage, 'planner' | 'planner_repair'>): GenerateAnalysisPlanOutput {
  try {
    return {
      plan: JSON.parse(output.content),
      metadata: output.metadata,
    };
  } catch (error) {
    throw providerError({ model: output.metadata.model }, stage, 'provider_invalid_response', `Copilot model provider returned invalid planner JSON: ${errorMessage(error)}`, null);
  }
}

function answerOutput(output: ChatCompletionOutput): GenerateAnswerOutput {
  return {
    answer: output.content,
    metadata: output.metadata,
  };
}

function extractMessageContent(raw: unknown, config: OpenAiCompatibleCopilotModelConfig, stage: CopilotProviderCallStage): string {
  const obj = expectObject(raw, 'Copilot model provider returned a non-object response', config, stage);
  if (!Array.isArray(obj.choices) || obj.choices.length === 0) {
    throw providerError(config, stage, 'provider_invalid_response', 'Copilot model provider returned no choices', null);
  }
  const [firstChoice] = obj.choices;
  const choice = expectObject(firstChoice, 'Copilot model provider returned a malformed choice', config, stage);
  const message = expectObject(choice.message, 'Copilot model provider returned a malformed message', config, stage);
  if (typeof message.content !== 'string' || message.content.trim().length === 0) {
    throw providerError(config, stage, 'provider_invalid_response', 'Copilot model provider returned empty message content', null);
  }
  return message.content;
}

function expectObject(value: unknown, message: string, config: Pick<OpenAiCompatibleCopilotModelConfig, 'model'>, stage: CopilotProviderCallStage): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw providerError(config, stage, 'provider_invalid_response', message, null);
  }
  return value as Record<string, unknown>;
}

function usageMetadata(raw: unknown): { readonly promptTokens?: number; readonly completionTokens?: number; readonly totalTokens?: number } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const usage = (raw as { readonly usage?: unknown }).usage;
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) return {};
  return {
    ...positiveIntegerField(usage, 'prompt_tokens', 'promptTokens'),
    ...positiveIntegerField(usage, 'completion_tokens', 'completionTokens'),
    ...positiveIntegerField(usage, 'total_tokens', 'totalTokens'),
  };
}

function positiveIntegerField(source: unknown, sourceKey: string, targetKey: 'promptTokens' | 'completionTokens' | 'totalTokens'): Record<typeof targetKey, number> | Record<string, never> {
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
): CopilotProviderError {
  return new CopilotProviderError(category, message, {
    provider: 'openai_compatible',
    model: config.model,
    stage,
    httpStatus,
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message));
}
