import { describe, expect, it } from 'vitest';
import { classifyCustomerProfileLookup } from '../../src/domain/customer-profile/index.js';

const baseContext = {
  masterCustomerId: '1',
  masterCustomerExists: true,
  linkedPrestashopCustomerId: null,
  degradedReason: null,
  profile: null,
  warnings: [],
} as const;

describe('classifyCustomerProfileLookup (runtime, masterCustomerId only)', () => {
  it('is not_found when master_customer does not exist', () => {
    const result = classifyCustomerProfileLookup({
      ...baseContext,
      masterCustomerId: '999',
      masterCustomerExists: false,
    });

    expect(result).toEqual({
      status: 'not_found',
      masterCustomerId: '999',
      profile: null,
      warnings: [],
    });
  });

  it('is partial / not_linked when master_customer exists without a PrestaShop link', () => {
    const result = classifyCustomerProfileLookup({ ...baseContext });

    expect(result).toEqual({
      status: 'partial',
      masterCustomerId: '1',
      linkStatus: 'not_linked',
      prestashopCustomerId: null,
      profile: null,
      warnings: [],
    });
  });

  it('is available / linked when master_customer is linked and the profile builds', () => {
    const profile = {
      masterCustomerId: '1',
      generatedAt: '2026-07-27T00:00:00.000Z',
      warnings: [],
    };

    const result = classifyCustomerProfileLookup({
      ...baseContext,
      linkedPrestashopCustomerId: 555,
      profile,
    });

    expect(result).toEqual({
      status: 'available',
      masterCustomerId: '1',
      linkStatus: 'linked',
      prestashopCustomerId: 555,
      profile,
      warnings: [],
    });
  });

  it('is degraded / prestashop_unavailable when linked but PrestaShop does not respond', () => {
    const result = classifyCustomerProfileLookup({
      ...baseContext,
      linkedPrestashopCustomerId: 555,
      degradedReason: 'prestashop_unavailable',
    });

    expect(result).toEqual({
      status: 'degraded',
      reason: 'prestashop_unavailable',
      masterCustomerId: '1',
      linkStatus: 'linked',
      prestashopCustomerId: 555,
      profile: null,
      warnings: [],
    });
    expect(result.status).not.toBe('not_found');
  });

  it('is degraded / prestashop_timeout when linked but the PrestaShop read times out', () => {
    const result = classifyCustomerProfileLookup({
      ...baseContext,
      linkedPrestashopCustomerId: 555,
      degradedReason: 'prestashop_timeout',
    });

    expect(result).toMatchObject({ status: 'degraded', reason: 'prestashop_timeout' });
    expect(result.status).not.toBe('not_found');
  });

  it('is degraded / prestashop_customer_not_found when linked but ps_customer no longer exists', () => {
    const result = classifyCustomerProfileLookup({
      ...baseContext,
      linkedPrestashopCustomerId: 555,
      degradedReason: 'prestashop_customer_not_found',
    });

    expect(result).toEqual({
      status: 'degraded',
      reason: 'prestashop_customer_not_found',
      masterCustomerId: '1',
      linkStatus: 'linked',
      prestashopCustomerId: 555,
      profile: null,
      warnings: [],
    });
    expect(result.status).not.toBe('not_found');
  });

  it('is degraded / profile_build_failed when sources respond but the snapshot cannot be built', () => {
    const result = classifyCustomerProfileLookup({
      ...baseContext,
      linkedPrestashopCustomerId: 555,
      degradedReason: null,
      profile: null,
    });

    expect(result).toMatchObject({ status: 'degraded', reason: 'profile_build_failed' });
    expect(result.status).not.toBe('not_found');
  });
});
