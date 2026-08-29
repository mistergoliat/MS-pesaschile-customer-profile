import { describe, expect, it } from 'vitest';
import type { PurchaseBehaviorProduct } from '../../src/domain/customer-purchase-behavior/contracts.js';
import {
  MONETARY_WEIGHT,
  RECENCY_WEIGHT,
  aggregateAffinityEvidence,
  diversityBonus,
  expandSemanticEvidence,
  monetaryWeight,
  recencyWeight,
  roundToAffinityPrecision,
  saturate,
  scoreCustomerCommercialAffinity,
  type CustomerCommercialAffinityKernelInput,
  type CustomerCommercialAffinityProductPurchase,
  type ProductSemanticFact,
} from '../../src/domain/customer-commercial-affinity/index.js';

function purchase(overrides: Partial<PurchaseBehaviorProduct> = {}): PurchaseBehaviorProduct {
  return {
    productId: 1,
    latestObservedProductName: 'Synthetic Test Product',
    latestObservedProductReference: null,
    variantCountPurchased: 1,
    repeatedVariantCount: 0,
    orderCount: 1,
    totalQuantityPurchased: 1,
    totalSpentTaxIncl: '10000.00',
    spendShare: '0.5',
    orderShare: '0.5',
    quantityShare: '0.5',
    firstPurchasedAt: '2026-01-01T00:00:00.000Z',
    lastPurchasedAt: '2026-08-01T00:00:00.000Z',
    daysSinceLastPurchase: 27,
    isRepeated: false,
    ...overrides,
  };
}

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

function pair(purchaseOverrides: Partial<PurchaseBehaviorProduct>, factOverrides: Partial<ProductSemanticFact> = {}): CustomerCommercialAffinityProductPurchase {
  const p = purchase(purchaseOverrides);
  return { purchase: p, semanticFact: fact({ productId: p.productId, ...factOverrides }) };
}

function score(input: CustomerCommercialAffinityKernelInput) {
  return scoreCustomerCommercialAffinity(input);
}

function findRow(rows: ReturnType<typeof score>, axis: string, code: string) {
  const row = rows.find((r) => r.affinityAxis === axis && r.affinityCode === code);
  if (!row) throw new Error(`No row found for ${axis}/${code}`);
  return row;
}

describe('behaviorally richer history outscores one dominant purchase (task Section 21/23)', () => {
  it('4 distinct, diversified purchases outscore 1 large concentrated purchase, via diversity -- not via now-removed frequency/repeat or monetary fragmentation', () => {
    const concentrated = score({
      customerId: 1,
      purchases: [pair({ productId: 101, spendShare: '0.8', daysSinceLastPurchase: 10 })],
    });

    const diversified = score({
      customerId: 2,
      purchases: [
        pair({ productId: 201, spendShare: '0.15', daysSinceLastPurchase: 12 }),
        pair({ productId: 202, spendShare: '0.15', daysSinceLastPurchase: 12 }),
        pair({ productId: 203, spendShare: '0.15', daysSinceLastPurchase: 12 }),
        pair({ productId: 204, spendShare: '0.15', daysSinceLastPurchase: 12 }),
      ],
    });

    const concentratedScore = findRow(concentrated, 'PRODUCT_FAMILY', 'BENCH').score;
    const diversifiedScore = findRow(diversified, 'PRODUCT_FAMILY', 'BENCH').score;

    expect(diversifiedScore).toBeGreaterThan(concentratedScore);
  });
});

describe('recency regression (task Section 23)', () => {
  it('a recent purchase scores higher than an old purchase with identical other signals', () => {
    const recent = score({ customerId: 1, purchases: [pair({ daysSinceLastPurchase: 5 })] });
    const old = score({ customerId: 1, purchases: [pair({ daysSinceLastPurchase: 900 })] });

    expect(findRow(recent, 'PRODUCT_FAMILY', 'BENCH').score).toBeGreaterThan(findRow(old, 'PRODUCT_FAMILY', 'BENCH').score);
  });
});

describe('frequency is deferred, not fabricated (task Section 5/22 CASE 1 & 2)', () => {
  it('varying orderCount alone never changes the score', () => {
    const lowOrderCount = score({ customerId: 1, purchases: [pair({ orderCount: 1 })] });
    const highOrderCount = score({ customerId: 1, purchases: [pair({ orderCount: 50 })] });

    // PurchaseBehaviorProduct.orderCount is COUNT(DISTINCT id_order) scoped to a single product
    // (confirmed against mysql-customer-product-behavior-reader.ts) -- summing it across
    // multiple products supporting the same code would overcount whenever those products were
    // bought together in one order. Rather than retain that overcounting risk, orderCount is not
    // read by the scoring formula at all in v1: this proves it structurally, not just for one
    // fixture. Exact distinct-order frequency evidence is deferred to A01.4.
    expect(findRow(highOrderCount, 'PRODUCT_FAMILY', 'BENCH').score).toBe(findRow(lowOrderCount, 'PRODUCT_FAMILY', 'BENCH').score);
  });

  it('CASE 1/2: 3 products supporting one code score identically whether framed as "one shared order" or "three distinct orders" -- the kernel has no order-line data to tell them apart and must not pretend otherwise', () => {
    const threeProducts = [1, 2, 3].map((productId) => pair({ productId, orderCount: 1, spendShare: '0.1', daysSinceLastPurchase: 15 }));

    const scenarioA = score({ customerId: 1, purchases: threeProducts });
    // No field in PurchaseBehaviorProduct can represent "these 3 products were bought across 3
    // distinct orders" differently from "bought together in 1 order" -- both scenarios are
    // necessarily represented by the same input shape, and the kernel must score them the same
    // rather than fabricate a distinction it cannot support (task Section 5).
    const scenarioB = score({ customerId: 1, purchases: threeProducts });

    expect(scenarioB).toEqual(scenarioA);
  });

  it('approximateSupportingOrderCount is still surfaced descriptively, but plays no role in the score', () => {
    const rows = score({
      customerId: 1,
      purchases: [
        pair({ productId: 1, orderCount: 2 }, { primaryProductFamily: { code: 'BENCH' } }),
        pair({ productId: 2, orderCount: 3 }, { primaryProductFamily: { code: 'BENCH' } }),
      ],
    });

    // Approximate/aggregated, not a claim of exact distinct-order uniqueness (task Section 29).
    expect(findRow(rows, 'PRODUCT_FAMILY', 'BENCH').approximateSupportingOrderCount).toBe(5);
  });
});

describe('monetary fragmentation (task Section 8/9/22 CASE 3)', () => {
  it('aggregate spend share is equal whether the same total is concentrated in 1 product or split across 4', () => {
    const oneProductItems = expandSemanticEvidence(
      purchase({ productId: 1, spendShare: '0.4', daysSinceLastPurchase: 20 }),
      fact({ productId: 1, primaryProductFamily: { code: 'BENCH' } }),
    );
    const fourProductItems = [1, 2, 3, 4].flatMap((productId) =>
      expandSemanticEvidence(
        purchase({ productId, spendShare: '0.1', daysSinceLastPurchase: 20 }),
        fact({ productId, primaryProductFamily: { code: 'BENCH' } }),
      ),
    );

    const oneAggregate = aggregateAffinityEvidence(oneProductItems)[0]!;
    const fourAggregate = aggregateAffinityEvidence(fourProductItems)[0]!;

    // Concave sqrt(a) + sqrt(b) > sqrt(a+b) would previously have let 4 fragmented purchases
    // produce more monetary evidence than 1 concentrated purchase of the same total -- summing
    // spend share BEFORE applying sqrt (once, at code level) eliminates that entirely.
    expect(fourAggregate.aggregateSpendShare).toBeCloseTo(oneAggregate.aggregateSpendShare, 9);
  });

  it('CASE 3: the only score difference between 1 and 4 equally-recent products with the same total spend share comes from the diversity bonus', () => {
    const oneProduct = score({
      customerId: 1,
      purchases: [pair({ productId: 1, spendShare: '0.4', daysSinceLastPurchase: 20 })],
    });
    const fourProducts = score({
      customerId: 1,
      purchases: [1, 2, 3, 4].map((productId) => pair({ productId, spendShare: '0.1', daysSinceLastPurchase: 20 })),
    });

    const scoreOne = findRow(oneProduct, 'PRODUCT_FAMILY', 'BENCH').score;
    const scoreFour = findRow(fourProducts, 'PRODUCT_FAMILY', 'BENCH').score;

    const recencyContribution = RECENCY_WEIGHT * recencyWeight(20);
    const monetaryContribution = MONETARY_WEIGHT * monetaryWeight(0.4);
    const expectedOne = roundToAffinityPrecision(saturate(recencyContribution + monetaryContribution + diversityBonus(1)));
    const expectedFour = roundToAffinityPrecision(saturate(recencyContribution + monetaryContribution + diversityBonus(4)));

    expect(scoreOne).toBe(expectedOne);
    expect(scoreFour).toBe(expectedFour);
    expect(scoreFour).toBeGreaterThan(scoreOne);
  });
});

describe('secondary family (task Section 12/23/24)', () => {
  it('primary family contribution exceeds secondary family contribution for a synthetic hybrid product', () => {
    const rows = score({
      customerId: 1,
      purchases: [
        pair(
          { productId: 2134, spendShare: '0.3', daysSinceLastPurchase: 10 },
          { primaryProductFamily: { code: 'PLATE_LOADED_MACHINE' }, secondaryProductFamilies: [{ code: 'CABLE_MACHINE' }] },
        ),
      ],
    });

    const primary = findRow(rows, 'PRODUCT_FAMILY', 'PLATE_LOADED_MACHINE').score;
    const secondary = findRow(rows, 'PRODUCT_FAMILY', 'CABLE_MACHINE').score;

    expect(primary).toBeGreaterThan(secondary);
    expect(secondary).toBeGreaterThan(0);
  });
});

describe('confidence ordering (task Section 13/23/25)', () => {
  it('EXPLICIT >= missing confidence >= STRONGLY_INFERRED, with a small discount only', () => {
    const explicit = score({
      customerId: 1,
      purchases: [pair({}, { primaryProductFamily: { code: 'BENCH', confidence: 'EXPLICIT' } })],
    });
    const missing = score({ customerId: 1, purchases: [pair({}, { primaryProductFamily: { code: 'BENCH' } })] });
    const inferred = score({
      customerId: 1,
      purchases: [pair({}, { primaryProductFamily: { code: 'BENCH', confidence: 'STRONGLY_INFERRED' } })],
    });

    const explicitScore = findRow(explicit, 'PRODUCT_FAMILY', 'BENCH').score;
    const missingScore = findRow(missing, 'PRODUCT_FAMILY', 'BENCH').score;
    const inferredScore = findRow(inferred, 'PRODUCT_FAMILY', 'BENCH').score;

    expect(explicitScore).toBe(missingScore);
    expect(missingScore).toBeGreaterThanOrEqual(inferredScore);
    // The discount must be small, not dominant: inferred should stay close to explicit/missing.
    expect(inferredScore).toBeGreaterThan(explicitScore * 0.7);
  });
});

describe('explicitEvidenceCoverage (task Section 11/22 CASE 4-7)', () => {
  it('CASE 4: null when no contributing fact carries confidence metadata at all -- never encoded as 1', () => {
    const rows = score({ customerId: 1, purchases: [pair({}, { primaryProductFamily: { code: 'BENCH' } })] });

    expect(findRow(rows, 'PRODUCT_FAMILY', 'BENCH').explicitEvidenceCoverage).toBeNull();
  });

  it('CASE 5: 1 when all confidence-tagged evidence is EXPLICIT', () => {
    const rows = score({
      customerId: 1,
      purchases: [pair({}, { primaryProductFamily: { code: 'BENCH', confidence: 'EXPLICIT' } })],
    });

    expect(findRow(rows, 'PRODUCT_FAMILY', 'BENCH').explicitEvidenceCoverage).toBe(1);
  });

  it('CASE 6: 0 when all confidence-tagged evidence is STRONGLY_INFERRED', () => {
    const rows = score({
      customerId: 1,
      purchases: [pair({}, { primaryProductFamily: { code: 'BENCH', confidence: 'STRONGLY_INFERRED' } })],
    });

    expect(findRow(rows, 'PRODUCT_FAMILY', 'BENCH').explicitEvidenceCoverage).toBe(0);
  });

  it('CASE 7: strictly between 0 and 1 for a genuine mix of EXPLICIT and STRONGLY_INFERRED', () => {
    const rows = score({
      customerId: 1,
      purchases: [
        pair({ productId: 1 }, { primaryProductFamily: { code: 'BENCH', confidence: 'EXPLICIT' } }),
        pair({ productId: 2 }, { primaryProductFamily: { code: 'BENCH', confidence: 'STRONGLY_INFERRED' } }),
      ],
    });

    const coverage = findRow(rows, 'PRODUCT_FAMILY', 'BENCH').explicitEvidenceCoverage;
    expect(coverage).not.toBeNull();
    expect(coverage as number).toBeGreaterThan(0);
    expect(coverage as number).toBeLessThan(1);
  });
});

describe('malformed ProductSemanticFact rejection (task Section 16/17/22 CASE 8-10)', () => {
  it('CASE 8: rejects a fact whose primary PRODUCT_FAMILY code repeats in secondaryProductFamilies', () => {
    expect(() =>
      score({
        customerId: 1,
        purchases: [pair({}, { primaryProductFamily: { code: 'BENCH' }, secondaryProductFamilies: [{ code: 'BENCH' }] })],
      }),
    ).toThrow(/secondaryProductFamilies/);
  });

  it('rejects a fact with duplicate secondary PRODUCT_FAMILY codes', () => {
    expect(() =>
      score({
        customerId: 1,
        purchases: [pair({}, { secondaryProductFamilies: [{ code: 'CABLE_MACHINE' }, { code: 'CABLE_MACHINE' }] })],
      }),
    ).toThrow(/secondaryProductFamilies/);
  });

  it('CASE 9: rejects a fact with duplicate DISCIPLINE codes', () => {
    expect(() =>
      score({
        customerId: 1,
        purchases: [pair({}, { disciplines: [{ code: 'POWERLIFTING' }, { code: 'POWERLIFTING' }] })],
      }),
    ).toThrow(/disciplines/);
  });

  it('CASE 10: rejects a fact with duplicate USE_CONTEXT codes', () => {
    expect(() =>
      score({
        customerId: 1,
        purchases: [pair({}, { useContexts: [{ code: 'HOME_GYM' }, { code: 'HOME_GYM' }] })],
      }),
    ).toThrow(/useContexts/);
  });

  it('does not validate whether a code exists in any ontology -- codes remain opaque', () => {
    expect(() =>
      score({
        customerId: 1,
        purchases: [pair({}, { primaryProductFamily: { code: 'ANY_ARBITRARY_UNKNOWN_CODE' } })],
      }),
    ).not.toThrow();
  });
});

describe('OTHER / EXCLUDED_NON_PRODUCT / NEEDS_REVIEW (task Section 23)', () => {
  it('OTHER emits no PRODUCT_FAMILY row', () => {
    const rows = score({
      customerId: 1,
      purchases: [pair({}, { classificationStatus: 'OTHER', primaryProductFamily: null })],
    });

    expect(rows.find((r) => r.affinityAxis === 'PRODUCT_FAMILY')).toBeUndefined();
  });

  it('EXCLUDED_NON_PRODUCT emits no rows on any axis', () => {
    const rows = score({
      customerId: 1,
      purchases: [
        pair(
          {},
          {
            classificationStatus: 'EXCLUDED_NON_PRODUCT',
            primaryProductFamily: null,
            disciplines: [{ code: 'POWERLIFTING' }],
            useContexts: [{ code: 'HOME_GYM' }],
          },
        ),
      ],
    });

    expect(rows).toEqual([]);
  });

  it('NEEDS_REVIEW emits no rows on any axis', () => {
    const rows = score({
      customerId: 1,
      purchases: [
        pair(
          {},
          {
            classificationStatus: 'NEEDS_REVIEW',
            disciplines: [{ code: 'POWERLIFTING' }],
            useContexts: [{ code: 'HOME_GYM' }],
          },
        ),
      ],
    });

    expect(rows).toEqual([]);
  });
});

describe('PARTIALLY_CLASSIFIED (task Section 23)', () => {
  it('produces PRODUCT_FAMILY and USE_CONTEXT evidence but no DISCIPLINE row when discipline is absent', () => {
    const rows = score({
      customerId: 1,
      purchases: [
        pair(
          {},
          {
            classificationStatus: 'PARTIALLY_CLASSIFIED',
            primaryProductFamily: { code: 'BENCH' },
            disciplines: [],
            useContexts: [{ code: 'HOME_GYM' }],
          },
        ),
      ],
    });

    expect(rows.find((r) => r.affinityAxis === 'PRODUCT_FAMILY' && r.affinityCode === 'BENCH')).toBeDefined();
    expect(rows.find((r) => r.affinityAxis === 'USE_CONTEXT' && r.affinityCode === 'HOME_GYM')).toBeDefined();
    expect(rows.find((r) => r.affinityAxis === 'DISCIPLINE')).toBeUndefined();
  });
});

describe('multi-affinity independence (task Section 23)', () => {
  it('a customer can hold strong, independent scores for multiple codes simultaneously', () => {
    const rows = score({
      customerId: 1,
      purchases: [
        pair(
          { productId: 1, spendShare: '0.3', daysSinceLastPurchase: 10 },
          { primaryProductFamily: { code: 'BENCH' }, disciplines: [{ code: 'POWERLIFTING' }], useContexts: [{ code: 'HOME_GYM' }] },
        ),
        pair(
          { productId: 2, spendShare: '0.25', daysSinceLastPurchase: 12 },
          { primaryProductFamily: { code: 'BARBELL' }, disciplines: [{ code: 'POWERLIFTING' }], useContexts: [{ code: 'HOME_GYM' }] },
        ),
      ],
    });

    const bench = findRow(rows, 'PRODUCT_FAMILY', 'BENCH').score;
    const barbell = findRow(rows, 'PRODUCT_FAMILY', 'BARBELL').score;

    // Not softmax/probability: both can be strong at once, they do not need to sum to <= 1.
    expect(bench).toBeGreaterThan(0.3);
    expect(barbell).toBeGreaterThan(0.3);
  });

  it('adding unrelated evidence for a different code never changes an existing code score', () => {
    const before = score({
      customerId: 1,
      purchases: [pair({ productId: 1, spendShare: '0.3' }, { primaryProductFamily: { code: 'BENCH' } })],
    });
    const after = score({
      customerId: 1,
      purchases: [
        pair({ productId: 1, spendShare: '0.3' }, { primaryProductFamily: { code: 'BENCH' } }),
        pair({ productId: 2, spendShare: '0.2' }, { primaryProductFamily: { code: 'BARBELL' } }),
      ],
    });

    expect(findRow(after, 'PRODUCT_FAMILY', 'BENCH').score).toBe(findRow(before, 'PRODUCT_FAMILY', 'BENCH').score);
  });
});

describe('determinism (task Section 24)', () => {
  it('produces identical output regardless of input array iteration order', () => {
    const purchases = [
      pair({ productId: 1, spendShare: '0.2' }, { primaryProductFamily: { code: 'BENCH' } }),
      pair({ productId: 2, spendShare: '0.15' }, { primaryProductFamily: { code: 'BENCH' } }),
      pair({ productId: 3, spendShare: '0.3' }, { primaryProductFamily: { code: 'BARBELL' } }),
    ];
    const shuffled = [purchases[2]!, purchases[0]!, purchases[1]!];

    const original = score({ customerId: 1, purchases });
    const reordered = score({ customerId: 1, purchases: shuffled });

    expect(reordered).toEqual(original);
  });

  it('rejects duplicate productId input rather than silently double-counting', () => {
    const duplicate = pair({ productId: 1 });
    expect(() => score({ customerId: 1, purchases: [duplicate, duplicate] })).toThrow(/Duplicate productId/);
  });
});

describe('empty input (task Section 33)', () => {
  it('returns [] when there are no purchases', () => {
    expect(score({ customerId: 1, purchases: [] })).toEqual([]);
  });

  it('returns [] when no purchase has any qualifying semantic evidence, never a zero-valued row', () => {
    const rows = score({
      customerId: 1,
      purchases: [pair({}, { classificationStatus: 'EXCLUDED_NON_PRODUCT', primaryProductFamily: null })],
    });

    expect(rows).toEqual([]);
  });
});

describe('supporting evidence aggregation', () => {
  it('sums supportingSpend as a decimal string, not a floating-point currency sum', () => {
    const rows = score({
      customerId: 1,
      purchases: [
        pair({ productId: 1, totalSpentTaxIncl: '10000.10', spendShare: '0.3' }, { primaryProductFamily: { code: 'BENCH' } }),
        pair({ productId: 2, totalSpentTaxIncl: '20000.20', spendShare: '0.2' }, { primaryProductFamily: { code: 'BENCH' } }),
      ],
    });

    const row = findRow(rows, 'PRODUCT_FAMILY', 'BENCH');
    // addDecimals (src/shared/decimal.ts, reused per task Section 14/15) formats to its
    // established 6-decimal SCALE, not 2 -- existing repo convention, not a bug.
    expect(row.supportingSpend).toBe('30000.300000');
    expect(typeof row.supportingSpend).toBe('string');
  });

  it('supportingProductCount reflects the distinct productId count contributing to the code', () => {
    const rows = score({
      customerId: 1,
      purchases: [
        pair({ productId: 1 }, { primaryProductFamily: { code: 'BENCH' } }),
        pair({ productId: 2 }, { primaryProductFamily: { code: 'BENCH' } }),
        pair({ productId: 3 }, { primaryProductFamily: { code: 'BENCH' } }),
      ],
    });

    expect(findRow(rows, 'PRODUCT_FAMILY', 'BENCH').supportingProductCount).toBe(3);
  });

  it('every row satisfies the A01.1 score bounds and the explicitEvidenceCoverage null-or-[0,1] contract', () => {
    const rows = score({
      customerId: 1,
      purchases: [
        pair(
          { productId: 1, spendShare: '0.4' },
          { primaryProductFamily: { code: 'BENCH' }, disciplines: [{ code: 'POWERLIFTING' }], useContexts: [{ code: 'HOME_GYM' }] },
        ),
      ],
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.score).toBeGreaterThanOrEqual(0);
      expect(row.score).toBeLessThanOrEqual(1);
      if (row.explicitEvidenceCoverage !== null) {
        expect(row.explicitEvidenceCoverage).toBeGreaterThanOrEqual(0);
        expect(row.explicitEvidenceCoverage).toBeLessThanOrEqual(1);
      }
    }
  });
});
