import { describe, expect, it, vi } from 'vitest';
import {
  createCapabilityBudget,
  createCustomerIntelligenceAnalyticsQueryCapability,
  createCustomerIntelligenceCapabilityRegistry,
  createCustomerIntelligenceAnalyticsQueryDescriptor,
} from '../../src/application/customer-intelligence-capability/index.js';
import type { CapabilityError as CapabilityErrorType } from '../../src/application/customer-intelligence-capability/index.js';
import { createCopilotAnalyticsCapabilityAdapter } from '../../src/application/customer-intelligence-copilot/analytics-capability-adapter.js';
import { AnalyticsTimeoutError, AnalyticsUnavailableError } from '../../src/application/customer-profile/errors.js';
import type { CustomerIntelligenceSnapshotContext } from '../../src/domain/customer-intelligence/index.js';
import type { AnalyticalQueryPlan, AnalyticalQueryResult } from '../../src/domain/customer-intelligence-query/index.js';
import type { ExecuteAnalyticalQueryWithResolvedContext } from '../../src/application/customer-intelligence-query/index.js';

const CONTEXT: CustomerIntelligenceSnapshotContext = {
  featureSnapshot: { snapshotId: '17', referenceTime: '2026-08-19T00:00:00.000Z', featureVersion: 'features-v1', populationPolicyVersion: 'population-v1' },
  rfmSnapshot: { snapshotId: '3', referenceTime: '2026-08-18T00:00:00.000Z', calculationVersion: 'rfm-v1' },
  clusterSnapshot: { snapshotId: '5', referenceTime: '2026-08-18T00:00:00.000Z', modelId: '2', modelVersion: 'cluster-v1' },
  population: { featurePopulation: 10, rfmMatched: 7, clusterMatched: 4, bothMatched: 3, neitherMatched: 2, rfmCoveragePct: 70, clusterCoveragePct: 40 },
  contractVersion: 'customer-intelligence-read-model-v1',
};

const RESOLVED_IDS = {
  featureSnapshotId: '17', featureReferenceTime: '2026-08-19T00:00:00.000Z', featureVersion: 'features-v1', populationPolicyVersion: 'population-v1',
  rfmSnapshotId: '3', rfmReferenceTime: '2026-08-18T00:00:00.000Z', calculationVersion: 'rfm-v1',
  clusterSnapshotId: '5', clusterReferenceTime: '2026-08-18T00:00:00.000Z', clusterModelId: '2', clusterModelVersion: 'cluster-v1',
};

const PLAN: AnalyticalQueryPlan = { metrics: [{ aggregation: 'count', alias: 'customers' }], limit: 1 };

function result(): AnalyticalQueryResult {
  return {
    queryVersion: 'customer-intelligence-query-v1', queryPlanHash: 'a'.repeat(64), context: CONTEXT,
    columns: [{ name: 'customers', type: 'integer' }], rows: [{ customers: 2 }], rowCount: 1,
    execution: { durationMs: 1, truncated: false },
  };
}

function context(budget = createCapabilityBudget({ maxCalls: 3, maxRows: 3000, maxDurationMs: 10_000 })) {
  return { requestId: 'req-1', caller: 'test', pinnedContext: CONTEXT, resolvedIds: RESOLVED_IDS, budget };
}

function capability(executeAnalyticalQuery: ExecuteAnalyticalQueryWithResolvedContext = vi.fn(async () => ({ status: 'ok' as const, result: result() }))) {
  return createCustomerIntelligenceAnalyticsQueryCapability({ executeAnalyticalQuery });
}

describe('customer-intelligence.analytics.query capability', () => {
  it('publishes one logical, read-only descriptor without physical SQL', () => {
    const descriptor = createCustomerIntelligenceAnalyticsQueryDescriptor();
    expect(descriptor.id).toBe('customer-intelligence.analytics.query');
    expect(descriptor.mutability).toBe('read_only');
    expect(descriptor.inputSchema).not.toHaveProperty('sqlExpression');
    expect(JSON.stringify(descriptor)).not.toMatch(/sqlExpression|compiledSql|boundParameters/i);
  });

  it('validates before execution and returns the existing typed result/provenance', async () => {
    const execute = vi.fn(async () => ({ status: 'ok' as const, result: result() }));
    const output = await capability(execute).execute(PLAN, context());
    expect(output.output).toEqual(result());
    expect(execute).toHaveBeenCalledOnce();
    expect((execute.mock.calls as unknown as readonly [{ readonly 0: { readonly context: CustomerIntelligenceSnapshotContext } }])[0][0].context).toEqual(CONTEXT);
  });

  it('applies selected-population scope and revalidates the composed plan', async () => {
    const execute = vi.fn(async () => ({ status: 'ok' as const, result: result() }));
    await capability(execute).execute(PLAN, {
      ...context(),
      selectedPopulation: { filters: { field: 'commercial.validOrders', operator: 'gt', value: 1 }, queryPlanHash: 'scope-hash' },
    });
    expect((execute.mock.calls as unknown as readonly [{ readonly 0: { readonly plan: AnalyticalQueryPlan } }])[0][0].plan.filters).toEqual({ and: [{ field: 'commercial.validOrders', operator: 'gt', value: 1 }] });

    await expect(capability(execute).execute(PLAN, {
      ...context(),
      selectedPopulation: { filters: { field: 'not-a-logical-field', operator: 'eq', value: 1 } as never, queryPlanHash: 'bad' },
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('enforces the deterministic turn budget before calling the executor', async () => {
    const execute = vi.fn(async () => ({ status: 'ok' as const, result: result() }));
    const budget = createCapabilityBudget({ maxCalls: 1, maxRows: 1, maxDurationMs: 1000 });
    await capability(execute).execute(PLAN, context(budget));
    await expect(capability(execute).execute(PLAN, context(budget))).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each([
    [new AnalyticsTimeoutError('slow'), 'TIMEOUT'],
    [new AnalyticsUnavailableError('down'), 'ANALYTICS_UNAVAILABLE'],
  ] as const)('normalizes runtime failure %s to %s', async (error, code) => {
    const execute = vi.fn(async () => { throw error; });
    await expect(capability(execute).execute(PLAN, context())).rejects.toMatchObject({ code });
  });

  it('keeps the registry brain-neutral and the Copilot adapter thin', async () => {
    const registry = createCustomerIntelligenceCapabilityRegistry({ analyticsQuery: capability() });
    expect(registry.listDescriptors()).toHaveLength(1);
    expect(registry.getDescriptor('customer-intelligence.analytics.query')?.id).toBe('customer-intelligence.analytics.query');
    const output = await createCopilotAnalyticsCapabilityAdapter(registry).execute({ plan: PLAN, ...context() });
    expect(output.queryPlanHash).toBe('a'.repeat(64));
    await expect(registry.execute('unknown.capability', PLAN, context())).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('exposes the required neutral error vocabulary', () => {
    const codes: CapabilityErrorType['code'][] = ['INVALID_INPUT', 'UNAVAILABLE_SNAPSHOT', 'ANALYTICS_UNAVAILABLE', 'TIMEOUT', 'BUDGET_EXCEEDED', 'UNAUTHORIZED', 'EXECUTION_FAILED'];
    expect(codes).toHaveLength(7);
  });
});
