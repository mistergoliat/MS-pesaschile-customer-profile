import { describe, expect, it } from 'vitest';
import { CUSTOMER_PROFILE_CONTRACT_VERSION, type CustomerDataProvenance } from '../../src/domain/customer-identity/index.js';
import type { CustomerProfileSnapshot } from '../../src/domain/customer-profile/index.js';

describe('contracts', () => {
  it('matches the direct PrestaShop snapshot shape with provenance metadata', () => {
    const snapshot: CustomerProfileSnapshot = {
      customerId: 1,
      generatedAt: '2026-08-05T00:00:00.000Z',
      customer: {
        firstname: 'Ana',
        lastname: 'Perez',
        email: 'ana@example.com',
        rut: null,
        platformOrigin: 'prestashop',
      },
      prestashop: {
        customerId: 1,
        active: true,
        shopId: 1,
        createdAt: null,
        updatedAt: null,
      },
      recentOrders: [],
      warnings: [],
    };

    const provenance: CustomerDataProvenance = {
      customerIdentity: {
        customerId: 1,
        source: 'PRESTASHOP',
        externalCustomerId: '1',
        status: 'DIRECT_SOURCE',
      },
      dataSources: [{ source: 'PRESTASHOP', entity: 'ps_customer', purpose: 'customer_identity' }],
      generatedAt: '2026-08-05T00:00:00.000Z',
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION,
    };

    expect(snapshot.customerId).toBe(1);
    expect(provenance.contractVersion).toBe(CUSTOMER_PROFILE_CONTRACT_VERSION);
    expect(provenance.customerIdentity.externalCustomerId).toBe('1');
  });
});
