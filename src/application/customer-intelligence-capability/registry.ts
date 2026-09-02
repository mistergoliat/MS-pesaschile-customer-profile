import {
  CapabilityError,
  type CapabilityDescriptor,
  type CapabilityExecutionContext,
  type CapabilityExecutionResult,
  type CustomerIntelligenceAnalyticsQueryCapability,
  type CustomerIntelligenceCapabilityRegistry,
} from './contracts.js';

export function createCustomerIntelligenceCapabilityRegistry(deps: {
  readonly analyticsQuery: CustomerIntelligenceAnalyticsQueryCapability;
}): CustomerIntelligenceCapabilityRegistry {
  const capabilities = new Map([[deps.analyticsQuery.descriptor.id, deps.analyticsQuery]]);

  return {
    getDescriptor(id: string): CapabilityDescriptor | null {
      return capabilities.get(id)?.descriptor ?? null;
    },
    listDescriptors(): readonly CapabilityDescriptor[] {
      return [...capabilities.values()].map((capability) => capability.descriptor);
    },
    async execute(id: string, input: unknown, context: CapabilityExecutionContext): Promise<CapabilityExecutionResult<unknown>> {
      const capability = capabilities.get(id);
      if (!capability) throw new CapabilityError('INVALID_INPUT', `unknown capability: ${id}`, id);
      return capability.execute(input as never, context);
    },
  };
}
