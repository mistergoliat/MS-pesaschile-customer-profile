import { describe, expect, it } from 'vitest';
import { summarizeValidityMatrix } from '../../scripts/audits/commercial-summary/lib/validity.js';
import type { ValidityMatrixRow } from '../../scripts/audits/commercial-summary/lib/types.js';

function row(overrides: Partial<ValidityMatrixRow>): ValidityMatrixRow {
  return {
    valid: true,
    currentStateId: 2,
    stateName: 'Pago aceptado',
    paid: true,
    logable: true,
    orderCount: 1,
    sumTotalPaidTaxIncl: '0.000000',
    sumTotalProductsWt: '0.000000',
    firstSeenAt: '2026-01-01 00:00:00',
    lastSeenAt: '2026-01-01 00:00:00',
    ...overrides,
  };
}

const CANCELLED_STATE_ID = 6;
const REFUNDED_STATE_ID = 7;

describe('summarizeValidityMatrix', () => {
  it('totals orders and splits valid/invalid counts by orderCount, not by row count', () => {
    const matrix = [row({ valid: true, currentStateId: 2, orderCount: 100 }), row({ valid: false, currentStateId: 8, orderCount: 5 })];

    const summary = summarizeValidityMatrix(matrix, { cancelledStateId: CANCELLED_STATE_ID, refundedStateId: REFUNDED_STATE_ID });

    expect(summary.totalOrders).toBe(105);
    expect(summary.validOrderCount).toBe(100);
    expect(summary.invalidOrderCount).toBe(5);
  });

  it('lists distinct state ids observed under valid=1 and valid=0 separately', () => {
    const matrix = [row({ valid: true, currentStateId: 2 }), row({ valid: true, currentStateId: 4 }), row({ valid: false, currentStateId: 8 })];

    const summary = summarizeValidityMatrix(matrix, { cancelledStateId: CANCELLED_STATE_ID, refundedStateId: REFUNDED_STATE_ID });

    expect(summary.stateIdsWithValid1).toEqual([2, 4]);
    expect(summary.stateIdsWithValid0).toEqual([8]);
  });

  it('flags a clean split (no state observed under both validities) as cleanSplit = true', () => {
    const matrix = [row({ valid: true, currentStateId: 2 }), row({ valid: false, currentStateId: 8 })];

    const summary = summarizeValidityMatrix(matrix, { cancelledStateId: CANCELLED_STATE_ID, refundedStateId: REFUNDED_STATE_ID });

    expect(summary.cleanSplit).toBe(true);
    expect(summary.stateIdsWithBothValidities).toEqual([]);
  });

  it('flags an unclean split when the same state id appears under both valid=1 and valid=0', () => {
    const matrix = [row({ valid: true, currentStateId: 2 }), row({ valid: false, currentStateId: 2 })];

    const summary = summarizeValidityMatrix(matrix, { cancelledStateId: CANCELLED_STATE_ID, refundedStateId: REFUNDED_STATE_ID });

    expect(summary.cleanSplit).toBe(false);
    expect(summary.stateIdsWithBothValidities).toEqual([2]);
  });

  it('reports cancelledStateHasValidOrders = true when current_state = 6 appears with valid = 1 and orderCount > 0', () => {
    const matrix = [row({ valid: true, currentStateId: CANCELLED_STATE_ID, orderCount: 3 })];

    const summary = summarizeValidityMatrix(matrix, { cancelledStateId: CANCELLED_STATE_ID, refundedStateId: REFUNDED_STATE_ID });

    expect(summary.cancelledStateHasValidOrders).toBe(true);
  });

  it('reports cancelledStateHasValidOrders = false when current_state = 6 only appears with valid = 0', () => {
    const matrix = [row({ valid: false, currentStateId: CANCELLED_STATE_ID, orderCount: 3 })];

    const summary = summarizeValidityMatrix(matrix, { cancelledStateId: CANCELLED_STATE_ID, refundedStateId: REFUNDED_STATE_ID });

    expect(summary.cancelledStateHasValidOrders).toBe(false);
  });

  it('reports cancelledStateHasValidOrders = null when the state was never observed at all (distinct from false)', () => {
    const matrix = [row({ valid: true, currentStateId: 2 })];

    const summary = summarizeValidityMatrix(matrix, { cancelledStateId: CANCELLED_STATE_ID, refundedStateId: REFUNDED_STATE_ID });

    expect(summary.cancelledStateHasValidOrders).toBeNull();
  });

  it('reports refundedStateHasValidOrders independently of cancelledStateHasValidOrders', () => {
    const matrix = [row({ valid: true, currentStateId: REFUNDED_STATE_ID, orderCount: 2 }), row({ valid: false, currentStateId: CANCELLED_STATE_ID, orderCount: 4 })];

    const summary = summarizeValidityMatrix(matrix, { cancelledStateId: CANCELLED_STATE_ID, refundedStateId: REFUNDED_STATE_ID });

    expect(summary.refundedStateHasValidOrders).toBe(true);
    expect(summary.cancelledStateHasValidOrders).toBe(false);
  });

  it('never reads stateName to decide anything (name-agnostic classification)', () => {
    const misleadingMatrix = [row({ valid: true, currentStateId: 2, stateName: 'Cancelado' }), row({ valid: false, currentStateId: 8, stateName: 'Entregado' })];

    const summary = summarizeValidityMatrix(misleadingMatrix, { cancelledStateId: CANCELLED_STATE_ID, refundedStateId: REFUNDED_STATE_ID });

    // Neither state id (2 or 8) is the configured cancelled/refunded id (6/7), so both
    // must read null regardless of what the (misleading) names say.
    expect(summary.cancelledStateHasValidOrders).toBeNull();
    expect(summary.refundedStateHasValidOrders).toBeNull();
  });

  it('ignores currentStateId = null rows when building the distinct state id lists', () => {
    const matrix = [row({ valid: true, currentStateId: null }), row({ valid: true, currentStateId: 2 })];

    const summary = summarizeValidityMatrix(matrix, { cancelledStateId: CANCELLED_STATE_ID, refundedStateId: REFUNDED_STATE_ID });

    expect(summary.stateIdsWithValid1).toEqual([2]);
  });
});
