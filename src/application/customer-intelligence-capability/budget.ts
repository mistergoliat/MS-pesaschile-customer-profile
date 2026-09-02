import { CapabilityError, type CapabilityBudget } from './contracts.js';

export type CreateCapabilityBudgetInput = {
  readonly maxCalls: number;
  readonly maxRows: number;
  readonly maxDurationMs: number;
};

export function createCapabilityBudget(input: CreateCapabilityBudgetInput): CapabilityBudget {
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new CapabilityError('INVALID_INPUT', `capability budget ${name} must be a positive safe integer`);
    }
  }
  return {
    ...input,
    remainingCalls: input.maxCalls,
    remainingRows: input.maxRows,
    remainingDurationMs: input.maxDurationMs,
  };
}

export function reserveCapabilityCall(budget: CapabilityBudget, requestedRows: number): number {
  if (budget.remainingCalls <= 0) throw new CapabilityError('BUDGET_EXCEEDED', 'capability call budget exhausted');
  if (!Number.isSafeInteger(requestedRows) || requestedRows <= 0) {
    throw new CapabilityError('INVALID_INPUT', 'capability requested row limit is invalid');
  }
  if (requestedRows > budget.remainingRows) {
    throw new CapabilityError('BUDGET_EXCEEDED', 'capability row budget exhausted');
  }
  if (budget.remainingDurationMs <= 0) throw new CapabilityError('BUDGET_EXCEEDED', 'capability duration budget exhausted');
  budget.remainingCalls -= 1;
  return budget.remainingDurationMs;
}

export function recordCapabilityExecution(budget: CapabilityBudget, rowCount: number, durationMs: number): void {
  budget.remainingRows = Math.max(0, budget.remainingRows - rowCount);
  budget.remainingDurationMs = Math.max(0, budget.remainingDurationMs - durationMs);
}
