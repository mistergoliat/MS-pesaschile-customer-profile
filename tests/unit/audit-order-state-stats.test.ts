import { describe, expect, it } from 'vitest';
import { computePercentileStats, isWithinTolerance } from '../../scripts/audits/order-state-semantics/lib/stats.js';

describe('computePercentileStats', () => {
  it('returns null for an empty array', () => {
    expect(computePercentileStats([])).toBeNull();
  });

  it('computes min/max/avg/median/count for a single value', () => {
    const result = computePercentileStats([7]);

    expect(result).toEqual({ count: 1, min: 7, max: 7, avg: 7, median: 7, p95: 7 });
  });

  it('computes correct stats for [1,2,3,4,5]', () => {
    const result = computePercentileStats([1, 2, 3, 4, 5]);

    expect(result?.count).toBe(5);
    expect(result?.min).toBe(1);
    expect(result?.max).toBe(5);
    expect(result?.avg).toBe(3);
    expect(result?.median).toBe(3);
    expect(result?.p95).toBeCloseTo(4.8, 5);
  });

  it('does not mutate the input array', () => {
    const input = [5, 3, 1, 4, 2];
    computePercentileStats(input);

    expect(input).toEqual([5, 3, 1, 4, 2]);
  });

  it('handles unsorted input correctly', () => {
    const result = computePercentileStats([9, 1, 5, 3, 7]);

    expect(result?.median).toBe(5);
    expect(result?.min).toBe(1);
    expect(result?.max).toBe(9);
  });
});

describe('isWithinTolerance', () => {
  it('is true when the relative difference is under the tolerance', () => {
    expect(isWithinTolerance(1, 1000, 0.01)).toBe(true); // 0.1%
  });

  it('is false when the relative difference exceeds the tolerance', () => {
    expect(isWithinTolerance(50, 1000, 0.01)).toBe(false); // 5%
  });

  it('is true exactly at the tolerance boundary', () => {
    expect(isWithinTolerance(10, 1000, 0.01)).toBe(true); // exactly 1%
  });

  it('treats baseValue = 0 as in tolerance only when the difference is also 0', () => {
    expect(isWithinTolerance(0, 0, 0.01)).toBe(true);
    expect(isWithinTolerance(5, 0, 0.01)).toBe(false);
  });

  it('uses the absolute value of the difference regardless of sign', () => {
    expect(isWithinTolerance(-1, 1000, 0.01)).toBe(true);
  });
});
