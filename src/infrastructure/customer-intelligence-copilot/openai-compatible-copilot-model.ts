import type {
  CustomerIntelligenceCopilotModel,
  GenerateAnalysisPlanOutput,
  GenerateAnswerOutput,
} from '../../application/customer-intelligence-copilot/index.js';
import {
  CUSTOMER_INTELLIGENCE_COPILOT_ANSWER_INSTRUCTIONS,
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

export function createOpenAiCompatibleCopilotModel(config: OpenAiCompatibleCopilotModelConfig): CustomerIntelligenceCopilotModel {
  return {
    async generateAnalysisPlan(input) {
      const content = await postChatCompletion(config, {
        messages: [
          { role: 'system', content: plannerSystemPrompt() },
          { role: 'user', content: serializeUserInput({ task: 'generate_analysis_plan', input }) },
        ],
        responseFormat: 'json_object',
      });
      return planOutput(content, config.model);
    },

    async repairAnalysisPlan(input) {
      const content = await postChatCompletion(config, {
        messages: [
          { role: 'system', content: plannerSystemPrompt() },
          { role: 'user', content: serializeUserInput({ task: 'repair_analysis_plan', input }) },
        ],
        responseFormat: 'json_object',
      });
      return planOutput(content, config.model);
    },

    async generateAnswer(input) {
      const content = await postChatCompletion(config, {
        messages: [
          { role: 'system', content: answerSystemPrompt() },
          { role: 'user', content: serializeUserInput({ task: 'generate_answer', input }) },
        ],
      });
      return answerOutput(content, config.model);
    },
  };
}

async function postChatCompletion(
  config: OpenAiCompatibleCopilotModelConfig,
  request: { readonly messages: readonly ChatMessage[]; readonly responseFormat?: 'json_object' },
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
    });
    if (!response.ok) {
      throw new Error(`Copilot model provider returned HTTP ${response.status}`);
    }
    return extractMessageContent(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

function planOutput(content: string, model: string): GenerateAnalysisPlanOutput {
  try {
    return {
      plan: JSON.parse(content),
      metadata: { provider: 'openai_compatible', model },
    };
  } catch (error) {
    throw new Error(`Copilot model provider returned invalid planner JSON: ${errorMessage(error)}`);
  }
}

function answerOutput(answer: string, model: string): GenerateAnswerOutput {
  return {
    answer,
    metadata: { provider: 'openai_compatible', model },
  };
}

function extractMessageContent(raw: unknown): string {
  const obj = expectObject(raw, 'Copilot model provider returned a non-object response');
  if (!Array.isArray(obj.choices) || obj.choices.length === 0) {
    throw new Error('Copilot model provider returned no choices');
  }
  const [firstChoice] = obj.choices;
  const choice = expectObject(firstChoice, 'Copilot model provider returned a malformed choice');
  const message = expectObject(choice.message, 'Copilot model provider returned a malformed message');
  if (typeof message.content !== 'string' || message.content.trim().length === 0) {
    throw new Error('Copilot model provider returned empty message content');
  }
  return message.content;
}

function expectObject(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
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
