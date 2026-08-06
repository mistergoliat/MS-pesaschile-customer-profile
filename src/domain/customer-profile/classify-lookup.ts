import type {
  CustomerProfileDegradedReason,
  CustomerProfileLookupResult,
  CustomerProfileSnapshot,
} from './contracts.js';
import type { CustomerDataProvenance } from '../customer-identity/index.js';

export type CustomerProfileLookupContext =
  | {
      readonly customerId: number;
      readonly customerExists: false;
      readonly warnings: readonly string[];
    }
  | {
      readonly customerId: number;
      readonly customerExists: true;
      readonly degradedReason: CustomerProfileDegradedReason | null;
      readonly profile: CustomerProfileSnapshot | null;
      readonly provenance: CustomerDataProvenance | null;
      readonly warnings: readonly string[];
    };

export function classifyCustomerProfileLookup(
  context: CustomerProfileLookupContext,
): CustomerProfileLookupResult {
  if (!context.customerExists) {
    return {
      status: 'not_found',
      customerId: context.customerId,
      profile: null,
      warnings: context.warnings,
    };
  }

  if (context.degradedReason !== null) {
    return {
      status: 'degraded',
      reason: context.degradedReason,
      customerId: context.customerId,
      profile: null,
      warnings: context.warnings,
    };
  }

  if (!context.profile || !context.provenance) {
    return {
      status: 'degraded',
      reason: 'customer_profile_unavailable',
      customerId: context.customerId,
      profile: null,
      warnings: context.warnings,
    };
  }

  return {
    status: 'available',
    customerId: context.customerId,
    profile: context.profile,
    provenance: context.provenance,
    warnings: context.warnings,
  };
}
