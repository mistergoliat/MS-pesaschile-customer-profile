import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addBehaviorDecimals,
  divideDecimalToBehaviorDecimal,
  divideIntegerToBehaviorDecimal,
  effectiveDiversityFromHhi,
  squareBehaviorShare,
  sumBehaviorShares,
} from '../../src/application/customer-purchase-behavior/behavior-decimal.js';

describe('purchase behavior decimal math', () => {
  it('handles zero denominators and 1/3 with half-up rounding', () => {
    expect(divideIntegerToBehaviorDecimal(0, 0)).toBe('0.000000');
    expect(divideIntegerToBehaviorDecimal(1, 3)).toBe('0.333333');
    expect(divideDecimalToBehaviorDecimal('2.000000', '3.000000')).toBe('0.666667');
  });

  it('adds money strings and supports values above Number.MAX_SAFE_INTEGER', () => {
    expect(addBehaviorDecimals(['9007199254740993.000000', '0.000001'])).toBe('9007199254740993.000001');
  });

  it('squares decimal shares and derives effective diversity', () => {
    expect(squareBehaviorShare('1.000000')).toBe('1.000000');
    expect(sumBehaviorShares([squareBehaviorShare('0.500000'), squareBehaviorShare('0.500000')])).toBe('0.500000');
    expect(sumBehaviorShares(Array.from({ length: 10 }, () => squareBehaviorShare('0.100000')))).toBe('0.100000');
    expect(effectiveDiversityFromHhi('0.500000')).toBe('2.000000');
    expect(effectiveDiversityFromHhi('0.000000')).toBe('0.000000');
  });

  it('computes top shares with fewer than three elements through decimal addition', () => {
    expect(sumBehaviorShares(['0.600000', '0.400000'])).toBe('1.000000');
  });

  it('does not use floating point helpers in critical behavior decimal calculations', () => {
    const source = readFileSync('src/application/customer-purchase-behavior/behavior-decimal.ts', 'utf8');

    expect(source).not.toContain('parseFloat');
    expect(source).not.toContain('Math.round');
    expect(source).not.toContain('Number(');
  });
});

