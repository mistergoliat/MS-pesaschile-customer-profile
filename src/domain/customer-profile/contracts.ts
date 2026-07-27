// Customer Profile does not resolve identity: masterCustomerId must already be
// confirmed by onboarding/Identity Resolver before this contract is used.
export type CustomerProfileSnapshot = {
  readonly masterCustomerId: string;
  readonly generatedAt: string;
  readonly warnings: readonly string[];
};

// Runtime input for GET /v1/customers/{masterCustomerId}/profile. No email fields —
// email-based resolution belongs to onboarding / master-customer-population, see CP-R1-T02B.
export type GetCustomerProfileInput = {
  readonly masterCustomerId: string;
};

// Only what master_customer.prestashop_customer_id can actually express: an id or NULL.
// Email conflicts are detected offline in master-customer-population and never persisted
// here, so there is no 'conflicted' to observe at runtime.
export type CustomerProfileLinkStatus = 'linked' | 'not_linked';

export type CustomerProfileDegradedReason =
  | 'prestashop_unavailable'
  | 'prestashop_timeout'
  | 'prestashop_customer_not_found'
  | 'profile_build_failed';

export type CustomerProfileLookupResult =
  | {
      readonly status: 'available';
      readonly masterCustomerId: string;
      readonly linkStatus: 'linked';
      readonly prestashopCustomerId: number;
      readonly profile: CustomerProfileSnapshot;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'partial';
      readonly masterCustomerId: string;
      readonly linkStatus: 'not_linked';
      readonly prestashopCustomerId: null;
      readonly profile: null;
      readonly warnings: readonly string[];
    }
  // Master exists and is linked, but the profile could not be built — never collapse
  // this into not_found. `reason` is the structured cause; do not rely on `warnings` alone.
  | {
      readonly status: 'degraded';
      readonly reason: CustomerProfileDegradedReason;
      readonly masterCustomerId: string;
      readonly linkStatus: 'linked';
      readonly prestashopCustomerId: number;
      readonly profile: null;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'not_found';
      readonly masterCustomerId: string;
      readonly profile: null;
      readonly warnings: readonly string[];
    };
