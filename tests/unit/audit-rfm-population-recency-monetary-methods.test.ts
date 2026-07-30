import { describe, expect, it } from 'vitest';
import { calibrateFrozenRecencyBoundaries, classifyByFrozenRecencyBoundaries } from '../../scripts/audits/rfm-population/lib/recency-methods.js';
import { calibrateFrozenMonetaryBoundaries, classifyByFrozenMonetaryBoundaries } from '../../scripts/audits/rfm-population/lib/monetary-methods.js';

describe('CP-R1-T10A-3 R-Frozen boundaries (section 8)', () => {
  it('calibrates boundaries from a distribution and never moves once fixed', () => {
    const boundaries = calibrateFrozenRecencyBoundaries({ p20: 10, p40: 30, p60: 60, p80: 120 });
    expect(boundaries).toEqual([10, 30, 60, 120]);
  });

  it('classifies lower recencyDays as a higher score, using fixed cut points', () => {
    const boundaries = calibrateFrozenRecencyBoundaries({ p20: 10, p40: 30, p60: 60, p80: 120 });
    expect(classifyByFrozenRecencyBoundaries(5, boundaries)).toBe(5);
    expect(classifyByFrozenRecencyBoundaries(10, boundaries)).toBe(5);
    expect(classifyByFrozenRecencyBoundaries(31, boundaries)).toBe(3);
    expect(classifyByFrozenRecencyBoundaries(500, boundaries)).toBe(1);
  });

  it('falls back to 0 for missing percentiles (empty distribution)', () => {
    const boundaries = calibrateFrozenRecencyBoundaries({ p20: null, p40: null, p60: null, p80: null });
    expect(boundaries).toEqual([0, 0, 0, 0]);
  });
});

describe('CP-R1-T10A-3 M-Frozen boundaries (section 10)', () => {
  it('calibrates decimal-string boundaries from a pre-sorted array without float parsing', () => {
    const sorted = ['10.000000', '20.000000', '30.000000', '40.000000', '50.000000'];
    const boundaries = calibrateFrozenMonetaryBoundaries(sorted);
    expect(boundaries).toEqual(['10.000000', '20.000000', '30.000000', '40.000000']);
  });

  it('classifies higher spend as a higher score, using fixed cut points', () => {
    const sorted = ['10.000000', '20.000000', '30.000000', '40.000000', '50.000000'];
    const boundaries = calibrateFrozenMonetaryBoundaries(sorted);
    expect(classifyByFrozenMonetaryBoundaries('50.000000', boundaries)).toBe(5);
    expect(classifyByFrozenMonetaryBoundaries('40.000000', boundaries)).toBe(5);
    expect(classifyByFrozenMonetaryBoundaries('25.000000', boundaries)).toBe(3);
    expect(classifyByFrozenMonetaryBoundaries('1.000000', boundaries)).toBe(1);
  });

  it('handles an empty sorted array', () => {
    expect(calibrateFrozenMonetaryBoundaries([])).toEqual(['0.000000', '0.000000', '0.000000', '0.000000']);
  });
});
