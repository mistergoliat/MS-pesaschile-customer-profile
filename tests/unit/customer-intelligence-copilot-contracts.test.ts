import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
  CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
  validateCopilotAnalysisPlan,
  validateCopilotConversationDecision,
  validateCopilotConversationPlan,
  type CopilotSessionContext,
} from '../../src/domain/customer-intelligence-copilot/index.js';

const EMPTY_SESSION_CONTEXT: Pick<CopilotSessionContext, 'analyticalReferences' | 'recentResults'> = {
  analyticalReferences: [],
  recentResults: [],
};

const SESSION_CONTEXT_WITH_RESULT: Pick<CopilotSessionContext, 'analyticalReferences' | 'recentResults'> = {
  analyticalReferences: [{ name: 'currentAudience', sourceQueryId: 'cluster_distribution', filters: [] }],
  recentResults: [
    {
      queryId: 'cluster_distribution',
      queryPlanHash: 'a'.repeat(64),
      columns: [{ name: 'clusterId', type: 'integer' }],
      rows: [{ clusterId: 1, customers: 10 }],
      rowCount: 1,
      truncated: false,
    },
  ],
};

describe('Customer Intelligence Copilot contracts', () => {
  it('rejects invalid planner envelope versions and statuses without relaxing validation', () => {
    const result = validateCopilotAnalysisPlan({ planVersion: 1, status: 'valid' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('unsupported planVersion: 1');
      expect(result.errors).toContain('unsupported analysis plan status: valid');
    }
  });

  it('accepts all five valid planner statuses with required conditional properties', () => {
    const plans = [
      {
        planVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
        status: 'query_plan',
        queries: [{ id: 'q1', plan: { metrics: [{ aggregation: 'count', alias: 'customers' }] } }],
      },
      { planVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION, status: 'answer_from_context', sourceQueryIds: ['q1'] },
      { planVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION, status: 'unsupported_data', message: 'No data.' },
      { planVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION, status: 'unsupported_operation', message: 'No operation.' },
      { planVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION, status: 'clarification_required', message: 'Clarify.' },
    ];
    for (const plan of plans) expect(validateCopilotAnalysisPlan(plan).ok).toBe(true);
  });

  it('validates conversational decisions and rejects unknown actions or SQL', () => {
    expect(
      validateCopilotConversationDecision({
        decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
        action: 'run_analytics',
        analyticalQuestion: 'Count customers.',
      }).ok,
    ).toBe(true);

    const unknown = validateCopilotConversationDecision({
      decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
      action: 'execute_sql',
      sql: 'SELECT * FROM customer',
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.errors.join(' ')).toMatch(/must not contain executable code/);
      expect(unknown.errors.join(' ')).toMatch(/unsupported conversation decision action/);
    }
  });

  it('rejects answer_from_context when a fresh session has no sourceQueryIds or usable analytical context', () => {
    const result = validateCopilotConversationDecision(
      {
        decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
        action: 'answer_from_context',
        sourceQueryIds: [],
        instruction: '',
      },
      { sessionContext: EMPTY_SESSION_CONTEXT },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain('answer_from_context requires a non-empty instruction');
      expect(result.errors).toContain('answer_from_context requires at least one sourceQueryId');
    }
  });

  it('rejects answer_from_context with invented sourceQueryIds', () => {
    const result = validateCopilotConversationDecision(
      {
        decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
        action: 'answer_from_context',
        sourceQueryIds: ['invented_query'],
        instruction: 'Usa el resultado anterior.',
      },
      { sessionContext: SESSION_CONTEXT_WITH_RESULT },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('sourceQueryId is not available in session context: invented_query');
  });

  it('accepts answer_from_context when a cited prior result is present', () => {
    const result = validateCopilotConversationDecision(
      {
        decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
        action: 'answer_from_context',
        sourceQueryIds: ['cluster_distribution'],
        instruction: 'Identifica el cluster con mayor cantidad de clientes usando el resultado previo.',
      },
      { sessionContext: SESSION_CONTEXT_WITH_RESULT },
    );

    expect(result.ok).toBe(true);
  });

  it('rejects respond_directly for deterministic fresh business fact questions', () => {
    const result = validateCopilotConversationDecision(
      {
        decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
        action: 'respond_directly',
        message: 'Hay 10 clientes.',
      },
      { question: 'Cuantos clientes hay?', sessionContext: EMPTY_SESSION_CONTEXT },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('respond_directly cannot answer analytical Customer Intelligence questions that require grounded data');
  });

  it('rejects respond_directly for reactivation-priority recommendations that require analytics', () => {
    const result = validateCopilotConversationDecision(
      {
        decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
        action: 'respond_directly',
        message: 'Priorizaria el cluster 3.',
      },
      { question: 'Que grupo priorizarias para una campana de reactivacion y por que?', sessionContext: EMPTY_SESSION_CONTEXT },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('respond_directly cannot answer analytical Customer Intelligence questions that require grounded data');
  });

  it('accepts valid unified non-analytical envelopes', () => {
    expect(validateCopilotConversationPlan({
      version: CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION,
      action: 'respond_directly',
      message: 'Hola. Puedo ayudar con analisis de Customer Intelligence.',
    }, { question: 'Hola', sessionContext: EMPTY_SESSION_CONTEXT }).ok).toBe(true);

    expect(validateCopilotConversationPlan({
      version: CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION,
      action: 'clarification_required',
      message: 'Necesito un criterio concreto.',
    }, { question: 'Cual es el mejor grupo?', sessionContext: EMPTY_SESSION_CONTEXT }).ok).toBe(true);
  });

  it('accepts unified answer_from_context only with feasible source ids', () => {
    const valid = validateCopilotConversationPlan({
      version: CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION,
      action: 'answer_from_context',
      sourceQueryIds: ['cluster_distribution'],
      instruction: 'Usa el resultado retenido.',
    }, { question: 'Que dijiste antes?', sessionContext: SESSION_CONTEXT_WITH_RESULT });
    expect(valid.ok).toBe(true);

    const invalid = validateCopilotConversationPlan({
      version: CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION,
      action: 'answer_from_context',
      sourceQueryIds: ['invented'],
      instruction: 'Usa el resultado retenido.',
    }, { question: 'Que dijiste antes?', sessionContext: SESSION_CONTEXT_WITH_RESULT });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.errors).toContain('sourceQueryId is not available in session context: invented');
  });

  it('accepts unified run_analytics only with an embedded analysis plan', () => {
    const result = validateCopilotConversationPlan({
      version: CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION,
      action: 'run_analytics',
      analyticalQuestion: 'Count customers.',
      analysisPlan: {
        planVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
        status: 'query_plan',
        queries: [{ id: 'q1', plan: { metrics: [{ aggregation: 'count', alias: 'customers' }] } }],
      },
    }, { question: 'Cuantos clientes hay?', sessionContext: EMPTY_SESSION_CONTEXT });
    expect(result.ok).toBe(true);
  });

  it('rejects malformed unified envelopes and forbidden analysis plans', () => {
    const malformed = validateCopilotConversationPlan({ version: 'v1', action: 'run_analytics', analyticalQuestion: 'q' });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) {
      expect(malformed.errors).toContain('unsupported conversation plan version: v1');
      expect(malformed.errors).toContain('run_analytics requires analysisPlan');
    }

    const forbidden = validateCopilotConversationPlan({
      version: CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION,
      action: 'respond_directly',
      message: 'Hola.',
      analysisPlan: { planVersion: CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION, status: 'query_plan', queries: [] },
    }, { question: 'Hola', sessionContext: EMPTY_SESSION_CONTEXT });
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.errors).toContain('respond_directly must not include analysisPlan');
  });
});
