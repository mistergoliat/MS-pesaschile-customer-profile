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

export type CustomerIdentityResolution = {
  readonly masterCustomerId: string | null;
  readonly status: IdentityResolutionStatus;
  readonly reason: IdentityResolutionReason;
  readonly prestashopCustomerId: number | null;
  readonly warnings: readonly string[];
};
