import { describe, expect, it } from 'vitest';
import {
  divideDecimalMoneyByInteger,
  formatDecimalMoney,
} from '../../src/domain/customer-commercial-summary/index.js';

describe('customer commercial summary money utilities', () => {
  it('formats zero with six decimals', () => {
    expect(formatDecimalMoney('0')).toBe('0.000000');
    expect(divideDecimalMoneyByInteger('0.000000', 0)).toBe('0.000000');
  });

  it('divides exact decimal money values without using floating point', () => {
    expect(divideDecimalMoneyByInteger('12.000000', 3)).toBe('4.000000');
  });

  it('rounds division half-up to six decimals', () => {
    expect(divideDecimalMoneyByInteger('1.000000', 3)).toBe('0.333333');
    expect(divideDecimalMoneyByInteger('10.000000', 3)).toBe('3.333333');
    expect(divideDecimalMoneyByInteger('1.000000', 6)).toBe('0.166667');
  });

  it('preserves large totals beyond Number.MAX_SAFE_INTEGER as decimal text', () => {
    expect(formatDecimalMoney('9007199254740993.123456')).toBe('9007199254740993.123456');
    expect(divideDecimalMoneyByInteger('9007199254740993.123456', 3)).toBe('3002399751580331.041152');
  });

  it('pads and rounds to exactly six decimals', () => {
    expect(formatDecimalMoney('142177.1')).toBe('142177.100000');
    expect(formatDecimalMoney('142177.1212314')).toBe('142177.121231');
    expect(formatDecimalMoney('142177.1212315')).toBe('142177.121232');
    expect(formatDecimalMoney('0.9999995')).toBe('1.000000');
    expect(formatDecimalMoney('000012.340000')).toBe('12.340000');
  });

  it('rejects invalid or negative decimal inputs', () => {
    expect(() => formatDecimalMoney('-1.00')).toThrow();
    expect(() => formatDecimalMoney('1,00')).toThrow();
  });
});
