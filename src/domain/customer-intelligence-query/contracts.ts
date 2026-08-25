import type { CustomerIntelligenceSnapshotContext } from '../customer-intelligence/index.js';

export const CUSTOMER_INTELLIGENCE_QUERY_PLAN_VERSION = 'customer-intelligence-query-plan-v1';
export const CUSTOMER_INTELLIGENCE_QUERY_RESULT_VERSION = 'customer-intelligence-query-v1';
export const CUSTOMER_INTELLIGENCE_QUERY_SCHEMA_VERSION = 'customer-intelligence-query-schema-v1';

export const ANALYTICAL_FILTER_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'in',
  'not_in',
  'is_null',
  'is_not_null',
] as const;
export type AnalyticalFilterOperator = (typeof ANALYTICAL_FILTER_OPERATORS)[number];

export const ANALYTICAL_AGGREGATIONS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const;
export type AnalyticalAggregation = (typeof ANALYTICAL_AGGREGATIONS)[number];

export const ANALYTICAL_METRIC_ALIAS_PATTERN = '^[A-Za-z_][A-Za-z0-9_]*$';

export const ANALYTICAL_FIELD_DATA_TYPES = ['integer', 'decimal', 'string', 'datetime'] as const;
export type AnalyticalFieldDataType = (typeof ANALYTICAL_FIELD_DATA_TYPES)[number];

export const ANALYTICAL_FIELD_SOURCES = ['customer', 'commercial', 'rfm', 'cluster'] as const;
export type AnalyticalFieldSource = (typeof ANALYTICAL_FIELD_SOURCES)[number];

// Raw JSON-shaped scalar/array values as they arrive from a query plan file or a future LLM —
// never trusted as typed until the validator checks it against the field's registered type and
// the operator's arity (task Section 25).
export type AnalyticalFilterValue = string | number | boolean | null | readonly (string | number)[];

export type AnalyticalFilterCondition = {
  readonly field: string;
  readonly operator: AnalyticalFilterOperator;
  readonly value?: AnalyticalFilterValue;
};

export type AnalyticalFilterGroup =
  | { readonly and: readonly AnalyticalFilterNode[] }
  | { readonly or: readonly AnalyticalFilterNode[] };

export type AnalyticalFilterNode = AnalyticalFilterCondition | AnalyticalFilterGroup;

// Plan-level sugar (task Section 11 examples): a bare array at the top level is an implicit
// AND of its elements. A single object is either a leaf condition or an {and:}/{or:} group.
export type AnalyticalFilterInput = readonly AnalyticalFilterNode[] | AnalyticalFilterNode;

export type AnalyticalMetricSpec = {
  readonly aggregation: AnalyticalAggregation;
  // Absent only for 'count' (task Section 41 — COUNT(*) needs no field).
  readonly field?: string;
  readonly alias: string;
};

export type AnalyticalOrderBySpec = {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
};

// The bounded, structured contract a future LLM (or this task's own CLI/tests) produces —
// never raw SQL (task Section 3/19). Row mode (`select`, no `metrics`) and aggregate mode
// (`metrics`, no `select`) are mutually exclusive (task Section 40).
export type AnalyticalQueryPlan = {
  readonly planVersion?: string;
  readonly select?: readonly string[];
  readonly filters?: AnalyticalFilterInput;
  readonly dimensions?: readonly string[];
  readonly metrics?: readonly AnalyticalMetricSpec[];
  readonly orderBy?: readonly AnalyticalOrderBySpec[];
  readonly limit?: number;
};

export type AnalyticalQueryResultColumn = {
  readonly name: string;
  readonly type: AnalyticalFieldDataType;
};

export type AnalyticalResultCell = string | number | boolean | null;
export type AnalyticalQueryResultRow = Readonly<Record<string, AnalyticalResultCell>>;

// task Section 21: no SQL string on this contract — compiledSql/boundParameters are an
// internal trace (task Section 22), never part of the consumer-facing result.
export type AnalyticalQueryResult = {
  readonly queryVersion: typeof CUSTOMER_INTELLIGENCE_QUERY_RESULT_VERSION;
  readonly queryPlanHash: string;
  readonly context: CustomerIntelligenceSnapshotContext;
  readonly columns: readonly AnalyticalQueryResultColumn[];
  readonly rows: readonly AnalyticalQueryResultRow[];
  readonly rowCount: number;
  readonly execution: {
    readonly durationMs: number;
    readonly truncated: boolean;
  };
};

export type AnalyticalSchemaField = {
  readonly logicalName: string;
  readonly type: AnalyticalFieldDataType;
  readonly nullable: boolean;
  readonly source: AnalyticalFieldSource;
  readonly allowedOperators: readonly AnalyticalFilterOperator[];
  readonly allowedAggregations: readonly AnalyticalAggregation[];
  readonly description: string;
};

// task Section 34 — the machine-readable dictionary a future LLM consumes. Never a physical
// column/table name (task Section 8): see schema-registry.ts's own separation between this
// public shape and the compiler-only sqlExpression.
export type AnalyticalSchema = {
  readonly schemaVersion: typeof CUSTOMER_INTELLIGENCE_QUERY_SCHEMA_VERSION;
  readonly readModelVersion: string;
  readonly fields: readonly AnalyticalSchemaField[];
};

export type CompiledAnalyticalQuery = {
  readonly sql: string;
  readonly params: readonly (string | number)[];
};
