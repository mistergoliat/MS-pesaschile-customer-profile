import type { AnalyticalAggregation } from '../customer-intelligence-query/index.js';

// The one source of truth mapping internal analytical field names/aliases to business-facing
// Spanish labels and formatting semantics (task MARKETING-R1-T05.8.6 Section 8). Every renderer
// that shows a metric or entity to a user must go through this module - never re-derive its own
// label or number formatting, and never expose a raw field/alias such as avg_r, avg_f, avg_m or
// customer_count.
export type BusinessValueFormat = 'currency_clp' | 'count' | 'percentage' | 'decimal' | 'ratio' | 'text';

export type BusinessMetricSemantics = {
  readonly name: string;
  readonly label: string;
  readonly format: BusinessValueFormat;
};

const CLUSTER_BUSINESS_LABELS: Readonly<Record<number, string>> = {
  0: 'Clientes recurrentes historicos actualmente inactivos',
  1: 'Clientes recurrentes recientes',
  2: 'Clientes nuevos con actividad inicial que luego cayo',
  3: 'Clientes recurrentes de alto valor y compra diversificada',
};

const CLUSTER_CODE_LABELS: Readonly<Record<string, string>> = {
  LONG_TENURE_DORMANT_SPREAD_OUT_REPEAT_BUYERS: 'Clientes recurrentes historicos actualmente inactivos',
  RECENTLY_ACTIVE_NEWER_REPEAT_BUYERS: 'Clientes recurrentes recientes',
  NEW_BURST_THEN_LAPSED_BUYERS: 'Clientes nuevos con actividad inicial que luego cayo',
  HIGH_VALUE_DIVERSIFIED_REPEAT_BUYERS: 'Clientes recurrentes de alto valor y compra diversificada',
};

type MetricLike = {
  readonly aggregation: AnalyticalAggregation;
  readonly field?: string;
  readonly alias: string;
};

const METRIC_REGISTRY: Readonly<Record<string, { readonly label: string; readonly format: BusinessValueFormat }>> = {
  customerCount: { label: 'Clientes', format: 'count' },
  averageOrderValue: { label: 'Ticket promedio', format: 'currency_clp' },
  totalSpent: { label: 'Gasto total', format: 'currency_clp' },
  validOrderCount: { label: 'Cantidad de compras', format: 'count' },
  orders365d: { label: 'Compras en los ultimos 365 dias', format: 'count' },
  daysSinceLastOrder: { label: 'Dias desde la ultima compra', format: 'count' },
  effectiveDiversity: { label: 'Diversidad de productos', format: 'decimal' },
  repeatProductRate: { label: 'Tasa de recompra', format: 'percentage' },
  averageRecencyScore: { label: 'Recencia promedio', format: 'decimal' },
  averageFrequencyScore: { label: 'Frecuencia promedio', format: 'decimal' },
  averageMonetaryScore: { label: 'Valor monetario promedio', format: 'decimal' },
  rfmCode: { label: 'Codigo RFM', format: 'text' },
};

// Maps the internal logical field (never the model-chosen alias) to the canonical semantic
// metric name the registry above is keyed by. COUNT(*) has no field (task Section 41 elsewhere in
// this codebase), and in this schema a bare count is always a customer count, so it is resolved
// from the aggregation alone. The single source of truth for this mapping - session-context.ts
// and session-service.ts both call this instead of keeping their own copy.
export function resolveSemanticMetricName(metric: MetricLike): string {
  if (metric.aggregation === 'count' || !metric.field) return 'customerCount';
  switch (metric.field) {
    case 'commercial.averageOrderValueTaxIncl':
      return 'averageOrderValue';
    case 'commercial.totalSpentTaxIncl':
      return 'totalSpent';
    case 'commercial.validOrders':
      return 'validOrderCount';
    case 'commercial.orders365d':
      return 'orders365d';
    case 'commercial.daysSinceLastOrder':
      return 'daysSinceLastOrder';
    case 'commercial.effectiveDiversity':
      return 'effectiveDiversity';
    case 'commercial.repeatProductRate':
      return 'repeatProductRate';
    case 'rfm.rScore':
      return 'averageRecencyScore';
    case 'rfm.fScore':
      return 'averageFrequencyScore';
    case 'rfm.mScore':
      return 'averageMonetaryScore';
    case 'rfm.rfmCode':
      return 'rfmCode';
    default:
      return metric.alias;
  }
}

// A count-shaped field averaged instead of summed/counted reads as a per-customer decimal
// (e.g. "2.5 compras promedio"), not a whole count - the only place aggregation changes the
// format for an otherwise fixed field mapping.
function resolveFormat(baseFormat: BusinessValueFormat, aggregation: AnalyticalAggregation): BusinessValueFormat {
  return baseFormat === 'count' && aggregation === 'avg' ? 'decimal' : baseFormat;
}

export function resolveBusinessMetric(metric: MetricLike): BusinessMetricSemantics {
  const name = resolveSemanticMetricName(metric);
  const registered = METRIC_REGISTRY[name];
  if (registered) return { name, label: registered.label, format: resolveFormat(registered.format, metric.aggregation) };
  // Unknown field: still never leak the raw alias verbatim into user-facing text. Humanize it by
  // splitting camelCase/snake_case into words.
  return { name, label: humanizeUnknownAlias(metric.alias), format: 'decimal' };
}

// Resolves a metric already reduced to its semantic name (e.g. from CopilotPrimaryFinding.metric
// or CopilotSemanticAnchor.metric) when the original AnalyticalMetricSpec is not in scope.
export function resolveBusinessMetricByName(semanticName: string | null): BusinessMetricSemantics {
  if (!semanticName) return { name: 'value', label: 'Valor', format: 'decimal' };
  const registered = METRIC_REGISTRY[semanticName];
  if (registered) return { name: semanticName, label: registered.label, format: registered.format };
  return { name: semanticName, label: humanizeUnknownAlias(semanticName), format: 'decimal' };
}

function humanizeUnknownAlias(alias: string): string {
  const words = alias
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.length > 0 ? words.charAt(0).toUpperCase() + words.slice(1) : alias;
}

export function businessEntityLabel(entityType: string | null, entityId: string | number | null): string {
  if (entityType === 'cluster') {
    if (entityId === null) return 'Clientes sin cluster asignado';
    if (typeof entityId === 'number') {
      const businessLabel = CLUSTER_BUSINESS_LABELS[entityId];
      return businessLabel ? `Cluster ${entityId} - ${businessLabel}` : `Cluster ${String(entityId)}`;
    }
    const businessLabel = CLUSTER_CODE_LABELS[entityId];
    return businessLabel ?? humanizeUnknownAlias(entityId);
  }
  if (entityType === 'rfm_segment') return entityId !== null ? `Segmento RFM ${String(entityId)}` : 'Clientes sin segmento RFM';
  return 'la poblacion analizada';
}

const CLP_FORMATTER = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const COUNT_FORMATTER = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const PERCENT_FORMATTER = new Intl.NumberFormat('es-CL', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const DECIMAL_FORMATTER = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const RATIO_FORMATTER = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatBusinessValue(value: string | number | boolean | null, format: BusinessValueFormat): string {
  if (value === null) return 'sin dato';
  if (format === 'text' || typeof value === 'boolean') return String(value);
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  switch (format) {
    case 'currency_clp':
      return CLP_FORMATTER.format(numeric);
    case 'count':
      return COUNT_FORMATTER.format(numeric);
    case 'percentage':
      return PERCENT_FORMATTER.format(numeric);
    case 'ratio':
      return `${RATIO_FORMATTER.format(numeric)} veces`;
    case 'decimal':
    default:
      return DECIMAL_FORMATTER.format(numeric);
  }
}

// "1.er lugar de 4" - Spanish abbreviated ordinals apocopate before a masculine singular noun
// ("primer", "tercer") for 1st/3rd; every other rank uses the standard "-o" superscript form.
export function formatBusinessRank(rank: number, total?: number): string {
  const ordinal = rank === 1 || rank === 3 ? `${rank}.er` : `${rank}.o`;
  return total !== undefined ? `${ordinal} lugar de ${total}` : `${ordinal} lugar`;
}

export function formatRatio(numerator: number, denominator: number): string | null {
  if (denominator === 0 || !Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  return formatBusinessValue(numerator / denominator, 'ratio');
}
