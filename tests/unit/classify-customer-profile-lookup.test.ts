import { describe, expect, it } from 'vitest';
import { classifyCustomerProfileLookup } from '../../src/domain/customer-profile/classify-lookup.js';
import { CUSTOMER_PROFILE_CONTRACT_VERSION } from '../../src/domain/customer-identity/index.js';

describe('classifyCustomerProfileLookup', () => {
  it('is not_found when the customer identity was not resolved', () => {
    expect(
      classifyCustomerProfileLookup({
        customerId: 999,
        customerExists: false,
        warnings: [],
      }),
    ).toEqual({
      status: 'not_found',
      customerId: 999,
      profile: null,
      warnings: [],
    });
  });

  it('is degraded when the profile payload is unavailable after identity resolution', () => {
    expect(
      classifyCustomerProfileLookup({
        customerId: 1,
        customerExists: true,
        degradedReason: 'customer_profile_unavailable',
        profile: null,
        provenance: null,
        warnings: [],
      }),
    ).toEqual({
      status: 'degraded',
      customerId: 1,
      reason: 'customer_profile_unavailable',
      profile: null,
      warnings: [],
    });
  });

  it('is available when both profile and provenance are present', () => {
    const profile = {
      customerId: 1,
      generatedAt: '2026-08-05T00:00:00.000Z',
      customer: {
        firstname: 'Ana',
        lastname: 'Perez',
        email: 'ana@example.com',
        rut: null,
        platformOrigin: 'prestashop',
      },
      prestashop: { customerId: 1, active: true, shopId: 1, createdAt: null, updatedAt: null },
      recentOrders: [],
      warnings: [],
    };
    const provenance = {
      customerIdentity: {
        customerId: 1,
        source: 'PRESTASHOP' as const,
        externalCustomerId: '1',
        status: 'DIRECT_SOURCE' as const,
      },
      dataSources: [{ source: 'PRESTASHOP' as const, entity: 'ps_customer' as const, purpose: 'customer_identity' }],
      generatedAt: '2026-08-05T00:00:00.000Z',
      contractVersion: CUSTOMER_PROFILE_CONTRACT_VERSION as typeof CUSTOMER_PROFILE_CONTRACT_VERSION,
    };

    expect(
      classifyCustomerProfileLookup({
        customerId: 1,
        customerExists: true,
        degradedReason: null,
        profile,
        provenance,
        warnings: [],
      }),
    ).toEqual({
      status: 'available',
      customerId: 1,
      profile,
      provenance,
      warnings: [],
    });
  });
});
