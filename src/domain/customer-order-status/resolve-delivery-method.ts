import type { DeliveryMethod } from './contracts.js';

// Business-confirmed map from ps_orders.id_carrier to an operational delivery method
// (CP-R1-T06 section 9, confirmed by operations — never derived from name, delay,
// is_module or external_module_name). Centralized here on purpose: no switch/case
// duplicated across files. carrier 14 and any id not listed here fall through to
// 'unknown' via the Map default, not an explicit branch.
//
// Future evolution note: this first map keys on id_carrier because that is the
// operational data confirmed available today. A future task may migrate it to
// id_reference once the real reference-to-method mapping is audited and confirmed.
const CARRIER_ID_TO_DELIVERY_METHOD = new Map<number, DeliveryMethod>([
  [1, 'store_pickup'],
  [6, 'store_pickup'],
  [15, 'store_pickup'],
  [16, 'store_pickup'],

  [7, 'warehouse_pickup'],
  [13, 'warehouse_pickup'],

  [8, 'event_pickup'],
  [9, 'event_pickup'],
  [10, 'event_pickup'],
  [11, 'event_pickup'],

  [2, 'direct_dispatch'],
  [4, 'direct_dispatch'],
  [12, 'direct_dispatch'],
  [19, 'direct_dispatch'],

  [3, 'external_carrier'],
  [5, 'external_carrier'],
  [17, 'external_carrier'],
  [18, 'external_carrier'],
]);

export function resolveDeliveryMethod(carrierId: number): DeliveryMethod {
  return CARRIER_ID_TO_DELIVERY_METHOD.get(carrierId) ?? 'unknown';
}
