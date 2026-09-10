import { describe, expect, it, vi } from 'vitest';
import {
  buildAudienceExportPreview,
  createAudienceExportPreview,
  normalizeAudienceExportEmail,
  validateAudienceExportEmail,
  type AudienceExportPreviewRequestV1,
} from '../../src/application/customer-intelligence-audience/export-preview.js';
import type { AudienceMembershipResultV1 } from '../../src/domain/customer-intelligence-audience/index.js';

function membership(
  ids: readonly number[],
  counts: { readonly population: number; readonly matched: number; readonly notMatched: number; readonly unknown: number },
): AudienceMembershipResultV1 {
  return {
    status: 'completed',
    membershipVersion: 'customer-intelligence-audience-membership-v1',
    definition: {
      definitionVersion: 'customer-intelligence-audience-definition-v1',
      root: { kind: 'SCALAR', field: 'rfm.rfmCode', operator: 'EQ', value: '555' },
    },
    definitionChecksum: 'definition-checksum',
    evaluationContext: {} as AudienceMembershipResultV1['evaluationContext'],
    lineage: { lineageVersion: 'lineage-v1' } as unknown as AudienceMembershipResultV1['lineage'],
    evaluatedAt: '2026-09-10T00:00:00.000Z',
    counts,
    members: ids.map((customerId) => ({ customerId })),
    evaluationChecksum: 'evaluation-checksum',
    membershipChecksum: 'membership-checksum',
    completeness: 'COMPLETE',
    warnings: [],
  };
}

function request(overrides: Partial<AudienceExportPreviewRequestV1> = {}): AudienceExportPreviewRequestV1 {
  return {
    membership: membership([1, 2, 3], { population: 4, matched: 3, notMatched: 0, unknown: 1 }),
    selectedFormat: 'GENERIC_CSV',
    selectedDestination: 'DOWNLOAD',
    ...overrides,
  };
}

describe('A04.2 audience export preview', () => {
  it('normalizes email deterministically without speculative correction', () => {
    expect(normalizeAudienceExportEmail('  User@Example.COM ')).toBe('user@example.com');
    expect(normalizeAudienceExportEmail('   ')).toBeNull();
    expect(validateAudienceExportEmail('user@example.com')).toBe('VALID');
    expect(validateAudienceExportEmail('not-an-email')).toBe('INVALID');
  });

  it('preserves membership counts/checksums and rejects duplicate Brevo emails without collapsing rows', async () => {
    const readByCustomerIds = vi.fn(async () => [
      { customerId: 1, email: ' User@Example.com ', firstname: 'Ana', lastname: 'Pérez' },
      { customerId: 2, email: 'user@example.com', firstname: 'Bea', lastname: 'Pérez' },
      { customerId: 3, email: '   ', firstname: null, lastname: null },
    ]);
    const result = await createAudienceExportPreview({ contactReader: { readByCustomerIds } })({ ...request(), membership: membership([1, 2, 3], { population: 3, matched: 3, notMatched: 0, unknown: 0 }) });

    expect(readByCustomerIds).toHaveBeenCalledOnce();
    expect(readByCustomerIds).toHaveBeenCalledWith([1, 2, 3]);
    expect(result).toMatchObject({
      status: 'READY',
      audienceMatchedCount: 3,
      unknownCount: 0,
      customersWithEmail: 2,
      customersWithoutEmail: 1,
      duplicateEmailCount: 2,
      duplicatePhoneCount: 0,
      exportableCount: 3,
      excludedFromExportCount: 0,
      brevoEligibleCount: 1,
      brevoRejectedCount: 2,
      membershipChecksum: 'membership-checksum',
      evaluationChecksum: 'evaluation-checksum',
    });
    expect(result.rejectionReasonCounts).toMatchObject({ DUPLICATE_IDENTIFIER: 2 });
    expect(result.validationWarnings).toEqual(['phone_source_unavailable', 'duplicate_email']);
  });

  it('preserves a missing contact row as a generic customerId row and allows it for Brevo EXT_ID', () => {
    const result = buildAudienceExportPreview({
      membership: membership([1, 2], { population: 2, matched: 2, notMatched: 0, unknown: 0 }),
      contacts: [{ customerId: 1, email: 'valid@example.com', firstname: null, lastname: null }],
      selectedFields: ['customerId', 'email', 'firstname', 'lastname'],
      selectedFormat: 'GENERIC_XLSX',
      selectedDestination: 'DOWNLOAD',
    });

    expect(result).toMatchObject({
      customersWithEmail: 1,
      customersWithoutEmail: 1,
      exportableCount: 2,
      brevoEligibleCount: 2,
      brevoRejectedCount: 0,
    });
    expect(result.validationWarnings).toContain('missing_contact_row');
  });

  it('rejects invalid non-blank email for Brevo while generic export remains unaffected', () => {
    const result = buildAudienceExportPreview({
      membership: membership([1], { population: 1, matched: 1, notMatched: 0, unknown: 0 }),
      contacts: [{ customerId: 1, email: 'invalid email', firstname: null, lastname: null }],
      selectedFormat: 'BREVO_CONTACT_IMPORT_CSV',
      selectedDestination: 'BREVO_CONTACT_IMPORT_FILE',
    });

    expect(result).toMatchObject({ status: 'READY', exportableCount: 1, brevoEligibleCount: 0, brevoRejectedCount: 1, estimatedFileRows: 0 });
    expect(result.rejectionReasonCounts).toMatchObject({ INVALID_EMAIL: 1 });
    expect(result.validationWarnings).toContain('invalid_email');
  });

  it('returns a READY empty preview and does not hydrate zero matched members', async () => {
    const readByCustomerIds = vi.fn(async () => []);
    const result = await createAudienceExportPreview({ contactReader: { readByCustomerIds } })({
      membership: membership([], { population: 0, matched: 0, notMatched: 0, unknown: 0 }),
    });

    expect(result).toMatchObject({ status: 'READY', audienceMatchedCount: 0, exportableCount: 0, estimatedFileRows: 0 });
    expect(readByCustomerIds).not.toHaveBeenCalled();
  });

  it('propagates all-UNKNOWN unchanged with an explicit warning', () => {
    const result = buildAudienceExportPreview({
      membership: membership([], { population: 3, matched: 0, notMatched: 0, unknown: 3 }),
      contacts: [],
    });
    expect(result).toMatchObject({ status: 'READY', audienceMatchedCount: 0, unknownCount: 3 });
    expect(result.validationWarnings).toEqual(['phone_source_unavailable', 'all_members_unknown']);
  });

  it('blocks an unsupported format/destination combination and preserves lineage/checksums', () => {
    const result = buildAudienceExportPreview({
      membership: membership([1], { population: 1, matched: 1, notMatched: 0, unknown: 0 }),
      contacts: [],
      selectedFormat: 'GENERIC_CSV',
      selectedDestination: 'BREVO_CONTACT_IMPORT_FILE',
    });
    expect(result.status).toBe('BLOCKED');
    expect(result.blockingReasons).toContain('UNSUPPORTED_FORMAT_DESTINATION');
    expect(result.membershipChecksum).toBe('membership-checksum');
    expect(result.evaluationChecksum).toBe('evaluation-checksum');
  });

  it('blocks Brevo when the EXT_ID mapping is explicitly unavailable', () => {
    const result = buildAudienceExportPreview({
      membership: membership([1], { population: 1, matched: 1, notMatched: 0, unknown: 0 }),
      contacts: [],
      selectedFormat: 'BREVO_CONTACT_IMPORT_CSV',
      selectedDestination: 'BREVO_CONTACT_IMPORT_FILE',
      brevoExtIdMappingApproved: false,
    });
    expect(result).toMatchObject({ status: 'BLOCKED', brevoEligibleCount: 0, brevoRejectedCount: 1 });
    expect(result.rejectionReasonCounts).toMatchObject({ ATTRIBUTE_MAPPING_UNAVAILABLE: 1 });
  });

  it('fails rather than previewing incomplete membership or global hydration failure', async () => {
    const incomplete = { ...membership([1], { population: 1, matched: 1, notMatched: 0, unknown: 0 }), completeness: 'INCOMPLETE' } as unknown as AudienceMembershipResultV1;
    await expect(createAudienceExportPreview({ contactReader: { readByCustomerIds: vi.fn() } })({ membership: incomplete })).rejects.toMatchObject({ code: 'MEMBERSHIP_INCOMPLETE' });
    await expect(createAudienceExportPreview({ contactReader: { readByCustomerIds: vi.fn(async () => { throw new Error('database unavailable'); }) } })(request())).rejects.toMatchObject({ code: 'CONTACT_HYDRATION_FAILED' });
  });
});
