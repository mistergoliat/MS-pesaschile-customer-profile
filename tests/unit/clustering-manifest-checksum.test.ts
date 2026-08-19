import { describe, expect, it } from 'vitest';
import { buildDatasetManifest, describeFeatureDistribution } from '../../scripts/clustering/lib/manifest.js';
import type { RawFeatureRow } from '../../scripts/clustering/lib/feature-builder.js';

function row(customerId: number, totalSpentTaxIncl: number): RawFeatureRow {
  return {
    customerId,
    validOrders: 2,
    totalSpentTaxIncl,
    averageOrderValueTaxIncl: totalSpentTaxIncl / 2,
    customerTenureDays: 500,
    daysSinceLastOrder: 100,
    purchaseFrequencyDays: 50,
    daysBetweenFirstLastOrder: 50,
    orders365d: 1,
    totalOrdersAllStates: 2,
    cancelledOrders: 0,
    cancelledOrderRatio: 0,
    totalDiscountsTaxIncl: 0,
    totalShippingTaxIncl: 0,
    discountShare: 0,
    shippingShare: 0,
    distinctProducts: 3,
    repeatProductRate: 0,
    top1Share: 0.5,
    top3Share: 1,
    hhi: 0.4,
    effectiveDiversity: 2.5,
    averageUnitsPerOrder: 1.5,
  };
}

const baseArgs = {
  referenceTime: '2026-08-19T00:00:00.000Z',
  window365dStartInclusive: '2025-08-19T00:00:00.000Z',
  window365dEndExclusive: '2026-08-19T00:00:00.000Z',
  extractionDurationMs: 1234,
};

describe('buildDatasetManifest checksum determinism (Section 42/43)', () => {
  it('produces the same datasetChecksum regardless of input row order (canonical sort by customerId)', () => {
    const rowsAsc = [row(1, 100), row(2, 200), row(3, 300)];
    const rowsShuffled = [row(3, 300), row(1, 100), row(2, 200)];

    const manifestAsc = buildDatasetManifest({ ...baseArgs, generatedAt: 'A', rows: rowsAsc });
    const manifestShuffled = buildDatasetManifest({ ...baseArgs, generatedAt: 'B', rows: rowsShuffled });

    expect(manifestAsc.datasetChecksum).toBe(manifestShuffled.datasetChecksum);
  });

  it('does NOT change the checksum when only generatedAt (wall-clock) differs', () => {
    const rows = [row(1, 100), row(2, 200)];
    const a = buildDatasetManifest({ ...baseArgs, generatedAt: '2026-01-01T00:00:00.000Z', rows });
    const b = buildDatasetManifest({ ...baseArgs, generatedAt: '2026-12-31T23:59:59.000Z', rows });
    expect(a.datasetChecksum).toBe(b.datasetChecksum);
  });

  it('DOES change the checksum when referenceTime (a determining input parameter) differs', () => {
    const rows = [row(1, 100), row(2, 200)];
    const a = buildDatasetManifest({ ...baseArgs, generatedAt: 'A', rows });
    const b = buildDatasetManifest({ ...baseArgs, generatedAt: 'A', referenceTime: '2026-09-19T00:00:00.000Z', rows });
    expect(a.datasetChecksum).not.toBe(b.datasetChecksum);
  });

  it('DOES change the checksum when a feature value differs', () => {
    const a = buildDatasetManifest({ ...baseArgs, generatedAt: 'A', rows: [row(1, 100)] });
    const b = buildDatasetManifest({ ...baseArgs, generatedAt: 'A', rows: [row(1, 999)] });
    expect(a.datasetChecksum).not.toBe(b.datasetChecksum);
  });

  it('reports the exact population size', () => {
    const manifest = buildDatasetManifest({ ...baseArgs, generatedAt: 'A', rows: [row(1, 100), row(2, 200)] });
    expect(manifest.populationSize).toBe(2);
  });
});

describe('describeFeatureDistribution', () => {
  it('computes min/median/max correctly for a known small array', () => {
    const dist = describeFeatureDistribution([1, 2, 3, 4, 5]);
    expect(dist.min).toBe(1);
    expect(dist.median).toBe(3);
    expect(dist.max).toBe(5);
    expect(dist.mean).toBe(3);
    expect(dist.zeroCount).toBe(0);
  });

  it('counts zeros explicitly', () => {
    const dist = describeFeatureDistribution([0, 0, 1, 2]);
    expect(dist.zeroCount).toBe(2);
  });

  it('returns a zeroed distribution for an empty array rather than throwing', () => {
    const dist = describeFeatureDistribution([]);
    expect(dist.min).toBe(0);
    expect(dist.max).toBe(0);
    expect(dist.mean).toBe(0);
  });
});
