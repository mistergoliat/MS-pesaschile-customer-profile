import { describe, expect, it } from 'vitest';
import {
  assertValidAffinityScore,
  assertValidCoverage,
  assertValidCoveragePercentage,
  assertValidDecimalString,
  isValidAffinityScore,
  isValidCoveragePercentage,
  type CustomerCommercialAffinityCoverage,
} from '../../src/domain/customer-commercial-affinity/index.js';

function baseCoverage(overrides: Partial<CustomerCommercialAffinityCoverage> = {}): CustomerCommercialAffinityCoverage {
  return {
    customersEvaluated: 100,
    customersWithAffinity: 80,
    purchaseLinesEvaluated: 1000,
    purchaseLinesWithSemanticProduct: 900,
    semanticPurchaseCoverage: 90,
    semanticSpendCoverage: 88.5,
    classifiedOrderCoverage: 75,
    productFamilyCoverage: 70,
    disciplineCoverage: 12,
    useContextCoverage: 20,
    ...overrides,
  };
}

describe('affinity score bounds', () => {
  it('accepts 0 and 1 as the inclusive bounds', () => {
    expect(isValidAffinityScore(0)).toBe(true);
    expect(isValidAffinityScore(1)).toBe(true);
    expect(() => assertValidAffinityScore(0)).not.toThrow();
    expect(() => assertValidAffinityScore(1)).not.toThrow();
  });

  it('rejects negative values', () => {
    expect(isValidAffinityScore(-0.0001)).toBe(false);
    expect(() => assertValidAffinityScore(-1)).toThrow(/\[0,1\]/);
  });

  it('rejects values above 1', () => {
    expect(isValidAffinityScore(1.0001)).toBe(false);
    expect(() => assertValidAffinityScore(1.5)).toThrow(/\[0,1\]/);
  });

  it('rejects NaN', () => {
    expect(isValidAffinityScore(NaN)).toBe(false);
    expect(() => assertValidAffinityScore(NaN)).toThrow();
  });

  it('rejects +Infinity and -Infinity', () => {
    expect(isValidAffinityScore(Infinity)).toBe(false);
    expect(isValidAffinityScore(-Infinity)).toBe(false);
    expect(() => assertValidAffinityScore(Infinity)).toThrow();
    expect(() => assertValidAffinityScore(-Infinity)).toThrow();
  });
});

describe('coverage percentage bounds', () => {
  it('accepts 0 and 100 as the inclusive bounds', () => {
    expect(isValidCoveragePercentage(0)).toBe(true);
    expect(isValidCoveragePercentage(100)).toBe(true);
  });

  it('rejects an invalid percentage rather than silently normalizing it', () => {
    expect(isValidCoveragePercentage(-1)).toBe(false);
    expect(isValidCoveragePercentage(101)).toBe(false);
    expect(isValidCoveragePercentage(NaN)).toBe(false);
    expect(() => assertValidCoveragePercentage(101)).toThrow(/\[0,100\]/);
  });
});

describe('assertValidCoverage — composite invariants', () => {
  it('accepts a well-formed coverage summary', () => {
    expect(() => assertValidCoverage(baseCoverage())).not.toThrow();
  });

  it('rejects customersWithAffinity exceeding customersEvaluated', () => {
    expect(() => assertValidCoverage(baseCoverage({ customersWithAffinity: 101, customersEvaluated: 100 }))).toThrow(
      /customersWithAffinity/,
    );
  });

  it('rejects purchaseLinesWithSemanticProduct exceeding purchaseLinesEvaluated', () => {
    expect(() =>
      assertValidCoverage(baseCoverage({ purchaseLinesWithSemanticProduct: 1001, purchaseLinesEvaluated: 1000 })),
    ).toThrow(/purchaseLinesWithSemanticProduct/);
  });

  it('rejects a negative populationSize-style count', () => {
    expect(() => assertValidCoverage(baseCoverage({ customersEvaluated: -1 }))).toThrow();
  });
});

describe('decimal string validation (supportingSpend / excludedNonProductSpend)', () => {
  it('accepts a plain non-negative decimal string', () => {
    expect(() => assertValidDecimalString('145000.00', 'supportingSpend')).not.toThrow();
    expect(() => assertValidDecimalString('0', 'supportingSpend')).not.toThrow();
  });

  it('rejects a JS-float-style or malformed value', () => {
    expect(() => assertValidDecimalString('-1', 'supportingSpend')).toThrow();
    expect(() => assertValidDecimalString('1e5', 'supportingSpend')).toThrow();
    expect(() => assertValidDecimalString('abc', 'supportingSpend')).toThrow();
  });
});
