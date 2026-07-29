import { describe, expect, it } from 'vitest';
import { resolveDeliveryMethod } from '../../src/domain/customer-order-status/resolve-delivery-method.js';

describe('resolveDeliveryMethod', () => {
  it.each([
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
  ] as const)('maps carrier %i to %s (the full confirmed operational map)', (carrierId, expected) => {
    expect(resolveDeliveryMethod(carrierId)).toBe(expected);
  });

  it('maps carrier 14 to unknown', () => {
    expect(resolveDeliveryMethod(14)).toBe('unknown');
  });

  it('maps any unconfigured carrier id to unknown', () => {
    expect(resolveDeliveryMethod(999)).toBe('unknown');
    expect(resolveDeliveryMethod(0)).toBe('unknown');
    expect(resolveDeliveryMethod(-1)).toBe('unknown');
  });

  it('never inspects a carrier name or delay — the function only accepts a numeric id', () => {
    expect(resolveDeliveryMethod.length).toBe(1);
  });
});
