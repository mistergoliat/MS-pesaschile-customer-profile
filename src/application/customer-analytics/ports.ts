import type {
  CustomerFeatureRow,
  CustomerFeatureSnapshotManifest,
  CustomerFeatureSourceRow,
} from '../../domain/customer-analytics/index.js';

export interface CustomerFeatureReader {
  readPopulation(): Promise<readonly CustomerFeatureSourceRow[]>;
}

export type PublishedCustomerFeatureSnapshotLookup = {
  readonly snapshotId: string;
  readonly featureDatasetChecksum: string;
  readonly sourceDatasetChecksum: string;
};

export type PersistCustomerFeatureSnapshotInput = {
  readonly snapshotKey: string;
  readonly referenceTime: string;
  readonly featureVersion: string;
  readonly populationPolicyVersion: string;
  readonly operationalExclusionPolicyVersion: string;
  readonly shopScope: string;
  readonly populationSize: number;
  readonly sourceDatasetChecksum: string;
  readonly featureDatasetChecksum: string;
  readonly generatedAt: string;
  readonly manifest: CustomerFeatureSnapshotManifest;
  readonly rows: readonly CustomerFeatureRow[];
};

export type PersistCustomerFeatureSnapshotResult = {
  readonly snapshotId: string;
  readonly persistedRowCount: number;
  readonly featureDatasetChecksum: string;
};

export interface CustomerFeatureSnapshotRepository {
  findPublishedSnapshot(snapshotKey: string): Promise<PublishedCustomerFeatureSnapshotLookup | null>;
  publishSnapshot(input: PersistCustomerFeatureSnapshotInput): Promise<PersistCustomerFeatureSnapshotResult>;
}

export type StoredCustomerFeatureSnapshot = {
  readonly snapshotId: string;
  readonly featureVersion: string;
  readonly populationPolicyVersion: string;
  readonly referenceTime: Date;
  readonly generatedAt: Date;
  readonly publishedAt: Date;
  readonly populationSize: number;
  readonly sourceDatasetChecksum: string;
  readonly featureDatasetChecksum: string;
  readonly status: 'building' | 'validated' | 'published' | 'failed' | 'superseded';
};

export interface CustomerFeatureSnapshotReader {
  // Latest published snapshot only, never a building/validated/failed one — mirrors
  // mysql-cluster-snapshot-reader.ts's own convention.
  getLatestPublishedSnapshot(): Promise<StoredCustomerFeatureSnapshot | null>;
  // Any snapshot that has ever been published, including one since superseded — a historical
  // read stays available by explicit id (task Section 44/51).
  getSnapshotById(snapshotId: string): Promise<StoredCustomerFeatureSnapshot | null>;
  getRow(snapshotId: string, prestashopCustomerId: number): Promise<CustomerFeatureRow | null>;
}
