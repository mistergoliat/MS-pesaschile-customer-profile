import { describe, expect, it, vi } from 'vitest';
import { runClusterSnapshotOperation } from '../../src/application/customer-clustering/run-cluster-snapshot-operation.js';
import { assertValidClusterModelArtifact } from '../../src/domain/customer-clustering/artifact.js';
import {
  algorithm,
  artifactVersion,
  featureOrder,
  featureVersion,
  k,
  modelVersion,
  operationalAccountExclusionPolicyVersion,
  populationPolicyVersion,
  populationScope,
  preprocessingVersion,
  trainingSeed,
} from '../../src/domain/customer-clustering/model-version.js';
import type { ClusterPopulationReader, ClusterSnapshotRepository } from '../../src/application/customer-clustering/ports.js';
import type { ClusterSnapshotRunRepository } from '../../src/infrastructure/clustering/mysql-cluster-snapshot-run-repository.js';
import type { RawClusterFeatureVector } from '../../src/domain/customer-clustering/contracts.js';

function buildArtifact() {
  const transforms = Object.fromEntries(featureOrder.map((feature) => [feature, { kind: 'clip01' as const }]));
  const centroids = Array.from({ length: k }, (_, id) => featureOrder.map(() => id));
  return assertValidClusterModelArtifact({
    artifactVersion,
    modelVersion,
    algorithm,
    k,
    trainingSeed,
    featureVersion,
    preprocessingVersion,
    populationPolicyVersion,
    operationalAccountExclusionPolicyVersion,
    shopScope: populationScope,
    featureOrder,
    transforms,
    centroids,
    trainingReferenceTime: '2026-08-19T00:00:00.000Z',
    trainingPopulationSize: 1,
    trainingDatasetChecksum: 'a'.repeat(64),
    metrics: { silhouette: 0.2, daviesBouldin: 1.3, calinskiHarabasz: 2000, seedAriMean: 0.99, seedAriMin: 0.98, resampleAriMean: 0.98, resampleAriMin: 0.96 },
    temporalStabilityStatus: 'not_yet_validated',
    interpretationMapping: Array.from({ length: k }, (_, id) => ({ clusterId: id, label: `L${id}`, matchedReferenceLabel: `L${id}`, matchDistance: 0 })),
    trainedAt: '2026-08-19T00:00:05.000Z',
  });
}

function reader(): ClusterPopulationReader {
  const features = Object.fromEntries(featureOrder.map((f) => [f, 0])) as RawClusterFeatureVector;
  return { readPopulation: vi.fn(async () => [{ prestashopCustomerId: 1, features }]) };
}

function lockedRunRepository(): ClusterSnapshotRunRepository {
  return {
    tryAcquireExecutionLock: vi.fn(async () => ({ release: vi.fn(async () => undefined) })),
    createRun: vi.fn(async () => '100'),
    completeRun: vi.fn(async () => undefined),
  };
}

const clock = { now: () => new Date('2026-08-19T00:00:10.000Z') };

describe('runClusterSnapshotOperation', () => {
  it('dry run succeeds without any repository dependency', async () => {
    const result = await runClusterSnapshotOperation(
      { triggerSource: 'manual', artifact: buildArtifact(), modelId: '1', dryRun: true, referenceTime: '2026-08-19T00:00:00.000Z', generatedAt: null },
      { reader: reader(), clock },
    );
    expect(result.status).toBe('succeeded');
    expect(result.mode).toBe('dry_run');
    expect(result.runId).toBeNull();
  });

  it('persists via the repository and logs a succeeded run when the lock is acquired', async () => {
    const runRepository = lockedRunRepository();
    const repository: ClusterSnapshotRepository = {
      findPublishedSnapshot: vi.fn(async () => null),
      publishSnapshot: vi.fn(async (input) => ({ snapshotId: '5', persistedRowCount: input.rows.length, assignmentChecksum: input.assignmentChecksum })),
    };
    const result = await runClusterSnapshotOperation(
      { triggerSource: 'manual', artifact: buildArtifact(), modelId: '1', dryRun: false, referenceTime: '2026-08-19T00:00:00.000Z', generatedAt: null },
      { reader: reader(), repository, runRepository, clock },
    );
    expect(result.status).toBe('succeeded');
    expect(result.snapshotId).toBe('5');
    expect(runRepository.createRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'started' }));
    expect(runRepository.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'succeeded', snapshotId: '5' }));
  });

  it('logs a skipped run without acquiring work when the execution lock is already held', async () => {
    const runRepository: ClusterSnapshotRunRepository = {
      tryAcquireExecutionLock: vi.fn(async () => null),
      createRun: vi.fn(async () => '101'),
      completeRun: vi.fn(async () => undefined),
    };
    const repository: ClusterSnapshotRepository = { findPublishedSnapshot: vi.fn(), publishSnapshot: vi.fn() };
    const result = await runClusterSnapshotOperation(
      { triggerSource: 'manual', artifact: buildArtifact(), modelId: '1', dryRun: false, referenceTime: '2026-08-19T00:00:00.000Z', generatedAt: null },
      { reader: reader(), repository, runRepository, clock },
    );
    expect(result.status).toBe('skipped');
    expect(result.skipReason).toBe('execution_lock_not_acquired');
    expect(repository.publishSnapshot).not.toHaveBeenCalled();
  });

  it('marks the run failed and releases the lock when persistence throws', async () => {
    const runRepository = lockedRunRepository();
    const repository: ClusterSnapshotRepository = {
      findPublishedSnapshot: vi.fn(async () => null),
      publishSnapshot: vi.fn(async () => {
        throw new Error('db exploded');
      }),
    };
    await expect(
      runClusterSnapshotOperation(
        { triggerSource: 'manual', artifact: buildArtifact(), modelId: '1', dryRun: false, referenceTime: '2026-08-19T00:00:00.000Z', generatedAt: null },
        { reader: reader(), repository, runRepository, clock },
      ),
    ).rejects.toThrow('db exploded');
    expect(runRepository.completeRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('throws when dryRun is false and the repository/runRepository are missing', async () => {
    await expect(
      runClusterSnapshotOperation(
        { triggerSource: 'manual', artifact: buildArtifact(), modelId: '1', dryRun: false, referenceTime: '2026-08-19T00:00:00.000Z', generatedAt: null },
        { reader: reader(), clock },
      ),
    ).rejects.toThrow(/required outside dry-run/);
  });
});
