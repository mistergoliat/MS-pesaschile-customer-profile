import { describe, expect, it } from 'vitest';
import type { GetCustomerOrderStatusResult } from '../../src/domain/customer-order-status/index.js';
import { CUSTOMER_PROFILE_CONTRACT_VERSION } from '../../src/domain/customer-identity/index.js';

describe('customer-order-status contracts', () => {
  it('accepts the documented union variants', () => {
    const cases: GetCustomerOrderStatusResult[] = [
      {
        status: 'available',
        customerId: 1,
        order: {
          orderId: 1,
          reference: 'ABC123XYZ',
          currentStateId: 4,
          currentStateName: 'Preparando',
          deliveryMethod: 'direct_dispatch',
          deliveryEstimate: {
            status: 'applicable',
            minimumBusinessDays: 3,
            maximumBusinessDays: 5,
            startsFrom: 'dispatch',
          },
          lastRecordedUpdateAt: '2026-08-05T00:00:00.000Z',
          source: 'prestashop_current_state',
          isRealTimeTracking: false,
        },
        provenance: {
          customerIdentity: {
            customerId: 1,
            source: 'PRESTASHOP',
            externalCustomerId: '1',
            status: 'DIRECT_SOURCE',
          },
          dataSources: [{ source: 'PRESTASHOP', entity: 'ps_orders', purpose: 'order_status' }],
          generatedAt: '2026-08-05T00:00:00.000Z',
          contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
        },
        warnings: [],
      },
      { status: 'customer_not_found', customerId: 1 },
      { status: 'order_not_found', customerId: 1 },
      { status: 'degraded', customerId: 1, reason: 'prestashop_unavailable' },
      { status: 'degraded', customerId: 1, reason: 'prestashop_schema_incompatible' },
    ];

    expect(cases).toHaveLength(5);
  });
});
