import {
  CUSTOMER_INTELLIGENCE_COPILOT_SESSION_CONTEXT_VERSION,
  type CopilotAnalyticalReference,
  type CopilotSessionContext,
} from '../../domain/customer-intelligence-copilot/index.js';
import type { AnalyticalQueryResultRow } from '../../domain/customer-intelligence-query/index.js';
import type { CopilotSession, CopilotSessionLimits, CopilotSessionQueryResult } from './contracts.js';

export function buildCopilotSessionContext(session: CopilotSession, limits: CopilotSessionLimits): CopilotSessionContext {
  return {
    contextVersion: CUSTOMER_INTELLIGENCE_COPILOT_SESSION_CONTEXT_VERSION,
    pinnedContext: session.pinnedContext,
    recentTurns: session.turns.slice(-limits.contextRecentTurns).map((turn) => ({
      turnId: turn.turnId,
      userQuestion: turn.userQuestion,
      assistantStatus: turn.assistantStatus,
      assistantAnswer: turn.assistantAnswer,
    })),
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
  for (const entry of entries) {
    const first = entry.result.rows[0];
    if (!first) continue;
    const filters = filtersFromRow(first);
    if (filters.length === 0) continue;
    references.push({ name: 'currentAudience', sourceQueryId: entry.queryId, filters });
    break;
  }
  return references;
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

