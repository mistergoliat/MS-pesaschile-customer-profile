import { describe, expect, it } from 'vitest';
import {
  buildClusterSnapshotProfiles,
  type ClusterCommercialAggregate,
  type ClusterProfileSourceRow,
} from '../../src/domain/customer-clustering/profile.js';
import { featureOrder } from '../../src/domain/customer-clustering/model-version.js';
import type { RawClusterFeatureVector } from '../../src/domain/customer-clustering/contracts.js';

function featureVector(value: number): RawClusterFeatureVector {
  return Object.fromEntries(featureOrder.map((feature) => [feature, value])) as RawClusterFeatureVector;
}

function commercial(totalSpent: number, validOrders: number, daysSinceLastOrder: number): ClusterCommercialAggregate {
  return {
    totalSpentTaxIncl: totalSpent,
    averageOrderValueTaxIncl: totalSpent / validOrders,
    validOrders,
    daysSinceLastOrder,
  };
}

// Two clusters, 3 customers in cluster 0 (feature values 10/20/30), 1 customer in cluster 1.
function buildFixture(): {
  rows: ClusterProfileSourceRow[];
  featuresByCustomerId: Map<number, RawClusterFeatureVector>;
  commercialByCustomerId: Map<number, ClusterCommercialAggregate>;
} {
  const rows: ClusterProfileSourceRow[] = [
    { prestashopCustomerId: 1, clusterId: 0, distanceToCentroid: 0.1 },
    { prestashopCustomerId: 2, clusterId: 0, distanceToCentroid: 0.5 },
    { prestashopCustomerId: 3, clusterId: 0, distanceToCentroid: 1.0 },
    { prestashopCustomerId: 4, clusterId: 1, distanceToCentroid: 0.2 },
  ];
  const featuresByCustomerId = new Map<number, RawClusterFeatureVector>([
    [1, featureVector(10)],
    [2, featureVector(20)],
    [3, featureVector(30)],
    [4, featureVector(99)],
  ]);
  const commercialByCustomerId = new Map<number, ClusterCommercialAggregate>([
    [1, commercial(100, 2, 5)],
    [2, commercial(200, 2, 10)],
    [3, commercial(300, 3, 15)],
    [4, commercial(500, 4, 1)],
  ]);
  return { rows, featuresByCustomerId, commercialByCustomerId };
}

describe('buildClusterSnapshotProfiles', () => {
  it('computes correct customerCount, mean, median, p25, p75 per cluster', () => {
    const { rows, featuresByCustomerId, commercialByCustomerId } = buildFixture();
    const profiles = buildClusterSnapshotProfiles({
      snapshotId: '1',
      populationSize: 4,
      generatedAt: '2026-08-19T00:00:00.000Z',
      rows,
      featuresByCustomerId,
      commercialByCustomerId,
    });

    expect(profiles).toHaveLength(2);
    const cluster0 = profiles.find((p) => p.clusterId === 0)!;
    expect(cluster0.customerCount).toBe(3);
    expect(cluster0.featureProfile.distinctProducts.mean).toBe(20);
    expect(cluster0.featureProfile.distinctProducts.median).toBe(20);
    // Nearest-rank percentile over sorted [10, 20, 30]: p25 -> index ceil(0.25*3)-1=0 -> 10;
    // p75 -> index ceil(0.75*3)-1=2 -> 30.
    expect(cluster0.featureProfile.distinctProducts.p25).toBe(10);
    expect(cluster0.featureProfile.distinctProducts.p75).toBe(30);

    const cluster1 = profiles.find((p) => p.clusterId === 1)!;
    expect(cluster1.customerCount).toBe(1);
    expect(cluster1.featureProfile.distinctProducts.mean).toBe(99);
  });

  it('computes commercial post-hoc stats independently of feature stats', () => {
    const { rows, featuresByCustomerId, commercialByCustomerId } = buildFixture();
    const profiles = buildClusterSnapshotProfiles({
      snapshotId: '1',
      populationSize: 4,
      generatedAt: '2026-08-19T00:00:00.000Z',
      rows,
      featuresByCustomerId,
      commercialByCustomerId,
    });
    const cluster0 = profiles.find((p) => p.clusterId === 0)!;
    expect(cluster0.commercialProfile.totalSpentTaxIncl.mean).toBe(200);
    expect(cluster0.commercialProfile.validOrders.mean).toBeCloseTo((2 + 2 + 3) / 3, 6);
  });

  it('computes median/p95/max distance per cluster, never negative', () => {
    const { rows, featuresByCustomerId, commercialByCustomerId } = buildFixture();
    const profiles = buildClusterSnapshotProfiles({
      snapshotId: '1',
      populationSize: 4,
      generatedAt: '2026-08-19T00:00:00.000Z',
      rows,
      featuresByCustomerId,
      commercialByCustomerId,
    });
    const cluster0 = profiles.find((p) => p.clusterId === 0)!;
    // sorted distances [0.1, 0.5, 1.0]
    expect(cluster0.distanceProfile.medianDistance).toBe(0.5);
    expect(cluster0.distanceProfile.maxDistance).toBe(1.0);
    expect(cluster0.distanceProfile.p95Distance).toBeGreaterThanOrEqual(0);
  });

  it('produces a deterministic checksum independent of input row order', () => {
    const { rows, featuresByCustomerId, commercialByCustomerId } = buildFixture();
    const forward = buildClusterSnapshotProfiles({
      snapshotId: '1',
      populationSize: 4,
      generatedAt: '2026-08-19T00:00:00.000Z',
      rows,
      featuresByCustomerId,
      commercialByCustomerId,
    });
    const shuffled = buildClusterSnapshotProfiles({
      snapshotId: '1',
      populationSize: 4,
      generatedAt: '2026-08-19T05:00:00.000Z', // different generatedAt must not affect the checksum
      rows: [...rows].reverse(),
      featuresByCustomerId,
      commercialByCustomerId,
    });
    expect(forward.find((p) => p.clusterId === 0)!.profileChecksum).toBe(shuffled.find((p) => p.clusterId === 0)!.profileChecksum);
  });

  it('produces a different checksum when the underlying data differs', () => {
    const { rows, featuresByCustomerId, commercialByCustomerId } = buildFixture();
    const base = buildClusterSnapshotProfiles({
      snapshotId: '1',
      populationSize: 4,
      generatedAt: '2026-08-19T00:00:00.000Z',
      rows,
      featuresByCustomerId,
      commercialByCustomerId,
    });
    const mutatedFeatures = new Map(featuresByCustomerId);
    mutatedFeatures.set(1, featureVector(999));
    const mutated = buildClusterSnapshotProfiles({
      snapshotId: '1',
      populationSize: 4,
      generatedAt: '2026-08-19T00:00:00.000Z',
      rows,
      featuresByCustomerId: mutatedFeatures,
      commercialByCustomerId,
    });
    expect(base.find((p) => p.clusterId === 0)!.profileChecksum).not.toBe(mutated.find((p) => p.clusterId === 0)!.profileChecksum);
  });

  it('throws when row count does not match populationSize (Section 43 consistency check)', () => {
    const { rows, featuresByCustomerId, commercialByCustomerId } = buildFixture();
    expect(() =>
      buildClusterSnapshotProfiles({
        snapshotId: '1',
        populationSize: 999,
        generatedAt: '2026-08-19T00:00:00.000Z',
        rows,
        featuresByCustomerId,
        commercialByCustomerId,
      }),
    ).toThrow(/populationSize/);
  });

  it('throws on a missing feature vector rather than silently dropping the customer', () => {
    const { rows, featuresByCustomerId, commercialByCustomerId } = buildFixture();
    featuresByCustomerId.delete(2);
    expect(() =>
      buildClusterSnapshotProfiles({
        snapshotId: '1',
        populationSize: 4,
        generatedAt: '2026-08-19T00:00:00.000Z',
        rows,
        featuresByCustomerId,
        commercialByCustomerId,
      }),
    ).toThrow(/Missing feature vector/);
  });

  it('throws on a missing commercial aggregate rather than silently dropping the customer', () => {
    const { rows, featuresByCustomerId, commercialByCustomerId } = buildFixture();
    commercialByCustomerId.delete(3);
    expect(() =>
      buildClusterSnapshotProfiles({
        snapshotId: '1',
        populationSize: 4,
        generatedAt: '2026-08-19T00:00:00.000Z',
        rows,
        featuresByCustomerId,
        commercialByCustomerId,
      }),
    ).toThrow(/Missing commercial aggregate/);
  });

  it('throws on a negative distanceToCentroid', () => {
    const { rows, featuresByCustomerId, commercialByCustomerId } = buildFixture();
    const negativeRows = [{ ...rows[0]!, distanceToCentroid: -1 }, ...rows.slice(1)];
    expect(() =>
      buildClusterSnapshotProfiles({
        snapshotId: '1',
        populationSize: 4,
        generatedAt: '2026-08-19T00:00:00.000Z',
        rows: negativeRows,
        featuresByCustomerId,
        commercialByCustomerId,
      }),
    ).toThrow(/Invalid distanceToCentroid/);
  });

  it('throws on a non-finite feature value (NaN/Inf guard)', () => {
    const { rows, featuresByCustomerId, commercialByCustomerId } = buildFixture();
    featuresByCustomerId.set(1, featureVector(Number.NaN));
    expect(() =>
      buildClusterSnapshotProfiles({
        snapshotId: '1',
        populationSize: 4,
        generatedAt: '2026-08-19T00:00:00.000Z',
        rows,
        featuresByCustomerId,
        commercialByCustomerId,
      }),
    ).toThrow(/Non-finite/);
  });
});
