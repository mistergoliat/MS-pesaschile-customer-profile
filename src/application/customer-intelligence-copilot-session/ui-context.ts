import {
  CUSTOMER_INTELLIGENCE_COPILOT_UI_CONTEXT_VERSION,
  resolveFilterFieldBusinessValue,
  resolveFilterFieldLabel,
  type CopilotUiContextRequest,
  type CopilotUiContextSelectedPopulation,
  type CopilotUiContextSelectedPopulationFilter,
} from '../../domain/customer-intelligence-copilot/index.js';
import type { AnalyticalFilterCondition, AnalyticalFilterInput, AnalyticalFilterNode } from '../../domain/customer-intelligence-query/index.js';
import type { ExecuteIntersection } from '../customer-intelligence-intersection/index.js';
import { composeSelectedPopulationScope, collectFilterFieldNames } from '../customer-intelligence-capability/index.js';
import type { CopilotSession, CopilotSessionUiContextState } from './contracts.js';

export type ResolveCopilotUiContextResult =
  | { readonly status: 'absent' }
  | { readonly status: 'resolved'; readonly state: CopilotSessionUiContextState; readonly changed: boolean }
  | { readonly status: 'invalid_ui_context'; readonly errors: readonly string[] }
  | { readonly status: 'degraded'; readonly reason: 'analytics_not_configured' | 'analytics_unavailable' };

// task MARKETING-R1-T06.4 Section 3: the canonical adapter. CopilotUiContext -> validated
// intersection context, entirely by delegating to the T06.3 executeIntersection adapter
// (validate via T03, resolve the feature snapshot anchor, resolve compatible RFM/cluster
// snapshots, reject unavailable required dimensions, compute queryPlanHash) - no second
// validator, no second snapshot resolution algorithm. This function only adds what is specific
// to the Copilot: pinning to the session's own resolved feature snapshot (task Section 19 -
// never a hidden snapshot switch) and projecting the result into the compact, label-bearing
// shape the model is allowed to see (task Section 5).
//
// ponytail: recomputes the intersection (1-2 bounded aggregate queries, never per-metric, never
// row materialization - see execute-intersection.ts) on every turn that carries a uiContext,
// rather than caching by queryPlanHash and trusting a client-supplied matchingPopulation. Task
// Section 21 explicitly allows either; recomputing is simpler and never trusts unverified
// client-supplied counts. Revisit only if this measurably shows up in latency.
export async function resolveCopilotUiContext(
  deps: { readonly executeIntersection: ExecuteIntersection },
  args: { readonly session: CopilotSession; readonly turnId: string; readonly now: Date; readonly uiContext: CopilotUiContextRequest | undefined },
): Promise<ResolveCopilotUiContextResult> {
  const { uiContext } = args;
  if (uiContext === undefined) return { status: 'absent' };

  if (uiContext.intersection.contractVersion !== undefined && uiContext.intersection.contractVersion !== CUSTOMER_INTELLIGENCE_COPILOT_UI_CONTEXT_VERSION) {
    return { status: 'invalid_ui_context', errors: [`uiContext.intersection.contractVersion must be "${CUSTOMER_INTELLIGENCE_COPILOT_UI_CONTEXT_VERSION}" when supplied`] };
  }

  // task Section 19: the session's pinned feature snapshot is always authoritative - a uiContext
  // naming a different one is a mismatch, never a silent switch. The client refreshes/resets the
  // session (existing lifecycle endpoints) to move the pin instead.
  const sessionFeatureSnapshotId = args.session.resolvedIds.featureSnapshotId;
  if (uiContext.intersection.featureSnapshotId !== undefined && uiContext.intersection.featureSnapshotId !== sessionFeatureSnapshotId) {
    return {
      status: 'invalid_ui_context',
      errors: [
        `uiContext.intersection.featureSnapshotId (${uiContext.intersection.featureSnapshotId}) does not match this session's pinned feature snapshot (${sessionFeatureSnapshotId}); refresh or reset the session to change the pinned snapshot`,
      ],
    };
  }

  const result = await deps.executeIntersection({ featureSnapshotId: sessionFeatureSnapshotId, filters: uiContext.intersection.filters });

  switch (result.status) {
    case 'invalid_intersection':
      return { status: 'invalid_ui_context', errors: result.errors };
    case 'required_rfm_snapshot_unavailable':
      return {
        status: 'invalid_ui_context',
        errors: ["uiContext filters reference an RFM segment, but no compatible RFM snapshot is available for this session's pinned feature snapshot"],
      };
    case 'required_cluster_snapshot_unavailable':
      return {
        status: 'invalid_ui_context',
        errors: ["uiContext filters reference a cluster, but no compatible cluster snapshot is available for this session's pinned feature snapshot"],
      };
    case 'no_published_feature_snapshot':
    case 'feature_snapshot_not_found':
      // Unreachable in normal operation - the session was already pinned to a resolved feature
      // snapshot when it was created. Kept as a typed, safe fallback (mirrors
      // execute-intersection.ts's own defensive handling of its structurally-unreachable branch).
      return { status: 'invalid_ui_context', errors: ["this session's pinned feature snapshot is no longer available"] };
    case 'degraded':
      return { status: 'degraded', reason: result.reason };
    case 'available':
      break;
    default: {
      const exhaustive: never = result;
      throw new Error(`Unhandled intersection status: ${JSON.stringify(exhaustive)}`);
    }
  }

  const selectedPopulation: CopilotUiContextSelectedPopulation = {
    filters: collectFilterLeaves(result.definition.filters).map(projectFilterLeaf),
    matchingPopulation: result.population.matchingPopulation,
    queryPlanHash: result.definition.queryPlanHash,
    featureSnapshotId: result.definition.resolvedContext.featureSnapshot.snapshotId,
    rfmSnapshotId: result.definition.resolvedContext.rfmSnapshot?.snapshotId ?? null,
    clusterSnapshotId: result.definition.resolvedContext.clusterSnapshot?.snapshotId ?? null,
    requiredDimensions: result.population.requiredDimensions,
  };

  // task Section 7: change detection is the canonical queryPlanHash, never heuristic text
  // comparison of the raw filters.
  const previousHash = args.session.uiContext?.selectedPopulation.queryPlanHash ?? null;

  return {
    status: 'resolved',
    changed: previousHash !== selectedPopulation.queryPlanHash,
    state: {
      selectedPopulation,
      rawFilters: result.definition.filters,
      resolvedAtTurnId: args.turnId,
      resolvedAt: args.now.toISOString(),
    },
  };
}

function projectFilterLeaf(leaf: AnalyticalFilterCondition): CopilotUiContextSelectedPopulationFilter {
  return {
    field: leaf.field,
    label: resolveFilterFieldLabel(leaf.field),
    operator: leaf.operator,
    value: leaf.value,
    businessValue: resolveFilterFieldBusinessValue(leaf.field, leaf.value),
  };
}

// Full recursive leaf walk (both AND and OR branches) for the flat, compact display list only
// (task Section 5's example is a flat array) - the boolean nesting itself is preserved verbatim
// in rawFilters for execution; this flattening is display-only and never feeds back into a query.
function collectFilterLeaves(filters: AnalyticalFilterInput | null): readonly AnalyticalFilterCondition[] {
  const leaves: AnalyticalFilterCondition[] = [];
  for (const node of toNodeArray(filters)) walkLeaves(node, leaves);
  return leaves;
}

function walkLeaves(node: AnalyticalFilterNode, leaves: AnalyticalFilterCondition[]): void {
  if ('field' in node) {
    leaves.push(node);
    return;
  }
  for (const child of 'and' in node ? node.and : node.or) walkLeaves(child, leaves);
}

// Compatibility exports: scope semantics now live in the provider/brain-neutral capability layer.
export const composeStepFiltersWithUiContext = composeSelectedPopulationScope;
export { collectFilterFieldNames };

function toNodeArray(filters: AnalyticalFilterInput | null): readonly AnalyticalFilterNode[] {
  if (filters === null) return [];
  return Array.isArray(filters) ? (filters as readonly AnalyticalFilterNode[]) : [filters as AnalyticalFilterNode];
}
