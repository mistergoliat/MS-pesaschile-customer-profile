import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addAuditDecimals, compareAuditDecimalAsc, divideAuditDecimal, formatAuditDecimal } from '../../scripts/audits/rfm-population/lib/decimal.js';
import {
  describeNumericDistribution,
  frequentFrequencyBuckets,
  monetaryOutlierSummary,
  percentileDecimal,
  scoreBucketSizes,
  scoreBucketSizesForDecimal,
  scoreTieSafe,
  scoreTieSafeDecimal,
} from '../../scripts/audits/rfm-population/lib/distribution.js';

describe('RFM population audit distribution helpers', () => {
  it('handles monetary decimals without floating point loss', () => {
    expect(formatAuditDecimal('000123.4')).toBe('123.400000');
    expect(addAuditDecimals(['9007199254740993.000000', '0.000001'])).toBe('9007199254740993.000001');
    expect(divideAuditDecimal('1', '3')).toBe('0.333333');
    expect(divideAuditDecimal('1.9999995', '1')).toBe('2.000000');
  });

  it('computes percentiles and frequent values for recency/frequency analysis', () => {
    const distribution = describeNumericDistribution([1, 1, 2, 3, 5, 10]);

    expect(distribution).toMatchObject({
      count: 6,
      min: 1,
      median: 2,
      p90: 10,
      max: 10,
      tieValueCount: 1,
    });
    expect(distribution.mostFrequentValues[0]).toEqual({ value: 1, count: 2 });
    expect(frequentFrequencyBuckets([1, 2, 3, 4, 5, 10, 11])).toEqual({
      one: 1,
      two: 1,
      three: 1,
      four: 1,
      fivePlus: 3,
      tenPlus: 2,
    });
  });

  it('preserves ties in R/F/M scoring and never splits same metric values', () => {
    const recencyScores = scoreTieSafe([0, 0, 10, 20], 'lower_value_better');
    expect(recencyScores.get(0)).toBe(5);
    expect(scoreBucketSizes([0, 0, 10, 20], recencyScores).find((bucket) => bucket.score === 5)?.count).toBe(2);

    const frequencyScores = scoreTieSafe([1, 1, 2, 5], 'higher_value_better');
    expect(frequencyScores.get(5)).toBe(5);
    expect(frequencyScores.get(1)).toBeLessThan(frequencyScores.get(2)!);

    const monetaryScores = scoreTieSafeDecimal(['10.000000', '10.000000', '99.000000'], 'higher_value_better');
    expect(monetaryScores.get('99.000000')).toBe(5);
    expect(scoreBucketSizesForDecimal(['10.000000', '10.000000', '99.000000'], monetaryScores)).toContainEqual({
      score: monetaryScores.get('10.000000'),
      count: 2,
    });
  });

  it('diagnoses monetary outliers and concentration using formatted decimal strings', () => {
    expect(monetaryOutlierSummary(['0.000000', '10.000000', '90.000000'])).toMatchObject({
      zeroCount: 1,
      max: '90.000000',
      top10Share: '0.900000',
    });
  });

  it('reports p99 alongside the existing percentile set (CP-R1-T10A section 7)', () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1); // 1..100
    const distribution = describeNumericDistribution(values);
    expect(distribution.p99).toBe(99);
    expect(distribution.p95).toBe(95);
  });

  it('computes a decimal-string median/percentile without parsing through float (section 8)', () => {
    const sorted = ['10.000000', '20.000000', '30.000000'].sort(compareAuditDecimalAsc);
    expect(percentileDecimal(sorted, 0.5)).toBe('20.000000');
    expect(percentileDecimal([], 0.5)).toBeNull();
    expect(percentileDecimal(['5.000000', '15.000000'], 0.5)).toBe('5.000000');
  });

  it('does not use parseFloat or Math.round in RFM decimal helpers', () => {
    const source = readFileSync('scripts/audits/rfm-population/lib/decimal.ts', 'utf8');

    expect(source).not.toContain('parseFloat');
    expect(source).not.toContain('Math.round');
    expect(source).not.toContain('Number(');
  });
});
