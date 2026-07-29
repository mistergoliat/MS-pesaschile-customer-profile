import { describe, expect, it } from 'vitest';
import type { CustomerOrderStatus, GetCustomerOrderStatusResult } from '../../src/contracts/index.js';

describe('Customer Order Status contracts', () => {
  it('matches the real available payload shape (CP-R1-T06)', () => {
    const order = {
      orderId: 123,
      reference: 'ABC123XYZ',
      currentStateId: 4,
      currentStateName: 'Entregado a Transportista',
      deliveryMethod: 'direct_dispatch',
      deliveryEstimate: {
        status: 'applicable',
        minimumBusinessDays: 3,
        maximumBusinessDays: 5,
        startsFrom: 'dispatch',
      },
      lastRecordedUpdateAt: '2026-01-02T10:00:00.000Z',
      source: 'prestashop_current_state',
      isRealTimeTracking: false,
    } satisfies CustomerOrderStatus;

    expect(order.source).toBe('prestashop_current_state');
    expect(order.isRealTimeTracking).toBe(false);
  });

  it('matches every GetCustomerOrderStatusResult status', () => {
    const results: GetCustomerOrderStatusResult[] = [
      { status: 'customer_not_found' },
      { status: 'customer_not_linked' },
      { status: 'order_not_found' },
      { status: 'degraded', reason: 'prestashop_timeout' },
      { status: 'degraded', reason: 'prestashop_unavailable' },
    ];

    for (const result of results) {
      expect(result.status).toBeTruthy();
    }
  });
});
