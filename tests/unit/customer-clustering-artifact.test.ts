import { describe, expect, it } from 'vitest';
import { assertValidClusterModelArtifact, computeArtifactChecksum } from '../../src/domain/customer-clustering/artifact.js';
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

function validRawArtifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const transforms = Object.fromEntries(featureOrder.map((feature) => [feature, { kind: 'clip01' }]));
  const centroids = Array.from({ length: k }, (_, clusterId) => featureOrder.map(() => clusterId + 0.1));
  return {
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
    trainingPopulationSize: 10145,
    trainingDatasetChecksum: 'a'.repeat(64),
    metrics: {
      silhouette: 0.2287,
      daviesBouldin: 1.3365,
      calinskiHarabasz: 2966.2,
      seedAriMean: 0.993,
      seedAriMin: 0.9857,
      resampleAriMean: 0.9852,
      resampleAriMin: 0.9693,
    },
    temporalStabilityStatus: 'not_yet_validated',
    interpretationMapping: Array.from({ length: k }, (_, clusterId) => ({
      clusterId,
      label: `LABEL_${clusterId}`,
      matchedReferenceLabel: `LABEL_${clusterId}`,
      matchDistance: 0.01,
    })),
    trainedAt: '2026-08-19T00:00:05.000Z',
    artifactChecksum: 'irrelevant — ignored and recomputed, see artifact.ts',
    ...overrides,
  };
}

describe('assertValidClusterModelArtifact', () => {
  it('accepts a well-formed artifact matching the currently pinned version constants', () => {
    const result = assertValidClusterModelArtifact(validRawArtifact());
    expect(result.modelVersion).toBe(modelVersion);
    expect(result.centroids).toHaveLength(k);
  });

  it('never trusts the input artifactChecksum — always recomputes it, ignoring whatever Python sent', () => {
    const result = assertValidClusterModelArtifact(validRawArtifact({ artifactChecksum: 'not-even-hex-formatted' }));
    const { artifactChecksum, ...withoutChecksum } = result;
    expect(artifactChecksum).toBe(computeArtifactChecksum(withoutChecksum));
  });

  it('rejects an artifact whose modelVersion does not match this service pinned constant', () => {
    expect(() => assertValidClusterModelArtifact(validRawArtifact({ modelVersion: 'some-other-model-v2' }))).toThrow(
      /modelVersion mismatch/,
    );
  });

  it('rejects an artifact whose k does not match the pinned constant', () => {
    expect(() => assertValidClusterModelArtifact(validRawArtifact({ k: 5 }))).toThrow(/k mismatch/);
  });

  it('rejects a featureOrder that does not exactly match the canonical order', () => {
    const shuffled = [...featureOrder].reverse();
    expect(() => assertValidClusterModelArtifact(validRawArtifact({ featureOrder: shuffled }))).toThrow(/featureOrder mismatch/);
  });

  it('rejects centroids with the wrong dimensionality', () => {
    const badCentroids = Array.from({ length: k }, () => [1, 2, 3]);
    expect(() => assertValidClusterModelArtifact(validRawArtifact({ centroids: badCentroids }))).toThrow(/dimensions/);
  });

  it('rejects a centroid count that does not match k', () => {
    const tooFew = [featureOrder.map(() => 0)];
    expect(() => assertValidClusterModelArtifact(validRawArtifact({ centroids: tooFew }))).toThrow(/Expected \d+ centroids/);
  });

  it('rejects a transform missing for one of the trained features', () => {
    const transforms = Object.fromEntries(featureOrder.slice(1).map((feature) => [feature, { kind: 'clip01' }]));
    expect(() => assertValidClusterModelArtifact(validRawArtifact({ transforms }))).toThrow(/Missing transform/);
  });

  it('rejects an interpretationMapping with a duplicate clusterId', () => {
    const mapping = Array.from({ length: k }, () => ({
      clusterId: 0,
      label: 'X',
      matchedReferenceLabel: 'X',
      matchDistance: 0,
    }));
    expect(() => assertValidClusterModelArtifact(validRawArtifact({ interpretationMapping: mapping }))).toThrow(/Duplicate clusterId/);
  });

  it('ignores unexpected extra fields on the raw input — the built artifact is reconstructed field-by-field, not spread', () => {
    const raw = validRawArtifact() as Record<string, unknown>;
    raw.customerEmail = 'someone@example.com';
    const result = assertValidClusterModelArtifact(raw);
    expect(JSON.stringify(result)).not.toContain('customerEmail');
  });

  it('rejects a PII-shaped value inside a legitimate structural field (interpretationMapping label)', () => {
    const raw = validRawArtifact();
    const mapping = raw.interpretationMapping as { clusterId: number; label: string; matchedReferenceLabel: string; matchDistance: number }[];
    mapping[0]!.label = 'someone@example.com';
    expect(() => assertValidClusterModelArtifact(raw)).toThrow(/PII-shaped/);
  });

  it('rejects a non-object input', () => {
    expect(() => assertValidClusterModelArtifact(null)).toThrow(/must be an object/);
    expect(() => assertValidClusterModelArtifact('a string')).toThrow(/must be an object/);
  });
});
