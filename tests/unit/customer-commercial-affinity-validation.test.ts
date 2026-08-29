import { describe, expect, it } from 'vitest';
import {
  assertValidAffinityScore,
  assertValidCoverage,
  assertValidCoveragePercentage,
  assertValidDecimalString,
  assertValidProductSemanticFact,
  isValidAffinityScore,
  isValidCoveragePercentage,
  type CustomerCommercialAffinityCoverage,
  type ProductSemanticFact,
} from '../../src/domain/customer-commercial-affinity/index.js';

function fact(overrides: Partial<ProductSemanticFact> = {}): ProductSemanticFact {
  return {
    productId: 1,
    ontologyVersion: 'commercial-product-ontology-v3',
    ontologyHash: 'f2de79fb',
    classificationStatus: 'CLASSIFIED',
    primaryProductFamily: { code: 'BENCH' },
    secondaryProductFamilies: [],
    disciplines: [],
    useContexts: [],
    ...overrides,
  };
}

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

describe('assertValidProductSemanticFact — transport invariants (A01.2.1 hardening)', () => {
  it('accepts a well-formed fact', () => {
    expect(() => assertValidProductSemanticFact(fact())).not.toThrow();
  });

  it('rejects a non-positive or non-integer productId', () => {
    expect(() => assertValidProductSemanticFact(fact({ productId: 0 }))).toThrow(/productId/);
    expect(() => assertValidProductSemanticFact(fact({ productId: -1 }))).toThrow(/productId/);
    expect(() => assertValidProductSemanticFact(fact({ productId: 1.5 }))).toThrow(/productId/);
  });

  it('rejects an empty ontologyVersion or ontologyHash', () => {
    expect(() => assertValidProductSemanticFact(fact({ ontologyVersion: '' }))).toThrow(/ontologyVersion/);
    expect(() => assertValidProductSemanticFact(fact({ ontologyHash: '   ' }))).toThrow(/ontologyHash/);
  });

  it('rejects an empty tag code', () => {
    expect(() => assertValidProductSemanticFact(fact({ primaryProductFamily: { code: '' } }))).toThrow();
    expect(() => assertValidProductSemanticFact(fact({ disciplines: [{ code: '' }] }))).toThrow();
  });

  it('rejects a primary PRODUCT_FAMILY code that repeats in secondaryProductFamilies', () => {
    expect(() =>
      assertValidProductSemanticFact(
        fact({ primaryProductFamily: { code: 'BENCH' }, secondaryProductFamilies: [{ code: 'BENCH' }] }),
      ),
    ).toThrow(/secondaryProductFamilies/);
  });

  it('rejects duplicate codes within secondaryProductFamilies', () => {
    expect(() =>
      assertValidProductSemanticFact(fact({ secondaryProductFamilies: [{ code: 'CABLE_MACHINE' }, { code: 'CABLE_MACHINE' }] })),
    ).toThrow(/secondaryProductFamilies/);
  });

  it('rejects duplicate codes within disciplines', () => {
    expect(() =>
      assertValidProductSemanticFact(fact({ disciplines: [{ code: 'POWERLIFTING' }, { code: 'POWERLIFTING' }] })),
    ).toThrow(/disciplines/);
  });

  it('rejects duplicate codes within useContexts', () => {
    expect(() =>
      assertValidProductSemanticFact(fact({ useContexts: [{ code: 'HOME_GYM' }, { code: 'HOME_GYM' }] })),
    ).toThrow(/useContexts/);
  });

  it('does not validate whether a code exists in any ontology -- codes are opaque and unconstrained beyond non-emptiness/uniqueness', () => {
    expect(() => assertValidProductSemanticFact(fact({ primaryProductFamily: { code: 'TOTALLY_UNKNOWN_CODE_123' } }))).not.toThrow();
  });

  it('allows a null primaryProductFamily with a non-empty secondaryProductFamilies (no primary to collide with)', () => {
    expect(() =>
      assertValidProductSemanticFact(fact({ primaryProductFamily: null, secondaryProductFamilies: [{ code: 'CABLE_MACHINE' }] })),
    ).not.toThrow();
  });
});
