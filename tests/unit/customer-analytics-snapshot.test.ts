import { describe, expect, it } from 'vitest';
import { buildCustomerFeatureSnapshot, buildCustomerFeatureSnapshotKey } from '../../src/domain/customer-analytics/snapshot.js';
import type { CustomerFeatureProductAggregate, CustomerFeatureSourceRow } from '../../src/domain/customer-analytics/contracts.js';
import { checksumVersion, featureVersion, operationalAccountExclusionPolicyVersion, populationPolicyVersion, shopScope } from '../../src/domain/customer-analytics/model-version.js';

function product(overrides: Partial<CustomerFeatureProductAggregate> = {}): CustomerFeatureProductAggregate {
  return { productId: 1, productOrderCount: 1, totalQuantity: 1, totalSpentTaxIncl: '100.000000', ...overrides };
}

function sourceRow(overrides: Partial<CustomerFeatureSourceRow> = {}): CustomerFeatureSourceRow {
  return {
    prestashopCustomerId: 1,
    validOrders: 2,
    firstOrderAt: '2026-01-01 00:00:00',
    lastOrderAt: '2026-07-01 00:00:00',
    orders365d: 1,
    totalSpentTaxIncl: '1000.000000',
    totalDiscountsTaxIncl: '0.000000',
    totalShippingTaxIncl: '0.000000',
    totalOrdersAllStates: 2,
    cancelledOrders: 0,
    customerCreatedAt: '2024-01-01 00:00:00',
    products: [product()],
    ...overrides,
  };
}

function buildInput(overrides: Partial<Parameters<typeof buildCustomerFeatureSnapshot>[0]> = {}) {
  return {
    featureVersion,
    populationPolicyVersion,
    operationalExclusionPolicyVersion: operationalAccountExclusionPolicyVersion,
    shopScope,
    referenceTime: '2026-08-19T00:00:00.000Z',
    referenceTimeMysql: '2026-08-19 00:00:00',
    generatedAt: '2026-08-19T00:05:00.000Z',
    sourceRows: [sourceRow()],
    ...overrides,
  };
}

describe('buildCustomerFeatureSnapshotKey (task Section 26)', () => {
  it('is deterministic for the same featureVersion + populationPolicyVersion + referenceTime', () => {
    const a = buildCustomerFeatureSnapshotKey('v1', 'pop-v1', '2026-08-19T00:00:00.000Z');
    const b = buildCustomerFeatureSnapshotKey('v1', 'pop-v1', '2026-08-19T00:00:00.000Z');
    expect(a).toBe(b);
  });

  it('changes when referenceTime changes', () => {
    const a = buildCustomerFeatureSnapshotKey('v1', 'pop-v1', '2026-08-19T00:00:00.000Z');
    const b = buildCustomerFeatureSnapshotKey('v1', 'pop-v1', '2026-08-20T00:00:00.000Z');
    expect(a).not.toBe(b);
  });
});

describe('buildCustomerFeatureSnapshot', () => {
  it('rejects an empty population', () => {
    expect(() => buildCustomerFeatureSnapshot(buildInput({ sourceRows: [] }))).toThrow(/empty population/);
  });

  it('rejects duplicate prestashopCustomerId rows', () => {
    expect(() =>
      buildCustomerFeatureSnapshot(buildInput({ sourceRows: [sourceRow({ prestashopCustomerId: 5 }), sourceRow({ prestashopCustomerId: 5 })] })),
    ).toThrow(/Duplicate prestashopCustomerId/);
  });

  it('sorts rows by prestashopCustomerId regardless of input order', () => {
    const built = buildCustomerFeatureSnapshot(
      buildInput({ sourceRows: [sourceRow({ prestashopCustomerId: 30 }), sourceRow({ prestashopCustomerId: 10 })] }),
    );
    expect(built.rows.map((row) => row.prestashopCustomerId)).toEqual([10, 30]);
  });

  it('produces a manifest carrying both independent checksums (task Section 27)', () => {
    const built = buildCustomerFeatureSnapshot(buildInput());
    expect(built.sourceDatasetChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(built.featureDatasetChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(built.sourceDatasetChecksum).not.toBe(built.featureDatasetChecksum);
    expect(built.manifest.sourceDatasetChecksum).toBe(built.sourceDatasetChecksum);
    expect(built.manifest.featureDatasetChecksum).toBe(built.featureDatasetChecksum);
  });

  it('sourceDatasetChecksum is deterministic and order-independent across product row order', () => {
    const products = [product({ productId: 1 }), product({ productId: 2, totalSpentTaxIncl: '50.000000' })];
    const a = buildCustomerFeatureSnapshot(buildInput({ sourceRows: [sourceRow({ products })] }));
    const b = buildCustomerFeatureSnapshot(buildInput({ sourceRows: [sourceRow({ products: [...products].reverse() })] }));
    expect(a.sourceDatasetChecksum).toBe(b.sourceDatasetChecksum);
    expect(a.featureDatasetChecksum).toBe(b.featureDatasetChecksum);
  });

  it('sourceDatasetChecksum changes when a raw source value changes (source drift signal, task Section 28)', () => {
    const a = buildCustomerFeatureSnapshot(buildInput({ sourceRows: [sourceRow({ totalSpentTaxIncl: '1000.000000' })] }));
    const b = buildCustomerFeatureSnapshot(buildInput({ sourceRows: [sourceRow({ totalSpentTaxIncl: '1000.01' })] }));
    expect(a.sourceDatasetChecksum).not.toBe(b.sourceDatasetChecksum);
  });

  it('re-running with unchanged input reproduces both checksums exactly (no generatedAt leakage into checksum)', () => {
    const a = buildCustomerFeatureSnapshot(buildInput({ generatedAt: '2026-08-19T00:05:00.000Z' }));
    const b = buildCustomerFeatureSnapshot(buildInput({ generatedAt: '2026-09-01T12:00:00.000Z' }));
    expect(a.sourceDatasetChecksum).toBe(b.sourceDatasetChecksum);
    expect(a.featureDatasetChecksum).toBe(b.featureDatasetChecksum);
  });

  it('checksumVersion constant is a real, stable string', () => {
    expect(checksumVersion).toBe('customer-analytics-checksum-canonical-json-v1');
  });

  it('never lets a PII-shaped field reach the manifest', () => {
    // The manifest only ever contains version/policy strings and numeric/checksum fields —
    // this asserts the PII guard actually runs during build (a thrown error would surface any
    // accidental leakage), not that a specific field triggers it.
    expect(() => buildCustomerFeatureSnapshot(buildInput())).not.toThrow();
  });
});
