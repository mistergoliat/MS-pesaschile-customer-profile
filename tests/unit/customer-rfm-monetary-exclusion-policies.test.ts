import { describe, expect, it } from 'vitest';
import {
  excludedOperationalAccountPrestashopCustomerIds,
  operationalAccountExclusionPolicyVersion,
} from '../../src/domain/customer-rfm/operational-account-exclusion-policy.js';
import {
  defaultConfirmedSellerServiceProductIds,
  sellerServiceExclusionPolicyVersion,
} from '../../src/domain/customer-rfm/seller-service-policy.js';

describe('operational account exclusion policy', () => {
  it('is the exact four evidence-backed ids, not a heuristic', () => {
    expect(excludedOperationalAccountPrestashopCustomerIds).toEqual([85980, 39617, 90890, 86421]);
    expect(operationalAccountExclusionPolicyVersion).toBe('operational-account-exclusion-v1');
  });

  it('does not include a real high-value customer confirmed to remain in scope', () => {
    expect(excludedOperationalAccountPrestashopCustomerIds).not.toContain(103237);
  });
});

describe('seller-service exclusion policy', () => {
  it('reuses the already-validated confirmed product id set', () => {
    expect(defaultConfirmedSellerServiceProductIds).toEqual([444]);
    expect(sellerServiceExclusionPolicyVersion).toBe('seller-service-exclusion-v1');
  });
});
