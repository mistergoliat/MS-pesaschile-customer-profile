import { describe, expect, it } from 'vitest';
import { calculateCommercialDateMetrics } from '../../src/domain/customer-commercial-summary/index.js';

const clock = { now: () => new Date('2026-07-29T12:00:00.000Z') };

describe('customer commercial summary date metrics', () => {
  it('returns null recency and frequency when there are no purchases', () => {
    expect(
      calculateCommercialDateMetrics({
        totalOrders: 0,
        firstOrderAt: null,
        lastOrderAt: null,
        clock,
      }),
    ).toEqual({
      firstOrderAt: null,
      lastOrderAt: null,
      daysSinceLastOrder: null,
      purchaseFrequencyDays: null,
    });
  });

  it('computes full UTC days since one purchase with deterministic clock', () => {
    const result = calculateCommercialDateMetrics({
      totalOrders: 1,
      firstOrderAt: new Date('2026-07-28T13:00:00.000Z'),
      lastOrderAt: new Date('2026-07-28T13:00:00.000Z'),
      clock,
    });

    expect(result.daysSinceLastOrder).toBe(0);
    expect(result.purchaseFrequencyDays).toBeNull();
  });

  it('computes purchase frequency for two and multiple purchases', () => {
    expect(
      calculateCommercialDateMetrics({
        totalOrders: 2,
        firstOrderAt: new Date('2026-07-20T00:00:00.000Z'),
        lastOrderAt: new Date('2026-07-24T00:00:00.000Z'),
        clock,
      }).purchaseFrequencyDays,
    ).toBe(4);

    expect(
      calculateCommercialDateMetrics({
        totalOrders: 4,
        firstOrderAt: new Date('2026-07-20T00:00:00.000Z'),
        lastOrderAt: new Date('2026-07-26T00:00:00.000Z'),
        clock,
      }).purchaseFrequencyDays,
    ).toBe(2);
  });

  it('allows multiple purchases at the same instant to produce zero frequency', () => {
    expect(
      calculateCommercialDateMetrics({
        totalOrders: 2,
        firstOrderAt: new Date('2026-07-20T00:00:00.000Z'),
        lastOrderAt: new Date('2026-07-20T00:00:00.000Z'),
        clock,
      }).purchaseFrequencyDays,
    ).toBe(0);
  });

  it('rejects future dates and invalid date sequences', () => {
    expect(() =>
      calculateCommercialDateMetrics({
        totalOrders: 1,
        firstOrderAt: new Date('2026-07-30T00:00:00.000Z'),
        lastOrderAt: new Date('2026-07-30T00:00:00.000Z'),
        clock,
      }),
    ).toThrow();

    expect(() =>
      calculateCommercialDateMetrics({
        totalOrders: 2,
        firstOrderAt: new Date('2026-07-24T00:00:00.000Z'),
        lastOrderAt: new Date('2026-07-20T00:00:00.000Z'),
        clock,
      }),
    ).toThrow();
  });
});
