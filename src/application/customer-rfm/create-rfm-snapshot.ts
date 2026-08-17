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
  type CanonicalIdentityCoverageSummary,
  type CanonicalIdentityResolution,
  type BuiltRfmSnapshot,
  type RfmSnapshotManifest,
  type RfmSnapshotRow,
} from '../../domain/customer-rfm/index.js';
import { CrmSchemaIncompatibleError, CrmTimeoutError, CrmUnavailableError } from '../customer-profile/errors.js';
import type { RfmCanonicalIdentityResolver } from './ports.js';
import type { RfmPopulationReader } from '../../infrastructure/prestashop/mysql-rfm-population-reader.js';

export type RfmSnapshotRepository = {
  findPublishedSnapshot(snapshotKey: string): Promise<PublishedRfmSnapshot | null>;
  publishSnapshot(input: PersistRfmSnapshotInput): Promise<PersistRfmSnapshotResult>;
};

export type PublishedRfmSnapshot = {
  readonly snapshotId: string;
  readonly datasetChecksum: string;
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
  readonly mode: 'dry_run' | 'persisted' | 'skipped_existing';
  readonly snapshotKey: string;
  readonly snapshotId: string | null;
  readonly manifest: RfmSnapshotManifest;
  readonly rows: readonly RfmSnapshotRow[];
};

export class RfmSnapshotKeyConflictError extends Error {
  constructor() {
    super('A published RFM snapshot already exists for this snapshot key with a different dataset checksum');
    this.name = 'RfmSnapshotKeyConflictError';
  }
}

export async function createRfmSnapshot(
  input: CreateRfmSnapshotInput,
  deps: {
    readonly reader: RfmPopulationReader;
    readonly repository?: RfmSnapshotRepository;
    readonly canonicalIdentityResolver?: RfmCanonicalIdentityResolver;
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

  const canonicalIdentity = deps.canonicalIdentityResolver
    ? await resolveCanonicalIdentityFailOpen(deps.canonicalIdentityResolver, sourceRows.map((row) => row.prestashopCustomerId))
    : unmatchedCanonicalIdentity(sourceRows.map((row) => row.prestashopCustomerId));

  const built = buildRfmSnapshotDataset({
    referenceTime: window.referenceTime,
    windowStartInclusive: window.windowStartInclusive,
    windowEndExclusive: window.windowEndExclusive,
    generatedAt: input.generatedAt,
    calculationVersion: input.calculationVersion,
    sourceRows,
    diagnostics,
    canonicalIdentityResolutions: canonicalIdentity.resolutions,
    canonicalIdentityCoverage: canonicalIdentity.coverage,
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
  const existingSnapshot = await deps.repository.findPublishedSnapshot(snapshotKey);
  if (existingSnapshot) {
    if (existingSnapshot.datasetChecksum === built.datasetChecksum) {
      return {
        mode: 'skipped_existing',
        snapshotKey,
        snapshotId: existingSnapshot.snapshotId,
        manifest: withSnapshotId(built, existingSnapshot.snapshotId),
        rows: built.rows,
      };
    }
    throw new RfmSnapshotKeyConflictError();
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

// master_customer_id is an optional enrichment on every RFM row, never a precondition for
// the primary PrestaShop-rooted snapshot (see CP-R1-RFM-data-ownership-crm-architecture-
// audit.md §7/§14/§15). A CRM outage or schema gap (e.g. migration 001 not applied) must
// degrade every customer to "unmatched", never abort the snapshot — the same outcome as if
// no resolver had been wired at all. Only the three classified CRM infra-error types are
// caught here; an unrecognized error still propagates and aborts, since that indicates a
// real bug rather than a known, tolerable CRM degradation.
async function resolveCanonicalIdentityFailOpen(
  resolver: RfmCanonicalIdentityResolver,
  prestashopCustomerIds: readonly number[],
): Promise<{ resolutions: readonly CanonicalIdentityResolution[]; coverage: CanonicalIdentityCoverageSummary }> {
  try {
    return await resolver.resolvePrestashopCustomerIds(prestashopCustomerIds);
  } catch (error) {
    if (error instanceof CrmUnavailableError || error instanceof CrmTimeoutError || error instanceof CrmSchemaIncompatibleError) {
      return unmatchedCanonicalIdentity(prestashopCustomerIds);
    }
    throw error;
  }
}

function unmatchedCanonicalIdentity(
  prestashopCustomerIds: readonly number[],
): { resolutions: readonly CanonicalIdentityResolution[]; coverage: CanonicalIdentityCoverageSummary } {
  return {
    resolutions: prestashopCustomerIds.map((prestashopCustomerId) => ({
      prestashopCustomerId,
      status: 'unmatched' as const,
      masterCustomerId: null,
    })),
    coverage: buildDefaultCanonicalCoverage(prestashopCustomerIds.length),
  };
}

function buildDefaultCanonicalCoverage(populationSize: number): CanonicalIdentityCoverageSummary {
  return {
    populationSize,
    canonicalMatchedCount: 0,
    canonicalUnmatchedCount: populationSize,
    canonicalAmbiguousCount: 0,
    canonicalCoveragePct: '0.000000',
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
