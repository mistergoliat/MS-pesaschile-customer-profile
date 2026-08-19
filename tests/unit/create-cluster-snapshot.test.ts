import { describe, expect, it, vi } from 'vitest';
import { createClusterSnapshot, ClusterSnapshotKeyConflictError } from '../../src/application/customer-clustering/create-cluster-snapshot.js';
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
    trainingPopulationSize: 2,
    trainingDatasetChecksum: 'a'.repeat(64),
    metrics: {
      silhouette: 0.2,
      daviesBouldin: 1.3,
      calinskiHarabasz: 2000,
      seedAriMean: 0.99,
      seedAriMin: 0.98,
      resampleAriMean: 0.98,
      resampleAriMin: 0.96,
    },
    temporalStabilityStatus: 'not_yet_validated',
    interpretationMapping: Array.from({ length: k }, (_, id) => ({ clusterId: id, label: `L${id}`, matchedReferenceLabel: `L${id}`, matchDistance: 0 })),
    trainedAt: '2026-08-19T00:00:05.000Z',
  });
}

function readerWith(rows: readonly { prestashopCustomerId: number; features: RawClusterFeatureVector }[]): ClusterPopulationReader {
  return { readPopulation: vi.fn(async () => rows) };
}

function row(customerId: number): { prestashopCustomerId: number; features: RawClusterFeatureVector } {
  return { prestashopCustomerId: customerId, features: Object.fromEntries(featureOrder.map((f) => [f, 0])) as RawClusterFeatureVector };
}

describe('createClusterSnapshot', () => {
  it('dry_run mode never touches the repository', async () => {
    const artifact = buildArtifact();
    const reader = readerWith([row(1), row(2)]);
    const repository: ClusterSnapshotRepository = {
      findPublishedSnapshot: vi.fn(),
      publishSnapshot: vi.fn(),
    };
    const result = await createClusterSnapshot(
      { artifact, modelId: '1', referenceTime: '2026-08-19T00:00:00.000Z', generatedAt: 'A', dryRun: true },
      { reader, repository },
    );
    expect(result.mode).toBe('dry_run');
    expect(result.snapshotId).toBeNull();
    expect(repository.findPublishedSnapshot).not.toHaveBeenCalled();
    expect(repository.publishSnapshot).not.toHaveBeenCalled();
  });

  it('persists a new snapshot when none exists for the key', async () => {
    const artifact = buildArtifact();
    const reader = readerWith([row(1), row(2)]);
    const repository: ClusterSnapshotRepository = {
      findPublishedSnapshot: vi.fn(async () => null),
      publishSnapshot: vi.fn(async (input) => ({
        snapshotId: '42',
        persistedRowCount: input.rows.length,
        assignmentChecksum: input.assignmentChecksum,
      })),
    };
    const result = await createClusterSnapshot(
      { artifact, modelId: '1', referenceTime: '2026-08-19T00:00:00.000Z', generatedAt: 'A', dryRun: false },
      { reader, repository },
    );
    expect(result.mode).toBe('persisted');
    expect(result.snapshotId).toBe('42');
  });

  it('returns skipped_existing when a matching snapshot is already published (idempotency)', async () => {
    const artifact = buildArtifact();
    const reader = readerWith([row(1), row(2)]);
    // Compute the checksum a first dry run would produce, so the fake "existing" matches.
    const firstBuild = await createClusterSnapshot(
      { artifact, modelId: '1', referenceTime: '2026-08-19T00:00:00.000Z', generatedAt: 'A', dryRun: true },
      { reader },
    );
    const existingChecksum = firstBuild.manifest.assignmentChecksum;

    const repository: ClusterSnapshotRepository = {
      findPublishedSnapshot: vi.fn(async () => ({ snapshotId: '7', assignmentChecksum: existingChecksum })),
      publishSnapshot: vi.fn(),
    };
    const result = await createClusterSnapshot(
      { artifact, modelId: '1', referenceTime: '2026-08-19T00:00:00.000Z', generatedAt: 'A', dryRun: false },
      { reader, repository },
    );
    expect(result.mode).toBe('skipped_existing');
    expect(result.snapshotId).toBe('7');
    expect(repository.publishSnapshot).not.toHaveBeenCalled();
  });

  it('throws ClusterSnapshotKeyConflictError when the same key already published a different assignment', async () => {
    const artifact = buildArtifact();
    const reader = readerWith([row(1), row(2)]);
    const repository: ClusterSnapshotRepository = {
      findPublishedSnapshot: vi.fn(async () => ({ snapshotId: '7', assignmentChecksum: 'f'.repeat(64) })),
      publishSnapshot: vi.fn(),
    };
    await expect(
      createClusterSnapshot(
        { artifact, modelId: '1', referenceTime: '2026-08-19T00:00:00.000Z', generatedAt: 'A', dryRun: false },
        { reader, repository },
      ),
    ).rejects.toThrow(ClusterSnapshotKeyConflictError);
  });

  it('throws when dryRun is false and no repository is provided', async () => {
    const artifact = buildArtifact();
    const reader = readerWith([row(1), row(2)]);
    await expect(
      createClusterSnapshot({ artifact, modelId: '1', referenceTime: '2026-08-19T00:00:00.000Z', generatedAt: 'A', dryRun: false }, { reader }),
    ).rejects.toThrow(/repository is required/);
  });
});
