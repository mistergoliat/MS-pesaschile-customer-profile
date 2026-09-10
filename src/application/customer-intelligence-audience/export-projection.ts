import type {
  AudienceExportContactV1,
  AudienceExportFieldIdV1,
  AudienceExportRowV1,
  AudienceMembershipResultV1,
} from '../../domain/customer-intelligence-audience/index.js';
import { normalizeAudienceExportEmail } from './export-preview.js';

export const AUDIENCE_EXPORT_FIELD_ORDER: readonly AudienceExportFieldIdV1[] = [
  'customerId',
  'email',
  'firstname',
  'lastname',
];

export class AudienceExportProjectionError extends Error {
  readonly code: 'MEMBERSHIP_INCOMPLETE' | 'UNSUPPORTED_FIELD' | 'DUPLICATE_FIELD' | 'REQUIRED_FIELD_MISSING' | 'CONTACT_DATA_INVALID';

  constructor(
    code: AudienceExportProjectionError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'AudienceExportProjectionError';
    this.code = code;
  }
}

export type AudienceExportProjection = {
  readonly selectedFields: readonly AudienceExportFieldIdV1[];
  readonly rows: readonly AudienceExportRowV1[];
  readonly missingContactCount: number;
};

/**
 * Canonicalizes the caller's field selection. Generic A04.3 output always includes customerId,
 * and fields are serialized in contract order rather than caller order.
 */
export function normalizeAudienceExportFields(
  requestedFields: readonly (AudienceExportFieldIdV1 | string)[] | undefined,
): readonly AudienceExportFieldIdV1[] {
  const fields = requestedFields === undefined ? ['customerId'] : [...requestedFields];
  if (fields.length === 0) throw new AudienceExportProjectionError('UNSUPPORTED_FIELD', 'At least one generic export field is required');

  const unsupported = fields.find((field) => !AUDIENCE_EXPORT_FIELD_ORDER.includes(field as AudienceExportFieldIdV1));
  if (unsupported !== undefined) {
    throw new AudienceExportProjectionError('UNSUPPORTED_FIELD', `Unsupported generic export field: ${String(unsupported)}`);
  }
  if (new Set(fields).size !== fields.length) {
    throw new AudienceExportProjectionError('DUPLICATE_FIELD', 'Generic export fields must be unique');
  }
  if (!fields.includes('customerId')) {
    throw new AudienceExportProjectionError('REQUIRED_FIELD_MISSING', 'customerId is required in generic exports');
  }

  return AUDIENCE_EXPORT_FIELD_ORDER.filter((field) => fields.includes(field));
}

/**
 * Builds one row for every authoritative TRUE member. This function has no database access and
 * never makes membership decisions; missing contact rows become null optional fields.
 */
export function buildAudienceExportProjection(input: {
  readonly membership: AudienceMembershipResultV1;
  readonly selectedFields?: readonly (AudienceExportFieldIdV1 | string)[];
  readonly contacts: readonly AudienceExportContactV1[];
}): AudienceExportProjection {
  assertCompleteMembership(input.membership);
  const selectedFields = normalizeAudienceExportFields(input.selectedFields);
  if (!Array.isArray(input.contacts)) {
    throw new AudienceExportProjectionError('CONTACT_DATA_INVALID', 'Bulk contact hydration did not return an array');
  }
  const memberIds = new Set(input.membership.members.map((member) => member.customerId));
  const contactsByCustomerId = new Map<number, AudienceExportContactV1>();

  for (const contact of input.contacts) {
    if (!Number.isSafeInteger(contact.customerId) || contact.customerId <= 0 || !memberIds.has(contact.customerId)) {
      throw new AudienceExportProjectionError('CONTACT_DATA_INVALID', 'Bulk contact hydration returned an invalid customer identity');
    }
    if (contactsByCustomerId.has(contact.customerId)) {
      throw new AudienceExportProjectionError('CONTACT_DATA_INVALID', 'Bulk contact hydration returned duplicate customer rows');
    }
    contactsByCustomerId.set(contact.customerId, contact);
  }

  const rows = [...input.membership.members]
    .sort((left, right) => left.customerId - right.customerId)
    .map((member) => {
      const contact = contactsByCustomerId.get(member.customerId);
      const row: { customerId: number; email?: string | null; firstname?: string | null; lastname?: string | null } = { customerId: member.customerId };
      if (selectedFields.includes('email')) row.email = normalizeAudienceExportEmail(contact?.email);
      if (selectedFields.includes('firstname')) row.firstname = nullableText(contact?.firstname);
      if (selectedFields.includes('lastname')) row.lastname = nullableText(contact?.lastname);
      return row as AudienceExportRowV1;
    });

  return {
    selectedFields,
    rows,
    missingContactCount: input.membership.members.length - contactsByCustomerId.size,
  };
}

function assertCompleteMembership(membership: AudienceMembershipResultV1): void {
  const candidate = membership as AudienceMembershipResultV1 & { readonly status?: string; readonly completeness?: string };
  if (candidate.status !== 'completed' || candidate.completeness !== 'COMPLETE') {
    throw new AudienceExportProjectionError('MEMBERSHIP_INCOMPLETE', 'Audience membership is not complete');
  }
  if (!Array.isArray(membership.members) || membership.members.length !== membership.counts.matched) {
    throw new AudienceExportProjectionError('MEMBERSHIP_INCOMPLETE', 'Audience membership row count invariant failed');
  }
  const ids = membership.members.map((member) => member.customerId);
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
    throw new AudienceExportProjectionError('MEMBERSHIP_INCOMPLETE', 'Audience membership identity invariant failed');
  }
  if (membership.counts.population !== membership.counts.matched + membership.counts.notMatched + membership.counts.unknown) {
    throw new AudienceExportProjectionError('MEMBERSHIP_INCOMPLETE', 'Audience membership count invariant failed');
  }
}

function nullableText(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}
