import { describe, expect, it } from 'vitest';
import {
  buildCommercialGroupTable,
  evaluateDistinguishability,
  type CommercialRow,
} from '../../scripts/audits/rfm-population/lib/commercial-validity.js';

describe('CP-R1-T10A commercial validity (section 8)', () => {
  const rows: CommercialRow[] = [
    { frequencyOrders: 1, grossMonetaryTaxIncl: '10.000000', recencyDays: 300 },
    { frequencyOrders: 1, grossMonetaryTaxIncl: '30.000000', recencyDays: 200 },
    { frequencyOrders: 5, grossMonetaryTaxIncl: '500.000000', recencyDays: 10 },
  ];

  it('builds a per-score commercial table with count, spend, average, median and shares', () => {
    const scoreOf = (row: CommercialRow): 1 | 2 | 3 | 4 | 5 => (row.frequencyOrders >= 5 ? 5 : 1);
    const groups = buildCommercialGroupTable(rows, scoreOf);
    const score1 = groups.find((group) => group.score === 1)!;
    const score5 = groups.find((group) => group.score === 5)!;

    expect(score1.customerCount).toBe(2);
    expect(score1.grossMonetaryTaxInclTotal).toBe('40.000000');
    expect(score1.averageGrossMonetaryTaxIncl).toBe('20.000000');
    // percentileDecimal uses the same ceil(fraction*n)-1 ranking as the numeric percentile()
    // helper (see distribution.ts), so the 2-element median resolves to the lower value.
    expect(score1.medianGrossMonetaryTaxIncl).toBe('10.000000');
    expect(score5.customerCount).toBe(1);
    expect(score5.percentOfActivePopulation).toBe('0.333333');
    expect(score5.percentOfActiveSpend).toBe('0.925926');
  });

  it('flags a candidate cut as distinguishable only when the higher group spends materially more', () => {
    const groups = buildCommercialGroupTable(rows, (row) => (row.frequencyOrders >= 5 ? 5 : 4));
    const checks = evaluateDistinguishability(groups);
    const fourToFive = checks.find((check) => check.fromScore === 4 && check.toScore === 5);
    expect(fourToFive?.distinguishable).toBe(true);
    expect(Number(fourToFive?.averageSpendRatio)).toBeGreaterThan(1.2);

    // Adjacent empty groups (score 1 vs score 2, both with zero customers here) cannot be
    // compared and must be reported as such, not silently treated as "distinguishable".
    const oneToTwo = checks.find((check) => check.fromScore === 1 && check.toScore === 2);
    expect(oneToTwo).toEqual({ fromScore: 1, toScore: 2, averageSpendRatio: 'n/a_empty_group', distinguishable: false });
  });

  it('does not throw and reports 0 spend for an empty group', () => {
    const groups = buildCommercialGroupTable([], () => 1);
    expect(groups.find((group) => group.score === 1)?.customerCount).toBe(0);
    expect(groups.find((group) => group.score === 1)?.averageGrossMonetaryTaxIncl).toBe('0.000000');
  });
});
