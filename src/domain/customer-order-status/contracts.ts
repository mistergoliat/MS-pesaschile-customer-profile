import type { CustomerDataProvenance } from '../customer-identity/index.js';

// Read-only translation of ps_orders.id_carrier into a business-confirmed delivery
// method (see resolveDeliveryMethod, CP-R1-T06 section 9). Never derived from name,
// delay, is_module or external_module_name.
export type DeliveryMethod =
  | 'direct_dispatch'
  | 'external_carrier'
  | 'store_pickup'
  | 'warehouse_pickup'
  | 'event_pickup'
  | 'unknown';

// A declared business estimate, not a computed ETA: no calendar math, no holidays, no
// claim that the window has already started — see resolveDeliveryEstimate (section 10).
export type DeliveryEstimate =
  | {
      readonly status: 'applicable';
      readonly minimumBusinessDays: number;
      readonly maximumBusinessDays: number;
      readonly startsFrom: 'dispatch';
    }
  | {
      readonly status: 'not_applicable';
      readonly minimumBusinessDays: null;
      readonly maximumBusinessDays: null;
      readonly startsFrom: null;
    }
  | {
      readonly status: 'unknown';
      readonly minimumBusinessDays: null;
      readonly maximumBusinessDays: null;
      readonly startsFrom: null;
    };

// Public payload for GET /v1/customers/{customerId}/orders/{reference}/status.
// currentStateId/currentStateName come exclusively from ps_orders.current_state — never
// from ps_order_history, ps_order_state flags (paid/shipped/delivery) or keyword
// matching on the name. isRealTimeTracking is always false: this is the last state
// PrestaShop recorded, not a live tracking feed. See CP-R1-T06.
export type CustomerOrderStatus = {
  readonly orderId: number;
  readonly reference: string;
  readonly currentStateId: number;
  readonly currentStateName: string | null;
  readonly deliveryMethod: DeliveryMethod;
  readonly deliveryEstimate: DeliveryEstimate;
  readonly lastRecordedUpdateAt: string;
  readonly source: 'prestashop_current_state';
  readonly isRealTimeTracking: false;
};

// Runtime input for GET /v1/customers/{customerId}/orders/{reference}/status.
export type GetCustomerOrderStatusInput = {
  readonly customerId: number;
  readonly orderReference: string;
};

// No IDs, references, names or PII inside a warning string — same rule as the
// Customer Profile warnings (see CustomerProfileSnapshot.warnings).
export type CustomerOrderStatusWarning =
  | 'order_state_label_missing'
  | 'carrier_not_found'
  | 'delivery_method_unknown';

export type GetCustomerOrderStatusDegradedReason = 'prestashop_unavailable' | 'prestashop_schema_incompatible';

// order_not_found covers both "no such order" and "order belongs to a different
// customer": the query that looks it up is scoped by id_customer AND reference
// together (see CustomerOrderStatusReader), so the two cases are indistinguishable by
// design — never leak which one it was.
export type GetCustomerOrderStatusResult =
  | {
      readonly status: 'available';
      readonly customerId: number;
      readonly order: CustomerOrderStatus;
      readonly provenance: CustomerDataProvenance;
      readonly warnings: readonly CustomerOrderStatusWarning[];
    }
  | {
      readonly status: 'customer_not_found' | 'order_not_found';
      readonly customerId: number;
    }
  | {
      readonly status: 'degraded';
      readonly customerId: number;
      readonly reason: GetCustomerOrderStatusDegradedReason;
    };
