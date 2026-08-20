import type { CompiledAnalyticalQuery } from '../../domain/customer-intelligence-query/index.js';
import type { AnalyticalQueryExecutor } from '../../application/customer-intelligence-query/ports.js';
import type { QueryExecutor } from '../shared/query-executor.js';
import { mapAnalyticsReadError } from '../customer-analytics/analytics-read-error.js';

// task Section 28 — "SELECT-only by construction": the compiler (domain layer) can only ever
// build a single SELECT statement, so this guard can never actually trip in normal operation.
// It stays as one cheap, explicit assertion anyway (defense in depth, not the primary control)
// rather than trusting that invariant silently — the same posture task Section 64 asks for
// ("no raw DB errors leaked").
const SELECT_ONLY_PATTERN = /^\s*select\b/i;

// task Section 27 — takes a QueryExecutor (infrastructure/shared/query-executor.ts), not a raw
// Pool: that seam already binds ANALYTICS_DB_QUERY_TIMEOUT_MS into every `pool.execute({sql,
// timeout}, params)` call (see analytics-db-pool.ts's getAnalyticsQueryExecutor()) — reused
// as-is rather than a second, hand-rolled timeout mechanism. Errors map through the same
// mapAnalyticsReadError() taxonomy CP-R3-T01/T02 already established (task Section 64) —
// never a fourth, INTELLIGENCE_DB_*-flavored error type.
export function createMysqlAnalyticalQueryExecutor(queryExecutor: QueryExecutor): AnalyticalQueryExecutor {
  return {
    async execute(compiled: CompiledAnalyticalQuery) {
      if (!SELECT_ONLY_PATTERN.test(compiled.sql)) {
        throw new Error('Analytical Query Runtime only ever executes SELECT statements');
      }
      try {
        return await queryExecutor.execute(compiled.sql, compiled.params);
      } catch (error) {
        throw mapAnalyticsReadError(error);
      }
    },
  };
}
