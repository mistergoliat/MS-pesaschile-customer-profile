import { describe, expect, it } from 'vitest';
import {
  buildRfmSourceArtifactRow,
  buildRfmSourceFingerprint,
  calculateRfmSourceRowChecksum,
  classifyBaselineComparability,
  compareRfmSourceArtifacts,
  rowChecksumVersion,
  sha256Stable,
  type RfmSourceArtifactRow,
} from '../../src/domain/customer-rfm/index.js';

function row(overrides: Partial<RfmSourceArtifactRow> = {}): RfmSourceArtifactRow {
  return buildRfmSourceArtifactRow({
    prestashopCustomerId: 10,
    firstValidOrderAtInWindow: '2026-08-01 10:00:00',
    lastValidOrderAtInWindow: '2026-08-02 11:00:00',
    frequencyOrders: 2,
    grossOrderValueTaxIncl: '200.000000',
    averageOrderValueTaxIncl: '100.000000',
    distinctShopCount: 1,
    ...overrides,
  });
}

describe('RFM source row checksum', () => {
  it('keeps the same checksum for the same logical row with different property order, decimal shape and equivalent dates', () => {
    const checksum = calculateRfmSourceRowChecksum({
      prestashopCustomerId: 10,
      firstValidOrderAtInWindow: '2026-08-01 10:00:00',
      lastValidOrderAtInWindow: '2026-08-02 11:00:00',
      frequencyOrders: 2,
      grossOrderValueTaxIncl: 200,
      averageOrderValueTaxIncl: '100',
      distinctShopCount: 1,
    });
    const same = calculateRfmSourceRowChecksum({
      distinctShopCount: 1,
      averageOrderValueTaxIncl: '100.000000',
      grossOrderValueTaxIncl: '200.000000',
      frequencyOrders: 2,
      lastValidOrderAtInWindow: '2026-08-02T11:00:00Z',
      firstValidOrderAtInWindow: '2026-08-01T10:00:00.000Z',
      prestashopCustomerId: 10,
    });

    expect(same).toBe(checksum);
  });

  it('changes checksum when an included field changes', () => {
    expect(row({ frequencyOrders: 3 }).rowChecksum).not.toBe(row().rowChecksum);
    expect(row({ grossOrderValueTaxIncl: '201.000000' }).rowChecksum).not.toBe(row().rowChecksum);
    expect(row({ lastValidOrderAtInWindow: '2026-08-02 12:00:00' }).rowChecksum).not.toBe(row().rowChecksum);
  });

  it('uses the documented row checksum version in the canonical payload', () => {
    const expected = sha256Stable({
      rowChecksumVersion,
      prestashopCustomerId: 10,
      firstValidOrderAtInWindow: '2026-08-01T10:00:00.000Z',
      lastValidOrderAtInWindow: '2026-08-02T11:00:00.000Z',
      frequencyOrders: 2,
      grossOrderValueTaxIncl: '200.000000',
      averageOrderValueTaxIncl: '100.000000',
      distinctShopCount: 1,
    });

    expect(row().rowChecksum).toBe(expected);
  });
});

describe('RFM source fingerprint and comparator', () => {
  it('builds an aggregate source fingerprint without PII fields', () => {
    const sourceRow = row();
    const fingerprint = buildRfmSourceFingerprint({
      referenceTime: '2026-08-03T00:00:00.000Z',
      windowStartInclusive: '2025-08-03T00:00:00.000Z',
      windowEndExclusive: '2026-08-03T00:00:00.000Z',
      rows: [sourceRow],
      validOrderCount: 2,
      minOrderDateAdd: '2026-08-01 10:00:00',
      maxOrderDateAdd: '2026-08-02 11:00:00',
      maxOrderDateUpd: '2026-08-02 12:00:00',
      distinctShopCount: 1,
      distinctCurrencyCount: 1,
      distinctConversionRateCount: 1,
      zeroAmountOrderCount: 0,
      ordersUpdatedAfterReferenceTime: 0,
      sourceChecksum: 'a'.repeat(64),
    });

    expect(fingerprint).toMatchObject({
      activeCustomerCount: 1,
      validOrderCount: 2,
      grossOrderValueTaxIncl: '200.000000',
      minOrderDateAdd: '2026-08-01T10:00:00.000Z',
      maxOrderDateUpd: '2026-08-02T12:00:00.000Z',
    });
    expect(JSON.stringify(fingerprint)).not.toMatch(/email|phone|name|address|rut|dni/i);
  });

  it('compares added, removed and changed technical customers with aggregate deltas', () => {
    const baseline = [
      row({ prestashopCustomerId: 10 }),
      row({ prestashopCustomerId: 20, frequencyOrders: 1, grossOrderValueTaxIncl: '50.000000', averageOrderValueTaxIncl: '50.000000' }),
      row({ prestashopCustomerId: 30 }),
    ];
    const candidate = [
      row({ prestashopCustomerId: 10 }),
      row({ prestashopCustomerId: 20, frequencyOrders: 2, grossOrderValueTaxIncl: '75.000000', averageOrderValueTaxIncl: '37.500000' }),
      row({ prestashopCustomerId: 40, lastValidOrderAtInWindow: '2026-08-02 12:00:00', distinctShopCount: 2 }),
    ];

    expect(compareRfmSourceArtifacts(baseline, candidate)).toMatchObject({
      baselineCustomerCount: 3,
      candidateCustomerCount: 3,
      addedCustomers: 1,
      removedCustomers: 1,
      changedCustomers: 1,
      unchangedCustomers: 1,
      frequencyChangedCount: 1,
      monetaryChangedCount: 1,
      totalFrequencyDelta: 1,
      totalMonetaryDelta: '25.000000',
      affectedPrestashopCustomerIds: [20, 30, 40],
    });
  });

  it('classifies aggregate-only and missing baselines', () => {
    expect(classifyBaselineComparability([row()])).toBe('ROW_ARTIFACT');
    expect(classifyBaselineComparability({ activeCustomerCount: 14188 })).toBe('AGGREGATE_ONLY');
    expect(classifyBaselineComparability(null)).toBe('NOT_COMPARABLE');
  });
});
