import {
  CrmSchemaIncompatibleError,
  CrmTimeoutError,
  CrmUnavailableError,
  CustomerProfileBuildError,
  PrestashopSchemaIncompatibleError,
  PrestashopTimeoutError,
  PrestashopUnavailableError,
  RfmSchemaIncompatibleError,
  RfmTimeoutError,
  RfmUnavailableError,
} from '../application/customer-profile/errors.js';

export type SafeErrorType =
  | 'crm_unavailable'
  | 'crm_timeout'
  | 'crm_schema_incompatible'
  | 'prestashop_unavailable'
  | 'prestashop_timeout'
  | 'prestashop_schema_incompatible'
  | 'rfm_unavailable'
  | 'rfm_timeout'
  | 'rfm_schema_incompatible'
  | 'profile_build_failed'
  | 'unexpected_error';

// Classifies by type identity only (instanceof) — never touches error.message or
// error.stack — so a raw driver message (host, port, user, table, column) can never
// leak into a log line through this function.
export function classifyErrorForLog(error: unknown): SafeErrorType {
  if (error instanceof CrmSchemaIncompatibleError) return 'crm_schema_incompatible';
  if (error instanceof CrmTimeoutError) return 'crm_timeout';
  if (error instanceof CrmUnavailableError) return 'crm_unavailable';
  if (error instanceof PrestashopTimeoutError) return 'prestashop_timeout';
  if (error instanceof PrestashopUnavailableError) return 'prestashop_unavailable';
  if (error instanceof PrestashopSchemaIncompatibleError) return 'prestashop_schema_incompatible';
  if (error instanceof RfmSchemaIncompatibleError) return 'rfm_schema_incompatible';
  if (error instanceof RfmTimeoutError) return 'rfm_timeout';
  if (error instanceof RfmUnavailableError) return 'rfm_unavailable';
  if (error instanceof CustomerProfileBuildError) return 'profile_build_failed';
  return 'unexpected_error';
}
