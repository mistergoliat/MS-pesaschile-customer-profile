import { compareAuditDecimalAsc } from './decimal.js';

export type NumericDistribution = {
  readonly count: number;
  readonly min: number | null;
  readonly average: string | null;
  readonly median: number | null;
  readonly p10: number | null;
  readonly p20: number | null;
  readonly p25: number | null;
  readonly p40: number | null;
  readonly p50: number | null;
  readonly p60: number | null;
  readonly p75: number | null;
  readonly p80: number | null;
  readonly p90: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly max: number | null;
  readonly mostFrequentValues: readonly ValueFrequency[];
  readonly tieValueCount: number;
};

export type ValueFrequency = {
  readonly value: number;
  readonly count: number;
};

export type ScoreMethod = 'lower_value_better' | 'higher_value_better';

export type ScoreBucket = {
  readonly score: 1 | 2 | 3 | 4 | 5;
  readonly count: number;
};

export function describeNumericDistribution(values: readonly number[]): NumericDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  const histogram = buildNumericHistogram(sorted);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    average: sorted.length === 0 ? null : average(sorted),
    median: percentile(sorted, 0.5),
    p10: percentile(sorted, 0.1),
    p20: percentile(sorted, 0.2),
    p25: percentile(sorted, 0.25),
    p40: percentile(sorted, 0.4),
    p50: percentile(sorted, 0.5),
    p60: percentile(sorted, 0.6),
    p75: percentile(sorted, 0.75),
    p80: percentile(sorted, 0.8),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1) ?? null,
    mostFrequentValues: histogram.sort((a, b) => b.count - a.count || a.value - b.value).slice(0, 10),
    tieValueCount: histogram.filter((entry) => entry.count > 1).length,
  };
}

export function percentile(sortedAscending: readonly number[], fraction: number): number | null {
  if (sortedAscending.length === 0) return null;
  const bounded = Math.min(Math.max(fraction, 0), 1);
  const index = Math.ceil(bounded * sortedAscending.length) - 1;
  return sortedAscending[Math.max(index, 0)]!;
}

// Same rank-by-index approach as percentile(), but over pre-sorted audit-decimal strings
// (see ./decimal.ts) instead of numbers — used for monetary median/percentile-by-group
// (CP-R1-T10A section 7/8) without ever parsing the amount through a float.
export function percentileDecimal(sortedAscending: readonly string[], fraction: number): string | null {
  if (sortedAscending.length === 0) return null;
  const bounded = Math.min(Math.max(fraction, 0), 1);
  const index = Math.ceil(bounded * sortedAscending.length) - 1;
  return sortedAscending[Math.max(index, 0)]!;
}

export function scoreTieSafe(values: readonly number[], method: ScoreMethod): Map<number, 1 | 2 | 3 | 4 | 5> {
  const unique = Array.from(new Set(values)).sort((a, b) => a - b);
  const ordered = method === 'lower_value_better' ? unique : [...unique].reverse();
  const scores = new Map<number, 1 | 2 | 3 | 4 | 5>();
  for (const [index, value] of ordered.entries()) {
    const rankFraction = ordered.length === 1 ? 1 : 1 - index / ordered.length;
    const score = Math.max(1, Math.min(5, Math.ceil(rankFraction * 5))) as 1 | 2 | 3 | 4 | 5;
    scores.set(value, score);
  }
  return scores;
}

export function scoreTieSafeDecimal(values: readonly string[], method: ScoreMethod): Map<string, 1 | 2 | 3 | 4 | 5> {
  const unique = Array.from(new Set(values)).sort(compareAuditDecimalAsc);
  const ordered = method === 'lower_value_better' ? unique : [...unique].reverse();
  const scores = new Map<string, 1 | 2 | 3 | 4 | 5>();
  for (const [index, value] of ordered.entries()) {
    const rankFraction = ordered.length === 1 ? 1 : 1 - index / ordered.length;
    const score = Math.max(1, Math.min(5, Math.ceil(rankFraction * 5))) as 1 | 2 | 3 | 4 | 5;
    scores.set(value, score);
  }
  return scores;
}

export function scoreBucketSizes(values: readonly number[], scores: ReadonlyMap<number, 1 | 2 | 3 | 4 | 5>): readonly ScoreBucket[] {
  const buckets = new Map<1 | 2 | 3 | 4 | 5, number>([
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 0],
  ]);
  for (const value of values) {
    const score = scores.get(value);
    if (!score) throw new Error(`Missing score for value ${value}`);
    buckets.set(score, (buckets.get(score) ?? 0) + 1);
  }
  return Array.from(buckets.entries()).map(([score, count]) => ({ score, count }));
}

export function scoreBucketSizesForDecimal(
  values: readonly string[],
  scores: ReadonlyMap<string, 1 | 2 | 3 | 4 | 5>,
): readonly ScoreBucket[] {
  const buckets = new Map<1 | 2 | 3 | 4 | 5, number>([
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 0],
  ]);
  for (const value of values) {
    const score = scores.get(value);
    if (!score) throw new Error(`Missing score for decimal value ${value}`);
    buckets.set(score, (buckets.get(score) ?? 0) + 1);
  }
  return Array.from(buckets.entries()).map(([score, count]) => ({ score, count }));
}

export function frequentFrequencyBuckets(values: readonly number[]): Record<'one' | 'two' | 'three' | 'four' | 'fivePlus' | 'tenPlus', number> {
  return {
    one: values.filter((value) => value === 1).length,
    two: values.filter((value) => value === 2).length,
    three: values.filter((value) => value === 3).length,
    four: values.filter((value) => value === 4).length,
    fivePlus: values.filter((value) => value >= 5).length,
    tenPlus: values.filter((value) => value >= 10).length,
  };
}

export function monetaryOutlierSummary(values: readonly string[]): {
  readonly zeroCount: number;
  readonly max: string | null;
  readonly top1Share: string;
  readonly top5Share: string;
  readonly top10Share: string;
} {
  const sorted = [...values].sort((a, b) => compareAuditDecimalAsc(b, a));
  const total = sorted.reduce((sum, value) => sum + BigInt(value.replace('.', '')), 0n);
  const share = (count: number): string => {
    if (total === 0n) return '0.000000';
    const selected = sorted.slice(0, Math.ceil(sorted.length * count)).reduce((sum, value) => sum + BigInt(value.replace('.', '')), 0n);
    const scaled = (selected * 1_000_000n + total / 2n) / total;
    const raw = scaled.toString().padStart(7, '0');
    return `${raw.slice(0, -6)}.${raw.slice(-6)}`;
  };
  return {
    zeroCount: values.filter((value) => /^0(?:\.0+)?$/.test(value)).length,
    max: sorted[0] ?? null,
    top1Share: share(0.01),
    top5Share: share(0.05),
    top10Share: share(0.1),
  };
}

function buildNumericHistogram(sorted: readonly number[]): ValueFrequency[] {
  const counts = new Map<number, number>();
  for (const value of sorted) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries()).map(([value, count]) => ({ value, count }));
}

function average(values: readonly number[]): string {
  const sum = values.reduce((total, value) => total + value, 0);
  return (sum / values.length).toFixed(6);
}
