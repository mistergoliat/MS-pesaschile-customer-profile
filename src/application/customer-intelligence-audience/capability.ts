import type { AudienceEvaluationResultV1 } from '../../domain/customer-intelligence-audience/index.js';
import { CUSTOMER_INTELLIGENCE_AUDIENCE_DEFAULT_PREVIEW_LIMIT, CUSTOMER_INTELLIGENCE_AUDIENCE_CAPABILITY_VERSION } from './schema.js';
import type { EvaluateAudience } from './ports.js';
import type { AudiencePreviewEnricher, AudiencePreviewV1 } from './preview.js';

export type EvaluateAudienceCapabilityRequest = {
  readonly definition: unknown;
  readonly previewLimit?: number;
};

export type EvaluateAudienceCapabilityResponse = {
  readonly capabilityVersion: typeof CUSTOMER_INTELLIGENCE_AUDIENCE_CAPABILITY_VERSION;
  readonly evaluation: AudienceEvaluationResultV1;
  readonly preview: AudiencePreviewV1 | null;
};

export type CustomerIntelligenceAudienceCapability = {
  readonly evaluate: (request: EvaluateAudienceCapabilityRequest) => Promise<EvaluateAudienceCapabilityResponse>;
};

export function createCustomerIntelligenceAudienceCapability(deps: { readonly evaluateAudience: EvaluateAudience; readonly previewEnricher: AudiencePreviewEnricher }): CustomerIntelligenceAudienceCapability {
  return {
    async evaluate(request) {
      const evaluation = await deps.evaluateAudience({ definition: request.definition, previewLimit: request.previewLimit ?? CUSTOMER_INTELLIGENCE_AUDIENCE_DEFAULT_PREVIEW_LIMIT });
      if (evaluation.status !== 'completed') return { capabilityVersion: CUSTOMER_INTELLIGENCE_AUDIENCE_CAPABILITY_VERSION, evaluation, preview: null };
      const preview = await deps.previewEnricher({ context: evaluation.context, customerIds: evaluation.previewMembers.map((member) => member.customerId), matchedCount: evaluation.matchedCount, limit: request.previewLimit ?? CUSTOMER_INTELLIGENCE_AUDIENCE_DEFAULT_PREVIEW_LIMIT });
      return { capabilityVersion: CUSTOMER_INTELLIGENCE_AUDIENCE_CAPABILITY_VERSION, evaluation, preview };
    },
  };
}
