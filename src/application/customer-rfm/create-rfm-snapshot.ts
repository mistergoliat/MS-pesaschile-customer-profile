import {
  buildRfmSnapshotDataset,
  buildRfmSnapshotWindow,
  buildSnapshotKey,
  currencyPolicyVersion,
  identityAuthority,
  identityAuthorityVersion,
  monetaryPolicyVersion,
  populationPolicyVersion,
  populationScope,
  refundPolicyVersion,
  scoringPolicyVersion,
  type BuiltRfmSnapshot,
  type RfmSnapshotManifest,
  type RfmSnapshotRow,
} from '../../domain/customer-rfm/index.js';
import type { RfmPopulationReader } from '../../infrastructure/prestashop/mysql-rfm-population-reader.js';

export type RfmSnapshotRepository = {
  hasPublishedSnapshot(snapshotKey: string): Promise<boolean>;
  publishSnapshot(input: PersistRfmSnapshotInput): Promise<PersistRfmSnapshotResult>;
};

export type PersistRfmSnapshotInput = {
  readonly snapshotKey: string;
  readonly referenceTime: string;
  readonly windowStartInclusive: string;
  readonly windowEndExclusive: string;
  readonly calculationVersion: string;
  readonly currencyCode: string;
  readonly populationSize: number;
  readonly validOrderCount: number;
  readonly grossOrderValueTaxIncl: string;
  readonly manifest: RfmSnapshotManifest;
  readonly datasetChecksum: string;
  readonly generatedAt: string;
  readonly rows: readonly RfmSnapshotRow[];
};

export type PersistRfmSnapshotResult = {
  readonly snapshotId: string;
  readonly persistedRowCount: number;
  readonly datasetChecksum: string;
};

export type CreateRfmSnapshotInput = {
  readonly referenceTime: string;
  readonly calculationVersion: string;
  readonly generatedAt: string;
  readonly dryRun: boolean;
};

export type CreateRfmSnapshotResult = {
  readonly mode: 'dry_run' | 'persisted';
  readonly snapshotKey: string;
  readonly snapshotId: string | null;
  readonly manifest: RfmSnapshotManifest;
  readonly rows: readonly RfmSnapshotRow[];
};

export async function createRfmSnapshot(
  input: CreateRfmSnapshotInput,
  deps: {
    readonly reader: RfmPopulationReader;
    readonly repository?: RfmSnapshotRepository;
  },
): Promise<CreateRfmSnapshotResult> {
  const window = buildRfmSnapshotWindow(input.referenceTime);
  const snapshotKey = buildSnapshotKey(window.referenceTime, input.calculationVersion);

  await deps.reader.verifySchema();
  const [sourceRows, diagnostics] = await Promise.all([
    deps.reader.readPopulation(toMysqlDateTime(window.windowStartInclusive), toMysqlDateTime(window.windowEndExclusive)),
    deps.reader.readDiagnostics(toMysqlDateTime(window.windowStartInclusive), toMysqlDateTime(window.windowEndExclusive)),
  ]);

  if (diagnostics.exclusions.unusableCustomerOrderCount > 0) {
    throw new Error('RFM source contains valid orders with unusable customer ids');
  }
  if (diagnostics.exclusions.missingPrestashopCustomerOrderCount > 0) {
    throw new Error('RFM source contains valid orders linked to missing ps_customer rows');
  }

  const built = buildRfmSnapshotDataset({
    referenceTime: window.referenceTime,
    windowStartInclusive: window.windowStartInclusive,
    windowEndExclusive: window.windowEndExclusive,
    generatedAt: input.generatedAt,
    calculationVersion: input.calculationVersion,
    sourceRows,
    diagnostics,
  });

  if (input.dryRun) {
    return {
      mode: 'dry_run',
      snapshotKey,
      snapshotId: null,
      manifest: built.manifest,
      rows: built.rows,
    };
  }

  if (!deps.repository) {
    throw new Error('RFM snapshot repository is required when RFM_DRY_RUN is false');
  }
  if (await deps.repository.hasPublishedSnapshot(snapshotKey)) {
    throw new Error('A published RFM snapshot already exists for this snapshot key');
  }

  const persisted = await deps.repository.publishSnapshot({
    snapshotKey,
    referenceTime: window.referenceTime,
    windowStartInclusive: window.windowStartInclusive,
    windowEndExclusive: window.windowEndExclusive,
    calculationVersion: input.calculationVersion,
    currencyCode: built.manifest.currencyCode,
    populationSize: built.rows.length,
    validOrderCount: built.manifest.validOrderCount,
    grossOrderValueTaxIncl: built.manifest.grossOrderValueTaxIncl,
    manifest: built.manifest,
    datasetChecksum: built.datasetChecksum,
    generatedAt: input.generatedAt,
    rows: built.rows,
  });

  if (persisted.persistedRowCount !== built.rows.length) {
    throw new Error('Persisted RFM row count differs from calculated row count');
  }
  if (persisted.datasetChecksum !== built.datasetChecksum) {
    throw new Error('Persisted RFM checksum differs from calculated checksum');
  }

  return {
    mode: 'persisted',
    snapshotKey,
    snapshotId: persisted.snapshotId,
    manifest: withSnapshotId(built, persisted.snapshotId),
    rows: built.rows,
  };
}

function withSnapshotId(built: BuiltRfmSnapshot, snapshotId: string): RfmSnapshotManifest {
  return {
    ...built.manifest,
    snapshotId,
  };
}

function toMysqlDateTime(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ');
}

export const rfmSnapshotContract = {
  identityAuthority,
  identityAuthorityVersion,
  populationScope,
  populationPolicyVersion,
  monetaryPolicyVersion,
  refundPolicyVersion,
  currencyPolicyVersion,
  scoringPolicyVersion,
} as const;
