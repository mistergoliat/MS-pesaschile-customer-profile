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

export type HttpJsonCopilotModelConfig = {
  readonly endpoint: string;
  readonly apiKey: string | null;
  readonly model: string;
  readonly timeoutMs: number;
};

type HttpJsonProviderErrorCategory =
  | 'provider_authentication_error'
  | 'provider_billing_error'
  | 'provider_rate_limited'
  | 'provider_timeout'
  | 'provider_network_error'
  | 'provider_invalid_response';

type HttpJsonProviderCallStage =
  | 'orchestrator'
  | 'orchestrator_repair'
  | 'planner'
  | 'planner_repair'
  | 'answerer';

type HttpJsonProviderOutput = {
  readonly raw: unknown;
  readonly promptCharCount: number;
  readonly responseCharCount: number;
};

class HttpJsonCopilotProviderError extends Error {
  constructor(
    readonly category: HttpJsonProviderErrorCategory,
    message: string,
    readonly metadata: { readonly provider: string; readonly model: string; readonly stage: HttpJsonProviderCallStage; readonly httpStatus?: number | null },
  ) {
    super(message);
    this.name = 'HttpJsonCopilotProviderError';
  }
}

export function createHttpJsonCopilotModel(config: HttpJsonCopilotModelConfig): CustomerIntelligenceCopilotModel {
  return {
    async generateConversationDecision(input) {
      const response = await postJson(config, {
        task: 'generate_conversation_decision',
        model: config.model,
        instructions: CUSTOMER_INTELLIGENCE_COPILOT_ORCHESTRATOR_INSTRUCTIONS,
        input,
      }, 'orchestrator');
      return decisionOutput(response, config.model, 'orchestrator');
    },

    async repairConversationDecision(input) {
      const response = await postJson(config, {
        task: 'repair_conversation_decision',
        model: config.model,
        instructions: CUSTOMER_INTELLIGENCE_COPILOT_ORCHESTRATOR_INSTRUCTIONS,
        input,
      }, 'orchestrator_repair');
      return decisionOutput(response, config.model, 'orchestrator_repair');
    },

    async generateAnalysisPlan(input) {
      const response = await postJson(config, {
        task: 'generate_analysis_plan',
        model: config.model,
        instructions: CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_INSTRUCTIONS,
        input,
      }, 'planner');
      return planOutput(response, config.model, 'planner');
    },

    async repairAnalysisPlan(input) {
      const response = await postJson(config, {
        task: 'repair_analysis_plan',
        model: config.model,
        instructions: CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_INSTRUCTIONS,
        input,
      }, 'planner_repair');
      return planOutput(response, config.model, 'planner_repair');
    },

    async generateAnswer(input) {
      const response = await postJson(config, {
        task: 'generate_answer',
        model: config.model,
        instructions: CUSTOMER_INTELLIGENCE_COPILOT_ANSWER_INSTRUCTIONS,
        input,
      }, 'answerer');
      return answerOutput(response, config.model, 'answerer');
    },
  };
}

async function postJson(config: HttpJsonCopilotModelConfig, body: unknown, stage: HttpJsonProviderCallStage): Promise<HttpJsonProviderOutput> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const requestBody = JSON.stringify(body);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: requestBody,
      signal: controller.signal,
    }).catch((error: unknown) => {
      if (isAbortError(error)) {
        throw providerError(config, stage, 'provider_timeout', 'Copilot model provider timed out', null);
      }
      throw providerError(config, stage, 'provider_network_error', 'Copilot model provider network error', null);
    });
    if (!response.ok) {
      throw providerError(config, stage, categoryForHttpStatus(response.status), `Copilot model provider returned HTTP ${response.status}`, response.status);
    }
    try {
      const raw = await response.json();
      return { raw, promptCharCount: requestBody.length, responseCharCount: (JSON.stringify(raw) ?? '').length };
    } catch (error) {
      if (isAbortError(error)) {
        throw providerError(config, stage, 'provider_timeout', 'Copilot model provider timed out', response.status);
      }
      throw providerError(config, stage, 'provider_invalid_response', 'Copilot model provider returned malformed JSON', response.status);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function decisionOutput(output: HttpJsonProviderOutput, fallbackModel: string, stage: Extract<HttpJsonProviderCallStage, 'orchestrator' | 'orchestrator_repair'>): GenerateConversationDecisionOutput {
  const obj = expectObject(output.raw, fallbackModel, stage);
  return {
    decision: obj.decision ?? obj.output ?? obj,
    metadata: metadataFromObject(obj, fallbackModel, output),
  };
}

function planOutput(output: HttpJsonProviderOutput, fallbackModel: string, stage: Extract<HttpJsonProviderCallStage, 'planner' | 'planner_repair'>): GenerateAnalysisPlanOutput {
  const obj = expectObject(output.raw, fallbackModel, stage);
  return {
    plan: obj.plan ?? obj.output ?? obj,
    metadata: metadataFromObject(obj, fallbackModel, output),
  };
}

function answerOutput(output: HttpJsonProviderOutput, fallbackModel: string, stage: Extract<HttpJsonProviderCallStage, 'answerer'>): GenerateAnswerOutput {
  const obj = expectObject(output.raw, fallbackModel, stage);
  const answer = obj.answer ?? obj.output;
  if (typeof answer !== 'string' || answer.trim().length === 0) {
    throw providerError({ model: String(obj.model ?? fallbackModel) }, stage, 'provider_invalid_response', 'Copilot model provider did not return a non-empty answer', null, String(obj.provider ?? 'http_json'));
  }
  return {
    answer,
    metadata: metadataFromObject(obj, fallbackModel, output),
  };
}

function expectObject(value: unknown, fallbackModel: string, stage: HttpJsonProviderCallStage): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw providerError({ model: fallbackModel }, stage, 'provider_invalid_response', 'Copilot model provider returned a non-object response', null);
  }
  return value as Record<string, unknown>;
}

function metadataFromObject(obj: Record<string, unknown>, fallbackModel: string, output: HttpJsonProviderOutput) {
  return {
    provider: String(obj.provider ?? 'http_json'),
    model: String(obj.model ?? fallbackModel),
    promptCharCount: output.promptCharCount,
    responseCharCount: output.responseCharCount,
    ...usageMetadata(obj),
  };
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

function categoryForHttpStatus(status: number): HttpJsonProviderErrorCategory {
  if (status === 401 || status === 403) return 'provider_authentication_error';
  if (status === 402) return 'provider_billing_error';
  if (status === 429) return 'provider_rate_limited';
  return 'provider_invalid_response';
}

function providerError(
  config: Pick<HttpJsonCopilotModelConfig, 'model'>,
  stage: HttpJsonProviderCallStage,
  category: HttpJsonProviderErrorCategory,
  message: string,
  httpStatus: number | null,
  provider = 'http_json',
): HttpJsonCopilotProviderError {
  return new HttpJsonCopilotProviderError(category, message, {
    provider,
    model: config.model,
    stage,
    httpStatus,
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message));
}
