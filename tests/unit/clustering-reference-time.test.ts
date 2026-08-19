import { describe, expect, it } from 'vitest';
import { daysBetween, floorDaysBetween, resolveReferenceTime, windowStart365dInclusive } from '../../scripts/clustering/lib/reference-time.js';

describe('resolveReferenceTime', () => {
  it('defaults to the current time when unset', () => {
    const before = Date.now();
    const resolved = resolveReferenceTime(undefined);
    const after = Date.now();
    const resolvedMs = new Date(resolved).getTime();
    expect(resolvedMs).toBeGreaterThanOrEqual(before);
    expect(resolvedMs).toBeLessThanOrEqual(after);
  });

  it('accepts an explicit UTC ISO timestamp and normalizes it', () => {
    expect(resolveReferenceTime('2026-08-19T00:00:00Z')).toBe('2026-08-19T00:00:00.000Z');
  });

  it('rejects a non-UTC or malformed timestamp rather than silently coercing it', () => {
    expect(() => resolveReferenceTime('2026-08-19')).toThrow();
    expect(() => resolveReferenceTime('not-a-date')).toThrow();
  });
});

describe('windowStart365dInclusive', () => {
  it('is exactly 365 days before referenceTime', () => {
    const start = windowStart365dInclusive('2026-08-19T00:00:00.000Z');
    expect(start).toBe('2025-08-19T00:00:00.000Z');
  });
});

describe('daysBetween / floorDaysBetween', () => {
  it('computes fractional day differences', () => {
    expect(daysBetween('2026-01-01T00:00:00.000Z', '2026-01-02T12:00:00.000Z')).toBeCloseTo(1.5, 10);
  });

  it('throws when the later date precedes the earlier date (never silently negative)', () => {
    expect(() => daysBetween('2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toThrow();
  });

  it('floors the day count', () => {
    expect(floorDaysBetween('2026-01-01T00:00:00.000Z', '2026-01-02T23:00:00.000Z')).toBe(1);
  });
});
