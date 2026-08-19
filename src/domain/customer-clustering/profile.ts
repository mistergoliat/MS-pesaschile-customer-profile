import { sha256Stable } from '../customer-rfm/checksum.js';
import { featureOrder } from './model-version.js';
import type { RawClusterFeatureVector } from './contracts.js';
import {
  commercialProfileMetricNames,
  type ClusterCommercialProfile,
  type ClusterDistanceProfile,
  type ClusterFeatureProfile,
  type ClusterSnapshotProfile,
  type FeatureStatSummary,
} from './analytics-contracts.js';

export type ClusterProfileSourceRow = {
  readonly prestashopCustomerId: number;
  readonly clusterId: number;
  readonly distanceToCentroid: number;
};

export type ClusterCommercialAggregate = {
  readonly totalSpentTaxIncl: number;
  readonly averageOrderValueTaxIncl: number;
  readonly validOrders: number;
  readonly daysSinceLastOrder: number;
};

export type BuildClusterSnapshotProfilesInput = {
  readonly snapshotId: string;
  readonly populationSize: number;
  readonly generatedAt: string;
  readonly rows: readonly ClusterProfileSourceRow[];
  readonly featuresByCustomerId: ReadonlyMap<number, RawClusterFeatureVector>;
  readonly commercialByCustomerId: ReadonlyMap<number, ClusterCommercialAggregate>;
};

// Heavy calculation happens once here, at generation/backfill time — never re-derived per HTTP
// request (task Section 15). Throws (never silently drops a customer or a cluster) on any of
// the consistency violations task Section 43 lists, so an invalid profile can never be
// persisted or served.
export function buildClusterSnapshotProfiles(input: BuildClusterSnapshotProfilesInput): readonly ClusterSnapshotProfile[] {
  if (input.rows.length !== input.populationSize) {
    throw new Error(
      `Cluster snapshot row count (${input.rows.length}) does not match snapshot populationSize (${input.populationSize})`,
    );
  }

  const byCluster = new Map<number, ClusterProfileSourceRow[]>();
  for (const row of input.rows) {
    if (!Number.isFinite(row.distanceToCentroid) || row.distanceToCentroid < 0) {
      throw new Error(`Invalid distanceToCentroid for customer ${row.prestashopCustomerId}: ${row.distanceToCentroid}`);
    }
    const group = byCluster.get(row.clusterId) ?? [];
    group.push(row);
    byCluster.set(row.clusterId, group);
  }

  const profiles = [...byCluster.entries()]
    .sort(([a], [b]) => a - b)
    .map(([clusterId, rows]) => {
      // Deterministic ordering (mirrors buildClusterSnapshot's sortedPopulation convention) so
      // re-generating the same snapshot's profile always reproduces the same checksum (task
      // Section 42).
      const sortedRows = [...rows].sort((a, b) => a.prestashopCustomerId - b.prestashopCustomerId);

      const featureProfile = buildFeatureProfile(sortedRows, input.featuresByCustomerId, input.snapshotId);
      const commercialProfile = buildCommercialProfile(sortedRows, input.commercialByCustomerId, input.snapshotId);
      const distanceProfile = buildDistanceProfile(sortedRows);

      const profileChecksum = sha256Stable({
        snapshotId: input.snapshotId,
        clusterId,
        customerCount: sortedRows.length,
        featureProfile,
        commercialProfile,
        distanceProfile,
      });

      return {
        snapshotId: input.snapshotId,
        clusterId,
        customerCount: sortedRows.length,
        featureProfile,
        commercialProfile,
        distanceProfile,
        profileChecksum,
        generatedAt: input.generatedAt,
      } satisfies ClusterSnapshotProfile;
    });

  const totalCustomers = profiles.reduce((sum, profile) => sum + profile.customerCount, 0);
  if (totalCustomers !== input.populationSize) {
    throw new Error(`Cluster profile customerCount sum (${totalCustomers}) does not match snapshot populationSize (${input.populationSize})`);
  }

  return profiles;
}

function buildFeatureProfile(
  rows: readonly ClusterProfileSourceRow[],
  featuresByCustomerId: ReadonlyMap<number, RawClusterFeatureVector>,
  snapshotId: string,
): ClusterFeatureProfile {
  const entries = featureOrder.map((featureName) => {
    const values = rows.map((row) => {
      const vector = featuresByCustomerId.get(row.prestashopCustomerId);
      if (!vector) {
        throw new Error(`Missing feature vector for customer ${row.prestashopCustomerId} in snapshot ${snapshotId}`);
      }
      return vector[featureName];
    });
    return [featureName, statSummary(values)] as const;
  });
  return Object.fromEntries(entries) as ClusterFeatureProfile;
}

function buildCommercialProfile(
  rows: readonly ClusterProfileSourceRow[],
  commercialByCustomerId: ReadonlyMap<number, ClusterCommercialAggregate>,
  snapshotId: string,
): ClusterCommercialProfile {
  const entries = commercialProfileMetricNames.map((metricName) => {
    const values = rows.map((row) => {
      const aggregate = commercialByCustomerId.get(row.prestashopCustomerId);
      if (!aggregate) {
        throw new Error(`Missing commercial aggregate for customer ${row.prestashopCustomerId} in snapshot ${snapshotId}`);
      }
      return aggregate[metricName];
    });
    return [metricName, statSummary(values)] as const;
  });
  return Object.fromEntries(entries) as ClusterCommercialProfile;
}

function buildDistanceProfile(rows: readonly ClusterProfileSourceRow[]): ClusterDistanceProfile {
  const sorted = rows.map((row) => row.distanceToCentroid).sort((a, b) => a - b);
  return {
    medianDistance: round6(percentile(sorted, 0.5)),
    p95Distance: round6(percentile(sorted, 0.95)),
    maxDistance: round6(sorted[sorted.length - 1] ?? 0),
  };
}

function statSummary(values: readonly number[]): FeatureStatSummary {
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new Error(`Non-finite value in cluster profile aggregation: ${value}`);
    }
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = round6(values.reduce((sum, value) => sum + value, 0) / values.length);
  const median = round6(percentile(sorted, 0.5));
  const p25 = round6(percentile(sorted, 0.25));
  const p75 = round6(percentile(sorted, 0.75));
  if (!(p25 <= median && median <= p75)) {
    throw new Error(`Incoherent percentile ordering: p25=${p25} median=${median} p75=${p75}`);
  }
  return { mean, median, p25, p75 };
}

// Nearest-rank percentile — mirrors the private `percentile` helper in
// src/domain/customer-rfm/dataset.ts (deliberately reimplemented rather than imported/exported
// across capability boundaries, same precedent as the rest of clustering vs. RFM).
function percentile(sortedAscending: readonly number[], fraction: number): number {
  if (sortedAscending.length === 0) {
    throw new Error('Cannot compute a percentile of an empty cluster');
  }
  const index = Math.ceil(Math.min(Math.max(fraction, 0), 1) * sortedAscending.length) - 1;
  return sortedAscending[Math.max(index, 0)]!;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
