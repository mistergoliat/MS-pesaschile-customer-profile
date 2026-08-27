import {
  CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION,
  type DashboardIntersectionResult,
} from '../../domain/customer-intelligence-dashboard/index.js';
import type { AnalyticalFilterInput } from '../../domain/customer-intelligence-query/index.js';
import type { ClusterAnalyticsReader } from '../../infrastructure/clustering/mysql-cluster-analytics-reader.js';
import type { ExecuteIntersection } from '../customer-intelligence-intersection/index.js';
import { buildDashboardContext } from './get-dashboard-context.js';

export type GetDashboardIntersectionInput = {
  readonly featureSnapshotId: string | null;
  readonly filters: AnalyticalFilterInput | undefined;
};

export type GetDashboardIntersection = (input: GetDashboardIntersectionInput) => Promise<DashboardIntersectionResult>;

// Thin reshape over the shared, dashboard-agnostic executeIntersection (task Section 22: the
// canonical definition lives in customer-intelligence-intersection, not here) - the only new
// logic is mapping CustomerIntelligenceIntersectionResult onto the dashboard's flat
// DashboardContext (via buildDashboardContext, reused verbatim from T06.2 - task Section 13: no
// duplicated provenance structures) and the dashboard's own degraded-reason vocabulary.
export function createGetDashboardIntersection(deps: {
  readonly executeIntersection: ExecuteIntersection;
  readonly clusterAnalyticsReader: ClusterAnalyticsReader;
}): GetDashboardIntersection {
  return async function getDashboardIntersection(input) {
    const result = await deps.executeIntersection({ featureSnapshotId: input.featureSnapshotId, filters: input.filters });

    switch (result.status) {
      case 'no_published_feature_snapshot':
        return { status: 'no_published_feature_snapshot', contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION };
      case 'feature_snapshot_not_found':
        return {
          status: 'feature_snapshot_not_found',
          featureSnapshotId: result.featureSnapshotId,
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION,
        };
      case 'invalid_intersection':
        return {
          status: 'invalid_intersection',
          errors: result.errors,
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION,
        };
      case 'degraded':
        return {
          status: 'degraded',
          reason: result.reason === 'analytics_unavailable' ? 'analytics_unavailable' : 'dashboard_not_configured',
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION,
        };
      case 'required_rfm_snapshot_unavailable':
        return {
          status: 'required_rfm_snapshot_unavailable',
          context: await buildDashboardContext(result.resolvedContext, deps.clusterAnalyticsReader),
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION,
        };
      case 'required_cluster_snapshot_unavailable':
        return {
          status: 'required_cluster_snapshot_unavailable',
          context: await buildDashboardContext(result.resolvedContext, deps.clusterAnalyticsReader),
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION,
        };
      case 'available': {
        const context = await buildDashboardContext(result.definition.resolvedContext, deps.clusterAnalyticsReader);
        return {
          status: 'available',
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_INTERSECTION_RESPONSE_VERSION,
          context,
          intersection: {
            matchingPopulation: result.population.matchingPopulation,
            featurePopulation: result.population.featurePopulation,
            rfmMatchedPopulation: result.population.rfmMatchedPopulation,
            clusterMatchedPopulation: result.population.clusterMatchedPopulation,
            bothMatchedPopulation: result.population.bothMatchedPopulation,
            rfmCoveragePct: result.population.rfmCoveragePct,
            clusterCoveragePct: result.population.clusterCoveragePct,
            requiredDimensions: result.population.requiredDimensions,
          },
          metrics: result.metrics,
          analyticalDefinition: {
            queryPlanHash: result.definition.queryPlanHash,
            filters: result.definition.filters,
          },
          execution: result.execution,
        };
      }
      default: {
        const exhaustive: never = result;
        throw new Error(`Unhandled intersection status: ${JSON.stringify(exhaustive)}`);
      }
    }
  };
}
