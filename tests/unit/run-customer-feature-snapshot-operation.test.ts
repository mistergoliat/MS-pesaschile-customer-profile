import { describe, expect, it, vi } from 'vitest';
import { runCustomerFeatureSnapshotOperation } from '../../src/application/customer-analytics/run-customer-feature-snapshot-operation.js';
import {
  featureVersion,
  operationalAccountExclusionPolicyVersion,
  populationPolicyVersion,
  shopScope,
} from '../../src/domain/customer-analytics/model-version.js';
import type { CustomerFeatureReader, CustomerFeatureSnapshotRepository } from '../../src/application/customer-analytics/ports.js';
import type { CustomerFeatureSnapshotRunRepository } from '../../src/infrastructure/customer-analytics/mysql-customer-feature-snapshot-run-repository.js';
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

function reader(): CustomerFeatureReader {
  return { readPopulation: vi.fn(async () => [sourceRow(1)]) };
}

function lockedRunRepository(): CustomerFeatureSnapshotRunRepository {
  return {
    tryAcquireExecutionLock: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
    createRun: vi.fn(async () => '100'),
    completeRun: vi.fn(async () => undefined),
  };
}

const clock = { now: () => new Date('2026-08-19T00:00:10.000Z') };

function baseInput(dryRun: boolean) {
  return {
    triggerSource: 'manual' as const,
    featureVersion,
    populationPolicyVersion,
    operationalExclusionPolicyVersion: operationalAccountExclusionPolicyVersion,
    shopScope,
    dryRun,
    referenceTime: '2026-08-19T00:00:00.000Z',
    referenceTimeMysql: '2026-08-19 00:00:00',
    generatedAt: null,
  };
}

describe('runCustomerFeatureSnapshotOperation', () => {
  it('dry run succeeds without any repository dependency', async () => {
    const result = await runCustomerFeatureSnapshotOperation(baseInput(true), { reader: reader(), clock });
    expect(result.status).toBe('succeeded');
    expect(result.mode).toBe('dry_run');
    expect(result.runId).toBeNull();
  });

  it('persists via the repository and logs a succeeded run when the lock is acquired', async () => {
    const runRepository = lockedRunRepository();
    const repository: CustomerFeatureSnapshotRepository = {
      findPublishedSnapshot: vi.fn(async () => null),
      publishSnapshot: vi.fn(async (input) => ({
        snapshotId: '5',
        persistedRowCount: input.rows.length,
        featureDatasetChecksum: input.featureDatasetChecksum,
      })),
    };
    const result = await runCustomerFeatureSnapshotOperation(baseInput(false), { reader: reader(), repository, runRepository, clock });
    expect(result.status).toBe('succeeded');
    expect(result.snapshotId).toBe('5');
    expect(runRepository.createRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'started' }));
    expect(runRepository.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded', snapshotId: '5' }));
  });

  it('logs a skipped run without acquiring work when the execution lock is already held', async () => {
    const runRepository: CustomerFeatureSnapshotRunRepository = {
      tryAcquireExecutionLock: vi.fn(async () => null),
      createRun: vi.fn(async () => '101'),
      completeRun: vi.fn(async () => undefined),
    };
    const repository: CustomerFeatureSnapshotRepository = { findPublishedSnapshot: vi.fn(), publishSnapshot: vi.fn() };
    const result = await runCustomerFeatureSnapshotOperation(baseInput(false), { reader: reader(), repository, runRepository, clock });
    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('execution_lock_not_acquired');
    expect(repository.publishSnapshot).not.toHaveBeenCalled();
  });

  it('maps source_drift_detected to a skipped run (never a failure, task Section 28)', async () => {
    const runRepository = lockedRunRepository();
    const repository: CustomerFeatureSnapshotRepository = {
      findPublishedSnapshot: vi.fn(async () => ({
        snapshotId: '7',
        featureDatasetChecksum: 'f'.repeat(64),
        sourceDatasetChecksum: 'e'.repeat(64),
      })),
      publishSnapshot: vi.fn(),
    };
    const result = await runCustomerFeatureSnapshotOperation(baseInput(false), { reader: reader(), repository, runRepository, clock });
    expect(result.status).toBe('skipped');
    expect(result.mode).toBe('source_drift_detected');
    expect(result.skipReason).toBe('source_drift_detected');
    expect(result.snapshotId).toBeNull();
    expect(runRepository.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped', skipReason: 'source_drift_detected' }));
    expect(repository.publishSnapshot).not.toHaveBeenCalled();
  });

  it('marks the run failed and releases the lock when persistence throws', async () => {
    const runRepository = lockedRunRepository();
    const repository: CustomerFeatureSnapshotRepository = {
      findPublishedSnapshot: vi.fn(async () => null),
      publishSnapshot: vi.fn(async () => {
        throw new Error('db exploded');
      }),
    };
    await expect(
      runCustomerFeatureSnapshotOperation(baseInput(false), { reader: reader(), repository, runRepository, clock }),
    ).rejects.toThrow('db exploded');
    expect(runRepository.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('throws when dryRun is false and the repository/runRepository are missing', async () => {
    await expect(runCustomerFeatureSnapshotOperation(baseInput(false), { reader: reader(), clock })).rejects.toThrow(/required outside dry-run/);
  });
});
