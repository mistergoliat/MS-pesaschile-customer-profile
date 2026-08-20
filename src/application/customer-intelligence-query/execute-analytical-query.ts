import {
  compileAnalyticalQuery,
  computeQueryPlanHash,
  CUSTOMER_INTELLIGENCE_QUERY_RESULT_VERSION,
  validateAnalyticalQueryPlan,
  type AnalyticalFieldDataType,
  type AnalyticalQueryResult,
  type AnalyticalResultCell,
  type NormalizedAnalyticalQueryPlan,
} from '../../domain/customer-intelligence-query/index.js';
import type { CustomerIntelligenceSnapshotContext } from '../../domain/customer-intelligence/index.js';
import type { ResolvedCustomerIntelligenceSnapshotIds } from '../customer-intelligence/ports.js';
import type {
  ResolveCurrentCustomerIntelligenceContext,
  ResolveCustomerIntelligenceContextForFeatureSnapshot,
  ResolveCustomerIntelligenceContextResult,
} from '../customer-intelligence/resolve-customer-intelligence-context.js';
import type { AnalyticalQueryExecutor } from './ports.js';

export type ExecuteAnalyticalQueryRequest = {
  readonly plan: unknown;
  readonly featureSnapshotId?: string | null;
};

export type ExecuteAnalyticalQueryResult =
  | { readonly status: 'ok'; readonly result: AnalyticalQueryResult }
  | { readonly status: 'invalid_plan'; readonly errors: readonly string[] }
  | Exclude<ResolveCustomerIntelligenceContextResult, { status: 'available' }>;

export type ExecuteAnalyticalQuery = (request: ExecuteAnalyticalQueryRequest) => Promise<ExecuteAnalyticalQueryResult>;

export type ExecuteAnalyticalQueryWithResolvedContextRequest = {
  readonly plan: unknown;
  readonly context: CustomerIntelligenceSnapshotContext;
  readonly resolvedIds: ResolvedCustomerIntelligenceSnapshotIds;
};

export type ExecuteAnalyticalQueryWithResolvedContext = (
  request: ExecuteAnalyticalQueryWithResolvedContextRequest,
) => Promise<Extract<ExecuteAnalyticalQueryResult, { status: 'ok' | 'invalid_plan' }>>;

export type ExecuteAnalyticalQueryForExportRequest = ExecuteAnalyticalQueryWithResolvedContextRequest & {
  readonly maxRows: number;
};

export type ExecuteAnalyticalQueryForExport = (
  request: ExecuteAnalyticalQueryForExportRequest,
) => Promise<Extract<ExecuteAnalyticalQueryResult, { status: 'ok' | 'invalid_plan' }>>;

export function createExecuteAnalyticalQuery(deps: {
  readonly resolveCurrent: ResolveCurrentCustomerIntelligenceContext;
  readonly resolveForFeatureSnapshot: ResolveCustomerIntelligenceContextForFeatureSnapshot;
  readonly queryExecutor: AnalyticalQueryExecutor;
}): ExecuteAnalyticalQuery {
  return async (request) => {
    const validation = validateAnalyticalQueryPlan(request.plan);
    if (!validation.ok) {
      return { status: 'invalid_plan', errors: validation.errors };
    }

    const contextResult = request.featureSnapshotId
      ? await deps.resolveForFeatureSnapshot(request.featureSnapshotId)
      : await deps.resolveCurrent();

    if (contextResult.status !== 'available') {
      return contextResult;
    }

    return executeValidatedPlan({
      normalizedPlan: validation.plan,
      context: contextResult.context,
      resolvedIds: contextResult.resolvedIds,
      queryExecutor: deps.queryExecutor,
    });
  };
}

export function createExecuteAnalyticalQueryWithResolvedContext(deps: {
  readonly queryExecutor: AnalyticalQueryExecutor;
}): ExecuteAnalyticalQueryWithResolvedContext {
  return async (request) => {
    const validation = validateAnalyticalQueryPlan(request.plan);
    if (!validation.ok) {
      return { status: 'invalid_plan', errors: validation.errors };
    }

    return executeValidatedPlan({
      normalizedPlan: validation.plan,
      context: request.context,
      resolvedIds: request.resolvedIds,
      queryExecutor: deps.queryExecutor,
    });
  };
}

export function createExecuteAnalyticalQueryForExport(deps: {
  readonly queryExecutor: AnalyticalQueryExecutor;
}): ExecuteAnalyticalQueryForExport {
  return async (request) => {
    const validation = validateAnalyticalQueryPlan(request.plan);
    if (!validation.ok) {
      return { status: 'invalid_plan', errors: validation.errors };
    }
    if (!Number.isSafeInteger(request.maxRows) || request.maxRows <= 0) {
      return { status: 'invalid_plan', errors: ['export maxRows must be a positive safe integer'] };
    }

    return executeValidatedPlan({
      normalizedPlan: {
        ...validation.plan,
        limit: request.maxRows,
        canonical: { ...validation.plan.canonical, limit: validation.plan.limit },
      },
      context: request.context,
      resolvedIds: request.resolvedIds,
      queryExecutor: deps.queryExecutor,
      queryPlanHashOverride: computeQueryPlanHash(validation.plan),
    });
  };
}

async function executeValidatedPlan(args: {
  readonly normalizedPlan: NormalizedAnalyticalQueryPlan;
  readonly context: CustomerIntelligenceSnapshotContext;
  readonly resolvedIds: ResolvedCustomerIntelligenceSnapshotIds;
  readonly queryExecutor: AnalyticalQueryExecutor;
  readonly queryPlanHashOverride?: string;
}): Promise<Extract<ExecuteAnalyticalQueryResult, { status: 'ok' }>> {
  const compiled = compileAnalyticalQuery(args.normalizedPlan, {
    featureSnapshotId: args.resolvedIds.featureSnapshotId,
    rfmSnapshotId: args.resolvedIds.rfmSnapshotId,
    clusterSnapshotId: args.resolvedIds.clusterSnapshotId,
    clusterModelId: args.resolvedIds.clusterModelId,
  });

  const startedAt = Date.now();
  const rawRows = await args.queryExecutor.execute(compiled);
  const durationMs = Date.now() - startedAt;

  const truncated = rawRows.length > args.normalizedPlan.limit;
  const pageRows = truncated ? rawRows.slice(0, args.normalizedPlan.limit) : rawRows;

  const columns = columnsFor(args.normalizedPlan);
  const rows = pageRows.map((raw) => mapRow(raw, columns));

  const result: AnalyticalQueryResult = {
    queryVersion: CUSTOMER_INTELLIGENCE_QUERY_RESULT_VERSION,
    queryPlanHash: args.queryPlanHashOverride ?? computeQueryPlanHash(args.normalizedPlan),
    context: args.context,
    columns,
    rows,
    rowCount: rows.length,
    execution: { durationMs, truncated },
  };

  return { status: 'ok', result };
}

function columnsFor(plan: NormalizedAnalyticalQueryPlan): readonly { readonly name: string; readonly type: AnalyticalFieldDataType }[] {
  if (plan.mode === 'row') {
    return plan.select.map((s) => ({ name: s.alias, type: s.fieldMeta.type }));
  }
  return [...plan.dimensions.map((d) => ({ name: d.alias, type: d.fieldMeta.type })), ...plan.metrics.map((m) => ({ name: m.alias, type: m.resultType }))];
}

function mapRow(raw: Record<string, unknown>, columns: readonly { readonly name: string; readonly type: AnalyticalFieldDataType }[]): Readonly<Record<string, AnalyticalResultCell>> {
  const row: Record<string, AnalyticalResultCell> = {};
  for (const column of columns) {
    row[column.name] = coerceCell(raw[column.name], column.type);
  }
  return row;
}

function coerceCell(rawValue: unknown, type: AnalyticalFieldDataType): AnalyticalResultCell {
  if (rawValue === null || rawValue === undefined) return null;
  switch (type) {
    case 'integer': {
      const numeric = typeof rawValue === 'string' ? Number(rawValue) : rawValue;
      if (typeof numeric !== 'number' || !Number.isFinite(numeric)) {
        throw new Error(`Invalid integer cell value: ${String(rawValue)}`);
      }
      return numeric;
    }
    case 'decimal':
    case 'string':
      return String(rawValue);
    case 'datetime':
      return toIso(rawValue);
    default: {
      const exhaustive: never = type;
      throw new Error(`Unhandled field data type: ${String(exhaustive)}`);
    }
  }
}

function toIso(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('Invalid datetime cell value');
    return value.toISOString();
  }
  if (typeof value !== 'string') throw new Error('Invalid datetime cell value');
  const parsed = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid datetime cell value');
  return parsed.toISOString();
}
