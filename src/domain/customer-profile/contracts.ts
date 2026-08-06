import type { CustomerDataProvenance } from '../customer-identity/index.js';

// PesasChile business rule: any row persisted in ps_orders is a paid order, so every
// entry here is a paid order — there is no separate `isPaid` field, it would be
// redundant. `currentStateId` and `valid` are raw operational facts from PrestaShop,
// not a commercial classification; do not treat either as a payment filter. See CP-R1-T04.

// Read-only translation of currentStateId into the localized label configured via
// PRESTASHOP_ORDER_STATE_LANG_ID — not a commercial classification. `resolved` means the
// catalog had a row for this stateId/language; `unknown` means the query succeeded but no
// row matched (missing translation or stale/removed state) — never a dependency failure,
// see CustomerProfileDegradedReason for that. This is deliberately not a routing/keyword
// classification: `name` is descriptive content, not a business rule input. See CP-R1-T05.
export type CustomerOrderStateContext = {
  readonly stateId: number;
  readonly name: string | null;
  readonly resolution: 'resolved' | 'unknown';
};

export type CustomerOrderSummary = {
  readonly orderId: number;
  readonly reference: string;
  // currentStateId is kept alongside currentState (not replaced by it) for compatibility
  // and as raw operational evidence — see CP-R1-T05.
  readonly currentStateId: number;
  readonly currentState: CustomerOrderStateContext;
  readonly valid: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly totalPaidTaxIncl: string;
  readonly totalProductsTaxIncl: string;
  readonly currencyId: number;
};

export type CustomerProfileSnapshot = {
  readonly customerId: number;
  readonly generatedAt: string;
  readonly customer: {
    readonly firstname: string;
    readonly lastname: string;
    readonly email: string;
    readonly rut: string | null;
    readonly platformOrigin: string;
  };
  readonly prestashop: {
    readonly customerId: number;
    readonly active: boolean;
    readonly shopId: number;
    readonly createdAt: string | null;
    readonly updatedAt: string | null;
  };
  // Recent paid orders only (bounded by CUSTOMER_PROFILE_RECENT_ORDERS_LIMIT), most
  // recent first — not necessarily the customer's complete order history. See CP-R1-T04.
  readonly recentOrders: readonly CustomerOrderSummary[];
  readonly warnings: readonly string[];
};

export type GetCustomerProfileInput = {
  readonly customerId: number;
};

export type CustomerProfileLinkStatus = 'linked' | 'not_linked';

export type CustomerProfileDegradedReason =
  | 'prestashop_unavailable'
  | 'prestashop_schema_incompatible'
  | 'customer_profile_unavailable';

export type CustomerProfileLookupResult =
  | {
      readonly status: 'available';
      readonly customerId: number;
      readonly profile: CustomerProfileSnapshot;
      readonly provenance: CustomerDataProvenance;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'degraded';
      readonly reason: CustomerProfileDegradedReason;
      readonly customerId: number;
      readonly profile: null;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'not_found';
      readonly customerId: number;
      readonly profile: null;
      readonly warnings: readonly string[];
    };
