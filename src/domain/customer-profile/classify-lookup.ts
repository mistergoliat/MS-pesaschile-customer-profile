import type {
  CustomerProfileDegradedReason,
  CustomerProfileLookupResult,
  CustomerProfileSnapshot,
} from './contracts.js';

// Discriminated on masterCustomerExists so "master doesn't exist but has a PrestaShop
// link/profile" cannot be constructed at all — not just guarded against at runtime.
export type CustomerProfileLookupContext =
  | {
      readonly masterCustomerId: string;
      readonly masterCustomerExists: false;
      readonly warnings: readonly string[];
    }
  | {
      readonly masterCustomerId: string;
      readonly masterCustomerExists: true;
      readonly linkedPrestashopCustomerId: number | null;
      readonly degradedReason: CustomerProfileDegradedReason | null;
      readonly profile: CustomerProfileSnapshot | null;
      readonly warnings: readonly string[];
    };

// Pure outcome classification for GET /v1/customers/{masterCustomerId}/profile.
// Does not read master_customer, does not read PrestaShop, does not search by email
// — the caller resolves those facts and passes them in. See CP-R1-T02B / CP-R1-T03.
export function classifyCustomerProfileLookup(
  context: CustomerProfileLookupContext,
): CustomerProfileLookupResult {
  if (!context.masterCustomerExists) {
    return {
      status: 'not_found',
      masterCustomerId: context.masterCustomerId,
      profile: null,
      warnings: context.warnings,
    };
  }

  if (context.linkedPrestashopCustomerId === null) {
    return {
      status: 'partial',
      masterCustomerId: context.masterCustomerId,
      linkStatus: 'not_linked',
      prestashopCustomerId: null,
      profile: null,
      warnings: context.warnings,
    };
  }

  if (context.degradedReason !== null) {
    return {
      status: 'degraded',
      reason: context.degradedReason,
      masterCustomerId: context.masterCustomerId,
      linkStatus: 'linked',
      prestashopCustomerId: context.linkedPrestashopCustomerId,
      profile: null,
      warnings: context.warnings,
    };
  }

  // Linked, no explicit failure reason, but no profile to serve: don't guess — degrade.
  if (!context.profile) {
    return {
      status: 'degraded',
      reason: 'profile_build_failed',
      masterCustomerId: context.masterCustomerId,
      linkStatus: 'linked',
      prestashopCustomerId: context.linkedPrestashopCustomerId,
      profile: null,
      warnings: context.warnings,
    };
  }

  return {
    status: 'available',
    masterCustomerId: context.masterCustomerId,
    linkStatus: 'linked',
    prestashopCustomerId: context.linkedPrestashopCustomerId,
    profile: context.profile,
    warnings: context.warnings,
  };
}
