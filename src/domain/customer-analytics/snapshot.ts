import { sha256Stable } from '../customer-rfm/checksum.js';
import { deriveCustomerFeatureRow } from './feature-derivation.js';
import { assertNoPiiInAnalyticsValue } from './pii-guard.js';
import { checksumVersion } from './model-version.js';
import type {
  CustomerFeatureRow,
  CustomerFeatureSnapshotManifest,
  CustomerFeatureSourceRow,
} from './contracts.js';

// snapshotKey composition mirrors RFM's buildSnapshotKey and clustering's
// buildClusterSnapshotKey exactly (task Section 26): re-running the same feature version at
// the same referenceTime over the same population policy always resolves to the same key —
// the idempotency guard in create-customer-feature-snapshot.ts depends on this.
export function buildCustomerFeatureSnapshotKey(
  featureVersion: string,
  populationPolicyVersion: string,
  referenceTime: string,
): string {
  return [featureVersion, populationPolicyVersion, referenceTime.replace(/[:.]/g, '-')].join('__');
}

export type BuildCustomerFeatureSnapshotInput = {
  readonly featureVersion: string;
  readonly populationPolicyVersion: string;
  readonly operationalExclusionPolicyVersion: string;
  readonly shopScope: string;
  readonly referenceTime: string;
  readonly referenceTimeMysql: string;
  readonly generatedAt: string;
  readonly sourceRows: readonly CustomerFeatureSourceRow[];
};

export type BuiltCustomerFeatureSnapshot = {
  readonly snapshotKey: string;
  readonly rows: readonly CustomerFeatureRow[];
  readonly manifest: CustomerFeatureSnapshotManifest;
  readonly sourceDatasetChecksum: string;
  readonly featureDatasetChecksum: string;
};

// Pure assembly: raw PrestaShop extraction -> derived feature rows -> manifest + two
// independent checksums (task Section 27). Never calls a database — the reader owns
// extraction, this owns derivation/validation/checksumming only.
export function buildCustomerFeatureSnapshot(input: BuildCustomerFeatureSnapshotInput): BuiltCustomerFeatureSnapshot {
  if (input.sourceRows.length === 0) {
    throw new Error('Cannot build a customer feature snapshot for an empty population');
  }
  const sortedSourceRows = [...input.sourceRows].sort((a, b) => a.prestashopCustomerId - b.prestashopCustomerId);
  assertNoDuplicateCustomers(sortedSourceRows);

  // Checksum over the RAW extraction only — before any derivation math runs. If PrestaShop's
  // underlying order/product rows change retroactively for the same referenceTime, this
  // checksum changes even if the derivation formulas stay identical (task Section 28: source
  // drift detection).
  const sourceDatasetChecksum = sha256Stable({
    featureVersion: input.featureVersion,
    populationPolicyVersion: input.populationPolicyVersion,
    checksumVersion,
    rows: sortedSourceRows.map((row) => ({
      ...row,
      products: [...row.products].sort((a, b) => a.productId - b.productId),
    })),
  });

  const rows = sortedSourceRows.map((sourceRow) => deriveCustomerFeatureRow(sourceRow, input.referenceTimeMysql));

  // Checksum over the DERIVED, canonical output — this is what idempotency/re-run comparison
  // uses (mirrors clustering's assignmentChecksum). Distinct from sourceDatasetChecksum: a
  // code change to the derivation formulas changes this without necessarily changing the
  // former, and vice versa for a retroactive PrestaShop edit.
  const featureDatasetChecksum = sha256Stable({
    checksumVersion,
    featureVersion: input.featureVersion,
    rows,
  });

  const snapshotKey = buildCustomerFeatureSnapshotKey(input.featureVersion, input.populationPolicyVersion, input.referenceTime);

  const manifest: CustomerFeatureSnapshotManifest = {
    snapshotKey,
    featureVersion: input.featureVersion,
    populationPolicyVersion: input.populationPolicyVersion,
    operationalExclusionPolicyVersion: input.operationalExclusionPolicyVersion,
    shopScope: input.shopScope,
    referenceTime: input.referenceTime,
    populationSize: rows.length,
    sourceDatasetChecksum,
    featureDatasetChecksum,
    generatedAt: input.generatedAt,
  };
  assertNoPiiInAnalyticsValue(manifest, 'manifest');
  assertNoPiiInAnalyticsValue(rows, 'rows');

  return { snapshotKey, rows, manifest, sourceDatasetChecksum, featureDatasetChecksum };
}

function assertNoDuplicateCustomers(rows: readonly CustomerFeatureSourceRow[]): void {
  const seen = new Set<number>();
  for (const row of rows) {
    if (seen.has(row.prestashopCustomerId)) {
      throw new Error(`Duplicate prestashopCustomerId in customer feature population: ${row.prestashopCustomerId}`);
    }
    seen.add(row.prestashopCustomerId);
  }
}
