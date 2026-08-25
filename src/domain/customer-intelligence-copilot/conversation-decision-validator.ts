import {
  CUSTOMER_INTELLIGENCE_CONVERSATION_DECISION_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
  type CopilotSessionContext,
  type CopilotConversationDecision,
} from './contracts.js';

export type CopilotConversationDecisionValidationResult =
  | { readonly ok: true; readonly decision: CopilotConversationDecision }
  | { readonly ok: false; readonly errors: readonly string[] };

export type CopilotConversationDecisionValidationContext = {
  readonly question?: string;
  readonly sessionContext?: Pick<CopilotSessionContext, 'analyticalReferences' | 'recentResults'>;
};

const SAFE_QUERY_ID = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export function validateCopilotConversationDecision(
  rawDecision: unknown,
  context: CopilotConversationDecisionValidationContext = {},
): CopilotConversationDecisionValidationResult {
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
      if (context.question && asksForFreshBusinessFact(context.question)) {
        errors.push('respond_directly cannot answer fresh Customer Intelligence business facts');
      }
      if (typeof raw.message !== 'string' || raw.message.trim().length === 0) {
        errors.push(`${raw.action} requires a non-empty message`);
      }
      break;
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
      validateSourceQueryIds(raw.sourceQueryIds, errors, context.sessionContext);
      break;
    default:
      errors.push(`unsupported conversation decision action: ${String(raw.action)}`);
      break;
  }

  return errors.length === 0 ? { ok: true, decision: raw as CopilotConversationDecision } : { ok: false, errors };
}

function validateSourceQueryIds(
  value: unknown,
  errors: string[],
  sessionContext: CopilotConversationDecisionValidationContext['sessionContext'],
): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('answer_from_context requires at least one sourceQueryId');
    return;
  }
  if (value.length > CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES) {
    errors.push(`too many sourceQueryIds: ${value.length} (max ${CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES})`);
    return;
  }
  const ids = new Set<string>();
  const availableSourceQueryIds = sessionContext ? collectAvailableSourceQueryIds(sessionContext) : null;
  if (availableSourceQueryIds && availableSourceQueryIds.size === 0) {
    errors.push('answer_from_context requires at least one available session analytical reference or result');
  }
  for (const id of value) {
    if (typeof id !== 'string' || !SAFE_QUERY_ID.test(id)) {
      errors.push('each sourceQueryId must match ^[A-Za-z_][A-Za-z0-9_]{0,127}$');
    } else if (ids.has(id)) {
      errors.push(`duplicate sourceQueryId: ${id}`);
    } else if (availableSourceQueryIds && !availableSourceQueryIds.has(id)) {
      errors.push(`sourceQueryId is not available in session context: ${id}`);
    } else {
      ids.add(id);
    }
  }
}

function collectAvailableSourceQueryIds(sessionContext: Pick<CopilotSessionContext, 'analyticalReferences' | 'recentResults'>): Set<string> {
  return new Set([
    ...sessionContext.analyticalReferences.map((reference) => reference.sourceQueryId),
    ...sessionContext.recentResults.map((result) => result.queryId),
  ]);
}

export function asksForFreshBusinessFact(question: string): boolean {
  const normalized = normalizeQuestion(question);
  const hasPopulationSubject = /\b(clientes?|customers?|poblacion|population|audiencia|audience|clusters?|segmentos?|segments?|grupos?|groups?)\b/.test(normalized);
  if (!hasPopulationSubject) return false;

  return (
    /\b(cuantos?|cuantas?|cantidad|numero|conteo|total|how many|number of|count)\b/.test(normalized) ||
    /\b(promedio|average|media|sum(a)?|suma|agregado|aggregate|ranking|rank|top|mayor(es)?|menor(es)?|highest|lowest|largest|smallest)\b/.test(normalized) ||
    /\b(en|por) cada (cluster|segmento|grupo)\b/.test(normalized) ||
    /\bby (cluster|segment|group)\b/.test(normalized)
  );
}

function normalizeQuestion(question: string): string {
  return question
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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
