import {
  CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
  CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION,
  type CopilotConversationDecision,
  type CopilotConversationDecisionAction,
  type CopilotConversationPlan,
} from './contracts.js';
import { validateCopilotConversationDecision, type CopilotConversationDecisionValidationContext } from './conversation-decision-validator.js';

export type CopilotConversationPlanValidationResult =
  | { readonly ok: true; readonly plan: CopilotConversationPlan; readonly decision: CopilotConversationDecision }
  | { readonly ok: false; readonly errors: readonly string[] };

const ACTIONS: readonly CopilotConversationDecisionAction[] = [
  'respond_directly',
  'clarification_required',
  'answer_from_context',
  'run_analytics',
  'unsupported',
];

export function validateCopilotConversationPlan(
  rawPlan: unknown,
  context: CopilotConversationDecisionValidationContext = {},
): CopilotConversationPlanValidationResult {
  const errors: string[] = [];
  if (rawPlan === null || typeof rawPlan !== 'object' || Array.isArray(rawPlan)) {
    return { ok: false, errors: ['conversation plan must be a JSON object'] };
  }

  const raw = rawPlan as Record<string, unknown>;
  if (raw.version !== CUSTOMER_INTELLIGENCE_CONVERSATION_PLAN_VERSION) {
    errors.push(`unsupported conversation plan version: ${String(raw.version)}`);
  }
  if (!ACTIONS.includes(raw.action as CopilotConversationDecisionAction)) {
    errors.push(`unsupported conversation plan action: ${String(raw.action)}`);
  }

  const decision = decisionFromPlan(raw);
  const decisionValidation = validateCopilotConversationDecision(decision, context);
  if (!decisionValidation.ok) errors.push(...decisionValidation.errors);

  if (raw.action === 'run_analytics') {
    if (!('analysisPlan' in raw)) {
      errors.push('run_analytics requires analysisPlan');
    }
  } else if ('analysisPlan' in raw) {
    errors.push(`${String(raw.action)} must not include analysisPlan`);
  }

  if (raw.action === 'answer_from_context' && 'analyticalQuestion' in raw) {
    errors.push('answer_from_context must not include analyticalQuestion');
  }
  if (raw.action !== 'answer_from_context' && ('sourceQueryIds' in raw || 'instruction' in raw) && raw.action !== 'run_analytics') {
    errors.push(`${String(raw.action)} must not include sourceQueryIds or instruction`);
  }

  return errors.length === 0
    ? { ok: true, plan: raw as unknown as CopilotConversationPlan, decision: decisionValidation.ok ? decisionValidation.decision : decision as CopilotConversationDecision }
    : { ok: false, errors };
}

function decisionFromPlan(raw: Record<string, unknown>): unknown {
  const base = {
    decisionVersion: CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
    action: raw.action,
  };
  switch (raw.action) {
    case 'respond_directly':
    case 'clarification_required':
    case 'unsupported':
      return { ...base, message: raw.message };
    case 'answer_from_context':
      return { ...base, sourceQueryIds: raw.sourceQueryIds, instruction: raw.instruction };
    case 'run_analytics':
      return { ...base, analyticalQuestion: raw.analyticalQuestion };
    default:
      return base;
  }
}
