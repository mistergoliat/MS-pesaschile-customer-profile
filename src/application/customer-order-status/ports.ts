import type { CarrierRecord } from '../../domain/customer-order-status/carrier-record.js';
import type { CustomerOrderStatusRecord } from '../../domain/customer-order-status/customer-order-status-record.js';

// Looked up by (prestashopCustomerId, orderReference) together, in the same query — an
// order that doesn't exist and an order that belongs to a different customer are both
// `null` here, indistinguishable by design (see CP-R1-T06 section 3). Timeouts/
// unavailability must reject with the same PrestashopTimeoutError /
// PrestashopUnavailableError used by the other PrestaShop readers.
export interface CustomerOrderStatusReader {
  findByCustomerAndReference(
    prestashopCustomerId: number,
    orderReference: string,
  ): Promise<CustomerOrderStatusRecord | null>;
}

// Looked up by id_carrier only — never by name. A carrier with no row for this id is a
// valid `null` (absence of data, not an error, and must not degrade the whole lookup —
// see CP-R1-T06 section 8). Timeouts/unavailability must reject with the same
// PrestashopTimeoutError / PrestashopUnavailableError used by the other PrestaShop readers.
export interface CarriersReader {
  findById(carrierId: number, languageId: number, shopId: number): Promise<CarrierRecord | null>;
}
