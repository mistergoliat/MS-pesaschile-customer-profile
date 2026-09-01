import { describe, expect, it, vi } from 'vitest';
import { AnalyticsUnavailableError } from '../../src/application/customer-profile/errors.js';
import { createGetCustomerClv } from '../../src/application/customer-clv/get-customer-clv.js';
import type { CustomerClvActiveSnapshotReader } from '../../src/application/customer-intelligence/ports.js';
import type { CustomerClvProductionSnapshotHeader } from '../../src/application/customer-clv/create-customer-clv-snapshot.js';

function header(overrides: Partial<CustomerClvProductionSnapshotHeader> = {}): CustomerClvProductionSnapshotHeader {
  return {
    snapshotId: '1', snapshotKey: 'snapshot-1', status: 'published', referenceTime: '2026-08-01T00:00:00.000Z',
    generatedAt: '2026-08-01T01:00:00.000Z', horizonMonths: 12, modelVersion: 'customer-clv-two-stage-cohort-v1',
    estimatorPolicyVersion: 'two-stage-cohort-a04-3-far-stale-adjustment-recent2-v1',
    activityModelVersion: 'activity-v1', activityTrainingWindowPolicy: 'recent_2', activityRecalibrationVersion: 'recalibration-v1',
    staleAdjustmentPolicyVersion: 'stale-v1', conditionalValuePolicyVersion: 'value-v1', rankRefinementPolicyVersion: 'rank-v1',
    estimateSupportPolicyVersion: 'support-v1', trainingTimePolicyVersion: 'training-time-v1', datasetVersion: 'dataset-v1',
    identityAuthority: 'prestashop_customer', sourceAvailableDataThrough: '2026-07-31T23:59:59.000Z',
    populationPolicyVersion: 'population-v1', monetaryPolicyVersion: 'monetary-v1',
    acceptedValidationDecision: 'CLV_MODEL_V1_ACCEPTED_WITH_DOCUMENTED_DEBT', acceptedValidationArtifactVersion: 'validation-v1',
    acceptedValidationArtifactChecksum: 'c'.repeat(64), modelChecksum: 'a'.repeat(64), inputChecksum: 'b'.repeat(64),
    outputChecksum: 'd'.repeat(64), datasetChecksum: 'e'.repeat(64), currencyIsoCode: 'CLP', populationSize: 45194,
    trainingMetadata: { trainingCutoffs: [], effectiveStageATrainingCutoffs: [], effectiveStageBTrainingCutoffs: [], trainingDatasetChecksums: [], trainingRowCount: 0, temporalStatePolicyVersion: 'temporal-v1' },
    ...overrides,
  };
}

function reader(overrides: Partial<CustomerClvActiveSnapshotReader> = {}): CustomerClvActiveSnapshotReader {
  return {
    getActiveSnapshotMetadata: vi.fn(async () => header()),
    getCustomerClv: vi.fn(async () => ({ customerId: 42, expectedRevenueTaxIncl: '123456789012345678.123456', expectedOrders: '2.500000', estimateSupportLevel: 'SUPPORTED' as const })),
    ...overrides,
  };
}

describe('createGetCustomerClv', () => {
  it('serves a published row and preserves decimal strings and lineage', async () => {
    const snapshotReader = reader();
    const result = await createGetCustomerClv({ reader: snapshotReader })({ customerId: 42 });
    expect(result).toMatchObject({ status: 'available', customerId: 42 });
    if (result.status === 'available') {
      expect(result.clv.expectedRevenueTaxIncl).toBe('123456789012345678.123456');
      expect(result.clv.expectedOrders).toBe('2.500000');
      expect(result.clv.snapshotId).toBe('1');
      expect(result.clv.referenceTime).toBe('2026-08-01T00:00:00.000Z');
      expect(result.clv.modelVersion).toBe('customer-clv-two-stage-cohort-v1');
    }
    expect(snapshotReader.getCustomerClv).toHaveBeenCalledWith('1', 42);
  });

  it('preserves absent expectedOrders and supports SPARSE', async () => {
    const result = await createGetCustomerClv({ reader: reader({ getCustomerClv: vi.fn(async () => ({ customerId: 7, expectedRevenueTaxIncl: '0.000000', estimateSupportLevel: 'SPARSE' as const })) }) })({ customerId: 7 });
    expect(result.status).toBe('available');
    if (result.status === 'available') {
      expect(result.clv.expectedOrders).toBeUndefined();
      expect(result.clv.estimateSupportLevel).toBe('SPARSE');
      expect(result.clv.expectedRevenueTaxIncl).toBe('0.000000');
    }
  });

  it('distinguishes no active snapshot, missing row, DB failure, and malformed row', async () => {
    expect(await createGetCustomerClv({ reader: reader({ getActiveSnapshotMetadata: vi.fn(async () => null) }) })({ customerId: 1 })).toMatchObject({ status: 'no_active_clv_snapshot', error: 'NO_ACTIVE_CLV_SNAPSHOT' });
    expect(await createGetCustomerClv({ reader: reader({ getCustomerClv: vi.fn(async () => null) }) })({ customerId: 1 })).toMatchObject({ status: 'customer_clv_not_found', error: 'CUSTOMER_CLV_NOT_FOUND' });
    expect(await createGetCustomerClv({ reader: reader({ getActiveSnapshotMetadata: vi.fn(async () => { throw new AnalyticsUnavailableError('down'); }) }) })({ customerId: 1 })).toMatchObject({ status: 'degraded', reason: 'clv_unavailable' });
    expect(await createGetCustomerClv({ reader: reader({ getCustomerClv: vi.fn(async () => ({ customerId: 1, expectedRevenueTaxIncl: 'not-decimal', estimateSupportLevel: 'SPARSE' as const })) }) })({ customerId: 1 })).toMatchObject({ status: 'malformed_clv_snapshot', error: 'MALFORMED_CLV_SNAPSHOT' });
  });
});
