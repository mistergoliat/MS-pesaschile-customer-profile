import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_COMMERCIAL_AFFINITY_AXES,
  CUSTOMER_COMMERCIAL_AFFINITY_IDENTITY_AUTHORITY,
  type CustomerCommercialAffinityAxis,
  type CustomerCommercialAffinityRow,
  type ProductSemanticFact,
  type ProductSemanticFactTag,
} from '../../src/domain/customer-commercial-affinity/index.js';

function baseFact(overrides: Partial<ProductSemanticFact> = {}): ProductSemanticFact {
  return {
    productId: 2134,
    ontologyVersion: 'commercial-product-ontology-v3',
    ontologyHash: 'f2de79fb',
    classificationStatus: 'CLASSIFIED',
    primaryProductFamily: { code: 'PLATE_LOADED_MACHINE' },
    secondaryProductFamilies: [],
    disciplines: [],
    useContexts: [],
    ...overrides,
  };
}

describe('ProductSemanticFact — consumer contract', () => {
  it('accepts arbitrary opaque tag codes not enumerated anywhere in this repository', () => {
    const arbitraryCode = 'ARBITRARY_CODE_NOT_IN_ANY_KNOWN_ONTOLOGY_LIST';
    const tag: ProductSemanticFactTag = { code: arbitraryCode };
    const fact = baseFact({ primaryProductFamily: tag });

    expect(fact.primaryProductFamily?.code).toBe(arbitraryCode);
  });

  it('does not expose a public tag registry: the only closed vocabulary is the 3-axis set', () => {
    // The axis vocabulary crosses the service boundary and is legitimately closed (task
    // Section 5). Individual tag codes are not — this is the only enumerated list this module
    // ships, and it must stay at exactly 3 entries.
    expect(CUSTOMER_COMMERCIAL_AFFINITY_AXES).toEqual(['PRODUCT_FAMILY', 'DISCIPLINE', 'USE_CONTEXT']);
    expect(CUSTOMER_COMMERCIAL_AFFINITY_AXES).toHaveLength(3);
  });

  it('supports optional/missing confidence without breaking the contract', () => {
    const tagWithoutConfidence: ProductSemanticFactTag = { code: 'CABLE_MACHINE' };
    const tagWithConfidence: ProductSemanticFactTag = { code: 'CABLE_MACHINE', confidence: 'EXPLICIT' };

    expect(tagWithoutConfidence.confidence).toBeUndefined();
    expect(tagWithConfidence.confidence).toBe('EXPLICIT');
  });

  it('carries classificationStatus as a closed 5-value union used consistently across facts', () => {
    const statuses: ProductSemanticFact['classificationStatus'][] = [
      'CLASSIFIED',
      'PARTIALLY_CLASSIFIED',
      'OTHER',
      'EXCLUDED_NON_PRODUCT',
      'NEEDS_REVIEW',
    ];

    for (const classificationStatus of statuses) {
      expect(baseFact({ classificationStatus }).classificationStatus).toBe(classificationStatus);
    }
  });
});

describe('CustomerCommercialAffinityRow — normalized shape', () => {
  it('carries opaque productId-free evidence: no raw product name field exists on the row', () => {
    const row: CustomerCommercialAffinityRow = {
      customerId: 123,
      affinityAxis: 'PRODUCT_FAMILY' satisfies CustomerCommercialAffinityAxis,
      affinityCode: 'BENCH',
      score: 0.72,
      approximateSupportingOrderCount: 4,
      supportingProductCount: 3,
      supportingSpend: '145000.00',
      lastEvidenceAt: '2026-08-01T00:00:00.000Z',
      explicitEvidenceCoverage: 0.5,
    };

    expect(Object.keys(row)).not.toContain('productName');
    expect(Object.keys(row)).not.toContain('ruleId');
    expect(Object.keys(row)).not.toContain('evidence');
    expect(typeof row.supportingSpend).toBe('string');
  });
});

describe('identity authority', () => {
  it('is prestashop_customer, not masterCustomerId-based', () => {
    expect(CUSTOMER_COMMERCIAL_AFFINITY_IDENTITY_AUTHORITY).toBe('prestashop_customer');
  });
});
