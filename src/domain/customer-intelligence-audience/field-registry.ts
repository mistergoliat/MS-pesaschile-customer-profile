import type { AudienceFieldIdV1 } from './contracts.js';

export type AudienceFieldTypeV1 = 'integer' | 'decimal' | 'string' | 'datetime';
export type AudienceFieldComponentV1 = 'feature' | 'rfm' | 'cluster' | 'clv';
export type AudienceFieldDefinitionV1 = {
  readonly field: AudienceFieldIdV1;
  readonly type: AudienceFieldTypeV1;
  readonly component: AudienceFieldComponentV1;
  readonly nullable: boolean;
};

const definitions: readonly AudienceFieldDefinitionV1[] = [
  ...(['segmentCode', 'segmentVersion', 'rfmCode'].map((name) => ({ field: `rfm.${name}`, type: 'string', component: 'rfm', nullable: true })) as AudienceFieldDefinitionV1[]),
  ...(['recencyDays', 'frequencyOrders', 'recencyScore', 'frequencyScore', 'monetaryScore'].map((name) => ({ field: `rfm.${name}`, type: 'integer', component: 'rfm', nullable: true })) as AudienceFieldDefinitionV1[]),
  { field: 'rfm.grossOrderValueTaxIncl', type: 'decimal', component: 'rfm', nullable: true },
  { field: 'cluster.clusterId', type: 'integer', component: 'cluster', nullable: true },
  { field: 'cluster.modelVersion', type: 'string', component: 'cluster', nullable: true },
  { field: 'clv.expectedRevenueTaxIncl', type: 'decimal', component: 'clv', nullable: true },
  { field: 'clv.expectedOrders', type: 'decimal', component: 'clv', nullable: true },
  { field: 'clv.estimateSupportLevel', type: 'string', component: 'clv', nullable: true },
  { field: 'commercial.validOrders', type: 'integer', component: 'feature', nullable: false },
  { field: 'commercial.totalSpentTaxIncl', type: 'decimal', component: 'feature', nullable: false },
  { field: 'commercial.averageOrderValueTaxIncl', type: 'decimal', component: 'feature', nullable: false },
  { field: 'commercial.firstOrderAt', type: 'datetime', component: 'feature', nullable: false },
  { field: 'commercial.lastOrderAt', type: 'datetime', component: 'feature', nullable: false },
  { field: 'commercial.daysSinceLastOrder', type: 'integer', component: 'feature', nullable: false },
  { field: 'commercial.customerTenureDays', type: 'integer', component: 'feature', nullable: false },
  { field: 'commercial.distinctProducts', type: 'integer', component: 'feature', nullable: false },
  ...(['repeatProductRate', 'top1Share', 'top3Share', 'effectiveDiversity', 'averageUnitsPerOrder', 'purchaseFrequencyDays', 'cancelledOrderRatio', 'discountShare', 'shippingShare'].map((name) => ({ field: `commercial.${name}`, type: 'decimal', component: 'feature', nullable: name === 'purchaseFrequencyDays' })) as AudienceFieldDefinitionV1[]),
  { field: 'commercial.orders365d', type: 'integer', component: 'feature', nullable: false },
];

export const AUDIENCE_FIELD_REGISTRY_V1: ReadonlyMap<AudienceFieldIdV1, AudienceFieldDefinitionV1> = new Map(definitions.map((definition) => [definition.field, definition]));
export function getAudienceFieldDefinition(field: string): AudienceFieldDefinitionV1 | null {
  return AUDIENCE_FIELD_REGISTRY_V1.get(field as AudienceFieldIdV1) ?? null;
}
