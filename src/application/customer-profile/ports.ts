import type { CustomerOrderRecord } from '../../domain/customer-profile/customer-order-record.js';
import type { MasterCustomerRecord } from '../../domain/customer-profile/master-customer-record.js';
import type { OrderStateRecord } from '../../domain/customer-profile/order-state-record.js';
import type { PrestashopCustomerRecord } from '../../domain/customer-profile/prestashop-customer-record.js';

// Deprecated runtime port kept only so legacy infrastructure/tests can still compile
// while the direct PrestaShop identity contract fully replaces CRM at the adapter layer.
export interface MasterCustomerReader {
  findById(masterCustomerId: string): Promise<MasterCustomerRecord | null>;
}

// null means "ps_customer row not found". Timeouts/unavailability/schema incompatibility
// must reject with the typed PrestaShop errors defined in application/customer-profile/errors.ts.
export interface PrestashopCustomerReader {
  findById(customerId: number): Promise<PrestashopCustomerRecord | null>;
}

// Looked up exclusively by ps_orders.id_customer — never by email, name, rut, address,
// phone or id_guest. An empty array is a valid, successful result.
export interface CustomerOrdersReader {
  findByCustomerId(
    customerId: number,
    options?: {
      readonly limit?: number;
    },
  ): Promise<readonly CustomerOrderRecord[]>;
}

// Looked up exclusively by numeric order state id — never by name. Accepts already-unique
// ids (the caller dedupes) and returns zero or more matches: a stateId with no row for
// the configured language is simply absent from the result, not an error.
export interface OrderStatesReader {
  findByIds(stateIds: readonly number[], languageId: number): Promise<readonly OrderStateRecord[]>;
}

// Injected so snapshot timestamps are deterministic in tests.
export interface Clock {
  now(): Date;
}
