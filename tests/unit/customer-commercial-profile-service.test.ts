import { describe, expect, it, vi } from 'vitest';
import {
  CUSTOMER_COMMERCIAL_PROFILE_MAX_BATCH_SIZE,
  createCustomerCommercialProfileService,
} from '../../src/application/customer-commercial-profile/customer-commercial-profile-service.js';
import { CUSTOMER_COMMERCIAL_PROFILE_AVAILABILITY_STATES } from '../../src/domain/customer-commercial-profile/index.js';

const identity = vi.fn(async () => ({
  status: 'found' as const,
  identity: {
    customerId: 42,
    externalCustomerId: 42,
    identitySource: 'PRESTASHOP' as const,
    identityStatus: 'DIRECT_SOURCE' as const,
    sourceMetadata: { platform: 'PRESTASHOP' as const, entity: 'ps_customer' as const, primaryKey: 'id_customer' as const },
  },
}));

const rfm = {
  status: 'available' as const,
  customerId: 42,
  snapshot: { snapshotId: 'rfm-1', calculationVersion: 'rfm-v1', referenceTime: '2026-08-01T00:00:00.000Z', publishedAt: '2026-08-01T01:00:00.000Z', currencyCode: 'CLP' },
  rfm: { recencyDays: 2, frequencyOrders: 3, grossOrderValueTaxIncl: '123456789012345678.123456', averageOrderValueTaxIncl: '41152263004012392.707819', recencyScore: 5, frequencyScore: 3, monetaryScore: 4, rfmCode: 'R5F3M4' },
  segment: { code: 'LOYAL', version: 'rfm-commercial-v1' },
  contractVersion: 'customer-rfm-runtime-v1' as const,
};

const cluster = {
  status: 'available' as const,
  customerId: 42,
  cluster: { clusterId: 3, label: 'NEW_BURST_THEN_LAPSED_BUYERS', description: 'bounded description' },
  model: { modelVersion: 'behavioral-kmeans-k4-v1', algorithm: 'kmeans', k: 4, featureVersion: 'features-v1', preprocessingVersion: 'preprocessing-v1' },
  snapshot: { snapshotId: 'cluster-1', referenceTime: '2026-08-02T00:00:00.000Z' },
  assignment: { distanceToCentroid: 1.2 },
  contractVersion: 'customer-cluster-runtime-v1' as const,
};

const clv = {
  status: 'available' as const,
  customerId: 42,
  clv: {
    horizonMonths: 12 as const,
    expectedRevenueTaxIncl: '987654321098765432.654321',
    expectedOrders: '2.500000',
    currencyIsoCode: 'CLP' as const,
    estimateSupportLevel: 'SUPPORTED' as const,
    modelVersion: 'customer-clv-two-stage-cohort-v1',
    estimatorPolicyVersion: 'two-stage-cohort-v1',
    referenceTime: '2026-08-03T00:00:00.000Z',
    generatedAt: '2026-08-03T01:00:00.000Z',
    snapshotId: 'clv-1',
    snapshotKey: 'clv-snapshot-1',
    sourceAvailableDataThrough: '2026-07-31T23:59:59.000Z',
  },
  contractVersion: 'customer-clv-runtime-v1' as const,
};

const affinity = {
  status: 'available' as const,
  customerId: 42,
  availability: 'AVAILABLE' as const,
  affinity: {
    snapshot: {
      snapshotId: '3', calculationVersion: 'customer-commercial-affinity-v1', referenceTime: '2026-08-01T00:00:00.000Z',
      productSemanticSnapshotId: 'semantic-1', productSemanticSchemaVersion: '1', ontologyVersion: 'ontology-v3',
      ontologyHash: 'a'.repeat(64), sourceSemanticChecksum: 'b'.repeat(64), consumerSemanticChecksum: 'c'.repeat(64), affinityDatasetChecksum: 'd'.repeat(64),
    },
    affinities: [{ affinityAxis: 'PRODUCT_FAMILY' as const, affinityCode: 'BARBELL', score: 0.8, supportingOrderCount: 2, supportingProductCount: 1, supportingSpend: '100.000000', lastEvidenceAt: '2026-08-03T00:00:00.000Z', explicitEvidenceCoverage: null }],
  },
  contractVersion: 'customer-commercial-affinity-runtime-v1' as const,
};

function service(overrides: Record<string, unknown> = {}) {
  return createCustomerCommercialProfileService({
    resolveCustomerIdentity: identity,
    getCustomerRfm: vi.fn(async () => rfm),
    getCustomerCluster: vi.fn(async () => cluster),
    getCustomerClv: vi.fn(async () => clv),
    getCustomerCommercialAffinity: vi.fn(async () => affinity),
    getCustomerCommercialAffinities: vi.fn(async ({ customerIds }: { customerIds: readonly number[] }) => customerIds.map((customerId) => ({ ...affinity, customerId }))),
    clock: { now: () => new Date('2026-08-04T00:00:00.000Z') },
    ...overrides,
  } as never);
}

describe('Customer Commercial Profile contract and composition', () => {
  it('defines the bounded availability vocabulary without the former affinity placeholder state', () => {
    expect(CUSTOMER_COMMERCIAL_PROFILE_AVAILABILITY_STATES).toEqual([
      'AVAILABLE',
      'NOT_IN_POPULATION',
      'UNAVAILABLE',
    ]);
  });

  it('composes independent dimensions with identity, version, lineage, affinity placeholder, and decimal strings', async () => {
    const result = await service().getByCustomerId({ customerId: 42 });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;

    expect(result.contractVersion).toBe('customer-commercial-profile-v1');
    expect(result.profile).toMatchObject({
      customerId: 42,
      identityAuthority: 'prestashop_customer',
      rfm: { recency: 2, frequency: 3, monetary: '123456789012345678.123456' },
      behavioralCluster: { clusterId: 3, label: 'NEW_BURST_THEN_LAPSED_BUYERS', modelVersion: 'behavioral-kmeans-k4-v1' },
      clv: { expectedRevenueTaxIncl: '987654321098765432.654321', expectedOrders: '2.500000' },
      commercialAffinity: { snapshot: { snapshotId: '3' }, affinities: [{ affinityAxis: 'PRODUCT_FAMILY', affinityCode: 'BARBELL' }] },
      availability: { rfm: 'AVAILABLE', behavioralCluster: 'AVAILABLE', clv: 'AVAILABLE', commercialAffinity: 'AVAILABLE' },
    });
    expect(result.profile.provenance).toMatchObject({
      generatedAt: '2026-08-04T00:00:00.000Z',
      oldestReferenceTime: '2026-08-01T00:00:00.000Z',
      newestReferenceTime: '2026-08-03T00:00:00.000Z',
      rfm: { snapshotId: 'rfm-1', calculationVersion: 'rfm-v1' },
      behavioralCluster: { snapshotId: 'cluster-1', modelVersion: 'behavioral-kmeans-k4-v1' },
      clv: { snapshotId: 'clv-1', modelVersion: 'customer-clv-two-stage-cohort-v1' },
      commercialAffinity: { snapshotId: '3', calculationVersion: 'customer-commercial-affinity-v1' },
    });
    expect(JSON.stringify(result)).not.toContain('reliabilityBucket');
  });

  it('supports partial coverage and distinguishes population absence from unavailability', async () => {
    const result = await service({
      getCustomerCluster: vi.fn(async () => ({ status: 'cluster_not_available', customerId: 42, reason: 'insufficient_repeat_purchase_history', contractVersion: 'customer-cluster-runtime-v1' as const })),
      getCustomerClv: vi.fn(async () => ({ status: 'degraded', customerId: 42, reason: 'clv_unavailable', contractVersion: 'customer-clv-runtime-v1' as const })),
    }).getByCustomerId({ customerId: 42 });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.profile.rfm).not.toBeNull();
    expect(result.profile.behavioralCluster).toBeNull();
    expect(result.profile.clv).toBeNull();
    expect(result.profile.availability).toMatchObject({ behavioralCluster: 'NOT_IN_POPULATION', clv: 'UNAVAILABLE' });
    expect(result.profile.availability.commercialAffinity).toBe('AVAILABLE');
  });

  it('returns an empty but valid profile when all analytical inputs are unavailable', async () => {
    const result = await service({
      getCustomerRfm: vi.fn(async () => ({ status: 'degraded', customerId: 42, reason: 'rfm_unavailable', contractVersion: 'customer-rfm-runtime-v1' as const })),
      getCustomerCluster: vi.fn(async () => ({ status: 'degraded', customerId: 42, reason: 'cluster_unavailable', contractVersion: 'customer-cluster-runtime-v1' as const })),
      getCustomerClv: vi.fn(async () => ({ status: 'no_active_clv_snapshot', customerId: 42, error: 'NO_ACTIVE_CLV_SNAPSHOT' as const, contractVersion: 'customer-clv-runtime-v1' as const })),
      getCustomerCommercialAffinity: vi.fn(async () => ({ status: 'unavailable', customerId: 42, availability: 'UNAVAILABLE' as const, affinity: null, reason: 'affinity_unavailable' as const, contractVersion: 'customer-commercial-affinity-runtime-v1' as const })),
    }).getByCustomerId({ customerId: 42 });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.profile.rfm).toBeNull();
    expect(result.profile.behavioralCluster).toBeNull();
    expect(result.profile.clv).toBeNull();
    expect(result.profile.availability).toMatchObject({ rfm: 'UNAVAILABLE', behavioralCluster: 'UNAVAILABLE', clv: 'UNAVAILABLE' });
    expect(result.profile.availability.commercialAffinity).toBe('UNAVAILABLE');
  });

  it('maps a published snapshot with no customer rows to NOT_IN_POPULATION without synthetic affinities', async () => {
    const result = await service({
      getCustomerCommercialAffinity: vi.fn(async () => ({ status: 'not_in_population', customerId: 42, availability: 'NOT_IN_POPULATION' as const, affinity: null, contractVersion: 'customer-commercial-affinity-runtime-v1' as const })),
    }).getByCustomerId({ customerId: 42 });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.profile.commercialAffinity).toBeNull();
    expect(result.profile.availability.commercialAffinity).toBe('NOT_IN_POPULATION');
  });

  it('distinguishes a missing customer and bounds/deduplicates batch composition', async () => {
    const missing = service({ resolveCustomerIdentity: vi.fn(async () => ({ status: 'not_found' as const })) }).getByCustomerId({ customerId: 999 });
    await expect(missing).resolves.toMatchObject({ status: 'customer_not_found', customerId: 999 });

    const batchService = service();
    const batch = await batchService.getByCustomerIds({ customerIds: [42, 42, 7] });
    expect(batch).toHaveLength(2);
    expect(batch.map((row) => row.customerId)).toEqual([42, 7]);
    await expect(batchService.getByCustomerIds({ customerIds: Array.from({ length: CUSTOMER_COMMERCIAL_PROFILE_MAX_BATCH_SIZE + 1 }, (_, index) => index + 1) })).rejects.toThrow('maximum size');
  });
});
