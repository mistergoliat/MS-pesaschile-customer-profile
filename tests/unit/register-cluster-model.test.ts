import { describe, expect, it, vi } from 'vitest';
import { registerClusterModel } from '../../src/application/customer-clustering/register-cluster-model.js';
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
import type { ClusterInterpretationRepository, ClusterModelRepository, StoredClusterModel } from '../../src/application/customer-clustering/ports.js';

function rawArtifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const transforms = Object.fromEntries(featureOrder.map((feature) => [feature, { kind: 'clip01' }]));
  const centroids = Array.from({ length: k }, (_, id) => featureOrder.map(() => id));
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
      silhouette: 0.2,
      daviesBouldin: 1.3,
      calinskiHarabasz: 2000,
      seedAriMean: 0.99,
      seedAriMin: 0.98,
      resampleAriMean: 0.98,
      resampleAriMin: 0.96,
    },
    temporalStabilityStatus: 'not_yet_validated',
    interpretationMapping: [
      { clusterId: 0, label: 'HIGH_VALUE_DIVERSIFIED_REPEAT_BUYERS', matchedReferenceLabel: 'HIGH_VALUE_DIVERSIFIED_REPEAT_BUYERS', matchDistance: 0.01 },
      { clusterId: 1, label: 'RECENTLY_ACTIVE_NEWER_REPEAT_BUYERS', matchedReferenceLabel: 'RECENTLY_ACTIVE_NEWER_REPEAT_BUYERS', matchDistance: 0.01 },
      { clusterId: 2, label: 'LONG_TENURE_DORMANT_SPREAD_OUT_REPEAT_BUYERS', matchedReferenceLabel: 'LONG_TENURE_DORMANT_SPREAD_OUT_REPEAT_BUYERS', matchDistance: 0.01 },
      { clusterId: 3, label: 'NEW_BURST_THEN_LAPSED_BUYERS', matchedReferenceLabel: 'NEW_BURST_THEN_LAPSED_BUYERS', matchDistance: 0.01 },
    ],
    trainedAt: '2026-08-19T00:00:05.000Z',
    ...overrides,
  };
}

describe('registerClusterModel', () => {
  it('validated_only mode never touches any repository', async () => {
    const result = await registerClusterModel({ rawArtifact: rawArtifact(), persist: false }, {});
    expect(result.mode).toBe('validated_only');
    expect(result.modelId).toBeNull();
  });

  it('propagates artifact validation errors even in validated_only mode', async () => {
    await expect(registerClusterModel({ rawArtifact: rawArtifact({ k: 99 }), persist: false }, {})).rejects.toThrow(/k mismatch/);
  });

  it('registers a new model and its interpretations when none exist yet', async () => {
    const modelRepository: ClusterModelRepository = {
      findByModelVersion: vi.fn(async () => null),
      insertModel: vi.fn(async () => ({ modelId: '9' })),
    };
    const interpretationRepository: ClusterInterpretationRepository = { upsertInterpretations: vi.fn(async () => {}) };

    const result = await registerClusterModel(
      { rawArtifact: rawArtifact(), persist: true },
      { modelRepository, interpretationRepository },
    );

    expect(result.mode).toBe('registered');
    expect(result.modelId).toBe('9');
    expect(interpretationRepository.upsertInterpretations).toHaveBeenCalledWith(
      '9',
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ clusterId: 0, label: 'HIGH_VALUE_DIVERSIFIED_REPEAT_BUYERS' })]),
    );
  });

  it('returns already_registered (not a duplicate insert) when the checksum matches an existing model', async () => {
    const artifact = rawArtifact();
    // Compute the real checksum the way the domain layer would, so the "matches" branch fires.
    const { assertValidClusterModelArtifact } = await import('../../src/domain/customer-clustering/artifact.js');
    const validated = assertValidClusterModelArtifact(artifact);
    const existing: StoredClusterModel = { modelId: '9', status: 'published', artifact: validated };

    const modelRepository: ClusterModelRepository = {
      findByModelVersion: vi.fn(async () => existing),
      insertModel: vi.fn(),
    };
    const interpretationRepository: ClusterInterpretationRepository = { upsertInterpretations: vi.fn(async () => {}) };

    const result = await registerClusterModel({ rawArtifact: artifact, persist: true }, { modelRepository, interpretationRepository });
    expect(result.mode).toBe('already_registered');
    expect(modelRepository.insertModel).not.toHaveBeenCalled();
  });

  it('refuses to overwrite a registered model whose checksum differs (same version, different content)', async () => {
    const artifact = rawArtifact();
    const { assertValidClusterModelArtifact } = await import('../../src/domain/customer-clustering/artifact.js');
    const validated = assertValidClusterModelArtifact(artifact);
    const existing: StoredClusterModel = {
      modelId: '9',
      status: 'published',
      artifact: { ...validated, artifactChecksum: 'f'.repeat(64) },
    };
    const modelRepository: ClusterModelRepository = { findByModelVersion: vi.fn(async () => existing), insertModel: vi.fn() };
    const interpretationRepository: ClusterInterpretationRepository = { upsertInterpretations: vi.fn(async () => {}) };

    await expect(
      registerClusterModel({ rawArtifact: artifact, persist: true }, { modelRepository, interpretationRepository }),
    ).rejects.toThrow(/different artifact checksum/);
  });

  it('throws when persist is true but no repositories are provided', async () => {
    await expect(registerClusterModel({ rawArtifact: rawArtifact(), persist: true }, {})).rejects.toThrow(/are required when persist is true/);
  });
});
