import type {
  AudienceExportContactV1,
  AudienceExportFieldIdV1,
  AudienceExportFormatV1,
  AudienceExportPreviewV1,
  AudienceExportRejectionReasonCountsV1,
  AudienceExportRejectionReasonV1,
  AudienceMembershipResultV1,
} from '../../domain/customer-intelligence-audience/index.js';
import type { AudienceExportContactReader } from './ports.js';

const DEFAULT_FIELDS: readonly AudienceExportFieldIdV1[] = ['customerId'];
const SUPPORTED_FIELDS = new Set<AudienceExportFieldIdV1>(['customerId', 'email', 'firstname', 'lastname']);
const REJECTION_REASONS: readonly AudienceExportRejectionReasonV1[] = [
  'MISSING_CONTACT_IDENTIFIER',
  'INVALID_EMAIL',
  'INVALID_PHONE',
  'DUPLICATE_IDENTIFIER',
  'UNSUPPORTED_FIELD',
  'ATTRIBUTE_MAPPING_UNAVAILABLE',
];

export type AudienceExportPreviewRequestV1 = {
  readonly membership: AudienceMembershipResultV1;
  readonly fields?: readonly AudienceExportFieldIdV1[];
  readonly format?: AudienceExportFormatV1;
  /** The current A04 core policy approves customerId -> EXT_ID by default. */
  readonly brevoExtIdMappingApproved?: boolean;
  readonly extIdMappingApproved?: boolean;
};

export type AudienceExportPreviewDependencies = {
  readonly contactReader: AudienceExportContactReader;
};

export type AudienceExportPreview = (
  request: AudienceExportPreviewRequestV1,
) => Promise<AudienceExportPreviewV1>;

export type AudienceExportEmailValidityV1 = 'VALID' | 'INVALID';

export class AudienceExportPreviewError extends Error {
  readonly code: 'MEMBERSHIP_INCOMPLETE' | 'CONTACT_HYDRATION_FAILED' | 'CONTACT_DATA_INVALID';

  constructor(
    code: AudienceExportPreviewError['code'],
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message);
    this.name = 'AudienceExportPreviewError';
    this.code = code;
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export function createAudienceExportPreview(deps: AudienceExportPreviewDependencies): AudienceExportPreview {
  return async (request) => {
    assertCompleteMembership(request.membership);
    const selection = resolveSelection(request);
    if (selection.blockingReasons.length > 0) {
      return buildBlockedPreview(request.membership, selection, selection.blockingReasons);
    }

    let contacts: readonly AudienceExportContactV1[];
    try {
      contacts = request.membership.members.length === 0
        ? []
        : await deps.contactReader.readByCustomerIds(request.membership.members.map((member) => member.customerId));
    } catch (error) {
      throw new AudienceExportPreviewError(
        'CONTACT_HYDRATION_FAILED',
        'Audience export contact hydration failed',
        { cause: error },
      );
    }

    return buildAudienceExportPreview({
      membership: request.membership,
      contacts,
      fields: selection.selectedFields,
      format: selection.selectedFormat,
      brevoExtIdMappingApproved: request.brevoExtIdMappingApproved ?? request.extIdMappingApproved ?? true,
    });
  };
}

/** Pure projection analysis seam used by the application flow and focused tests. */
export function buildAudienceExportPreview(input: {
  readonly membership: AudienceMembershipResultV1;
  readonly contacts: readonly AudienceExportContactV1[];
  readonly fields?: readonly AudienceExportFieldIdV1[];
  readonly format?: AudienceExportFormatV1;
  readonly brevoExtIdMappingApproved?: boolean;
}): AudienceExportPreviewV1 {
  assertCompleteMembership(input.membership);
  const selection = resolveSelection(input);
  if (selection.blockingReasons.length > 0) {
    return buildBlockedPreview(input.membership, selection, selection.blockingReasons);
  }

  const normalized = normalizeContactRows(input.membership, input.contacts);
  const duplicateEmailCustomerIds = duplicateEmailMembers(normalized.emailByCustomerId);
  const duplicateEmailCount = duplicateEmailCustomerIds.size;
  const customersWithEmail = [...normalized.emailByCustomerId.values()].filter((email) => email !== null).length;
  const audienceMatchedCount = input.membership.counts.matched;
  const customersWithoutEmail = audienceMatchedCount - customersWithEmail;
  const mappingApproved = input.brevoExtIdMappingApproved ?? true;
  const rejectionReasonCounts = emptyReasonCounts();
  let brevoEligibleCount = 0;
  let brevoRejectedCount = 0;

  if (!mappingApproved) {
    brevoRejectedCount = audienceMatchedCount;
    rejectionReasonCounts.ATTRIBUTE_MAPPING_UNAVAILABLE = audienceMatchedCount;
  } else {
    for (const member of input.membership.members) {
      const email = normalized.emailByCustomerId.get(member.customerId) ?? null;
      const reason = brevoRejectionReason(email, duplicateEmailCustomerIds.has(member.customerId));
      if (reason === null) {
        brevoEligibleCount += 1;
      } else {
        brevoRejectedCount += 1;
        rejectionReasonCounts[reason] += 1;
      }
    }
  }

  const warnings = previewWarnings({
    populationCount: input.membership.counts.population,
    matchedCount: input.membership.counts.matched,
    unknownCount: input.membership.counts.unknown,
    missingContactCount: normalized.missingContactCount,
    invalidEmailCount: normalized.invalidEmailCount,
    duplicateEmailCount,
  });
  if (!mappingApproved) warnings.push('attribute_mapping_unavailable');

  const exportableCount = audienceMatchedCount;
  const estimatedFileRows = audienceMatchedCount;

  return {
    previewVersion: 'customer-intelligence-audience-export-preview-v1',
    status: 'READY',
    audienceMatchedCount,
    unknownCount: input.membership.counts.unknown,
    customersWithEmail,
    customersWithoutEmail,
    customersWithPhone: null,
    customersWithoutPhone: null,
    duplicateEmailCount,
    duplicatePhoneCount: 0,
    exportableCount,
    excludedFromExportCount: audienceMatchedCount - exportableCount,
    brevoEligibleCount,
    brevoRejectedCount,
    selectedFields: selection.selectedFields,
    selectedFormat: selection.selectedFormat,
    estimatedFileRows,
    estimatedFileSizeBytes: null,
    membershipChecksum: input.membership.membershipChecksum,
    evaluationChecksum: input.membership.evaluationChecksum,
    lineage: input.membership.lineage,
    validationWarnings: ['phone_source_unavailable', ...warnings],
    rejectionReasonCounts,
  };
}

export function normalizeAudienceExportEmail(email: string | null | undefined): string | null {
  if (email === null || email === undefined) return null;
  const normalized = email.trim().toLowerCase();
  return normalized.length === 0 ? null : normalized;
}

export function validateAudienceExportEmail(email: string): AudienceExportEmailValidityV1 {
  // Deliberately syntactic and permissive: A04.2 does not attempt correction or deliverability
  // checks. Whitespace and multiple/missing @ separators are the only rejected shapes here.
  return /^[^\s@]+@[^\s@]+$/.test(email) ? 'VALID' : 'INVALID';
}

export const normalizeExportEmail = normalizeAudienceExportEmail;
export const validateExportEmail = validateAudienceExportEmail;
export const createPreviewAudienceExport = createAudienceExportPreview;

export async function previewAudienceExport(
  request: AudienceExportPreviewRequestV1,
  deps: AudienceExportPreviewDependencies,
): Promise<AudienceExportPreviewV1> {
  return createAudienceExportPreview(deps)(request);
}

type ResolvedSelection = {
  readonly selectedFields: readonly AudienceExportFieldIdV1[];
  readonly selectedFormat: AudienceExportFormatV1;
  readonly blockingReasons: readonly string[];
};

function resolveSelection(input: {
  readonly fields?: readonly AudienceExportFieldIdV1[];
  readonly format?: AudienceExportFormatV1;
}): ResolvedSelection {
  const requestedFields = input.fields ?? DEFAULT_FIELDS;
  const selectedFields = [...requestedFields] as AudienceExportFieldIdV1[];
  const selectedFormat = input.format ?? 'CSV';
  const blockingReasons: string[] = [];

  if (selectedFields.length === 0 || selectedFields.some((field) => !SUPPORTED_FIELDS.has(field)) || new Set(selectedFields).size !== selectedFields.length) {
    blockingReasons.push('UNSUPPORTED_FIELD');
  }
  if (!isExportFormat(selectedFormat)) {
    blockingReasons.push('UNSUPPORTED_FORMAT');
  }

  return {
    selectedFields: selectedFields.filter((field): field is AudienceExportFieldIdV1 => SUPPORTED_FIELDS.has(field)),
    selectedFormat: isExportFormat(selectedFormat) ? selectedFormat : 'CSV',
    blockingReasons: [...new Set(blockingReasons)],
  };
}

function buildBlockedPreview(
  membership: AudienceMembershipResultV1,
  selection: ResolvedSelection,
  blockingReasons: readonly string[],
): AudienceExportPreviewV1 {
  const matched = membership.counts.matched;
  const rejectionReasonCounts = emptyReasonCounts();
  if (blockingReasons.includes('UNSUPPORTED_FIELD')) rejectionReasonCounts.UNSUPPORTED_FIELD = matched;
  return {
    previewVersion: 'customer-intelligence-audience-export-preview-v1',
    status: 'BLOCKED',
    audienceMatchedCount: matched,
    unknownCount: membership.counts.unknown,
    customersWithEmail: 0,
    customersWithoutEmail: matched,
    customersWithPhone: null,
    customersWithoutPhone: null,
    duplicateEmailCount: 0,
    duplicatePhoneCount: 0,
    exportableCount: 0,
    excludedFromExportCount: matched,
    brevoEligibleCount: 0,
    brevoRejectedCount: 0,
    selectedFields: selection.selectedFields,
    selectedFormat: selection.selectedFormat,
    estimatedFileRows: 0,
    estimatedFileSizeBytes: null,
    membershipChecksum: membership.membershipChecksum,
    evaluationChecksum: membership.evaluationChecksum,
    lineage: membership.lineage,
    validationWarnings: ['phone_source_unavailable', ...blockingReasons.map((reason) => reason.toLowerCase())],
    rejectionReasonCounts,
    blockingReasons,
  };
}

function assertCompleteMembership(membership: AudienceMembershipResultV1): void {
  const candidate = membership as AudienceMembershipResultV1 & { readonly status?: string; readonly completeness?: string };
  if (candidate.status !== 'completed' || candidate.completeness !== 'COMPLETE') {
    throw new AudienceExportPreviewError('MEMBERSHIP_INCOMPLETE', 'Audience membership is not complete');
  }
  if (!Array.isArray(membership.members) || membership.members.length !== membership.counts.matched) {
    throw new AudienceExportPreviewError('MEMBERSHIP_INCOMPLETE', 'Audience membership invariant failed');
  }
  const ids = membership.members.map((member) => member.customerId);
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    throw new AudienceExportPreviewError('MEMBERSHIP_INCOMPLETE', 'Audience membership identity invariant failed');
  }
  if (membership.counts.population !== membership.counts.matched + membership.counts.notMatched + membership.counts.unknown) {
    throw new AudienceExportPreviewError('MEMBERSHIP_INCOMPLETE', 'Audience membership count invariant failed');
  }
}

function normalizeContactRows(
  membership: AudienceMembershipResultV1,
  contacts: readonly AudienceExportContactV1[],
): {
  readonly emailByCustomerId: ReadonlyMap<number, string | null>;
  readonly missingContactCount: number;
  readonly invalidEmailCount: number;
} {
  const memberIds = new Set(membership.members.map((member) => member.customerId));
  const emails = new Map<number, string | null>();
  for (const contact of contacts) {
    if (!Number.isSafeInteger(contact.customerId) || contact.customerId <= 0 || !memberIds.has(contact.customerId)) {
      throw new AudienceExportPreviewError('CONTACT_DATA_INVALID', 'Bulk contact hydration returned an invalid customer identity');
    }
    if (emails.has(contact.customerId)) {
      throw new AudienceExportPreviewError('CONTACT_DATA_INVALID', 'Bulk contact hydration returned duplicate customer rows');
    }
    emails.set(contact.customerId, normalizeAudienceExportEmail(contact.email));
  }

  let invalidEmailCount = 0;
  for (const email of emails.values()) {
    if (email !== null && validateAudienceExportEmail(email) === 'INVALID') invalidEmailCount += 1;
  }
  return {
    emailByCustomerId: emails,
    missingContactCount: membership.members.length - emails.size,
    invalidEmailCount,
  };
}

function duplicateEmailMembers(emailByCustomerId: ReadonlyMap<number, string | null>): ReadonlySet<number> {
  const grouped = new Map<string, number[]>();
  for (const [customerId, email] of emailByCustomerId) {
    if (email === null) continue;
    grouped.set(email, [...(grouped.get(email) ?? []), customerId]);
  }
  const duplicateMembers = new Set<number>();
  for (const customerIds of grouped.values()) {
    if (customerIds.length > 1) for (const customerId of customerIds) duplicateMembers.add(customerId);
  }
  return duplicateMembers;
}

function brevoRejectionReason(email: string | null, duplicateEmail: boolean): AudienceExportRejectionReasonV1 | null {
  if (email !== null && validateAudienceExportEmail(email) === 'INVALID') return 'INVALID_EMAIL';
  if (duplicateEmail) return 'DUPLICATE_IDENTIFIER';
  return null;
}

function previewWarnings(input: {
  readonly populationCount: number;
  readonly matchedCount: number;
  readonly unknownCount: number;
  readonly missingContactCount: number;
  readonly invalidEmailCount: number;
  readonly duplicateEmailCount: number;
}): string[] {
  const warnings: string[] = [];
  if (input.populationCount > 0 && input.unknownCount === input.populationCount && input.matchedCount === 0) {
    warnings.push('all_members_unknown');
  }
  if (input.missingContactCount > 0) warnings.push('missing_contact_row');
  if (input.invalidEmailCount > 0) warnings.push('invalid_email');
  if (input.duplicateEmailCount > 0) warnings.push('duplicate_email');
  return warnings;
}

function emptyReasonCounts(): AudienceExportRejectionReasonCountsV1 & Record<AudienceExportRejectionReasonV1, number> {
  return Object.fromEntries(REJECTION_REASONS.map((reason) => [reason, 0])) as AudienceExportRejectionReasonCountsV1 & Record<AudienceExportRejectionReasonV1, number>;
}

function isExportFormat(value: unknown): value is AudienceExportFormatV1 {
  return value === 'CSV' || value === 'XLSX';
}
