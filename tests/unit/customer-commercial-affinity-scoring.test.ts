import { describe, expect, it } from 'vitest';
import type { PurchaseBehaviorProduct } from '../../src/domain/customer-purchase-behavior/contracts.js';
import {
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

describe('spend dominance regression (task Section 21)', () => {
  it('multiple lower-value repeated purchases outscore one very expensive single machine purchase', () => {
    const customerA = score({
      customerId: 1,
      purchases: [
        pair({
          productId: 101,
          orderCount: 1,
          isRepeated: false,
          spendShare: '1.0',
          totalSpentTaxIncl: '2000000.00',
          daysSinceLastPurchase: 10,
        }),
      ],
    });

    const customerB = score({
      customerId: 2,
      purchases: [
        pair({ productId: 201, orderCount: 3, isRepeated: true, spendShare: '0.15', totalSpentTaxIncl: '45000.00', daysSinceLastPurchase: 15 }),
        pair({ productId: 202, orderCount: 2, isRepeated: true, spendShare: '0.12', totalSpentTaxIncl: '38000.00', daysSinceLastPurchase: 25 }),
        pair({ productId: 203, orderCount: 4, isRepeated: true, spendShare: '0.18', totalSpentTaxIncl: '52000.00', daysSinceLastPurchase: 5 }),
      ],
    });

    const scoreA = findRow(customerA, 'PRODUCT_FAMILY', 'BENCH').score;
    const scoreB = findRow(customerB, 'PRODUCT_FAMILY', 'BENCH').score;

    expect(scoreB).toBeGreaterThan(scoreA);
  });
});

describe('recency regression (task Section 22)', () => {
  it('a recent purchase scores higher than an old purchase with identical other signals', () => {
    const recent = score({ customerId: 1, purchases: [pair({ daysSinceLastPurchase: 5 })] });
    const old = score({ customerId: 1, purchases: [pair({ daysSinceLastPurchase: 900 })] });

    expect(findRow(recent, 'PRODUCT_FAMILY', 'BENCH').score).toBeGreaterThan(findRow(old, 'PRODUCT_FAMILY', 'BENCH').score);
  });
});

describe('frequency regression (task Section 23)', () => {
  it('5 qualifying orders score higher than 1, but not linearly 5x', () => {
    const oneOrder = score({ customerId: 1, purchases: [pair({ orderCount: 1 })] });
    const fiveOrders = score({ customerId: 1, purchases: [pair({ orderCount: 5 })] });

    const scoreOne = findRow(oneOrder, 'PRODUCT_FAMILY', 'BENCH').score;
    const scoreFive = findRow(fiveOrders, 'PRODUCT_FAMILY', 'BENCH').score;

    expect(scoreFive).toBeGreaterThan(scoreOne);
    expect(scoreFive).toBeLessThan(scoreOne * 5);
  });
});

describe('secondary family (task Section 24)', () => {
  it('primary family contribution exceeds secondary family contribution for a synthetic hybrid product', () => {
    const rows = score({
      customerId: 1,
      purchases: [
        pair(
          { productId: 2134, orderCount: 3, spendShare: '0.3', isRepeated: true },
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

describe('confidence ordering (task Section 25)', () => {
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

describe('OTHER / EXCLUDED_NON_PRODUCT / NEEDS_REVIEW (task Section 26)', () => {
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

describe('PARTIALLY_CLASSIFIED (task Section 27)', () => {
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

describe('multi-affinity independence (task Section 28)', () => {
  it('a customer can hold strong, independent scores for multiple codes simultaneously', () => {
    const rows = score({
      customerId: 1,
      purchases: [
        pair(
          { productId: 1, orderCount: 4, isRepeated: true, spendShare: '0.3', daysSinceLastPurchase: 10 },
          { primaryProductFamily: { code: 'BENCH' }, disciplines: [{ code: 'POWERLIFTING' }], useContexts: [{ code: 'HOME_GYM' }] },
        ),
        pair(
          { productId: 2, orderCount: 3, isRepeated: true, spendShare: '0.25', daysSinceLastPurchase: 12 },
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
      purchases: [pair({ productId: 1, orderCount: 3, spendShare: '0.3' }, { primaryProductFamily: { code: 'BENCH' } })],
    });
    const after = score({
      customerId: 1,
      purchases: [
        pair({ productId: 1, orderCount: 3, spendShare: '0.3' }, { primaryProductFamily: { code: 'BENCH' } }),
        pair({ productId: 2, orderCount: 2, spendShare: '0.2' }, { primaryProductFamily: { code: 'BARBELL' } }),
      ],
    });

    expect(findRow(after, 'PRODUCT_FAMILY', 'BENCH').score).toBe(findRow(before, 'PRODUCT_FAMILY', 'BENCH').score);
  });
});

describe('determinism (task Section 32)', () => {
  it('produces identical output regardless of input array iteration order', () => {
    const purchases = [
      pair({ productId: 1, orderCount: 2, spendShare: '0.2' }, { primaryProductFamily: { code: 'BENCH' } }),
      pair({ productId: 2, orderCount: 3, spendShare: '0.15' }, { primaryProductFamily: { code: 'BENCH' } }),
      pair({ productId: 3, orderCount: 1, spendShare: '0.3' }, { primaryProductFamily: { code: 'BARBELL' } }),
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
    // addRfmDecimals (reused from customer-rfm/decimal.ts, task Section 30) formats to its
    // established 6-decimal SCALE, not 2 -- this is the existing repo convention, not a bug.
    expect(row.supportingSpend).toBe('30000.300000');
    expect(typeof row.supportingSpend).toBe('string');
  });

  it('supportingOrderCount is an aggregated sum across distinct contributing products (documented upper-bound approximation, task Section 29)', () => {
    const rows = score({
      customerId: 1,
      purchases: [
        pair({ productId: 1, orderCount: 2 }, { primaryProductFamily: { code: 'BENCH' } }),
        pair({ productId: 2, orderCount: 3 }, { primaryProductFamily: { code: 'BENCH' } }),
      ],
    });

    // Approximate/aggregated, not a claim of exact distinct-order uniqueness -- see scoring.ts.
    expect(findRow(rows, 'PRODUCT_FAMILY', 'BENCH').supportingOrderCount).toBe(5);
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

  it('every row satisfies the A01.1 score/evidenceCoverage bounds', () => {
    const rows = score({
      customerId: 1,
      purchases: [
        pair(
          { productId: 1, orderCount: 3, spendShare: '0.4', isRepeated: true },
          { primaryProductFamily: { code: 'BENCH' }, disciplines: [{ code: 'POWERLIFTING' }], useContexts: [{ code: 'HOME_GYM' }] },
        ),
      ],
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.score).toBeGreaterThanOrEqual(0);
      expect(row.score).toBeLessThanOrEqual(1);
      expect(row.evidenceCoverage).toBeGreaterThanOrEqual(0);
      expect(row.evidenceCoverage).toBeLessThanOrEqual(1);
    }
  });
});
