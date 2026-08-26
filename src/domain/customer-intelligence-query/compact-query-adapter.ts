import {
  ANALYTICAL_FILTER_OPERATORS,
  CUSTOMER_INTELLIGENCE_COMPACT_QUERY_VERSION,
  CUSTOMER_INTELLIGENCE_QUERY_PLAN_VERSION,
  type AnalyticalFilterOperator,
  type AnalyticalFilterInput,
  type AnalyticalFilterNode,
  type AnalyticalQueryPlan,
} from './contracts.js';
import { getRegisteredFields, lookupField } from './schema-registry.js';
import { validateAnalyticalQueryPlan } from './validator.js';

const COMPACT_FIELD_ALIASES: Readonly<Record<string, string>> = {
  customerId: 'customer.customerId',
  validOrders: 'commercial.validOrders',
  validOrderCount: 'commercial.validOrders',
  totalSpent: 'commercial.totalSpentTaxIncl',
  totalSpentTaxIncl: 'commercial.totalSpentTaxIncl',
  averageOrderValue: 'commercial.averageOrderValueTaxIncl',
  averageOrderValueTaxIncl: 'commercial.averageOrderValueTaxIncl',
  firstOrderAt: 'commercial.firstOrderAt',
  lastOrderAt: 'commercial.lastOrderAt',
  daysSinceLastOrder: 'commercial.daysSinceLastOrder',
  customerTenureDays: 'commercial.customerTenureDays',
  distinctProducts: 'commercial.distinctProducts',
  repeatProductRate: 'commercial.repeatProductRate',
  top1Share: 'commercial.top1Share',
  top3Share: 'commercial.top3Share',
  effectiveDiversity: 'commercial.effectiveDiversity',
  averageUnitsPerOrder: 'commercial.averageUnitsPerOrder',
  purchaseFrequencyDays: 'commercial.purchaseFrequencyDays',
  orders365d: 'commercial.orders365d',
  cancelledOrderRatio: 'commercial.cancelledOrderRatio',
  discountShare: 'commercial.discountShare',
  shippingShare: 'commercial.shippingShare',
  rScore: 'rfm.rScore',
  fScore: 'rfm.fScore',
  mScore: 'rfm.mScore',
  rfmCode: 'rfm.rfmCode',
  segmentCode: 'rfm.segmentCode',
  rfmSegment: 'rfm.segmentCode',
  clusterId: 'cluster.clusterId',
  distanceToCentroid: 'cluster.distanceToCentroid',
  clusterLabel: 'cluster.label',
  clusterDescription: 'cluster.description',
  clusterInterpretationVersion: 'cluster.interpretationVersion',
  clusterModelVersion: 'cluster.modelVersion',
};

const SUPPORTED_COMPACT_KEYS = new Set(['contractVersion', 'id', 'select', 'dimensions', 'metrics', 'filters', 'orderBy', 'limit']);

export type CompactAnalyticalQueryExpansionResult =
  | { readonly ok: true; readonly plan: AnalyticalQueryPlan }
  | { readonly ok: false; readonly errors: readonly string[] };

export function expandCompactAnalyticalQuery(rawQuery: unknown): CompactAnalyticalQueryExpansionResult {
  const errors: string[] = [];
  if (rawQuery === null || typeof rawQuery !== 'object' || Array.isArray(rawQuery)) {
    return { ok: false, errors: ['compact query must be a JSON object'] };
  }

  const raw = rawQuery as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!SUPPORTED_COMPACT_KEYS.has(key)) errors.push(`unsupported compact query property: ${key}`);
  }
  if (raw.contractVersion !== undefined && raw.contractVersion !== CUSTOMER_INTELLIGENCE_COMPACT_QUERY_VERSION) {
    errors.push(`unsupported compact query contractVersion: ${String(raw.contractVersion)}`);
  }

  const select = resolveOptionalFieldArray(raw.select, 'select', errors);
  const dimensions = resolveOptionalFieldArray(raw.dimensions, 'dimensions', errors);
  const metrics = expandMetrics(raw.metrics, errors);
  const filters = raw.filters === undefined ? undefined : expandFilterInput(raw.filters, errors);
  const orderBy = expandOrderBy(raw.orderBy, errors);

  const plan: AnalyticalQueryPlan = {
    planVersion: CUSTOMER_INTELLIGENCE_QUERY_PLAN_VERSION,
    ...(select && select.length > 0 ? { select } : {}),
    ...(dimensions && dimensions.length > 0 ? { dimensions } : {}),
    ...(metrics && metrics.length > 0 ? { metrics } : {}),
    ...(filters !== undefined ? { filters } : {}),
    ...(orderBy && orderBy.length > 0 ? { orderBy } : {}),
    ...(raw.limit !== undefined ? { limit: raw.limit as number } : {}),
  };

  if (errors.length > 0) return { ok: false, errors };

  const validation = validateAnalyticalQueryPlan(plan);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors.map((error) => `expanded T03 plan invalid: ${error}`) };
  }
  return { ok: true, plan: validation.plan.canonical };
}

export function isCompactAnalyticalQueryShape(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  if (raw.contractVersion === CUSTOMER_INTELLIGENCE_COMPACT_QUERY_VERSION) return true;
  if (Array.isArray(raw.metrics) && raw.metrics.some((metric) => metric !== null && typeof metric === 'object' && !Array.isArray(metric) && 'op' in metric)) return true;
  if (containsCompactFilterOperator(raw.filters)) return true;
  return false;
}

export function compactFieldNameForLogicalName(logicalName: string): string {
  for (const [compactName, mappedLogicalName] of Object.entries(COMPACT_FIELD_ALIASES)) {
    if (mappedLogicalName === logicalName) return compactName;
  }
  const lastDot = logicalName.lastIndexOf('.');
  return lastDot === -1 ? logicalName : logicalName.slice(lastDot + 1);
}

export function logicalNameForCompactField(fieldName: string): string | null {
  if (lookupField(fieldName)) return fieldName;
  const mapped = COMPACT_FIELD_ALIASES[fieldName];
  if (mapped && lookupField(mapped)) return mapped;
  return null;
}

export function getCompactFieldAliases(): Readonly<Record<string, string>> {
  const registered = new Set(getRegisteredFields().map((field) => field.logicalName));
  return Object.fromEntries(Object.entries(COMPACT_FIELD_ALIASES).filter(([, logicalName]) => registered.has(logicalName)));
}

function resolveOptionalFieldArray(value: unknown, name: string, errors: string[]): readonly string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((field) => typeof field !== 'string')) {
    errors.push(`${name} must be an array of compact field names`);
    return null;
  }
  const resolved: string[] = [];
  for (const field of value) {
    const logicalName = logicalNameForCompactField(field);
    if (!logicalName) errors.push(`unknown compact field: ${field}`);
    else resolved.push(logicalName);
  }
  return resolved;
}

function expandMetrics(value: unknown, errors: string[]): AnalyticalQueryPlan['metrics'] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push('metrics must be an array');
    return null;
  }
  return value.map((rawMetric, index) => {
    if (rawMetric === null || typeof rawMetric !== 'object' || Array.isArray(rawMetric)) {
      errors.push(`metrics[${index}] must be an object`);
      return null;
    }
    const metric = rawMetric as Record<string, unknown>;
    const aggregation = metric.op;
    const alias = metric.alias;
    const field = metric.field;
    if (typeof aggregation !== 'string') errors.push(`metrics[${index}].op must be a string`);
    if (typeof alias !== 'string') errors.push(`metrics[${index}].alias must be a string`);
    let logicalField: string | null = null;
    if (field !== undefined) {
      if (typeof field !== 'string') errors.push(`metrics[${index}].field must be a compact field name`);
      else {
        logicalField = logicalNameForCompactField(field);
        if (!logicalField) errors.push(`unknown compact field: ${field}`);
      }
    }
    if (typeof aggregation !== 'string' || typeof alias !== 'string') return null;
    return { aggregation, ...(logicalField ? { field: logicalField } : {}), alias };
  }).filter((metric): metric is NonNullable<AnalyticalQueryPlan['metrics']>[number] => metric !== null);
}

function expandOrderBy(value: unknown, errors: string[]): AnalyticalQueryPlan['orderBy'] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push('orderBy must be an array');
    return null;
  }
  return value.map((rawOrder, index) => {
    if (rawOrder === null || typeof rawOrder !== 'object' || Array.isArray(rawOrder)) {
      errors.push(`orderBy[${index}] must be an object`);
      return null;
    }
    const order = rawOrder as Record<string, unknown>;
    if (typeof order.field !== 'string') errors.push(`orderBy[${index}].field must be a string`);
    if (order.direction !== 'asc' && order.direction !== 'desc') errors.push(`orderBy[${index}].direction must be "asc" or "desc"`);
    if (typeof order.field !== 'string' || (order.direction !== 'asc' && order.direction !== 'desc')) return null;
    const logicalField = logicalNameForCompactField(order.field);
    return { field: logicalField ? aliasFor(logicalField) : order.field, direction: order.direction };
  }).filter((order): order is NonNullable<AnalyticalQueryPlan['orderBy']>[number] => order !== null);
}

function expandFilterInput(value: unknown, errors: string[]): AnalyticalFilterInput | undefined {
  if (Array.isArray(value)) {
    return value.map((child) => expandFilterNode(child, errors)).filter((child): child is AnalyticalFilterNode => child !== null);
  }
  const node = expandFilterNode(value, errors);
  return node ?? undefined;
}

function expandFilterNode(value: unknown, errors: string[]): AnalyticalFilterNode | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.push('invalid compact filter node');
    return null;
  }
  const raw = value as Record<string, unknown>;
  if ('and' in raw || 'or' in raw) {
    const kind = 'and' in raw ? 'and' : 'or';
    const children = raw[kind];
    if (!Array.isArray(children)) {
      errors.push(`compact filter ${kind} must be an array`);
      return null;
    }
    const expanded = children.map((child) => expandFilterNode(child, errors)).filter((child): child is AnalyticalFilterNode => child !== null);
    return kind === 'and' ? { and: expanded } : { or: expanded };
  }
  if (typeof raw.field !== 'string') {
    errors.push('compact filter condition requires field');
    return null;
  }
  const field = logicalNameForCompactField(raw.field);
  if (!field) {
    errors.push(`unknown compact field: ${raw.field}`);
    return null;
  }
  if (typeof raw.op !== 'string') {
    errors.push('compact filter condition requires op');
    return null;
  }
  const operator = raw.op as AnalyticalFilterOperator;
  if (!ANALYTICAL_FILTER_OPERATORS.includes(operator)) errors.push(`unsupported operator: ${String(raw.op)}`);
  return { field, operator, ...('value' in raw ? { value: raw.value as never } : {}) };
}

function containsCompactFilterOperator(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some(containsCompactFilterOperator);
  if (typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  if (typeof raw.op === 'string') return true;
  return containsCompactFilterOperator(raw.and) || containsCompactFilterOperator(raw.or);
}

function aliasFor(logicalName: string): string {
  const lastDot = logicalName.lastIndexOf('.');
  return lastDot === -1 ? logicalName : logicalName.slice(lastDot + 1);
}
