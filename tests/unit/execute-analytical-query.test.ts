import { describe, expect, it, vi } from 'vitest';
import { createExecuteAnalyticalQuery } from '../../src/application/customer-intelligence-query/execute-analytical-query.js';
import type { AnalyticalQueryExecutor } from '../../src/application/customer-intelligence-query/ports.js';
import type {
  ResolveCurrentCustomerIntelligenceContext,
  ResolveCustomerIntelligenceContextForFeatureSnapshot,
  ResolveCustomerIntelligenceContextResult,
} from '../../src/application/customer-intelligence/resolve-customer-intelligence-context.js';

const AVAILABLE: Extract<ResolveCustomerIntelligenceContextResult, { status: 'available' }> = {
  status: 'available',
  context: {
    featureSnapshot: { snapshotId: '17', referenceTime: '2026-08-19T00:00:00.000Z', featureVersion: 'customer-analytics-features-v1', populationPolicyVersion: 'customer-analytics-population-b-v1' },
    rfmSnapshot: { snapshotId: '3', referenceTime: '2026-08-18T00:00:00.000Z', calculationVersion: 'rfm-v1' },
    clusterSnapshot: { snapshotId: '5', referenceTime: '2026-08-18T00:00:00.000Z', modelId: '2', modelVersion: 'behavioral-kmeans-k4-v1' },
    population: { featurePopulation: 10, rfmMatched: 7, clusterMatched: 4, bothMatched: 3, neitherMatched: 2, rfmCoveragePct: 70, clusterCoveragePct: 40 },
    contractVersion: 'customer-intelligence-read-model-v1',
  },
  resolvedIds: {
    featureSnapshotId: '17',
    featureReferenceTime: '2026-08-19T00:00:00.000Z',
    featureVersion: 'customer-analytics-features-v1',
    populationPolicyVersion: 'customer-analytics-population-b-v1',
    rfmSnapshotId: '3',
    rfmReferenceTime: '2026-08-18T00:00:00.000Z',
    calculationVersion: 'rfm-v1',
    clusterSnapshotId: '5',
    clusterReferenceTime: '2026-08-18T00:00:00.000Z',
    clusterModelId: '2',
    clusterModelVersion: 'behavioral-kmeans-k4-v1',
  },
};

function harness(opts: { context?: ResolveCustomerIntelligenceContextResult; rows?: readonly Record<string, unknown>[] } = {}) {
  const resolveCurrent: ResolveCurrentCustomerIntelligenceContext = vi.fn(async () => opts.context ?? AVAILABLE);
  const resolveForFeatureSnapshot: ResolveCustomerIntelligenceContextForFeatureSnapshot = vi.fn(async () => opts.context ?? AVAILABLE);
  const execute = vi.fn(async () => opts.rows ?? []);
  const queryExecutor: AnalyticalQueryExecutor = { execute };
  const executeAnalyticalQuery = createExecuteAnalyticalQuery({ resolveCurrent, resolveForFeatureSnapshot, queryExecutor });
  return { executeAnalyticalQuery, resolveCurrent, resolveForFeatureSnapshot, execute };
}

describe('executeAnalyticalQuery — validation gate (task Section 25)', () => {
  it('rejects an invalid plan before ever calling the DB', async () => {
    const { executeAnalyticalQuery, execute, resolveCurrent } = harness();
    const result = await executeAnalyticalQuery({ plan: { select: ['commercial.secretField'] } });
    expect(result.status).toBe('invalid_plan');
    if (result.status === 'invalid_plan') expect(result.errors.join()).toMatch(/unknown field/);
    expect(execute).not.toHaveBeenCalled();
    expect(resolveCurrent).not.toHaveBeenCalled();
  });
});

describe('executeAnalyticalQuery — snapshot context passthrough (task Section 19/31/59)', () => {
  it('passes through no_published_feature_snapshot verbatim, never touching the DB executor', async () => {
    const { executeAnalyticalQuery, execute } = harness({ context: { status: 'no_published_feature_snapshot', contractVersion: 'customer-intelligence-read-model-v1' } });
    const result = await executeAnalyticalQuery({ plan: { metrics: [{ aggregation: 'count', alias: 'c' }] } });
    expect(result.status).toBe('no_published_feature_snapshot');
    expect(execute).not.toHaveBeenCalled();
  });

  it('passes through feature_snapshot_not_found and calls resolveForFeatureSnapshot with the requested id', async () => {
    const { executeAnalyticalQuery, resolveForFeatureSnapshot, resolveCurrent } = harness({
      context: { status: 'feature_snapshot_not_found', featureSnapshotId: '999', contractVersion: 'customer-intelligence-read-model-v1' },
    });
    const result = await executeAnalyticalQuery({ plan: { metrics: [{ aggregation: 'count', alias: 'c' }] }, featureSnapshotId: '999' });
    expect(result.status).toBe('feature_snapshot_not_found');
    expect(resolveForFeatureSnapshot).toHaveBeenCalledWith('999');
    expect(resolveCurrent).not.toHaveBeenCalled();
  });

  it('passes through a degraded context (analytics_not_configured / analytics_unavailable)', async () => {
    const { executeAnalyticalQuery } = harness({ context: { status: 'degraded', reason: 'analytics_not_configured', contractVersion: 'customer-intelligence-read-model-v1' } });
    const result = await executeAnalyticalQuery({ plan: { metrics: [{ aggregation: 'count', alias: 'c' }] } });
    expect(result).toEqual({ status: 'degraded', reason: 'analytics_not_configured', contractVersion: 'customer-intelligence-read-model-v1' });
  });

  it('never re-derives snapshot ids — the exact resolvedIds from T02 are what the compiled SQL is parameterized with (task Section 59)', async () => {
    const { executeAnalyticalQuery, execute } = harness({ rows: [] });
    await executeAnalyticalQuery({ plan: { metrics: [{ aggregation: 'count', alias: 'c' }] } });
    const [{ params }] = execute.mock.calls[0] as unknown as [{ sql: string; params: readonly unknown[] }];
    expect(params.slice(0, 4)).toEqual(['3', '5', '2', '17']);
  });
});

describe('executeAnalyticalQuery — provenance (task Section 20/60)', () => {
  it('every successful result carries the exact resolved context', async () => {
    const { executeAnalyticalQuery } = harness({ rows: [] });
    const result = await executeAnalyticalQuery({ plan: { metrics: [{ aggregation: 'count', alias: 'c' }] } });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.result.context).toEqual(AVAILABLE.context);
  });

  it('includes a queryPlanHash, deterministic across two calls with an identical plan', async () => {
    const plan = { metrics: [{ aggregation: 'count' as const, alias: 'c' }] };
    const { executeAnalyticalQuery: run1 } = harness({ rows: [] });
    const { executeAnalyticalQuery: run2 } = harness({ rows: [] });
    const r1 = await run1({ plan });
    const r2 = await run2({ plan });
    expect(r1.status).toBe('ok');
    expect(r2.status).toBe('ok');
    if (r1.status === 'ok' && r2.status === 'ok') {
      expect(r1.result.queryPlanHash).toMatch(/^[a-f0-9]{64}$/);
      expect(r1.result.queryPlanHash).toBe(r2.result.queryPlanHash);
    }
  });

  it('reports a non-negative durationMs', async () => {
    const { executeAnalyticalQuery } = harness({ rows: [] });
    const result = await executeAnalyticalQuery({ plan: { metrics: [{ aggregation: 'count', alias: 'c' }] } });
    if (result.status === 'ok') expect(result.result.execution.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('executeAnalyticalQuery — aggregate mode worked fixtures (task Section 50-52)', () => {
  it('cluster distribution: COUNT() rows normalize from BIGINT-string to a JS number', async () => {
    const { executeAnalyticalQuery } = harness({
      rows: [
        { clusterId: 0, label: 'HIGH_VALUE', customers: '2566' },
        { clusterId: 1, label: 'NEW', customers: '1525' },
      ],
    });
    const result = await executeAnalyticalQuery({ plan: { dimensions: ['cluster.clusterId', 'cluster.label'], metrics: [{ aggregation: 'count', alias: 'customers' }] } });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.result.rows).toEqual([
        { clusterId: 0, label: 'HIGH_VALUE', customers: 2566 },
        { clusterId: 1, label: 'NEW', customers: 1525 },
      ]);
      expect(result.result.columns).toEqual([
        { name: 'clusterId', type: 'integer' },
        { name: 'label', type: 'string' },
        { name: 'customers', type: 'integer' },
      ]);
    }
  });

  it('RFM x cluster cross-tab against a hand-computed fixture (task Section 52 — parity, not identical API shape)', async () => {
    // Hand-computed: 3 customers in cluster 0/segment AT_RISK, 1 in cluster 0/segment LOYAL,
    // 2 in cluster 1/segment AT_RISK — matches what a manual GROUP BY of the same raw
    // population would produce.
    const { executeAnalyticalQuery } = harness({
      rows: [
        { clusterId: 0, segmentCode: 'AT_RISK_HIGH_VALUE', customers: '3' },
        { clusterId: 0, segmentCode: 'LOYAL', customers: '1' },
        { clusterId: 1, segmentCode: 'AT_RISK_HIGH_VALUE', customers: '2' },
      ],
    });
    const result = await executeAnalyticalQuery({ plan: { dimensions: ['cluster.clusterId', 'rfm.segmentCode'], metrics: [{ aggregation: 'count', alias: 'customers' }] } });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      const total = result.result.rows.reduce((sum, r) => sum + (r.customers as number), 0);
      expect(total).toBe(6);
      expect(result.result.rows).toEqual([
        { clusterId: 0, segmentCode: 'AT_RISK_HIGH_VALUE', customers: 3 },
        { clusterId: 0, segmentCode: 'LOYAL', customers: 1 },
        { clusterId: 1, segmentCode: 'AT_RISK_HIGH_VALUE', customers: 2 },
      ]);
    }
  });
});

describe('executeAnalyticalQuery — filters reach the compiled SQL (task Section 53/54)', () => {
  it('a numeric AND filter is compiled into the SQL passed to the executor', async () => {
    const { executeAnalyticalQuery, execute } = harness({ rows: [] });
    await executeAnalyticalQuery({
      plan: {
        select: ['customer.customerId'],
        filters: [
          { field: 'commercial.averageOrderValueTaxIncl', operator: 'gt', value: 150000 },
          { field: 'commercial.validOrders', operator: 'gte', value: 2 },
        ],
      },
    });
    const [{ sql, params }] = execute.mock.calls[0] as unknown as [{ sql: string; params: readonly unknown[] }];
    expect(sql).toMatch(/fr\.average_order_value_tax_incl > \? AND fr\.valid_orders >= \?/);
    expect(params).toEqual(expect.arrayContaining([150000, 2]));
  });

  it('a null filter (cluster.clusterId IS NULL) round-trips a null cell (task Section 18/54)', async () => {
    const { executeAnalyticalQuery } = harness({ rows: [{ customerId: 22092, clusterId: null }] });
    const result = await executeAnalyticalQuery({
      plan: { select: ['customer.customerId', 'cluster.clusterId'], filters: [{ field: 'cluster.clusterId', operator: 'is_null' }] },
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.result.rows).toEqual([{ customerId: 22092, clusterId: null }]);
  });
});

describe('executeAnalyticalQuery — row mode + truncation (task Section 39/55)', () => {
  it('top-N by spend: truncated=true when more rows than limit come back', async () => {
    const { executeAnalyticalQuery } = harness({
      rows: [
        { customerId: 1, totalSpentTaxIncl: '900.000000' },
        { customerId: 2, totalSpentTaxIncl: '800.000000' },
        { customerId: 3, totalSpentTaxIncl: '700.000000' }, // the "limit+1" extra row
      ],
    });
    const result = await executeAnalyticalQuery({
      plan: { select: ['customer.customerId', 'commercial.totalSpentTaxIncl'], orderBy: [{ field: 'totalSpentTaxIncl', direction: 'desc' }], limit: 2 },
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.result.rows).toHaveLength(2);
      expect(result.result.execution.truncated).toBe(true);
      expect(result.result.rowCount).toBe(2);
    }
  });

  it('truncated=false when exactly the limit (or fewer) rows come back', async () => {
    const { executeAnalyticalQuery } = harness({ rows: [{ customerId: 1, totalSpentTaxIncl: '900.000000' }] });
    const result = await executeAnalyticalQuery({ plan: { select: ['customer.customerId', 'commercial.totalSpentTaxIncl'], limit: 2 } });
    if (result.status === 'ok') expect(result.result.execution.truncated).toBe(false);
  });
});

describe('executeAnalyticalQuery — decimal/datetime type conversion policy (task Section 70/71)', () => {
  it('decimal cells (raw select and AVG aggregates) stay exact strings, never a lossy float', async () => {
    const { executeAnalyticalQuery } = harness({ rows: [{ clusterId: 0, avgAov: '56433.503300' }] });
    const result = await executeAnalyticalQuery({
      plan: { dimensions: ['cluster.clusterId'], metrics: [{ aggregation: 'avg', field: 'commercial.averageOrderValueTaxIncl', alias: 'avgAov' }] },
    });
    if (result.status === 'ok') {
      expect(result.result.rows[0]?.avgAov).toBe('56433.503300');
      expect(typeof result.result.rows[0]?.avgAov).toBe('string');
    }
  });

  it('datetime cells (a raw Date from the driver) normalize to an ISO string', async () => {
    const { executeAnalyticalQuery } = harness({ rows: [{ customerId: 1, firstOrderAt: new Date('2026-01-01T00:00:00.000Z') }] });
    const result = await executeAnalyticalQuery({ plan: { select: ['customer.customerId', 'commercial.firstOrderAt'] } });
    if (result.status === 'ok') expect(result.result.rows[0]?.firstOrderAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
