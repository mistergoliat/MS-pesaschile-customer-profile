import { buildCustomerFeatureSnapshot } from '../../domain/customer-analytics/snapshot.js';
import type { CustomerFeatureRow, CustomerFeatureSnapshotManifest } from '../../domain/customer-analytics/index.js';
import type { CustomerFeatureReader, CustomerFeatureSnapshotRepository } from './ports.js';

export type CreateCustomerFeatureSnapshotInput = {
  readonly featureVersion: string;
  readonly populationPolicyVersion: string;
  readonly operationalExclusionPolicyVersion: string;
  readonly shopScope: string;
  readonly referenceTime: string;
  readonly referenceTimeMysql: string;
  readonly generatedAt: string;
  readonly dryRun: boolean;
};

export type CreateCustomerFeatureSnapshotResult = {
  readonly mode: 'dry_run' | 'persisted' | 'skipped_existing' | 'source_drift_detected';
  readonly snapshotKey: string;
  readonly snapshotId: string | null;
  readonly manifest: CustomerFeatureSnapshotManifest;
  readonly rows: readonly CustomerFeatureRow[];
  // Only populated for mode === 'source_drift_detected' (task Section 28) — the snapshot that
  // is already published under this exact key, left untouched.
  readonly priorSnapshotId: string | null;
  readonly priorSourceDatasetChecksum: string | null;
  readonly priorFeatureDatasetChecksum: string | null;
};

// Mirrors create-cluster-snapshot.ts's idempotency shape (task Section 25/26): same
// featureVersion + populationPolicyVersion + referenceTime always resolves to the same
// snapshotKey. Re-running with a matching featureDatasetChecksum => skipped_existing, never a
// duplicate row set.
//
// Deliberately diverges from clustering's hard-conflict-throw for a mismatch: clustering has
// no notion of a source that can drift retroactively out from under an already-published
// snapshot's own referenceTime, so a checksum mismatch there is always either an operator
// error or a genuine model bug. The Data Layer's whole reason for existing is to survive
// PrestaShop changing retroactively (task Section 15) — so the *same* situation here is a
// named, auditable outcome (source_drift_detected, task Section 28), not an exception. The
// prior published snapshot is never overwritten either way.
export async function createCustomerFeatureSnapshot(
  input: CreateCustomerFeatureSnapshotInput,
  deps: {
    readonly reader: CustomerFeatureReader;
    readonly repository?: CustomerFeatureSnapshotRepository;
  },
): Promise<CreateCustomerFeatureSnapshotResult> {
  const sourceRows = await deps.reader.readPopulation();
  const built = buildCustomerFeatureSnapshot({
    featureVersion: input.featureVersion,
    populationPolicyVersion: input.populationPolicyVersion,
    operationalExclusionPolicyVersion: input.operationalExclusionPolicyVersion,
    shopScope: input.shopScope,
    referenceTime: input.referenceTime,
    referenceTimeMysql: input.referenceTimeMysql,
    generatedAt: input.generatedAt,
    sourceRows,
  });

  if (input.dryRun) {
    return {
      mode: 'dry_run',
      snapshotKey: built.snapshotKey,
      snapshotId: null,
      manifest: built.manifest,
      rows: built.rows,
      priorSnapshotId: null,
      priorSourceDatasetChecksum: null,
      priorFeatureDatasetChecksum: null,
    };
  }

  if (!deps.repository) {
    throw new Error('Customer feature snapshot repository is required when dryRun is false');
  }

  const existingSnapshot = await deps.repository.findPublishedSnapshot(built.snapshotKey);
  if (existingSnapshot) {
    if (existingSnapshot.featureDatasetChecksum === built.featureDatasetChecksum) {
      return {
        mode: 'skipped_existing',
        snapshotKey: built.snapshotKey,
        snapshotId: existingSnapshot.snapshotId,
        manifest: built.manifest,
        rows: built.rows,
        priorSnapshotId: null,
        priorSourceDatasetChecksum: null,
        priorFeatureDatasetChecksum: null,
      };
    }
    return {
      mode: 'source_drift_detected',
      snapshotKey: built.snapshotKey,
      snapshotId: null,
      manifest: built.manifest,
      rows: built.rows,
      priorSnapshotId: existingSnapshot.snapshotId,
      priorSourceDatasetChecksum: existingSnapshot.sourceDatasetChecksum,
      priorFeatureDatasetChecksum: existingSnapshot.featureDatasetChecksum,
    };
  }

  const persisted = await deps.repository.publishSnapshot({
    snapshotKey: built.snapshotKey,
    referenceTime: input.referenceTime,
    featureVersion: input.featureVersion,
    populationPolicyVersion: input.populationPolicyVersion,
    operationalExclusionPolicyVersion: input.operationalExclusionPolicyVersion,
    shopScope: input.shopScope,
    populationSize: built.rows.length,
    sourceDatasetChecksum: built.sourceDatasetChecksum,
    featureDatasetChecksum: built.featureDatasetChecksum,
    generatedAt: input.generatedAt,
    manifest: built.manifest,
    rows: built.rows,
  });

  if (persisted.persistedRowCount !== built.rows.length) {
    throw new Error('Persisted customer feature row count differs from calculated row count');
  }
  if (persisted.featureDatasetChecksum !== built.featureDatasetChecksum) {
    throw new Error('Persisted customer feature dataset checksum differs from calculated checksum');
  }

  return {
    mode: 'persisted',
    snapshotKey: built.snapshotKey,
    snapshotId: persisted.snapshotId,
    manifest: built.manifest,
    rows: built.rows,
    priorSnapshotId: null,
    priorSourceDatasetChecksum: null,
    priorFeatureDatasetChecksum: null,
  };
}
