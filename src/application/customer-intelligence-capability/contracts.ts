import type { AnalyticalFilterInput, AnalyticalQueryResult, AnalyticalQueryPlan, AnalyticalSchema } from '../../domain/customer-intelligence-query/index.js';
import type { CustomerIntelligenceSnapshotContext } from '../../domain/customer-intelligence/index.js';
import type { ResolvedCustomerIntelligenceSnapshotIds } from '../customer-intelligence/ports.js';

export const CUSTOMER_INTELLIGENCE_ANALYTICS_QUERY_CAPABILITY_ID = 'customer-intelligence.analytics.query';
export const CUSTOMER_INTELLIGENCE_ANALYTICS_QUERY_CAPABILITY_VERSION = 'customer-intelligence.analytics.query-v1';

export type CapabilityMutability = 'read_only' | 'explicit_write';

export type CapabilityBoundedness = {
  readonly maxCalls: number;
  readonly maxRows: number;
  readonly maxDurationMs: number;
};

export type CapabilityDescriptor = {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly mutability: CapabilityMutability;
  readonly boundedness: CapabilityBoundedness;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
};

export type CapabilitySelectedPopulation = {
  readonly filters: AnalyticalFilterInput | null;
  readonly queryPlanHash: string;
};

export type CapabilityExecutionContext = {
  readonly requestId: string;
  readonly caller: string;
  readonly sessionId?: string;
  readonly pinnedContext: CustomerIntelligenceSnapshotContext;
  readonly resolvedIds: ResolvedCustomerIntelligenceSnapshotIds;
  readonly selectedPopulation?: CapabilitySelectedPopulation | null;
  readonly budget: CapabilityBudget;
};

// The budget is deliberately turn-scoped and mutable only through the capability executor.
// This keeps multi-call accounting inside the application boundary without creating an
// autonomous loop or making a provider responsible for enforcement.
export type CapabilityBudget = {
  readonly maxCalls: number;
  readonly maxRows: number;
  readonly maxDurationMs: number;
  remainingCalls: number;
  remainingRows: number;
  remainingDurationMs: number;
};

export type CapabilityErrorCode =
  | 'INVALID_INPUT'
  | 'UNAVAILABLE_SNAPSHOT'
  | 'ANALYTICS_UNAVAILABLE'
  | 'TIMEOUT'
  | 'BUDGET_EXCEEDED'
  | 'UNAUTHORIZED'
  | 'EXECUTION_FAILED';

export class CapabilityError extends Error {
  constructor(
    readonly code: CapabilityErrorCode,
    message: string,
    readonly capabilityId: string = CUSTOMER_INTELLIGENCE_ANALYTICS_QUERY_CAPABILITY_ID,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'CapabilityError';
  }
}

export type CapabilityExecutionResult<T> = {
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly output: T;
};

export type CustomerIntelligenceAnalyticsQueryInput = AnalyticalQueryPlan;
export type CustomerIntelligenceAnalyticsQueryOutput = AnalyticalQueryResult;

export type CustomerIntelligenceAnalyticsQueryCapability = {
  readonly descriptor: CapabilityDescriptor;
  execute(
    input: CustomerIntelligenceAnalyticsQueryInput,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityExecutionResult<CustomerIntelligenceAnalyticsQueryOutput>>;
};

export type CustomerIntelligenceCapabilityRegistry = {
  getDescriptor(id: string): CapabilityDescriptor | null;
  listDescriptors(): readonly CapabilityDescriptor[];
  execute(id: string, input: unknown, context: CapabilityExecutionContext): Promise<CapabilityExecutionResult<unknown>>;
};

export type AnalyticalCapabilityInputSchema = {
  readonly type: 'object';
  readonly additionalProperties: false;
  readonly schemaVersion: AnalyticalSchema['schemaVersion'];
  readonly readModelVersion: string;
  readonly fields: AnalyticalSchema['fields'];
  readonly limits: CapabilityBoundedness;
};
