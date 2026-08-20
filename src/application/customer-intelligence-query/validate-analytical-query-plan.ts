import {
  validateAnalyticalQueryPlan as validatePlan,
  type AnalyticalQueryValidationResult,
} from '../../domain/customer-intelligence-query/index.js';

// task Section 74 — the second of the three Copilot-facing capabilities. A thin re-export
// (not a redefinition, task Section 27's own precedent applied to this task): the actual
// validation logic is pure domain code so it can be unit-tested without any DB dependency;
// this wrapper exists only so the application layer's public surface matches the task's
// requested three-capability shape (getAnalyticalSchema / validateAnalyticalQueryPlan /
// executeAnalyticalQuery) at a single import path.
export function validateAnalyticalQueryPlan(rawPlan: unknown): AnalyticalQueryValidationResult {
  return validatePlan(rawPlan);
}
