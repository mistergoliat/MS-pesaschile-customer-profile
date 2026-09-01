import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  calculateCustomerCommercialAffinityDatasetChecksum,
  type CustomerCommercialAffinitySemanticSnapshotInput,
} from '../../src/application/customer-commercial-affinity-population/index.js';
import type { CustomerCommercialAffinityRow } from '../../src/domain/customer-commercial-affinity/index.js';

const referenceTime = '2026-09-01T00:00:00.000Z';
const semanticLineage: CustomerCommercialAffinitySemanticSnapshotInput = {
  snapshotId: `sha256:${'a'.repeat(64)}`,
  schemaVersion: '1',
  ontologyVersion: 'commercial-product-ontology-v3',
  ontologyHash: 'b'.repeat(64),
  classifierVersion: 'product-semantic-classifier-v1',
  sourceSemanticChecksum: 'c'.repeat(64),
  consumerNormalizedChecksum: 'd'.repeat(64),
};
const rows: readonly CustomerCommercialAffinityRow[] = [
  {
    customerId: 20,
    affinityAxis: 'PRODUCT_FAMILY',
    affinityCode: 'BARBELL',
    score: 0.75,
    supportingOrderCount: 1,
    supportingProductCount: 1,
    supportingSpend: '100.000000',
    lastEvidenceAt: '2026-08-01T00:00:00.000Z',
    explicitEvidenceCoverage: 1,
  },
  {
    customerId: 10,
    affinityAxis: 'DISCIPLINE',
    affinityCode: 'POWERLIFTING',
    score: 0.5,
    supportingOrderCount: 2,
    supportingProductCount: 1,
    supportingSpend: '50.000000',
    lastEvidenceAt: '2026-08-02T00:00:00.000Z',
    explicitEvidenceCoverage: null,
  },
];

describe('customer commercial affinity canonical dataset checksum', () => {
  it.skipIf(!existsSync(resolve(process.cwd(), 'artifacts/customer-commercial-affinity/a01-4-population.json')))('reproduces the validated A01.4.1 fixture checksum', () => {
    const artifact = JSON.parse(readFileSync(resolve(process.cwd(), 'artifacts/customer-commercial-affinity/a01-4-population.json'), 'utf8')) as {
      readonly manifest: { readonly referenceTime: string };
      readonly rows: readonly CustomerCommercialAffinityRow[];
    };
    const historicalMetadata = {
      ...semanticLineage,
      generatedAt: '2026-08-29T20:36:33.148Z',
      ontologyVersion: 'commercial-product-ontology-v3',
      ontologyHash: 'f2de79fbedaee83202a133de5af1d86395470ddbf349103dfa2b3bd2f6bdb955',
      classifierVersion: 'product-semantic-classifier-v1',
      sourceProductCount: 2011,
      recordCount: 2011,
      classificationCounts: { CLASSIFIED: 1281, PARTIALLY_CLASSIFIED: 400, OTHER: 317, EXCLUDED_NON_PRODUCT: 13, NEEDS_REVIEW: 0 },
      sourceSemanticChecksum: 'dfc5c5b6fe774e20e64f271bace51c3b54dd6ee983cb8e71ce4bd166e993b97e',
      consumerNormalizedChecksum: '576f3cef473268ad04875e0fdffeee40c48687da2a4a4920500c5d908c46815e',
      snapshotId: 'sha256:79cef493e4f3bfdc3dffef8471bcde41bc96cd1a86e7344c85e7113569d84b12',
      schemaVersion: '1' as const,
    };

    expect(calculateCustomerCommercialAffinityDatasetChecksum({
      referenceTime: artifact.manifest.referenceTime,
      semanticSnapshot: historicalMetadata,
      rows: artifact.rows,
    })).toBe('e2d82e000357c9d9c25c9e8014e8219af5f7db49d8ad9d757d2fe353828cbd55');
  });

  it('ignores materialization metadata outside the portable semantic lineage', () => {
    const minimalChecksum = calculateCustomerCommercialAffinityDatasetChecksum({
      referenceTime,
      semanticSnapshot: semanticLineage,
      rows,
    });
    const extendedChecksum = calculateCustomerCommercialAffinityDatasetChecksum({
      referenceTime,
      semanticSnapshot: {
        ...semanticLineage,
        generatedAt: '2026-08-31T16:51:22.563Z',
        sourceProductCount: 2011,
        recordCount: 2011,
        classificationCounts: { CLASSIFIED: 1281, PARTIALLY_CLASSIFIED: 400, OTHER: 317, EXCLUDED_NON_PRODUCT: 13, NEEDS_REVIEW: 0 },
        futureMetadataField: 'must-not-affect-checksum',
      },
      rows,
    });

    expect(extendedChecksum).toBe(minimalChecksum);
  });

  it('ignores generatedAt, sourceProductCount, recordCount, and classificationCounts changes', () => {
    const baseline = calculateCustomerCommercialAffinityDatasetChecksum({ referenceTime, semanticSnapshot: {
      ...semanticLineage,
      generatedAt: '2026-08-29T20:36:33.148Z',
      classifierVersion: 'product-semantic-classifier-v1',
      sourceProductCount: 2011,
      recordCount: 2011,
      classificationCounts: { CLASSIFIED: 1, PARTIALLY_CLASSIFIED: 0, OTHER: 0, EXCLUDED_NON_PRODUCT: 0, NEEDS_REVIEW: 0 },
    }, rows });

    expect(calculateCustomerCommercialAffinityDatasetChecksum({ referenceTime, semanticSnapshot: {
      ...semanticLineage,
      generatedAt: '2026-09-01T12:00:00.000Z',
      classifierVersion: 'product-semantic-classifier-v1',
      sourceProductCount: 9999,
      recordCount: 9998,
      classificationCounts: { CLASSIFIED: 0, PARTIALLY_CLASSIFIED: 1, OTHER: 2, EXCLUDED_NON_PRODUCT: 3, NEEDS_REVIEW: 4 },
    }, rows })).toBe(baseline);
  });

  it('changes when any canonical semantic lineage field changes', () => {
    const baseline = calculateCustomerCommercialAffinityDatasetChecksum({ referenceTime, semanticSnapshot: {
      ...semanticLineage,
      generatedAt: '2026-08-29T20:36:33.148Z',
      classifierVersion: 'product-semantic-classifier-v2',
    }, rows });

    expect(calculateCustomerCommercialAffinityDatasetChecksum({ referenceTime, semanticSnapshot: {
      ...semanticLineage,
      classifierVersion: 'product-semantic-classifier-v3',
    }, rows })).not.toBe(baseline);
    expect(calculateCustomerCommercialAffinityDatasetChecksum({ referenceTime, semanticSnapshot: {
      ...semanticLineage,
      ontologyHash: 'e'.repeat(64),
    }, rows })).not.toBe(baseline);
    expect(calculateCustomerCommercialAffinityDatasetChecksum({ referenceTime, semanticSnapshot: {
      ...semanticLineage,
      sourceSemanticChecksum: 'f'.repeat(64),
    }, rows })).not.toBe(baseline);
    expect(calculateCustomerCommercialAffinityDatasetChecksum({ referenceTime, semanticSnapshot: {
      ...semanticLineage,
      consumerNormalizedChecksum: '1'.repeat(64),
    }, rows })).not.toBe(baseline);
  });

  it('changes when an affinity row changes and ignores row input order', () => {
    const baseline = calculateCustomerCommercialAffinityDatasetChecksum({ referenceTime, semanticSnapshot: semanticLineage, rows });
    expect(calculateCustomerCommercialAffinityDatasetChecksum({ referenceTime, semanticSnapshot: semanticLineage, rows: [...rows].reverse() })).toBe(baseline);
    expect(calculateCustomerCommercialAffinityDatasetChecksum({ referenceTime, semanticSnapshot: semanticLineage, rows: [{ ...rows[0]!, score: 0.51 }, rows[1]!] })).not.toBe(baseline);
  });
});
