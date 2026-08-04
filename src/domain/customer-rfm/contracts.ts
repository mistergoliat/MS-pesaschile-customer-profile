import type { RfmScore } from './scoring.js';

export type IdentityResolutionStatus = 'provisional';
export type RfmSnapshotStatus = 'building' | 'validated' | 'published' | 'failed' | 'superseded';

export type RfmPopulationSourceRow = {
  readonly prestashopCustomerId: number;
  readonly firstValidOrderAt: string;
  readonly lastValidOrderAt: string;
  readonly frequencyOrders: number;
  readonly grossOrderValueTaxIncl: string;
  readonly distinctShopCount: number;
};

export type RfmSnapshotRow = RfmPopulationSourceRow & {
  readonly masterCustomerId: null;
  readonly identityResolutionStatus: IdentityResolutionStatus;
  readonly recencyDays: number;
  readonly averageOrderValueTaxIncl: string;
  readonly recencyScore: RfmScore;
  readonly frequencyScore: RfmScore;
  readonly monetaryScore: RfmScore;
  readonly rfmCode: string;
};

export type CurrencyDiagnostics = {
  readonly distinctCurrencyCount: number;
  readonly currencyCode: string | null;
  readonly distinctConversionRateCount: number;
};

export type RefundDiagnostics = {
  readonly refundedLineCount: number;
  readonly partiallyRefundedOrderCount: number;
  readonly partiallyRefundedAmountObserved: string;
};

export type ShopDiagnostics = {
  readonly distinctShopCount: number;
  readonly perShop: ReadonlyArray<{
    readonly shopId: number;
    readonly customers: number;
    readonly orders: number;
    readonly grossOrderValueTaxIncl: string;
  }>;
  readonly crossShopCustomers: number;
};

export type PopulationExclusionDiagnostics = {
  readonly invalidOrderExcludedCount: number;
  readonly futureOrderExcludedCount: number;
  readonly zeroAmountOrderCount: number;
  readonly unusableCustomerOrderCount: number;
  readonly missingPrestashopCustomerOrderCount: number;
};

export type RfmSnapshotDiagnostics = {
  readonly historicalCustomerCount: number;
  readonly validOrderCount: number;
  readonly grossOrderValueTaxIncl: string;
  readonly currency: CurrencyDiagnostics;
  readonly refunds: RefundDiagnostics;
  readonly shops: ShopDiagnostics;
  readonly exclusions: PopulationExclusionDiagnostics;
};

export type RfmSnapshotManifest = {
  readonly snapshotId: string | null;
  readonly referenceTime: string;
  readonly windowStartInclusive: string;
  readonly windowEndExclusive: string;
  readonly generatedAt: string;
  readonly identityAuthority: 'prestashop_customer';
  readonly identityAuthorityVersion: 'prestashop-customer-v1';
  readonly populationScope: 'all_valid_prestashop_shops';
  readonly populationPolicyVersion: string;
  readonly monetaryPolicyVersion: string;
  readonly refundPolicyVersion: string;
  readonly currencyPolicyVersion: string;
  readonly scoringPolicyVersion: string;
  readonly checksumVersion: 'rfm-checksum-canonical-json-v1';
  readonly sourceDateTimeStorage: 'mysql_datetime';
  readonly timezoneStatus: 'UNVERIFIED' | 'VERIFIED';
  readonly sourceTimezone: string;
  readonly calculationTimezone: 'UTC';
  readonly referenceTimeTimezone: 'UTC';
  readonly recencyCalendarPolicy: 'utc-calendar-days-v1';
  readonly operationalAccountPolicy: 'none';
  readonly historicalCustomerCount: number;
  readonly activeCustomerCount: number;
  readonly scoredCustomerCount: number;
  readonly excludedCustomerCount: number;
  readonly validOrderCount: number;
  readonly grossOrderValueTaxIncl: string;
  readonly currencyCode: string;
  readonly distinctCurrencyCount: number;
  readonly distinctShopCount: number;
  readonly zeroAmountOrderCount: number;
  readonly futureOrderExcludedCount: number;
  readonly invalidOrderExcludedCount: number;
  readonly partiallyRefundedOrderCount: number;
  readonly partiallyRefundedAmountObserved: string;
  readonly recencyDistribution: DistributionSummary;
  readonly frequencyDistribution: DistributionSummary;
  readonly monetaryDistribution: DecimalDistributionSummary;
  readonly recencyScoreDistribution: Record<string, number>;
  readonly frequencyScoreDistribution: Record<string, number>;
  readonly monetaryScoreDistribution: Record<string, number>;
  readonly rfmCodeDistribution: Record<string, number>;
  readonly frequencyOutlierDiagnostics: FrequencyOutlierDiagnostics;
  readonly scoreCutoffs: {
    readonly recency: Record<string, ScoreCutoff<number>>;
    readonly monetary: Record<string, ScoreCutoff<string>>;
  };
  readonly frequencyThresholds: unknown;
  readonly sourceChecksum: string;
  readonly datasetChecksum: string;
};

export type FrequencyOutlierDiagnostics = {
  readonly maximumFrequencyOrders: number | null;
  readonly frequencyOutlierCount: number;
  readonly frequencyP95: number | null;
  readonly frequencyP99: number | null;
  readonly frequencyP99_5: number | null;
  readonly top1CustomerFrequencyShare: string;
  readonly top5CustomerFrequencyShare: string;
  readonly top10CustomerFrequencyShare: string;
  readonly customersAbove100Orders: number;
  readonly customersAbove500Orders: number;
  readonly scoreDistributionExcludingAbove100Orders: Record<string, number>;
  readonly scoreDistributionExcludingAbove500Orders: Record<string, number>;
};

export type ScoreCutoff<T> = {
  readonly min: T | null;
  readonly max: T | null;
  readonly uniqueValueCount: number;
};

export type DistributionSummary = {
  readonly count: number;
  readonly min: number | null;
  readonly max: number | null;
  readonly average: string | null;
  readonly p20: number | null;
  readonly p40: number | null;
  readonly p60: number | null;
  readonly p80: number | null;
  readonly p90: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly uniqueValueCount: number;
  readonly tieValueCount: number;
};

export type DecimalDistributionSummary = Omit<DistributionSummary, 'min' | 'max' | 'p20' | 'p40' | 'p60' | 'p80' | 'p90' | 'p95' | 'p99'> & {
  readonly min: string | null;
  readonly max: string | null;
  readonly p20: string | null;
  readonly p40: string | null;
  readonly p60: string | null;
  readonly p80: string | null;
  readonly p90: string | null;
  readonly p95: string | null;
  readonly p99: string | null;
};
