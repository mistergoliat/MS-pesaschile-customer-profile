import { sha256Stable } from '../customer-rfm/checksum.js';
import { assertNoPiiInClusterValue } from './pii-guard.js';
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
  type ClusterFeatureName,
} from './model-version.js';
import type { ClusterModelArtifact, ClusterModelMetrics, FeatureTransform } from './contracts.js';

export function computeArtifactChecksum(artifact: Omit<ClusterModelArtifact, 'artifactChecksum'>): string {
  return sha256Stable(artifact);
}

// Validates a JSON artifact produced by the Python training script (never trusted blindly —
// task Section 55: "feature schema cambia durante el run" / "checksum no puede reproducirse"
// are both explicit fail-fast triggers). Confirms it matches THIS service's currently-pinned
// version constants (not just "is well-formed JSON") so a stale or foreign artifact can never
// be silently registered as the approved production model.
export function assertValidClusterModelArtifact(value: unknown): ClusterModelArtifact {
  if (!value || typeof value !== 'object') {
    throw new Error('Cluster model artifact must be an object');
  }
  const artifact = value as Record<string, unknown>;

  assertEquals(artifact.artifactVersion, artifactVersion, 'artifactVersion');
  assertEquals(artifact.modelVersion, modelVersion, 'modelVersion');
  assertEquals(artifact.algorithm, algorithm, 'algorithm');
  assertEquals(artifact.k, k, 'k');
  assertEquals(artifact.trainingSeed, trainingSeed, 'trainingSeed');
  assertEquals(artifact.featureVersion, featureVersion, 'featureVersion');
  assertEquals(artifact.preprocessingVersion, preprocessingVersion, 'preprocessingVersion');
  assertEquals(artifact.populationPolicyVersion, populationPolicyVersion, 'populationPolicyVersion');
  assertEquals(
    artifact.operationalAccountExclusionPolicyVersion,
    operationalAccountExclusionPolicyVersion,
    'operationalAccountExclusionPolicyVersion',
  );
  assertEquals(artifact.shopScope, populationScope, 'shopScope');

  const artifactFeatureOrder = artifact.featureOrder;
  if (!Array.isArray(artifactFeatureOrder) || artifactFeatureOrder.length !== featureOrder.length) {
    throw new Error(`Invalid featureOrder: expected ${featureOrder.length} features`);
  }
  for (let i = 0; i < featureOrder.length; i += 1) {
    if (artifactFeatureOrder[i] !== featureOrder[i]) {
      throw new Error(`featureOrder mismatch at index ${i}: expected ${featureOrder[i]}, got ${String(artifactFeatureOrder[i])}`);
    }
  }

  const transforms = assertTransforms(artifact.transforms);
  const centroids = assertCentroids(artifact.centroids, featureOrder.length);
  if (centroids.length !== k) {
    throw new Error(`Expected ${k} centroids, got ${centroids.length}`);
  }

  const trainingReferenceTime = assertNonEmptyString(artifact.trainingReferenceTime, 'trainingReferenceTime');
  const trainingPopulationSize = assertPositiveInteger(artifact.trainingPopulationSize, 'trainingPopulationSize');
  const trainingDatasetChecksum = assertChecksum(artifact.trainingDatasetChecksum, 'trainingDatasetChecksum');
  const metrics = assertMetrics(artifact.metrics);
  const temporalStabilityStatus = artifact.temporalStabilityStatus;
  if (temporalStabilityStatus !== 'not_yet_validated' && temporalStabilityStatus !== 'preliminary' && temporalStabilityStatus !== 'validated') {
    throw new Error(`Invalid temporalStabilityStatus: ${String(temporalStabilityStatus)}`);
  }
  const interpretationMapping = assertInterpretationMapping(artifact.interpretationMapping, k);
  const trainedAt = assertNonEmptyString(artifact.trainedAt, 'trainedAt');

  // artifactChecksum is deliberately NEVER trusted from the input (Python's JSON output may
  // carry one, but it is ignored) and always (re)computed here in TypeScript. Python and
  // TypeScript's JSON number formatting are not guaranteed byte-identical (e.g. exponential
  // notation thresholds differ), so requiring Python to reproduce TS's canonical
  // stableStringify exactly would be a fragile, hard-to-verify cross-language contract. TS
  // owns the checksum of record; Python only owns getting the numbers right.
  const withoutChecksum: Omit<ClusterModelArtifact, 'artifactChecksum'> = {
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
    trainingReferenceTime,
    trainingPopulationSize,
    trainingDatasetChecksum,
    metrics,
    temporalStabilityStatus,
    interpretationMapping,
    trainedAt,
  };
  const built: ClusterModelArtifact = { ...withoutChecksum, artifactChecksum: computeArtifactChecksum(withoutChecksum) };

  assertNoPiiInClusterValue(built, 'artifact');
  return built;
}

function assertEquals(actual: unknown, expected: unknown, field: string): void {
  if (actual !== expected) {
    throw new Error(`Cluster model artifact ${field} mismatch: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}

function assertPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return value;
}

function assertChecksum(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`Invalid ${field}: expected a sha256 hex digest`);
  }
  return value;
}

function assertFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return value;
}

function assertTransforms(value: unknown): Readonly<Record<ClusterFeatureName, FeatureTransform>> {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid transforms');
  }
  const record = value as Record<string, unknown>;
  const result: Record<string, FeatureTransform> = {};
  for (const feature of featureOrder) {
    const raw = record[feature];
    if (!raw || typeof raw !== 'object') {
      throw new Error(`Missing transform for feature ${feature}`);
    }
    const transform = raw as Record<string, unknown>;
    switch (transform.kind) {
      case 'log1p_robust_scale':
      case 'robust_scale':
        result[feature] = {
          kind: transform.kind,
          center: assertFiniteNumber(transform.center, `${feature}.center`),
          scale: assertFiniteNumber(transform.scale, `${feature}.scale`),
        };
        break;
      case 'clip01':
        result[feature] = { kind: 'clip01' };
        break;
      case 'winsorize_p99':
        result[feature] = { kind: 'winsorize_p99', cap: assertFiniteNumber(transform.cap, `${feature}.cap`) };
        break;
      default:
        throw new Error(`Invalid transform kind for feature ${feature}: ${String(transform.kind)}`);
    }
  }
  return result as Readonly<Record<ClusterFeatureName, FeatureTransform>>;
}

function assertCentroids(value: unknown, dimensions: number): readonly (readonly number[])[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Invalid centroids: expected a non-empty array');
  }
  return value.map((centroid, index) => {
    if (!Array.isArray(centroid) || centroid.length !== dimensions) {
      throw new Error(`Centroid ${index} must have exactly ${dimensions} dimensions`);
    }
    return centroid.map((component, componentIndex) => assertFiniteNumber(component, `centroid[${index}][${componentIndex}]`));
  });
}

function assertMetrics(value: unknown): ClusterModelMetrics {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid metrics');
  }
  const metrics = value as Record<string, unknown>;
  return {
    silhouette: assertFiniteNumber(metrics.silhouette, 'metrics.silhouette'),
    daviesBouldin: assertFiniteNumber(metrics.daviesBouldin, 'metrics.daviesBouldin'),
    calinskiHarabasz: assertFiniteNumber(metrics.calinskiHarabasz, 'metrics.calinskiHarabasz'),
    seedAriMean: assertFiniteNumber(metrics.seedAriMean, 'metrics.seedAriMean'),
    seedAriMin: assertFiniteNumber(metrics.seedAriMin, 'metrics.seedAriMin'),
    resampleAriMean: assertFiniteNumber(metrics.resampleAriMean, 'metrics.resampleAriMean'),
    resampleAriMin: assertFiniteNumber(metrics.resampleAriMin, 'metrics.resampleAriMin'),
  };
}

function assertInterpretationMapping(
  value: unknown,
  expectedK: number,
): readonly { readonly clusterId: number; readonly label: string; readonly matchedReferenceLabel: string; readonly matchDistance: number }[] {
  if (!Array.isArray(value) || value.length !== expectedK) {
    throw new Error(`Invalid interpretationMapping: expected ${expectedK} entries`);
  }
  const seenClusterIds = new Set<number>();
  const result = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Invalid interpretationMapping[${index}]`);
    }
    const mapping = entry as Record<string, unknown>;
    const clusterId = mapping.clusterId;
    if (typeof clusterId !== 'number' || !Number.isInteger(clusterId) || clusterId < 0 || clusterId >= expectedK) {
      throw new Error(`Invalid interpretationMapping[${index}].clusterId: ${String(clusterId)}`);
    }
    if (seenClusterIds.has(clusterId)) {
      throw new Error(`Duplicate clusterId in interpretationMapping: ${clusterId}`);
    }
    seenClusterIds.add(clusterId);
    return {
      clusterId,
      label: assertNonEmptyString(mapping.label, `interpretationMapping[${index}].label`),
      matchedReferenceLabel: assertNonEmptyString(mapping.matchedReferenceLabel, `interpretationMapping[${index}].matchedReferenceLabel`),
      matchDistance: assertFiniteNumber(mapping.matchDistance, `interpretationMapping[${index}].matchDistance`),
    };
  });
  return result;
}
