export * from './contracts.js';
export { getRegisteredFields, lookupField, allowedOperatorsFor, allowedAggregationsFor } from './schema-registry.js';
export {
  validateAnalyticalQueryPlan,
  MAX_FILTER_LEAVES,
  MAX_FILTER_DEPTH,
  MAX_DIMENSIONS,
  MAX_METRICS,
  MAX_IN_VALUES,
  DEFAULT_LIMIT,
  MAX_RESULT_ROWS,
  type AnalyticalQueryValidationResult,
  type NormalizedAnalyticalQueryPlan,
} from './validator.js';
export { compileAnalyticalQuery, type AnalyticalQuerySnapshotIds } from './compiler.js';
export { computeQueryPlanHash } from './plan-hash.js';
export { assertNoPiiInAnalyticalValue } from './pii-guard.js';
export {
  expandCompactAnalyticalQuery,
  isCompactAnalyticalQueryShape,
  compactFieldNameForLogicalName,
  logicalNameForCompactField,
  getCompactFieldAliases,
  type CompactAnalyticalQueryExpansionResult,
} from './compact-query-adapter.js';
