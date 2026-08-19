import { sha256Stable } from '../customer-rfm/checksum.js';
import { assignNearestCentroid } from './assignment.js';
import { checksumVersion } from './model-version.js';
import { transformFeatureVector } from './preprocessing.js';
import { assertNoPiiInClusterValue } from './pii-guard.js';
import type { ClusterModelArtifact, ClusterSnapshotManifest, ClusterSnapshotRow, RawClusterFeatureVector } from './contracts.js';

// snapshotKey composition mirrors RFM's buildSnapshotKey (customer-rfm/dataset.ts): re-running
// the same model at the same referenceTime always resolves to the same key, which is what
// makes the idempotency check in create-cluster-snapshot.ts work (task Section 25).
export function buildClusterSnapshotKey(modelVersion: string, populationPolicyVersion: string, referenceTime: string): string {
  return [modelVersion, populationPolicyVersion, referenceTime.replace(/[:.]/g, '-')].join('__');
}

export type ClusterPopulationRow = {
  readonly prestashopCustomerId: number;
  readonly features: RawClusterFeatureVector;
};

export type BuildClusterSnapshotInput = {
  readonly artifact: ClusterModelArtifact;
  readonly referenceTime: string;
  readonly generatedAt: string;
  readonly populationRows: readonly ClusterPopulationRow[];
};

export type BuiltClusterSnapshot = {
  readonly snapshotKey: string;
  readonly rows: readonly ClusterSnapshotRow[];
  readonly manifest: ClusterSnapshotManifest;
  readonly datasetChecksum: string;
  readonly assignmentChecksum: string;
};

// TS-native assignment end to end: raw population features -> transform (using the model's
// persisted parameters) -> nearest-centroid. Never calls Python (task Section 28).
export function buildClusterSnapshot(input: BuildClusterSnapshotInput): BuiltClusterSnapshot {
  if (input.populationRows.length === 0) {
    throw new Error('Cannot build a cluster snapshot for an empty population');
  }
  const sortedPopulation = [...input.populationRows].sort((a, b) => a.prestashopCustomerId - b.prestashopCustomerId);
  assertNoDuplicateCustomers(sortedPopulation);

  // Checksum over the RAW extraction the snapshot was built from — used only for the
  // idempotency guard (same key + matching checksum => skip; mismatch => conflict). Distinct
  // from assignmentChecksum below, which covers the actual published output.
  const datasetChecksum = sha256Stable({
    featureVersion: input.artifact.featureVersion,
    populationPolicyVersion: input.artifact.populationPolicyVersion,
    checksumVersion,
    rows: sortedPopulation,
  });

  const rows: ClusterSnapshotRow[] = sortedPopulation.map((populationRow) => {
    const transformed = transformFeatureVector(populationRow.features, input.artifact.featureOrder, input.artifact.transforms);
    const assignment = assignNearestCentroid(transformed, input.artifact.centroids);
    return {
      prestashopCustomerId: populationRow.prestashopCustomerId,
      clusterId: assignment.clusterId,
      distanceToCentroid: assignment.distanceToCentroid,
    };
  });

  // Canonical representation (task Section 26): sorted customerId, clusterId, distance fixed
  // to a stable decimal string — no generatedAt or other variable timestamp included.
  const assignmentChecksum = sha256Stable({
    checksumVersion,
    modelVersion: input.artifact.modelVersion,
    rows: rows.map((row) => ({
      prestashopCustomerId: row.prestashopCustomerId,
      clusterId: row.clusterId,
      distanceToCentroid: row.distanceToCentroid.toFixed(10),
    })),
  });

  const snapshotKey = buildClusterSnapshotKey(input.artifact.modelVersion, input.artifact.populationPolicyVersion, input.referenceTime);
  const clusterSizeDistribution: Record<string, number> = {};
  for (const row of rows) {
    const key = String(row.clusterId);
    clusterSizeDistribution[key] = (clusterSizeDistribution[key] ?? 0) + 1;
  }

  const manifest: ClusterSnapshotManifest = {
    snapshotKey,
    modelVersion: input.artifact.modelVersion,
    referenceTime: input.referenceTime,
    populationPolicyVersion: input.artifact.populationPolicyVersion,
    populationSize: rows.length,
    datasetChecksum,
    assignmentChecksum,
    generatedAt: input.generatedAt,
    clusterSizeDistribution,
  };
  assertNoPiiInClusterValue(manifest, 'manifest');

  return { snapshotKey, rows, manifest, datasetChecksum, assignmentChecksum };
}

function assertNoDuplicateCustomers(rows: readonly ClusterPopulationRow[]): void {
  const seen = new Set<number>();
  for (const row of rows) {
    if (seen.has(row.prestashopCustomerId)) {
      throw new Error(`Duplicate prestashopCustomerId in cluster population: ${row.prestashopCustomerId}`);
    }
    seen.add(row.prestashopCustomerId);
  }
}
