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

// Injected so snapshot timestamps are deterministic in tests.
export interface Clock {
  now(): Date;
}
