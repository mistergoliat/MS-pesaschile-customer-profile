import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
  validateCopilotAnalysisPlan,
  validateCopilotConversationDecision,
} from '../../src/domain/customer-intelligence-copilot/index.js';

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
});
