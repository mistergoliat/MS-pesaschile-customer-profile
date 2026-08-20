import { describe, expect, it } from 'vitest';
import { compileAnalyticalQuery, type AnalyticalQuerySnapshotIds } from '../../src/domain/customer-intelligence-query/compiler.js';
import { validateAnalyticalQueryPlan } from '../../src/domain/customer-intelligence-query/validator.js';

const FULL_IDS: AnalyticalQuerySnapshotIds = {
  featureSnapshotId: '17',
  rfmSnapshotId: '3',
  clusterSnapshotId: '5',
  clusterModelId: '2',
};

function compile(rawPlan: unknown, ids: AnalyticalQuerySnapshotIds = FULL_IDS) {
  const validation = validateAnalyticalQueryPlan(rawPlan);
  if (!validation.ok) throw new Error(`invalid fixture plan: ${validation.errors.join('; ')}`);
  return compileAnalyticalQuery(validation.plan, ids);
}

const FORBIDDEN_SQL_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|CALL|SET|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE)\b/i;

describe('compileAnalyticalQuery — FROM/JOIN topology (task Section 29/32/40)', () => {
  it('always joins feature (base) LEFT JOIN rfm LEFT JOIN cluster LEFT JOIN model LEFT JOIN interpretation, never INNER', () => {
    const { sql } = compile({ metrics: [{ aggregation: 'count', alias: 'c' }] });
    expect(sql).toMatch(/FROM customer_feature_snapshot_row fr/);
    expect(sql).toMatch(/LEFT JOIN customer_rfm_snapshot_row rr/);
    expect(sql).toMatch(/LEFT JOIN customer_cluster_snapshot_row cr/);
    expect(sql).toMatch(/LEFT JOIN customer_cluster_model cm/);
    expect(sql).toMatch(/LEFT JOIN customer_cluster_interpretation ci/);
    expect(sql).not.toMatch(/INNER JOIN/i);
  });

  it('binds rfmSnapshotId/clusterSnapshotId/clusterModelId/featureSnapshotId as the first params, in that order', () => {
    const { params } = compile({ metrics: [{ aggregation: 'count', alias: 'c' }] });
    expect(params.slice(0, 4)).toEqual(['3', '5', '2', '17']);
  });

  it('uses the "0" sentinel when RFM/cluster snapshots are unresolved (never a second SQL shape)', () => {
    const { sql, params } = compile({ metrics: [{ aggregation: 'count', alias: 'c' }] }, { featureSnapshotId: '17', rfmSnapshotId: null, clusterSnapshotId: null, clusterModelId: null });
    expect(params.slice(0, 4)).toEqual(['0', '0', '0', '17']);
    expect(sql).toMatch(/LEFT JOIN customer_rfm_snapshot_row rr/); // same SQL text either way
  });
});

describe('compileAnalyticalQuery — worked examples (task Section 50-52)', () => {
  it('cluster distribution: GROUP BY cluster.clusterId/label, COUNT(*)', () => {
    const { sql } = compile({
      dimensions: ['cluster.clusterId', 'cluster.label'],
      metrics: [{ aggregation: 'count', alias: 'customers' }],
      orderBy: [{ field: 'customers', direction: 'desc' }],
    });
    expect(sql).toMatch(/SELECT cr\.cluster_id AS `clusterId`, ci\.label AS `label`, COUNT\(\*\) AS `customers`/);
    expect(sql).toMatch(/GROUP BY cr\.cluster_id, ci\.label/);
    expect(sql).toMatch(/ORDER BY `customers` DESC/);
  });

  it('rfm distribution: GROUP BY rfm.segmentCode, COUNT(*)', () => {
    const { sql } = compile({ dimensions: ['rfm.segmentCode'], metrics: [{ aggregation: 'count', alias: 'customers' }] });
    expect(sql).toMatch(/SELECT rr\.segment_code AS `segmentCode`, COUNT\(\*\) AS `customers`/);
    expect(sql).toMatch(/GROUP BY rr\.segment_code/);
  });

  it('cross-tab: GROUP BY cluster.clusterId + rfm.segmentCode', () => {
    const { sql } = compile({ dimensions: ['cluster.clusterId', 'rfm.segmentCode'], metrics: [{ aggregation: 'count', alias: 'customers' }] });
    expect(sql).toMatch(/GROUP BY cr\.cluster_id, rr\.segment_code/);
  });

  it('avg AOV by cluster: AVG(commercial.averageOrderValueTaxIncl)', () => {
    const { sql } = compile({
      dimensions: ['cluster.clusterId'],
      metrics: [{ aggregation: 'avg', field: 'commercial.averageOrderValueTaxIncl', alias: 'avgAov' }],
    });
    expect(sql).toMatch(/AVG\(fr\.average_order_value_tax_incl\) AS `avgAov`/);
  });

  it('can select cluster.modelVersion from the registered model join', () => {
    const { sql } = compile({ select: ['customer.customerId', 'cluster.modelVersion'] });
    expect(sql).toMatch(/cm\.model_version AS `modelVersion`/);
  });
});

describe('compileAnalyticalQuery — filters (task Section 53/54)', () => {
  it('numeric AND filter: averageOrderValueTaxIncl > ? AND validOrders >= ?', () => {
    const { sql, params } = compile({
      select: ['customer.customerId'],
      filters: [
        { field: 'commercial.averageOrderValueTaxIncl', operator: 'gt', value: 150000 },
        { field: 'commercial.validOrders', operator: 'gte', value: 2 },
      ],
    });
    expect(sql).toMatch(/WHERE fr\.snapshot_id = \? AND \(fr\.average_order_value_tax_incl > \? AND fr\.valid_orders >= \?\)/);
    expect(params).toContain(150000);
    expect(params).toContain(2);
  });

  it('null filter: cluster.clusterId IS NULL, no bound param for that condition', () => {
    const { sql, params } = compile({ select: ['customer.customerId'], filters: [{ field: 'cluster.clusterId', operator: 'is_null' }] });
    expect(sql).toMatch(/cr\.cluster_id IS NULL/);
    // Only the 4 topology params (rfm/cluster/model/feature snapshot ids) + limit — no extra value bound for IS NULL.
    expect(params).toHaveLength(5);
  });

  it('in/not_in compile to a placeholder list matching the value count', () => {
    const { sql, params } = compile({ select: ['customer.customerId'], filters: [{ field: 'cluster.clusterId', operator: 'in', value: [0, 1, 2] }] });
    expect(sql).toMatch(/cr\.cluster_id IN \(\?, \?, \?\)/);
    expect(params).toEqual(expect.arrayContaining([0, 1, 2]));
  });

  it('between compiles to BETWEEN ? AND ?', () => {
    const { sql, params } = compile({ select: ['customer.customerId'], filters: [{ field: 'commercial.validOrders', operator: 'between', value: [2, 10] }] });
    expect(sql).toMatch(/fr\.valid_orders BETWEEN \? AND \?/);
    expect(params).toEqual(expect.arrayContaining([2, 10]));
  });

  it('nested OR compiles with parens', () => {
    const { sql } = compile({
      select: ['customer.customerId'],
      filters: { and: [{ field: 'commercial.validOrders', operator: 'gte', value: 2 }, { or: [{ field: 'rfm.segmentCode', operator: 'eq', value: 'A' }, { field: 'rfm.segmentCode', operator: 'eq', value: 'B' }] }] },
    });
    expect(sql).toMatch(/\(fr\.valid_orders >= \? AND \(rr\.segment_code = \? OR rr\.segment_code = \?\)\)/);
  });
});

describe('compileAnalyticalQuery — row mode (task Section 39/55)', () => {
  it('top-100-by-spend: bounded raw row query', () => {
    const { sql, params } = compile({
      select: ['customer.customerId', 'commercial.totalSpentTaxIncl'],
      orderBy: [{ field: 'totalSpentTaxIncl', direction: 'desc' }],
      limit: 100,
    });
    expect(sql).toMatch(/SELECT fr\.prestashop_customer_id AS `customerId`, fr\.total_spent_tax_incl AS `totalSpentTaxIncl`/);
    expect(sql).toMatch(/ORDER BY `totalSpentTaxIncl` DESC/);
    // limit+1 fetch trick (task Section 21/43) — never fetches unbounded rows.
    expect(params.at(-1)).toBe(101);
  });
});

describe('compileAnalyticalQuery — read-only by construction (task Section 28)', () => {
  const FIXTURE_PLANS: unknown[] = [
    { metrics: [{ aggregation: 'count', alias: 'c' }] },
    { select: ['customer.customerId'] },
    { dimensions: ['cluster.clusterId', 'rfm.segmentCode'], metrics: [{ aggregation: 'avg', field: 'commercial.totalSpentTaxIncl', alias: 'x' }] },
  ];

  it('every compiled statement starts with SELECT and contains no DML/DDL keyword', () => {
    for (const plan of FIXTURE_PLANS) {
      const { sql } = compile(plan);
      expect(sql.trim().toUpperCase().startsWith('SELECT')).toBe(true);
      expect(sql).not.toMatch(FORBIDDEN_SQL_KEYWORDS);
    }
  });
});

describe('compileAnalyticalQuery — injection stays bound (task Section 23/57)', () => {
  it('a malicious filter value never appears as SQL text, only as a bound parameter', () => {
    const maliciousValue = "' OR 1=1 --";
    const { sql, params } = compile({ select: ['customer.customerId'], filters: [{ field: 'rfm.segmentCode', operator: 'eq', value: maliciousValue }] });
    expect(sql).not.toContain(maliciousValue);
    expect(sql).toMatch(/rr\.segment_code = \?/);
    expect(params).toContain(maliciousValue);
  });
});
