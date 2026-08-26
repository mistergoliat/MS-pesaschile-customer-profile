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
  const finding = lastResult ? findingFromResult(lastResult) : null;
  const activeComparison = lastResult ? comparisonFromResult(lastResult) : null;
  // A distribution finding has no single active entity by definition (task
  // MARKETING-R1-T05.8.5 Section 3) - the conversation stays neutral across every group until a
  // follow-up (e.g. a top-1 ranking) resolves one.
  const activeEntity = lastResult && finding?.findingType !== 'distribution' ? entityFromRow(lastResult.result.rows[0], activeComparison, lastResult.queryId) : null;
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
    activeFinding: finding,
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

// Classifies a grouped/aggregate result into the deterministic finding it structurally
// represents (task MARKETING-R1-T05.8.5 Section 1/2). Never phrase-matches the user's question:
// a grouped-by-entity query that returned more than one row is a `distribution` across every
// group - even when the rows happen to arrive ordered or the first row is the largest - because
// `LIMIT`-driven execution (execute-analytical-query.ts) can only ever return more than one row
// when the plan did not actually reduce the result to a single winner. Exactly one row means the
// query (via an explicit LIMIT, a narrowing filter, or a single group in the data) identified one
// specific entity, so it is safe to treat as `top_rank` (when ordered by the metric) or
// `single_value` (otherwise).
function findingFromResult(entry: CopilotSessionQueryResult): CopilotSemanticFocus['activeFinding'] {
  const rows = entry.result.rows;
  if (rows.length === 0) return null;
  const metric = metricFromPlan(entry.plan, entry.queryId);
  const metricAlias = entry.plan.metrics?.[0]?.alias ?? null;
  const dimensions = entry.plan.dimensions ?? [];
  const entityType = dimensions.includes('cluster.clusterId') ? 'cluster' : dimensions.includes('rfm.segmentCode') ? 'rfm_segment' : null;

  if (entityType) {
    if (rows.length > 1) {
      return {
        sourceQueryId: entry.queryId,
        sourceTurnId: entry.turnId,
        findingType: 'distribution',
        entityType,
        entityId: null,
        metric: metric?.name ?? metric?.field ?? null,
        value: null,
      };
    }
    const row = rows[0]!;
    const entityIdRaw = entityType === 'cluster' ? row.clusterId : row.segmentCode;
    const value = metricAlias ? row[metricAlias] : null;
    return {
      sourceQueryId: entry.queryId,
      sourceTurnId: entry.turnId,
      findingType: isTopRankPlan(entry.plan) ? 'top_rank' : 'single_value',
      entityType,
      entityId: typeof entityIdRaw === 'string' || typeof entityIdRaw === 'number' ? entityIdRaw : null,
      metric: metric?.name ?? metric?.field ?? null,
      value: isFactValue(value) ? value : null,
    };
  }

  if ((entry.plan.metrics?.length ?? 0) === 1 && (entry.plan.dimensions?.length ?? 0) === 0) {
    const row = rows[0]!;
    const value = metricAlias ? row[metricAlias] : null;
    return {
      sourceQueryId: entry.queryId,
      sourceTurnId: entry.turnId,
      findingType: 'single_value',
      entityType: 'audience',
      entityId: null,
      metric: metric?.name ?? metric?.field ?? null,
      value: isFactValue(value) ? value : null,
    };
  }
  return null;
}

function isTopRankPlan(plan: AnalyticalQueryPlan): boolean {
  const metricAlias = plan.metrics?.[0]?.alias;
  return (plan.dimensions?.length ?? 0) > 0 && !!metricAlias && plan.orderBy?.[0]?.field === metricAlias && plan.orderBy[0]?.direction === 'desc';
}

// Section 4/5 (task MARKETING-R1-T05.8.4) and Section 7 (task MARKETING-R1-T05.8.5): a turn's
// tool call is probabilistic and may emit an auxiliary query alongside the query that actually
// answers the question. The primary result is picked by classifying every candidate with the
// same `findingFromResult` used for the persisted finding - never by array position - so the
// priority list and the finding itself can never disagree. A grouped distribution (the complete
// breakdown the user asked for) outranks an auxiliary single-value query (e.g. an unclustered
// count) because it carries the richer, more complete answer; declaration order is the last
// resort only when nothing structurally distinguishes the candidates.
function selectPrimaryQueryResult(entries: readonly CopilotSessionQueryResult[]): CopilotSessionQueryResult | null {
  const group = latestTurnGroup(entries);
  if (group.length === 0) return null;
  if (group.length === 1) return group[0]!;
  const byFindingType = (type: 'top_rank' | 'distribution' | 'single_value') => group.find((entry) => findingFromResult(entry)?.findingType === type);
  return byFindingType('top_rank') ?? byFindingType('distribution') ?? byFindingType('single_value') ?? group[0]!;
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

