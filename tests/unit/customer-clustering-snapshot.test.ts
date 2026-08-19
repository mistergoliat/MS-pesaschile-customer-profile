import { describe, expect, it } from 'vitest';
import { buildClusterSnapshot, buildClusterSnapshotKey } from '../../src/domain/customer-clustering/snapshot.js';
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
import type { RawClusterFeatureVector } from '../../src/domain/customer-clustering/contracts.js';

function buildArtifact() {
  const transforms = Object.fromEntries(featureOrder.map((feature) => [feature, { kind: 'clip01' as const }]));
  // Two well-separated centroids so assignment is deterministic and easy to reason about.
  const centroids = [featureOrder.map(() => 0), featureOrder.map(() => 1), featureOrder.map(() => 0.5), featureOrder.map(() => 0.25)];
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
    trainingPopulationSize: 3,
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
    interpretationMapping: Array.from({ length: k }, (_, clusterId) => ({
      clusterId,
      label: `LABEL_${clusterId}`,
      matchedReferenceLabel: `LABEL_${clusterId}`,
      matchDistance: 0.01,
    })),
    trainedAt: '2026-08-19T00:00:05.000Z',
  });
}

function populationRow(customerId: number, value: number): { prestashopCustomerId: number; features: RawClusterFeatureVector } {
  const features = Object.fromEntries(featureOrder.map((f) => [f, value])) as RawClusterFeatureVector;
  return { prestashopCustomerId: customerId, features };
}

describe('buildClusterSnapshotKey', () => {
  it('is deterministic for the same inputs (idempotency precondition)', () => {
    const a = buildClusterSnapshotKey('m-v1', 'p-v1', '2026-08-19T00:00:00.000Z');
    const b = buildClusterSnapshotKey('m-v1', 'p-v1', '2026-08-19T00:00:00.000Z');
    expect(a).toBe(b);
  });

  it('changes when the referenceTime changes', () => {
    const a = buildClusterSnapshotKey('m-v1', 'p-v1', '2026-08-19T00:00:00.000Z');
    const b = buildClusterSnapshotKey('m-v1', 'p-v1', '2026-09-19T00:00:00.000Z');
    expect(a).not.toBe(b);
  });
});

describe('buildClusterSnapshot', () => {
  it('assigns every population row to its nearest centroid, sorted by customerId', () => {
    const artifact = buildArtifact();
    const built = buildClusterSnapshot({
      artifact,
      referenceTime: '2026-08-19T00:00:00.000Z',
      generatedAt: '2026-08-19T00:00:05.000Z',
      populationRows: [populationRow(30, 1), populationRow(10, 0), populationRow(20, 0.5)],
    });

    expect(built.rows.map((r) => r.prestashopCustomerId)).toEqual([10, 20, 30]);
    expect(built.rows[0]?.clusterId).toBe(0);
    expect(built.rows[1]?.clusterId).toBe(2);
    expect(built.rows[2]?.clusterId).toBe(1);
  });

  it('produces a deterministic assignmentChecksum regardless of input row order', () => {
    const artifact = buildArtifact();
    const rowsAsc = [populationRow(10, 0), populationRow(20, 0.5), populationRow(30, 1)];
    const rowsShuffled = [populationRow(30, 1), populationRow(10, 0), populationRow(20, 0.5)];

    const a = buildClusterSnapshot({ artifact, referenceTime: '2026-08-19T00:00:00.000Z', generatedAt: 'A', populationRows: rowsAsc });
    const b = buildClusterSnapshot({ artifact, referenceTime: '2026-08-19T00:00:00.000Z', generatedAt: 'B', populationRows: rowsShuffled });

    expect(a.assignmentChecksum).toBe(b.assignmentChecksum);
  });

  it('reports a cluster size distribution that sums to the population size', () => {
    const artifact = buildArtifact();
    const built = buildClusterSnapshot({
      artifact,
      referenceTime: '2026-08-19T00:00:00.000Z',
      generatedAt: 'A',
      populationRows: [populationRow(10, 0), populationRow(20, 0), populationRow(30, 1)],
    });
    const total = Object.values(built.manifest.clusterSizeDistribution).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(3);
  });

  it('throws for an empty population rather than publishing an empty snapshot', () => {
    const artifact = buildArtifact();
    expect(() =>
      buildClusterSnapshot({ artifact, referenceTime: '2026-08-19T00:00:00.000Z', generatedAt: 'A', populationRows: [] }),
    ).toThrow(/empty population/);
  });

  it('throws on a duplicate customerId in the population', () => {
    const artifact = buildArtifact();
    expect(() =>
      buildClusterSnapshot({
        artifact,
        referenceTime: '2026-08-19T00:00:00.000Z',
        generatedAt: 'A',
        populationRows: [populationRow(10, 0), populationRow(10, 1)],
      }),
    ).toThrow(/Duplicate prestashopCustomerId/);
  });
});
