import { describe, expect, it } from 'vitest';
import {
  computeQueryPlanHash,
  expandCompactAnalyticalQuery,
  validateAnalyticalQueryPlan,
  type AnalyticalQueryPlan,
} from '../../src/domain/customer-intelligence-query/index.js';

function expand(query: unknown): AnalyticalQueryPlan {
  const result = expandCompactAnalyticalQuery(query);
  if (!result.ok) throw new Error(`expected compact query to expand: ${result.errors.join('; ')}`);
  return result.plan;
}

function expectRejected(query: unknown, pattern: RegExp) {
  const result = expandCompactAnalyticalQuery(query);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors.join('\n')).toMatch(pattern);
}

describe('CompactAnalyticalQuery adapter', () => {
  it('expands compact total count into a valid T03 aggregate plan', () => {
    const plan = expand({ metrics: [{ op: 'count', alias: 'customer_count' }] });

    expect(plan).toMatchObject({
      planVersion: 'customer-intelligence-query-plan-v1',
      metrics: [{ aggregation: 'count', alias: 'customer_count' }],
      limit: 100,
    });
    expect(validateAnalyticalQueryPlan(plan).ok).toBe(true);
  });

  it('expands compact grouped count and excludes null clusters when requested', () => {
    const plan = expand({
      dimensions: ['clusterId'],
      filters: [{ field: 'clusterId', op: 'is_not_null' }],
      metrics: [{ op: 'count', alias: 'customers' }],
      orderBy: [{ field: 'customers', direction: 'desc' }],
    });

    expect(plan.dimensions).toEqual(['cluster.clusterId']);
    expect(plan.filters).toEqual([{ field: 'cluster.clusterId', operator: 'is_not_null' }]);
    expect(plan.orderBy).toEqual([{ field: 'customers', direction: 'desc' }]);
  });

  it('expands compact grouped ranking and scalar aggregate plans', () => {
    const ranking = expand({
      dimensions: ['clusterId'],
      filters: [{ field: 'clusterId', op: 'is_not_null' }],
      metrics: [{ op: 'avg', field: 'averageOrderValue', alias: 'avg_ticket' }],
      orderBy: [{ field: 'avg_ticket', direction: 'desc' }],
      limit: 1,
    });
    const scalar = expand({ metrics: [{ op: 'sum', field: 'totalSpent', alias: 'total_spent' }] });

    expect(ranking.metrics).toEqual([{ aggregation: 'avg', field: 'commercial.averageOrderValueTaxIncl', alias: 'avg_ticket' }]);
    expect(scalar.metrics).toEqual([{ aggregation: 'sum', field: 'commercial.totalSpentTaxIncl', alias: 'total_spent' }]);
  });

  it('maps compact filter and ordering fields to T03 logical fields and aliases', () => {
    const plan = expand({
      select: ['customerId', 'totalSpent'],
      filters: { and: [{ field: 'totalSpent', op: 'gte', value: '100000' }] },
      orderBy: [{ field: 'totalSpent', direction: 'desc' }],
      limit: 20,
    });

    expect(plan.select).toEqual(['customer.customerId', 'commercial.totalSpentTaxIncl']);
    expect(plan.filters).toEqual({ and: [{ field: 'commercial.totalSpentTaxIncl', operator: 'gte', value: '100000' }] });
    expect(plan.orderBy).toEqual([{ field: 'totalSpentTaxIncl', direction: 'desc' }]);
  });

  it('rejects invalid compact fields, aggregations, aliases, and over-limit plans through T03', () => {
    expectRejected({ metrics: [{ op: 'count', alias: 'customers' }], filters: [{ field: 'secretField', op: 'eq', value: 1 }] }, /unknown compact field/);
    expectRejected({ metrics: [{ op: 'median', field: 'totalSpent', alias: 'median_spent' }] }, /unsupported aggregation|expanded T03 plan invalid/);
    expectRejected({ metrics: [{ op: 'count', alias: 'bad-alias' }] }, /alias matching/);
    expectRejected({ metrics: [{ op: 'count', alias: 'customers' }], limit: 1001 }, /limit exceeds max/);
  });

  it('produces the same T03 canonical hash as the equivalent full AnalyticalQueryPlan', () => {
    const compact = expand({
      dimensions: ['clusterId'],
      filters: [{ field: 'clusterId', op: 'is_not_null' }],
      metrics: [{ op: 'avg', field: 'averageOrderValue', alias: 'avg_ticket' }],
      orderBy: [{ field: 'avg_ticket', direction: 'desc' }],
      limit: 1,
    });
    const full = validateAnalyticalQueryPlan({
      planVersion: 'customer-intelligence-query-plan-v1',
      dimensions: ['cluster.clusterId'],
      filters: [{ field: 'cluster.clusterId', operator: 'is_not_null' }],
      metrics: [{ aggregation: 'avg', field: 'commercial.averageOrderValueTaxIncl', alias: 'avg_ticket' }],
      orderBy: [{ field: 'avg_ticket', direction: 'desc' }],
      limit: 1,
    });

    expect(full.ok).toBe(true);
    if (full.ok) {
      const expandedValidation = validateAnalyticalQueryPlan(compact);
      expect(expandedValidation.ok).toBe(true);
      if (!expandedValidation.ok) throw new Error('expanded compact plan failed T03 validation');
      expect(compact).toEqual(full.plan.canonical);
      expect(computeQueryPlanHash(expandedValidation.plan)).toBe(computeQueryPlanHash(full.plan));
    }
  });
});
