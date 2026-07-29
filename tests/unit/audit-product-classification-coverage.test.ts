import { describe, expect, it } from 'vitest';
import { buildCoverageBreakdown, normalizePublicName, summarizeHistogram } from '../../scripts/audits/product-classification/lib/coverage.js';
import {
  addDecimalStrings,
  decimalPercentage,
  formatScaledDecimal,
  parseNonNegativeDecimalToScaled,
} from '../../scripts/audits/product-classification/lib/decimal.js';

describe('product classification audit decimal helpers', () => {
  it('formats non-negative decimal strings with six decimals without using JS money floats', () => {
    expect(formatScaledDecimal(parseNonNegativeDecimalToScaled('000123.4'))).toBe('123.400000');
    expect(addDecimalStrings(['9007199254740993.123456', '0.000001'])).toBe('9007199254740993.123457');
  });

  it('rejects invalid or negative monetary input', () => {
    expect(() => parseNonNegativeDecimalToScaled('-1.00')).toThrow();
    expect(() => parseNonNegativeDecimalToScaled('not-money')).toThrow();
    expect(() => parseNonNegativeDecimalToScaled(Number.NaN)).toThrow();
  });

  it('computes rounded percentages from decimal strings', () => {
    expect(decimalPercentage('1.000000', '3.000000')).toBe(33.33);
    expect(decimalPercentage('2.000000', '3.000000')).toBe(66.67);
  });
});

describe('product classification audit coverage helpers', () => {
  it('computes coverage by lines, units, spend, products, orders and customers', () => {
    const result = buildCoverageBreakdown(
      { lines: 8, units: 20, spentTaxIncl: '80.000000', products: 4, orders: 7, customers: 6 },
      { lines: 2, units: 5, spentTaxIncl: '20.000000', products: 1, orders: 3, customers: 2 },
    );

    expect(result.totals).toEqual({
      lines: 10,
      units: 25,
      spentTaxIncl: '100.000000',
      products: 5,
      orders: 10,
      customers: 8,
    });
    expect(result.percentages).toEqual({
      lines: 80,
      units: 80,
      spentTaxIncl: 80,
      products: 80,
      orders: 70,
      customers: 75,
    });
  });

  it('handles zero denominators without NaN or Infinity', () => {
    const result = buildCoverageBreakdown(
      { lines: 0, units: 0, spentTaxIncl: '0.000000', products: 0 },
      { lines: 0, units: 0, spentTaxIncl: '0.000000', products: 0 },
    );

    expect(result.percentages.lines).toBe(0);
    expect(result.percentages.spentTaxIncl).toBe(0);
    expect(result.percentages.orders).toBeNull();
  });
});

describe('product classification audit multicategory helpers', () => {
  it('computes average, median, p90, p95 and max from a product category-count histogram', () => {
    const result = summarizeHistogram([
      { value: 0, count: 1 },
      { value: 1, count: 3 },
      { value: 2, count: 4 },
      { value: 5, count: 2 },
    ]);

    expect(result).toEqual({ average: 2.1, median: 2, p90: 5, p95: 5, max: 5 });
  });

  it('normalizes public names for duplicate manufacturer/category detection', () => {
    expect(normalizePublicName('  Márca   Demo  ')).toBe('marca demo');
  });
});

