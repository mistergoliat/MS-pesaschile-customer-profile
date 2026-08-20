import type { CompiledAnalyticalQuery } from './contracts.js';
import type { NormalizedAnalyticalQueryPlan, NormalizedFilterNode, NormalizedMetric } from './validator.js';

export type AnalyticalQuerySnapshotIds = {
  readonly featureSnapshotId: string;
  readonly rfmSnapshotId: string | null;
  readonly clusterSnapshotId: string | null;
  readonly clusterModelId: string | null;
};

// Pure, deterministic, no I/O (task Section 24) — a distinct stage from execution (task
// Section 4). SQL text lives here as pure data, the same way schema-registry.ts's
// sqlExpression does: this module never opens a connection or calls anything beyond string
// building, so keeping it alongside the rest of the query engine in domain/ (rather than
// splitting it into infrastructure/) keeps the whole pure pipeline
// (registry -> validate -> compile) testable without a DB, exactly as task Section 24 asks
// ("Unit test heavily"). The one thing that DOES touch a Pool lives in
// infrastructure/customer-intelligence-query/mysql-analytical-query-executor.ts.
//
// Reuses the exact FROM/JOIN topology CP-R3-T02's mysql-customer-intelligence-reader.ts
// already established (task Section 32: never a different population/join shape) — feature
// population as the base, RFM/cluster LEFT JOINed, same NO_SNAPSHOT_SENTINEL='0' pattern for
// "no compatible snapshot resolved". The model/interpretation joins are new here because T02's
// reader never needed cluster.modelVersion/label/description as SQL-groupable columns (it
// carries model provenance and merges interpretation in application code instead) — this
// runtime does, since SELECT/GROUP BY need them in SQL. The correlated-subquery join condition
// reproduces
// createMysqlClusterAnalyticsReader().getInterpretations()'s own "latest id wins per
// (model_id, cluster_id)" rule exactly (task Section 48), never a second definition of that
// rule.
const NO_SNAPSHOT_SENTINEL = '0';

const FROM_JOIN = `
  FROM customer_feature_snapshot_row fr
  LEFT JOIN customer_rfm_snapshot_row rr
    ON rr.snapshot_id = ? AND rr.prestashop_customer_id = fr.prestashop_customer_id
  LEFT JOIN customer_cluster_snapshot_row cr
    ON cr.snapshot_id = ? AND cr.prestashop_customer_id = fr.prestashop_customer_id
  LEFT JOIN customer_cluster_model cm
    ON cm.id = ?
  LEFT JOIN customer_cluster_interpretation ci
    ON ci.model_id = cm.id AND ci.cluster_id = cr.cluster_id
    AND ci.id = (
      SELECT MAX(ci2.id) FROM customer_cluster_interpretation ci2
      WHERE ci2.model_id = ci.model_id AND ci2.cluster_id = ci.cluster_id
    )
`;

const AGGREGATION_SQL_FN: Record<'sum' | 'avg' | 'min' | 'max', string> = { sum: 'SUM', avg: 'AVG', min: 'MIN', max: 'MAX' };

type SqlParam = string | number;

// Fetches one extra row beyond the plan's own limit so the caller can compute `truncated`
// without a second COUNT query (same trick CP-R3-T02's listRows already uses).
export function compileAnalyticalQuery(plan: NormalizedAnalyticalQueryPlan, ids: AnalyticalQuerySnapshotIds): CompiledAnalyticalQuery {
  const params: SqlParam[] = [ids.rfmSnapshotId ?? NO_SNAPSHOT_SENTINEL, ids.clusterSnapshotId ?? NO_SNAPSHOT_SENTINEL, ids.clusterModelId ?? NO_SNAPSHOT_SENTINEL];

  const selectSql = plan.mode === 'row' ? compileRowSelect(plan) : compileAggregateSelect(plan);

  let sql = `SELECT ${selectSql} ${FROM_JOIN} WHERE fr.snapshot_id = ?`;
  params.push(ids.featureSnapshotId);

  if (plan.filters) {
    const compiledFilter = compileFilterNode(plan.filters);
    sql += ` AND ${compiledFilter.sql}`;
    params.push(...compiledFilter.params);
  }

  if (plan.mode === 'aggregate' && plan.dimensions.length > 0) {
    sql += ` GROUP BY ${plan.dimensions.map((d) => d.fieldMeta.sqlExpression).join(', ')}`;
  }

  if (plan.orderBy.length > 0) {
    sql += ` ORDER BY ${plan.orderBy.map((o) => `\`${o.alias}\` ${o.direction.toUpperCase()}`).join(', ')}`;
  }

  sql += ' LIMIT ?';
  params.push(plan.limit + 1);

  return { sql, params };
}

function compileRowSelect(plan: NormalizedAnalyticalQueryPlan): string {
  return plan.select.map((s) => `${s.fieldMeta.sqlExpression} AS \`${s.alias}\``).join(', ');
}

function compileAggregateSelect(plan: NormalizedAnalyticalQueryPlan): string {
  const dimensionCols = plan.dimensions.map((d) => `${d.fieldMeta.sqlExpression} AS \`${d.alias}\``);
  const metricCols = plan.metrics.map(compileMetric);
  return [...dimensionCols, ...metricCols].join(', ');
}

function compileMetric(metric: NormalizedMetric): string {
  if (metric.aggregation === 'count') {
    return `COUNT(*) AS \`${metric.alias}\``;
  }
  const expr = metric.fieldMeta!.sqlExpression;
  if (metric.aggregation === 'count_distinct') {
    return `COUNT(DISTINCT ${expr}) AS \`${metric.alias}\``;
  }
  return `${AGGREGATION_SQL_FN[metric.aggregation]}(${expr}) AS \`${metric.alias}\``;
}

function compileFilterNode(node: NormalizedFilterNode): { sql: string; params: SqlParam[] } {
  if (node.kind !== 'condition') {
    if (node.children.length === 0) return { sql: '1=1', params: [] };
    const compiledChildren = node.children.map(compileFilterNode);
    const sql = `(${compiledChildren.map((c) => c.sql).join(node.kind === 'and' ? ' AND ' : ' OR ')})`;
    return { sql, params: compiledChildren.flatMap((c) => c.params) };
  }

  const expr = node.fieldMeta.sqlExpression;
  switch (node.operator) {
    case 'is_null':
      return { sql: `${expr} IS NULL`, params: [] };
    case 'is_not_null':
      return { sql: `${expr} IS NOT NULL`, params: [] };
    case 'eq':
      return { sql: `${expr} = ?`, params: [asSqlParam(node.value)] };
    case 'neq':
      return { sql: `${expr} <> ?`, params: [asSqlParam(node.value)] };
    case 'gt':
      return { sql: `${expr} > ?`, params: [asSqlParam(node.value)] };
    case 'gte':
      return { sql: `${expr} >= ?`, params: [asSqlParam(node.value)] };
    case 'lt':
      return { sql: `${expr} < ?`, params: [asSqlParam(node.value)] };
    case 'lte':
      return { sql: `${expr} <= ?`, params: [asSqlParam(node.value)] };
    case 'between': {
      const [low, high] = node.value as readonly [SqlParam, SqlParam];
      return { sql: `${expr} BETWEEN ? AND ?`, params: [asSqlParam(low), asSqlParam(high)] };
    }
    case 'in':
    case 'not_in': {
      const values = (node.value as readonly SqlParam[]).map(asSqlParam);
      const placeholders = values.map(() => '?').join(', ');
      return { sql: `${expr} ${node.operator === 'in' ? 'IN' : 'NOT IN'} (${placeholders})`, params: values };
    }
    default: {
      const exhaustive: never = node.operator;
      throw new Error(`Unhandled filter operator: ${String(exhaustive)}`);
    }
  }
}

function asSqlParam(value: unknown): SqlParam {
  if (typeof value === 'number' || typeof value === 'string') return value;
  throw new Error(`Invalid filter value reached the compiler: ${String(value)}`);
}
