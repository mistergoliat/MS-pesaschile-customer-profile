import { selectLatestSnapshotAtOrBefore } from '../../domain/customer-intelligence/snapshot-selection.js';
import { AUDIENCE_CONTEXT_VERSION, AUDIENCE_LINEAGE_RESOLUTION_VERSION, type AudienceAvailabilityV1, type AudienceEvaluationContextV1 } from '../../domain/customer-intelligence-audience/index.js';
import type { CustomerFeatureSnapshotReader } from '../customer-analytics/ports.js';
import type { AudienceContextResolution, AudienceContextResolver, AudienceSnapshotHeaderReader } from './ports.js';

export function createAudienceContextResolver(deps: {
  readonly featureSnapshotReader: CustomerFeatureSnapshotReader;
  readonly snapshotHeaderReader: AudienceSnapshotHeaderReader;
}): AudienceContextResolver {
  async function resolve(featureSnapshotId: string | null): Promise<AudienceContextResolution> {
    try {
      const feature = featureSnapshotId === null ? await deps.featureSnapshotReader.getLatestPublishedSnapshot() : await deps.featureSnapshotReader.getSnapshotById(featureSnapshotId);
      if (feature === null) return { status: 'unavailable', reason: 'FEATURE_SNAPSHOT_NOT_FOUND', context: null, availability: unavailableFeatureAvailability() };
      const anchor = feature.referenceTime.toISOString();
      const [rfm, cluster, clv, affinity] = await Promise.all([
        deps.snapshotHeaderReader.getPublishedRfmSnapshotHeaders(),
        deps.snapshotHeaderReader.getPublishedClusterSnapshotHeaders(),
        deps.snapshotHeaderReader.getPublishedClvSnapshotHeaders(),
        deps.snapshotHeaderReader.getPublishedAffinitySnapshotHeaders(),
      ]);
      const lineage = {
        feature: {
          snapshotId: feature.snapshotId, referenceTime: anchor, featureVersion: feature.featureVersion,
          populationPolicyVersion: feature.populationPolicyVersion, featureDatasetChecksum: feature.featureDatasetChecksum,
          populationChecksum: feature.featureDatasetChecksum,
        },
        rfm: selectLatestSnapshotAtOrBefore(rfm, anchor),
        cluster: selectLatestSnapshotAtOrBefore(cluster, anchor),
        clv: selectLatestSnapshotAtOrBefore(clv, anchor),
        commercialAffinity: selectLatestSnapshotAtOrBefore(affinity, anchor),
      } as const;
      const context: AudienceEvaluationContextV1 = {
        contextVersion: AUDIENCE_CONTEXT_VERSION, referenceTime: anchor,
        population: {
          universeId: 'customer-analytics-population-b-v1', identityAuthority: 'prestashop_customer',
          policyVersion: feature.populationPolicyVersion, populationSize: feature.populationSize,
          populationChecksum: feature.featureDatasetChecksum,
        },
        lineage, resolutionPolicyVersion: AUDIENCE_LINEAGE_RESOLUTION_VERSION,
      };
      const availability: AudienceAvailabilityV1 = {
        feature: 'AVAILABLE', rfm: lineage.rfm ? 'AVAILABLE' : 'UNAVAILABLE', cluster: lineage.cluster ? 'AVAILABLE' : 'UNAVAILABLE',
        clv: lineage.clv ? 'AVAILABLE' : 'UNAVAILABLE', commercialAffinity: lineage.commercialAffinity ? 'AVAILABLE' : 'UNAVAILABLE',
      };
      return { status: 'available', context, availability };
    } catch {
      return { status: 'unavailable', reason: 'ANALYTICS_UNAVAILABLE', context: null, availability: unavailableFeatureAvailability() };
    }
  }
  return { resolveCurrent: () => resolve(null), resolveForFeatureSnapshot: (id) => resolve(id) };
}

function unavailableFeatureAvailability(): AudienceAvailabilityV1 {
  return { feature: 'UNAVAILABLE', rfm: 'UNAVAILABLE', cluster: 'UNAVAILABLE', clv: 'UNAVAILABLE', commercialAffinity: 'UNAVAILABLE' };
}
