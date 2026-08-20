import {
  ANALYTICAL_FILTER_OPERATORS,
  CUSTOMER_INTELLIGENCE_QUERY_PLAN_VERSION,
  type AnalyticalAggregation,
  type AnalyticalFieldDataType,
  type AnalyticalFilterCondition,
  type AnalyticalFilterOperator,
  type AnalyticalFilterValue,
  type AnalyticalOrderBySpec,
  type AnalyticalQueryPlan,
} from './contracts.js';
import { allowedAggregationsFor, allowedOperatorsFor, lookupField, type RegisteredField } from './schema-registry.js';

// task Section 26 — bounded V1 guardrails for a future LLM-generated plan. Exact values the
// task itself proposed; enforced as hard rejections (never a silent clamp — a validator that
// silently rewrites an "unsafe" plan into a smaller one is quietly lying about what ran).
export const MAX_FILTER_LEAVES = 20;
export const MAX_FILTER_DEPTH = 5;
export const MAX_DIMENSIONS = 5;
export const MAX_METRICS = 10;
export const MAX_IN_VALUES = 500;
export const DEFAULT_LIMIT = 100;
export const MAX_RESULT_ROWS = 1000;

// Every alias this validator accepts is later embedded as a backtick-quoted SQL identifier by
// the compiler (AS/GROUP BY/ORDER BY) — identifiers can never be bound `?` parameters, so this
// pattern is the actual injection defense for aliases (task Section 23/57), not cosmetic.
const SAFE_ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type NormalizedFilterCondition = {
  readonly kind: 'condition';
  readonly fieldMeta: RegisteredField;
  readonly operator: AnalyticalFilterOperator;
  readonly value: AnalyticalFilterValue | undefined;
};
export type NormalizedFilterGroup = {
  readonly kind: 'and' | 'or';
  readonly children: readonly NormalizedFilterNode[];
};
export type NormalizedFilterNode = NormalizedFilterCondition | NormalizedFilterGroup;

export type NormalizedSelectField = { readonly logicalName: string; readonly fieldMeta: RegisteredField; readonly alias: string };
export type NormalizedDimension = { readonly logicalName: string; readonly fieldMeta: RegisteredField; readonly alias: string };
export type NormalizedMetric = {
  readonly aggregation: AnalyticalAggregation;
  readonly fieldMeta: RegisteredField | null;
  readonly alias: string;
  readonly resultType: AnalyticalFieldDataType;
};
export type NormalizedOrderBy = { readonly alias: string; readonly direction: 'asc' | 'desc' };

export type NormalizedAnalyticalQueryPlan = {
  readonly mode: 'row' | 'aggregate';
  readonly select: readonly NormalizedSelectField[];
  readonly dimensions: readonly NormalizedDimension[];
  readonly metrics: readonly NormalizedMetric[];
  readonly filters: NormalizedFilterNode | null;
  readonly orderBy: readonly NormalizedOrderBy[];
  readonly limit: number;
  // Defaults-filled, physical-identifier-free re-serialization — what computeQueryPlanHash
  // hashes (task Section 69), and what a caller could log/replay without ever seeing SQL.
  readonly canonical: AnalyticalQueryPlan;
};

export type AnalyticalQueryValidationResult =
  | { readonly ok: true; readonly plan: NormalizedAnalyticalQueryPlan }
  | { readonly ok: false; readonly errors: readonly string[] };

// task Section 25: reject before DB execution. Treats the input as fully untrusted `unknown`
// (a future LLM's JSON, or the CLI's --file=), never assumes the AnalyticalQueryPlan TS type
// already holds at runtime.
export function validateAnalyticalQueryPlan(rawPlan: unknown): AnalyticalQueryValidationResult {
  const errors: string[] = [];
  const usedAliases = new Set<string>();

  if (rawPlan === null || typeof rawPlan !== 'object' || Array.isArray(rawPlan)) {
    return { ok: false, errors: ['plan must be a JSON object'] };
  }
  const raw = rawPlan as Record<string, unknown>;

  if (raw.planVersion !== undefined) {
    if (typeof raw.planVersion !== 'string' || raw.planVersion !== CUSTOMER_INTELLIGENCE_QUERY_PLAN_VERSION) {
      errors.push(`unsupported planVersion: ${String(raw.planVersion)} (expected ${CUSTOMER_INTELLIGENCE_QUERY_PLAN_VERSION})`);
    }
  }

  const rawSelect = readOptionalStringArray(raw.select, 'select', errors);
  const rawDimensions = readOptionalStringArray(raw.dimensions, 'dimensions', errors);
  const rawMetrics = Array.isArray(raw.metrics) ? raw.metrics : raw.metrics === undefined ? [] : null;
  if (rawMetrics === null) errors.push('metrics must be an array');
  const rawOrderBy = Array.isArray(raw.orderBy) ? raw.orderBy : raw.orderBy === undefined ? [] : null;
  if (rawOrderBy === null) errors.push('orderBy must be an array');

  const hasSelect = (rawSelect?.length ?? 0) > 0;
  const hasDimensions = (rawDimensions?.length ?? 0) > 0;
  const hasMetrics = (rawMetrics?.length ?? 0) > 0;

  if (hasSelect && hasMetrics) {
    errors.push('a plan cannot mix row-mode "select" with aggregate-mode "metrics" (task Section 40)');
  }
  if (hasDimensions && !hasMetrics) {
    errors.push('"dimensions" requires at least one metric — grouping without aggregation is ambiguous (task Section 40)');
  }

  const mode: 'row' | 'aggregate' | null = hasMetrics ? 'aggregate' : hasSelect ? 'row' : null;
  if (mode === null) {
    errors.push('plan must specify either "select" (row mode) or "metrics" (aggregate mode)');
  }

  // Resolve dimensions/metrics/select even when errors already exist, so a caller sees every
  // problem in one pass rather than one-error-at-a-time.
  const dimensions: NormalizedDimension[] = [];
  if (mode !== 'row' && rawDimensions) {
    if (rawDimensions.length > MAX_DIMENSIONS) {
      errors.push(`too many dimensions: ${rawDimensions.length} (max ${MAX_DIMENSIONS})`);
    }
    for (const logicalName of rawDimensions) {
      const fieldMeta = lookupField(logicalName);
      if (!fieldMeta) {
        errors.push(`unknown field: ${logicalName}`);
        continue;
      }
      const alias = aliasFor(logicalName);
      if (usedAliases.has(alias)) errors.push(`duplicate alias: ${alias}`);
      usedAliases.add(alias);
      dimensions.push({ logicalName, fieldMeta, alias });
    }
  }

  const metrics: NormalizedMetric[] = [];
  if (rawMetrics && mode !== 'row') {
    if (rawMetrics.length > MAX_METRICS) {
      errors.push(`too many metrics: ${rawMetrics.length} (max ${MAX_METRICS})`);
    }
    for (const rawMetric of rawMetrics) {
      const resolved = resolveMetric(rawMetric, errors, usedAliases);
      if (resolved) metrics.push(resolved);
    }
  }

  const select: NormalizedSelectField[] = [];
  if (mode === 'row' && rawSelect) {
    for (const logicalName of rawSelect) {
      const fieldMeta = lookupField(logicalName);
      if (!fieldMeta) {
        errors.push(`unknown field: ${logicalName}`);
        continue;
      }
      const alias = aliasFor(logicalName);
      if (usedAliases.has(alias)) errors.push(`duplicate alias: ${alias}`);
      usedAliases.add(alias);
      select.push({ logicalName, fieldMeta, alias });
    }
  }

  const orderBy: NormalizedOrderBy[] = [];
  if (rawOrderBy) {
    for (const rawSpec of rawOrderBy) {
      const resolved = resolveOrderBy(rawSpec, errors, usedAliases);
      if (resolved) orderBy.push(resolved);
    }
  }

  let limit = DEFAULT_LIMIT;
  if (raw.limit !== undefined) {
    if (typeof raw.limit !== 'number' || !Number.isInteger(raw.limit) || raw.limit <= 0) {
      errors.push('limit must be a positive integer');
    } else if (raw.limit > MAX_RESULT_ROWS) {
      errors.push(`limit exceeds max of ${MAX_RESULT_ROWS} (task Section 26/43)`);
    } else {
      limit = raw.limit;
    }
  }

  let filters: NormalizedFilterNode | null = null;
  if (raw.filters !== undefined) {
    const leafCounter = { count: 0 };
    filters = normalizeFilterInput(raw.filters, errors, 0, leafCounter);
    if (leafCounter.count > MAX_FILTER_LEAVES) {
      errors.push(`too many filter conditions: ${leafCounter.count} (max ${MAX_FILTER_LEAVES})`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const canonical: AnalyticalQueryPlan = {
    planVersion: CUSTOMER_INTELLIGENCE_QUERY_PLAN_VERSION,
    ...(select.length > 0 ? { select: select.map((s) => s.logicalName) } : {}),
    ...(dimensions.length > 0 ? { dimensions: dimensions.map((d) => d.logicalName) } : {}),
    ...(metrics.length > 0
      ? { metrics: metrics.map((m) => ({ aggregation: m.aggregation, ...(m.fieldMeta ? { field: m.fieldMeta.logicalName } : {}), alias: m.alias })) }
      : {}),
    ...(raw.filters !== undefined ? { filters: raw.filters as AnalyticalQueryPlan['filters'] } : {}),
    ...(orderBy.length > 0 ? { orderBy: orderBy.map((o) => ({ field: o.alias, direction: o.direction })) } : {}),
    limit,
  };

  return {
    ok: true,
    plan: { mode: mode!, select, dimensions, metrics, filters, orderBy, limit, canonical },
  };
}

function readOptionalStringArray(value: unknown, name: string, errors: string[]): readonly string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    errors.push(`${name} must be an array of strings`);
    return null;
  }
  return value;
}

function aliasFor(logicalName: string): string {
  const lastDot = logicalName.lastIndexOf('.');
  return lastDot === -1 ? logicalName : logicalName.slice(lastDot + 1);
}

function resolveMetric(rawMetric: unknown, errors: string[], usedAliases: Set<string>): NormalizedMetric | null {
  if (rawMetric === null || typeof rawMetric !== 'object' || Array.isArray(rawMetric)) {
    errors.push('each metric must be an object with { aggregation, alias, field? }');
    return null;
  }
  const m = rawMetric as Record<string, unknown>;
  const aggregation = m.aggregation;
  if (typeof aggregation !== 'string' || !isAnalyticalAggregation(aggregation)) {
    errors.push(`unsupported aggregation: ${String(aggregation)}`);
    return null;
  }
  if (typeof m.alias !== 'string' || !SAFE_ALIAS_PATTERN.test(m.alias)) {
    // task Section 23/57: an alias is embedded as a backtick-quoted SQL identifier
    // (`` `${alias}` `` in AS/GROUP BY/ORDER BY), never as a bound `?` parameter — SQL has no
    // way to parameterize an identifier. A user-supplied alias must therefore be restricted to
    // a safe character set at the validator, or a value like "x` ; DROP TABLE --" could break
    // out of the identifier quoting once compiled.
    errors.push('each metric requires a string alias matching ^[A-Za-z_][A-Za-z0-9_]*$');
    return null;
  }
  if (usedAliases.has(m.alias)) {
    errors.push(`duplicate alias: ${m.alias}`);
    return null;
  }

  if (aggregation === 'count') {
    if (m.field !== undefined) {
      errors.push('aggregation "count" does not take a field — use "count_distinct" for a per-field count');
      return null;
    }
    usedAliases.add(m.alias);
    return { aggregation, fieldMeta: null, alias: m.alias, resultType: 'integer' };
  }

  if (typeof m.field !== 'string') {
    errors.push(`aggregation "${aggregation}" requires a string field`);
    return null;
  }
  const fieldMeta = lookupField(m.field);
  if (!fieldMeta) {
    errors.push(`unknown field: ${m.field}`);
    return null;
  }
  if (!allowedAggregationsFor(fieldMeta).includes(aggregation)) {
    errors.push(`aggregation "${aggregation}" is not supported on field ${m.field} (type ${fieldMeta.type})`);
    return null;
  }
  usedAliases.add(m.alias);
  return { aggregation, fieldMeta, alias: m.alias, resultType: resultTypeFor(aggregation, fieldMeta.type) };
}

function resultTypeFor(aggregation: AnalyticalAggregation, sourceType: AnalyticalFieldDataType): AnalyticalFieldDataType {
  if (aggregation === 'count' || aggregation === 'count_distinct') return 'integer';
  if (aggregation === 'min' || aggregation === 'max') return sourceType;
  // sum/avg: only reachable on integer/decimal fields (enforced above) — both are returned as
  // decimal (task Section 70: SUM/AVG of DECIMAL/INT columns come back as exact decimal
  // strings under this codebase's bigNumberStrings convention; never a lossy JS float).
  return 'decimal';
}

function resolveOrderBy(rawSpec: unknown, errors: string[], usedAliases: Set<string>): NormalizedOrderBy | null {
  if (rawSpec === null || typeof rawSpec !== 'object' || Array.isArray(rawSpec)) {
    errors.push('each orderBy entry must be an object with { field, direction }');
    return null;
  }
  const spec = rawSpec as AnalyticalOrderBySpec;
  if (typeof spec.field !== 'string') {
    errors.push('orderBy.field must be a string');
    return null;
  }
  if (spec.direction !== 'asc' && spec.direction !== 'desc') {
    errors.push(`orderBy.direction must be "asc" or "desc": ${String(spec.direction)}`);
    return null;
  }
  if (!usedAliases.has(spec.field)) {
    errors.push(`invalid orderBy field: ${spec.field} (must reference a selected field, dimension, or metric alias)`);
    return null;
  }
  return { alias: spec.field, direction: spec.direction };
}

function isAnalyticalAggregation(value: string): value is AnalyticalAggregation {
  return (['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const).includes(value as AnalyticalAggregation);
}

function normalizeFilterInput(
  raw: unknown,
  errors: string[],
  depth: number,
  leafCounter: { count: number },
): NormalizedFilterNode | null {
  if (Array.isArray(raw)) {
    // Top-level (or nested) bare array = implicit AND of its elements (task Section 11/15).
    const children = raw.map((child) => normalizeFilterInput(child, errors, depth + 1, leafCounter)).filter((c): c is NormalizedFilterNode => c !== null);
    return { kind: 'and', children };
  }
  if (raw === null || typeof raw !== 'object') {
    errors.push('invalid filter node: expected a condition object, an {and:}/{or:} group, or an array');
    return null;
  }
  if (depth > MAX_FILTER_DEPTH) {
    errors.push(`filter nesting too deep (max depth ${MAX_FILTER_DEPTH})`);
    return null;
  }

  const node = raw as Record<string, unknown>;
  if ('and' in node || 'or' in node) {
    const kind: 'and' | 'or' = 'and' in node ? 'and' : 'or';
    const children = node[kind];
    if (!Array.isArray(children) || children.length === 0) {
      errors.push(`"${kind}" must be a non-empty array of filter nodes`);
      return null;
    }
    const normalizedChildren = children
      .map((child) => normalizeFilterInput(child, errors, depth + 1, leafCounter))
      .filter((c): c is NormalizedFilterNode => c !== null);
    return { kind, children: normalizedChildren };
  }

  // Leaf condition.
  leafCounter.count += 1;
  const condition = node as unknown as AnalyticalFilterCondition;
  if (typeof condition.field !== 'string') {
    errors.push('filter condition requires a string "field"');
    return null;
  }
  const fieldMeta = lookupField(condition.field);
  if (!fieldMeta) {
    // task Section 57: an unknown/malicious field name can never reach SQL — it fails here,
    // before any identifier is ever built.
    errors.push(`unknown field: ${condition.field}`);
    return null;
  }
  if (typeof condition.operator !== 'string' || !ANALYTICAL_FILTER_OPERATORS.includes(condition.operator as AnalyticalFilterOperator)) {
    errors.push(`unsupported operator: ${String(condition.operator)}`);
    return null;
  }
  const operator = condition.operator;
  if (!allowedOperatorsFor(fieldMeta).includes(operator)) {
    errors.push(`operator "${operator}" is not supported on field ${condition.field} (type ${fieldMeta.type})`);
    return null;
  }

  const valueError = validateFilterValue(fieldMeta, operator, condition.value);
  if (valueError) {
    errors.push(`${condition.field} ${operator}: ${valueError}`);
    return null;
  }

  return { kind: 'condition', fieldMeta, operator, value: condition.value };
}

function validateFilterValue(fieldMeta: RegisteredField, operator: AnalyticalFilterOperator, value: AnalyticalFilterValue | undefined): string | null {
  if (operator === 'is_null' || operator === 'is_not_null') {
    return value !== undefined ? 'must not include a value' : null;
  }
  if (operator === 'between') {
    if (!Array.isArray(value) || value.length !== 2) return 'requires an array of exactly 2 values';
    return value.every((v) => isValidScalar(fieldMeta.type, v)) ? null : `both values must be a valid ${fieldMeta.type}`;
  }
  if (operator === 'in' || operator === 'not_in') {
    if (!Array.isArray(value) || value.length === 0) return 'requires a non-empty array of values';
    if (value.length > MAX_IN_VALUES) return `array exceeds max of ${MAX_IN_VALUES} values (task Section 26)`;
    return value.every((v) => isValidScalar(fieldMeta.type, v)) ? null : `every value must be a valid ${fieldMeta.type}`;
  }
  // eq/neq/gt/gte/lt/lte: a single, non-null scalar (use is_null/is_not_null for null checks).
  if (Array.isArray(value) || value === null || value === undefined) {
    return `requires a single ${fieldMeta.type} value (use is_null/is_not_null for null checks)`;
  }
  return isValidScalar(fieldMeta.type, value) ? null : `must be a valid ${fieldMeta.type}`;
}

function isValidScalar(type: AnalyticalFieldDataType, value: unknown): boolean {
  if (type === 'integer' || type === 'decimal') {
    if (typeof value === 'number') return Number.isFinite(value);
    // Decimal values may also arrive as exact numeric strings (task Section 70 — preserves
    // precision a JS float could lose); integers accept a numeric string too, for symmetry
    // with how every commercial field is round-tripped as a string in the read model.
    if (typeof value === 'string') return /^-?\d+(\.\d+)?$/.test(value);
    return false;
  }
  if (type === 'string') {
    return typeof value === 'string';
  }
  // datetime (task Section 71): explicit ISO 8601 only, never a natural-language expression.
  if (type === 'datetime') {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value));
  }
  return false;
}
