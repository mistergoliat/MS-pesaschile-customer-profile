import { CLUSTER_ANALYTICS_CONTRACT_VERSION } from '../../domain/customer-clustering/index.js';
import type { GetClusterSnapshotSummary } from './get-cluster-snapshot-summary.js';
import type { GetRfmClusterCrossTab } from './get-rfm-cluster-cross-tab.js';

// Used by bootstrap.ts when CLUSTER_DB_* is absent — mirrors cluster-not-configured.ts exactly
// (task Section 32/46). Every other endpoint keeps working unaffected.
export const getClusterSnapshotSummaryNotConfigured: GetClusterSnapshotSummary = async () => ({
  status: 'degraded',
  reason: 'cluster_analytics_not_configured',
  contractVersion: CLUSTER_ANALYTICS_CONTRACT_VERSION,
});

export const getRfmClusterCrossTabNotConfigured: GetRfmClusterCrossTab = async () => ({
  status: 'degraded',
  reason: 'cluster_analytics_not_configured',
  contractVersion: CLUSTER_ANALYTICS_CONTRACT_VERSION,
});

// Distinct from the above: clustering IS configured (CLUSTER_DB_* present) but RFM_SNAPSHOT_DB_*
// is absent — the cluster snapshot summary keeps working, only the cross-tab degrades (task
// Section 45).
export const getRfmClusterCrossTabRfmNotConfigured: GetRfmClusterCrossTab = async () => ({
  status: 'degraded',
  reason: 'rfm_not_configured',
  contractVersion: CLUSTER_ANALYTICS_CONTRACT_VERSION,
});
