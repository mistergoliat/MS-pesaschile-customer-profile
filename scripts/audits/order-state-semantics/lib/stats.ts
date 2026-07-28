export type PercentileStats = {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly avg: number;
  readonly median: number;
  readonly p95: number;
};

// Computes basic distribution stats (median/p95 included) entirely in application code
// from an array of already-aggregated counts (e.g. "lines per order"). This lets the
// caller fetch only COUNT(*) per group from MySQL — never a raw id_order — while still
// getting percentiles on any MySQL version, without PERCENTILE_CONT (8.0.2+ only) or
// window functions. Uses linear interpolation between closest ranks (same method as
// NumPy's default `linear` interpolation), applied to the smaller-scale distributions
// this audit deals with (order counts, not millions of raw rows).
export function computePercentileStats(values: readonly number[]): PercentileStats | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);

  return {
    count: sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    avg: sum / sorted.length,
    median: percentileOf(sorted, 0.5),
    p95: percentileOf(sorted, 0.95),
  };
}

function percentileOf(sorted: readonly number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  const weight = index - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

// Section 4 ("no asumir que serán idénticos sin revisar redondeos"): a monetary
// reconciliation is "within tolerance" if the absolute difference, as a share of the
// base value, is at or under tolerancePct. baseValue = 0 is only in tolerance when the
// difference is also exactly 0 (avoids a division by zero silently reading as "fine").
export function isWithinTolerance(differenceAbs: number, baseValue: number, tolerancePct: number): boolean {
  if (baseValue === 0) return differenceAbs === 0;
  return Math.abs(differenceAbs) / Math.abs(baseValue) <= tolerancePct;
}
