import { describe, expect, it } from 'vitest';
import { computeQueryPlanHash } from '../../src/domain/customer-intelligence-query/plan-hash.js';
import { validateAnalyticalQueryPlan } from '../../src/domain/customer-intelligence-query/validator.js';

function normalize(rawPlan: unknown) {
  const result = validateAnalyticalQueryPlan(rawPlan);
  if (!result.ok) throw new Error(`invalid fixture plan: ${result.errors.join('; ')}`);
  return result.plan;
}

describe('computeQueryPlanHash (task Section 69)', () => {
  it('is a 64-character hex SHA-256 digest', () => {
    const hash = computeQueryPlanHash(normalize({ metrics: [{ aggregation: 'count', alias: 'customers' }] }));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('the same plan hashes identically across two independent calls (no execution timestamp)', () => {
    const plan = { dimensions: ['cluster.clusterId'], metrics: [{ aggregation: 'count' as const, alias: 'customers' }] };
    const h1 = computeQueryPlanHash(normalize(plan));
    const h2 = computeQueryPlanHash(normalize(plan));
    expect(h1).toBe(h2);
  });

  it('an omitted limit and an explicit default limit hash identically (defaults are filled before hashing)', () => {
    const withDefault = normalize({ metrics: [{ aggregation: 'count', alias: 'c' }] });
    const explicit = normalize({ metrics: [{ aggregation: 'count', alias: 'c' }], limit: 100 });
    expect(computeQueryPlanHash(withDefault)).toBe(computeQueryPlanHash(explicit));
  });

  it('a different metric alias produces a different hash', () => {
    const a = normalize({ metrics: [{ aggregation: 'count', alias: 'customers' }] });
    const b = normalize({ metrics: [{ aggregation: 'count', alias: 'total' }] });
    expect(computeQueryPlanHash(a)).not.toBe(computeQueryPlanHash(b));
  });

  it('a different filter value produces a different hash', () => {
    const a = normalize({ select: ['customer.customerId'], filters: [{ field: 'commercial.validOrders', operator: 'gte', value: 2 }] });
    const b = normalize({ select: ['customer.customerId'], filters: [{ field: 'commercial.validOrders', operator: 'gte', value: 5 }] });
    expect(computeQueryPlanHash(a)).not.toBe(computeQueryPlanHash(b));
  });

  it('row mode and aggregate mode plans never collide even with overlapping field names', () => {
    const row = normalize({ select: ['commercial.validOrders'] });
    const agg = normalize({ metrics: [{ aggregation: 'count', alias: 'validOrders' }] });
    expect(computeQueryPlanHash(row)).not.toBe(computeQueryPlanHash(agg));
  });
});
