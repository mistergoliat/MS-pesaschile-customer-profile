import type {
  IdentityResolutionReason,
  IdentityResolutionStatus,
} from '../identity-resolution/contracts.js';

export type PrestashopEmailCandidate = {
  readonly prestashopCustomerId: number;
};

export type IdentityMatchInput = {
  readonly explicitPrestashopCustomerId: number | null;
  readonly hasUsableEmail: boolean;
  readonly emailCandidates: readonly PrestashopEmailCandidate[];
};

export type IdentityMatchResult = {
  readonly status: IdentityResolutionStatus;
  readonly reason: IdentityResolutionReason;
  // Confirmed link (explicit_prestashop_link): the id the population job should persist.
  readonly resolvedPrestashopCustomerId: number | null;
  // Unconfirmed suggestion (single email match): safe-for-backfill candidate, not yet persisted.
  readonly candidatePrestashopCustomerId: number | null;
};

// Offline-only: CP-R1-T01 resolution policy for master-customer-population dry-run,
// historical reconciliation and candidate analysis. Not invoked by the Customer
// Profile runtime lookup — see CP-R1-T02B.
export function classifyIdentityMatch(input: IdentityMatchInput): IdentityMatchResult {
  if (input.explicitPrestashopCustomerId !== null) {
    return build('resolved', 'explicit_prestashop_link', input.explicitPrestashopCustomerId, null);
  }

  if (!input.hasUsableEmail) {
    return build('unlinked', 'missing_or_unusable_email', null, null);
  }

  if (input.emailCandidates.length > 1) {
    return build('conflicted', 'multiple_exact_email_matches', null, null);
  }

  const [singleCandidate] = input.emailCandidates;
  if (singleCandidate) {
    return build(
      'provisional',
      'single_exact_email_match_safe_for_backfill',
      null,
      singleCandidate.prestashopCustomerId,
    );
  }

  return build('unlinked', 'no_exact_email_match', null, null);
}

function build(
  status: IdentityResolutionStatus,
  reason: IdentityResolutionReason,
  resolvedPrestashopCustomerId: number | null,
  candidatePrestashopCustomerId: number | null,
): IdentityMatchResult {
  return { status, reason, resolvedPrestashopCustomerId, candidatePrestashopCustomerId };
}
