import type { ValidityMatrixRow, ValiditySummary } from './types.js';

// CP-R1-T07A section 4: pure aggregation over the valid x current_state matrix. Never
// decides "this state is a real purchase" from `stateName` — the only inputs that drive
// the summary are `valid`, `currentStateId` and the caller-supplied cancelled/refunded
// state ids (which section 6 gives explicitly: current_state = 6 / 7). `stateName` is
// carried on ValidityMatrixRow for the report's documentary interpretation only, never
// read here.
export function summarizeValidityMatrix(
  matrix: readonly ValidityMatrixRow[],
  options: { readonly cancelledStateId: number; readonly refundedStateId: number },
): ValiditySummary {
  const stateIdsWithValid1 = new Set<number>();
  const stateIdsWithValid0 = new Set<number>();
  let totalOrders = 0;
  let validOrderCount = 0;
  let invalidOrderCount = 0;

  for (const row of matrix) {
    totalOrders += row.orderCount;
    if (row.valid) {
      validOrderCount += row.orderCount;
      if (row.currentStateId !== null) stateIdsWithValid1.add(row.currentStateId);
    } else {
      invalidOrderCount += row.orderCount;
      if (row.currentStateId !== null) stateIdsWithValid0.add(row.currentStateId);
    }
  }

  const stateIdsWithBothValidities = Array.from(stateIdsWithValid1).filter((stateId) => stateIdsWithValid0.has(stateId));

  return {
    totalOrders,
    validOrderCount,
    invalidOrderCount,
    stateIdsWithValid1: Array.from(stateIdsWithValid1).sort((a, b) => a - b),
    stateIdsWithValid0: Array.from(stateIdsWithValid0).sort((a, b) => a - b),
    stateIdsWithBothValidities: stateIdsWithBothValidities.sort((a, b) => a - b),
    cancelledStateHasValidOrders: hasValidOrders(matrix, options.cancelledStateId),
    refundedStateHasValidOrders: hasValidOrders(matrix, options.refundedStateId),
    cleanSplit: stateIdsWithBothValidities.length === 0,
  };
}

// null (not false) when the state id has zero orders in the matrix at all — "never
// observed" and "observed but always valid=0" are different facts, see ValiditySummary.
function hasValidOrders(matrix: readonly ValidityMatrixRow[], stateId: number): boolean | null {
  const rowsForState = matrix.filter((row) => row.currentStateId === stateId);
  if (rowsForState.length === 0) return null;
  return rowsForState.some((row) => row.valid && row.orderCount > 0);
}
