import {
  ANALYTICAL_AGGREGATIONS,
  ANALYTICAL_FILTER_OPERATORS,
  type AnalyticalAggregation,
  type AnalyticalFieldDataType,
  type AnalyticalFieldSource,
  type AnalyticalFilterOperator,
} from './contracts.js';

// Internal-only: the compiler's static field -> SQL expression mapping. Never exposed by
// getAnalyticalSchema() (application layer strips this before returning to any caller,
// including a future LLM — task Section 8: "Do NOT expose physical DB identifiers directly as
// public analytical fields"). Because every SQL identifier the compiler ever emits comes from
// this fixed, hardcoded table (never from plan.field text interpolated directly), an unknown
// `field` string can only ever fail a Map.get lookup — it can never reach SQL text (task
// Section 23).
export type RegisteredField = {
  readonly logicalName: string;
  readonly type: AnalyticalFieldDataType;
  readonly nullable: boolean;
  readonly source: AnalyticalFieldSource;
  readonly description: string;
  // Fully-qualified column/expression against the fixed FROM/JOIN topology the compiler always
  // emits (see compiler.ts) — e.g. 'fr.valid_orders', 'ci.label'. Never built from user input.
  readonly sqlExpression: string;
};

// Bounded, type-driven operator/aggregation sets (task Section 14/16/58) — one shared rule per
// data type rather than hand-curated per field, so "AVG(rfm.segmentCode)"/"SUM(cluster.label)"
// fail for the same structural reason (string type has no sum/avg), not a per-field special
// case. Ordering columns/dates get comparison operators but not IN/NOT_IN (unusual for a
// continuous value); strings get equality/membership but not range comparisons (task Section 14
// deliberately excludes regex/arbitrary expressions, not "before/after"-only inequality on
// text).
const OPERATORS_BY_TYPE: Record<AnalyticalFieldDataType, readonly AnalyticalFilterOperator[]> = {
  integer: ANALYTICAL_FILTER_OPERATORS,
  decimal: ANALYTICAL_FILTER_OPERATORS,
  string: ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'],
  datetime: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'is_not_null'],
};

// task Section 58: SUM/AVG only ever make sense on integer/decimal fields. MIN/MAX are valid
// for any orderable type (including datetime/string); COUNT/COUNT_DISTINCT are valid for
// every type.
const AGGREGATIONS_BY_TYPE: Record<AnalyticalFieldDataType, readonly AnalyticalAggregation[]> = {
  integer: ANALYTICAL_AGGREGATIONS,
  decimal: ANALYTICAL_AGGREGATIONS,
  string: ['count', 'count_distinct', 'min', 'max'],
  datetime: ['count', 'count_distinct', 'min', 'max'],
};

function field(
  logicalName: string,
  type: AnalyticalFieldDataType,
  nullable: boolean,
  source: AnalyticalFieldSource,
  sqlExpression: string,
  description: string,
): RegisteredField {
  return { logicalName, type, nullable, source, sqlExpression, description };
}

// task Section 8/38 — every field the runtime may ever reference in a plan. Snapshot ids and
// rfm.calculationVersion stay provenance-only on CustomerIntelligenceSnapshotContext.
// cluster.modelVersion is intentionally queryable because cluster ids are model-scoped.
const FIELDS: readonly RegisteredField[] = [
  field('customer.customerId', 'integer', false, 'customer', 'fr.prestashop_customer_id', 'PrestaShop customer id — the only identifier this read-only, PII-free runtime ever exposes.'),

  field('commercial.validOrders', 'integer', false, 'commercial', 'fr.valid_orders', 'Count of valid orders (Customer Analytics Population B) before the anchor feature snapshot\'s referenceTime.'),
  field('commercial.totalSpentTaxIncl', 'decimal', false, 'commercial', 'fr.total_spent_tax_incl', 'Lifetime total_paid_tax_incl over valid orders included by Customer Analytics Population B.'),
  field('commercial.averageOrderValueTaxIncl', 'decimal', false, 'commercial', 'fr.average_order_value_tax_incl', 'totalSpentTaxIncl / validOrders.'),
  field('commercial.firstOrderAt', 'datetime', false, 'commercial', 'fr.first_order_at', 'Timestamp of the customer\'s earliest valid order.'),
  field('commercial.lastOrderAt', 'datetime', false, 'commercial', 'fr.last_order_at', 'Timestamp of the customer\'s most recent valid order.'),
  field('commercial.daysSinceLastOrder', 'integer', false, 'commercial', 'fr.days_since_last_order', 'Whole days between lastOrderAt and the feature snapshot\'s referenceTime.'),
  field('commercial.customerTenureDays', 'integer', false, 'commercial', 'fr.customer_tenure_days', 'Whole days since PrestaShop account creation, independent of order count.'),
  field('commercial.distinctProducts', 'integer', false, 'commercial', 'fr.distinct_products', 'Count of distinct products purchased across the customer\'s valid orders.'),
  field('commercial.repeatProductRate', 'decimal', false, 'commercial', 'fr.repeat_product_rate', 'Share of purchased products bought in 2 or more distinct orders (product-level).'),
  field('commercial.top1Share', 'decimal', false, 'commercial', 'fr.top1_share', 'Spend concentration share of the customer\'s single top product (product-level spend).'),
  field('commercial.top3Share', 'decimal', false, 'commercial', 'fr.top3_share', 'Spend concentration share of the customer\'s top 3 products (product-level spend).'),
  field('commercial.effectiveDiversity', 'decimal', false, 'commercial', 'fr.effective_diversity', 'Inverse Herfindahl (1/HHI) of the customer\'s product-level spend distribution; >=1, unbounded above.'),
  field('commercial.averageUnitsPerOrder', 'decimal', false, 'commercial', 'fr.average_units_per_order', 'Total units purchased divided by validOrders.'),
  field('commercial.purchaseFrequencyDays', 'decimal', true, 'commercial', 'fr.purchase_frequency_days', 'Average days between orders; NULL when validOrders < 2 (no interval to measure, never a synthetic 0).'),
  field('commercial.orders365d', 'integer', false, 'commercial', 'fr.orders_365d', 'Count of valid orders inside the 365 days before the feature snapshot\'s referenceTime.'),
  field('commercial.cancelledOrderRatio', 'decimal', false, 'commercial', 'fr.cancelled_order_ratio', 'Cancelled orders / all orders of any state (denominator is not limited to valid orders).'),
  field('commercial.discountShare', 'decimal', false, 'commercial', 'fr.discount_share', 'Total order-level discounts / totalSpentTaxIncl.'),
  field('commercial.shippingShare', 'decimal', false, 'commercial', 'fr.shipping_share', 'Total order-level shipping / totalSpentTaxIncl.'),

  field('rfm.rScore', 'integer', true, 'rfm', 'rr.recency_score', 'Recency score from the selected persisted RFM snapshot; NULL when no compatible RFM snapshot matched this customer.'),
  field('rfm.fScore', 'integer', true, 'rfm', 'rr.frequency_score', 'Frequency score from the selected persisted RFM snapshot; NULL when unmatched.'),
  field('rfm.mScore', 'integer', true, 'rfm', 'rr.monetary_score', 'Monetary score from the selected persisted RFM snapshot; NULL when unmatched.'),
  field('rfm.rfmCode', 'string', true, 'rfm', 'rr.rfm_code', 'Combined R-F-M code from the selected persisted RFM snapshot; NULL when unmatched.'),
  field('rfm.segmentCode', 'string', true, 'rfm', 'rr.segment_code', 'Segment produced by the selected persisted RFM snapshot; nullable when the customer is outside that snapshot population.'),

  field('cluster.clusterId', 'integer', true, 'cluster', 'cr.cluster_id', 'Cluster assignment produced by the selected behavioral clustering snapshot; ID is meaningful only within its modelVersion.'),
  field('cluster.distanceToCentroid', 'decimal', true, 'cluster', 'cr.distance_to_centroid', 'Distance from the customer\'s feature vector to its assigned cluster\'s centroid; NULL when unmatched.'),
  field('cluster.label', 'string', true, 'cluster', 'ci.label', 'Human-readable interpretation label for the assigned cluster (latest interpretation_version for its model); NULL when unmatched or not yet interpreted.'),
  field('cluster.description', 'string', true, 'cluster', 'ci.description', 'Human-readable interpretation description for the assigned cluster; NULL when unmatched or not yet interpreted.'),
  field('cluster.interpretationVersion', 'string', true, 'cluster', 'ci.interpretation_version', 'Version tag of the cluster interpretation applied; NULL when unmatched or not yet interpreted.'),
  field('cluster.modelVersion', 'string', true, 'cluster', 'cm.model_version', 'Model version of the selected behavioral clustering snapshot; clusterId values are comparable only within this modelVersion.'),
];

const FIELDS_BY_NAME: ReadonlyMap<string, RegisteredField> = new Map(FIELDS.map((f) => [f.logicalName, f]));

export function getRegisteredFields(): readonly RegisteredField[] {
  return FIELDS;
}

export function lookupField(logicalName: string): RegisteredField | null {
  return FIELDS_BY_NAME.get(logicalName) ?? null;
}

export function allowedOperatorsFor(fieldMeta: RegisteredField): readonly AnalyticalFilterOperator[] {
  return OPERATORS_BY_TYPE[fieldMeta.type];
}

export function allowedAggregationsFor(fieldMeta: RegisteredField): readonly AnalyticalAggregation[] {
  return AGGREGATIONS_BY_TYPE[fieldMeta.type];
}
