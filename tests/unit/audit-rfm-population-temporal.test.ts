import { describe, expect, it } from 'vitest';
import { shiftAsOfDateByDays } from '../../scripts/audits/rfm-population/lib/temporal.js';
import {
  buildScoreSnapshot,
  compareScoreSnapshots,
  type TemporalSnapshotRow,
} from '../../scripts/audits/rfm-population/lib/temporal-stability.js';
import { classifyFrequencyModelB } from '../../scripts/audits/rfm-population/lib/frequency-models.js';

describe('CP-R1-T10A real temporal stability (section 9)', () => {
  it('shifts asOfDate back by exact calendar days in UTC and rejects an invalid date', () => {
    expect(shiftAsOfDateByDays('2026-07-29', 30)).toBe('2026-06-29');
    expect(shiftAsOfDateByDays('2026-07-29', 90)).toBe('2026-04-30');
    expect(shiftAsOfDateByDays('2026-03-01', 1)).toBe('2026-02-28');
    expect(() => shiftAsOfDateByDays('2026/07/29', 30)).toThrow('Invalid asOfDate to shift');
  });

  it('builds a tie-safe R/F/M snapshot keyed by customer id, never publishing the map itself', () => {
    // Five customers with distinct metric values so tie-safe rank scoring (see
    // distribution.ts scoreTieSafe) spans the full 1..5 range, same as the existing
    // scoreTieSafe unit tests rely on for extremes to be reachable.
    const rows: TemporalSnapshotRow[] = [
      { prestashopCustomerId: 1, frequencyOrders: 1, grossMonetaryTaxIncl: '10.000000', recencyDays: 300 },
      { prestashopCustomerId: 2, frequencyOrders: 2, grossMonetaryTaxIncl: '20.000000', recencyDays: 200 },
      { prestashopCustomerId: 3, frequencyOrders: 4, grossMonetaryTaxIncl: '30.000000', recencyDays: 100 },
      { prestashopCustomerId: 4, frequencyOrders: 8, grossMonetaryTaxIncl: '40.000000', recencyDays: 50 },
      { prestashopCustomerId: 5, frequencyOrders: 10, grossMonetaryTaxIncl: '1000.000000', recencyDays: 1 },
    ];
    const snapshot = buildScoreSnapshot(rows, classifyFrequencyModelB);
    expect(snapshot.get(5)).toEqual({ r: 5, f: 5, m: 5, code: '555' });
    expect(snapshot.get(1)).toEqual({ r: 1, f: 1, m: 1, code: '111' });
  });

  it('computes migration percentages between two snapshots without leaking individual ids', () => {
    const baseline = new Map([
      [1, { r: 5 as const, f: 5 as const, m: 5 as const, code: '555' }],
      [2, { r: 1 as const, f: 1 as const, m: 1 as const, code: '111' }],
      [3, { r: 3 as const, f: 3 as const, m: 3 as const, code: '333' }],
    ]);
    const comparison = new Map([
      [1, { r: 5 as const, f: 5 as const, m: 5 as const, code: '555' }], // identical
      [2, { r: 2 as const, f: 1 as const, m: 1 as const, code: '211' }], // within 1
      // customer 3 dropped out; customer 4 is new
      [4, { r: 1 as const, f: 1 as const, m: 1 as const, code: '111' }],
    ]);
    const stats = compareScoreSnapshots(baseline, comparison);
    expect(stats.comparedCustomers).toBe(2);
    expect(stats.onlyInBaseline).toBe(1);
    expect(stats.onlyInComparison).toBe(1);
    expect(stats.identicalCode).toBe(1);
    expect(stats.identicalCodePercent).toBe('0.500000');
    expect(stats.rWithinOne).toBe(2);
    expect(stats.extremeChangeCount).toBe(0);
  });

  it('flags an extreme change when any dimension moves by 3 or more score points', () => {
    const baseline = new Map([[1, { r: 5 as const, f: 5 as const, m: 5 as const, code: '555' }]]);
    const comparison = new Map([[1, { r: 1 as const, f: 5 as const, m: 5 as const, code: '155' }]]);
    const stats = compareScoreSnapshots(baseline, comparison);
    expect(stats.extremeChangeCount).toBe(1);
    expect(stats.rWithinOne).toBe(0);
  });

  it('does not throw when there is no overlap between snapshots', () => {
    const baseline = new Map([[1, { r: 5 as const, f: 5 as const, m: 5 as const, code: '555' }]]);
    const comparison = new Map([[2, { r: 5 as const, f: 5 as const, m: 5 as const, code: '555' }]]);
    const stats = compareScoreSnapshots(baseline, comparison);
    expect(stats.comparedCustomers).toBe(0);
    expect(stats.identicalCodePercent).toBe('0.000000');
  });
});
