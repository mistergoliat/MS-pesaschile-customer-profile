const MS_PER_DAY = 1000 * 60 * 60 * 24;

// CP-R1-T07A section 8, formula A: (lastOrderAt - firstOrderAt) / (totalOrders - 1).
// null when totalOrders < 2 — a single purchase has no interval to measure, and the
// formula divides by zero at exactly totalOrders = 1. Never returns a negative number
// (that would mean lastOrderAt < firstOrderAt, a caller data-ordering bug, not a valid
// frequency) — surfaced as a thrown error rather than a silently wrong metric.
export function computeHistoricalFrequencyDays(firstOrderAt: Date, lastOrderAt: Date, totalOrders: number): number | null {
  if (totalOrders < 2) return null;
  const spanMs = lastOrderAt.getTime() - firstOrderAt.getTime();
  if (spanMs < 0) {
    throw new Error('lastOrderAt must not be before firstOrderAt');
  }
  return spanMs / MS_PER_DAY / (totalOrders - 1);
}

// CP-R1-T07A section 8, formula B: average of the real gaps between consecutive orders
// (order N vs order N-1), not just the endpoints. Dates must already be sorted ascending
// by the caller — this function does not sort, so callers stay in control of tie-breaking
// (e.g. same-day orders) rather than this function silently picking an order.
//
// IMPORTANT finding (see tests + the runtime-recommendation report): for any single
// customer's own order history, formula B is mathematically IDENTICAL to formula A. The
// consecutive differences telescope — sum(date[i] - date[i-1]) for i=1..n-1 always equals
// (date[n-1] - date[0]) — so mean(intervals) = span / (n-1), which is exactly formula A.
// They can only diverge when aggregated differently across a population (e.g. averaging
// per-customer means vs. one global span/count ratio), never for one customer in
// isolation. This is why the runtime recommendation favors formula A: same number,
// O(1) from two dates already being fetched, no window function required.
export function computeAverageConsecutiveIntervalDays(orderDatesAscending: readonly Date[]): number | null {
  if (orderDatesAscending.length < 2) return null;

  const intervalsDays: number[] = [];
  for (let i = 1; i < orderDatesAscending.length; i += 1) {
    const diffMs = orderDatesAscending[i]!.getTime() - orderDatesAscending[i - 1]!.getTime();
    if (diffMs < 0) {
      throw new Error('orderDatesAscending must be sorted ascending');
    }
    intervalsDays.push(diffMs / MS_PER_DAY);
  }

  const sum = intervalsDays.reduce((total, value) => total + value, 0);
  return sum / intervalsDays.length;
}
