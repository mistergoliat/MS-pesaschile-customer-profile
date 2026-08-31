export const CUSTOMER_CLV_IDENTITY_AUTHORITY = 'prestashop_customer';
export const CUSTOMER_CLV_CURRENCY_ISO_CODE = 'CLP';
export const CUSTOMER_CLV_HORIZON_MONTHS = 12;
export const CUSTOMER_CLV_MODEL_VERSION = 'customer-clv-two-stage-cohort-v1';
export const CUSTOMER_CLV_POPULATION_POLICY_VERSION = 'customer-clv-population-valid-order-ge1-operational-excluded-v1';
export const CUSTOMER_CLV_MONETARY_POLICY_VERSION = 'customer-clv-future-valid-order-tax-incl-clp-revenue-v1';

export type CustomerClvIdentityAuthority = typeof CUSTOMER_CLV_IDENTITY_AUTHORITY;
export type CustomerClvCurrencyIsoCode = typeof CUSTOMER_CLV_CURRENCY_ISO_CODE;
export type CustomerClvHorizonMonths = typeof CUSTOMER_CLV_HORIZON_MONTHS;

export type CustomerClvReliabilityBucket = 'LOW' | 'MEDIUM' | 'HIGH';
export const CUSTOMER_CLV_RELIABILITY_BUCKETS: readonly CustomerClvReliabilityBucket[] = ['LOW', 'MEDIUM', 'HIGH'];

export type CustomerClvSnapshotStatus = 'building' | 'validated' | 'published' | 'failed' | 'superseded';
export const CUSTOMER_CLV_SNAPSHOT_STATUSES: readonly CustomerClvSnapshotStatus[] = [
  'building',
  'validated',
  'published',
  'failed',
  'superseded',
];

// CLV v1 means expected future revenue, not historical spend, profit, budget, RFM score,
// cluster score, affinity, or purchase probability.
export type CustomerClvRecord = {
  readonly customerId: number;
  readonly horizonMonths: CustomerClvHorizonMonths;
  readonly expectedRevenueTaxIncl: string;
  readonly currencyIsoCode: CustomerClvCurrencyIsoCode;
  readonly modelVersion: string;
  readonly referenceTime: string;
  readonly populationPolicyVersion: string;
  readonly monetaryPolicyVersion: string;
  readonly reliabilityBucket: CustomerClvReliabilityBucket;
  readonly expectedOrders?: string;
};

export type CustomerClvTrainingMetadata = {
  readonly trainingCutoffStart?: string;
  readonly trainingCutoffEnd?: string;
  readonly trainingWindowCount?: number;
  readonly modelFitVersion?: string;
};

export type CustomerClvValidationMetadata = {
  readonly validationCutoff?: string;
  readonly maeRevenueTaxIncl?: string;
  readonly medianAbsoluteErrorRevenueTaxIncl?: string;
  readonly rankCorrelation?: string;
  readonly top10RevenueCapture?: string;
  readonly calibrationRatio?: string;
};

export type CustomerClvSnapshotHeader = {
  readonly snapshotId: string | null;
  readonly snapshotKey: string;
  readonly status: CustomerClvSnapshotStatus;
  readonly referenceTime: string;
  readonly generatedAt: string;
  readonly horizonMonths: CustomerClvHorizonMonths;
  readonly modelVersion: string;
  readonly populationPolicyVersion: string;
  readonly monetaryPolicyVersion: string;
  readonly identityAuthority: CustomerClvIdentityAuthority;
  readonly currencyIsoCode: CustomerClvCurrencyIsoCode;
  readonly populationSize: number;
  readonly datasetChecksum: string;
  readonly outputChecksum: string;
  readonly trainingMetadata?: CustomerClvTrainingMetadata;
  readonly validationMetadata?: CustomerClvValidationMetadata;
};

export type CustomerClvSnapshotRow = {
  readonly customerId: number;
  readonly expectedRevenueTaxIncl: string;
  readonly reliabilityBucket: CustomerClvReliabilityBucket;
  readonly expectedOrders?: string;
};

export type CustomerIntelligenceClvSnapshotRef = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly modelVersion: string;
  readonly horizonMonths: CustomerClvHorizonMonths;
};

export type CustomerIntelligenceClv = {
  readonly snapshot: CustomerIntelligenceClvSnapshotRef;
  readonly expectedRevenueTaxIncl: string;
  readonly currencyIsoCode: CustomerClvCurrencyIsoCode;
  readonly reliabilityBucket: CustomerClvReliabilityBucket;
  readonly expectedOrders?: string;
};
