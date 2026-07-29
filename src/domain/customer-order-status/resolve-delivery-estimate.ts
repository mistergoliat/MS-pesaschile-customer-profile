import type { DeliveryEstimate, DeliveryMethod } from './contracts.js';

const APPLICABLE: Readonly<Record<'direct_dispatch' | 'external_carrier', DeliveryEstimate>> = {
  direct_dispatch: { status: 'applicable', minimumBusinessDays: 3, maximumBusinessDays: 5, startsFrom: 'dispatch' },
  external_carrier: { status: 'applicable', minimumBusinessDays: 5, maximumBusinessDays: 15, startsFrom: 'dispatch' },
};

const NOT_APPLICABLE: DeliveryEstimate = {
  status: 'not_applicable',
  minimumBusinessDays: null,
  maximumBusinessDays: null,
  startsFrom: null,
};

const UNKNOWN: DeliveryEstimate = {
  status: 'unknown',
  minimumBusinessDays: null,
  maximumBusinessDays: null,
  startsFrom: null,
};

// Pure policy (CP-R1-T06 section 10): a declared business range, never a computed
// date. No holiday calendar, no claim that the window has already started —
// startsFrom only names where the range counts from.
export function resolveDeliveryEstimate(method: DeliveryMethod): DeliveryEstimate {
  switch (method) {
    case 'direct_dispatch':
      return APPLICABLE.direct_dispatch;
    case 'external_carrier':
      return APPLICABLE.external_carrier;
    case 'store_pickup':
    case 'warehouse_pickup':
    case 'event_pickup':
      return NOT_APPLICABLE;
    case 'unknown':
      return UNKNOWN;
  }
}
