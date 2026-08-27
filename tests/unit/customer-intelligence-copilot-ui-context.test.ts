import { describe, expect, it, vi } from 'vitest';
import { composeStepFiltersWithUiContext, collectFilterFieldNames, resolveCopilotUiContext } from '../../src/application/customer-intelligence-copilot-session/ui-context.js';
import type { CopilotSession } from '../../src/application/customer-intelligence-copilot-session/index.js';
import type { ExecuteIntersection } from '../../src/application/customer-intelligence-intersection/index.js';
import type { CustomerIntelligenceIntersectionResult } from '../../src/domain/customer-intelligence-intersection/index.js';
import type { CUSTOMER_INTELLIGENCE_COPILOT_UI_CONTEXT_VERSION } from '../../src/domain/customer-intelligence-copilot/index.js';

const RESOLVED_CONTEXT = {
  featureSnapshot: { snapshotId: '17', referenceTime: '2026-08-19T00:00:00.000Z', featureVersion: 'customer-analytics-features-v1', populationPolicyVersion: 'customer-analytics-population-b-v1' },
  rfmSnapshot: { snapshotId: '9', referenceTime: '2026-08-18T00:00:00.000Z', calculationVersion: 'rfm-v1' },
  clusterSnapshot: { snapshotId: '5', referenceTime: '2026-08-17T00:00:00.000Z', modelId: '2', modelVersion: 'behavioral-kmeans-k4-v1' },
  population: { featurePopulation: 100, rfmMatched: 40, clusterMatched: 35, bothMatched: 20, neitherMatched: 45, rfmCoveragePct: 40, clusterCoveragePct: 35 },
  contractVersion: 'customer-intelligence-read-model-v1' as const,
};

function baseSession(overrides: Partial<CopilotSession> = {}): CopilotSession {
  return {
    sessionId: '00000000-0000-4000-8000-000000000001',
    sessionVersion: 'customer-intelligence-copilot-session-v1',
    createdAt: '2026-08-20T12:00:00.000Z',
    lastActivityAt: '2026-08-20T12:00:00.000Z',
    expiresAt: '2026-08-20T13:00:00.000Z',
    status: 'active',
    title: null,
    summary: null,
    summaryVersion: null,
    pinnedContext: RESOLVED_CONTEXT,
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
    turns: [],
    analyticalState: { references: [], results: [] },
    uiContext: null,
    ...overrides,
  };
}

function available(hash: string, matchingPopulation = 412): Extract<CustomerIntelligenceIntersectionResult, { status: 'available' }> {
  return {
    status: 'available',
    definition: {
      contractVersion: 'customer-intelligence-intersection-v1',
      filters: { and: [{ field: 'rfm.segmentCode', operator: 'eq', value: 'CHAMPION' }, { field: 'cluster.clusterId', operator: 'eq', value: 3 }] },
      resolvedContext: RESOLVED_CONTEXT,
      queryPlanHash: hash,
    },
    population: {
      matchingPopulation,
      featurePopulation: 100,
      rfmMatchedPopulation: 40,
      clusterMatchedPopulation: 35,
      bothMatchedPopulation: 20,
      rfmCoveragePct: 40,
      clusterCoveragePct: 35,
      requiredDimensions: ['rfm', 'cluster'],
    },
    metrics: {
      totalSpentTaxIncl: '900000.000000',
      averageOrderValueTaxIncl: '10000.000000',
      averageTotalSpentTaxIncl: '30000.000000',
      averageValidOrders: '3.000000',
      averageOrders365d: '1.500000',
      averageDaysSinceLastOrder: '10.000000',
      averagePurchaseFrequencyDays: '45.000000',
      purchaseFrequencyDaysSampleSize: 30,
      averageEffectiveDiversity: '1.800000',
      averageRepeatProductRate: '0.400000',
    },
    execution: { queryCount: 2, filterLeafCount: 2, filterDepth: 1 },
  };
}

describe('resolveCopilotUiContext', () => {
  it('returns absent when no uiContext is supplied', async () => {
    const executeIntersection = vi.fn() as unknown as ExecuteIntersection;
    const result = await resolveCopilotUiContext({ executeIntersection }, { session: baseSession(), turnId: 't1', now: new Date('2026-08-20T12:05:00.000Z'), uiContext: undefined });
    expect(result.status).toBe('absent');
    expect(executeIntersection).not.toHaveBeenCalled();
  });

  it('resolves a valid uiContext into a compact, label-bearing selectedPopulation and marks it changed on first resolve', async () => {
    const executeIntersection = vi.fn(async () => available('a'.repeat(64))) as unknown as ExecuteIntersection;
    const session = baseSession();
    const result = await resolveCopilotUiContext(
      { executeIntersection },
      { session, turnId: 't1', now: new Date('2026-08-20T12:05:00.000Z'), uiContext: { intersection: { filters: { field: 'rfm.segmentCode', operator: 'eq', value: 'CHAMPION' } } } },
    );
    expect(executeIntersection).toHaveBeenCalledWith({ featureSnapshotId: '17', filters: { field: 'rfm.segmentCode', operator: 'eq', value: 'CHAMPION' } });
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.changed).toBe(true);
    expect(result.state.selectedPopulation).toEqual({
      filters: [
        { field: 'rfm.segmentCode', label: 'Segmento RFM', operator: 'eq', value: 'CHAMPION', businessValue: 'Clientes campeones: compra reciente, frecuente y de alto valor' },
        { field: 'cluster.clusterId', label: 'Cluster', operator: 'eq', value: 3, businessValue: 'Cluster 3 - Clientes recurrentes de alto valor y compra diversificada' },
      ],
      matchingPopulation: 412,
      queryPlanHash: 'a'.repeat(64),
      featureSnapshotId: '17',
      rfmSnapshotId: '9',
      clusterSnapshotId: '5',
      requiredDimensions: ['rfm', 'cluster'],
    });
    expect(result.state.resolvedAtTurnId).toBe('t1');
  });

  it('marks changed:false when the resolved queryPlanHash matches the session\'s already-active uiContext (same-context persistence)', async () => {
    const executeIntersection = vi.fn(async () => available('b'.repeat(64))) as unknown as ExecuteIntersection;
    const session = baseSession({
      uiContext: {
        selectedPopulation: { filters: [], matchingPopulation: 1, queryPlanHash: 'b'.repeat(64), featureSnapshotId: '17', rfmSnapshotId: '9', clusterSnapshotId: '5', requiredDimensions: [] },
        rawFilters: null,
        resolvedAtTurnId: 't0',
        resolvedAt: '2026-08-20T12:00:00.000Z',
      },
    });
    const result = await resolveCopilotUiContext({ executeIntersection }, { session, turnId: 't2', now: new Date(), uiContext: { intersection: {} } });
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') expect(result.changed).toBe(false);
  });

  it('marks changed:true when the resolved queryPlanHash differs from the session\'s prior uiContext (dashboard selection changed)', async () => {
    const executeIntersection = vi.fn(async () => available('c'.repeat(64))) as unknown as ExecuteIntersection;
    const session = baseSession({
      uiContext: {
        selectedPopulation: { filters: [], matchingPopulation: 1, queryPlanHash: 'b'.repeat(64), featureSnapshotId: '17', rfmSnapshotId: '9', clusterSnapshotId: '5', requiredDimensions: [] },
        rawFilters: null,
        resolvedAtTurnId: 't0',
        resolvedAt: '2026-08-20T12:00:00.000Z',
      },
    });
    const result = await resolveCopilotUiContext({ executeIntersection }, { session, turnId: 't2', now: new Date(), uiContext: { intersection: {} } });
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') expect(result.changed).toBe(true);
  });

  it('rejects an unknown contractVersion without calling executeIntersection', async () => {
    const executeIntersection = vi.fn() as unknown as ExecuteIntersection;
    const result = await resolveCopilotUiContext(
      { executeIntersection },
      { session: baseSession(), turnId: 't1', now: new Date(), uiContext: { intersection: { contractVersion: 'bogus-v99' as typeof CUSTOMER_INTELLIGENCE_COPILOT_UI_CONTEXT_VERSION } } },
    );
    expect(result.status).toBe('invalid_ui_context');
    expect(executeIntersection).not.toHaveBeenCalled();
  });

  it('rejects a featureSnapshotId that does not match the session pinned snapshot, never silently switching snapshots', async () => {
    const executeIntersection = vi.fn() as unknown as ExecuteIntersection;
    const result = await resolveCopilotUiContext(
      { executeIntersection },
      { session: baseSession(), turnId: 't1', now: new Date(), uiContext: { intersection: { featureSnapshotId: '99' } } },
    );
    expect(result.status).toBe('invalid_ui_context');
    expect(executeIntersection).not.toHaveBeenCalled();
  });

  it('passes through T03 validation errors as invalid_ui_context', async () => {
    const executeIntersection = vi.fn(async () => ({ status: 'invalid_intersection' as const, errors: ['unknown field: bogus.field'] })) as unknown as ExecuteIntersection;
    const result = await resolveCopilotUiContext({ executeIntersection }, { session: baseSession(), turnId: 't1', now: new Date(), uiContext: { intersection: { filters: { field: 'bogus.field', operator: 'eq', value: 1 } } } });
    expect(result.status).toBe('invalid_ui_context');
    if (result.status === 'invalid_ui_context') expect(result.errors).toEqual(['unknown field: bogus.field']);
  });

  it('maps required_rfm_snapshot_unavailable/required_cluster_snapshot_unavailable to invalid_ui_context, never a silent 0-population answer', async () => {
    const rfmUnavailable = vi.fn(async () => ({ status: 'required_rfm_snapshot_unavailable' as const, resolvedContext: RESOLVED_CONTEXT })) as unknown as ExecuteIntersection;
    const rfmResult = await resolveCopilotUiContext({ executeIntersection: rfmUnavailable }, { session: baseSession(), turnId: 't1', now: new Date(), uiContext: { intersection: {} } });
    expect(rfmResult.status).toBe('invalid_ui_context');

    const clusterUnavailable = vi.fn(async () => ({ status: 'required_cluster_snapshot_unavailable' as const, resolvedContext: RESOLVED_CONTEXT })) as unknown as ExecuteIntersection;
    const clusterResult = await resolveCopilotUiContext({ executeIntersection: clusterUnavailable }, { session: baseSession(), turnId: 't1', now: new Date(), uiContext: { intersection: {} } });
    expect(clusterResult.status).toBe('invalid_ui_context');
  });

  it('passes through a degraded analytics status', async () => {
    const executeIntersection = vi.fn(async () => ({ status: 'degraded' as const, reason: 'analytics_unavailable' as const })) as unknown as ExecuteIntersection;
    const result = await resolveCopilotUiContext({ executeIntersection }, { session: baseSession(), turnId: 't1', now: new Date(), uiContext: { intersection: {} } });
    expect(result).toEqual({ status: 'degraded', reason: 'analytics_unavailable' });
  });
});

describe('composeStepFiltersWithUiContext', () => {
  const championScope = { field: 'rfm.segmentCode', operator: 'eq' as const, value: 'CHAMPION' };
  const clusterScope = { field: 'cluster.clusterId', operator: 'eq' as const, value: 3 };
  const scope = { and: [championScope, clusterScope] };

  it('returns stepFilters unchanged when there is no active uiContext scope', () => {
    expect(composeStepFiltersWithUiContext({ field: 'commercial.daysSinceLastOrder', operator: 'gte', value: 180 }, null)).toEqual({ field: 'commercial.daysSinceLastOrder', operator: 'gte', value: 180 });
  });

  it('AND-composes the full scope onto an empty step (inherit_scope)', () => {
    expect(composeStepFiltersWithUiContext(undefined, scope)).toEqual({ and: [championScope, clusterScope] });
  });

  it('AND-composes the scope alongside a non-overlapping model filter (refine_scope)', () => {
    const stepFilters = { field: 'commercial.daysSinceLastOrder', operator: 'gte' as const, value: 180 };
    expect(composeStepFiltersWithUiContext(stepFilters, scope)).toEqual({ and: [stepFilters, championScope, clusterScope] });
  });

  it('drops the overlapping scope leaf when the model already filters that same field, letting the model override/compare on that dimension', () => {
    const stepFilters = { field: 'cluster.clusterId', operator: 'eq' as const, value: 2 };
    expect(composeStepFiltersWithUiContext(stepFilters, scope)).toEqual({ and: [stepFilters, championScope] });
  });

  it('keeps or drops a nested OR group as one indivisible unit, never partially flattening it into an AND', () => {
    const orScope = { or: [{ field: 'cluster.clusterId', operator: 'eq' as const, value: 3 }, { field: 'cluster.clusterId', operator: 'eq' as const, value: 4 }] };
    expect(composeStepFiltersWithUiContext(undefined, orScope)).toEqual({ and: [orScope] });
    const overridingStep = { field: 'cluster.clusterId', operator: 'eq' as const, value: 2 };
    expect(composeStepFiltersWithUiContext(overridingStep, orScope)).toEqual(overridingStep);
  });

  it('returns stepFilters unchanged when every scope node is overridden by the model\'s own filters', () => {
    const stepFilters = { and: [{ field: 'rfm.segmentCode', operator: 'eq' as const, value: 'LOYAL' }, { field: 'cluster.clusterId', operator: 'eq' as const, value: 1 }] };
    expect(composeStepFiltersWithUiContext(stepFilters, scope)).toEqual(stepFilters);
  });
});

describe('collectFilterFieldNames', () => {
  it('collects field names from a nested AND/OR tree', () => {
    const tree = { and: [{ field: 'a.b', operator: 'eq' as const, value: 1 }, { or: [{ field: 'c.d', operator: 'eq' as const, value: 2 }] }] };
    expect([...collectFilterFieldNames(tree)]).toEqual(['a.b', 'c.d']);
  });

  it('returns an empty set for null', () => {
    expect([...collectFilterFieldNames(null)]).toEqual([]);
  });
});
