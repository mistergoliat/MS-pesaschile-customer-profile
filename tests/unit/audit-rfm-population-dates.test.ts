import { describe, expect, it } from 'vitest';
import { buildRfmWindow, parseAsOfDate, recencyDays } from '../../scripts/audits/rfm-population/lib/dates.js';
import { classifyEligibility, classifyLifecycle } from '../../scripts/audits/rfm-population/lib/lifecycle.js';

describe('RFM population audit date and lifecycle rules', () => {
  it('requires an explicit valid ISO RFM_AS_OF_DATE', () => {
    expect(parseAsOfDate({})).toEqual({ ok: false, reason: 'missing' });
    expect(parseAsOfDate({ RFM_AS_OF_DATE: '' })).toEqual({ ok: false, reason: 'missing' });
    expect(parseAsOfDate({ RFM_AS_OF_DATE: '2026/07/29' })).toEqual({ ok: false, reason: 'invalid_format' });
    expect(parseAsOfDate({ RFM_AS_OF_DATE: '2026-02-30' })).toEqual({ ok: false, reason: 'invalid_date' });
    expect(parseAsOfDate({ RFM_AS_OF_DATE: '2026-07-29' })).toMatchObject({ ok: true, asOfDate: '2026-07-29' });
  });

  it('builds the 12-month inclusive/exclusive UTC window reproducibly', () => {
    expect(buildRfmWindow('2026-07-29')).toEqual({
      asOfDate: '2026-07-29',
      timezone: 'UTC',
      windowStartInclusive: '2025-07-29',
      windowEndExclusive: '2026-07-30',
    });
    expect(buildRfmWindow('2024-02-29').windowStartInclusive).toBe('2023-02-28');
  });

  it('computes complete-day recency and rejects future orders', () => {
    expect(recencyDays('2026-07-29', '2026-07-29 23:59:59')).toBe(0);
    expect(recencyDays('2026-07-29', '2026-07-20 00:00:00')).toBe(9);
    expect(() => recencyDays('2026-07-29', '2026-07-30 00:00:00')).toThrow('after asOfDate');
  });

  it('classifies active, inactive and no-purchase populations and keeps lifecycle separate', () => {
    expect(classifyEligibility(10, 1)).toBe('active');
    expect(classifyEligibility(10, 0)).toBe('historical_inactive');
    expect(classifyEligibility(0, 0)).toBe('no_valid_purchases');

    expect(
      classifyLifecycle({
        eligibilityStatus: 'active',
        firstValidOrderAt: '2026-07-01 00:00:00',
        lifetimeValidOrderCount: 1,
        asOfDate: '2026-07-29',
      }),
    ).toBe('new_customer');
    expect(
      classifyLifecycle({
        eligibilityStatus: 'historical_inactive',
        firstValidOrderAt: '2020-01-01 00:00:00',
        lifetimeValidOrderCount: 3,
        asOfDate: '2026-07-29',
      }),
    ).toBe('historical_inactive');
  });
});
