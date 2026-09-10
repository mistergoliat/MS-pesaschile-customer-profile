import type {
  AudienceExportArtifactV1,
  AudienceExportContactV1,
  AudienceExportFieldIdV1,
  AudienceExportFormatV1,
  AudienceExportMetadataV1,
  AudienceDownloadExportFormatV1,
  AudienceMembershipResultV1,
} from '../../domain/customer-intelligence-audience/index.js';
import { stableStringify } from '../../shared/stable-checksum.js';
import { writeGenericCsv, CSV_CONTENT_TYPE } from './csv-writer.js';
import {
  buildAudienceExportProjection,
  normalizeAudienceExportFields,
  AudienceExportProjectionError,
} from './export-projection.js';
import type { AudienceExportContactReader } from './ports.js';
import { writeGenericXlsx, XLSX_CONTENT_TYPE, type AudienceXlsxMetadataEntry } from './xlsx-writer.js';

export const DEFAULT_AUDIENCE_EXPORT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
export const DEFAULT_AUDIENCE_EXPORT_MAX_MATCHED_ROWS = 50_000;

export type AudienceExportLimitsV1 = {
  readonly maxOutputBytes?: number;
  readonly maxMatchedRows?: number;
};

export type AudienceMembershipExportRequestV1 = {
  readonly membership: AudienceMembershipResultV1;
  readonly fields?: readonly (AudienceExportFieldIdV1 | string)[];
  readonly format?: AudienceExportFormatV1;
  readonly generatedAt?: string;
};

export type BuildAudienceExportArtifactInput = AudienceMembershipExportRequestV1 & {
  readonly contacts: readonly AudienceExportContactV1[];
  readonly limits?: AudienceExportLimitsV1;
};

export type AudienceExportDependencies = {
  readonly contactReader: AudienceExportContactReader;
  readonly clock?: () => string;
  readonly limits?: AudienceExportLimitsV1;
};

export type AudienceExport = (request: AudienceMembershipExportRequestV1) => Promise<AudienceExportArtifactV1>;

export class AudienceExportError extends Error {
  readonly code:
    | 'UNSUPPORTED_FORMAT'
    | 'UNSUPPORTED_FIELD'
    | 'DUPLICATE_FIELD'
    | 'REQUIRED_FIELD_MISSING'
    | 'CONFLICTING_REQUEST'
    | 'MEMBERSHIP_INCOMPLETE'
    | 'CONTACT_HYDRATION_FAILED'
    | 'CONTACT_DATA_INVALID'
    | 'EXPORT_SIZE_LIMIT_EXCEEDED'
    | 'EXPORT_ROW_LIMIT_EXCEEDED';

  constructor(code: AudienceExportError['code'], message: string, options?: { readonly cause?: unknown }) {
    super(message);
    this.name = 'AudienceExportError';
    this.code = code;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * A04.3 application capability. It consumes a completed A04.1 membership and the existing
 * A04.2 bulk contact reader; it deliberately has no evaluator, snapshot, or SQL dependency.
 */
export function createAudienceExport(deps: AudienceExportDependencies): AudienceExport {
  return async (request) => {
    const selection = resolveExportRequest(request);
    assertConfiguredLimits(deps.limits);
    assertMembershipExportable(request.membership, deps.limits?.maxMatchedRows ?? DEFAULT_AUDIENCE_EXPORT_MAX_MATCHED_ROWS);

    let contacts: readonly AudienceExportContactV1[];
    try {
      contacts = request.membership.members.length === 0
        ? []
        : await deps.contactReader.readByCustomerIds(request.membership.members.map((member) => member.customerId));
    } catch (error) {
      throw new AudienceExportError('CONTACT_HYDRATION_FAILED', 'Audience export contact hydration failed', { cause: error });
    }

    return buildAudienceExportArtifact({
      ...request,
      fields: selection.selectedFields,
      format: selection.format,
      contacts,
      generatedAt: request.generatedAt ?? deps.clock?.() ?? new Date().toISOString(),
      limits: deps.limits,
    });
  };
}

/** Pure writer orchestration seam for already-hydrated contacts and focused tests. */
export async function buildAudienceExportArtifact(input: BuildAudienceExportArtifactInput): Promise<AudienceExportArtifactV1> {
  const selection = resolveExportRequest(input);
  const limits = input.limits;
  assertConfiguredLimits(limits);
  assertMembershipExportable(input.membership, limits?.maxMatchedRows ?? DEFAULT_AUDIENCE_EXPORT_MAX_MATCHED_ROWS);

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const projection = buildAudienceExportProjection({
    membership: input.membership,
    selectedFields: selection.selectedFields,
    contacts: input.contacts,
  });
  const maxBytes = limits?.maxOutputBytes ?? DEFAULT_AUDIENCE_EXPORT_MAX_OUTPUT_BYTES;
  const warnings = uniqueStrings([
    ...input.membership.warnings,
    ...(projection.missingContactCount > 0 ? ['missing_contact_row'] : []),
  ]);
  const metadata = createMetadata({
    membership: input.membership,
    format: selection.format,
    selectedFields: projection.selectedFields,
    generatedAt,
    validationWarnings: warnings,
  });

  const artifact = selection.format === 'CSV'
    ? writeGenericCsv({ rows: projection.rows, selectedFields: projection.selectedFields, maxBytes })
    : await writeGenericXlsx({
        rows: projection.rows,
        selectedFields: projection.selectedFields,
        metadata: metadataEntries(metadata),
        maxBytes,
        generatedAt,
      });
  const contentType = selection.format === 'CSV' ? CSV_CONTENT_TYPE : XLSX_CONTENT_TYPE;
  const filename = createAudienceExportFilename(input.membership.definitionChecksum, generatedAt, selection.format);

  return {
    exportVersion: 'customer-intelligence-audience-export-artifact-v1',
    format: selection.format,
    rowCount: projection.rows.length,
    selectedFields: projection.selectedFields,
    membershipChecksum: input.membership.membershipChecksum,
    evaluationChecksum: input.membership.evaluationChecksum,
    lineage: input.membership.lineage,
    contentType,
    filename,
    byteLength: artifact.byteLength,
    generatedAt,
    metadata,
    artifact,
  };
}

export const createAudienceExportArtifact = createAudienceExport;

export function createAudienceExportFilename(
  definitionChecksum: string,
  generatedAt: string,
  format: AudienceDownloadExportFormatV1,
): string {
  const checksumPart = sanitizeFilenamePart(definitionChecksum.slice(0, 12)) || 'unknown';
  const timestampPart = sanitizeFilenamePart(generatedAt.replace(/[:.]/gu, '-')) || 'generated';
  return `audience-export-${checksumPart}-${timestampPart}.${format === 'CSV' ? 'csv' : 'xlsx'}`;
}

type ResolvedExportRequest = {
  readonly selectedFields: readonly AudienceExportFieldIdV1[];
  readonly format: AudienceDownloadExportFormatV1;
};

function resolveExportRequest(input: AudienceMembershipExportRequestV1): ResolvedExportRequest {
  let selectedFields: readonly AudienceExportFieldIdV1[];
  try {
    selectedFields = normalizeAudienceExportFields(input.fields);
  } catch (error) {
    if (error instanceof AudienceExportProjectionError) {
      throw new AudienceExportError(error.code, error.message, { cause: error });
    }
    throw error;
  }

  const requestedFormat = input.format ?? 'CSV';
  if (requestedFormat !== 'CSV' && requestedFormat !== 'XLSX') {
    throw new AudienceExportError('UNSUPPORTED_FORMAT', `Unsupported audience export format: ${String(requestedFormat)}`);
  }
  return { selectedFields, format: requestedFormat };
}

function assertMembershipExportable(membership: AudienceMembershipResultV1, maxMatchedRows: number): void {
  const candidate = membership as AudienceMembershipResultV1 & { readonly status?: string; readonly completeness?: string };
  if (candidate.status !== 'completed' || candidate.completeness !== 'COMPLETE') {
    throw new AudienceExportError('MEMBERSHIP_INCOMPLETE', 'Audience membership is not complete');
  }
  if (
    !membership.counts
    || !Array.isArray(membership.members)
    || membership.members.length !== membership.counts.matched
    || membership.counts.population !== membership.counts.matched + membership.counts.notMatched + membership.counts.unknown
  ) {
    throw new AudienceExportError('MEMBERSHIP_INCOMPLETE', 'Audience membership invariants failed');
  }
  const memberIds = membership.members.map((member) => member.customerId);
  if (memberIds.some((customerId) => !Number.isSafeInteger(customerId) || customerId <= 0) || new Set(memberIds).size !== memberIds.length) {
    throw new AudienceExportError('MEMBERSHIP_INCOMPLETE', 'Audience membership identity invariant failed');
  }
  if (membership.counts.matched > maxMatchedRows) {
    throw new AudienceExportError('EXPORT_ROW_LIMIT_EXCEEDED', 'Audience export exceeds the configured ' + String(maxMatchedRows) + ' matched-row limit');
  }
}

function assertConfiguredLimits(limits: AudienceExportLimitsV1 | undefined): void {
  for (const [name, value] of [
    ['maxOutputBytes', limits?.maxOutputBytes ?? DEFAULT_AUDIENCE_EXPORT_MAX_OUTPUT_BYTES],
    ['maxMatchedRows', limits?.maxMatchedRows ?? DEFAULT_AUDIENCE_EXPORT_MAX_MATCHED_ROWS],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid audience export ${name} limit`);
  }
}

function createMetadata(input: {
  readonly membership: AudienceMembershipResultV1;
  readonly format: AudienceDownloadExportFormatV1;
  readonly selectedFields: readonly AudienceExportFieldIdV1[];
  readonly generatedAt: string;
  readonly validationWarnings: readonly string[];
}): AudienceExportMetadataV1 {
  const membership = input.membership;
  return {
    exportVersion: 'customer-intelligence-audience-export-artifact-v1',
    format: input.format,
    rowCount: membership.counts.matched,
    definitionChecksum: membership.definitionChecksum,
    evaluationChecksum: membership.evaluationChecksum,
    membershipChecksum: membership.membershipChecksum,
    population: membership.counts.population,
    matched: membership.counts.matched,
    notMatched: membership.counts.notMatched,
    unknown: membership.counts.unknown,
    referenceTime: membership.lineage.referenceTime,
    evaluatedAt: membership.evaluatedAt,
    evaluatorVersion: membership.lineage.evaluatorVersion,
    reproducibilityLevel: membership.lineage.reproducibilityLevel,
    featureSnapshotId: membership.lineage.relevantSnapshotLineage.feature.snapshotId,
    resolutionPolicyVersion: membership.lineage.resolutionPolicyVersion,
    relevantSnapshotLineage: membership.lineage.relevantSnapshotLineage,
    selectedFields: input.selectedFields,
    generatedAt: input.generatedAt,
    validationWarnings: input.validationWarnings,
  };
}

function metadataEntries(metadata: AudienceExportMetadataV1): readonly AudienceXlsxMetadataEntry[] {
  const entries: AudienceXlsxMetadataEntry[] = [
    ['exportVersion', metadata.exportVersion],
    ['format', metadata.format],
    ['rowCount', metadata.rowCount],
    ['definitionChecksum', metadata.definitionChecksum],
    ['evaluationChecksum', metadata.evaluationChecksum],
    ['membershipChecksum', metadata.membershipChecksum],
    ['population', metadata.population],
    ['matched', metadata.matched],
    ['notMatched', metadata.notMatched],
    ['unknown', metadata.unknown],
    ['referenceTime', metadata.referenceTime],
    ['evaluatedAt', metadata.evaluatedAt],
    ['evaluatorVersion', metadata.evaluatorVersion],
    ['reproducibilityLevel', metadata.reproducibilityLevel],
    ['featureSnapshotId', metadata.featureSnapshotId],
    ['resolutionPolicyVersion', metadata.resolutionPolicyVersion],
    ['relevantSnapshotLineage', stableStringify(metadata.relevantSnapshotLineage)],
    ['selectedFields', stableStringify(metadata.selectedFields)],
    ['generatedAt', metadata.generatedAt],
    ['validationWarnings', stableStringify(metadata.validationWarnings)],
  ];
  return entries;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/gu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, '');
}
