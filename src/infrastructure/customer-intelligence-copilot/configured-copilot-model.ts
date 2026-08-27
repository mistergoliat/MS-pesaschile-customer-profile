import type { CustomerIntelligenceCopilotModel } from '../../application/customer-intelligence-copilot/index.js';
import { createHttpJsonCopilotModel } from './http-json-copilot-model.js';
import { createOpenAiCompatibleCopilotModel } from './openai-compatible-copilot-model.js';

export type ConfiguredCopilotModelResult =
  | {
      readonly status: 'configured';
      readonly model: CustomerIntelligenceCopilotModel;
      readonly provider: string;
      readonly modelName: string;
      readonly toolSelectionTimeoutMs: number;
      readonly toolSynthesisTimeoutMs: number;
    }
  | { readonly status: 'not_configured'; readonly reason: string };

// task MARKETING-R1-T05.8.8 Section 2: tool_selection and tool_synthesis get their own
// configurable provider timeout, independent from the legacy `CUSTOMER_INTELLIGENCE_COPILOT_
// TIMEOUT_MS` still used by orchestrator/planner/answerer/unified_planner. Bounded so a
// misconfigured deployment cannot silently make every provider call wait unboundedly.
export const CUSTOMER_INTELLIGENCE_COPILOT_STAGE_TIMEOUT_DEFAULT_MS = 45000;
export const CUSTOMER_INTELLIGENCE_COPILOT_STAGE_TIMEOUT_MAX_MS = 60000;

export function createConfiguredCustomerIntelligenceCopilotModel(env: NodeJS.ProcessEnv = process.env): ConfiguredCopilotModelResult {
  const provider = env.CUSTOMER_INTELLIGENCE_COPILOT_PROVIDER;
  if (!provider) {
    return { status: 'not_configured', reason: 'CUSTOMER_INTELLIGENCE_COPILOT_PROVIDER is not configured' };
  }
  if (provider !== 'http_json' && provider !== 'openai_compatible') {
    return { status: 'not_configured', reason: `Unsupported CUSTOMER_INTELLIGENCE_COPILOT_PROVIDER: ${provider}` };
  }

  const endpoint = env.CUSTOMER_INTELLIGENCE_COPILOT_ENDPOINT;
  const modelName = env.CUSTOMER_INTELLIGENCE_COPILOT_MODEL ?? 'customer-intelligence-copilot';
  if (!endpoint) {
    return { status: 'not_configured', reason: `CUSTOMER_INTELLIGENCE_COPILOT_ENDPOINT is required for ${provider} provider` };
  }
  if (provider === 'openai_compatible' && !env.CUSTOMER_INTELLIGENCE_COPILOT_MODEL) {
    return { status: 'not_configured', reason: 'CUSTOMER_INTELLIGENCE_COPILOT_MODEL is required for openai_compatible provider' };
  }
  const timeoutMs = Number(env.CUSTOMER_INTELLIGENCE_COPILOT_TIMEOUT_MS ?? 30000);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    return { status: 'not_configured', reason: 'CUSTOMER_INTELLIGENCE_COPILOT_TIMEOUT_MS must be a positive integer' };
  }

  const toolSelectionTimeout = resolveStageTimeoutMs(env.CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SELECTION_TIMEOUT_MS, 'CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SELECTION_TIMEOUT_MS');
  if (!toolSelectionTimeout.ok) return { status: 'not_configured', reason: toolSelectionTimeout.reason };
  const toolSynthesisTimeout = resolveStageTimeoutMs(env.CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SYNTHESIS_TIMEOUT_MS, 'CUSTOMER_INTELLIGENCE_COPILOT_TOOL_SYNTHESIS_TIMEOUT_MS');
  if (!toolSynthesisTimeout.ok) return { status: 'not_configured', reason: toolSynthesisTimeout.reason };

  const orchestratorModelName = env.CUSTOMER_INTELLIGENCE_COPILOT_ORCHESTRATOR_MODEL ?? modelName;
  const plannerModelName = env.CUSTOMER_INTELLIGENCE_COPILOT_PLANNER_MODEL ?? modelName;
  const answererModelName = env.CUSTOMER_INTELLIGENCE_COPILOT_ANSWERER_MODEL ?? modelName;
  const createModel = (stageModelName: string): CustomerIntelligenceCopilotModel =>
    provider === 'openai_compatible'
      ? createOpenAiCompatibleCopilotModel({
          endpoint,
          apiKey: env.CUSTOMER_INTELLIGENCE_COPILOT_API_KEY ?? null,
          model: stageModelName,
          timeoutMs,
          toolSelectionTimeoutMs: toolSelectionTimeout.value,
          toolSynthesisTimeoutMs: toolSynthesisTimeout.value,
        })
      : createHttpJsonCopilotModel({
          endpoint,
          apiKey: env.CUSTOMER_INTELLIGENCE_COPILOT_API_KEY ?? null,
          model: stageModelName,
          timeoutMs,
        });

  const model =
    orchestratorModelName === modelName && plannerModelName === modelName && answererModelName === modelName
      ? createModel(modelName)
      : createStageRoutedModel({
          orchestrator: createModel(orchestratorModelName),
          planner: createModel(plannerModelName),
          answerer: createModel(answererModelName),
        });

  return {
    status: 'configured',
    provider,
    modelName,
    model,
    toolSelectionTimeoutMs: toolSelectionTimeout.value,
    toolSynthesisTimeoutMs: toolSynthesisTimeout.value,
  };
}

function resolveStageTimeoutMs(rawValue: string | undefined, envVarName: string): { readonly ok: true; readonly value: number } | { readonly ok: false; readonly reason: string } {
  const value = Number(rawValue ?? CUSTOMER_INTELLIGENCE_COPILOT_STAGE_TIMEOUT_DEFAULT_MS);
  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, reason: `${envVarName} must be a positive integer` };
  }
  if (value > CUSTOMER_INTELLIGENCE_COPILOT_STAGE_TIMEOUT_MAX_MS) {
    return { ok: false, reason: `${envVarName} must not exceed ${CUSTOMER_INTELLIGENCE_COPILOT_STAGE_TIMEOUT_MAX_MS}` };
  }
  return { ok: true, value };
}

function createStageRoutedModel(models: {
  readonly orchestrator: CustomerIntelligenceCopilotModel;
  readonly planner: CustomerIntelligenceCopilotModel;
  readonly answerer: CustomerIntelligenceCopilotModel;
}): CustomerIntelligenceCopilotModel {
  const supportsToolRuntime = !!models.planner.generateConversationalTurn && !!models.answerer.generateConversationalTurn;
  return {
    ...(supportsToolRuntime
      ? {
          generateConversationalTurn: (input) => {
            const model = input.stage === 'tool_synthesis' ? models.answerer : models.planner;
            return model.generateConversationalTurn!(input);
          },
        }
      : {}),
    generateConversationPlan: (input) => {
      if (!models.planner.generateConversationPlan) throw new Error('planner model does not support unified conversation planning');
      return models.planner.generateConversationPlan(input);
    },
    repairConversationPlan: (input) => {
      if (!models.planner.repairConversationPlan) throw new Error('planner model does not support unified conversation plan repair');
      return models.planner.repairConversationPlan(input);
    },
    generateConversationDecision: (input) => models.orchestrator.generateConversationDecision(input),
    repairConversationDecision: (input) => models.orchestrator.repairConversationDecision(input),
    generateAnalysisPlan: (input) => models.planner.generateAnalysisPlan(input),
    repairAnalysisPlan: (input) => models.planner.repairAnalysisPlan(input),
    generateAnswer: (input) => models.answerer.generateAnswer(input),
  };
}
