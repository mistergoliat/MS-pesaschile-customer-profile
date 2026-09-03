import type { AudienceFieldIdV1, AudienceScalarOperatorV1 } from './contracts.js';

export type AudienceFieldTypeV1 = 'integer' | 'decimal' | 'string' | 'datetime';
export type AudienceFieldComponentV1 = 'feature' | 'rfm' | 'cluster' | 'clv';
export type AudienceFieldDefinitionV1 = {
  readonly field: AudienceFieldIdV1;
  readonly type: AudienceFieldTypeV1;
  readonly component: AudienceFieldComponentV1;
  readonly nullable: boolean;
  readonly description: string;
  readonly unit?: string;
  readonly allowedOperators: readonly AudienceScalarOperatorV1[];
};

const ALL_OPERATORS: readonly AudienceScalarOperatorV1[] = ['EQ', 'NEQ', 'IN', 'NOT_IN', 'GT', 'GTE', 'LT', 'LTE', 'BETWEEN', 'IS_NULL', 'IS_NOT_NULL'];
const STRING_OPERATORS = ALL_OPERATORS;
const NUMERIC_OPERATORS = ALL_OPERATORS;

const definitions: readonly AudienceFieldDefinitionV1[] = [
  field('rfm.segmentCode', 'string', 'rfm', true, 'Commercial RFM segment code; interpreted within the resolved segment version.'),
  field('rfm.segmentVersion', 'string', 'rfm', true, 'Version of the RFM segmentation taxonomy.', undefined, STRING_OPERATORS),
  field('rfm.rfmCode', 'string', 'rfm', true, 'Three-digit recency/frequency/monetary score code.', undefined, STRING_OPERATORS),
  field('rfm.recencyDays', 'integer', 'rfm', true, 'Days since the last valid order.', 'days'),
  field('rfm.frequencyOrders', 'integer', 'rfm', true, 'Number of valid orders in the RFM window.', 'orders'),
  field('rfm.grossOrderValueTaxIncl', 'decimal', 'rfm', true, 'Gross value of valid orders including tax.', 'CLP'),
  field('rfm.recencyScore', 'integer', 'rfm', true, 'RFM recency score from 1 to 5.', 'score'),
  field('rfm.frequencyScore', 'integer', 'rfm', true, 'RFM frequency score from 1 to 5.', 'score'),
  field('rfm.monetaryScore', 'integer', 'rfm', true, 'RFM monetary score from 1 to 5.', 'score'),
  field('cluster.clusterId', 'integer', 'cluster', true, 'Behavioral cluster identifier within the resolved model.', 'cluster id'),
  field('cluster.modelVersion', 'string', 'cluster', true, 'Behavioral clustering model version.', undefined, STRING_OPERATORS),
  field('clv.expectedRevenueTaxIncl', 'decimal', 'clv', true, 'Expected future revenue including tax over the CLV horizon.', 'CLP'),
  field('clv.expectedOrders', 'decimal', 'clv', true, 'Expected future order count over the CLV horizon.', 'orders'),
  field('clv.estimateSupportLevel', 'string', 'clv', true, 'CLV estimate support classification.', undefined, STRING_OPERATORS),
  field('commercial.validOrders', 'integer', 'feature', false, 'Count of valid lifetime orders.', 'orders'),
  field('commercial.totalSpentTaxIncl', 'decimal', 'feature', false, 'Total spend from valid orders including tax.', 'CLP'),
  field('commercial.averageOrderValueTaxIncl', 'decimal', 'feature', false, 'Average valid order value including tax.', 'CLP'),
  field('commercial.firstOrderAt', 'datetime', 'feature', false, 'Timestamp of the first valid order.', 'UTC timestamp'),
  field('commercial.lastOrderAt', 'datetime', 'feature', false, 'Timestamp of the last valid order.', 'UTC timestamp'),
  field('commercial.daysSinceLastOrder', 'integer', 'feature', false, 'Days between the feature reference time and the last valid order.', 'days'),
  field('commercial.customerTenureDays', 'integer', 'feature', false, 'Days between the first valid order and the feature reference time.', 'days'),
  field('commercial.distinctProducts', 'integer', 'feature', false, 'Count of distinct purchased products in valid orders.', 'products'),
  field('commercial.repeatProductRate', 'decimal', 'feature', false, 'Share of purchased products that were purchased repeatedly.', 'ratio'),
  field('commercial.top1Share', 'decimal', 'feature', false, 'Share of spend represented by the largest product contribution.', 'ratio'),
  field('commercial.top3Share', 'decimal', 'feature', false, 'Share of spend represented by the three largest product contributions.', 'ratio'),
  field('commercial.effectiveDiversity', 'decimal', 'feature', false, 'Effective diversity of the customer product mix.', 'index'),
  field('commercial.averageUnitsPerOrder', 'decimal', 'feature', false, 'Average purchased units per valid order.', 'units/order'),
  field('commercial.purchaseFrequencyDays', 'decimal', 'feature', true, 'Average interval between valid orders; null for customers without two valid orders.', 'days'),
  field('commercial.orders365d', 'integer', 'feature', false, 'Valid orders in the trailing 365 days from the feature reference time.', 'orders'),
  field('commercial.cancelledOrderRatio', 'decimal', 'feature', false, 'Ratio of cancelled orders in the source order population.', 'ratio'),
  field('commercial.discountShare', 'decimal', 'feature', false, 'Share of order value attributable to discounts.', 'ratio'),
  field('commercial.shippingShare', 'decimal', 'feature', false, 'Share of order value attributable to shipping.', 'ratio'),
];

function field(fieldId: AudienceFieldIdV1, type: AudienceFieldTypeV1, component: AudienceFieldComponentV1, nullable: boolean, description: string, unit?: string, allowedOperators?: readonly AudienceScalarOperatorV1[]): AudienceFieldDefinitionV1 {
  return { field: fieldId, type, component, nullable, description, ...(unit === undefined ? {} : { unit }), allowedOperators: allowedOperators ?? (type === 'string' ? STRING_OPERATORS : NUMERIC_OPERATORS) };
}

export const AUDIENCE_FIELD_REGISTRY_V1: ReadonlyMap<AudienceFieldIdV1, AudienceFieldDefinitionV1> = new Map(definitions.map((definition) => [definition.field, definition]));
export function getAudienceFieldDefinition(field: string): AudienceFieldDefinitionV1 | null {
  return AUDIENCE_FIELD_REGISTRY_V1.get(field as AudienceFieldIdV1) ?? null;
}
