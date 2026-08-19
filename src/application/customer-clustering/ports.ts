import type {
  ClusterModelArtifact,
  ClusterSnapshotRow,
  CurrentClusterCustomerLookup,
} from '../../domain/customer-clustering/index.js';
import type { ClusterPopulationRow } from '../../domain/customer-clustering/snapshot.js';
import type { ClusterSnapshotManifest } from '../../domain/customer-clustering/contracts.js';

export interface ClusterPopulationReader {
  readPopulation(): Promise<readonly ClusterPopulationRow[]>;
}

export type StoredClusterModel = {
  readonly modelId: string;
  readonly artifact: ClusterModelArtifact;
  readonly status: 'building' | 'validated' | 'published' | 'failed' | 'superseded';
};

export interface ClusterModelRepository {
  findByModelVersion(modelVersion: string): Promise<StoredClusterModel | null>;
  insertModel(artifact: ClusterModelArtifact): Promise<{ readonly modelId: string }>;
}

export type InterpretationEntry = {
  readonly clusterId: number;
  readonly label: string;
  readonly description: string;
};

export interface ClusterInterpretationRepository {
  upsertInterpretations(
    modelId: string,
    interpretationVersion: string,
    entries: readonly InterpretationEntry[],
  ): Promise<void>;
}

export type PublishedClusterSnapshotLookup = {
  readonly snapshotId: string;
  readonly assignmentChecksum: string;
};

export type PersistClusterSnapshotInput = {
  readonly snapshotKey: string;
  readonly modelId: string;
  readonly referenceTime: string;
  readonly populationPolicyVersion: string;
  readonly populationSize: number;
  readonly datasetChecksum: string;
  readonly assignmentChecksum: string;
  readonly generatedAt: string;
  readonly manifest: ClusterSnapshotManifest;
  readonly rows: readonly ClusterSnapshotRow[];
};

export type PersistClusterSnapshotResult = {
  readonly snapshotId: string;
  readonly persistedRowCount: number;
  readonly assignmentChecksum: string;
};

export interface ClusterSnapshotRepository {
  findPublishedSnapshot(snapshotKey: string): Promise<PublishedClusterSnapshotLookup | null>;
  publishSnapshot(input: PersistClusterSnapshotInput): Promise<PersistClusterSnapshotResult>;
}

export interface CurrentClusterSnapshotReader {
  getCurrentCustomerClusterLookup(prestashopCustomerId: number): Promise<CurrentClusterCustomerLookup>;
}
