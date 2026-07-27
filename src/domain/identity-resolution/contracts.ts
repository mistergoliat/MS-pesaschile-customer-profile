export type IdentityResolutionStatus =
  | 'resolved'
  | 'provisional'
  | 'unlinked'
  | 'conflicted';

export type IdentityResolutionReason =
  | 'explicit_prestashop_link'
  | 'single_exact_email_match_safe_for_backfill'
  | 'multiple_exact_email_matches'
  | 'no_exact_email_match'
  | 'missing_or_unusable_email';

// The onboarding/Identity Resolver contract: it only has to resolve masterCustomerId.
// The PrestaShop link itself belongs to master-customer-population and customer-profile,
// not to this contract — see CP-R1-T02B.
export type CustomerIdentityResolution = {
  readonly masterCustomerId: string | null;
  readonly status: IdentityResolutionStatus;
  readonly reason: IdentityResolutionReason;
  readonly warnings: readonly string[];
};

// Input contract for CP-R1-T02: what the resolver needs before it can classify an identity.
export type IdentityResolutionInput = {
  readonly normalizedEmail: string | null;
  readonly explicitPrestashopCustomerId: number | null;
};
