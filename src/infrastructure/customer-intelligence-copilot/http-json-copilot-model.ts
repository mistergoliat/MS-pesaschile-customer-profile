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

export function createHttpJsonCopilotModel(config: HttpJsonCopilotModelConfig): CustomerIntelligenceCopilotModel {
  return {
    async generateConversationDecision(input) {
      const response = await postJson(config, {
        task: 'generate_conversation_decision',
        model: config.model,
        instructions: CUSTOMER_INTELLIGENCE_COPILOT_ORCHESTRATOR_INSTRUCTIONS,
        input,
      });
      return decisionOutput(response, config.model);
    },

    async repairConversationDecision(input) {
      const response = await postJson(config, {
        task: 'repair_conversation_decision',
        model: config.model,
        instructions: CUSTOMER_INTELLIGENCE_COPILOT_ORCHESTRATOR_INSTRUCTIONS,
        input,
      });
      return decisionOutput(response, config.model);
    },

    async generateAnalysisPlan(input) {
      const response = await postJson(config, {
        task: 'generate_analysis_plan',
        model: config.model,
        instructions: CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_INSTRUCTIONS,
        input,
      });
      return planOutput(response, config.model);
    },

    async repairAnalysisPlan(input) {
      const response = await postJson(config, {
        task: 'repair_analysis_plan',
        model: config.model,
        instructions: CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_INSTRUCTIONS,
        input,
      });
      return planOutput(response, config.model);
    },

    async generateAnswer(input) {
      const response = await postJson(config, {
        task: 'generate_answer',
        model: config.model,
        instructions: CUSTOMER_INTELLIGENCE_COPILOT_ANSWER_INSTRUCTIONS,
        input,
      });
      return answerOutput(response, config.model);
    },
  };
}

async function postJson(config: HttpJsonCopilotModelConfig, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Copilot model provider returned HTTP ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function decisionOutput(raw: unknown, fallbackModel: string): GenerateConversationDecisionOutput {
  const obj = expectObject(raw);
  return {
    decision: obj.decision ?? obj.output ?? obj,
    metadata: { provider: String(obj.provider ?? 'http_json'), model: String(obj.model ?? fallbackModel) },
  };
}

function planOutput(raw: unknown, fallbackModel: string): GenerateAnalysisPlanOutput {
  const obj = expectObject(raw);
  return {
    plan: obj.plan ?? obj.output ?? obj,
    metadata: { provider: String(obj.provider ?? 'http_json'), model: String(obj.model ?? fallbackModel) },
  };
}

function answerOutput(raw: unknown, fallbackModel: string): GenerateAnswerOutput {
  const obj = expectObject(raw);
  const answer = obj.answer ?? obj.output;
  if (typeof answer !== 'string' || answer.trim().length === 0) {
    throw new Error('Copilot model provider did not return a non-empty answer');
  }
  return {
    answer,
    metadata: { provider: String(obj.provider ?? 'http_json'), model: String(obj.model ?? fallbackModel) },
  };
}

function expectObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Copilot model provider returned a non-object response');
  }
  return value as Record<string, unknown>;
}
