import {
  MAX_RESULT_ROWS,
  validateAnalyticalQueryPlan,
  type AnalyticalQueryResult,
} from '../../domain/customer-intelligence-query/index.js';
import type { ExecuteAnalyticalQueryWithResolvedContext } from '../customer-intelligence-query/index.js';
import { getAnalyticalSchema } from '../customer-intelligence-query/get-analytical-schema.js';
import {
  CUSTOMER_INTELLIGENCE_ANALYTICS_QUERY_CAPABILITY_ID,
  CUSTOMER_INTELLIGENCE_ANALYTICS_QUERY_CAPABILITY_VERSION,
  CapabilityError,
  type AnalyticalCapabilityInputSchema,
  type CapabilityDescriptor,
  type CapabilityExecutionResult,
  type CustomerIntelligenceAnalyticsQueryCapability,
} from './contracts.js';
import { recordCapabilityExecution, reserveCapabilityCall } from './budget.js';
import { composeSelectedPopulationScope } from './selected-population-scope.js';
import { normalizeCapabilityError } from './errors.js';

const UNBOUNDED_COMPATIBILITY_DURATION_MS = Number.MAX_SAFE_INTEGER;

export function createCustomerIntelligenceAnalyticsQueryCapability(deps: {
  readonly executeAnalyticalQuery: ExecuteAnalyticalQueryWithResolvedContext;
}): CustomerIntelligenceAnalyticsQueryCapability {
  const descriptor = createCustomerIntelligenceAnalyticsQueryDescriptor();

  return {
    descriptor,
    async execute(input, context): Promise<CapabilityExecutionResult<AnalyticalQueryResult>> {
      const selectedFilters = context.selectedPopulation?.filters ?? null;
      const composedFilters = composeSelectedPopulationScope(input.filters, selectedFilters);
      const scopedPlan = {
        ...input,
        ...(composedFilters !== undefined
          ? { filters: composedFilters }
          : {}),
      };
      const validation = validateAnalyticalQueryPlan(scopedPlan);
      if (!validation.ok) {
        throw new CapabilityError('INVALID_INPUT', validation.errors.join('; '));
      }

      const durationBudgetAtStart = reserveCapabilityCall(context.budget, validation.plan.limit);
      const startedAt = Date.now();
      let execution: Awaited<ReturnType<ExecuteAnalyticalQueryWithResolvedContext>>;
      try {
        execution = await deps.executeAnalyticalQuery({
          plan: validation.plan.canonical,
          context: context.pinnedContext,
          resolvedIds: context.resolvedIds,
        });
      } catch (error) {
        recordCapabilityExecution(context.budget, 0, Date.now() - startedAt);
        throw normalizeCapabilityError(error);
      }
      const durationMs = Date.now() - startedAt;
      recordCapabilityExecution(context.budget, execution.status === 'ok' ? execution.result.rowCount : 0, durationMs);
      if (durationMs > durationBudgetAtStart) {
        throw new CapabilityError('BUDGET_EXCEEDED', 'capability duration budget exhausted');
      }
      if (execution.status === 'invalid_plan') {
        throw new CapabilityError('INVALID_INPUT', execution.errors.join('; '));
      }

      return {
        capabilityId: descriptor.id,
        capabilityVersion: descriptor.version,
        output: execution.result,
      };
    },
  };
}

export function createCustomerIntelligenceAnalyticsQueryDescriptor(): CapabilityDescriptor {
  const schema = getAnalyticalSchema();
  const boundedness = {
    maxCalls: 1,
    maxRows: MAX_RESULT_ROWS,
    maxDurationMs: UNBOUNDED_COMPATIBILITY_DURATION_MS,
  } as const;
  const inputSchema: AnalyticalCapabilityInputSchema = {
    type: 'object',
    additionalProperties: false,
    schemaVersion: schema.schemaVersion,
    readModelVersion: schema.readModelVersion,
    fields: schema.fields,
    limits: boundedness,
  };
  return {
    id: CUSTOMER_INTELLIGENCE_ANALYTICS_QUERY_CAPABILITY_ID,
    version: CUSTOMER_INTELLIGENCE_ANALYTICS_QUERY_CAPABILITY_VERSION,
    description: 'Execute one bounded, read-only Customer Intelligence analytical query over logical fields.',
    mutability: 'read_only',
    boundedness,
    inputSchema,
    outputSchema: {
      type: 'object',
      properties: {
        queryVersion: { const: 'customer-intelligence-query-v1' },
        queryPlanHash: { type: 'string' },
        context: { type: 'object' },
        columns: { type: 'array' },
        rows: { type: 'array' },
        rowCount: { type: 'integer', minimum: 0 },
        execution: { type: 'object', properties: { durationMs: { type: 'integer' }, truncated: { type: 'boolean' } } },
      },
      required: ['queryVersion', 'queryPlanHash', 'context', 'columns', 'rows', 'rowCount', 'execution'],
    },
  };
}
