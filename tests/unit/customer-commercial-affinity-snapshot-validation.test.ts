import { describe, expect, it } from 'vitest';
import {
  buildCustomerCommercialAffinityPopulation,
  type CustomerAffinityPurchaseEvidence,
} from '../../src/application/customer-commercial-affinity-population/index.js';
import {
  buildCustomerCommercialAffinitySnapshotHeader,
  validateCustomerCommercialAffinitySnapshot,
} from '../../src/application/customer-commercial-affinity-snapshot/index.js';
import type { ProductSemanticFact, CustomerCommercialAffinityRow } from '../../src/domain/customer-commercial-affinity/index.js';

const referenceTime = '2026-09-01T00:00:00.000Z';

function buildFixture() {
  const purchase: CustomerAffinityPurchaseEvidence = {
    customerId: 10,
    orderId: 100,
    orderDetailId: 1,
    orderCreatedAt: '2026-08-01T00:00:00.000Z',
    productId: 1,
    lineRevenueTaxIncl: '100.10',
  };
  const fact: ProductSemanticFact = {
    productId: 1,
    ontologyVersion: 'commercial-product-ontology-v3',
    ontologyHash: 'f'.repeat(64),
    classificationStatus: 'CLASSIFIED',
    primaryProductFamily: { code: 'BARBELL', confidence: 'EXPLICIT' },
    secondaryProductFamilies: [],
    disciplines: [],
    useContexts: [],
  };
  const semanticMetadata = {
    snapshotId: `sha256:${'a'.repeat(64)}`,
    schemaVersion: '1' as const,
    generatedAt: '2026-08-31T00:00:00.000Z',
    ontologyVersion: fact.ontologyVersion,
    ontologyHash: fact.ontologyHash,
    classifierVersion: 'product-semantic-classifier-v1',
    sourceProductCount: 1,
    recordCount: 1,
    classificationCounts: { CLASSIFIED: 1, PARTIALLY_CLASSIFIED: 0, OTHER: 0, EXCLUDED_NON_PRODUCT: 0, NEEDS_REVIEW: 0 },
    sourceSemanticChecksum: 'b'.repeat(64),
    consumerNormalizedChecksum: 'c'.repeat(64),
  };
  const population = buildCustomerCommercialAffinityPopulation({
    referenceTime,
    purchases: [purchase],
    semanticSnapshot: {
      metadata: semanticMetadata,
      facts: [fact],
    },
  });
  const header = buildCustomerCommercialAffinitySnapshotHeader({
    population,
    semanticSnapshotMetadata: semanticMetadata,
    generatedAt: '2026-09-01T00:01:00.000Z',
    sourceWatermarkOrderId: 100,
  });
  return { header, rows: population.rows };
}

describe('Customer Commercial Affinity A01.5 snapshot validation', () => {
  it('accepts a complete header and normalized row', () => {
    const fixture = buildFixture();
    expect(validateCustomerCommercialAffinitySnapshot(fixture)).toMatchObject({ populationSize: 1, axisCounts: { PRODUCT_FAMILY: 1 } });
  });

  it('rejects semantic lineage mismatch', () => {
    const fixture = buildFixture();
    expect(() => validateCustomerCommercialAffinitySnapshot({ ...fixture, header: { ...fixture.header, ontologyHash: 'a'.repeat(64) } })).toThrow(/lineage mismatch/);
  });

  it('rejects duplicate customer-axis-code rows', () => {
    const fixture = buildFixture();
    expect(() => validateCustomerCommercialAffinitySnapshot({ ...fixture, header: { ...fixture.header, affinityRowCount: 2 }, rows: [...fixture.rows, ...fixture.rows] })).toThrow(/Duplicate/);
  });

  it('rejects invalid score, support counts, negative spend, and coverage', () => {
    const fixture = buildFixture();
    const cases: readonly CustomerCommercialAffinityRow[] = [
      { ...fixture.rows[0]!, score: 2 },
      { ...fixture.rows[0]!, supportingOrderCount: 0 },
      { ...fixture.rows[0]!, supportingProductCount: 0 },
      { ...fixture.rows[0]!, supportingSpend: '-1.000000' },
      { ...fixture.rows[0]!, explicitEvidenceCoverage: 2 },
    ];
    for (const row of cases) expect(() => validateCustomerCommercialAffinitySnapshot({ ...fixture, rows: [row] })).toThrow();
  });

  it('rejects last evidence at the reference boundary and row-count mismatch', () => {
    const fixture = buildFixture();
    expect(() => validateCustomerCommercialAffinitySnapshot({ ...fixture, rows: [{ ...fixture.rows[0]!, lastEvidenceAt: referenceTime }] })).toThrow(/before referenceTime/);
    expect(() => validateCustomerCommercialAffinitySnapshot({ ...fixture, header: { ...fixture.header, affinityRowCount: 2 } })).toThrow(/row count mismatch/);
  });

  it('rejects an affinity checksum mismatch before persistence', () => {
    const fixture = buildFixture();
    const checksum = 'd'.repeat(64);
    const header = { ...fixture.header, affinityDatasetChecksum: checksum, populationManifest: { ...fixture.header.populationManifest, affinityDatasetChecksum: checksum } };
    expect(() => validateCustomerCommercialAffinitySnapshot({ ...fixture, header })).toThrow(/checksum mismatch/);
  });
});
