import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMIT,
  MAX_DIMENSIONS,
  MAX_FILTER_LEAVES,
  MAX_IN_VALUES,
  MAX_METRICS,
  MAX_RESULT_ROWS,
  validateAnalyticalQueryPlan,
} from '../../src/domain/customer-intelligence-query/validator.js';

function expectOk(result: ReturnType<typeof validateAnalyticalQueryPlan>) {
  if (!result.ok) throw new Error(`expected ok, got errors: ${result.errors.join('; ')}`);
  return result.plan;
}

function expectRejected(result: ReturnType<typeof validateAnalyticalQueryPlan>, pattern: RegExp) {
  if (result.ok) throw new Error('expected validation to fail, but it succeeded');
  expect(result.errors.join('\n')).toMatch(pattern);
}

describe('validateAnalyticalQueryPlan — mode resolution (task Section 40)', () => {
  it('accepts row mode (select, no metrics)', () => {
    const plan = expectOk(validateAnalyticalQueryPlan({ select: ['customer.customerId', 'commercial.totalSpentTaxIncl'] }));
    expect(plan.mode).toBe('row');
    expect(plan.select.map((s) => s.alias)).toEqual(['customerId', 'totalSpentTaxIncl']);
  });

  it('accepts aggregate mode (metrics, no select)', () => {
    const plan = expectOk(validateAnalyticalQueryPlan({ dimensions: ['cluster.clusterId'], metrics: [{ aggregation: 'count', alias: 'customers' }] }));
    expect(plan.mode).toBe('aggregate');
  });

  it('accepts COUNT ALL with no dimensions (task Section 41)', () => {
    const plan = expectOk(validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'count', alias: 'customers' }] }));
    expect(plan.mode).toBe('aggregate');
    expect(plan.dimensions).toEqual([]);
  });

  it('rejects mixing select with metrics (task Section 40)', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ select: ['customer.customerId'], metrics: [{ aggregation: 'count', alias: 'customers' }] }),
      /cannot mix row-mode "select" with aggregate-mode "metrics"/,
    );
  });

  it('rejects dimensions without any metric', () => {
    expectRejected(validateAnalyticalQueryPlan({ dimensions: ['cluster.clusterId'] }), /"dimensions" requires at least one metric/);
  });

  it('rejects a plan with neither select nor metrics', () => {
    expectRejected(validateAnalyticalQueryPlan({}), /must specify either "select".*or "metrics"/);
  });

  it('rejects a non-object plan', () => {
    expectRejected(validateAnalyticalQueryPlan(null), /must be a JSON object/);
    expectRejected(validateAnalyticalQueryPlan('select *'), /must be a JSON object/);
    expectRejected(validateAnalyticalQueryPlan([1, 2, 3]), /must be a JSON object/);
  });

  it('rejects an unsupported planVersion', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ planVersion: 'v99', select: ['customer.customerId'] }),
      /unsupported planVersion/,
    );
  });
});

describe('validateAnalyticalQueryPlan — unknown/invalid fields (task Section 25/56)', () => {
  it('rejects an unknown field in select', () => {
    expectRejected(validateAnalyticalQueryPlan({ select: ['commercial.secretField'] }), /unknown field: commercial.secretField/);
  });

  it('rejects an unknown field in dimensions', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ dimensions: ['commercial.secretField'], metrics: [{ aggregation: 'count', alias: 'c' }] }),
      /unknown field: commercial.secretField/,
    );
  });

  it('rejects an unknown field in a metric', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'avg', field: 'commercial.secretField', alias: 'x' }] }),
      /unknown field: commercial.secretField/,
    );
  });

  it('rejects an unknown field name attempting SQL injection (task Section 57)', () => {
    expectRejected(
      validateAnalyticalQueryPlan({
        select: ['customer.customerId'],
        filters: [{ field: 'commercial.totalSpentTaxIncl; DROP TABLE customer_feature_snapshot_row;--', operator: 'eq', value: 1 }],
      }),
      /unknown field/,
    );
  });

  it('accepts an injection-shaped filter VALUE as an ordinary bound string (task Section 57)', () => {
    // The value itself is not rejected here — it stays a value, never SQL text. The compiler
    // test suite proves it is bound as a `?` parameter, never concatenated into SQL.
    const plan = expectOk(
      validateAnalyticalQueryPlan({ select: ['customer.customerId'], filters: [{ field: 'rfm.segmentCode', operator: 'eq', value: "' OR 1=1 --" }] }),
    );
    expect(plan.filters).not.toBeNull();
  });
});

describe('validateAnalyticalQueryPlan — operators (task Section 14/25)', () => {
  it('rejects an unsupported operator token', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ select: ['customer.customerId'], filters: [{ field: 'commercial.validOrders', operator: 'regex', value: 'x' }] }),
      /unsupported operator: regex/,
    );
  });

  it('rejects a range operator on a string field (gt on rfm.segmentCode)', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ select: ['customer.customerId'], filters: [{ field: 'rfm.segmentCode', operator: 'gt', value: 'A' }] }),
      /operator "gt" is not supported on field rfm.segmentCode/,
    );
  });

  it('rejects "in" on a datetime field', () => {
    expectRejected(
      validateAnalyticalQueryPlan({
        select: ['customer.customerId'],
        filters: [{ field: 'commercial.firstOrderAt', operator: 'in', value: ['2026-01-01T00:00:00.000Z'] }],
      }),
      /operator "in" is not supported on field commercial.firstOrderAt/,
    );
  });

  it('rejects a null value with eq (task Section 44 "invalid null comparison")', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ select: ['customer.customerId'], filters: [{ field: 'commercial.validOrders', operator: 'eq', value: null }] }),
      /use is_null\/is_not_null for null checks/,
    );
  });

  it('rejects is_null with a value provided', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ select: ['customer.customerId'], filters: [{ field: 'cluster.clusterId', operator: 'is_null', value: 1 }] }),
      /must not include a value/,
    );
  });

  it('accepts is_null/is_not_null with no value on a nullable field (task Section 18/54)', () => {
    const plan = expectOk(
      validateAnalyticalQueryPlan({ select: ['customer.customerId'], filters: { and: [{ field: 'cluster.clusterId', operator: 'is_null' }] } }),
    );
    expect(plan.filters).toEqual({ kind: 'and', children: [{ kind: 'condition', fieldMeta: expect.objectContaining({ logicalName: 'cluster.clusterId' }), operator: 'is_null', value: undefined }] });
  });

  it('rejects "between" with the wrong arity', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ select: ['customer.customerId'], filters: [{ field: 'commercial.validOrders', operator: 'between', value: [1] }] }),
      /requires an array of exactly 2 values/,
    );
    expectRejected(
      validateAnalyticalQueryPlan({ select: ['customer.customerId'], filters: [{ field: 'commercial.validOrders', operator: 'between', value: [1, 2, 3] }] }),
      /requires an array of exactly 2 values/,
    );
  });

  it('rejects "in"/"not_in" with an empty array', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ select: ['customer.customerId'], filters: [{ field: 'cluster.clusterId', operator: 'in', value: [] }] }),
      /requires a non-empty array/,
    );
  });

  it('rejects "in" exceeding MAX_IN_VALUES (task Section 26/63)', () => {
    const values = Array.from({ length: MAX_IN_VALUES + 1 }, (_, i) => i);
    expectRejected(
      validateAnalyticalQueryPlan({ select: ['customer.customerId'], filters: [{ field: 'cluster.clusterId', operator: 'in', value: values }] }),
      new RegExp(`exceeds max of ${MAX_IN_VALUES}`),
    );
  });

  it('rejects a wrong-type scalar value (number where string expected)', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ select: ['customer.customerId'], filters: [{ field: 'rfm.segmentCode', operator: 'eq', value: 5 }] }),
      /must be a valid string/,
    );
  });

  it('rejects a non-ISO datetime value (task Section 71)', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ select: ['customer.customerId'], filters: [{ field: 'commercial.firstOrderAt', operator: 'gt', value: 'last week' }] }),
      /must be a valid datetime/,
    );
  });

  it('accepts a decimal filter value given as an exact numeric string (task Section 70)', () => {
    const plan = expectOk(
      validateAnalyticalQueryPlan({ select: ['customer.customerId'], filters: [{ field: 'commercial.totalSpentTaxIncl', operator: 'gte', value: '150000.000000' }] }),
    );
    expect(plan.filters).not.toBeNull();
  });
});

describe('validateAnalyticalQueryPlan — aggregations (task Section 16/58)', () => {
  it('rejects SUM(cluster.label) (task Section 58)', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'sum', field: 'cluster.label', alias: 'x' }] }),
      /aggregation "sum" is not supported on field cluster.label/,
    );
  });

  it('rejects AVG(rfm.segmentCode) (task Section 58)', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'avg', field: 'rfm.segmentCode', alias: 'x' }] }),
      /aggregation "avg" is not supported on field rfm.segmentCode/,
    );
  });

  it('accepts min/max on a string field (label ordering)', () => {
    const plan = expectOk(validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'max', field: 'cluster.label', alias: 'x' }] }));
    expect(plan.metrics[0]?.resultType).toBe('string');
  });

  it('rejects "count" with a field provided', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'count', field: 'cluster.clusterId', alias: 'x' }] }),
      /"count" does not take a field/,
    );
  });

  it('rejects an unsupported aggregation token', () => {
    expectRejected(validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'median', field: 'commercial.validOrders', alias: 'x' }] }), /unsupported aggregation: median/);
  });

  it('assigns decimal result type to sum/avg over an integer field (task Section 70)', () => {
    const plan = expectOk(validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'avg', field: 'commercial.validOrders', alias: 'x' }] }));
    expect(plan.metrics[0]?.resultType).toBe('decimal');
  });
});

describe('validateAnalyticalQueryPlan — aliases (task Section 25/57)', () => {
  it('rejects duplicate aliases across a dimension and a metric', () => {
    expectRejected(
      validateAnalyticalQueryPlan({
        dimensions: ['cluster.clusterId'],
        metrics: [{ aggregation: 'count', alias: 'clusterId' }],
      }),
      /duplicate alias: clusterId/,
    );
  });

  it('rejects an unsafe metric alias that could break out of a SQL identifier (task Section 23/57)', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'count', alias: 'x` ; DROP TABLE customer_feature_snapshot_row --' }] }),
      /alias matching \^\[A-Za-z_\]\[A-Za-z0-9_\]\*\$/,
    );
  });

  it('rejects an empty-string metric alias', () => {
    expectRejected(validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'count', alias: '' }] }), /alias matching/);
  });
});

describe('validateAnalyticalQueryPlan — orderBy (task Section 25/42)', () => {
  it('accepts orderBy on a metric alias', () => {
    const plan = expectOk(validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'count', alias: 'customers' }], orderBy: [{ field: 'customers', direction: 'desc' }] }));
    expect(plan.orderBy).toEqual([{ alias: 'customers', direction: 'desc' }]);
  });

  it('accepts orderBy on a selected row-mode field', () => {
    const plan = expectOk(
      validateAnalyticalQueryPlan({ select: ['customer.customerId', 'commercial.totalSpentTaxIncl'], orderBy: [{ field: 'totalSpentTaxIncl', direction: 'desc' }] }),
    );
    expect(plan.orderBy).toEqual([{ alias: 'totalSpentTaxIncl', direction: 'desc' }]);
  });

  it('rejects orderBy on a field that was never selected/grouped/aggregated (task Section 42)', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'count', alias: 'customers' }], orderBy: [{ field: 'avgAov', direction: 'desc' }] }),
      /invalid orderBy field: avgAov/,
    );
  });

  it('rejects an invalid orderBy direction', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'count', alias: 'customers' }], orderBy: [{ field: 'customers', direction: 'sideways' }] }),
      /orderBy.direction must be "asc" or "desc"/,
    );
  });
});

describe('validateAnalyticalQueryPlan — limit (task Section 26/43)', () => {
  it('defaults to DEFAULT_LIMIT when omitted', () => {
    const plan = expectOk(validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'count', alias: 'customers' }] }));
    expect(plan.limit).toBe(DEFAULT_LIMIT);
  });

  it('rejects limit=0 and negative limits', () => {
    expectRejected(validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'count', alias: 'c' }], limit: 0 }), /positive integer/);
    expectRejected(validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'count', alias: 'c' }], limit: -5 }), /positive integer/);
  });

  it('rejects a non-integer limit', () => {
    expectRejected(validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'count', alias: 'c' }], limit: 10.5 }), /positive integer/);
  });

  it('rejects a limit above MAX_RESULT_ROWS (never silently clamped)', () => {
    expectRejected(
      validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'count', alias: 'c' }], limit: MAX_RESULT_ROWS + 1 }),
      new RegExp(`limit exceeds max of ${MAX_RESULT_ROWS}`),
    );
  });

  it('accepts a limit exactly at MAX_RESULT_ROWS', () => {
    const plan = expectOk(validateAnalyticalQueryPlan({ metrics: [{ aggregation: 'count', alias: 'c' }], limit: MAX_RESULT_ROWS }));
    expect(plan.limit).toBe(MAX_RESULT_ROWS);
  });
});

describe('validateAnalyticalQueryPlan — boolean logic (task Section 15)', () => {
  it('treats a bare top-level array as an implicit AND', () => {
    const plan = expectOk(
      validateAnalyticalQueryPlan({
        select: ['customer.customerId'],
        filters: [
          { field: 'commercial.averageOrderValueTaxIncl', operator: 'gt', value: 150000 },
          { field: 'commercial.validOrders', operator: 'gte', value: 2 },
        ],
      }),
    );
    expect(plan.filters?.kind).toBe('and');
    expect((plan.filters as { children: readonly unknown[] }).children).toHaveLength(2);
  });

  it('accepts a nested {and:[..., {or:[...]}]} tree (task Section 15)', () => {
    const plan = expectOk(
      validateAnalyticalQueryPlan({
        select: ['customer.customerId'],
        filters: {
          and: [
            { field: 'commercial.validOrders', operator: 'gte', value: 2 },
            { or: [{ field: 'rfm.segmentCode', operator: 'eq', value: 'A' }, { field: 'rfm.segmentCode', operator: 'eq', value: 'B' }] },
          ],
        },
      }),
    );
    expect(plan.filters?.kind).toBe('and');
  });

  it('rejects an empty and/or group', () => {
    expectRejected(validateAnalyticalQueryPlan({ select: ['customer.customerId'], filters: { and: [] } }), /"and" must be a non-empty array/);
  });
});

describe('validateAnalyticalQueryPlan — complexity limits (task Section 26/63)', () => {
  it('rejects more than MAX_DIMENSIONS dimensions', () => {
    const dims = ['commercial.validOrders', 'commercial.orders365d', 'commercial.distinctProducts', 'rfm.rfmCode', 'cluster.clusterId', 'cluster.label'];
    expect(dims.length).toBeGreaterThan(MAX_DIMENSIONS);
    expectRejected(validateAnalyticalQueryPlan({ dimensions: dims, metrics: [{ aggregation: 'count', alias: 'c' }] }), /too many dimensions/);
  });

  it('rejects more than MAX_METRICS metrics', () => {
    const metrics = Array.from({ length: MAX_METRICS + 1 }, (_, i) => ({ aggregation: 'count' as const, alias: `m${i}` }));
    expectRejected(validateAnalyticalQueryPlan({ metrics }), /too many metrics/);
  });

  it('rejects more than MAX_FILTER_LEAVES filter conditions', () => {
    const filters = Array.from({ length: MAX_FILTER_LEAVES + 1 }, () => ({ field: 'commercial.validOrders', operator: 'gte' as const, value: 1 }));
    expectRejected(validateAnalyticalQueryPlan({ select: ['customer.customerId'], filters }), /too many filter conditions/);
  });

  it('rejects filter nesting deeper than MAX_FILTER_DEPTH', () => {
    let node: unknown = { field: 'commercial.validOrders', operator: 'gte', value: 1 };
    for (let i = 0; i < 8; i += 1) node = { and: [node] };
    expectRejected(validateAnalyticalQueryPlan({ select: ['customer.customerId'], filters: node }), /filter nesting too deep/);
  });
});
