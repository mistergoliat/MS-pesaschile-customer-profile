import type { OrderCountBuckets, RecencyBuckets } from './types.js';

// CP-R1-T07A section 3: reuses T06A's percentile/tolerance helpers verbatim — see
// scripts/audits/order-state-semantics/lib/stats.ts. No second implementation.
export { computePercentileStats, isWithinTolerance } from '../../order-state-semantics/lib/stats.js';

// CP-R1-T07A section 7: buckets an already-aggregated array of per-customer order counts
// (never a customer id) into the four ranges the task asks for. Pure and total — every
// input value falls into exactly one bucket.
export function bucketOrderCounts(counts: readonly number[]): OrderCountBuckets {
  let one = 0;
  let twoToThree = 0;
  let fourToTen = 0;
  let moreThanTen = 0;

  for (const count of counts) {
    if (count <= 1) one += 1;
    else if (count <= 3) twoToThree += 1;
    else if (count <= 10) fourToTen += 1;
    else moreThanTen += 1;
  }

  return { one, twoToThree, fourToTen, moreThanTen };
}

// CP-R1-T07A section 7: buckets an already-aggregated array of per-customer
// "days since last order" (relative to the audit's execution time) into the four
// inactivity windows the task asks for. A customer inactive for 400 days counts toward
// all four thresholds (>=30, >=90, >=180, >=365) — these are cumulative "at least this
// stale" counts, not mutually exclusive bins like bucketOrderCounts above.
export function bucketRecency(daysSinceLastOrder: readonly number[]): RecencyBuckets {
  return {
    inactive30Days: daysSinceLastOrder.filter((days) => days >= 30).length,
    inactive90Days: daysSinceLastOrder.filter((days) => days >= 90).length,
    inactive180Days: daysSinceLastOrder.filter((days) => days >= 180).length,
    inactive365Days: daysSinceLastOrder.filter((days) => days >= 365).length,
  };
}
