import type { CustomerOrderRecord } from '../../domain/customer-profile/customer-order-record.js';
import type { MasterCustomerRecord } from '../../domain/customer-profile/master-customer-record.js';
import type { PrestashopCustomerRecord } from '../../domain/customer-profile/prestashop-customer-record.js';

// null means "row not found". Connection/query failures must reject the promise instead
// of resolving to null — a CRM outage is a service error, not an absent identity.
export interface MasterCustomerReader {
  findById(masterCustomerId: string): Promise<MasterCustomerRecord | null>;
}

// null means "ps_customer row not found" (a valid outcome: prestashop_customer_not_found).
// Timeouts/unavailability must reject with PrestashopTimeoutError / PrestashopUnavailableError.
export interface PrestashopCustomerReader {
  findById(prestashopCustomerId: number): Promise<PrestashopCustomerRecord | null>;
}

// Looked up exclusively by prestashopCustomerId (master_customer.prestashop_customer_id
// -> ps_orders.id_customer) — never by email, name, rut, address, phone or id_guest.
// An empty array is a valid, successful result (the customer has no orders); it is not
// distinguishable here from "not fetched yet" — the caller only calls this once ps_customer
// is confirmed to exist. Timeouts/unavailability must reject with the same
// PrestashopTimeoutError / PrestashopUnavailableError used by PrestashopCustomerReader.
export interface CustomerOrdersReader {
  findByCustomerId(
    prestashopCustomerId: number,
    options?: {
      readonly limit?: number;
    },
  ): Promise<readonly CustomerOrderRecord[]>;
}

// Injected so snapshot timestamps are deterministic in tests.
export interface Clock {
  now(): Date;
}
