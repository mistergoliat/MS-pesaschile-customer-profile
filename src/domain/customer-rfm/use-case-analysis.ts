import {
  addRfmDecimals,
  compareRfmDecimalAsc,
  divideRfmDecimal,
  formatRfmDecimal,
} from './decimal.js';
import { parseReferenceTime, recencyCalendarDays } from './date-window.js';
import { sha256Stable } from './checksum.js';
import type { RfmScore } from './scoring.js';
import type { RfmSnapshotRow } from './contracts.js';

export const rfmUseCaseAnalysisVersion = 'rfm-use-case-analysis-v1';

export type HistoricalRfmOrderInput = {
  readonly prestashopCustomerId: number;
  readonly orderId: number;
  readonly validOrderAt: string;
  readonly grossOrderValueTaxIncl: string;
  readonly shopId: number;
};

export type RfmUseCaseAnalysisInput = {
  readonly referenceTime: string;
  readonly calculationVersion: string;
  readonly operationalRows: readonly RfmSnapshotRow[];
  readonly historicalOrders: readonly HistoricalRfmOrderInput[];
  readonly stabilitySnapshots?: readonly RfmStabilitySnapshotInput[];
  readonly t08T09SignalsAvailable?: boolean;
};

export type RfmStabilitySnapshotInput = {
  readonly referenceTime: string;
  readonly operationalRows: readonly RfmSnapshotRow[];
  readonly historicalOrders: readonly HistoricalRfmOrderInput[];
};

export type PopulationSummary = {
  readonly referenceTime: string;
  readonly calculationVersion: string;
  readonly operationalCustomerCount: number;
  readonly historicalCustomerCount: number;
  readonly historicalOutsideOperationalWindowCount: number;
  readonly operationalShareOfHistoricalCustomers: string;
  readonly operationalOrderCount: number;
  readonly historicalOrderCount: number;
  readonly operationalGrossOrderValueTaxIncl: string;
  readonly historicalGrossOrderValueTaxIncl: string;
  readonly timezoneStatus: 'UNVERIFIED';
  readonly identityResolutionStatus: 'provisional';
  readonly checksum: string;
};

export type LifetimeCustomerMetrics = {
  readonly prestashopCustomerId: number;
  readonly lifetimeFirstValidOrderAt: string;
  readonly lifetimeLastValidOrderAt: string;
  readonly lifetimeFrequencyOrders: number;
  readonly lifetimeGrossOrderValueTaxIncl: string;
  readonly lifetimeAverageOrderValueTaxIncl: string;
  readonly daysSinceLifetimeLastOrder: number;
  readonly hasOrderInOperationalWindow: boolean;
};

export type OperationalVsLifetimeSummary = {
  readonly operationalOnlyCustomerCount: number;
  readonly historicalOnlyCustomerCount: number;
  readonly customersInBothLayersCount: number;
  readonly historicalOutsideOperationalWindowCount: number;
  readonly historicalOutsideOperationalWindowGrossOrderValueTaxIncl: string;
  readonly medianDaysSinceLastOrderOutsideOperationalWindow: number | null;
};

export type SecondPurchaseAnalysis = {
  readonly customersWithSecondPurchase: number;
  readonly customersWithoutSecondPurchase: number;
  readonly conversionFromFirstToSecondProxy: string;
  readonly daysFirstToSecondOrder: NumberDistribution;
  readonly buckets: Record<SecondPurchaseBucket, number>;
  readonly firstPurchaseCohorts: readonly FirstPurchaseCohortSummary[];
  readonly caveat: 'NOT_CAUSAL_CONVERSION_RATE';
};

export type SecondPurchaseBucket =
  | 'sameDay'
  | '1-7 days'
  | '8-30 days'
  | '31-60 days'
  | '61-90 days'
  | '91-180 days'
  | '181-365 days'
  | '>365 days'
  | 'noSecondPurchase';

export type FirstPurchaseCohortSummary = {
  readonly cohortMonth: string;
  readonly customerCount: number;
  readonly matured365DayObservation: boolean;
  readonly customersWithObservedSecondPurchase: number;
  readonly notYetObservedCount: number;
  readonly noSecondPurchaseObservedCount: number;
};

export type CandidateCohorts = {
  readonly recentFirstPurchase: Record<string, RecentFirstPurchaseCohort>;
  readonly repeatCustomer: Record<string, RepeatCustomerCohort>;
  readonly highGrossPurchaseValueActive: Record<string, HighGrossActiveCohort>;
  readonly activeRepeatHighGross: Record<string, ActiveRepeatHighGrossCohort>;
  readonly historicallyHighGrossInactive: Record<string, HistoricallyHighGrossInactiveCohort>;
  readonly frequencyOutlierReview: Record<string, FrequencyOutlierCohort>;
  readonly actionability: readonly CohortActionability[];
};

export type RecentFirstPurchaseCohort = BaseCohort & {
  readonly grossMonetary: string;
  readonly averageOrderValue: string;
  readonly medianOrderValue: string | null;
  readonly shopDistribution: readonly ShopDistributionEntry[];
};

export type RepeatCustomerCohort = BaseCohort & {
  readonly orderShare: string;
  readonly grossMonetaryShare: string;
  readonly averageOrderValue: string;
  readonly medianRecency: number | null;
};

export type HighGrossActiveCohort = BaseCohort & {
  readonly grossMonetaryShare: string;
  readonly frequencyDistribution: NumberDistribution;
  readonly recencyDistribution: NumberDistribution;
  readonly shopDistribution: readonly ShopDistributionEntry[];
};

export type ActiveRepeatHighGrossCohort = BaseCohort & {
  readonly orderShare: string;
  readonly grossMonetaryShare: string;
  readonly maximumFrequency: number | null;
  readonly outlierSensitivity: OutlierSensitivity;
};

export type HistoricallyHighGrossInactiveCohort = {
  readonly cohortId: string;
  readonly threshold: string;
  readonly customerCount: number;
  readonly historicalPopulationShare: string;
  readonly lifetimeGrossMonetaryShare: string;
  readonly medianDaysSinceLastOrder: number | null;
  readonly p75DaysSinceLastOrder: number | null;
  readonly shopDistribution: readonly ShopDistributionEntry[];
};

export type FrequencyOutlierCohort = {
  readonly cohortId: string;
  readonly customerCount: number;
  readonly orderShare: string;
  readonly grossMonetaryShare: string;
  readonly impactOnFrequencyDistribution: {
    readonly maximumFrequencyWithOutliers: number | null;
    readonly maximumFrequencyWithoutCohort: number | null;
  };
  readonly impactOnCandidateCohorts: Record<string, number>;
};

export type BaseCohort = {
  readonly cohortId: string;
  readonly customerCount: number;
  readonly historicalPopulationShare: string;
  readonly operationalPopulationShare: string;
};

export type ShopDistributionEntry = {
  readonly shopId: number;
  readonly customerCount: number;
  readonly orderCount: number;
  readonly grossOrderValueTaxIncl: string;
};

export type OutlierSensitivity = {
  readonly excludingFrequencyAbove100: number;
  readonly excludingFrequencyAbove500: number;
};

export type ThresholdSensitivity = {
  readonly recency: Record<string, SensitivityEntry>;
  readonly frequency: Record<string, SensitivityEntry>;
  readonly monetary: Record<string, SensitivityEntry>;
};

export type SensitivityEntry = {
  readonly customerCount: number;
  readonly populationShare: string;
  readonly orderShare: string;
  readonly grossMonetaryShare: string;
};

export type IncrementalValueVerdict =
  | 'RFM_ADDS_MEANINGFUL_VALUE'
  | 'RFM_ADDS_LIMITED_VALUE'
  | 'SIMPLE_FILTER_IS_SUFFICIENT'
  | 'REQUIRES_T08_T09'
  | 'INSUFFICIENT_EVIDENCE';

export type RfmIncrementalValueEntry = {
  readonly useCase: string;
  readonly simpleFilterBaseline: string;
  readonly rfmEnrichment: string;
  readonly additionalValue: string;
  readonly complexity: 'low' | 'medium' | 'high';
  readonly verdict: IncrementalValueVerdict;
};

export type CohortStability = {
  readonly warning: 'HISTORICAL_RECALCULATION_SOURCE_IS_MUTABLE';
  readonly snapshots: readonly CohortStabilitySnapshot[];
};

export type CohortStabilitySnapshot = {
  readonly referenceTime: string;
  readonly operationalCustomerCount: number;
  readonly recentFirstPurchase30dCustomerCount: number;
  readonly repeatCustomer2PlusCustomerCount: number;
  readonly highGrossM5CustomerCount: number;
  readonly activeRepeatHighGross444CustomerCount: number;
  readonly historicallyHighGrossInactiveTop10CustomerCount: number;
};

export type T08T09CrossAnalysis = {
  readonly recentFirstPurchaseT08: CrossSignalStatus;
  readonly repeatCustomerT09: CrossSignalStatus;
  readonly highGrossValueT09: CrossSignalStatus;
  readonly historicallyHighGrossInactiveT08T09: CrossSignalStatus;
};

export type CrossSignalStatus =
  | {
      readonly status: 'CROSS_SIGNAL_UNAVAILABLE';
      readonly reason: string;
    }
  | {
      readonly status: 'CONTRACT_FIELDS_AVAILABLE_FOR_FUTURE_JOIN';
      readonly fields: readonly string[];
    };

export type CohortActionability = {
  readonly cohortId: string;
  readonly definition: string;
  readonly calculationVersion: string;
  readonly referenceTime: string;
  readonly customerCount: number;
  readonly populationShare: string;
  readonly orderShare: string | null;
  readonly grossMonetaryShare: string | null;
  readonly interpretation: string;
  readonly possibleCommercialAction: string;
  readonly requiredAdditionalSignals: readonly string[];
  readonly risks: readonly string[];
  readonly automationReadiness:
    | 'ANALYSIS_ONLY'
    | 'HUMAN_REVIEW_CANDIDATE'
    | 'POTENTIAL_FUTURE_AUTOMATION'
    | 'NOT_ACTIONABLE';
  readonly requiresProductHistory: boolean;
  readonly requiresCurrentIntent: boolean;
  readonly requiresOpportunityContext: boolean;
  readonly requiresConsent: boolean;
  readonly requiresHumanReview: boolean;
};

export type UseCaseValidationVerdict =
  | 'RFM_USE_CASES_VALIDATED'
  | 'RFM_ADDS_LIMITED_INCREMENTAL_VALUE'
  | 'RFM_SIMPLE_FILTERS_ARE_SUFFICIENT'
  | 'RFM_REQUIRES_T08_T09_ENRICHMENT'
  | 'RFM_REQUIRES_HISTORICAL_LAYER'
  | 'RFM_COHORTES_NOT_ACTIONABLE'
  | 'BLOCKED_BY_DATA_CONTRACT'
  | 'BLOCKED_BY_INSUFFICIENT_EVIDENCE'
  | 'BLOCKED_BY_NEW_TEST_REGRESSION';

export type RfmUseCaseValidationVerdict = {
  readonly primaryVerdict: UseCaseValidationVerdict;
  readonly secondaryConditions: readonly UseCaseValidationVerdict[];
  readonly rationale: readonly string[];
  readonly nextConsumerRecommendation: 'analyst';
  readonly infrastructureDecision: 'FREEZE_PERSISTENCE';
  readonly timezoneStatus: 'UNVERIFIED';
  readonly identityStatus: 'provisional';
};

export type NumberDistribution = {
  readonly count: number;
  readonly min: number | null;
  readonly p25: number | null;
  readonly median: number | null;
  readonly p75: number | null;
  readonly p90: number | null;
  readonly average: string | null;
  readonly max: number | null;
};

export type RfmUseCaseAnalysis = {
  readonly populationSummary: PopulationSummary;
  readonly operationalVsLifetime: OperationalVsLifetimeSummary;
  readonly secondPurchaseAnalysis: SecondPurchaseAnalysis;
  readonly candidateCohorts: CandidateCohorts;
  readonly thresholdSensitivity: ThresholdSensitivity;
  readonly rfmIncrementalValue: readonly RfmIncrementalValueEntry[];
  readonly cohortStability: CohortStability;
  readonly t08T09CrossAnalysis: T08T09CrossAnalysis;
  readonly useCaseValidationVerdict: RfmUseCaseValidationVerdict;
};

type SecondPurchaseMetric = {
  readonly daysFirstToSecondOrder: number | null;
  readonly sameDay: boolean;
};

export function buildRfmUseCaseAnalysis(input: RfmUseCaseAnalysisInput): RfmUseCaseAnalysis {
  parseReferenceTime(input.referenceTime);
  assertNoDuplicateOperationalRows(input.operationalRows);
  assertHistoricalOrders(input.historicalOrders);

  const operationalRows = [...input.operationalRows].sort((a, b) => a.prestashopCustomerId - b.prestashopCustomerId);
  const historicalMetrics = buildLifetimeCustomerMetrics(input.referenceTime, operationalRows, input.historicalOrders);
  const populationSummary = buildPopulationSummary(input, operationalRows, historicalMetrics);
  const operationalVsLifetime = buildOperationalVsLifetimeSummary(input, operationalRows, historicalMetrics);
  const secondPurchaseAnalysis = buildSecondPurchaseAnalysis(input.referenceTime, historicalMetrics, input.historicalOrders);
  const candidateCohorts = buildCandidateCohorts(input, operationalRows, historicalMetrics);
  const thresholdSensitivity = buildThresholdSensitivity(operationalRows);
  const rfmIncrementalValue = buildRfmIncrementalValue(candidateCohorts, secondPurchaseAnalysis);
  const cohortStability = buildCohortStability(input);
  const t08T09CrossAnalysis = buildT08T09CrossAnalysis(input.t08T09SignalsAvailable === true);
  const useCaseValidationVerdict = buildUseCaseValidationVerdict(candidateCohorts, rfmIncrementalValue, historicalMetrics, operationalRows);

  const output = {
    populationSummary,
    operationalVsLifetime,
    secondPurchaseAnalysis,
    candidateCohorts,
    thresholdSensitivity,
    rfmIncrementalValue,
    cohortStability,
    t08T09CrossAnalysis,
    useCaseValidationVerdict,
  };
  assertRfmUseCaseReportHasNoPii(output);
  return output;
}

export function buildLifetimeCustomerMetrics(
  referenceTime: string,
  operationalRows: readonly RfmSnapshotRow[],
  historicalOrders: readonly HistoricalRfmOrderInput[],
): readonly LifetimeCustomerMetrics[] {
  parseReferenceTime(referenceTime);
  const operationalCustomerIds = new Set(operationalRows.map((row) => row.prestashopCustomerId));
  const grouped = groupHistoricalOrders(historicalOrders);
  return Array.from(grouped.entries())
    .map(([prestashopCustomerId, orders]) => {
      const sorted = sortOrders(orders);
      const gross = addRfmDecimals(sorted.map((order) => formatRfmDecimal(order.grossOrderValueTaxIncl)));
      const first = sorted[0];
      const last = sorted.at(-1);
      if (!first || !last) {
        throw new Error('Historical customer group is empty');
      }
      return {
        prestashopCustomerId,
        lifetimeFirstValidOrderAt: canonicalSourceDate(first.validOrderAt),
        lifetimeLastValidOrderAt: canonicalSourceDate(last.validOrderAt),
        lifetimeFrequencyOrders: sorted.length,
        lifetimeGrossOrderValueTaxIncl: gross,
        lifetimeAverageOrderValueTaxIncl: divideRfmDecimal(gross, sorted.length),
        daysSinceLifetimeLastOrder: recencyCalendarDays(referenceTime, last.validOrderAt),
        hasOrderInOperationalWindow: operationalCustomerIds.has(prestashopCustomerId),
      };
    })
    .sort((a, b) => a.prestashopCustomerId - b.prestashopCustomerId);
}

function buildPopulationSummary(
  input: RfmUseCaseAnalysisInput,
  operationalRows: readonly RfmSnapshotRow[],
  lifetimeMetrics: readonly LifetimeCustomerMetrics[],
): PopulationSummary {
  const operationalCustomerCount = operationalRows.length;
  const historicalCustomerCount = lifetimeMetrics.length;
  const historicalOutsideOperationalWindowCount = lifetimeMetrics.filter((row) => !row.hasOrderInOperationalWindow).length;
  const operationalOrderCount = sumNumbers(operationalRows.map((row) => row.frequencyOrders));
  const historicalOrderCount = sumNumbers(lifetimeMetrics.map((row) => row.lifetimeFrequencyOrders));
  const operationalGrossOrderValueTaxIncl = addRfmDecimals(operationalRows.map((row) => row.grossOrderValueTaxIncl));
  const historicalGrossOrderValueTaxIncl = addRfmDecimals(lifetimeMetrics.map((row) => row.lifetimeGrossOrderValueTaxIncl));
  return {
    referenceTime: input.referenceTime,
    calculationVersion: input.calculationVersion,
    operationalCustomerCount,
    historicalCustomerCount,
    historicalOutsideOperationalWindowCount,
    operationalShareOfHistoricalCustomers: ratio(operationalCustomerCount, historicalCustomerCount),
    operationalOrderCount,
    historicalOrderCount,
    operationalGrossOrderValueTaxIncl,
    historicalGrossOrderValueTaxIncl,
    timezoneStatus: 'UNVERIFIED',
    identityResolutionStatus: 'provisional',
    checksum: sha256Stable({
      version: rfmUseCaseAnalysisVersion,
      referenceTime: input.referenceTime,
      calculationVersion: input.calculationVersion,
      operationalCustomerCount,
      historicalCustomerCount,
      historicalOutsideOperationalWindowCount,
      operationalOrderCount,
      historicalOrderCount,
      operationalGrossOrderValueTaxIncl,
      historicalGrossOrderValueTaxIncl,
    }),
  };
}

function buildOperationalVsLifetimeSummary(
  input: RfmUseCaseAnalysisInput,
  operationalRows: readonly RfmSnapshotRow[],
  lifetimeMetrics: readonly LifetimeCustomerMetrics[],
): OperationalVsLifetimeSummary {
  const lifetimeIds = new Set(lifetimeMetrics.map((row) => row.prestashopCustomerId));
  const operationalOnlyCustomerCount = operationalRows.filter((row) => !lifetimeIds.has(row.prestashopCustomerId)).length;
  const historicalOnly = lifetimeMetrics.filter((row) => !row.hasOrderInOperationalWindow);
  const customersInBothLayersCount = lifetimeMetrics.filter((row) => row.hasOrderInOperationalWindow).length;
  return {
    operationalOnlyCustomerCount,
    historicalOnlyCustomerCount: historicalOnly.length,
    customersInBothLayersCount,
    historicalOutsideOperationalWindowCount: historicalOnly.length,
    historicalOutsideOperationalWindowGrossOrderValueTaxIncl: addRfmDecimals(
      historicalOnly.map((row) => row.lifetimeGrossOrderValueTaxIncl),
    ),
    medianDaysSinceLastOrderOutsideOperationalWindow: percentile(
      historicalOnly.map((row) => row.daysSinceLifetimeLastOrder),
      0.5,
    ),
  };
}

function buildSecondPurchaseAnalysis(
  referenceTime: string,
  lifetimeMetrics: readonly LifetimeCustomerMetrics[],
  historicalOrders: readonly HistoricalRfmOrderInput[],
): SecondPurchaseAnalysis {
  const grouped = groupHistoricalOrders(historicalOrders);
  const secondPurchaseMetrics = lifetimeMetrics.map((metric) => {
    const orders = sortOrders(grouped.get(metric.prestashopCustomerId) ?? []);
    return secondPurchaseMetric(referenceTime, orders);
  });
  const days = secondPurchaseMetrics
    .map((metric) => metric.daysFirstToSecondOrder)
    .filter((value): value is number => value !== null);
  const noSecondPurchase = secondPurchaseMetrics.filter((metric) => metric.daysFirstToSecondOrder === null).length;
  const buckets: Record<SecondPurchaseBucket, number> = {
    sameDay: secondPurchaseMetrics.filter((metric) => metric.sameDay).length,
    '1-7 days': days.filter((value) => value >= 1 && value <= 7).length,
    '8-30 days': days.filter((value) => value >= 8 && value <= 30).length,
    '31-60 days': days.filter((value) => value >= 31 && value <= 60).length,
    '61-90 days': days.filter((value) => value >= 61 && value <= 90).length,
    '91-180 days': days.filter((value) => value >= 91 && value <= 180).length,
    '181-365 days': days.filter((value) => value >= 181 && value <= 365).length,
    '>365 days': days.filter((value) => value > 365).length,
    noSecondPurchase,
  };
  return {
    customersWithSecondPurchase: days.length,
    customersWithoutSecondPurchase: noSecondPurchase,
    conversionFromFirstToSecondProxy: ratio(days.length, lifetimeMetrics.length),
    daysFirstToSecondOrder: numberDistribution(days),
    buckets,
    firstPurchaseCohorts: buildFirstPurchaseCohorts(referenceTime, lifetimeMetrics, grouped),
    caveat: 'NOT_CAUSAL_CONVERSION_RATE',
  };
}

function secondPurchaseMetric(referenceTime: string, sortedOrders: readonly HistoricalRfmOrderInput[]): SecondPurchaseMetric {
  if (sortedOrders.length < 2) return { daysFirstToSecondOrder: null, sameDay: false };
  const first = sortedOrders[0]!;
  const second = sortedOrders[1]!;
  const firstDayRecency = recencyCalendarDays(referenceTime, first.validOrderAt);
  const secondDayRecency = recencyCalendarDays(referenceTime, second.validOrderAt);
  const daysFirstToSecondOrder = firstDayRecency - secondDayRecency;
  return { daysFirstToSecondOrder, sameDay: daysFirstToSecondOrder === 0 };
}

function buildFirstPurchaseCohorts(
  referenceTime: string,
  lifetimeMetrics: readonly LifetimeCustomerMetrics[],
  groupedOrders: ReadonlyMap<number, readonly HistoricalRfmOrderInput[]>,
): readonly FirstPurchaseCohortSummary[] {
  const referenceDate = parseReferenceTime(referenceTime);
  const grouped = new Map<string, LifetimeCustomerMetrics[]>();
  for (const metric of lifetimeMetrics) {
    const month = metric.lifetimeFirstValidOrderAt.slice(0, 7);
    grouped.set(month, [...(grouped.get(month) ?? []), metric]);
  }
  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cohortMonth, metrics]) => {
      const firstOfMonth = new Date(`${cohortMonth}-01T00:00:00.000Z`);
      const matured365DayObservation = referenceDate.getTime() - firstOfMonth.getTime() >= 365 * 86_400_000;
      const customersWithObservedSecondPurchase = metrics.filter((metric) => {
        const orders = groupedOrders.get(metric.prestashopCustomerId) ?? [];
        return orders.length >= 2;
      }).length;
      return {
        cohortMonth,
        customerCount: metrics.length,
        matured365DayObservation,
        customersWithObservedSecondPurchase,
        notYetObservedCount: matured365DayObservation ? 0 : metrics.length - customersWithObservedSecondPurchase,
        noSecondPurchaseObservedCount: matured365DayObservation ? metrics.length - customersWithObservedSecondPurchase : 0,
      };
    });
}

function buildCandidateCohorts(
  input: RfmUseCaseAnalysisInput,
  operationalRows: readonly RfmSnapshotRow[],
  lifetimeMetrics: readonly LifetimeCustomerMetrics[],
): CandidateCohorts {
  const recentFirstPurchase = Object.fromEntries(
    [30, 60, 90].map((threshold) => {
      const rows = operationalRows.filter((row) => {
        const lifetime = lifetimeMetrics.find((metric) => metric.prestashopCustomerId === row.prestashopCustomerId);
        return lifetime?.lifetimeFrequencyOrders === 1 && row.frequencyOrders === 1 && row.recencyDays <= threshold;
      });
      const cohortId = `recent_first_purchase_${threshold}d_candidate`;
      return [
        cohortId,
        {
          cohortId,
          customerCount: rows.length,
          historicalPopulationShare: ratio(rows.length, lifetimeMetrics.length),
          operationalPopulationShare: ratio(rows.length, operationalRows.length),
          grossMonetary: addRfmDecimals(rows.map((row) => row.grossOrderValueTaxIncl)),
          averageOrderValue: divideRfmDecimal(addRfmDecimals(rows.map((row) => row.grossOrderValueTaxIncl)), rows.length),
          medianOrderValue: medianDecimal(rows.map((row) => row.grossOrderValueTaxIncl)),
          shopDistribution: buildShopDistribution(rows.map((row) => row.prestashopCustomerId), input.historicalOrders, input.referenceTime, true),
        } satisfies RecentFirstPurchaseCohort,
      ];
    }),
  );

  const repeatCustomer = Object.fromEntries(
    [2, 3, 4].map((threshold) => {
      const rows = operationalRows.filter((row) => row.frequencyOrders >= threshold);
      const cohortId = `repeat_customer_${threshold}_plus_candidate`;
      return [
        cohortId,
        {
          cohortId,
          customerCount: rows.length,
          historicalPopulationShare: ratio(rows.length, lifetimeMetrics.length),
          operationalPopulationShare: ratio(rows.length, operationalRows.length),
          orderShare: ratio(sumNumbers(rows.map((row) => row.frequencyOrders)), sumNumbers(operationalRows.map((row) => row.frequencyOrders))),
          grossMonetaryShare: decimalRatio(
            addRfmDecimals(rows.map((row) => row.grossOrderValueTaxIncl)),
            addRfmDecimals(operationalRows.map((row) => row.grossOrderValueTaxIncl)),
          ),
          averageOrderValue: divideRfmDecimal(addRfmDecimals(rows.map((row) => row.grossOrderValueTaxIncl)), sumNumbers(rows.map((row) => row.frequencyOrders))),
          medianRecency: percentile(rows.map((row) => row.recencyDays), 0.5),
        } satisfies RepeatCustomerCohort,
      ];
    }),
  );

  const highGrossPurchaseValueActive = Object.fromEntries(
    [
      ['monetary_score_5', operationalRows.filter((row) => row.monetaryScore === 5)],
      ['top_20_percent_gross_monetary', topPercentRows(operationalRows, 0.2)],
      ['top_10_percent_gross_monetary', topPercentRows(operationalRows, 0.1)],
      ['top_5_percent_gross_monetary', topPercentRows(operationalRows, 0.05)],
    ].map(([suffix, rows]) => {
      const selected = rows as readonly RfmSnapshotRow[];
      const cohortId = `high_gross_purchase_value_active_${suffix}_candidate`;
      return [
        cohortId,
        {
          cohortId,
          customerCount: selected.length,
          historicalPopulationShare: ratio(selected.length, lifetimeMetrics.length),
          operationalPopulationShare: ratio(selected.length, operationalRows.length),
          grossMonetaryShare: decimalRatio(
            addRfmDecimals(selected.map((row) => row.grossOrderValueTaxIncl)),
            addRfmDecimals(operationalRows.map((row) => row.grossOrderValueTaxIncl)),
          ),
          frequencyDistribution: numberDistribution(selected.map((row) => row.frequencyOrders)),
          recencyDistribution: numberDistribution(selected.map((row) => row.recencyDays)),
          shopDistribution: buildShopDistribution(selected.map((row) => row.prestashopCustomerId), input.historicalOrders, input.referenceTime, true),
        } satisfies HighGrossActiveCohort,
      ];
    }),
  );

  const activeRepeatHighGross = Object.fromEntries(
    [
      ['r4_f4_m4_plus', operationalRows.filter((row) => row.recencyScore >= 4 && row.frequencyScore >= 4 && row.monetaryScore >= 4)],
      ['r5_f5_m5', operationalRows.filter((row) => row.recencyScore === 5 && row.frequencyScore === 5 && row.monetaryScore === 5)],
    ].map(([suffix, rows]) => {
      const selected = rows as readonly RfmSnapshotRow[];
      const cohortId = `active_repeat_high_gross_${suffix}_candidate`;
      return [
        cohortId,
        {
          cohortId,
          customerCount: selected.length,
          historicalPopulationShare: ratio(selected.length, lifetimeMetrics.length),
          operationalPopulationShare: ratio(selected.length, operationalRows.length),
          orderShare: ratio(sumNumbers(selected.map((row) => row.frequencyOrders)), sumNumbers(operationalRows.map((row) => row.frequencyOrders))),
          grossMonetaryShare: decimalRatio(
            addRfmDecimals(selected.map((row) => row.grossOrderValueTaxIncl)),
            addRfmDecimals(operationalRows.map((row) => row.grossOrderValueTaxIncl)),
          ),
          maximumFrequency: maxNumber(selected.map((row) => row.frequencyOrders)),
          outlierSensitivity: {
            excludingFrequencyAbove100: selected.filter((row) => row.frequencyOrders <= 100).length,
            excludingFrequencyAbove500: selected.filter((row) => row.frequencyOrders <= 500).length,
          },
        } satisfies ActiveRepeatHighGrossCohort,
      ];
    }),
  );

  const inactive = lifetimeMetrics.filter((row) => !row.hasOrderInOperationalWindow);
  const historicallyHighGrossInactive = Object.fromEntries(
    [
      ['top_20_percent', 0.2],
      ['top_10_percent', 0.1],
      ['top_5_percent', 0.05],
    ].map(([suffix, percent]) => {
      const selected = topPercentLifetimeRows(inactive, percent as number);
      const cohortId = `historically_high_gross_inactive_${suffix}_candidate`;
      return [
        cohortId,
        {
          cohortId,
          threshold: suffix as string,
          customerCount: selected.length,
          historicalPopulationShare: ratio(selected.length, lifetimeMetrics.length),
          lifetimeGrossMonetaryShare: decimalRatio(
            addRfmDecimals(selected.map((row) => row.lifetimeGrossOrderValueTaxIncl)),
            addRfmDecimals(lifetimeMetrics.map((row) => row.lifetimeGrossOrderValueTaxIncl)),
          ),
          medianDaysSinceLastOrder: percentile(selected.map((row) => row.daysSinceLifetimeLastOrder), 0.5),
          p75DaysSinceLastOrder: percentile(selected.map((row) => row.daysSinceLifetimeLastOrder), 0.75),
          shopDistribution: buildShopDistribution(selected.map((row) => row.prestashopCustomerId), input.historicalOrders, input.referenceTime, false),
        } satisfies HistoricallyHighGrossInactiveCohort,
      ];
    }),
  );

  const frequencyOutlierReview = buildFrequencyOutlierReview(operationalRows);

  return {
    recentFirstPurchase,
    repeatCustomer,
    highGrossPurchaseValueActive,
    activeRepeatHighGross,
    historicallyHighGrossInactive,
    frequencyOutlierReview,
    actionability: buildActionability(input, operationalRows, lifetimeMetrics, {
      recentFirstPurchase,
      repeatCustomer,
      highGrossPurchaseValueActive,
      activeRepeatHighGross,
      historicallyHighGrossInactive,
      frequencyOutlierReview,
    }),
  };
}

function buildFrequencyOutlierReview(operationalRows: readonly RfmSnapshotRow[]): Record<string, FrequencyOutlierCohort> {
  const totalOrders = sumNumbers(operationalRows.map((row) => row.frequencyOrders));
  const totalGross = addRfmDecimals(operationalRows.map((row) => row.grossOrderValueTaxIncl));
  const definitions: Array<readonly [string, readonly RfmSnapshotRow[]]> = [
    ['frequency_gt_100', operationalRows.filter((row) => row.frequencyOrders > 100)],
    ['frequency_gt_500', operationalRows.filter((row) => row.frequencyOrders > 500)],
    ['frequency_top_0_1_percent', topPercentByFrequency(operationalRows, 0.001)],
  ];
  return Object.fromEntries(
    definitions.map(([suffix, rows]) => {
      const ids = new Set(rows.map((row) => row.prestashopCustomerId));
      const without = operationalRows.filter((row) => !ids.has(row.prestashopCustomerId));
      const cohortId = `frequency_outlier_review_${suffix}`;
      return [
        cohortId,
        {
          cohortId,
          customerCount: rows.length,
          orderShare: ratio(sumNumbers(rows.map((row) => row.frequencyOrders)), totalOrders),
          grossMonetaryShare: decimalRatio(addRfmDecimals(rows.map((row) => row.grossOrderValueTaxIncl)), totalGross),
          impactOnFrequencyDistribution: {
            maximumFrequencyWithOutliers: maxNumber(operationalRows.map((row) => row.frequencyOrders)),
            maximumFrequencyWithoutCohort: maxNumber(without.map((row) => row.frequencyOrders)),
          },
          impactOnCandidateCohorts: {
            activeRepeatHighGross444Excluded: rows.filter((row) => row.recencyScore >= 4 && row.frequencyScore >= 4 && row.monetaryScore >= 4).length,
            activeRepeatHighGross555Excluded: rows.filter((row) => row.recencyScore === 5 && row.frequencyScore === 5 && row.monetaryScore === 5).length,
          },
        } satisfies FrequencyOutlierCohort,
      ];
    }),
  );
}

function buildThresholdSensitivity(operationalRows: readonly RfmSnapshotRow[]): ThresholdSensitivity {
  const totalOrders = sumNumbers(operationalRows.map((row) => row.frequencyOrders));
  const totalGross = addRfmDecimals(operationalRows.map((row) => row.grossOrderValueTaxIncl));
  const entry = (rows: readonly RfmSnapshotRow[]): SensitivityEntry => ({
    customerCount: rows.length,
    populationShare: ratio(rows.length, operationalRows.length),
    orderShare: ratio(sumNumbers(rows.map((row) => row.frequencyOrders)), totalOrders),
    grossMonetaryShare: decimalRatio(addRfmDecimals(rows.map((row) => row.grossOrderValueTaxIncl)), totalGross),
  });
  return {
    recency: Object.fromEntries([30, 60, 90, 180, 365].map((days) => [`recency_lte_${days}`, entry(operationalRows.filter((row) => row.recencyDays <= days))])),
    frequency: Object.fromEntries([2, 3, 4, 6].map((count) => [`frequency_gte_${count}`, entry(operationalRows.filter((row) => row.frequencyOrders >= count))])),
    monetary: Object.fromEntries(
      [
        ['p80', 0.2],
        ['p90', 0.1],
        ['p95', 0.05],
      ].map(([name, percent]) => [`monetary_${name}`, entry(topPercentRows(operationalRows, percent as number))]),
    ),
  };
}

function buildRfmIncrementalValue(
  cohorts: CandidateCohorts,
  secondPurchaseAnalysis: SecondPurchaseAnalysis,
): readonly RfmIncrementalValueEntry[] {
  const recent30 = cohorts.recentFirstPurchase.recent_first_purchase_30d_candidate;
  const highGross = cohorts.highGrossPurchaseValueActive.high_gross_purchase_value_active_monetary_score_5_candidate;
  const inactive = cohorts.historicallyHighGrossInactive.historically_high_gross_inactive_top_10_percent_candidate;
  return [
    {
      useCase: 'recent_first_purchase_second_purchase_followup',
      simpleFilterBaseline: 'frequency = 1 AND recency <= 30 days',
      rfmEnrichment: 'R score and M score add relative value context for prioritization',
      additionalValue: recent30 && recent30.customerCount > 0 ? 'limited relative prioritization beyond the simple filter' : 'insufficient current cohort size',
      complexity: 'low',
      verdict: recent30 && recent30.customerCount > 0 ? 'RFM_ADDS_LIMITED_VALUE' : 'INSUFFICIENT_EVIDENCE',
    },
    {
      useCase: 'second_purchase_timing',
      simpleFilterBaseline: 'lifetimeFrequencyOrders >= 2',
      rfmEnrichment: 'RFM does not explain first-to-second timing without historical order sequence',
      additionalValue: secondPurchaseAnalysis.customersWithSecondPurchase > 0 ? 'historical layer adds more value than RFM scores' : 'insufficient second purchase evidence',
      complexity: 'medium',
      verdict: secondPurchaseAnalysis.customersWithSecondPurchase > 0 ? 'SIMPLE_FILTER_IS_SUFFICIENT' : 'INSUFFICIENT_EVIDENCE',
    },
    {
      useCase: 'high_gross_active_prioritization',
      simpleFilterBaseline: 'gross monetary top percentile',
      rfmEnrichment: 'M score gives population-relative value and can combine with R/F',
      additionalValue: highGross && highGross.customerCount > 0 ? 'meaningful when combined with recency and frequency' : 'insufficient current cohort size',
      complexity: 'medium',
      verdict: highGross && highGross.customerCount > 0 ? 'RFM_ADDS_MEANINGFUL_VALUE' : 'INSUFFICIENT_EVIDENCE',
    },
    {
      useCase: 'historically_high_gross_inactive_reactivation',
      simpleFilterBaseline: 'no order in 365 days AND lifetime gross top percentile',
      rfmEnrichment: 'operational RFM has no row for inactive customers',
      additionalValue: inactive && inactive.customerCount > 0 ? 'requires historical layer, not operational RFM alone' : 'insufficient inactive high gross evidence',
      complexity: 'medium',
      verdict: inactive && inactive.customerCount > 0 ? 'RFM_ADDS_LIMITED_VALUE' : 'INSUFFICIENT_EVIDENCE',
    },
    {
      useCase: 'product_interpretation_for_cohorts',
      simpleFilterBaseline: 'RFM cohort only',
      rfmEnrichment: 'requires purchased products/product behavior to interpret product needs',
      additionalValue: 'RFM prioritizes customers but does not explain products',
      complexity: 'high',
      verdict: 'REQUIRES_T08_T09',
    },
  ];
}

function buildCohortStability(input: RfmUseCaseAnalysisInput): CohortStability {
  const snapshots = (input.stabilitySnapshots ?? []).map((snapshot) => {
    const analysis = buildRfmUseCaseAnalysis({
      referenceTime: snapshot.referenceTime,
      calculationVersion: input.calculationVersion,
      operationalRows: snapshot.operationalRows,
      historicalOrders: snapshot.historicalOrders,
      stabilitySnapshots: [],
      t08T09SignalsAvailable: input.t08T09SignalsAvailable,
    });
    return {
      referenceTime: snapshot.referenceTime,
      operationalCustomerCount: analysis.populationSummary.operationalCustomerCount,
      recentFirstPurchase30dCustomerCount:
        analysis.candidateCohorts.recentFirstPurchase.recent_first_purchase_30d_candidate?.customerCount ?? 0,
      repeatCustomer2PlusCustomerCount:
        analysis.candidateCohorts.repeatCustomer.repeat_customer_2_plus_candidate?.customerCount ?? 0,
      highGrossM5CustomerCount:
        analysis.candidateCohorts.highGrossPurchaseValueActive.high_gross_purchase_value_active_monetary_score_5_candidate?.customerCount ?? 0,
      activeRepeatHighGross444CustomerCount:
        analysis.candidateCohorts.activeRepeatHighGross.active_repeat_high_gross_r4_f4_m4_plus_candidate?.customerCount ?? 0,
      historicallyHighGrossInactiveTop10CustomerCount:
        analysis.candidateCohorts.historicallyHighGrossInactive.historically_high_gross_inactive_top_10_percent_candidate?.customerCount ?? 0,
    };
  });
  return {
    warning: 'HISTORICAL_RECALCULATION_SOURCE_IS_MUTABLE',
    snapshots,
  };
}

function buildT08T09CrossAnalysis(signalsAvailable: boolean): T08T09CrossAnalysis {
  if (!signalsAvailable) {
    const unavailable = (reason: string): CrossSignalStatus => ({ status: 'CROSS_SIGNAL_UNAVAILABLE', reason });
    return {
      recentFirstPurchaseT08: unavailable('T08 is a runtime per-customer contract; no batch-safe cross-signal input was provided. Product families are not exposed.'),
      repeatCustomerT09: unavailable('T09 fields exist per customer, but no normalized batch input was provided to this analysis.'),
      highGrossValueT09: unavailable('High gross interpretation needs T09 concentration/diversity fields as input; RFM must not duplicate them.'),
      historicallyHighGrossInactiveT08T09: unavailable('Inactive product interpretation needs T08/T09 inputs joined outside the RFM runtime contract.'),
    };
  }
  return {
    recentFirstPurchaseT08: {
      status: 'CONTRACT_FIELDS_AVAILABLE_FOR_FUTURE_JOIN',
      fields: ['distinctPurchasedProductCount', 'variantCount'],
    },
    repeatCustomerT09: {
      status: 'CONTRACT_FIELDS_AVAILABLE_FOR_FUTURE_JOIN',
      fields: ['repeatProductRate', 'effectiveDiversity', 'hhi', 'top1Share', 'distinctProductCount', 'distinctVariantCount'],
    },
    highGrossValueT09: {
      status: 'CONTRACT_FIELDS_AVAILABLE_FOR_FUTURE_JOIN',
      fields: ['productSpendConcentration', 'variantSpendConcentration', 'topProducts', 'topVariants'],
    },
    historicallyHighGrossInactiveT08T09: {
      status: 'CONTRACT_FIELDS_AVAILABLE_FOR_FUTURE_JOIN',
      fields: ['repeatedProductCount', 'repeatProductRate', 'effectiveDiversity', 'topProductSpendShare'],
    },
  };
}

function buildUseCaseValidationVerdict(
  cohorts: CandidateCohorts,
  incrementalValue: readonly RfmIncrementalValueEntry[],
  lifetimeMetrics: readonly LifetimeCustomerMetrics[],
  operationalRows: readonly RfmSnapshotRow[],
): RfmUseCaseValidationVerdict {
  const meaningful = incrementalValue.filter((entry) => entry.verdict === 'RFM_ADDS_MEANINGFUL_VALUE').length;
  const limited = incrementalValue.filter((entry) => entry.verdict === 'RFM_ADDS_LIMITED_VALUE').length;
  const requiresT08T09 = incrementalValue.some((entry) => entry.verdict === 'REQUIRES_T08_T09');
  const hasHistoricalOutside = lifetimeMetrics.some((row) => !row.hasOrderInOperationalWindow);
  const populatedCandidateCount = [
    cohorts.recentFirstPurchase.recent_first_purchase_30d_candidate?.customerCount ?? 0,
    cohorts.repeatCustomer.repeat_customer_2_plus_candidate?.customerCount ?? 0,
    cohorts.highGrossPurchaseValueActive.high_gross_purchase_value_active_monetary_score_5_candidate?.customerCount ?? 0,
    cohorts.activeRepeatHighGross.active_repeat_high_gross_r4_f4_m4_plus_candidate?.customerCount ?? 0,
    cohorts.historicallyHighGrossInactive.historically_high_gross_inactive_top_10_percent_candidate?.customerCount ?? 0,
  ].filter((count) => count > 0).length;

  let primaryVerdict: UseCaseValidationVerdict = 'BLOCKED_BY_INSUFFICIENT_EVIDENCE';
  if (meaningful >= 1 && limited >= 1 && populatedCandidateCount >= 2 && operationalRows.length > 0) {
    primaryVerdict = 'RFM_USE_CASES_VALIDATED';
  } else if (meaningful + limited > 0) {
    primaryVerdict = 'RFM_ADDS_LIMITED_INCREMENTAL_VALUE';
  }

  return {
    primaryVerdict,
    secondaryConditions: [
      ...(hasHistoricalOutside ? (['RFM_REQUIRES_HISTORICAL_LAYER'] as const) : []),
      ...(requiresT08T09 ? (['RFM_REQUIRES_T08_T09_ENRICHMENT'] as const) : []),
    ],
    rationale: [
      'Operational RFM is useful for active-customer prioritization, not definitive commercial segmentation.',
      'Second purchase and reactivation require a historical layer separate from the 365-day operational RFM population.',
      'Product interpretation requires T08/T09 signals and cannot be inferred from RFM.',
    ],
    nextConsumerRecommendation: 'analyst',
    infrastructureDecision: 'FREEZE_PERSISTENCE',
    timezoneStatus: 'UNVERIFIED',
    identityStatus: 'provisional',
  };
}

function buildActionability(
  input: RfmUseCaseAnalysisInput,
  operationalRows: readonly RfmSnapshotRow[],
  lifetimeMetrics: readonly LifetimeCustomerMetrics[],
  cohorts: Omit<CandidateCohorts, 'actionability'>,
): readonly CohortActionability[] {
  const totalOperationalOrders = sumNumbers(operationalRows.map((row) => row.frequencyOrders));
  const totalOperationalGross = addRfmDecimals(operationalRows.map((row) => row.grossOrderValueTaxIncl));
  const totalLifetimeGross = addRfmDecimals(lifetimeMetrics.map((row) => row.lifetimeGrossOrderValueTaxIncl));
  const action = (
    cohortId: string,
    definition: string,
    customerCount: number,
    populationShare: string,
    orderShare: string | null,
    grossMonetaryShare: string | null,
    interpretation: string,
    possibleCommercialAction: string,
    requiredAdditionalSignals: readonly string[],
    automationReadiness: CohortActionability['automationReadiness'],
  ): CohortActionability => ({
    cohortId,
    definition,
    calculationVersion: input.calculationVersion,
    referenceTime: input.referenceTime,
    customerCount,
    populationShare,
    orderShare,
    grossMonetaryShare,
    interpretation,
    possibleCommercialAction,
    requiredAdditionalSignals,
    risks: ['gross tax-incl monetary', 'timezoneStatus UNVERIFIED', 'provisional identity', 'mutable source', 'candidate scores only'],
    automationReadiness,
    requiresProductHistory: requiredAdditionalSignals.includes('purchased products') || requiredAdditionalSignals.includes('product behavior'),
    requiresCurrentIntent: true,
    requiresOpportunityContext: true,
    requiresConsent: true,
    requiresHumanReview: true,
  });

  const recent = cohorts.recentFirstPurchase.recent_first_purchase_30d_candidate;
  const repeat = cohorts.repeatCustomer.repeat_customer_2_plus_candidate;
  const highGross = cohorts.highGrossPurchaseValueActive.high_gross_purchase_value_active_monetary_score_5_candidate;
  const inactive = cohorts.historicallyHighGrossInactive.historically_high_gross_inactive_top_10_percent_candidate;
  const outlier = cohorts.frequencyOutlierReview.frequency_outlier_review_frequency_gt_100;
  return [
    action(
      'recent_first_purchase_30d_candidate',
      'lifetimeFrequencyOrders = 1 AND operationalFrequencyOrders = 1 AND operationalRecencyDays <= 30',
      recent?.customerCount ?? 0,
      recent?.historicalPopulationShare ?? '0.000000',
      null,
      recent ? decimalRatio(recent.grossMonetary, totalOperationalGross) : '0.000000',
      'recent single-purchase customers may be candidates for second-purchase follow-up',
      'evaluar seguimiento orientado a segunda compra',
      ['purchased products', 'product lifecycle', 'current opportunity', 'exclusions'],
      'HUMAN_REVIEW_CANDIDATE',
    ),
    action(
      'second_purchase_achieved_candidate',
      'lifetimeFrequencyOrders >= 2',
      lifetimeMetrics.filter((row) => row.lifetimeFrequencyOrders >= 2).length,
      ratio(lifetimeMetrics.filter((row) => row.lifetimeFrequencyOrders >= 2).length, lifetimeMetrics.length),
      null,
      null,
      'customers with observed repeat purchase support recurrence pattern analysis',
      'identificar patrones asociados a recurrencia',
      ['purchased products', 'product behavior', 'cohort maturity'],
      'ANALYSIS_ONLY',
    ),
    action(
      'repeat_customer_2_plus_candidate',
      'operationalFrequencyOrders >= 2',
      repeat?.customerCount ?? 0,
      repeat?.operationalPopulationShare ?? '0.000000',
      repeat?.orderShare ?? ratio(0, totalOperationalOrders),
      repeat?.grossMonetaryShare ?? '0.000000',
      'active repeat customers are commercially distinct from one-time buyers',
      'fidelizacion o atencion diferenciada',
      ['product behavior', 'current opportunity'],
      'HUMAN_REVIEW_CANDIDATE',
    ),
    action(
      'high_gross_purchase_value_active_candidate',
      'monetaryScore = 5',
      highGross?.customerCount ?? 0,
      highGross?.operationalPopulationShare ?? '0.000000',
      null,
      highGross?.grossMonetaryShare ?? '0.000000',
      'high gross active customers concentrate purchase value but not necessarily margin',
      'priorizacion humana y revision de necesidades',
      ['purchased products', 'product behavior', 'margin if ever available'],
      'HUMAN_REVIEW_CANDIDATE',
    ),
    action(
      'historically_high_gross_inactive_top_10_percent_candidate',
      'outside operational window AND lifetimeGrossOrderValueTaxIncl in top 10 percent',
      inactive?.customerCount ?? 0,
      inactive?.historicalPopulationShare ?? '0.000000',
      null,
      inactive?.lifetimeGrossMonetaryShare ?? decimalRatio('0.000000', totalLifetimeGross),
      'historically relevant inactive customers require lifetime context outside operational RFM',
      'reactivacion revisada',
      ['purchased products', 'product behavior', 'consent', 'current intent'],
      'HUMAN_REVIEW_CANDIDATE',
    ),
    action(
      'frequency_outlier_review_frequency_gt_100',
      'operationalFrequencyOrders > 100',
      outlier?.customerCount ?? 0,
      ratio(outlier?.customerCount ?? 0, operationalRows.length),
      outlier?.orderShare ?? '0.000000',
      outlier?.grossMonetaryShare ?? '0.000000',
      'extreme frequency can distort frequency interpretation and needs manual review',
      'revision manual antes de usar en segmentacion',
      ['operational account review'],
      'ANALYSIS_ONLY',
    ),
  ];
}

function buildShopDistribution(
  customerIds: readonly number[],
  historicalOrders: readonly HistoricalRfmOrderInput[],
  referenceTime: string,
  operationalWindowOnly: boolean,
): readonly ShopDistributionEntry[] {
  const selected = new Set(customerIds);
  const reference = parseReferenceTime(referenceTime);
  const windowStart = new Date(reference.getTime() - 365 * 86_400_000);
  const byShop = new Map<number, HistoricalRfmOrderInput[]>();
  for (const order of historicalOrders) {
    if (!selected.has(order.prestashopCustomerId)) continue;
    const date = parseSourceDate(order.validOrderAt);
    if (operationalWindowOnly && (date.getTime() < windowStart.getTime() || date.getTime() >= reference.getTime())) continue;
    byShop.set(order.shopId, [...(byShop.get(order.shopId) ?? []), order]);
  }
  return Array.from(byShop.entries())
    .sort(([a], [b]) => a - b)
    .map(([shopId, orders]) => ({
      shopId,
      customerCount: new Set(orders.map((order) => order.prestashopCustomerId)).size,
      orderCount: orders.length,
      grossOrderValueTaxIncl: addRfmDecimals(orders.map((order) => formatRfmDecimal(order.grossOrderValueTaxIncl))),
    }));
}

function topPercentRows(rows: readonly RfmSnapshotRow[], percent: number): readonly RfmSnapshotRow[] {
  const count = Math.ceil(rows.length * percent);
  return [...rows].sort((a, b) => compareRfmDecimalAsc(b.grossOrderValueTaxIncl, a.grossOrderValueTaxIncl)).slice(0, count);
}

function topPercentByFrequency(rows: readonly RfmSnapshotRow[], percent: number): readonly RfmSnapshotRow[] {
  const count = Math.max(1, Math.ceil(rows.length * percent));
  return [...rows].sort((a, b) => b.frequencyOrders - a.frequencyOrders).slice(0, count);
}

function topPercentLifetimeRows(rows: readonly LifetimeCustomerMetrics[], percent: number): readonly LifetimeCustomerMetrics[] {
  const count = Math.ceil(rows.length * percent);
  return [...rows].sort((a, b) => compareRfmDecimalAsc(b.lifetimeGrossOrderValueTaxIncl, a.lifetimeGrossOrderValueTaxIncl)).slice(0, count);
}

function groupHistoricalOrders(orders: readonly HistoricalRfmOrderInput[]): Map<number, readonly HistoricalRfmOrderInput[]> {
  const grouped = new Map<number, HistoricalRfmOrderInput[]>();
  for (const order of orders) {
    grouped.set(order.prestashopCustomerId, [...(grouped.get(order.prestashopCustomerId) ?? []), order]);
  }
  return grouped;
}

function sortOrders(orders: readonly HistoricalRfmOrderInput[]): readonly HistoricalRfmOrderInput[] {
  return [...orders].sort((a, b) => {
    const byDate = canonicalSourceDate(a.validOrderAt).localeCompare(canonicalSourceDate(b.validOrderAt));
    return byDate === 0 ? a.orderId - b.orderId : byDate;
  });
}

function assertNoDuplicateOperationalRows(rows: readonly RfmSnapshotRow[]): void {
  const seen = new Set<number>();
  for (const row of rows) {
    if (seen.has(row.prestashopCustomerId)) {
      throw new Error('RFM use-case analysis received duplicate operational customer rows');
    }
    seen.add(row.prestashopCustomerId);
  }
}

function assertHistoricalOrders(orders: readonly HistoricalRfmOrderInput[]): void {
  const seenOrders = new Set<number>();
  for (const order of orders) {
    if (!Number.isSafeInteger(order.prestashopCustomerId) || order.prestashopCustomerId <= 0) {
      throw new Error('RFM use-case analysis received invalid prestashopCustomerId');
    }
    if (!Number.isSafeInteger(order.orderId) || order.orderId <= 0) {
      throw new Error('RFM use-case analysis received invalid orderId');
    }
    if (seenOrders.has(order.orderId)) {
      throw new Error('RFM use-case analysis requires one row per order');
    }
    seenOrders.add(order.orderId);
    formatRfmDecimal(order.grossOrderValueTaxIncl);
    canonicalSourceDate(order.validOrderAt);
  }
}

function numberDistribution(values: readonly number[]): NumberDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    average: sorted.length === 0 ? null : (sumNumbers(sorted) / sorted.length).toFixed(6),
    max: sorted.at(-1) ?? null,
  };
}

function medianDecimal(values: readonly string[]): string | null {
  const sorted = [...values].sort(compareRfmDecimalAsc);
  if (sorted.length === 0) return null;
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

function percentile(values: readonly number[], fraction: number): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.ceil(Math.min(Math.max(fraction, 0), 1) * sorted.length) - 1;
  return sorted[Math.max(index, 0)]!;
}

function maxNumber(values: readonly number[]): number | null {
  return values.length === 0 ? null : Math.max(...values);
}

function sumNumbers(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function ratio(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0.000000';
  return (numerator / denominator).toFixed(6);
}

function decimalRatio(numerator: string, denominator: string): string {
  const denominatorScaled = toScaled(formatRfmDecimal(denominator));
  if (denominatorScaled === 0n) return '0.000000';
  const numeratorScaled = toScaled(formatRfmDecimal(numerator));
  return formatSignedScaled((numeratorScaled * 1_000_000n + denominatorScaled / 2n) / denominatorScaled);
}

function toScaled(value: string): bigint {
  const [whole, fractional = ''] = value.split('.');
  return BigInt(`${whole}${fractional.padEnd(6, '0').slice(0, 6)}`);
}

function formatSignedScaled(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const raw = absolute.toString().padStart(7, '0');
  return `${sign}${raw.slice(0, -6)}.${raw.slice(-6)}`;
}

function canonicalSourceDate(value: string): string {
  return parseSourceDate(value).toISOString().slice(0, 19).replace('T', ' ');
}

function parseSourceDate(value: string): Date {
  const parsed = new Date(`${value.replace(' ', 'T').replace(/Z$/, '')}Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid RFM source date: ${value}`);
  }
  return parsed;
}

export function assertRfmUseCaseReportHasNoPii(report: unknown): void {
  assertNoPii(report, 'report');
}

function assertNoPii(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPii(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (isForbiddenReportKey(key)) {
        throw new Error(`RFM use-case report contains a forbidden field: ${path}.${key}`);
      }
      assertNoPii(entry, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && isForbiddenReportString(value)) {
    throw new Error(`RFM use-case report contains a PII-shaped value at ${path}`);
  }
}

function isForbiddenReportKey(key: string): boolean {
  const normalized = key.replace(/[_\-\s]/g, '').toLowerCase();
  return [
    'prestashopcustomerid',
    'mastercustomerid',
    'customerids',
    'orderid',
    'orderids',
    'email',
    'phone',
    'telefono',
    'rut',
    'dni',
    'document',
    'firstname',
    'lastname',
    'address',
    'street',
    'payload',
  ].some((forbidden) => normalized.includes(forbidden));
}

function isForbiddenReportString(value: string): boolean {
  const trimmed = value.trim();
  if (
    /^\d+\.\d{6}$/.test(trimmed) ||
    /^[a-f0-9]{64}$/i.test(trimmed) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(trimmed)
  ) {
    return false;
  }
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(trimmed) || /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/.test(trimmed);
}

export function scoreLike(value: number): RfmScore {
  if (![1, 2, 3, 4, 5].includes(value)) {
    throw new Error('Invalid score');
  }
  return value as RfmScore;
}
