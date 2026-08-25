import { describe, expect, it, vi } from 'vitest';
import {
  createCustomerIntelligenceCopilotSessionService,
  createInMemoryCopilotSessionStore,
  type CopilotSessionLimits,
} from '../../src/application/customer-intelligence-copilot-session/index.js';
import type { CustomerIntelligenceCopilotModel, GenerateAnswerInput, GenerateConversationDecisionInput } from '../../src/application/customer-intelligence-copilot/index.js';
import type { ExecuteAnalyticalQueryForExport, ExecuteAnalyticalQueryWithResolvedContext } from '../../src/application/customer-intelligence-query/index.js';
import type { ResolveCustomerIntelligenceContextResult } from '../../src/application/customer-intelligence/resolve-customer-intelligence-context.js';
import type { Clock } from '../../src/application/customer-profile/ports.js';
import type { AnalyticalQueryResult, AnalyticalSchema } from '../../src/domain/customer-intelligence-query/index.js';
import {
  CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
} from '../../src/domain/customer-intelligence-copilot/index.js';

const SCHEMA: AnalyticalSchema = {
  schemaVersion: 'customer-intelligence-query-schema-v1',
  readModelVersion: 'customer-intelligence-read-model-v1',
  fields: [
    { logicalName: 'customer.customerId', type: 'integer', nullable: false, source: 'customer', allowedOperators: ['eq', 'in'], allowedAggregations: ['count', 'count_distinct'], description: 'Customer id.' },
    { logicalName: 'commercial.validOrders', type: 'integer', nullable: false, source: 'commercial', allowedOperators: ['eq', 'gt', 'gte'], allowedAggregations: ['sum', 'avg', 'min', 'max'], description: 'Valid order count.' },
    { logicalName: 'commercial.averageOrderValueTaxIncl', type: 'decimal', nullable: false, source: 'commercial', allowedOperators: ['gt', 'gte', 'lt', 'lte'], allowedAggregations: ['avg', 'min', 'max'], description: 'Average order value.' },
    { logicalName: 'commercial.totalSpentTaxIncl', type: 'decimal', nullable: false, source: 'commercial', allowedOperators: ['gt', 'gte', 'lt', 'lte'], allowedAggregations: ['sum', 'avg', 'min', 'max'], description: 'Total spent.' },
    { logicalName: 'commercial.daysSinceLastOrder', type: 'integer', nullable: false, source: 'commercial', allowedOperators: ['gt', 'gte', 'lt', 'lte'], allowedAggregations: ['avg', 'min', 'max'], description: 'Recency.' },
    { logicalName: 'commercial.orders365d', type: 'integer', nullable: false, source: 'commercial', allowedOperators: ['eq', 'gt', 'gte'], allowedAggregations: ['sum', 'avg', 'min', 'max'], description: 'Recent orders.' },
    { logicalName: 'commercial.effectiveDiversity', type: 'decimal', nullable: false, source: 'commercial', allowedOperators: ['gt', 'gte', 'lt', 'lte'], allowedAggregations: ['avg', 'min', 'max'], description: 'Product diversity.' },
    { logicalName: 'commercial.repeatProductRate', type: 'decimal', nullable: false, source: 'commercial', allowedOperators: ['gt', 'gte', 'lt', 'lte'], allowedAggregations: ['avg', 'min', 'max'], description: 'Repeat product rate.' },
    { logicalName: 'rfm.segmentCode', type: 'string', nullable: true, source: 'rfm', allowedOperators: ['eq', 'in', 'is_null', 'is_not_null'], allowedAggregations: ['count', 'count_distinct'], description: 'RFM segment.' },
    { logicalName: 'cluster.clusterId', type: 'integer', nullable: true, source: 'cluster', allowedOperators: ['eq', 'in', 'is_null', 'is_not_null'], allowedAggregations: ['count', 'count_distinct'], description: 'Cluster id.' },
    { logicalName: 'cluster.label', type: 'string', nullable: true, source: 'cluster', allowedOperators: ['eq', 'is_null'], allowedAggregations: ['count'], description: 'Cluster label.' },
  ],
};

const CONTEXT: Extract<ResolveCustomerIntelligenceContextResult, { status: 'available' }> = {
  status: 'available',
  context: {
    featureSnapshot: { snapshotId: '17', referenceTime: '2026-08-19T00:00:00.000Z', featureVersion: 'customer-analytics-features-v1', populationPolicyVersion: 'customer-analytics-population-b-v1' },
    rfmSnapshot: { snapshotId: '3', referenceTime: '2026-08-18T00:00:00.000Z', calculationVersion: 'rfm-v1' },
    clusterSnapshot: { snapshotId: '5', referenceTime: '2026-08-18T00:00:00.000Z', modelId: '2', modelVersion: 'behavioral-kmeans-k4-v1' },
    population: { featurePopulation: 100, rfmMatched: 80, clusterMatched: 70, bothMatched: 60, neitherMatched: 10, rfmCoveragePct: 80, clusterCoveragePct: 70 },
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

const LIMITS: CopilotSessionLimits = {
  ttlMinutes: 60,
  maxActiveSessions: 10,
  maxTurns: 12,
  contextRecentTurns: 8,
  maxStoredResults: 8,
  maxResultRowsRetained: 10,
  maxQuestionChars: 4000,
  maxAnswerChars: 8000,
  exportMaxRows: 50000,
  exportBatchSize: 1000,
  summaryAfterTurns: 12,
};

class FakeClock implements Clock {
  private current = new Date('2026-08-20T12:00:00.000Z');
  now(): Date {
    return new Date(this.current);
  }
}

function decision(action: 'run_analytics' | 'clarification_required' | 'respond_directly' | 'answer_from_context' | 'unsupported', payload: Record<string, unknown>) {
  return { decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION, action, ...payload };
}

function plan(queries: readonly { id: string; plan: unknown }[]) {
  return { planVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION, status: 'query_plan', queries };
}

function terminalPlan(status: 'unsupported_data' | 'unsupported_operation' | 'clarification_required', message: string) {
  return { planVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION, status, message };
}

function countByCluster(alias = 'customer_count') {
  return {
    dimensions: ['cluster.clusterId'],
    filters: [{ field: 'cluster.clusterId', operator: 'is_not_null' }],
    metrics: [{ aggregation: 'count', alias }],
    orderBy: [{ field: alias, direction: 'desc' }],
  };
}

function totalSpentByAssignedCluster() {
  return {
    dimensions: ['cluster.clusterId'],
    filters: [{ field: 'cluster.clusterId', operator: 'is_not_null' }],
    metrics: [{ aggregation: 'sum', field: 'commercial.totalSpentTaxIncl', alias: 'total_spent' }],
    orderBy: [{ field: 'total_spent', direction: 'desc' }],
    limit: 1,
  };
}

function avgTicketByCluster() {
  return {
    dimensions: ['cluster.clusterId'],
    filters: [{ field: 'cluster.clusterId', operator: 'is_not_null' }],
    metrics: [{ aggregation: 'avg', field: 'commercial.averageOrderValueTaxIncl', alias: 'avg_ticket' }],
    orderBy: [{ field: 'avg_ticket', direction: 'desc' }],
  };
}

function result(rows: readonly Record<string, unknown>[], hash = 'a'.repeat(64), columns = Object.keys(rows[0] ?? { customer_count: 1 })): AnalyticalQueryResult {
  return {
    queryVersion: 'customer-intelligence-query-v1',
    queryPlanHash: hash,
    context: CONTEXT.context,
    columns: columns.map((name) => ({ name, type: name === 'clusterId' || name.endsWith('count') ? 'integer' : 'decimal' })),
    rows: rows as AnalyticalQueryResult['rows'],
    rowCount: rows.length,
    execution: { durationMs: 5, truncated: false },
  };
}

function harness(opts: {
  decisions: unknown[];
  plans?: unknown[];
  executionResults?: AnalyticalQueryResult[];
  answer?: string;
}) {
  const decisions = [...opts.decisions];
  const plans = [...(opts.plans ?? [plan([{ id: 'q1', plan: countByCluster() }])])];
  const executionResults = [...(opts.executionResults ?? [result([{ clusterId: 3, customer_count: 10 }])])];
  const clock = new FakeClock();
  const generateConversationDecision = vi.fn(async () => ({ decision: decisions.shift() ?? decision('run_analytics', { analyticalQuestion: 'Analyze customers.' }), metadata: { provider: 'fake', model: 'orchestrator' } }));
  const repairConversationDecision = vi.fn(async () => ({ decision: decision('run_analytics', { analyticalQuestion: 'Analyze customers.' }), metadata: { provider: 'fake', model: 'orchestrator' } }));
  const generateAnalysisPlan = vi.fn(async () => ({ plan: plans.shift() ?? plan([{ id: 'q1', plan: countByCluster() }]), metadata: { provider: 'fake', model: 'planner' } }));
  const repairAnalysisPlan = vi.fn(async () => ({ plan: plan([{ id: 'q1', plan: countByCluster() }]), metadata: { provider: 'fake', model: 'planner' } }));
  let lastAnswerInput: GenerateAnswerInput | null = null;
  const generateAnswer = vi.fn(async (input: GenerateAnswerInput) => {
    lastAnswerInput = input;
    return { answer: opts.answer ?? 'Respuesta con hechos, interpretacion e hipotesis cuidadosa.', metadata: { provider: 'fake', model: 'answerer' } };
  });
  const executeAnalyticalQuery = vi.fn(async () => ({ status: 'ok', result: executionResults.shift() ?? result([{ clusterId: 3, customer_count: 10 }]) })) as unknown as ExecuteAnalyticalQueryWithResolvedContext;
  const executeAnalyticalQueryForExport = vi.fn(async () => ({ status: 'ok', result: result([{ clusterId: 3, customer_count: 10 }]) })) as unknown as ExecuteAnalyticalQueryForExport;
  const service = createCustomerIntelligenceCopilotSessionService({
    getAnalyticalSchema: () => SCHEMA,
    resolveCurrent: vi.fn(async () => CONTEXT),
    resolveForFeatureSnapshot: vi.fn(async () => CONTEXT),
    executeAnalyticalQuery,
    executeAnalyticalQueryForExport,
    model: { generateConversationDecision, repairConversationDecision, generateAnalysisPlan, repairAnalysisPlan, generateAnswer } satisfies CustomerIntelligenceCopilotModel,
    store: createInMemoryCopilotSessionStore(LIMITS),
    clock,
    limits: LIMITS,
  });
  return { service, generateConversationDecision, generateAnalysisPlan, executeAnalyticalQuery, generateAnswer, getLastAnswerInput: () => lastAnswerInput };
}

async function createSession(h: ReturnType<typeof harness>) {
  const created = await h.service.createSession();
  if (created.status !== 'created') throw new Error('session not created');
  return created.session.sessionId;
}

describe('Customer Intelligence Copilot semantic benchmark', () => {
  it('routes simple customer count to analytics', async () => {
    const h = harness({
      decisions: [decision('run_analytics', { analyticalQuestion: 'How many customers are in the current Customer Intelligence population?' })],
      plans: [plan([{ id: 'customer_count', plan: { metrics: [{ aggregation: 'count', alias: 'customer_count' }] } }])],
    });
    const sessionId = await createSession(h);
    const response = await h.service.processSessionTurn({ sessionId, question: 'Cuantos clientes tenemos?' });
    expect(response.status).toBe('ok');
    if (response.status === 'ok') expect(response.response.status).toBe('answered');
  });

  it('plans assigned-cluster grouping for cluster counts', async () => {
    const h = harness({
      decisions: [decision('run_analytics', { analyticalQuestion: 'How many customers are in each assigned cluster? Exclude unclustered customers.' })],
      plans: [plan([{ id: 'clusters_by_count', plan: countByCluster() }])],
    });
    const sessionId = await createSession(h);
    await h.service.processSessionTurn({ sessionId, question: 'Cuantos hay en cada cluster?' });
    expect(h.executeAnalyticalQuery).toHaveBeenCalledWith(expect.objectContaining({
      plan: expect.objectContaining({ filters: [{ field: 'cluster.clusterId', operator: 'is_not_null' }] }),
    }));
  });

  it('resolves why follow-up from Cluster 3 focus and runs explanatory multi-query analytics', async () => {
    const h = harness({
      decisions: [
        decision('run_analytics', { analyticalQuestion: 'Which assigned cluster has the highest average ticket?' }),
        decision('run_analytics', { analyticalQuestion: 'Compare Cluster 3 against the other assigned clusters using available behavioral and commercial features. Do not infer causality.' }),
      ],
      plans: [
        plan([{ id: 'avg_ticket_by_cluster', plan: avgTicketByCluster() }]),
        plan([
          { id: 'ticket_units_by_cluster', plan: { dimensions: ['cluster.clusterId'], filters: [{ field: 'cluster.clusterId', operator: 'is_not_null' }], metrics: [{ aggregation: 'avg', field: 'commercial.averageOrderValueTaxIncl', alias: 'avg_ticket' }, { aggregation: 'avg', field: 'commercial.validOrders', alias: 'avg_orders' }] } },
          { id: 'diversity_by_cluster', plan: { dimensions: ['cluster.clusterId'], filters: [{ field: 'cluster.clusterId', operator: 'is_not_null' }], metrics: [{ aggregation: 'avg', field: 'commercial.effectiveDiversity', alias: 'avg_diversity' }, { aggregation: 'avg', field: 'commercial.repeatProductRate', alias: 'avg_repeat_rate' }] } },
        ]),
      ],
      executionResults: [
        result([{ clusterId: 3, avg_ticket: '150000.000000' }, { clusterId: 1, avg_ticket: '90000.000000' }], 'b'.repeat(64), ['clusterId', 'avg_ticket']),
        result([{ clusterId: 3, avg_ticket: '150000.000000', avg_orders: '2.5' }], 'c'.repeat(64), ['clusterId', 'avg_ticket', 'avg_orders']),
        result([{ clusterId: 3, avg_diversity: '4.2', avg_repeat_rate: '0.3' }], 'd'.repeat(64), ['clusterId', 'avg_diversity', 'avg_repeat_rate']),
      ],
    });
    const sessionId = await createSession(h);
    await h.service.processSessionTurn({ sessionId, question: 'Cual tiene mayor ticket promedio?' });
    const second = await h.service.processSessionTurn({ sessionId, question: 'Por que?' });
    expect(second.status).toBe('ok');
    if (second.status === 'ok') expect(second.response.status).toBe('answered');
    expect(h.generateAnalysisPlan).toHaveBeenLastCalledWith(expect.objectContaining({
      question: expect.stringContaining('Cluster 3'),
    }));
    expect(h.generateAnalysisPlan).toHaveBeenCalledTimes(2);
    expect(h.executeAnalyticalQuery).toHaveBeenCalledTimes(3);
  });

  it('resolves "Y el 1?" against the active cluster comparison', async () => {
    const h = harness({
      decisions: [
        decision('run_analytics', { analyticalQuestion: 'Which assigned cluster has the highest average ticket?' }),
        decision('run_analytics', { analyticalQuestion: 'Compare Cluster 1 average ticket against the active cluster ranking context.' }),
      ],
      plans: [plan([{ id: 'avg_ticket_by_cluster', plan: avgTicketByCluster() }]), plan([{ id: 'cluster_1_ticket', plan: { metrics: [{ aggregation: 'avg', field: 'commercial.averageOrderValueTaxIncl', alias: 'avg_ticket' }], filters: [{ field: 'cluster.clusterId', operator: 'eq', value: 1 }] } }])],
      executionResults: [result([{ clusterId: 3, avg_ticket: '150000.000000' }, { clusterId: 1, avg_ticket: '90000.000000' }], 'e'.repeat(64), ['clusterId', 'avg_ticket']), result([{ avg_ticket: '90000.000000' }], 'f'.repeat(64), ['avg_ticket'])],
    });
    const sessionId = await createSession(h);
    await h.service.processSessionTurn({ sessionId, question: 'Cual tiene mayor ticket promedio?' });
    await h.service.processSessionTurn({ sessionId, question: 'Y el 1?' });
    const decisionCalls = h.generateConversationDecision.mock.calls as unknown as [GenerateConversationDecisionInput][];
    expect(decisionCalls[1]?.[0].sessionContext.semanticFocus.activeEntity).toMatchObject({ id: 3 });
  });

  it('answers "Eso es mucho?" from context when retained ranking evidence is enough', async () => {
    const h = harness({
      decisions: [
        decision('run_analytics', { analyticalQuestion: 'Which assigned cluster has the highest average ticket?' }),
        decision('answer_from_context', { sourceQueryIds: ['avg_ticket_by_cluster'], instruction: 'Compare the top cluster average ticket against the retained ranking values.' }),
      ],
      plans: [plan([{ id: 'avg_ticket_by_cluster', plan: avgTicketByCluster() }])],
      executionResults: [result([{ clusterId: 3, avg_ticket: '150000.000000' }, { clusterId: 1, avg_ticket: '90000.000000' }], '1'.repeat(64), ['clusterId', 'avg_ticket'])],
    });
    const sessionId = await createSession(h);
    await h.service.processSessionTurn({ sessionId, question: 'Cual tiene mayor ticket promedio?' });
    const second = await h.service.processSessionTurn({ sessionId, question: 'Eso es mucho?' });
    expect(second.status).toBe('ok');
    if (second.status === 'ok') expect(second.response.status).toBe('answered_from_context');
  });

  it('clarifies ambiguous best group, then resolves total-spend criterion over assigned clusters', async () => {
    const h = harness({
      decisions: [
        decision('clarification_required', { message: 'Necesito un criterio: gasto total, ticket promedio, frecuencia o recencia?' }),
        decision('run_analytics', { analyticalQuestion: 'Which assigned cluster has the highest totalSpentTaxIncl? Exclude customers with no cluster assignment.' }),
      ],
      plans: [plan([{ id: 'cluster_total_spend', plan: totalSpentByAssignedCluster() }])],
      executionResults: [result([{ clusterId: 2, total_spent: '900000.000000' }], '2'.repeat(64), ['clusterId', 'total_spent'])],
    });
    const sessionId = await createSession(h);
    const first = await h.service.processSessionTurn({ sessionId, question: 'Cual es el mejor grupo?' });
    const second = await h.service.processSessionTurn({ sessionId, question: 'Por gasto total' });
    expect(first.status).toBe('ok');
    if (first.status === 'ok') expect(first.response.status).toBe('clarification_required');
    expect(second.status).toBe('ok');
    if (second.status === 'ok') expect(second.response.status).toBe('answered');
    expect(h.executeAnalyticalQuery).toHaveBeenCalledWith(expect.objectContaining({
      plan: expect.objectContaining({ filters: [{ field: 'cluster.clusterId', operator: 'is_not_null' }] }),
    }));
  });

  it.each([
    ['Cual grupo compra mas caro?', 'averageOrderValue'],
    ['Hay clientes medios muertos?', 'daysSinceLastOrder'],
    ['Que grupo compra harto pero poco seguido?', 'validOrders'],
  ])('interprets colloquial question "%s" into available concepts', async (question, expectedConcept) => {
    const h = harness({
      decisions: [decision('run_analytics', { analyticalQuestion: `Analyze ${expectedConcept} using available Customer Intelligence metrics.` })],
      plans: [plan([{ id: 'colloquial_analysis', plan: avgTicketByCluster() }])],
    });
    const sessionId = await createSession(h);
    await h.service.processSessionTurn({ sessionId, question });
    expect(h.generateAnalysisPlan).toHaveBeenCalledWith(expect.objectContaining({ question: expect.stringContaining(expectedConcept) }));
  });

  it.each([
    ['Que ves interesante en mis clientes?'],
    ['Dame una lectura general de la base.'],
    ['Donde ves una oportunidad comercial?'],
    ['Hay algo raro?'],
  ])('runs exploratory analytics for broad prompt "%s"', async (question) => {
    const h = harness({
      decisions: [decision('run_analytics', { analyticalQuestion: 'Provide a broad evidence-backed customer analysis using up to 3 aggregate queries and state limitations.' })],
      plans: [plan([{ id: 'cluster_distribution', plan: countByCluster() }, { id: 'ticket_by_cluster', plan: avgTicketByCluster() }])],
    });
    const sessionId = await createSession(h);
    await h.service.processSessionTurn({ sessionId, question });
    expect(h.generateAnalysisPlan).toHaveBeenCalledWith(expect.objectContaining({ maxQueries: 3 }));
    expect(h.executeAnalyticalQuery).toHaveBeenCalledTimes(2);
  });

  it('does not substitute revenue for unavailable profitability', async () => {
    const h = harness({
      decisions: [decision('run_analytics', { analyticalQuestion: 'Assess whether profitability is available; do not substitute spend for profit.' })],
      plans: [terminalPlan('unsupported_data', 'No margin, cost, or profit field is available.')],
    });
    const sessionId = await createSession(h);
    const response = await h.service.processSessionTurn({ sessionId, question: 'Cual segmento es mas rentable?' });
    expect(response.status).toBe('ok');
    if (response.status === 'ok') expect(response.response.status).toBe('unsupported_data');
  });

  it('does not present future purchase prediction as fact', async () => {
    const h = harness({
      decisions: [decision('run_analytics', { analyticalQuestion: 'Explain that no predictive model is available; historical activity can be analyzed only as context.' })],
      plans: [terminalPlan('unsupported_data', 'No predictive model field is available.')],
    });
    const sessionId = await createSession(h);
    const response = await h.service.processSessionTurn({ sessionId, question: 'Que cluster va a comprar mas el proximo mes?' });
    expect(response.status).toBe('ok');
    if (response.status === 'ok') expect(response.response.status).toBe('unsupported_data');
  });

  it('passes answerer prompt context for non-causal explanatory synthesis', async () => {
    const h = harness({
      decisions: [decision('run_analytics', { analyticalQuestion: 'Why does Cluster 3 have higher ticket? Gather observed differences only.' })],
      plans: [plan([{ id: 'why_cluster_3', plan: avgTicketByCluster() }])],
      executionResults: [result([{ clusterId: 3, avg_ticket: '150000.000000' }], '3'.repeat(64), ['clusterId', 'avg_ticket'])],
    });
    const sessionId = await createSession(h);
    await h.service.processSessionTurn({ sessionId, question: 'Por que el cluster 3 tiene mayor ticket?' });
    expect(h.generateAnswer).toHaveBeenCalledTimes(1);
    expect(h.getLastAnswerInput()?.question).toContain('Por que');
  });

  it('updates current semantic reference to Cluster 3 instead of retaining earlier Cluster 0 focus', async () => {
    const h = harness({
      decisions: [
        decision('run_analytics', { analyticalQuestion: 'How many customers are in each assigned cluster?' }),
        decision('run_analytics', { analyticalQuestion: 'Which assigned cluster has the highest average ticket?' }),
      ],
      plans: [plan([{ id: 'clusters_by_count', plan: countByCluster() }]), plan([{ id: 'avg_ticket_by_cluster', plan: avgTicketByCluster() }])],
      executionResults: [
        result([{ clusterId: 0, customer_count: 40 }, { clusterId: 3, customer_count: 10 }], '4'.repeat(64), ['clusterId', 'customer_count']),
        result([{ clusterId: 3, avg_ticket: '150000.000000' }, { clusterId: 0, avg_ticket: '70000.000000' }], '5'.repeat(64), ['clusterId', 'avg_ticket']),
      ],
    });
    const sessionId = await createSession(h);
    await h.service.processSessionTurn({ sessionId, question: 'Cuantos hay en cada cluster?' });
    await h.service.processSessionTurn({ sessionId, question: 'Cual tiene mayor ticket promedio?' });
    const persisted = await h.service.getSession(sessionId);
    expect(persisted.status).toBe('ok');
    if (persisted.status === 'ok') {
      expect(persisted.session.analyticalReferences[0]).toEqual({
        name: 'currentAudience',
        sourceQueryId: 'avg_ticket_by_cluster',
        filters: [{ field: 'cluster.clusterId', operator: 'eq', value: 3 }],
      });
    }
  });
});
