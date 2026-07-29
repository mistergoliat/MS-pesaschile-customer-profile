import { addDecimalStrings, decimalPercentage, percentage } from './decimal.js';
import type { CountAndSpend, CoverageBreakdown, HistogramBucket, PercentileSummary } from './types.js';

export function buildCoverageBreakdown(classified: CountAndSpend, unclassified: CountAndSpend): CoverageBreakdown {
  const totals: CountAndSpend = {
    lines: classified.lines + unclassified.lines,
    units: classified.units + unclassified.units,
    spentTaxIncl: addDecimalStrings([classified.spentTaxIncl, unclassified.spentTaxIncl]),
    products: classified.products + unclassified.products,
    orders:
      classified.orders === undefined || unclassified.orders === undefined
        ? undefined
        : classified.orders + unclassified.orders,
    customers:
      classified.customers === undefined || unclassified.customers === undefined
        ? undefined
        : classified.customers + unclassified.customers,
  };

  return {
    classified,
    unclassified,
    totals,
    percentages: {
      lines: percentage(classified.lines, totals.lines),
      units: percentage(classified.units, totals.units),
      spentTaxIncl: decimalPercentage(classified.spentTaxIncl, totals.spentTaxIncl),
      products: percentage(classified.products, totals.products),
      orders: totals.orders === undefined || classified.orders === undefined ? null : percentage(classified.orders, totals.orders),
      customers:
        totals.customers === undefined || classified.customers === undefined
          ? null
          : percentage(classified.customers, totals.customers),
    },
  };
}

export function summarizeHistogram(buckets: readonly HistogramBucket[]): PercentileSummary {
  const sorted = [...buckets].sort((a, b) => a.value - b.value);
  const totalCount = sorted.reduce((total, bucket) => total + bucket.count, 0);
  if (totalCount === 0) {
    return { average: 0, median: 0, p90: 0, p95: 0, max: 0 };
  }

  const weightedSum = sorted.reduce((total, bucket) => total + bucket.value * bucket.count, 0);
  return {
    average: Math.round((weightedSum / totalCount) * 100) / 100,
    median: percentileFromHistogram(sorted, 0.5, totalCount),
    p90: percentileFromHistogram(sorted, 0.9, totalCount),
    p95: percentileFromHistogram(sorted, 0.95, totalCount),
    max: sorted.at(-1)!.value,
  };
}

function percentileFromHistogram(sortedBuckets: readonly HistogramBucket[], percentile: number, totalCount: number): number {
  const target = Math.ceil(totalCount * percentile);
  let cumulative = 0;
  for (const bucket of sortedBuckets) {
    cumulative += bucket.count;
    if (cumulative >= target) return bucket.value;
  }
  return sortedBuckets.at(-1)?.value ?? 0;
}

export function normalizePublicName(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

