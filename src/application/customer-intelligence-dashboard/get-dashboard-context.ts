import {
  CUSTOMER_INTELLIGENCE_DASHBOARD_CONTEXT_VERSION,
  type DashboardContext,
  type DashboardContextResult,
} from '../../domain/customer-intelligence-dashboard/index.js';
import type { CustomerIntelligenceSnapshotContext } from '../../domain/customer-intelligence/index.js';
import type {
  ResolveCurrentCustomerIntelligenceContext,
  ResolveCustomerIntelligenceContextForFeatureSnapshot,
} from '../customer-intelligence/resolve-customer-intelligence-context.js';
import type { ClusterAnalyticsReader } from '../../infrastructure/clustering/mysql-cluster-analytics-reader.js';

export type GetDashboardContextInput = {
  // null => latest published feature snapshot (task Section 2/3). A specific id supports
  // explicit pinning via the existing featureSnapshotId convention already used by the Copilot
  // (task Section 2: "if a clean existing pattern allows... support that without
  // overengineering" - this is that pattern, reused verbatim, not a new pinning mechanism).
  readonly featureSnapshotId: string | null;
};

export type GetDashboardContext = (input: GetDashboardContextInput) => Promise<DashboardContextResult>;

// Thin reshape over createCustomerIntelligenceContextResolvers (task Section 1: never a second
// snapshot-resolution algorithm) - the only new logic here is flattening the nested
// CustomerIntelligenceSnapshotContext into the dashboard's flat, UI-safe DashboardContext shape
// and deriving clusterInterpretationVersion (task Section 3), which the read model does not
// expose as a single top-level value today.
export function createGetDashboardContext(deps: {
  readonly resolveCurrent: ResolveCurrentCustomerIntelligenceContext;
  readonly resolveForFeatureSnapshot: ResolveCustomerIntelligenceContextForFeatureSnapshot;
  readonly clusterAnalyticsReader: ClusterAnalyticsReader;
}): GetDashboardContext {
  return async function getDashboardContext(input) {
    const resolved =
      input.featureSnapshotId === null ? await deps.resolveCurrent() : await deps.resolveForFeatureSnapshot(input.featureSnapshotId);

    switch (resolved.status) {
      case 'no_published_feature_snapshot':
        return { status: 'no_published_feature_snapshot', contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_CONTEXT_VERSION };
      case 'feature_snapshot_not_found':
        return {
          status: 'feature_snapshot_not_found',
          featureSnapshotId: resolved.featureSnapshotId,
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_CONTEXT_VERSION,
        };
      case 'degraded':
        return {
          status: 'degraded',
          reason: resolved.reason === 'analytics_unavailable' ? 'analytics_unavailable' : 'dashboard_not_configured',
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_CONTEXT_VERSION,
        };
      case 'available':
        return {
          status: 'available',
          contractVersion: CUSTOMER_INTELLIGENCE_DASHBOARD_CONTEXT_VERSION,
          context: await buildDashboardContext(resolved.context, deps.clusterAnalyticsReader),
          population: resolved.context.population,
        };
      default: {
        const exhaustive: never = resolved;
        throw new Error(`Unhandled resolveCustomerIntelligenceContext status: ${JSON.stringify(exhaustive)}`);
      }
    }
  };
}

// Exported for reuse by the other three dashboard read services (get-dashboard-overview.ts,
// get-dashboard-rfm.ts, get-dashboard-clusters.ts) - every dashboard response embeds the exact
// same provenance shape (task Section 13: "do not duplicate incompatible provenance
// structures"), never a per-endpoint reimplementation.
export async function buildDashboardContext(
  context: CustomerIntelligenceSnapshotContext,
  clusterAnalyticsReader: ClusterAnalyticsReader,
): Promise<DashboardContext> {
  const clusterInterpretationVersion = context.clusterSnapshot
    ? deriveSharedInterpretationVersion(await clusterAnalyticsReader.getInterpretations(context.clusterSnapshot.modelId))
    : null;

  return {
    featureSnapshotId: context.featureSnapshot.snapshotId,
    featureReferenceTime: context.featureSnapshot.referenceTime,
    featureVersion: context.featureSnapshot.featureVersion,
    populationPolicyVersion: context.featureSnapshot.populationPolicyVersion,
    rfmSnapshotId: context.rfmSnapshot?.snapshotId ?? null,
    rfmReferenceTime: context.rfmSnapshot?.referenceTime ?? null,
    rfmCalculationVersion: context.rfmSnapshot?.calculationVersion ?? null,
    clusterSnapshotId: context.clusterSnapshot?.snapshotId ?? null,
    clusterReferenceTime: context.clusterSnapshot?.referenceTime ?? null,
    clusterModelVersion: context.clusterSnapshot?.modelVersion ?? null,
    clusterInterpretationVersion,
  };
}

// Interpretations can, in principle, be backfilled cluster-by-cluster at different times (the
// underlying table is versioned per (modelId, clusterId) - see customer_cluster_interpretation).
// Rather than assume they always share one version, this only reports a version when every
// interpreted cluster for the model actually agrees - otherwise null, honestly reflecting that
// the context has no single answer (never guessed).
function deriveSharedInterpretationVersion(interpretations: ReadonlyMap<number, { readonly interpretationVersion: string }>): string | null {
  const versions = new Set([...interpretations.values()].map((interpretation) => interpretation.interpretationVersion));
  if (versions.size !== 1) return null;
  const [onlyVersion] = versions;
  return onlyVersion ?? null;
}
