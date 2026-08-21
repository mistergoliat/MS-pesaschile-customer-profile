import type { CustomerIntelligenceCopilotModel } from '../../application/customer-intelligence-copilot/index.js';
import { createHttpJsonCopilotModel } from './http-json-copilot-model.js';
import { createOpenAiCompatibleCopilotModel } from './openai-compatible-copilot-model.js';

export type ConfiguredCopilotModelResult =
  | { readonly status: 'configured'; readonly model: CustomerIntelligenceCopilotModel; readonly provider: string; readonly modelName: string }
  | { readonly status: 'not_configured'; readonly reason: string };

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

  const model =
    provider === 'openai_compatible'
      ? createOpenAiCompatibleCopilotModel({
          endpoint,
          apiKey: env.CUSTOMER_INTELLIGENCE_COPILOT_API_KEY ?? null,
          model: modelName,
          timeoutMs,
        })
      : createHttpJsonCopilotModel({
          endpoint,
          apiKey: env.CUSTOMER_INTELLIGENCE_COPILOT_API_KEY ?? null,
          model: modelName,
          timeoutMs,
        });

  return {
    status: 'configured',
    provider,
    modelName,
    model,
  };
}
