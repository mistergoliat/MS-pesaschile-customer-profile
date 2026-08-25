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
      const content = await postChatCompletion(config, {
        messages: [
          { role: 'system', content: orchestratorSystemPrompt() },
          { role: 'user', content: serializeUserInput({ task: 'generate_conversation_decision', input }) },
        ],
        responseFormat: 'json_object',
        stage: 'orchestrator',
      });
      return decisionOutput(content, config.model, 'orchestrator');
    },

    async repairConversationDecision(input) {
      const content = await postChatCompletion(config, {
        messages: [
          { role: 'system', content: orchestratorSystemPrompt() },
          { role: 'user', content: serializeUserInput({ task: 'repair_conversation_decision', input }) },
        ],
        responseFormat: 'json_object',
        stage: 'orchestrator_repair',
      });
      return decisionOutput(content, config.model, 'orchestrator_repair');
    },

    async generateAnalysisPlan(input) {
      const content = await postChatCompletion(config, {
        messages: [
          { role: 'system', content: plannerSystemPrompt() },
          { role: 'user', content: serializeUserInput({ task: 'generate_analysis_plan', input }) },
        ],
        responseFormat: 'json_object',
        stage: 'planner',
      });
      return planOutput(content, config.model, 'planner');
    },

    async repairAnalysisPlan(input) {
      const content = await postChatCompletion(config, {
        messages: [
          { role: 'system', content: plannerSystemPrompt() },
          { role: 'user', content: serializeUserInput({ task: 'repair_analysis_plan', input }) },
        ],
        responseFormat: 'json_object',
        stage: 'planner_repair',
      });
      return planOutput(content, config.model, 'planner_repair');
    },

    async generateAnswer(input) {
      const content = await postChatCompletion(config, {
        messages: [
          { role: 'system', content: answerSystemPrompt() },
          { role: 'user', content: serializeUserInput({ task: 'generate_answer', input }) },
        ],
        stage: 'answerer',
      });
      return answerOutput(content, config.model);
    },
  };
}

async function postChatCompletion(
  config: OpenAiCompatibleCopilotModelConfig,
  request: { readonly messages: readonly ChatMessage[]; readonly responseFormat?: 'json_object'; readonly stage: CopilotProviderCallStage },
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
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
    } catch {
      throw providerError(config, request.stage, 'provider_invalid_response', 'Copilot model provider returned malformed JSON', response.status);
    }
    return extractMessageContent(raw, config, request.stage);
  } finally {
    clearTimeout(timeout);
  }
}

function decisionOutput(content: string, model: string, stage: Extract<CopilotProviderCallStage, 'orchestrator' | 'orchestrator_repair'>): GenerateConversationDecisionOutput {
  try {
    return {
      decision: JSON.parse(content),
      metadata: { provider: 'openai_compatible', model },
    };
  } catch {
    throw providerError({ model }, stage, 'provider_invalid_response', 'Copilot model provider returned invalid orchestrator JSON', null);
  }
}

function planOutput(content: string, model: string, stage: Extract<CopilotProviderCallStage, 'planner' | 'planner_repair'>): GenerateAnalysisPlanOutput {
  try {
    return {
      plan: JSON.parse(content),
      metadata: { provider: 'openai_compatible', model },
    };
  } catch (error) {
    throw providerError({ model }, stage, 'provider_invalid_response', `Copilot model provider returned invalid planner JSON: ${errorMessage(error)}`, null);
  }
}

function answerOutput(answer: string, model: string): GenerateAnswerOutput {
  return {
    answer,
    metadata: { provider: 'openai_compatible', model },
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
