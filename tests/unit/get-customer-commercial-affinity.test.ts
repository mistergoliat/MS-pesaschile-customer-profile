import { describe, expect, it, vi } from 'vitest';
import type { CustomerCommercialAffinitySnapshotHeader } from '../../src/application/customer-commercial-affinity-snapshot/index.js';
import {
  CUSTOMER_COMMERCIAL_AFFINITY_MAX_BATCH_SIZE,
  createGetCustomerCommercialAffinity,
} from '../../src/application/customer-commercial-affinity/index.js';

const header: CustomerCommercialAffinitySnapshotHeader = {
  snapshotId: '3',
  snapshotKey: 'snapshot-key',
  status: 'published',
  calculationVersion: 'customer-commercial-affinity-v1',
  referenceTime: '2026-09-01T00:00:00.000Z',
  generatedAt: '2026-09-01T00:01:00.000Z',
  populationPolicyVersion: 'population-v1',
  orderEligibilityPolicyVersion: 'orders-v1',
  productSemanticSnapshotId: 'semantic-1',
  productSemanticSchemaVersion: '1',
  ontologyVersion: 'commercial-product-ontology-v3',
  ontologyHash: 'a'.repeat(64),
  sourceSemanticChecksum: 'b'.repeat(64),
  consumerSemanticChecksum: 'c'.repeat(64),
  sourceCustomerCount: 3,
  eligibleCustomerCount: 3,
  eligibleOrderCount: 3,
  eligibleOrderLineCount: 3,
  customersWithAffinity: 2,
  customersWithoutAffinity: 1,
  affinityRowCount: 3,
  datasetChecksum: 'd'.repeat(64),
  affinityDatasetChecksum: 'e'.repeat(64),
  identityAuthority: 'prestashop_customer',
  sourceWatermarkOrderId: 100,
  semanticCoverage: {
    customer: 100,
    orderLine: 100,
    spend: 100,
    product: 100,
  },
  semanticSnapshotMetadata: {} as CustomerCommercialAffinitySnapshotHeader['semanticSnapshotMetadata'],
  populationManifest: {} as CustomerCommercialAffinitySnapshotHeader['populationManifest'],
};

const rows = [
  { customerId: 42, affinityAxis: 'USE_CONTEXT' as const, affinityCode: 'HOME', score: 0.4, supportingOrderCount: 1, supportingProductCount: 1, supportingSpend: '10.000000', lastEvidenceAt: '2026-08-01T00:00:00.000Z', explicitEvidenceCoverage: null },
  { customerId: 42, affinityAxis: 'PRODUCT_FAMILY' as const, affinityCode: 'BARBELL', score: 0.9, supportingOrderCount: 2, supportingProductCount: 2, supportingSpend: '20.000000', lastEvidenceAt: '2026-08-02T00:00:00.000Z', explicitEvidenceCoverage: 1 },
  { customerId: 42, affinityAxis: 'DISCIPLINE' as const, affinityCode: 'STRENGTH', score: 0.7, supportingOrderCount: 1, supportingProductCount: 1, supportingSpend: '15.000000', lastEvidenceAt: '2026-08-03T00:00:00.000Z', explicitEvidenceCoverage: 0.5 },
];

function reader(overrides: Record<string, unknown> = {}) {
  return {
    getActiveSnapshotMetadata: vi.fn(async () => header),
    getCustomerAffinity: vi.fn(async () => rows),
    getCustomerAffinities: vi.fn(async () => rows),
    ...overrides,
  };
}

describe('Customer Commercial Affinity runtime read model', () => {
  it('returns published metadata and preserves all axes in deterministic order', async () => {
    const deps = reader({ getCustomerAffinity: vi.fn(async () => [...rows].reverse()) });
    const runtime = createGetCustomerCommercialAffinity({ reader: deps });
    const result = await runtime.getCustomerAffinity({ customerId: 42 });

    expect(result).toMatchObject({ customerId: 42, status: 'available', availability: 'AVAILABLE', affinity: { customerId: 42, snapshot: { snapshotId: '3', calculationVersion: 'customer-commercial-affinity-v1', referenceTime: header.referenceTime, productSemanticSnapshotId: 'semantic-1', productSemanticSchemaVersion: '1', affinityDatasetChecksum: 'e'.repeat(64) } } });
    if (result.status !== 'available') return;
    expect(result.affinity.affinities.map((row) => [row.affinityAxis, row.affinityCode])).toEqual([
      ['DISCIPLINE', 'STRENGTH'],
      ['PRODUCT_FAMILY', 'BARBELL'],
      ['USE_CONTEXT', 'HOME'],
    ]);
    expect(result.affinity.affinities[2]?.explicitEvidenceCoverage).toBeNull();
  });

  it('distinguishes no rows from no published snapshot and maps infrastructure failure to unavailable', async () => {
    const noRows = createGetCustomerCommercialAffinity({ reader: reader({ getCustomerAffinity: vi.fn(async () => []) }) });
    await expect(noRows.getCustomerAffinity({ customerId: 42 })).resolves.toMatchObject({ availability: 'NOT_IN_POPULATION', affinity: null });

    const noSnapshot = createGetCustomerCommercialAffinity({ reader: reader({ getActiveSnapshotMetadata: vi.fn(async () => null) }) });
    await expect(noSnapshot.getCustomerAffinity({ customerId: 42 })).resolves.toMatchObject({ availability: 'UNAVAILABLE', reason: 'no_published_snapshot' });

    const failed = createGetCustomerCommercialAffinity({ reader: reader({ getActiveSnapshotMetadata: vi.fn(async () => { throw new Error('db down'); }) }) });
    await expect(failed.getCustomerAffinity({ customerId: 42 })).resolves.toMatchObject({ availability: 'UNAVAILABLE', reason: 'affinity_unavailable' });
  });

  it('uses one metadata read and one bounded batch row query, with no N+1 behavior', async () => {
    const deps = reader();
    const runtime = createGetCustomerCommercialAffinity({ reader: deps });
    const result = await runtime.getCustomerAffinities({ customerIds: [42, 42, 7] });

    expect(result).toHaveLength(2);
    expect(deps.getActiveSnapshotMetadata).toHaveBeenCalledTimes(1);
    expect(deps.getCustomerAffinities).toHaveBeenCalledTimes(1);
    expect(deps.getCustomerAffinity).not.toHaveBeenCalled();
    await expect(runtime.getCustomerAffinities({ customerIds: Array.from({ length: CUSTOMER_COMMERCIAL_AFFINITY_MAX_BATCH_SIZE + 1 }, (_, i) => i + 1) })).rejects.toThrow('maximum size');
  });

  it('returns unavailable for an empty batch only after validating the bound contract', async () => {
    const deps = reader();
    const runtime = createGetCustomerCommercialAffinity({ reader: deps });
    await expect(runtime.getCustomerAffinities({ customerIds: [] })).resolves.toEqual([]);
    expect(deps.getActiveSnapshotMetadata).not.toHaveBeenCalled();
  });
});
