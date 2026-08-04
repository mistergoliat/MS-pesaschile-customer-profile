import { describe, expect, it } from 'vitest';
import {
  buildChileCalendarDateVariant,
  buildDriftWindowVariants,
  zonedDateTimeToUtcIso,
} from '../../src/domain/customer-rfm/index.js';

describe('RFM drift window variants', () => {
  it('builds current UTC, end-inclusive and +1 day variants from an explicit UTC referenceTime', () => {
    const variants = buildDriftWindowVariants('2026-08-03T00:00:00.000Z');

    expect(variants).toEqual(
      expect.arrayContaining([
        {
          name: 'current_utc',
          windowStartInclusive: '2025-08-03T00:00:00.000Z',
          windowEndExclusive: '2026-08-03T00:00:00.000Z',
          endComparison: '<',
        },
        {
          name: 'end_inclusive',
          windowStartInclusive: '2025-08-03T00:00:00.000Z',
          windowEndExclusive: '2026-08-03T00:00:00.000Z',
          endComparison: '<=',
        },
        {
          name: 'end_plus_one_utc_day',
          windowStartInclusive: '2025-08-03T00:00:00.000Z',
          windowEndExclusive: '2026-08-04T00:00:00.000Z',
          endComparison: '<',
        },
      ]),
    );
  });

  it('converts America/Santiago midnight to UTC with winter and summer offsets', () => {
    expect(zonedDateTimeToUtcIso(2026, 8, 3, 0, 0, 0, 'America/Santiago')).toBe('2026-08-03T04:00:00.000Z');
    expect(zonedDateTimeToUtcIso(2026, 1, 3, 0, 0, 0, 'America/Santiago')).toBe('2026-01-03T03:00:00.000Z');
  });

  it('builds a Chile commercial calendar-date variant around local midnight boundaries', () => {
    const variant = buildChileCalendarDateVariant('2026-08-03T00:00:00.000Z');

    expect(variant).toMatchObject({
      name: 'chile_calendar_dates',
      windowStartInclusive: '2025-08-03T04:00:00.000Z',
      windowEndExclusive: '2026-08-03T04:00:00.000Z',
      endComparison: '<',
    });
  });
});
