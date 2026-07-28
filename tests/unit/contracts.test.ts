import { describe, expect, it } from 'vitest';
import type { CustomerProfileSnapshot } from '../../src/contracts/index.js';

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
      warnings: [],
    } satisfies CustomerProfileSnapshot;

    expect(snapshot.masterCustomerId).toBe('1');
    expect(snapshot.customer.email).toBe('ana@example.com');
    expect(snapshot.prestashop.customerId).toBe(555);
  });
});
