import { CUSTOMER_INTELLIGENCE_DASHBOARD_OVERVIEW_VERSION, type DashboardOverviewResult } from '../../domain/customer-intelligence-dashboard/index.js';
import type {
  ResolveCurrentCustomerIntelligenceContext,
  ResolveCustomerIntelligenceContextForFeatureSnapshot,
} from '../customer-intelligence/resolve-customer-intelligence-context.js';
import type { ClusterAnalyticsReader } from '../../infrastructure/clustering/mysql-cluster-analytics-reader.js';
import { buildDashboardContext } from './get-dashboard-context.js';
import type { DashboardAnalyticsReader } from './ports.js';

export type GetDashboardOverviewInput = {
  readonly featureSnapshotId: string | null;
};

export type GetDashboardOverview = (input: GetDashboardOverviewInput) => Promise<DashboardOverviewResult>;

// task Section 4/16: RFM/cluster absence never makes Overview unavailable - population.rfmMatched/
// clusterMatched are legitimately 0 in that case (already handled by the reused coverage
// counting), and commercial KPIs come from customer_feature_snapshot_row alone, which only
// requires the feature snapshot to exist. Only a missing/unreachable feature snapshot, or the
// analytics DB itself being down/not configured, produces a non-'available' result here.
export function createGetDashboardOverview(deps: {
  readonly resolveCurrent: ResolveCurrentCustomerIntelligenceContext;
  readonly resolveForFeatureSnapshot: ResolveCustomerIntelligenceContextForFeatureSnapshot;
  readonly clusterAnalyticsReader: ClusterAnalyticsReader;
  readonly dashboardAnalyticsReader: DashboardAnalyticsReader;
}): GetDashboardOverview {
  return async function getDashboardOverview(input) {
    const resolved =
      input.featureSnapshotId === null ? await deps.resolveCurrent() : await deps.resolveForFeatureSnapshot(input.featureSnapshotId);

    switch (resolved.status) {
      case 'no_published_feature_snapshot':
        return { status: 'no_published_feature_snapshot', contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_OVERVIEW_VERSION };
      case 'feature_snapshot_not_found':
        return {
          status: 'feature_snapshot_not_found',
          featureSnapshotId: resolved.featureSnapshotId,
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_OVERVIEW_VERSION,
        };
      case 'degraded':
        return {
          status: 'degraded',
          reason: resolved.reason === 'analytics_unavailable' ? 'analytics_unavailable' : 'dashboard_not_configured',
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_OVERVIEW_VERSION,
        };
      case 'available': {
        const [context, commercial] = await Promise.all([
          buildDashboardContext(resolved.context, deps.clusterAnalyticsReader),
          deps.dashboardAnalyticsReader.getOverviewCommercialAggregate(resolved.resolvedIds.featureSnapshotId),
        ]);
        return {
          status: 'available',
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_OVERVIEW_VERSION,
          context,
          population: resolved.context.population,
          commercial,
        };
      }
      default: {
        const exhaustive: never = resolved;
        throw new Error(`Unhandled resolveCustomerIntelligenceContext status: ${JSON.stringify(exhaustive)}`);
      }
    }
  };
}
