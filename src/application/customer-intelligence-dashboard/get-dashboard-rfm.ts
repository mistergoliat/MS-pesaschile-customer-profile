import { CUSTOMER_INTELLIGENCE_DASHBOARD_RFM_VERSION, type DashboardRfmResult, type DashboardRfmSegment } from '../../domain/customer-intelligence-dashboard/index.js';
import { resolveRfmSegmentBusinessLabel } from '../../domain/customer-intelligence-copilot/index.js';
import type {
  ResolveCurrentCustomerIntelligenceContext,
  ResolveCustomerIntelligenceContextForFeatureSnapshot,
} from '../customer-intelligence/resolve-customer-intelligence-context.js';
import type { ClusterAnalyticsReader } from '../../infrastructure/clustering/mysql-cluster-analytics-reader.js';
import { buildDashboardContext } from './get-dashboard-context.js';
import type { DashboardAnalyticsReader, DashboardRfmSegmentAggregate } from './ports.js';

export type GetDashboardRfmInput = {
  readonly featureSnapshotId: string | null;
};

export type GetDashboardRfm = (input: GetDashboardRfmInput) => Promise<DashboardRfmResult>;

// task Section 5/10: analyzedPopulation is always the RFM-matched (RFM row INNER JOIN feature
// row) population, never the full feature population - reuses the exact same rfmMatched/
// rfmCoveragePct the read model's own coverage counting already computes, so this endpoint can
// never silently drift from what /dashboard/context or /dashboard/overview report for the same
// snapshot pair.
export function createGetDashboardRfm(deps: {
  readonly resolveCurrent: ResolveCurrentCustomerIntelligenceContext;
  readonly resolveForFeatureSnapshot: ResolveCustomerIntelligenceContextForFeatureSnapshot;
  readonly clusterAnalyticsReader: ClusterAnalyticsReader;
  readonly dashboardAnalyticsReader: DashboardAnalyticsReader;
}): GetDashboardRfm {
  return async function getDashboardRfm(input) {
    const resolved =
      input.featureSnapshotId === null ? await deps.resolveCurrent() : await deps.resolveForFeatureSnapshot(input.featureSnapshotId);

    switch (resolved.status) {
      case 'no_published_feature_snapshot':
        return { status: 'no_published_feature_snapshot', contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_RFM_VERSION };
      case 'feature_snapshot_not_found':
        return {
          status: 'feature_snapshot_not_found',
          featureSnapshotId: resolved.featureSnapshotId,
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_RFM_VERSION,
        };
      case 'degraded':
        return {
          status: 'degraded',
          reason: resolved.reason === 'analytics_unavailable' ? 'analytics_unavailable' : 'dashboard_not_configured',
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_RFM_VERSION,
        };
      case 'available': {
        const context = await buildDashboardContext(resolved.context, deps.clusterAnalyticsReader);
        if (resolved.context.rfmSnapshot === null) {
          return { status: 'no_compatible_rfm_snapshot', context, contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_RFM_VERSION };
        }

        const analyzedPopulation = resolved.context.population.rfmMatched;
        const fullFeaturePopulation = resolved.context.population.featurePopulation;
        const aggregates = await deps.dashboardAnalyticsReader.getRfmSegmentAggregates(
          resolved.resolvedIds.rfmSnapshotId!,
          resolved.resolvedIds.featureSnapshotId,
        );

        return {
          status: 'available',
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_RFM_VERSION,
          context,
          analyzedPopulation,
          fullFeaturePopulation,
          coveragePct: resolved.context.population.rfmCoveragePct,
          segments: aggregates
            .map((aggregate) => toDashboardRfmSegment(aggregate, analyzedPopulation, fullFeaturePopulation))
            .sort((a, b) => b.customerCount - a.customerCount),
        };
      }
      default: {
        const exhaustive: never = resolved;
        throw new Error(`Unhandled resolveCustomerIntelligenceContext status: ${JSON.stringify(exhaustive)}`);
      }
    }
  };
}

function toDashboardRfmSegment(
  aggregate: DashboardRfmSegmentAggregate,
  analyzedPopulation: number,
  fullFeaturePopulation: number,
): DashboardRfmSegment {
  return {
    segmentCode: aggregate.segmentCode,
    businessLabel: resolveRfmSegmentBusinessLabel(aggregate.segmentCode),
    customerCount: aggregate.customerCount,
    percentageOfRfmPopulation: percentage(aggregate.customerCount, analyzedPopulation),
    percentageOfFeaturePopulation: percentage(aggregate.customerCount, fullFeaturePopulation),
    averageRScore: aggregate.averageRScore,
    averageFScore: aggregate.averageFScore,
    averageMScore: aggregate.averageMScore,
    averageOrderValueTaxIncl: aggregate.averageOrderValueTaxIncl,
    averageTotalSpentTaxIncl: aggregate.averageTotalSpentTaxIncl,
    averageValidOrders: aggregate.averageValidOrders,
    averageDaysSinceLastOrder: aggregate.averageDaysSinceLastOrder,
  };
}

function percentage(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100 * 100) / 100;
}
