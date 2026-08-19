import {
  assertValidClusterModelArtifact,
  interpretationVersion,
  t01ReferenceInterpretations,
} from '../../domain/customer-clustering/index.js';
import type { ClusterInterpretationRepository, ClusterModelRepository } from './ports.js';

export type RegisterClusterModelInput = {
  readonly rawArtifact: unknown;
  readonly persist: boolean;
};

export type RegisterClusterModelResult = {
  readonly mode: 'validated_only' | 'registered' | 'already_registered';
  readonly modelVersion: string;
  readonly modelId: string | null;
  readonly artifactChecksum: string;
};

const referenceDescriptionsByLabel = new Map(t01ReferenceInterpretations.map((entry) => [entry.label, entry.description]));

// CLI-facing use case behind `npm run cluster:register-model` (task Section 30's "load/train
// approved model" step). Validates a Python-produced artifact against this service's pinned
// version constants + its own recomputed checksum (assertValidClusterModelArtifact), then
// optionally persists it and its Hungarian-matched interpretation labels — never both blindly
// trusted (task Section 44: an unvalidated interpretation mapping must not silently publish).
export async function registerClusterModel(
  input: RegisterClusterModelInput,
  deps: {
    readonly modelRepository?: ClusterModelRepository;
    readonly interpretationRepository?: ClusterInterpretationRepository;
  },
): Promise<RegisterClusterModelResult> {
  const artifact = assertValidClusterModelArtifact(input.rawArtifact);

  if (!input.persist) {
    return {
      mode: 'validated_only',
      modelVersion: artifact.modelVersion,
      modelId: null,
      artifactChecksum: artifact.artifactChecksum,
    };
  }

  if (!deps.modelRepository || !deps.interpretationRepository) {
    throw new Error('Model repository and interpretation repository are required when persist is true');
  }

  const existing = await deps.modelRepository.findByModelVersion(artifact.modelVersion);
  if (existing) {
    if (existing.artifact.artifactChecksum !== artifact.artifactChecksum) {
      throw new Error(
        `Cluster model ${artifact.modelVersion} is already registered with a different artifact checksum — refusing to overwrite`,
      );
    }
    return {
      mode: 'already_registered',
      modelVersion: artifact.modelVersion,
      modelId: existing.modelId,
      artifactChecksum: artifact.artifactChecksum,
    };
  }

  const { modelId } = await deps.modelRepository.insertModel(artifact);
  await deps.interpretationRepository.upsertInterpretations(
    modelId,
    interpretationVersion,
    artifact.interpretationMapping.map((mapping) => ({
      clusterId: mapping.clusterId,
      label: mapping.label,
      description: referenceDescriptionsByLabel.get(mapping.label) ?? 'No description recorded for this interpretation label.',
    })),
  );

  return {
    mode: 'registered',
    modelVersion: artifact.modelVersion,
    modelId,
    artifactChecksum: artifact.artifactChecksum,
  };
}
