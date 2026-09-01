export const CUSTOMER_COMMERCIAL_PROFILE_VERSION = 'customer-commercial-profile-v1';
export const CUSTOMER_COMMERCIAL_PROFILE_IDENTITY_AUTHORITY = 'prestashop_customer';

export type CustomerCommercialProfileAvailabilityState =
  | 'AVAILABLE'
  | 'NOT_IN_POPULATION'
  | 'UNAVAILABLE'
  | 'NOT_IMPLEMENTED';

export const CUSTOMER_COMMERCIAL_PROFILE_AVAILABILITY_STATES: readonly CustomerCommercialProfileAvailabilityState[] = [
  'AVAILABLE',
  'NOT_IN_POPULATION',
  'UNAVAILABLE',
  'NOT_IMPLEMENTED',
];

export type CustomerCommercialProfileRfm = {
  readonly recency: number;
  readonly frequency: number;
  readonly monetary: string;
  readonly recencyScore: number;
  readonly frequencyScore: number;
  readonly monetaryScore: number;
  readonly rfmCode: string;
  readonly segmentCode: string | null;
  readonly segmentVersion: string | null;
};

export type CustomerCommercialProfileCluster = {
  readonly clusterId: number;
  readonly label: string | null;
  readonly modelVersion: string;
};

export type CustomerCommercialProfileClv = {
  readonly expectedRevenueTaxIncl: string;
  readonly expectedOrders?: string;
  readonly horizonMonths: number;
  readonly currencyIsoCode: string;
  readonly estimateSupportLevel: 'SPARSE' | 'SUPPORTED';
};

export type CustomerCommercialProfileRfmProvenance = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly calculationVersion: string;
};

export type CustomerCommercialProfileClusterProvenance = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly modelVersion: string;
};

export type CustomerCommercialProfileClvProvenance = {
  readonly snapshotId: string;
  readonly referenceTime: string;
  readonly modelVersion: string;
};

export type CustomerCommercialProfileProvenance = {
  readonly generatedAt: string;
  readonly oldestReferenceTime: string | null;
  readonly newestReferenceTime: string | null;
  readonly rfm: CustomerCommercialProfileRfmProvenance | null;
  readonly behavioralCluster: CustomerCommercialProfileClusterProvenance | null;
  readonly clv: CustomerCommercialProfileClvProvenance | null;
  readonly commercialAffinity: null;
};

export type CustomerCommercialProfileAvailability = {
  readonly rfm: CustomerCommercialProfileAvailabilityState;
  readonly behavioralCluster: CustomerCommercialProfileAvailabilityState;
  readonly clv: CustomerCommercialProfileAvailabilityState;
  readonly commercialAffinity: 'NOT_IMPLEMENTED';
};

export type CustomerCommercialProfile = {
  readonly customerId: number;
  readonly identityAuthority: typeof CUSTOMER_COMMERCIAL_PROFILE_IDENTITY_AUTHORITY;
  readonly rfm: CustomerCommercialProfileRfm | null;
  readonly behavioralCluster: CustomerCommercialProfileCluster | null;
  readonly clv: CustomerCommercialProfileClv | null;
  readonly commercialAffinity: null;
  readonly availability: CustomerCommercialProfileAvailability;
  readonly provenance: CustomerCommercialProfileProvenance;
};

