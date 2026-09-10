import { describe, expect, it } from 'vitest';
import {
  buildCustomerCommercialAffinityPopulation,
  type CustomerCommercialAffinityPopulationInput,
} from '../../src/application/customer-commercial-affinity-population/population-builder.js';
import { calculateEligibleCustomerPopulationChecksum } from '../../src/application/customer-commercial-affinity-population/eligible-population-checksum.js';
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
    productQuantity: 1,
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

  it('aggregates purchased units across repeated lines, repeated orders, and same-code products', () => {
    const result = buildCustomerCommercialAffinityPopulation(input([
      line({ productId: 1, orderId: 100, orderDetailId: 1, productQuantity: 2 }),
      line({ productId: 1, orderId: 100, orderDetailId: 2, productQuantity: 3 }),
      line({ productId: 1, orderId: 101, orderDetailId: 3, productQuantity: 4 }),
      line({ productId: 2, orderId: 100, orderDetailId: 4, productQuantity: 5 }),
    ], [fact(1), fact(2)]));

    expect(findRow(result).supportingUnits).toBe(14);
    expect(findRow(result).supportingOrderCount).toBe(2);
    expect(findRow(result).supportingProductCount).toBe(2);
  });

  it('keeps score and row membership invariant when only product quantities change', () => {
    const purchases = [line({ productId: 1, orderDetailId: 1 }), line({ productId: 2, orderDetailId: 2, lineRevenueTaxIncl: '200.20' })];
    const facts = [fact(1), fact(2)];
    const baseline = buildCustomerCommercialAffinityPopulation(input(purchases, facts));
    const changed = buildCustomerCommercialAffinityPopulation(input([
      ...purchases.map((purchase, index) => ({ ...purchase, productQuantity: index === 0 ? 7 : 11 })),
    ], facts));
    const baselineRow = findRow(baseline);
    const changedRow = findRow(changed);

    expect(changed.rows.map((row) => `${row.affinityAxis}:${row.affinityCode}`)).toEqual(baseline.rows.map((row) => `${row.affinityAxis}:${row.affinityCode}`));
    expect(changedRow.score).toBe(baselineRow.score);
    expect(changedRow.supportingOrderCount).toBe(baselineRow.supportingOrderCount);
    expect(changedRow.supportingProductCount).toBe(baselineRow.supportingProductCount);
    expect(changedRow.supportingSpend).toBe(baselineRow.supportingSpend);
    expect(changedRow.lastEvidenceAt).toBe(baselineRow.lastEvidenceAt);
    expect(changedRow.explicitEvidenceCoverage).toBe(baselineRow.explicitEvidenceCoverage);
    expect(changedRow.supportingUnits).not.toBe(baselineRow.supportingUnits);
    expect(changed.eligibleCustomerIds).toEqual(baseline.eligibleCustomerIds);
    expect(changed.rows).toHaveLength(baseline.rows.length);
    expect(changed.manifest.eligibleCustomerCount).toBe(baseline.manifest.eligibleCustomerCount);
    expect(changed.manifest.datasetChecksum).not.toBe(baseline.manifest.datasetChecksum);
    expect(changed.manifest.affinityDatasetChecksum).not.toBe(baseline.manifest.affinityDatasetChecksum);
  });

  it('applies quantity only to mapped axes and excludes non-product classifications', () => {
    const result = buildCustomerCommercialAffinityPopulation(input([
      line({ customerId: 10, productId: 1, productQuantity: 4 }),
      line({ customerId: 11, productId: 2, productQuantity: 9 }),
    ], [
      fact(1, { classificationStatus: 'PARTIALLY_CLASSIFIED', primaryProductFamily: null, disciplines: [{ code: 'POWERLIFTING' }], useContexts: [] }),
      fact(2, { classificationStatus: 'EXCLUDED_NON_PRODUCT', primaryProductFamily: null }),
    ]));

    expect(result.rows).toMatchObject([{ affinityAxis: 'DISCIPLINE', affinityCode: 'POWERLIFTING', supportingUnits: 4 }]);
    expect(result.rows).toHaveLength(1);
    expect(result.eligibleCustomerIds).toEqual([10, 11]);
    expect(result.manifest.customersWithoutAffinityRows).toBe(1);
  });

  it.each([
    ['null', null],
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects %s product quantities at the population boundary', (_label, productQuantity) => {
    expect(() => buildCustomerCommercialAffinityPopulation(input([line({ productQuantity: productQuantity as number })], [fact(1)]))).toThrow(/productQuantity/);
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

  it('returns the sorted eligible identity set and a separate stable population checksum', () => {
    const result = buildCustomerCommercialAffinityPopulation(input([
      line({ customerId: 20, productId: 999, lineRevenueTaxIncl: '50.05' }),
      line({ customerId: 10, productId: 1 }),
    ], [fact(1)]));

    expect(result.eligibleCustomerIds).toEqual([10, 20]);
    expect(result.manifest.eligibleCustomerCount).toBe(2);
    expect(result.manifest.customersWithAffinityRows).toBe(1);
    expect(result.manifest.customersWithoutAffinityRows).toBe(1);
    expect(result.manifest.eligiblePopulationChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(result.manifest.affinityDatasetChecksum).not.toBe(result.manifest.eligiblePopulationChecksum);
    expect(calculateEligibleCustomerPopulationChecksum([20, 10])).toBe(calculateEligibleCustomerPopulationChecksum([10, 20]));
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
    expect(result.rows.map((row) => row.supportingUnits)).toEqual([1, 1]);
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
