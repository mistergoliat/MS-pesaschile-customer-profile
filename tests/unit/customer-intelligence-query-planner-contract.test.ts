import { describe, expect, it } from 'vitest';
import { serializeAnalyticalQueryContractForCopilot } from '../../src/domain/customer-intelligence-copilot/index.js';
import { validateAnalyticalQueryPlan } from '../../src/domain/customer-intelligence-query/index.js';

function expectOk(result: ReturnType<typeof validateAnalyticalQueryPlan>) {
  if (!result.ok) throw new Error(`expected ok, got errors: ${result.errors.join('; ')}`);
  return result.plan;
}

function expectRejected(result: ReturnType<typeof validateAnalyticalQueryPlan>, pattern: RegExp) {
  if (result.ok) throw new Error('expected validation to fail, but it succeeded');
  expect(result.errors.join('\n')).toMatch(pattern);
}

describe('AnalyticalQueryPlan planner contract regressions', () => {
  it('accepts the total-population count aggregate shape', () => {
    const plan = expectOk(
      validateAnalyticalQueryPlan({
        planVersion: 'customer-intelligence-query-plan-v1',
        metrics: [{ aggregation: 'count', alias: 'customer_count' }],
      }),
    );

    expect(plan.mode).toBe('aggregate');
    expect(plan.canonical).toMatchObject({
      planVersion: 'customer-intelligence-query-plan-v1',
      metrics: [{ aggregation: 'count', alias: 'customer_count' }],
    });
    expect(plan.canonical).not.toHaveProperty('select');
  });

  it('accepts the customers-per-cluster aggregate shape', () => {
    const plan = expectOk(
      validateAnalyticalQueryPlan({
        planVersion: 'customer-intelligence-query-plan-v1',
        dimensions: ['cluster.clusterId'],
        metrics: [{ aggregation: 'count', alias: 'customer_count' }],
        orderBy: [{ field: 'customer_count', direction: 'desc' }],
      }),
    );

    expect(plan.mode).toBe('aggregate');
    expect(plan.dimensions.map((dimension) => dimension.logicalName)).toEqual(['cluster.clusterId']);
    expect(plan.metrics.map((metric) => metric.alias)).toEqual(['customer_count']);
  });

  it('accepts the average-ticket-by-cluster aggregate ranking shape', () => {
    const plan = expectOk(
      validateAnalyticalQueryPlan({
        planVersion: 'customer-intelligence-query-plan-v1',
        dimensions: ['cluster.clusterId'],
        metrics: [{ aggregation: 'avg', field: 'commercial.averageOrderValueTaxIncl', alias: 'avg_ticket' }],
        orderBy: [{ field: 'avg_ticket', direction: 'desc' }],
        limit: 1,
      }),
    );

    expect(plan.mode).toBe('aggregate');
    expect(plan.metrics[0]?.fieldMeta?.logicalName).toBe('commercial.averageOrderValueTaxIncl');
    expect(plan.metrics[0]?.alias).toBe('avg_ticket');
  });

  it('rejects a plan without row or aggregate mode', () => {
    expectRejected(validateAnalyticalQueryPlan({}), /must specify either "select".*or "metrics"/);
  });

  it('rejects missing metric aliases', () => {
    expectRejected(validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'count' }] }), /alias matching/);
  });

  it('rejects unsafe planner alias examples', () => {
    for (const alias of ['customer count', 'clientes-total', '123count']) {
      expectRejected(validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'count', alias }] }), /alias matching/);
    }
  });

  it('accepts count without field', () => {
    const plan = expectOk(validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'count', alias: 'customer_count' }] }));
    expect(plan.metrics[0]?.fieldMeta).toBeNull();
  });

  it('rejects avg without field', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'avg', alias: 'avg_ticket' }] }),
      /aggregation "avg" requires a string field/,
    );
  });

  it('rejects select and metrics together', () => {
    expectRejected(
      validateAnalyticalQueryPlan({
        select: ['customer.customerId'],
        metrics: [{ aggregation: 'count', alias: 'customer_count' }],
      }),
      /cannot mix row-mode "select" with aggregate-mode "metrics"/,
    );
  });

  it('keeps every planner queryContract example valid against the runtime validator', () => {
    const contract = serializeAnalyticalQueryContractForCopilot();

    expect(contract.planVersion).toBe('customer-intelligence-query-plan-v1');
    expect(contract.metricSchema.alias.pattern).toBe('^[A-Za-z_][A-Za-z0-9_]*$');
    for (const example of contract.examples) {
      expect(validateAnalyticalQueryPlan(example.plan).ok).toBe(true);
    }
  });
});
