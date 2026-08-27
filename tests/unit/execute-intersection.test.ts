import { describe, expect, it, vi } from 'vitest';
import { createExecuteIntersection } from '../../src/application/customer-intelligence-intersection/execute-intersection.js';
import type { ResolveCustomerIntelligenceContextResult } from '../../src/application/customer-intelligence/resolve-customer-intelligence-context.js';
import type { ExecuteAnalyticalQueryWithResolvedContext } from '../../src/application/customer-intelligence-query/index.js';
import type { AnalyticalQueryResult, AnalyticalQueryResultRow } from '../../src/domain/customer-intelligence-query/index.js';

const bothSnapshots = {
  status: 'available' as const,
  resolvedIds: {
    featureSnapshotId: '17',
    featureReferenceTime: '2026-08-19T00:00:00.000Z',
    featureVersion: 'customer-analytics-features-v1',
    populationPolicyVersion: 'customer-analytics-population-b-v1',
    rfmSnapshotId: '9',
    rfmReferenceTime: '2026-08-18T00:00:00.000Z',
    calculationVersion: 'rfm-v1',
    clusterSnapshotId: '5',
    clusterReferenceTime: '2026-08-17T00:00:00.000Z',
    clusterModelId: '2',
    clusterModelVersion: 'behavioral-kmeans-k4-v1',
  },
  context: {
    featureSnapshot: {
      snapshotId: '17',
      referenceTime: '2026-08-19T00:00:00.000Z',
      featureVersion: 'customer-analytics-features-v1',
      populationPolicyVersion: 'customer-analytics-population-b-v1',
    },
    rfmSnapshot: { snapshotId: '9', referenceTime: '2026-08-18T00:00:00.000Z', calculationVersion: 'rfm-v1' },
    clusterSnapshot: { snapshotId: '5', referenceTime: '2026-08-17T00:00:00.000Z', modelId: '2', modelVersion: 'behavioral-kmeans-k4-v1' },
    population: { featurePopulation: 100, rfmMatched: 40, clusterMatched: 35, bothMatched: 20, neitherMatched: 45, rfmCoveragePct: 40, clusterCoveragePct: 35 },
    contractVersion: 'customer-intelligence-read-model-v1',
  },
} satisfies ResolveCustomerIntelligenceContextResult;

const noRfmSnapshot = {
  ...bothSnapshots,
  resolvedIds: { ...bothSnapshots.resolvedIds, rfmSnapshotId: null, rfmReferenceTime: null, calculationVersion: null },
  context: { ...bothSnapshots.context, rfmSnapshot: null, population: { ...bothSnapshots.context.population, rfmMatched: 0, rfmCoveragePct: 0 } },
} satisfies ResolveCustomerIntelligenceContextResult;

const noClusterSnapshot = {
  ...bothSnapshots,
  resolvedIds: { ...bothSnapshots.resolvedIds, clusterSnapshotId: null, clusterReferenceTime: null, clusterModelId: null, clusterModelVersion: null },
  context: { ...bothSnapshots.context, clusterSnapshot: null, population: { ...bothSnapshots.context.population, clusterMatched: 0, clusterCoveragePct: 0 } },
} satisfies ResolveCustomerIntelligenceContextResult;

function okResult(row: Record<string, unknown>): Extract<Awaited<ReturnType<ExecuteAnalyticalQueryWithResolvedContext>>, { status: 'ok' }> {
  return {
    status: 'ok',
    result: {
      queryVersion: 'customer-intelligence-query-v1',
      queryPlanHash: 'a'.repeat(64),
      context: bothSnapshots.context,
      columns: [],
      rows: [row as AnalyticalQueryResultRow],
      rowCount: 1,
      execution: { durationMs: 5, truncated: false },
    } as AnalyticalQueryResult,
  };
}

const championsMainRow = {
  matchingPopulation: 30,
  totalSpentTaxIncl: '900000.000000',
  sumValidOrders: '90',
  averageTotalSpentTaxIncl: '30000.000000',
  averageValidOrders: '3.000000',
  averageOrders365d: '1.500000',
  averageDaysSinceLastOrder: '10.000000',
  averagePurchaseFrequencyDays: '45.000000',
  averageEffectiveDiversity: '1.800000',
  averageRepeatProductRate: '0.400000',
};

const zeroMatchRow = {
  matchingPopulation: 0,
  totalSpentTaxIncl: null,
  sumValidOrders: null,
  averageTotalSpentTaxIncl: null,
  averageValidOrders: null,
  averageOrders365d: null,
  averageDaysSinceLastOrder: null,
  averagePurchaseFrequencyDays: null,
  averageEffectiveDiversity: null,
  averageRepeatProductRate: null,
};

function harness(overrides: { resolved?: ResolveCustomerIntelligenceContextResult; executor?: ExecuteAnalyticalQueryWithResolvedContext } = {}) {
  const resolveCurrent = vi.fn(async () => overrides.resolved ?? bothSnapshots);
  const resolveForFeatureSnapshot = vi.fn(async () => overrides.resolved ?? bothSnapshots);
  const executeAnalyticalQueryWithResolvedContext: ExecuteAnalyticalQueryWithResolvedContext =
    overrides.executor ??
    vi.fn(async () => {
      throw new Error('executeAnalyticalQueryWithResolvedContext must not be called');
    });
  const executeIntersection = createExecuteIntersection({ resolveCurrent, resolveForFeatureSnapshot, executeAnalyticalQueryWithResolvedContext });
  return { executeIntersection, resolveCurrent, resolveForFeatureSnapshot, executeAnalyticalQueryWithResolvedContext };
}

describe('createExecuteIntersection - validation (task Section 26)', () => {
  it('rejects an unknown field before any DB execution', async () => {
    const { executeIntersection, resolveCurrent, executeAnalyticalQueryWithResolvedContext } = harness();
    const result = await executeIntersection({ featureSnapshotId: null, filters: { field: 'rfm.doesNotExist', operator: 'eq', value: 'X' } });
    expect(result.status).toBe('invalid_intersection');
    if (result.status !== 'invalid_intersection') return;
    expect(result.errors.some((e) => e.includes('unknown field'))).toBe(true);
    expect(resolveCurrent).not.toHaveBeenCalled();
    expect(executeAnalyticalQueryWithResolvedContext).not.toHaveBeenCalled();
  });

  it('rejects an operator not valid for the field type (gt on a string field)', async () => {
    const { executeIntersection, executeAnalyticalQueryWithResolvedContext } = harness();
    const result = await executeIntersection({ featureSnapshotId: null, filters: { field: 'rfm.segmentCode', operator: 'gt', value: 'X' } });
    expect(result.status).toBe('invalid_intersection');
    expect(executeAnalyticalQueryWithResolvedContext).not.toHaveBeenCalled();
  });

  it('rejects too many filter conditions (max 20)', async () => {
    const { executeIntersection } = harness();
    const filters = Array.from({ length: 21 }, (_, i) => ({ field: 'commercial.validOrders', operator: 'gt' as const, value: i }));
    const result = await executeIntersection({ featureSnapshotId: null, filters });
    expect(result.status).toBe('invalid_intersection');
    if (result.status !== 'invalid_intersection') return;
    expect(result.errors.some((e) => e.includes('too many filter conditions'))).toBe(true);
  });

  it('rejects filter nesting deeper than the max depth (5)', async () => {
    const { executeIntersection } = harness();
    let nested: unknown = { field: 'commercial.validOrders', operator: 'gt', value: 1 };
    for (let i = 0; i < 6; i += 1) nested = { and: [nested] };
    const result = await executeIntersection({ featureSnapshotId: null, filters: nested as never });
    expect(result.status).toBe('invalid_intersection');
    if (result.status !== 'invalid_intersection') return;
    expect(result.errors.some((e) => e.includes('too deep'))).toBe(true);
  });

  it('rejects a malformed IN (empty array)', async () => {
    const { executeIntersection } = harness();
    const result = await executeIntersection({ featureSnapshotId: null, filters: { field: 'rfm.segmentCode', operator: 'in', value: [] } });
    expect(result.status).toBe('invalid_intersection');
  });

  it('rejects a malformed BETWEEN (wrong arity)', async () => {
    const { executeIntersection } = harness();
    const result = await executeIntersection({ featureSnapshotId: null, filters: { field: 'commercial.daysSinceLastOrder', operator: 'between', value: [1] } });
    expect(result.status).toBe('invalid_intersection');
  });

  it('rejects is_null/is_not_null carrying a value', async () => {
    const { executeIntersection } = harness();
    const result = await executeIntersection({
      featureSnapshotId: null,
      filters: { field: 'commercial.purchaseFrequencyDays', operator: 'is_null', value: 'unexpected' },
    });
    expect(result.status).toBe('invalid_intersection');
  });

  it('never touches resolveCurrent or the executor after a validation failure', async () => {
    const { executeIntersection, resolveCurrent, resolveForFeatureSnapshot, executeAnalyticalQueryWithResolvedContext } = harness();
    await executeIntersection({ featureSnapshotId: null, filters: { field: 'not.a.field', operator: 'eq', value: 1 } });
    expect(resolveCurrent).not.toHaveBeenCalled();
    expect(resolveForFeatureSnapshot).not.toHaveBeenCalled();
    expect(executeAnalyticalQueryWithResolvedContext).not.toHaveBeenCalled();
  });
});

describe('createExecuteIntersection - execution (task Section 27)', () => {
  it('returns matching population and common aggregates for a valid RFM filter (example A)', async () => {
    const executor = vi.fn().mockResolvedValueOnce(okResult(championsMainRow)).mockResolvedValueOnce(okResult({ n: 25 }));
    const { executeIntersection } = harness({ executor });
    const result = await executeIntersection({ featureSnapshotId: null, filters: { field: 'rfm.segmentCode', operator: 'eq', value: 'CHAMPION' } });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.population.matchingPopulation).toBe(30);
    expect(result.metrics.totalSpentTaxIncl).toBe('900000.000000');
    expect(result.metrics.purchaseFrequencyDaysSampleSize).toBe(25);
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it('computes the order-weighted AOV (sum(spend)/sum(orders)), not a mean-of-per-customer-AOV (task Section 21)', async () => {
    const executor = vi.fn().mockResolvedValueOnce(okResult(championsMainRow)).mockResolvedValueOnce(okResult({ n: 25 }));
    const { executeIntersection } = harness({ executor });
    const result = await executeIntersection({ featureSnapshotId: null, filters: { field: 'rfm.segmentCode', operator: 'eq', value: 'CHAMPION' } });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    // 900000 / 90 = 10000.000000
    expect(result.metrics.averageOrderValueTaxIncl).toBe('10000.000000');
  });

  it('returns matchingPopulation: 0 with status available (not an error) for a valid filter matching nobody (example H)', async () => {
    const executor = vi.fn().mockResolvedValueOnce(okResult(zeroMatchRow));
    const { executeIntersection } = harness({ executor });
    const result = await executeIntersection({ featureSnapshotId: null, filters: { field: 'commercial.validOrders', operator: 'gt', value: 999999 } });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.population.matchingPopulation).toBe(0);
    expect(result.metrics.totalSpentTaxIncl).toBe('0.000000');
    expect(result.metrics.averageOrderValueTaxIncl).toBeNull();
    expect(result.metrics.averageValidOrders).toBeNull();
    expect(result.metrics.purchaseFrequencyDaysSampleSize).toBe(0);
    // Zero matches -> the sample-size query is skipped entirely (task Section 9/19: 1 query, not 2).
    expect(executor).toHaveBeenCalledTimes(1);
    expect(result.execution.queryCount).toBe(1);
  });

  it('never averages a null purchaseFrequencyDays as zero, and reports the exact non-null sample size (example F)', async () => {
    const row = { ...championsMainRow, matchingPopulation: 12, averagePurchaseFrequencyDays: null };
    const executor = vi.fn().mockResolvedValueOnce(okResult(row)).mockResolvedValueOnce(okResult({ n: 0 }));
    const { executeIntersection } = harness({ executor });
    const result = await executeIntersection({ featureSnapshotId: null, filters: { field: 'commercial.purchaseFrequencyDays', operator: 'is_null' } });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.metrics.averagePurchaseFrequencyDays).toBeNull();
    expect(result.metrics.purchaseFrequencyDaysSampleSize).toBe(0);
  });

  it('carries the resolved snapshot context as provenance on the definition', async () => {
    const executor = vi.fn().mockResolvedValueOnce(okResult(championsMainRow)).mockResolvedValueOnce(okResult({ n: 25 }));
    const { executeIntersection } = harness({ executor });
    const result = await executeIntersection({ featureSnapshotId: null, filters: { field: 'rfm.segmentCode', operator: 'eq', value: 'CHAMPION' } });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.definition.resolvedContext).toEqual(bothSnapshots.context);
    expect(result.definition.contractVersion).toBe('customer-intelligence-intersection-v1');
  });

  it('produces a stable queryPlanHash for the same filters across calls (task Section 10)', async () => {
    const executor = vi.fn(async (request: { readonly plan: unknown }) => {
      const alias = (request.plan as { readonly metrics?: readonly { readonly alias: string }[] }).metrics?.[0]?.alias;
      return alias === 'n' ? okResult({ n: 25 }) : okResult(championsMainRow);
    });
    const { executeIntersection } = harness({ executor });
    const filters = { field: 'rfm.segmentCode', operator: 'eq' as const, value: 'CHAMPION' };
    const first = await executeIntersection({ featureSnapshotId: null, filters });
    const second = await executeIntersection({ featureSnapshotId: null, filters });
    expect(first.status).toBe('available');
    expect(second.status).toBe('available');
    if (first.status !== 'available' || second.status !== 'available') return;
    expect(first.definition.queryPlanHash).toBe(second.definition.queryPlanHash);
    expect(first.definition.queryPlanHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('createExecuteIntersection - dimension-aware coverage (task Section 28)', () => {
  it('a commercial-only filter never requires rfm/cluster and executes even when both are unavailable', async () => {
    const executor = vi.fn().mockResolvedValueOnce(okResult(championsMainRow)).mockResolvedValueOnce(okResult({ n: 25 }));
    const resolved = { ...noRfmSnapshot, context: { ...noRfmSnapshot.context, clusterSnapshot: null }, resolvedIds: { ...noRfmSnapshot.resolvedIds, clusterSnapshotId: null } } satisfies ResolveCustomerIntelligenceContextResult;
    const { executeIntersection } = harness({ resolved, executor });
    const result = await executeIntersection({ featureSnapshotId: null, filters: { field: 'commercial.daysSinceLastOrder', operator: 'gte', value: 120 } });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.population.requiredDimensions).toEqual([]);
  });

  it('an RFM-only filter reports requiredDimensions: ["rfm"]', async () => {
    const executor = vi.fn().mockResolvedValueOnce(okResult(championsMainRow)).mockResolvedValueOnce(okResult({ n: 25 }));
    const { executeIntersection } = harness({ executor });
    const result = await executeIntersection({ featureSnapshotId: null, filters: { field: 'rfm.segmentCode', operator: 'eq', value: 'CHAMPION' } });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.population.requiredDimensions).toEqual(['rfm']);
  });

  it('a cluster-only filter reports requiredDimensions: ["cluster"]', async () => {
    const executor = vi.fn().mockResolvedValueOnce(okResult(championsMainRow)).mockResolvedValueOnce(okResult({ n: 25 }));
    const { executeIntersection } = harness({ executor });
    const result = await executeIntersection({ featureSnapshotId: null, filters: { field: 'cluster.clusterId', operator: 'eq', value: 3 } });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.population.requiredDimensions).toEqual(['cluster']);
  });

  it('an RFM+cluster filter reports both dimensions required and exposes bothMatchedPopulation (example C)', async () => {
    const executor = vi.fn().mockResolvedValueOnce(okResult(championsMainRow)).mockResolvedValueOnce(okResult({ n: 25 }));
    const { executeIntersection } = harness({ executor });
    const result = await executeIntersection({
      featureSnapshotId: null,
      filters: { and: [{ field: 'rfm.segmentCode', operator: 'eq', value: 'CHAMPION' }, { field: 'cluster.clusterId', operator: 'eq', value: 3 }] },
    });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.population.requiredDimensions).toEqual(['rfm', 'cluster']);
    expect(result.population.bothMatchedPopulation).toBe(20);
  });

  it('a cluster+daysSinceLastOrder filter only requires cluster (example D)', async () => {
    const executor = vi.fn().mockResolvedValueOnce(okResult(championsMainRow)).mockResolvedValueOnce(okResult({ n: 25 }));
    const { executeIntersection } = harness({ executor });
    const result = await executeIntersection({
      featureSnapshotId: null,
      filters: { and: [{ field: 'cluster.clusterId', operator: 'eq', value: 3 }, { field: 'commercial.daysSinceLastOrder', operator: 'gte', value: 120 }] },
    });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.population.requiredDimensions).toEqual(['cluster']);
  });

  it('an RFM IN [...] AND totalSpent >= threshold filter executes normally (example E)', async () => {
    const executor = vi.fn().mockResolvedValueOnce(okResult(championsMainRow)).mockResolvedValueOnce(okResult({ n: 25 }));
    const { executeIntersection } = harness({ executor });
    const result = await executeIntersection({
      featureSnapshotId: null,
      filters: {
        and: [
          { field: 'rfm.segmentCode', operator: 'in', value: ['CHAMPION', 'LOYAL'] },
          { field: 'commercial.totalSpentTaxIncl', operator: 'gte', value: 100000 },
        ],
      },
    });
    expect(result.status).toBe('available');
  });

  it('required_rfm_snapshot_unavailable when a filter references rfm.* but no compatible RFM snapshot resolved - cluster availability is irrelevant', async () => {
    const { executeIntersection, executeAnalyticalQueryWithResolvedContext } = harness({ resolved: noRfmSnapshot });
    const result = await executeIntersection({ featureSnapshotId: null, filters: { field: 'rfm.segmentCode', operator: 'eq', value: 'CHAMPION' } });
    expect(result.status).toBe('required_rfm_snapshot_unavailable');
    expect(executeAnalyticalQueryWithResolvedContext).not.toHaveBeenCalled();
  });

  it('required_cluster_snapshot_unavailable when a filter references cluster.* but no compatible cluster snapshot resolved', async () => {
    const { executeIntersection, executeAnalyticalQueryWithResolvedContext } = harness({ resolved: noClusterSnapshot });
    const result = await executeIntersection({ featureSnapshotId: null, filters: { field: 'cluster.clusterId', operator: 'eq', value: 3 } });
    expect(result.status).toBe('required_cluster_snapshot_unavailable');
    expect(executeAnalyticalQueryWithResolvedContext).not.toHaveBeenCalled();
  });

  it('an unused, unavailable dimension never blocks execution - RFM missing does not block a cluster-only filter', async () => {
    const executor = vi.fn().mockResolvedValueOnce(okResult(championsMainRow)).mockResolvedValueOnce(okResult({ n: 25 }));
    const { executeIntersection } = harness({ resolved: noRfmSnapshot, executor });
    const result = await executeIntersection({ featureSnapshotId: null, filters: { field: 'cluster.clusterId', operator: 'eq', value: 3 } });
    expect(result.status).toBe('available');
  });
});
