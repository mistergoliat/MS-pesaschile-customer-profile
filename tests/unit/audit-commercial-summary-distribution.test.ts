import { describe, expect, it } from 'vitest';
import { bucketOrderCounts, bucketRecency, computePercentileStats } from '../../scripts/audits/commercial-summary/lib/distribution.js';

describe('computePercentileStats re-export', () => {
  it('resolves to the same T06A implementation and computes correctly', () => {
    const result = computePercentileStats([1, 2, 3, 4, 5]);

    expect(result).toMatchObject({ count: 5, min: 1, max: 5, avg: 3, median: 3 });
  });

  it('returns null for an empty array', () => {
    expect(computePercentileStats([])).toBeNull();
  });
});

describe('bucketOrderCounts', () => {
  it('buckets 1 order as "one"', () => {
    expect(bucketOrderCounts([1])).toEqual({ one: 1, twoToThree: 0, fourToTen: 0, moreThanTen: 0 });
  });

  it('buckets 2 and 3 orders as "twoToThree"', () => {
    expect(bucketOrderCounts([2, 3])).toEqual({ one: 0, twoToThree: 2, fourToTen: 0, moreThanTen: 0 });
  });

  it('buckets 4 and 10 orders as "fourToTen" (inclusive boundaries)', () => {
    expect(bucketOrderCounts([4, 10])).toEqual({ one: 0, twoToThree: 0, fourToTen: 2, moreThanTen: 0 });
  });

  it('buckets 11+ orders as "moreThanTen"', () => {
    expect(bucketOrderCounts([11, 500])).toEqual({ one: 0, twoToThree: 0, fourToTen: 0, moreThanTen: 2 });
  });

  it('every input value falls into exactly one bucket (totals match)', () => {
    const counts = [1, 1, 2, 3, 4, 10, 11, 50];
    const buckets = bucketOrderCounts(counts);

    expect(buckets.one + buckets.twoToThree + buckets.fourToTen + buckets.moreThanTen).toBe(counts.length);
  });

  it('returns all-zero buckets for an empty input', () => {
    expect(bucketOrderCounts([])).toEqual({ one: 0, twoToThree: 0, fourToTen: 0, moreThanTen: 0 });
  });
});

describe('bucketRecency', () => {
  it('counts a customer inactive 400 days toward every threshold (cumulative, not exclusive bins)', () => {
    const result = bucketRecency([400]);

    expect(result).toEqual({ inactive30Days: 1, inactive90Days: 1, inactive180Days: 1, inactive365Days: 1 });
  });

  it('counts a customer inactive 45 days toward only the 30-day threshold', () => {
    const result = bucketRecency([45]);

    expect(result).toEqual({ inactive30Days: 1, inactive90Days: 0, inactive180Days: 0, inactive365Days: 0 });
  });

  it('does not count a customer inactive fewer than 30 days toward any threshold', () => {
    const result = bucketRecency([5]);

    expect(result).toEqual({ inactive30Days: 0, inactive90Days: 0, inactive180Days: 0, inactive365Days: 0 });
  });

  it('is inclusive at each exact threshold boundary', () => {
    expect(bucketRecency([30]).inactive30Days).toBe(1);
    expect(bucketRecency([90]).inactive90Days).toBe(1);
    expect(bucketRecency([180]).inactive180Days).toBe(1);
    expect(bucketRecency([365]).inactive365Days).toBe(1);
  });
});
