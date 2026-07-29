import { describe, expect, it } from 'vitest';
import { resolveDeliveryEstimate } from '../../src/domain/customer-order-status/resolve-delivery-estimate.js';

describe('resolveDeliveryEstimate', () => {
  it('is applicable 3-5 business days from dispatch for direct_dispatch', () => {
    expect(resolveDeliveryEstimate('direct_dispatch')).toEqual({
      status: 'applicable',
      minimumBusinessDays: 3,
      maximumBusinessDays: 5,
      startsFrom: 'dispatch',
    });
  });

  it('is applicable 5-15 business days from dispatch for external_carrier', () => {
    expect(resolveDeliveryEstimate('external_carrier')).toEqual({
      status: 'applicable',
      minimumBusinessDays: 5,
      maximumBusinessDays: 15,
      startsFrom: 'dispatch',
    });
  });

  it.each(['store_pickup', 'warehouse_pickup', 'event_pickup'] as const)(
    'is not_applicable for %s',
    (method) => {
      expect(resolveDeliveryEstimate(method)).toEqual({
        status: 'not_applicable',
        minimumBusinessDays: null,
        maximumBusinessDays: null,
        startsFrom: null,
      });
    },
  );

  it('is unknown for unknown', () => {
    expect(resolveDeliveryEstimate('unknown')).toEqual({
      status: 'unknown',
      minimumBusinessDays: null,
      maximumBusinessDays: null,
      startsFrom: null,
    });
  });

  it('never computes a calendar date — only declares a business-day range or null', () => {
    const result = resolveDeliveryEstimate('direct_dispatch');
    expect(result).not.toHaveProperty('eta');
    expect(result).not.toHaveProperty('estimatedDeliveryDate');
  });
});
