import { CLUSTER_ANALYTICS_CONTRACT_VERSION, type GetClusterSnapshotSummaryResult } from '../../domain/customer-clustering/index.js';
import { ClusterSchemaIncompatibleError, ClusterTimeoutError, ClusterUnavailableError } from '../customer-profile/errors.js';
import type { ClusterAnalyticsReader } from '../../infrastructure/clustering/mysql-cluster-analytics-reader.js';
import type { ClusterSnapshotProfileRepository } from '../../infrastructure/clustering/mysql-cluster-snapshot-profile-repository.js';

export type GetClusterSnapshotSummaryInput = {
  // null => latest published snapshot (task Section 19); a specific id => task Section 20.
  readonly snapshotId: string | null;
};

export type GetClusterSnapshotSummary = (input: GetClusterSnapshotSummaryInput) => Promise<GetClusterSnapshotSummaryResult>;

// Read-only assembly of an already-published/backfilled snapshot — never recomputes clustering,
// never trains, never touches PrestaShop (task Section 19/58). A cluster's featureProfile/
// commercialProfile/distanceProfile are null (not a whole-response failure) when a snapshot was
// published before its profile was backfilled — population count/percentage/model provenance
// remain available regardless, since they come straight from customer_cluster_snapshot_row/
// customer_cluster_model and never depend on the profile table.
export function createGetClusterSnapshotSummary(deps: {
  readonly clusterAnalyticsReader: ClusterAnalyticsReader;
  readonly clusterSnapshotProfileRepository: ClusterSnapshotProfileRepository;
}): GetClusterSnapshotSummary {
  return async function getClusterSnapshotSummary(input) {
    try {
      const meta =
        input.snapshotId === null
          ? await deps.clusterAnalyticsReader.getLatestPublishedSnapshot()
          : await deps.clusterAnalyticsReader.getPublishedSnapshotById(input.snapshotId);

      if (!meta) {
        if (input.snapshotId === null) {
          return { status: 'no_published_cluster_snapshot', contractVersion: CLUSTER_ANALYTICS_CONTRACT_VERSION };
        }
        return {
          status: 'cluster_snapshot_not_found',
          snapshotId: input.snapshotId,
          contractVersion: CLUSTER_ANALYTICS_CONTRACT_VERSION,
        };
      }

      const [distribution, interpretations, profiles] = await Promise.all([
        deps.clusterAnalyticsReader.getClusterSizeDistribution(meta.snapshotId),
        deps.clusterAnalyticsReader.getInterpretations(meta.modelId),
        deps.clusterSnapshotProfileRepository.getProfiles(meta.snapshotId),
      ]);
      const profileByCluster = new Map(profiles.map((profile) => [profile.clusterId, profile]));

      const clusterIds = [...distribution.keys()].sort((a, b) => a - b);
      const clusters = clusterIds.map((clusterId) => {
        const count = distribution.get(clusterId) ?? 0;
        const profile = profileByCluster.get(clusterId) ?? null;
        return {
          clusterId,
          interpretation: interpretations.get(clusterId) ?? null,
          population: {
            count,
            percentage: meta.populationSize > 0 ? round2((count / meta.populationSize) * 100) : 0,
          },
          featureProfile: profile?.featureProfile ?? null,
          commercialProfile: profile?.commercialProfile ?? null,
          distanceProfile: profile?.distanceProfile ?? null,
        };
      });

      return {
        status: 'available',
        contractVersion: CLUSTER_ANALYTICS_CONTRACT_VERSION,
        snapshot: {
          snapshotId: meta.snapshotId,
          referenceTime: meta.referenceTime.toISOString(),
          publishedAt: meta.publishedAt.toISOString(),
          populationSize: meta.populationSize,
          status: meta.status,
        },
        model: {
          modelVersion: meta.modelVersion,
          algorithm: meta.algorithm,
          k: meta.k,
          featureVersion: meta.featureVersion,
          preprocessingVersion: meta.preprocessingVersion,
          temporalStabilityStatus: meta.temporalStabilityStatus,
          metrics: meta.metrics,
        },
        clusters,
      };
    } catch (error) {
      if (error instanceof ClusterUnavailableError || error instanceof ClusterTimeoutError || error instanceof ClusterSchemaIncompatibleError) {
        return {
          status: 'degraded',
          reason: 'cluster_analytics_unavailable',
          contractVersion: CLUSTER_ANALYTICS_CONTRACT_VERSION,
        };
      }
      throw error;
    }
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
