import { describe, expect, it } from 'vitest';
import { detectCurrencyMix, formatDecimalString } from '../../scripts/audits/commercial-summary/lib/monetary.js';

describe('formatDecimalString', () => {
  it('returns a zero string with the requested precision for null', () => {
    expect(formatDecimalString(null)).toBe('0.000000');
    expect(formatDecimalString(null, 2)).toBe('0.00');
  });

  it('preserves a string decimal value exactly, padding to the requested precision', () => {
    expect(formatDecimalString('123.4', 6)).toBe('123.400000');
  });

  it('truncates extra fractional digits instead of rounding', () => {
    expect(formatDecimalString('1.123456789', 6)).toBe('1.123456');
  });

  it('preserves precision for a value beyond Number.MAX_SAFE_INTEGER (string path never uses parseFloat)', () => {
    expect(formatDecimalString('123456789012345678.500000', 6)).toBe('123456789012345678.500000');
  });

  it('handles a negative string value, keeping the sign', () => {
    expect(formatDecimalString('-42.5', 2)).toBe('-42.50');
  });

  it('does not produce a "-0.00" for a negative-signed zero', () => {
    expect(formatDecimalString('-0.00', 2)).toBe('0.00');
  });

  it('handles a whole number string with no decimal point', () => {
    expect(formatDecimalString('100', 2)).toBe('100.00');
  });

  it('accepts a plain JS number defensively, using toFixed', () => {
    expect(formatDecimalString(19.999, 2)).toBe('20.00');
  });

  it('throws for a non-finite number', () => {
    expect(() => formatDecimalString(Number.NaN)).toThrow();
    expect(() => formatDecimalString(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('handles an empty string as zero', () => {
    expect(formatDecimalString('   ', 2)).toBe('0.00');
  });
});

describe('detectCurrencyMix', () => {
  it('is single-currency and empty for no rows', () => {
    const result = detectCurrencyMix([]);

    expect(result.isSingleCurrency).toBe(true);
    expect(result.dominantIsoCode).toBeNull();
    expect(result.currencies).toEqual([]);
  });

  it('is single-currency for exactly one row', () => {
    const result = detectCurrencyMix([{ idCurrency: 1, isoCode: 'CLP', orderCount: 80000 }]);

    expect(result.isSingleCurrency).toBe(true);
    expect(result.dominantIsoCode).toBe('CLP');
    expect(result.dominantCurrencyId).toBe(1);
  });

  it('is not single-currency for more than one row, and picks the highest orderCount as dominant', () => {
    const result = detectCurrencyMix([
      { idCurrency: 2, isoCode: 'USD', orderCount: 3 },
      { idCurrency: 1, isoCode: 'CLP', orderCount: 79997 },
    ]);

    expect(result.isSingleCurrency).toBe(false);
    expect(result.dominantIsoCode).toBe('CLP');
    expect(result.currencies[0]).toEqual({ idCurrency: 1, isoCode: 'CLP', orderCount: 79997 });
  });

  it('does not mutate the input array order', () => {
    const input = [
      { idCurrency: 2, isoCode: 'USD', orderCount: 1 },
      { idCurrency: 1, isoCode: 'CLP', orderCount: 100 },
    ];
    detectCurrencyMix(input);

    expect(input[0]?.idCurrency).toBe(2);
  });
});
