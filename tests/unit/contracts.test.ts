import { describe, expect, it } from 'vitest';
import type { CustomerOrderStateContext, CustomerOrderSummary, CustomerProfileSnapshot } from '../../src/contracts/index.js';

describe('Customer Profile contracts', () => {
  it('matches the real read-only snapshot shape: master_customer as authority, PrestaShop as link metadata', () => {
    const snapshot = {
      masterCustomerId: '1',
      generatedAt: '2026-07-27T00:00:00.000Z',
      customer: {
        firstname: 'Ana',
        lastname: 'Perez',
        email: 'ana@example.com',
        rut: null,
        platformOrigin: 'prestashop',
      },
      prestashop: {
        customerId: 555,
        active: true,
        shopId: 1,
        createdAt: '2024-01-01 00:00:00',
        updatedAt: '2024-01-02 00:00:00',
      },
      recentOrders: [],
      warnings: [],
    } satisfies CustomerProfileSnapshot;

    expect(snapshot.masterCustomerId).toBe('1');
    expect(snapshot.customer.email).toBe('ana@example.com');
    expect(snapshot.prestashop.customerId).toBe(555);
    expect(snapshot.recentOrders).toEqual([]);
  });

  it('matches the real recentOrders shape: current_state/valid captured raw, amounts as strings', () => {
    const order = {
      orderId: 100,
      reference: 'REF100',
      currentStateId: 4,
      currentState: { stateId: 4, name: 'Enviado', resolution: 'resolved' },
      valid: true,
      createdAt: '2026-01-01 10:00:00',
      updatedAt: '2026-01-02 10:00:00',
      totalPaidTaxIncl: '10000.000000',
      totalProductsTaxIncl: '9500.000000',
      currencyId: 1,
    } satisfies CustomerOrderSummary;

    expect(order.currentStateId).toBe(4);
    expect(order.valid).toBe(true);
    expect(typeof order.totalPaidTaxIncl).toBe('string');
    expect(typeof order.totalProductsTaxIncl).toBe('string');
  });

  it('matches both currentState resolutions: resolved with a name, unknown with name null', () => {
    const resolved = {
      stateId: 4,
      name: 'Enviado',
      resolution: 'resolved',
    } satisfies CustomerOrderStateContext;
    const unknown = {
      stateId: 999,
      name: null,
      resolution: 'unknown',
    } satisfies CustomerOrderStateContext;

    expect(resolved.name).toBe('Enviado');
    expect(unknown.name).toBeNull();
    expect(unknown.resolution).toBe('unknown');
  });
});
