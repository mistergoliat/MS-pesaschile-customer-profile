import type { CompiledAnalyticalQuery } from '../../domain/customer-intelligence-query/index.js';

// Deliberately generic (task Section 33/40-42): "run this parameterized SELECT, return rows"
// — no knowledge of feature/RFM/cluster tables here at all. Today's implementation
// (infrastructure/customer-intelligence-query/mysql-analytical-query-executor.ts) is one SQL
// statement against the physically-shared ANALYTICS_DB_* schema; a future deployment with
// genuinely separate databases would need a different implementation of this same port, not a
// domain/application-layer change.
export type AnalyticalQueryExecutor = {
  execute(compiled: CompiledAnalyticalQuery): Promise<readonly Record<string, unknown>[]>;
};
