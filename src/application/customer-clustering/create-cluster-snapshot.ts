import { buildClusterSnapshot } from '../../domain/customer-clustering/snapshot.js';
import type { ClusterModelArtifact, ClusterSnapshotManifest, ClusterSnapshotRow } from '../../domain/customer-clustering/index.js';
import type { ClusterPopulationReader, ClusterSnapshotRepository } from './ports.js';

export type CreateClusterSnapshotInput = {
  readonly artifact: ClusterModelArtifact;
  readonly modelId: string;
  readonly referenceTime: string;
  readonly generatedAt: string;
  readonly dryRun: boolean;
};

export type CreateClusterSnapshotResult = {
  readonly mode: 'dry_run' | 'persisted' | 'skipped_existing';
  readonly snapshotKey: string;
  readonly snapshotId: string | null;
  readonly manifest: ClusterSnapshotManifest;
  readonly rows: readonly ClusterSnapshotRow[];
};

export class ClusterSnapshotKeyConflictError extends Error {
  constructor() {
    super('A published cluster snapshot already exists for this snapshot key with a different assignment checksum');
    this.name = 'ClusterSnapshotKeyConflictError';
  }
}

// Mirrors create-rfm-snapshot.ts's idempotency shape exactly (task Section 25): same
// modelVersion + populationPolicyVersion + referenceTime always resolves to the same
// snapshotKey. Re-running with matching assignment output => skipped_existing, never a
// duplicate row set. A different assignment output under the same key is a hard conflict,
// never silently overwritten.
export async function createClusterSnapshot(
  input: CreateClusterSnapshotInput,
  deps: {
    readonly reader: ClusterPopulationReader;
    readonly repository?: ClusterSnapshotRepository;
  },
): Promise<CreateClusterSnapshotResult> {
  const populationRows = await deps.reader.readPopulation();
  const built = buildClusterSnapshot({
    artifact: input.artifact,
    referenceTime: input.referenceTime,
    generatedAt: input.generatedAt,
    populationRows,
  });

  if (input.dryRun) {
    return {
      mode: 'dry_run',
      snapshotKey: built.snapshotKey,
      snapshotId: null,
      manifest: built.manifest,
      rows: built.rows,
    };
  }

  if (!deps.repository) {
    throw new Error('Cluster snapshot repository is required when dryRun is false');
  }

  const existingSnapshot = await deps.repository.findPublishedSnapshot(built.snapshotKey);
  if (existingSnapshot) {
    if (existingSnapshot.assignmentChecksum === built.assignmentChecksum) {
      return {
        mode: 'skipped_existing',
        snapshotKey: built.snapshotKey,
        snapshotId: existingSnapshot.snapshotId,
        manifest: built.manifest,
        rows: built.rows,
      };
    }
    throw new ClusterSnapshotKeyConflictError();
  }

  const persisted = await deps.repository.publishSnapshot({
    snapshotKey: built.snapshotKey,
    modelId: input.modelId,
    referenceTime: input.referenceTime,
    populationPolicyVersion: input.artifact.populationPolicyVersion,
    populationSize: built.rows.length,
    datasetChecksum: built.datasetChecksum,
    assignmentChecksum: built.assignmentChecksum,
    generatedAt: input.generatedAt,
    manifest: built.manifest,
    rows: built.rows,
  });

  if (persisted.persistedRowCount !== built.rows.length) {
    throw new Error('Persisted cluster row count differs from calculated row count');
  }
  if (persisted.assignmentChecksum !== built.assignmentChecksum) {
    throw new Error('Persisted cluster assignment checksum differs from calculated checksum');
  }

  return {
    mode: 'persisted',
    snapshotKey: built.snapshotKey,
    snapshotId: persisted.snapshotId,
    manifest: built.manifest,
    rows: built.rows,
  };
}
