import { describe, expect, it } from 'vitest';
import {
  buildCustomerCommercialAffinitySnapshotKey,
  customerCommercialAffinityCalculationVersion,
  customerCommercialAffinityIdentityAuthority,
  type CustomerCommercialAffinitySnapshotKeyInput,
} from '../../src/domain/customer-commercial-affinity/index.js';

function baseInput(overrides: Partial<CustomerCommercialAffinitySnapshotKeyInput> = {}): CustomerCommercialAffinitySnapshotKeyInput {
  return {
    calculationVersion: 'customer-commercial-affinity-v1',
    productSemanticSnapshotVersion: 'commercial-product-ontology-v3',
    ontologyHash: 'f2de79fb',
    populationPolicyVersion: 'cp-r2-clustering-population-b-prime-v1',
    referenceTime: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('calculationVersion / identityAuthority constants', () => {
  it('exposes a stable, explicit initial calculation version', () => {
    expect(customerCommercialAffinityCalculationVersion).toBe('customer-commercial-affinity-v1');
  });

  it('exposes prestashop_customer as the identity authority, never masterCustomerId', () => {
    expect(customerCommercialAffinityIdentityAuthority).toBe('prestashop_customer');
  });
});

describe('buildCustomerCommercialAffinitySnapshotKey', () => {
  it('is deterministic: the same input always resolves to the same key', () => {
    const input = baseInput();

    expect(buildCustomerCommercialAffinitySnapshotKey(input)).toBe(buildCustomerCommercialAffinitySnapshotKey(input));
    expect(buildCustomerCommercialAffinitySnapshotKey(baseInput())).toBe(buildCustomerCommercialAffinitySnapshotKey(baseInput()));
  });

  it('changes when calculationVersion changes', () => {
    const a = buildCustomerCommercialAffinitySnapshotKey(baseInput());
    const b = buildCustomerCommercialAffinitySnapshotKey(baseInput({ calculationVersion: 'customer-commercial-affinity-v2' }));

    expect(a).not.toBe(b);
  });

  it('changes when the product semantic snapshot version changes (ontology v3 -> v4)', () => {
    const a = buildCustomerCommercialAffinitySnapshotKey(baseInput());
    const b = buildCustomerCommercialAffinitySnapshotKey(baseInput({ productSemanticSnapshotVersion: 'commercial-product-ontology-v4' }));

    expect(a).not.toBe(b);
  });

  it('changes when ontologyHash changes', () => {
    const a = buildCustomerCommercialAffinitySnapshotKey(baseInput());
    const b = buildCustomerCommercialAffinitySnapshotKey(baseInput({ ontologyHash: 'a-different-hash' }));

    expect(a).not.toBe(b);
  });

  it('changes when populationPolicyVersion changes', () => {
    const a = buildCustomerCommercialAffinitySnapshotKey(baseInput());
    const b = buildCustomerCommercialAffinitySnapshotKey(baseInput({ populationPolicyVersion: 'a-different-population-policy' }));

    expect(a).not.toBe(b);
  });

  it('changes when referenceTime changes', () => {
    const a = buildCustomerCommercialAffinitySnapshotKey(baseInput());
    const b = buildCustomerCommercialAffinitySnapshotKey(baseInput({ referenceTime: '2026-09-01T00:00:00.000Z' }));

    expect(a).not.toBe(b);
  });

  it('includes persisted semantic identity and population checksum when supplied', () => {
    const key = buildCustomerCommercialAffinitySnapshotKey(baseInput({
      productSemanticSnapshotId: `sha256:${'a'.repeat(64)}`,
      eligiblePopulationChecksum: 'd'.repeat(64),
      consumerSemanticChecksum: 'b'.repeat(64),
      datasetChecksum: 'c'.repeat(64),
    }));

    expect(key).toContain(`sha256:${'a'.repeat(64)}`);
    expect(key).toContain('d'.repeat(64));
    expect(key).toContain('b'.repeat(64));
    expect(key).toContain('c'.repeat(64));
  });

  it('sanitizes referenceTime the same way RFM/clustering/analytics snapshot keys do', () => {
    const key = buildCustomerCommercialAffinitySnapshotKey(baseInput({ referenceTime: '2026-08-28T00:00:00.000Z' }));

    expect(key).not.toContain(':');
    expect(key).toContain('2026-08-28T00-00-00-000Z');
  });
});
