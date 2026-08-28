import { describe, expect, it } from 'vitest';
import {
  isDisciplineEligible,
  isProductFamilyEligible,
  isUseContextEligible,
  type ProductSemanticFact,
} from '../../src/domain/customer-commercial-affinity/index.js';

function fact(overrides: Partial<ProductSemanticFact> = {}): ProductSemanticFact {
  return {
    productId: 2134,
    ontologyVersion: 'commercial-product-ontology-v3',
    ontologyHash: 'f2de79fb',
    classificationStatus: 'CLASSIFIED',
    primaryProductFamily: { code: 'BENCH' },
    secondaryProductFamilies: [],
    disciplines: [{ code: 'POWERLIFTING' }],
    useContexts: [{ code: 'HOME_GYM' }],
    ...overrides,
  };
}

describe('classification status eligibility policy', () => {
  it('EXCLUDED_NON_PRODUCT is never eligible on any axis', () => {
    const row = fact({ classificationStatus: 'EXCLUDED_NON_PRODUCT' });

    expect(isProductFamilyEligible(row)).toBe(false);
    expect(isDisciplineEligible(row)).toBe(false);
    expect(isUseContextEligible(row)).toBe(false);
  });

  it('NEEDS_REVIEW is never eligible on any axis until resolved', () => {
    const row = fact({ classificationStatus: 'NEEDS_REVIEW' });

    expect(isProductFamilyEligible(row)).toBe(false);
    expect(isDisciplineEligible(row)).toBe(false);
    expect(isUseContextEligible(row)).toBe(false);
  });

  it('PARTIALLY_CLASSIFIED retains eligibility on whichever axes actually carry evidence', () => {
    const familyOnly = fact({
      classificationStatus: 'PARTIALLY_CLASSIFIED',
      primaryProductFamily: { code: 'BENCH' },
      disciplines: [],
      useContexts: [],
    });

    expect(isProductFamilyEligible(familyOnly)).toBe(true);
    expect(isDisciplineEligible(familyOnly)).toBe(false);
    expect(isUseContextEligible(familyOnly)).toBe(false);
  });

  it('CLASSIFIED is eligible on every axis that has evidence present', () => {
    const row = fact({ classificationStatus: 'CLASSIFIED' });

    expect(isProductFamilyEligible(row)).toBe(true);
    expect(isDisciplineEligible(row)).toBe(true);
    expect(isUseContextEligible(row)).toBe(true);
  });

  it('OTHER PRODUCT_FAMILY never contributes, decided without any positiveAffinitySignal-style field', () => {
    const viaStatus = fact({ classificationStatus: 'OTHER', primaryProductFamily: null });
    const viaCode = fact({ classificationStatus: 'CLASSIFIED', primaryProductFamily: { code: 'OTHER' } });

    expect(isProductFamilyEligible(viaStatus)).toBe(false);
    expect(isProductFamilyEligible(viaCode)).toBe(false);
  });

  it('a null primaryProductFamily is never eligible, regardless of status', () => {
    expect(isProductFamilyEligible(fact({ primaryProductFamily: null }))).toBe(false);
  });
});

describe('missing evidence never produces a synthetic row (missing is not negative)', () => {
  it('empty disciplines/useContexts make the axis ineligible rather than defaulting to a zero-score row', () => {
    const noSparseEvidence = fact({ disciplines: [], useContexts: [] });

    // No downstream builder exists yet in this slice (task Section 23) — this proves the
    // structural gate a future row-builder must respect: with no discipline/useContext
    // evidence, the eligibility check itself refuses the axis. A row-builder that only ever
    // emits rows for eligible axes can therefore never fabricate a default/zero row for a
    // customer who simply has no evidence yet (design doc Section 10).
    expect(isDisciplineEligible(noSparseEvidence)).toBe(false);
    expect(isUseContextEligible(noSparseEvidence)).toBe(false);
    // PRODUCT_FAMILY evidence is independent and still present, proving sparsity on one axis
    // never suppresses eligibility on another.
    expect(isProductFamilyEligible(noSparseEvidence)).toBe(true);
  });
});
