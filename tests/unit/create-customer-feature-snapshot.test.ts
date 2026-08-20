import { describe, expect, it, vi } from 'vitest';
import { createCustomerFeatureSnapshot } from '../../src/application/customer-analytics/create-customer-feature-snapshot.js';
import {
  featureVersion,
  operationalAccountExclusionPolicyVersion,
  populationPolicyVersion,
  shopScope,
} from '../../src/domain/customer-analytics/model-version.js';
import type { CustomerFeatureReader, CustomerFeatureSnapshotRepository } from '../../src/application/customer-analytics/ports.js';
import type { CustomerFeatureSourceRow } from '../../src/domain/customer-analytics/contracts.js';

function sourceRow(customerId: number): CustomerFeatureSourceRow {
  return {
    prestashopCustomerId: customerId,
    validOrders: 2,
    firstOrderAt: '2026-01-01 00:00:00',
    lastOrderAt: '2026-07-01 00:00:00',
    orders365d: 1,
    totalSpentTaxIncl: '1000.000000',
    totalDiscountsTaxIncl: '0.000000',
    totalShippingTaxIncl: '0.000000',
    totalOrdersAllStates: 2,
    cancelledOrders: 0,
    customerCreatedAt: '2024-01-01 00:00:00',
    products: [{ productId: 1, productOrderCount: 1, totalQuantity: 1, totalSpentTaxIncl: '1000.000000' }],
  };
}

function readerWith(rows: readonly CustomerFeatureSourceRow[]): CustomerFeatureReader {
  return { readPopulation: vi.fn(async () => rows) };
}

function baseInput(dryRun: boolean) {
  return {
    featureVersion,
    populationPolicyVersion,
    operationalExclusionPolicyVersion: operationalAccountExclusionPolicyVersion,
    shopScope,
    referenceTime: '2026-08-19T00:00:00.000Z',
    referenceTimeMysql: '2026-08-19 00:00:00',
    generatedAt: 'A',
    dryRun,
  };
}

describe('createCustomerFeatureSnapshot', () => {
  it('dry_run mode never touches the repository', async () => {
    const reader = readerWith([sourceRow(1), sourceRow(2)]);
    const repository: CustomerFeatureSnapshotRepository = {
      findPublishedSnapshot: vi.fn(),
      publishSnapshot: vi.fn(),
    };
    const result = await createCustomerFeatureSnapshot(baseInput(true), { reader, repository });
    expect(result.mode).toBe('dry_run');
    expect(result.snapshotId).toBeNull();
    expect(repository.findPublishedSnapshot).not.toHaveBeenCalled();
    expect(repository.publishSnapshot).not.toHaveBeenCalled();
  });

  it('persists a new snapshot when none exists for the key', async () => {
    const reader = readerWith([sourceRow(1), sourceRow(2)]);
    const repository: CustomerFeatureSnapshotRepository = {
      findPublishedSnapshot: vi.fn(async () => null),
      publishSnapshot: vi.fn(async (input) => ({
        snapshotId: '42',
        persistedRowCount: input.rows.length,
        featureDatasetChecksum: input.featureDatasetChecksum,
      })),
    };
    const result = await createCustomerFeatureSnapshot(baseInput(false), { reader, repository });
    expect(result.mode).toBe('persisted');
    expect(result.snapshotId).toBe('42');
  });

  it('returns skipped_existing when a matching snapshot is already published (idempotency, task Section 26)', async () => {
    const reader = readerWith([sourceRow(1), sourceRow(2)]);
    const firstBuild = await createCustomerFeatureSnapshot(baseInput(true), { reader });
    const existingChecksum = firstBuild.manifest.featureDatasetChecksum;
    const existingSourceChecksum = firstBuild.manifest.sourceDatasetChecksum;

    const repository: CustomerFeatureSnapshotRepository = {
      findPublishedSnapshot: vi.fn(async () => ({
        snapshotId: '7',
        featureDatasetChecksum: existingChecksum,
        sourceDatasetChecksum: existingSourceChecksum,
      })),
      publishSnapshot: vi.fn(),
    };
    const result = await createCustomerFeatureSnapshot(baseInput(false), { reader, repository });
    expect(result.mode).toBe('skipped_existing');
    expect(result.snapshotId).toBe('7');
    expect(repository.publishSnapshot).not.toHaveBeenCalled();
  });

  it('returns source_drift_detected (not a thrown conflict) when the same key already published a different checksum (task Section 28)', async () => {
    const reader = readerWith([sourceRow(1), sourceRow(2)]);
    const repository: CustomerFeatureSnapshotRepository = {
      findPublishedSnapshot: vi.fn(async () => ({
        snapshotId: '7',
        featureDatasetChecksum: 'f'.repeat(64),
        sourceDatasetChecksum: 'e'.repeat(64),
      })),
      publishSnapshot: vi.fn(),
    };
    const result = await createCustomerFeatureSnapshot(baseInput(false), { reader, repository });
    expect(result.mode).toBe('source_drift_detected');
    expect(result.snapshotId).toBeNull();
    expect(result.priorSnapshotId).toBe('7');
    expect(result.priorFeatureDatasetChecksum).toBe('f'.repeat(64));
    expect(repository.publishSnapshot).not.toHaveBeenCalled();
  });

  it('throws when dryRun is false and no repository is provided', async () => {
    const reader = readerWith([sourceRow(1), sourceRow(2)]);
    await expect(createCustomerFeatureSnapshot(baseInput(false), { reader })).rejects.toThrow(/repository is required/);
  });

  it('throws when the persisted row count differs from the calculated row count', async () => {
    const reader = readerWith([sourceRow(1), sourceRow(2)]);
    const repository: CustomerFeatureSnapshotRepository = {
      findPublishedSnapshot: vi.fn(async () => null),
      publishSnapshot: vi.fn(async (input) => ({
        snapshotId: '42',
        persistedRowCount: input.rows.length - 1,
        featureDatasetChecksum: input.featureDatasetChecksum,
      })),
    };
    await expect(createCustomerFeatureSnapshot(baseInput(false), { reader, repository })).rejects.toThrow(/row count/);
  });
});
