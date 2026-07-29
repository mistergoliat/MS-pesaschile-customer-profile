import { describe, expect, it } from 'vitest';
import { computeAverageConsecutiveIntervalDays, computeHistoricalFrequencyDays } from '../../scripts/audits/commercial-summary/lib/frequency.js';

describe('computeHistoricalFrequencyDays (formula A)', () => {
  it('is null when totalOrders < 2 (CP-R1-T07A section 8 recommendation)', () => {
    expect(computeHistoricalFrequencyDays(new Date('2026-01-01'), new Date('2026-01-01'), 1)).toBeNull();
    expect(computeHistoricalFrequencyDays(new Date('2026-01-01'), new Date('2026-01-01'), 0)).toBeNull();
  });

  it('computes span / (totalOrders - 1) for 2 orders', () => {
    const result = computeHistoricalFrequencyDays(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-11T00:00:00Z'), 2);

    expect(result).toBe(10);
  });

  it('computes span / (totalOrders - 1) for more than 2 orders', () => {
    const result = computeHistoricalFrequencyDays(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-31T00:00:00Z'), 4);

    expect(result).toBe(10); // 30 days / 3 intervals
  });

  it('throws when lastOrderAt is before firstOrderAt', () => {
    expect(() => computeHistoricalFrequencyDays(new Date('2026-01-31'), new Date('2026-01-01'), 2)).toThrow();
  });

  it('is 0 (not null) for two purchases at the exact same date/time — same-day orders are a valid interval, not a missing one', () => {
    const sameInstant = new Date('2026-01-01T10:00:00Z');

    const result = computeHistoricalFrequencyDays(sameInstant, sameInstant, 2);

    expect(result).toBe(0);
  });
});

describe('computeAverageConsecutiveIntervalDays (formula B)', () => {
  it('is null for fewer than 2 dates', () => {
    expect(computeAverageConsecutiveIntervalDays([])).toBeNull();
    expect(computeAverageConsecutiveIntervalDays([new Date('2026-01-01')])).toBeNull();
  });

  it('throws when the input is not sorted ascending', () => {
    expect(() => computeAverageConsecutiveIntervalDays([new Date('2026-01-10'), new Date('2026-01-01')])).toThrow();
  });

  it('is 0 (not null, not an error) for two purchases at the exact same date/time', () => {
    const sameInstant = new Date('2026-01-01T10:00:00Z');

    const result = computeAverageConsecutiveIntervalDays([sameInstant, sameInstant]);

    expect(result).toBe(0);
  });
});

// CP-R1-T07A section 8 core finding: formula A and formula B are mathematically
// IDENTICAL for any single customer's own order history — never just "usually close".
// Consecutive differences telescope: sum(date[i] - date[i-1]) for i = 1..n-1 always
// equals (date[n-1] - date[0]), so mean(intervals) = span / (n-1) = formula A exactly.
// This is proven here across several irregular (non-uniform) spacings, not just a
// uniform one where equality would be unsurprising — see the runtime-recommendation
// report for why this identity drives the recommendation to use formula A at runtime.
describe('formula A vs formula B — per-customer mathematical identity', () => {
  it('are equal for exactly 2 orders (the trivial case)', () => {
    const dates = [new Date('2026-01-01T00:00:00Z'), new Date('2026-01-11T00:00:00Z')];

    const a = computeHistoricalFrequencyDays(dates[0]!, dates[1]!, dates.length);
    const b = computeAverageConsecutiveIntervalDays(dates);

    expect(b).toBe(a);
  });

  it('are equal for evenly-spaced orders', () => {
    const dates = [new Date('2026-01-01T00:00:00Z'), new Date('2026-01-11T00:00:00Z'), new Date('2026-01-21T00:00:00Z'), new Date('2026-01-31T00:00:00Z')];

    const a = computeHistoricalFrequencyDays(dates[0]!, dates[dates.length - 1]!, dates.length);
    const b = computeAverageConsecutiveIntervalDays(dates);

    expect(b).toBeCloseTo(a!, 9);
  });

  it('are equal for heavily front-loaded orders (three orders on consecutive days, then a long gap)', () => {
    const dates = [new Date('2026-01-01T00:00:00Z'), new Date('2026-01-02T00:00:00Z'), new Date('2026-01-03T00:00:00Z'), new Date('2026-01-31T00:00:00Z')];

    const a = computeHistoricalFrequencyDays(dates[0]!, dates[dates.length - 1]!, dates.length);
    const b = computeAverageConsecutiveIntervalDays(dates);

    expect(b).toBeCloseTo(a!, 9);
  });

  it('are equal for an asymmetric two-interval case (1 day, then 18 days)', () => {
    const dates = [new Date('2026-01-01T00:00:00Z'), new Date('2026-01-02T00:00:00Z'), new Date('2026-01-20T00:00:00Z')];

    const a = computeHistoricalFrequencyDays(dates[0]!, dates[dates.length - 1]!, dates.length);
    const b = computeAverageConsecutiveIntervalDays(dates);

    expect(a).toBeCloseTo(9.5, 9);
    expect(b).toBeCloseTo(9.5, 9);
  });

  it('are equal for three purchases where one consecutive gap is exactly 0 days', () => {
    const firstInstant = new Date('2026-01-01T09:00:00Z');
    const dates = [firstInstant, firstInstant, new Date('2026-01-11T09:00:00Z')]; // gaps: [0, 10]

    const a = computeHistoricalFrequencyDays(dates[0]!, dates[dates.length - 1]!, dates.length);
    const b = computeAverageConsecutiveIntervalDays(dates);

    expect(a).toBeCloseTo(5, 9); // 10 days / 2 intervals
    expect(b).toBeCloseTo(5, 9); // avg(0, 10) = 5
    expect(b).toBeCloseTo(a!, 9);
  });

  it('are equal for randomly irregular spacing (not constructed to be symmetric)', () => {
    const dates = [
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-03T00:00:00Z'),
      new Date('2026-01-04T00:00:00Z'),
      new Date('2026-01-15T00:00:00Z'),
      new Date('2026-01-16T00:00:00Z'),
      new Date('2026-03-01T00:00:00Z'),
    ];

    const a = computeHistoricalFrequencyDays(dates[0]!, dates[dates.length - 1]!, dates.length);
    const b = computeAverageConsecutiveIntervalDays(dates);

    expect(b).toBeCloseTo(a!, 9);
  });
});
