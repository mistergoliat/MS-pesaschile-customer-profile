import {
  CUSTOMER_INTELLIGENCE_DASHBOARD_CLUSTERS_VERSION,
  type DashboardCluster,
  type DashboardClusterRfmCrossSection,
  type DashboardClustersResult,
} from '../../domain/customer-intelligence-dashboard/index.js';
import { resolveRfmSegmentBusinessLabel } from '../../domain/customer-intelligence-copilot/index.js';
import type {
  ResolveCurrentCustomerIntelligenceContext,
  ResolveCustomerIntelligenceContextForFeatureSnapshot,
} from '../customer-intelligence/resolve-customer-intelligence-context.js';
import type { ClusterAnalyticsInterpretation, ClusterAnalyticsReader } from '../../infrastructure/clustering/mysql-cluster-analytics-reader.js';
import { buildDashboardContext } from './get-dashboard-context.js';
import type { DashboardAnalyticsReader, DashboardClusterAggregate, DashboardClusterRfmCrossSectionGroup } from './ports.js';

export type GetDashboardClustersInput = {
  readonly featureSnapshotId: string | null;
};

export type GetDashboardClusters = (input: GetDashboardClustersInput) => Promise<DashboardClustersResult>;

// task Section 7/16: the RFM cross-section is deliberately NOT built by reusing
// get-rfm-cluster-cross-tab.ts verbatim - that endpoint's RFM side always resolves "latest
// published RFM snapshot" independently of any cluster/feature anchor (see its own header
// comment), which would silently mix a newer RFM snapshot with this context's feature-anchored
// cluster snapshot whenever a newer RFM snapshot has been published since - exactly the
// snapshot-alignment hazard docs/audits/MARKETING-R1-T06-1-...md Section 6/P0-1 warns against.
// This reader instead groups on the SAME resolved (clusterSnapshotId, rfmSnapshotId) pair every
// other dashboard section uses, reusing only the UNSEGMENTED convention and coverage shape from
// the existing cross-tab for consistency, never its snapshot selection.
export function createGetDashboardClusters(deps: {
  readonly resolveCurrent: ResolveCurrentCustomerIntelligenceContext;
  readonly resolveForFeatureSnapshot: ResolveCustomerIntelligenceContextForFeatureSnapshot;
  readonly clusterAnalyticsReader: ClusterAnalyticsReader;
  readonly dashboardAnalyticsReader: DashboardAnalyticsReader;
}): GetDashboardClusters {
  return async function getDashboardClusters(input) {
    const resolved =
      input.featureSnapshotId === null ? await deps.resolveCurrent() : await deps.resolveForFeatureSnapshot(input.featureSnapshotId);

    switch (resolved.status) {
      case 'no_published_feature_snapshot':
        return { status: 'no_published_feature_snapshot', contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_CLUSTERS_VERSION };
      case 'feature_snapshot_not_found':
        return {
          status: 'feature_snapshot_not_found',
          featureSnapshotId: resolved.featureSnapshotId,
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_CLUSTERS_VERSION,
        };
      case 'degraded':
        return {
          status: 'degraded',
          reason: resolved.reason === 'analytics_unavailable' ? 'analytics_unavailable' : 'dashboard_not_configured',
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_CLUSTERS_VERSION,
        };
      case 'available': {
        const context = await buildDashboardContext(resolved.context, deps.clusterAnalyticsReader);
        if (resolved.context.clusterSnapshot === null) {
          return { status: 'no_compatible_cluster_snapshot', context, contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_CLUSTERS_VERSION };
        }

        const clusterSnapshotId = resolved.resolvedIds.clusterSnapshotId!;
        const featureSnapshotId = resolved.resolvedIds.featureSnapshotId;
        const analyzedPopulation = resolved.context.population.clusterMatched;
        const fullFeaturePopulation = resolved.context.population.featurePopulation;
        const rfmCrossSectionAvailable = resolved.context.rfmSnapshot !== null;

        const [aggregates, interpretations, crossSectionGroups] = await Promise.all([
          deps.dashboardAnalyticsReader.getClusterAggregates(clusterSnapshotId, featureSnapshotId),
          deps.clusterAnalyticsReader.getInterpretations(resolved.context.clusterSnapshot.modelId),
          rfmCrossSectionAvailable
            ? deps.dashboardAnalyticsReader.getClusterRfmCrossSectionGroups(clusterSnapshotId, featureSnapshotId, resolved.resolvedIds.rfmSnapshotId!)
            : Promise.resolve<readonly DashboardClusterRfmCrossSectionGroup[]>([]),
        ]);

        const crossSectionByCluster = groupCrossSectionsByCluster(crossSectionGroups);

        return {
          status: 'available',
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_CLUSTERS_VERSION,
          context,
          analyzedPopulation,
          fullFeaturePopulation,
          coveragePct: resolved.context.population.clusterCoveragePct,
          rfmCrossSectionAvailable,
          clusters: aggregates
            .map((aggregate) =>
              toDashboardCluster(
                aggregate,
                analyzedPopulation,
                fullFeaturePopulation,
                interpretations.get(aggregate.clusterId) ?? null,
                rfmCrossSectionAvailable ? (crossSectionByCluster.get(aggregate.clusterId) ?? emptyCrossSection()) : null,
              ),
            )
            .sort((a, b) => a.clusterId - b.clusterId),
        };
      }
      default: {
        const exhaustive: never = resolved;
        throw new Error(`Unhandled resolveCustomerIntelligenceContext status: ${JSON.stringify(exhaustive)}`);
      }
    }
  };
}

const UNSEGMENTED = 'UNSEGMENTED';

function toDashboardCluster(
  aggregate: DashboardClusterAggregate,
  analyzedPopulation: number,
  fullFeaturePopulation: number,
  interpretation: ClusterAnalyticsInterpretation | null,
  crossSection: DashboardClusterRfmCrossSection | null,
): DashboardCluster {
  return {
    clusterId: aggregate.clusterId,
    businessLabel: interpretation?.label ?? null,
    interpretationVersion: interpretation?.interpretationVersion ?? null,
    customerCount: aggregate.customerCount,
    percentageOfClusterPopulation: percentage(aggregate.customerCount, analyzedPopulation),
    percentageOfFeaturePopulation: percentage(aggregate.customerCount, fullFeaturePopulation),
    averageOrderValueTaxIncl: aggregate.averageOrderValueTaxIncl,
    averageTotalSpentTaxIncl: aggregate.averageTotalSpentTaxIncl,
    averageValidOrders: aggregate.averageValidOrders,
    averageOrders365d: aggregate.averageOrders365d,
    averageDaysSinceLastOrder: aggregate.averageDaysSinceLastOrder,
    averageEffectiveDiversity: aggregate.averageEffectiveDiversity,
    averageRepeatProductRate: aggregate.averageRepeatProductRate,
    rfmCrossSection: crossSection,
  };
}

function groupCrossSectionsByCluster(
  groups: readonly DashboardClusterRfmCrossSectionGroup[],
): ReadonlyMap<number, DashboardClusterRfmCrossSection> {
  const byCluster = new Map<number, { comparablePopulation: number; notInRfmPopulation: number; segmentCounts: Map<string, number> }>();

  for (const group of groups) {
    const entry = byCluster.get(group.clusterId) ?? { comparablePopulation: 0, notInRfmPopulation: 0, segmentCounts: new Map<string, number>() };
    if (!group.hasRfmRow) {
      entry.notInRfmPopulation += group.customerCount;
    } else {
      entry.comparablePopulation += group.customerCount;
      const segmentKey = group.segmentCode ?? UNSEGMENTED;
      entry.segmentCounts.set(segmentKey, (entry.segmentCounts.get(segmentKey) ?? 0) + group.customerCount);
    }
    byCluster.set(group.clusterId, entry);
  }

  const result = new Map<number, DashboardClusterRfmCrossSection>();
  for (const [clusterId, entry] of byCluster) {
    const clusterPopulation = entry.comparablePopulation + entry.notInRfmPopulation;
    result.set(clusterId, {
      comparablePopulation: entry.comparablePopulation,
      notInRfmPopulation: entry.notInRfmPopulation,
      coveragePct: percentage(entry.comparablePopulation, clusterPopulation),
      segments: [...entry.segmentCounts.entries()]
        .map(([segmentKey, customerCount]) => ({
          segmentCode: segmentKey === UNSEGMENTED ? null : segmentKey,
          businessLabel: resolveRfmSegmentBusinessLabel(segmentKey === UNSEGMENTED ? null : segmentKey),
          customerCount,
          percentageOfComparablePopulation: percentage(customerCount, entry.comparablePopulation),
        }))
        .sort((a, b) => b.customerCount - a.customerCount),
    });
  }
  return result;
}

function emptyCrossSection(): DashboardClusterRfmCrossSection {
  return { comparablePopulation: 0, notInRfmPopulation: 0, coveragePct: 0, segments: [] };
}

function percentage(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100 * 100) / 100;
}
