import { describe, expect, it } from 'vitest';
import {
  buildFrequencyModelGroups,
  classifyFrequencyModelA,
  classifyFrequencyModelB,
  classifyFrequencyModelD,
  FREQUENCY_MODEL_DEFINITIONS,
  modelCClassifier,
  type FrequencyModelRow,
} from '../../scripts/audits/rfm-population/lib/frequency-models.js';

describe('CP-R1-T10A frequency threshold simulation (section 6)', () => {
  it('classifies Model A thresholds (1/2/3/4-5/6+)', () => {
    expect(classifyFrequencyModelA(1)).toBe(1);
    expect(classifyFrequencyModelA(2)).toBe(2);
    expect(classifyFrequencyModelA(3)).toBe(3);
    expect(classifyFrequencyModelA(4)).toBe(4);
    expect(classifyFrequencyModelA(5)).toBe(4);
    expect(classifyFrequencyModelA(6)).toBe(5);
    expect(classifyFrequencyModelA(2080)).toBe(5);
  });

  it('classifies Model B thresholds (1/2/3-4/5-9/10+)', () => {
    expect(classifyFrequencyModelB(1)).toBe(1);
    expect(classifyFrequencyModelB(2)).toBe(2);
    expect(classifyFrequencyModelB(3)).toBe(3);
    expect(classifyFrequencyModelB(4)).toBe(3);
    expect(classifyFrequencyModelB(5)).toBe(4);
    expect(classifyFrequencyModelB(9)).toBe(4);
    expect(classifyFrequencyModelB(10)).toBe(5);
  });

  it('classifies Model C via tie-safe rank over distinct observed values, never NTILE', () => {
    const rows: FrequencyModelRow[] = [
      { frequencyOrders: 1, grossMonetaryTaxIncl: '10.000000', recencyDays: 5 },
      { frequencyOrders: 1, grossMonetaryTaxIncl: '10.000000', recencyDays: 5 },
      { frequencyOrders: 2, grossMonetaryTaxIncl: '20.000000', recencyDays: 5 },
      { frequencyOrders: 5, grossMonetaryTaxIncl: '50.000000', recencyDays: 5 },
    ];
    const classify = modelCClassifier(rows);
    expect(classify(5)).toBe(5);
    expect(classify(1)).toBeLessThan(classify(2));
    expect(() => classify(999)).toThrow('Missing Model C score');
  });

  it('builds per-score group tables with count/percent/spend/recency for every score 1-5', () => {
    const rows: FrequencyModelRow[] = [
      { frequencyOrders: 1, grossMonetaryTaxIncl: '10.000000', recencyDays: 100 },
      { frequencyOrders: 1, grossMonetaryTaxIncl: '10.000000', recencyDays: 200 },
      { frequencyOrders: 10, grossMonetaryTaxIncl: '990.000000', recencyDays: 1 },
    ];
    const groups = buildFrequencyModelGroups(rows, classifyFrequencyModelB);
    expect(groups).toHaveLength(5);
    const score1 = groups.find((group) => group.score === 1)!;
    const score5 = groups.find((group) => group.score === 5)!;
    expect(score1.customerCount).toBe(2);
    expect(score1.grossMonetaryTaxIncl).toBe('20.000000');
    expect(score5.customerCount).toBe(1);
    expect(score5.grossMonetaryTaxIncl).toBe('990.000000');
    expect(score5.percentOfActiveSpend).toBe('0.980198');
    const emptyScore = groups.find((group) => group.score === 3)!;
    expect(emptyScore.customerCount).toBe(0);
    expect(emptyScore.averageRecencyDays).toBeNull();
  });

  it('classifies Model D thresholds (1/2/3/4-6/7+) — CP-R1-T10A-3 section 9', () => {
    expect(classifyFrequencyModelD(1)).toBe(1);
    expect(classifyFrequencyModelD(2)).toBe(2);
    expect(classifyFrequencyModelD(3)).toBe(3);
    expect(classifyFrequencyModelD(4)).toBe(4);
    expect(classifyFrequencyModelD(6)).toBe(4);
    expect(classifyFrequencyModelD(7)).toBe(5);
    expect(classifyFrequencyModelD(2080)).toBe(5);
  });

  it('exposes Model D and Model E definitions for the CP-R1-T10A-3 final comparison', () => {
    expect(FREQUENCY_MODEL_DEFINITIONS.D).toEqual({ F1: '1', F2: '2', F3: '3', F4: '4-6', F5: '7+' });
    expect(FREQUENCY_MODEL_DEFINITIONS.E.note).toContain('same method as Model C');
  });

  it('Model E reuses modelCClassifier over whatever population it is given (CP-R1-T10A-3\'s shop-1 commercial population)', () => {
    const shop1Rows: FrequencyModelRow[] = [
      { frequencyOrders: 1, grossMonetaryTaxIncl: '10.000000', recencyDays: 5 },
      { frequencyOrders: 3, grossMonetaryTaxIncl: '30.000000', recencyDays: 5 },
      { frequencyOrders: 8, grossMonetaryTaxIncl: '80.000000', recencyDays: 5 },
    ];
    const modelE = modelCClassifier(shop1Rows);
    expect(modelE(8)).toBe(5);
    expect(modelE(1)).toBeLessThan(modelE(3));
  });

  it('handles an empty active population without dividing by zero', () => {
    expect(() => buildFrequencyModelGroups([], classifyFrequencyModelA)).not.toThrow();
    const groups = buildFrequencyModelGroups([], classifyFrequencyModelA);
    expect(groups.every((group) => group.customerCount === 0)).toBe(true);
  });
});
