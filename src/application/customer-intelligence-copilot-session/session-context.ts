import {
  CUSTOMER_INTELLIGENCE_COPILOT_SESSION_CONTEXT_VERSION,
  type CopilotAnalyticalReference,
  type CopilotSemanticFocus,
  type CopilotSessionContext,
} from '../../domain/customer-intelligence-copilot/index.js';
import type { AnalyticalQueryPlan, AnalyticalQueryResultRow } from '../../domain/customer-intelligence-query/index.js';
import type { CopilotSession, CopilotSessionLimits, CopilotSessionQueryResult } from './contracts.js';

export function buildCopilotSessionContext(session: CopilotSession, limits: CopilotSessionLimits): CopilotSessionContext {
  return {
    contextVersion: CUSTOMER_INTELLIGENCE_COPILOT_SESSION_CONTEXT_VERSION,
    pinnedContext: session.pinnedContext,
    conversationSummary: session.summary ?? null,
    recentTurns: session.turns.slice(-limits.contextRecentTurns).map((turn) => ({
      turnId: turn.turnId,
      userQuestion: turn.userQuestion,
      assistantStatus: turn.assistantStatus,
      assistantAnswer: turn.assistantAnswer,
    })),
    semanticFocus: deriveSemanticFocus(session),
    analyticalReferences: session.analyticalState.references,
    recentResults: session.analyticalState.results.slice(-3).map((entry) => ({
      queryId: entry.queryId,
      queryPlanHash: entry.result.queryPlanHash,
      columns: entry.result.columns,
      rows: entry.result.rows.slice(0, limits.maxResultRowsRetained),
      rowCount: entry.result.rowCount,
      truncated: entry.result.execution.truncated,
    })),
  };
}

export function deriveAnalyticalReferences(entries: readonly CopilotSessionQueryResult[]): readonly CopilotAnalyticalReference[] {
  const references: CopilotAnalyticalReference[] = [];
  for (const entry of [...entries].reverse()) {
    const first = entry.result.rows[0];
    if (!first) continue;
    const filters = filtersFromRow(first);
    if (filters.length === 0) continue;
    references.push({ name: 'currentAudience', sourceQueryId: entry.queryId, filters });
    break;
  }
  return references;
}

export function deriveSemanticFocus(session: CopilotSession): CopilotSemanticFocus {
  const lastResult = selectPrimaryQueryResult(session.analyticalState.results);
  const activeComparison = lastResult ? comparisonFromResult(lastResult) : null;
  const activeEntity = lastResult ? entityFromRow(lastResult.result.rows[0], activeComparison, lastResult.queryId) : null;
  const activeMetric = lastResult ? metricFromPlan(lastResult.plan, lastResult.queryId) : null;
  const unresolvedClarificationTurn = [...session.turns].reverse().find((turn) => turn.assistantStatus === 'clarification_required');

  return {
    activeEntity,
    activeMetric,
    activeComparison,
    unresolvedClarification: unresolvedClarificationTurn
      ? {
          turnId: unresolvedClarificationTurn.turnId,
          originalQuestion: unresolvedClarificationTurn.userQuestion,
          assistantMessage: unresolvedClarificationTurn.assistantAnswer,
        }
      : null,
    activeFinding: lastResult ? findingFromResult(lastResult) : null,
    lastAnalyticalResult: lastResult
      ? {
          queryId: lastResult.queryId,
          rowCount: lastResult.result.rowCount,
          columns: lastResult.result.columns.map((column) => column.name),
          topRowFacts: factsFromRow(lastResult.result.rows[0]),
        }
      : null,
  };
}

function findingFromResult(entry: CopilotSessionQueryResult): CopilotSemanticFocus['activeFinding'] {
  const row = entry.result.rows[0];
  if (!row) return null;
  const metric = metricFromPlan(entry.plan, entry.queryId);
  const metricAlias = entry.plan.metrics?.[0]?.alias ?? null;
  const value = metricAlias ? row[metricAlias] : null;
  const normalizedValue = isFactValue(value) ? value : null;
  const dimensions = entry.plan.dimensions ?? [];
  if (dimensions.includes('cluster.clusterId')) {
    return {
      sourceQueryId: entry.queryId,
      sourceTurnId: entry.turnId,
      findingType: isTopRankPlan(entry.plan) ? 'top_rank' : 'single_value',
      entityType: 'cluster',
      entityId: typeof row.clusterId === 'string' || typeof row.clusterId === 'number' ? row.clusterId : null,
      metric: metric?.name ?? metric?.field ?? null,
      value: normalizedValue,
    };
  }
  if (dimensions.includes('rfm.segmentCode')) {
    return {
      sourceQueryId: entry.queryId,
      sourceTurnId: entry.turnId,
      findingType: isTopRankPlan(entry.plan) ? 'top_rank' : 'single_value',
      entityType: 'rfm_segment',
      entityId: typeof row.segmentCode === 'string' || typeof row.segmentCode === 'number' ? row.segmentCode : null,
      metric: metric?.name ?? metric?.field ?? null,
      value: normalizedValue,
    };
  }
  if ((entry.plan.metrics?.length ?? 0) === 1 && (entry.plan.dimensions?.length ?? 0) === 0) {
    return {
      sourceQueryId: entry.queryId,
      sourceTurnId: entry.turnId,
      findingType: 'single_value',
      entityType: 'audience',
      entityId: null,
      metric: metric?.name ?? metric?.field ?? null,
      value: normalizedValue,
    };
  }
  return null;
}

function isTopRankPlan(plan: AnalyticalQueryPlan): boolean {
  const metricAlias = plan.metrics?.[0]?.alias;
  return (plan.dimensions?.length ?? 0) > 0 && !!metricAlias && plan.orderBy?.[0]?.field === metricAlias && plan.orderBy[0]?.direction === 'desc';
}

function isSingleValuePlan(plan: AnalyticalQueryPlan): boolean {
  return (plan.metrics?.length ?? 0) === 1 && (plan.dimensions?.length ?? 0) === 0;
}

// Section 4/5 (task MARKETING-R1-T05.8.4): a turn's tool call is probabilistic and may emit an
// auxiliary count/distribution/context query alongside the query that actually answers the
// question. The primary result must be picked structurally - an ordered top-ranking query, then
// a single-value aggregate - never by array position (latest/first), so an auxiliary query can
// never silently replace the real answer.
function selectPrimaryQueryResult(entries: readonly CopilotSessionQueryResult[]): CopilotSessionQueryResult | null {
  const group = latestTurnGroup(entries);
  if (group.length === 0) return null;
  if (group.length === 1) return group[0]!;
  return group.find((entry) => isTopRankPlan(entry.plan)) ?? group.find((entry) => isSingleValuePlan(entry.plan)) ?? group[0]!;
}

function latestTurnGroup(entries: readonly CopilotSessionQueryResult[]): readonly CopilotSessionQueryResult[] {
  if (entries.length === 0) return [];
  const lastTurnId = entries[entries.length - 1]!.turnId;
  const group: CopilotSessionQueryResult[] = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.turnId !== lastTurnId) break;
    group.unshift(entry);
  }
  return group;
}

function comparisonFromResult(entry: CopilotSessionQueryResult): CopilotSemanticFocus['activeComparison'] {
  const dimensions = entry.plan.dimensions ?? [];
  const entityType = dimensions.includes('cluster.clusterId')
    ? 'cluster'
    : dimensions.includes('rfm.segmentCode')
      ? 'rfm_segment'
      : null;
  if (!entityType) return null;

  const entityField = entityType === 'cluster' ? 'clusterId' : 'segmentCode';
  const entityIds = entry.result.rows
    .slice(0, 5)
    .map((row) => row[entityField])
    .filter((value): value is string | number | null => typeof value === 'string' || typeof value === 'number' || value === null);

  return {
    entityType,
    entityIds,
    criterion: metricFromPlan(entry.plan, entry.queryId)?.name ?? null,
    sourceQueryId: entry.queryId,
  };
}

function entityFromRow(
  row: AnalyticalQueryResultRow | undefined,
  comparison: CopilotSemanticFocus['activeComparison'],
  sourceQueryId: string,
): CopilotSemanticFocus['activeEntity'] {
  if (!row) return null;
  if (typeof row.clusterId === 'number') {
    return { type: 'cluster', id: row.clusterId, sourceQueryId };
  }
  if (typeof row.segmentCode === 'string' && row.segmentCode.length > 0) {
    return { type: 'rfm_segment', id: row.segmentCode, sourceQueryId };
  }
  return comparison ? { type: 'comparison_set', id: comparison.entityIds[0] ?? null, sourceQueryId } : null;
}

function metricFromPlan(plan: AnalyticalQueryPlan, sourceQueryId: string): CopilotSemanticFocus['activeMetric'] {
  const metric = plan.metrics?.[0];
  if (!metric) return null;
  return {
    name: semanticMetricName(metric.field ?? null, metric.alias),
    field: metric.field ?? null,
    aggregation: metric.aggregation,
    sourceQueryId,
  };
}

function semanticMetricName(field: string | null, alias: string): string {
  if (field === 'commercial.averageOrderValueTaxIncl') return 'averageOrderValue';
  if (field === 'commercial.totalSpentTaxIncl') return 'totalSpent';
  return alias;
}

type TopRowFacts = NonNullable<CopilotSemanticFocus['lastAnalyticalResult']>['topRowFacts'];

function factsFromRow(row: AnalyticalQueryResultRow | undefined): TopRowFacts {
  if (!row) return [];
  return Object.entries(row)
    .filter((entry): entry is [string, string | number | boolean | null] => isFactValue(entry[1]))
    .slice(0, 8)
    .map(([field, value]) => ({ field, value }));
}

function isFactValue(value: unknown): value is string | number | boolean | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null;
}

function filtersFromRow(row: AnalyticalQueryResultRow): CopilotAnalyticalReference['filters'] {
  const filters: CopilotAnalyticalReference['filters'][number][] = [];
  if (typeof row.clusterId === 'number') {
    filters.push({ field: 'cluster.clusterId', operator: 'eq', value: row.clusterId });
  }
  if (typeof row.segmentCode === 'string' && row.segmentCode.length > 0) {
    filters.push({ field: 'rfm.segmentCode', operator: 'eq', value: row.segmentCode });
  }
  return filters;
}

