import {
  CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
  type CopilotConversationDecision,
} from './contracts.js';

export type CopilotConversationDecisionValidationResult =
  | { readonly ok: true; readonly decision: CopilotConversationDecision }
  | { readonly ok: false; readonly errors: readonly string[] };

const SAFE_QUERY_ID = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export function validateCopilotConversationDecision(rawDecision: unknown): CopilotConversationDecisionValidationResult {
  const errors: string[] = [];
  if (containsForbiddenExecutableKey(rawDecision)) {
    errors.push('conversation decision must not contain executable code, sql, tool names, table names, DB columns, credentials, or shell commands');
  }
  if (rawDecision === null || typeof rawDecision !== 'object' || Array.isArray(rawDecision)) {
    return { ok: false, errors: [...errors, 'conversation decision must be a JSON object'] };
  }

  const raw = rawDecision as Record<string, unknown>;
  if (raw.decisionVersion !== CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION) {
    errors.push(`unsupported decisionVersion: ${String(raw.decisionVersion)}`);
  }

  switch (raw.action) {
    case 'respond_directly':
    case 'clarification_required':
    case 'unsupported':
      if (typeof raw.message !== 'string' || raw.message.trim().length === 0) {
        errors.push(`${raw.action} requires a non-empty message`);
      }
      break;
    case 'run_analytics':
      if (typeof raw.analyticalQuestion !== 'string' || raw.analyticalQuestion.trim().length === 0) {
        errors.push('run_analytics requires a non-empty analyticalQuestion');
      }
      break;
    case 'answer_from_context':
      if (typeof raw.instruction !== 'string' || raw.instruction.trim().length === 0) {
        errors.push('answer_from_context requires a non-empty instruction');
      }
      validateSourceQueryIds(raw.sourceQueryIds, errors);
      break;
    default:
      errors.push(`unsupported conversation decision action: ${String(raw.action)}`);
      break;
  }

  return errors.length === 0 ? { ok: true, decision: raw as CopilotConversationDecision } : { ok: false, errors };
}

function validateSourceQueryIds(value: unknown, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('answer_from_context requires at least one sourceQueryId');
    return;
  }
  if (value.length > CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES) {
    errors.push(`too many sourceQueryIds: ${value.length} (max ${CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES})`);
    return;
  }
  const ids = new Set<string>();
  for (const id of value) {
    if (typeof id !== 'string' || !SAFE_QUERY_ID.test(id)) {
      errors.push('each sourceQueryId must match ^[A-Za-z_][A-Za-z0-9_]{0,127}$');
    } else if (ids.has(id)) {
      errors.push(`duplicate sourceQueryId: ${id}`);
    } else {
      ids.add(id);
    }
  }
}

function containsForbiddenExecutableKey(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsForbiddenExecutableKey);
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const normalized = key.toLowerCase();
    return (
      normalized === 'sql' ||
      normalized === 'code' ||
      normalized === 'command' ||
      normalized === 'shell' ||
      normalized === 'tool' ||
      normalized === 'table' ||
      normalized === 'column' ||
      normalized === 'credential' ||
      normalized === 'api_key' ||
      containsForbiddenExecutableKey(child)
    );
  });
}
