import type { CustomerOrderRecord } from '../../domain/customer-profile/customer-order-record.js';
import type { MasterCustomerRecord } from '../../domain/customer-profile/master-customer-record.js';
import type { OrderStateRecord } from '../../domain/customer-profile/order-state-record.js';
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

// Looked up exclusively by numeric order state id — never by name. Accepts already-unique
// ids (the caller dedupes) and returns zero or more matches: a stateId with no row for the
// configured language is simply absent from the result, not an error — the caller treats
// that as `resolution: 'unknown'`, never as a reason to fail the whole lookup. Timeouts/
// unavailability must reject with the same PrestashopTimeoutError / PrestashopUnavailableError
// used by the other PrestaShop readers.
export interface OrderStatesReader {
  findByIds(stateIds: readonly number[], languageId: number): Promise<readonly OrderStateRecord[]>;
}

// Injected so snapshot timestamps are deterministic in tests.
export interface Clock {
  now(): Date;
}
