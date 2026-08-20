import {
  CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION,
  CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES,
  type CopilotAnalysisPlan,
} from './contracts.js';

export type CopilotAnalysisPlanValidationResult =
  | { readonly ok: true; readonly plan: CopilotAnalysisPlan }
  | { readonly ok: false; readonly errors: readonly string[] };

const SAFE_STEP_ID = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export function validateCopilotAnalysisPlan(rawPlan: unknown): CopilotAnalysisPlanValidationResult {
  const errors: string[] = [];
  if (containsForbiddenSqlKey(rawPlan)) {
    errors.push('analysis plan must not contain sql');
  }
  if (rawPlan === null || typeof rawPlan !== 'object' || Array.isArray(rawPlan)) {
    return { ok: false, errors: [...errors, 'analysis plan must be a JSON object'] };
  }

  const raw = rawPlan as Record<string, unknown>;
  if (raw.planVersion !== CUSTOMER_INTELLIGENCE_COPILOT_ANALYSIS_PLAN_VERSION) {
    errors.push(`unsupported planVersion: ${String(raw.planVersion)}`);
  }

  if (raw.status === 'unsupported_data' || raw.status === 'unsupported_operation' || raw.status === 'clarification_required') {
    if (typeof raw.message !== 'string' || raw.message.trim().length === 0) {
      errors.push(`${raw.status} requires a non-empty message`);
    }
    return errors.length === 0 ? { ok: true, plan: raw as CopilotAnalysisPlan } : { ok: false, errors };
  }

  if (raw.status === 'answer_from_context') {
    if (!Array.isArray(raw.sourceQueryIds) || raw.sourceQueryIds.length === 0) {
      errors.push('answer_from_context requires at least one sourceQueryId');
    } else if (raw.sourceQueryIds.length > CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES) {
      errors.push(`too many sourceQueryIds: ${raw.sourceQueryIds.length} (max ${CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES})`);
    } else {
      const ids = new Set<string>();
      for (const id of raw.sourceQueryIds) {
        if (typeof id !== 'string' || !SAFE_STEP_ID.test(id)) {
          errors.push('each sourceQueryId must match ^[A-Za-z_][A-Za-z0-9_]{0,63}$');
        } else if (ids.has(id)) {
          errors.push(`duplicate sourceQueryId: ${id}`);
        } else {
          ids.add(id);
        }
      }
    }
    return errors.length === 0 ? { ok: true, plan: raw as CopilotAnalysisPlan } : { ok: false, errors };
  }

  if (raw.status !== 'query_plan') {
    errors.push(`unsupported analysis plan status: ${String(raw.status)}`);
    return { ok: false, errors };
  }

  if (!Array.isArray(raw.queries) || raw.queries.length === 0) {
    errors.push('query_plan requires at least one query');
  } else if (raw.queries.length > CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES) {
    errors.push(`too many queries: ${raw.queries.length} (max ${CUSTOMER_INTELLIGENCE_COPILOT_MAX_QUERIES})`);
  }

  const ids = new Set<string>();
  if (Array.isArray(raw.queries)) {
    for (const query of raw.queries) {
      if (query === null || typeof query !== 'object' || Array.isArray(query)) {
        errors.push('each query must be an object with id and plan');
        continue;
      }
      const step = query as Record<string, unknown>;
      if (typeof step.id !== 'string' || !SAFE_STEP_ID.test(step.id)) {
        errors.push('each query id must match ^[A-Za-z_][A-Za-z0-9_]{0,63}$');
      } else if (ids.has(step.id)) {
        errors.push(`duplicate query id: ${step.id}`);
      } else {
        ids.add(step.id);
      }
      if (step.plan === null || typeof step.plan !== 'object' || Array.isArray(step.plan)) {
        errors.push(`query ${String(step.id)} requires a structured AnalyticalQueryPlan`);
      }
    }
  }

  return errors.length === 0 ? { ok: true, plan: raw as CopilotAnalysisPlan } : { ok: false, errors };
}

function containsForbiddenSqlKey(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsForbiddenSqlKey);
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => key.toLowerCase() === 'sql' || containsForbiddenSqlKey(child));
}
