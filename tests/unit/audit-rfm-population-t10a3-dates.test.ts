import { describe, expect, it } from 'vitest';
import { subtractCalendarMonths } from '../../scripts/audits/rfm-population/lib/dates.js';

describe('CP-R1-T10A-3 calendar-month date shifting (section 12)', () => {
  it('shifts asOfDate back by whole calendar months, same day-of-month', () => {
    expect(subtractCalendarMonths('2026-07-29', 1)).toBe('2026-06-29');
    expect(subtractCalendarMonths('2026-07-29', 2)).toBe('2026-05-29');
    expect(subtractCalendarMonths('2026-07-29', 3)).toBe('2026-04-29');
  });

  it('clamps to the target month length and handles year rollover', () => {
    expect(subtractCalendarMonths('2026-03-31', 1)).toBe('2026-02-28');
    expect(subtractCalendarMonths('2026-01-15', 2)).toBe('2025-11-15');
    expect(subtractCalendarMonths('2024-03-29', 1)).toBe('2024-02-29');
  });

  it('rejects an invalid asOfDate', () => {
    expect(() => subtractCalendarMonths('2026/07/29', 1)).toThrow('Invalid asOfDate to shift');
  });
});
