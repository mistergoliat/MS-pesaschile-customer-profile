import { describe, expect, it } from 'vitest';
import {
  buildCustomerCommercialAffinityPopulation,
  type CustomerCommercialAffinityPopulationInput,
} from '../../src/application/customer-commercial-affinity-population/population-builder.js';
import type { CustomerAffinityPurchaseEvidence } from '../../src/application/customer-commercial-affinity-population/ports.js';
import type { ProductSemanticFact } from '../../src/domain/customer-commercial-affinity/index.js';

const referenceTime = '2026-09-01T00:00:00.000Z';

function fact(productId: number, overrides: Partial<ProductSemanticFact> = {}): ProductSemanticFact {
  return {
    productId,
    ontologyVersion: 'commercial-product-ontology-v3',
    ontologyHash: 'f'.repeat(64),
    classificationStatus: 'CLASSIFIED',
    primaryProductFamily: { code: 'HOME_GYM', confidence: 'EXPLICIT' },
    secondaryProductFamilies: [],
    disciplines: [],
    useContexts: [],
    ...overrides,
  };
}

function line(overrides: Partial<CustomerAffinityPurchaseEvidence> = {}): CustomerAffinityPurchaseEvidence {
  return {
    customerId: 10,
    orderId: 100,
    orderDetailId: 1,
    orderCreatedAt: '2026-08-01T00:00:00.000Z',
    productId: 1,
    lineRevenueTaxIncl: '100.10',
    ...overrides,
  };
}

function input(purchases: readonly CustomerAffinityPurchaseEvidence[], facts: readonly ProductSemanticFact[]): CustomerCommercialAffinityPopulationInput {
  return {
    referenceTime,
    purchases,
    semanticSnapshot: {
      metadata: {
        snapshotId: `sha256:${'a'.repeat(64)}`,
        schemaVersion: '1',
        ontologyVersion: 'commercial-product-ontology-v3',
        ontologyHash: 'f'.repeat(64),
        classifierVersion: 'product-semantic-classifier-v1',
        sourceSemanticChecksum: 'b'.repeat(64),
        consumerNormalizedChecksum: 'c'.repeat(64),
      },
      facts,
    },
  };
}

function findRow(result: ReturnType<typeof buildCustomerCommercialAffinityPopulation>, code = 'HOME_GYM') {
  return result.rows.find((row) => row.affinityAxis === 'PRODUCT_FAMILY' && row.affinityCode === code)!;
}

describe('Customer Commercial Affinity A01.4 population builder', () => {
  it('counts two same-code products in one order once, while counting both products and line spend', () => {
    const result = buildCustomerCommercialAffinityPopulation(input([
      line({ productId: 1, orderDetailId: 1, lineRevenueTaxIncl: '100.10' }),
      line({ productId: 2, orderDetailId: 2, lineRevenueTaxIncl: '200.20' }),
    ], [fact(1), fact(2)]));

    expect(findRow(result).supportingOrderCount).toBe(1);
    expect(findRow(result).supportingProductCount).toBe(2);
    expect(findRow(result).supportingSpend).toBe('300.300000');
  });

  it('counts the same product across two orders as two orders and one product', () => {
    const result = buildCustomerCommercialAffinityPopulation(input([
      line({ orderId: 100, orderDetailId: 1, orderCreatedAt: '2026-07-01T00:00:00.000Z' }),
      line({ orderId: 101, orderDetailId: 2, orderCreatedAt: '2026-08-01T00:00:00.000Z', lineRevenueTaxIncl: '200.20' }),
    ], [fact(1)]));

    expect(findRow(result).supportingOrderCount).toBe(2);
    expect(findRow(result).supportingProductCount).toBe(1);
    expect(findRow(result).lastEvidenceAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('does not duplicate support when one product has multiple lines in an order', () => {
    const result = buildCustomerCommercialAffinityPopulation(input([
      line({ orderDetailId: 1, lineRevenueTaxIncl: '10.01' }),
      line({ orderDetailId: 2, lineRevenueTaxIncl: '20.02' }),
    ], [fact(1)]));

    expect(findRow(result).supportingOrderCount).toBe(1);
    expect(findRow(result).supportingProductCount).toBe(1);
    expect(findRow(result).supportingSpend).toBe('30.030000');
  });

  it('excludes the reference-time boundary and future orders deterministically', () => {
    const result = buildCustomerCommercialAffinityPopulation(input([
      line({ orderId: 1, orderCreatedAt: '2026-08-31T23:59:59.999Z' }),
      line({ orderId: 2, orderDetailId: 2, orderCreatedAt: referenceTime }),
      line({ orderId: 3, orderDetailId: 3, orderCreatedAt: '2026-09-02T00:00:00.000Z' }),
    ], [fact(1)]));

    expect(result.manifest.eligibleOrderCount).toBe(1);
    expect(findRow(result).supportingOrderCount).toBe(1);
  });

  it('keeps unknown products out of affinity rows and reports their coverage', () => {
    const result = buildCustomerCommercialAffinityPopulation(input([
      line({ productId: 999, lineRevenueTaxIncl: '50.05' }),
    ], []));

    expect(result.rows).toEqual([]);
    expect(result.manifest.customersWithoutSemanticEvidence).toBe(1);
    expect(result.manifest.purchasedProductsWithoutSemanticFact).toBe(1);
    expect(result.manifest.unknownProducts[0]).toMatchObject({ productId: 999, orderLineCount: 1, spend: '50.050000' });
  });

  it('preserves OTHER discipline and use-context evidence but never creates PRODUCT_FAMILY/OTHER', () => {
    const result = buildCustomerCommercialAffinityPopulation(input([
      line(),
    ], [fact(1, {
      classificationStatus: 'OTHER',
      primaryProductFamily: null,
      disciplines: [{ code: 'POWERLIFTING', confidence: 'EXPLICIT' }],
      useContexts: [{ code: 'COMMERCIAL_GYM', confidence: 'STRONGLY_INFERRED' }],
    })]));

    expect(result.rows.map((row) => `${row.affinityAxis}:${row.affinityCode}`)).toEqual([
      'DISCIPLINE:POWERLIFTING',
      'USE_CONTEXT:COMMERCIAL_GYM',
    ]);
    expect(result.rows.find((row) => row.affinityCode === 'OTHER')).toBeUndefined();
  });

  it('reports explicit, mixed and inferred confidence coverage without changing the scorer formula', () => {
    const result = buildCustomerCommercialAffinityPopulation(input([
      line({ productId: 1, orderDetailId: 1 }),
      line({ productId: 2, orderDetailId: 2, lineRevenueTaxIncl: '100.10' }),
    ], [
      fact(1, { primaryProductFamily: { code: 'HOME_GYM', confidence: 'EXPLICIT' } }),
      fact(2, { primaryProductFamily: { code: 'HOME_GYM', confidence: 'STRONGLY_INFERRED' } }),
    ]));

    expect(findRow(result).explicitEvidenceCoverage).toBeGreaterThan(0);
    expect(findRow(result).explicitEvidenceCoverage).toBeLessThan(1);
  });

  it('is invariant to purchase and semantic fact order', () => {
    const purchases = [line({ productId: 1, orderDetailId: 1 }), line({ productId: 2, orderDetailId: 2 })];
    const facts = [fact(1), fact(2)];
    const first = buildCustomerCommercialAffinityPopulation(input(purchases, facts));
    const second = buildCustomerCommercialAffinityPopulation(input([...purchases].reverse(), [...facts].reverse()));
    expect(second).toEqual(first);
  });

  it('never emits the retired approximateSupportingOrderCount field', () => {
    const result = buildCustomerCommercialAffinityPopulation(input([line()], [fact(1)]));
    expect(Object.keys(findRow(result))).not.toContain('approximateSupportingOrderCount');
    expect(Object.keys(findRow(result))).toContain('supportingOrderCount');
  });
});
