import {
  computeCoverageSummary,
  CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION,
  selectLatestSnapshotAtOrBefore,
  type CustomerIntelligenceSnapshotContext,
} from '../../domain/customer-intelligence/index.js';
import { AnalyticsSchemaIncompatibleError, AnalyticsTimeoutError, AnalyticsUnavailableError } from '../customer-profile/errors.js';
import type { CustomerFeatureSnapshotReader, StoredCustomerFeatureSnapshot } from '../customer-analytics/ports.js';
import type { CustomerIntelligenceReader, ResolvedCustomerIntelligenceSnapshotIds, SnapshotHeaderReader } from './ports.js';

export type ResolveCustomerIntelligenceContextResult =
  | { readonly status: 'available'; readonly context: CustomerIntelligenceSnapshotContext; readonly resolvedIds: ResolvedCustomerIntelligenceSnapshotIds }
  | { readonly status: 'no_published_feature_snapshot'; readonly contractVersion: string }
  | { readonly status: 'feature_snapshot_not_found'; readonly featureSnapshotId: string; readonly contractVersion: string }
  | { readonly status: 'degraded'; readonly reason: 'analytics_not_configured' | 'analytics_unavailable'; readonly contractVersion: string };

export type ResolveCurrentCustomerIntelligenceContext = () => Promise<ResolveCustomerIntelligenceContextResult>;
export type ResolveCustomerIntelligenceContextForFeatureSnapshot = (
  featureSnapshotId: string,
) => Promise<ResolveCustomerIntelligenceContextResult>;

// task Section 8's recommended policy, implemented: the feature snapshot is always the
// anchor. RFM/cluster are each independently resolved to "latest published snapshot with
// referenceTime <= anchor.referenceTime" (never a future output relative to the anchor,
// task Section 31/44) — composed, never recomputed (task Section 50/51: this never re-derives
// R/F/M scores or re-assigns a cluster, it only selects which already-published snapshot row
// set to join against).
export function createCustomerIntelligenceContextResolvers(deps: {
  readonly featureSnapshotReader: CustomerFeatureSnapshotReader;
  readonly snapshotHeaderReader: SnapshotHeaderReader;
  readonly intelligenceReader: CustomerIntelligenceReader;
}): {
  readonly resolveCurrent: ResolveCurrentCustomerIntelligenceContext;
  readonly resolveForFeatureSnapshot: ResolveCustomerIntelligenceContextForFeatureSnapshot;
} {
  async function buildFromFeatureSnapshot(featureSnapshot: StoredCustomerFeatureSnapshot): Promise<ResolveCustomerIntelligenceContextResult> {
    const featureReferenceTime = featureSnapshot.referenceTime.toISOString();

    const [rfmHeaders, clusterHeaders] = await Promise.all([
      deps.snapshotHeaderReader.getPublishedRfmSnapshotHeaders(),
      deps.snapshotHeaderReader.getPublishedClusterSnapshotHeaders(),
    ]);
    const rfmHeader = selectLatestSnapshotAtOrBefore(rfmHeaders, featureReferenceTime);
    const clusterHeader = selectLatestSnapshotAtOrBefore(clusterHeaders, featureReferenceTime);

    const resolvedIds: ResolvedCustomerIntelligenceSnapshotIds = {
      featureSnapshotId: featureSnapshot.snapshotId,
      featureReferenceTime,
      featureVersion: featureSnapshot.featureVersion,
      populationPolicyVersion: featureSnapshot.populationPolicyVersion,
      rfmSnapshotId: rfmHeader?.snapshotId ?? null,
      rfmReferenceTime: rfmHeader?.referenceTime ?? null,
      calculationVersion: rfmHeader?.calculationVersion ?? null,
      clusterSnapshotId: clusterHeader?.snapshotId ?? null,
      clusterReferenceTime: clusterHeader?.referenceTime ?? null,
      clusterModelId: clusterHeader?.modelId ?? null,
      clusterModelVersion: clusterHeader?.modelVersion ?? null,
    };

    const counts = await deps.intelligenceReader.getCoverageCounts(resolvedIds);
    const population = computeCoverageSummary(counts);

    const context: CustomerIntelligenceSnapshotContext = {
      featureSnapshot: {
        snapshotId: resolvedIds.featureSnapshotId,
        referenceTime: resolvedIds.featureReferenceTime,
        featureVersion: resolvedIds.featureVersion,
        populationPolicyVersion: resolvedIds.populationPolicyVersion,
      },
      rfmSnapshot: rfmHeader
        ? { snapshotId: rfmHeader.snapshotId, referenceTime: rfmHeader.referenceTime, calculationVersion: rfmHeader.calculationVersion }
        : null,
      clusterSnapshot: clusterHeader
        ? {
            snapshotId: clusterHeader.snapshotId,
            referenceTime: clusterHeader.referenceTime,
            modelId: clusterHeader.modelId,
            modelVersion: clusterHeader.modelVersion,
          }
        : null,
      population,
      contractVersion: CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION,
    };

    return { status: 'available', context, resolvedIds };
  }

  return {
    resolveCurrent: async () => {
      try {
        const featureSnapshot = await deps.featureSnapshotReader.getLatestPublishedSnapshot();
        if (!featureSnapshot) {
          return { status: 'no_published_feature_snapshot', contractVersion: CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION };
        }
        return await buildFromFeatureSnapshot(featureSnapshot);
      } catch (error) {
        return mapContextError(error);
      }
    },

    resolveForFeatureSnapshot: async (featureSnapshotId) => {
      try {
        const featureSnapshot = await deps.featureSnapshotReader.getSnapshotById(featureSnapshotId);
        if (!featureSnapshot) {
          return { status: 'feature_snapshot_not_found', featureSnapshotId, contractVersion: CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION };
        }
        return await buildFromFeatureSnapshot(featureSnapshot);
      } catch (error) {
        return mapContextError(error);
      }
    },
  };
}

function mapContextError(error: unknown): ResolveCustomerIntelligenceContextResult {
  if (error instanceof AnalyticsUnavailableError || error instanceof AnalyticsTimeoutError || error instanceof AnalyticsSchemaIncompatibleError) {
    return { status: 'degraded', reason: 'analytics_unavailable', contractVersion: CUSTOMER_INTELLIGENCE_READ_MODEL_VERSION };
  }
  throw error;
}
