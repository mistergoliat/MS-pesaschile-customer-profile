import {
  CUSTOMER_INTELLIGENCE_DASHBOARD_CLUSTERS_VERSION,
  CUSTOMER_INTELLIGENCE_DASHBOARD_CONTEXT_VERSION,
  CUSTOMER_INTELLIGENCE_DASHBOARD_OVERVIEW_VERSION,
  CUSTOMER_INTELLIGENCE_DASHBOARD_RFM_VERSION,
} from '../../domain/customer-intelligence-dashboard/index.js';
import type { GetDashboardContext } from './get-dashboard-context.js';
import type { GetDashboardOverview } from './get-dashboard-overview.js';
import type { GetDashboardRfm } from './get-dashboard-rfm.js';
import type { GetDashboardClusters } from './get-dashboard-clusters.js';

// Used by bootstrap.ts when ANALYTICS_DB_* is absent - mirrors cluster-analytics-not-
// configured.ts exactly. The dashboard is gated on the same config.analyticsDb the Copilot/T02/
// T03 already use (task Section 1: same read model, same runtime capability), not a new flag.
export const getDashboardContextNotConfigured: GetDashboardContext = async () => ({
  status: 'degraded',
  reason: 'dashboard_not_configured',
  contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_CONTEXT_VERSION,
});

export const getDashboardOverviewNotConfigured: GetDashboardOverview = async () => ({
  status: 'degraded',
  reason: 'dashboard_not_configured',
  contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_OVERVIEW_VERSION,
});

export const getDashboardRfmNotConfigured: GetDashboardRfm = async () => ({
  status: 'degraded',
  reason: 'dashboard_not_configured',
  contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_RFM_VERSION,
});

export const getDashboardClustersNotConfigured: GetDashboardClusters = async () => ({
  status: 'degraded',
  reason: 'dashboard_not_configured',
  contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_CLUSTERS_VERSION,
});
