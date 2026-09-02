import type { AnalyticalQueryPlan, AnalyticalQueryResult } from '../../domain/customer-intelligence-query/index.js';
import {
  createCustomerIntelligenceAnalyticsQueryCapability,
  createCustomerIntelligenceCapabilityRegistry,
  CUSTOMER_INTELLIGENCE_ANALYTICS_QUERY_CAPABILITY_ID,
  type CapabilityBudget,
  type CapabilityExecutionContext,
  type CapabilitySelectedPopulation,
  type CustomerIntelligenceCapabilityRegistry,
} from '../customer-intelligence-capability/index.js';
import type { CustomerIntelligenceSnapshotContext } from '../../domain/customer-intelligence/index.js';
import type { ResolvedCustomerIntelligenceSnapshotIds } from '../customer-intelligence/ports.js';
import type { ExecuteAnalyticalQueryWithResolvedContext } from '../customer-intelligence-query/index.js';

export type CopilotAnalyticsCapabilityRequest = {
  readonly plan: AnalyticalQueryPlan;
  readonly requestId: string;
  readonly caller: string;
  readonly sessionId?: string;
  readonly pinnedContext: CustomerIntelligenceSnapshotContext;
  readonly resolvedIds: ResolvedCustomerIntelligenceSnapshotIds;
  readonly selectedPopulation?: CapabilitySelectedPopulation | null;
  readonly budget: CapabilityBudget;
};

export type CopilotAnalyticsCapabilityAdapter = {
  execute(request: CopilotAnalyticsCapabilityRequest): Promise<AnalyticalQueryResult>;
};

export function createCopilotAnalyticsCapabilityAdapter(
  registry: CustomerIntelligenceCapabilityRegistry,
): CopilotAnalyticsCapabilityAdapter {
  return {
    async execute(request) {
      const context: CapabilityExecutionContext = {
        requestId: request.requestId,
        caller: request.caller,
        sessionId: request.sessionId,
        pinnedContext: request.pinnedContext,
        resolvedIds: request.resolvedIds,
        selectedPopulation: request.selectedPopulation,
        budget: request.budget,
      };
      const execution = await registry.execute(CUSTOMER_INTELLIGENCE_ANALYTICS_QUERY_CAPABILITY_ID, request.plan, context);
      return execution.output as AnalyticalQueryResult;
    },
  };
}

/** Compatibility bridge for tests and scripts that still provide the pre-A01 query port. */
export function createLegacyCopilotAnalyticsCapabilityAdapter(
  executeAnalyticalQuery: ExecuteAnalyticalQueryWithResolvedContext,
): CopilotAnalyticsCapabilityAdapter {
  const capability = createCustomerIntelligenceAnalyticsQueryCapability({ executeAnalyticalQuery });
  return createCopilotAnalyticsCapabilityAdapter(createCustomerIntelligenceCapabilityRegistry({ analyticsQuery: capability }));
}
