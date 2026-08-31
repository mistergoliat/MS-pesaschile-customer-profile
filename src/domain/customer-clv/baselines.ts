import { addDecimals, compareDecimalAsc, divideDecimal, formatDecimal } from '../../shared/decimal.js';
import { sha256Stable } from '../customer-rfm/checksum.js';
import type { CustomerClvBacktestDataset, CustomerClvBacktestExample } from './dataset.js';

export const CUSTOMER_CLV_BASELINE_EVALUATION_VERSION = 'customer-clv-baseline-evaluation-v1';
export const CUSTOMER_CLV_TRAINING_PROTOCOL_VERSION = 'customer-clv-training-label-window-known-by-eval-cutoff-v1';
export const CUSTOMER_CLV_DET_TIEBREAK_POLICY_VERSION = 'customer-clv-prediction-desc-customerid-asc-v1';
export const CUSTOMER_CLV_COHORT_MIN_SUPPORT = 25;
export const CUSTOMER_CLV_COHORT_FALLBACK_POLICY_VERSION = 'customer-clv-cohort-fallback-exact-to-broader-to-global-v1';
export const CUSTOMER_CLV_LIFETIME_RATE_SHRINKAGE_MONTHS = 6;
export const CUSTOMER_CLV_ORDER_RATE_SHRINKAGE_YEARS = 1;
export const CUSTOMER_CLV_RFM_BUCKET_MIN_SUPPORT = 25;

export type CustomerClvBaselineId =
  | 'global-mean-v1'
  | 'global-activity-x-conditional-mean-v1'
  | 'historical-12m-revenue-v1'
  | 'lifetime-monthly-rate-shrunk-v1'
  | 'aov-x-order-rate-v1'
  | 'recency-adjusted-projection-v1'
  | 'rfm-segment-median-v1'
  | 'cutoff-safe-rfm-bucket-median-v1'
  | 'simple-cohort-prior-v1';

export type CustomerClvBacktestPrediction = {
  readonly customerId: number;
  readonly cutoffTime: string;
  readonly predictedRevenueTaxIncl: string;
  readonly predictedOrders?: string;
  readonly predictedActiveProbability?: string;
  readonly modelId: CustomerClvBaselineId;
};

export type CustomerClvBlockedBaseline = {
  readonly modelId: CustomerClvBaselineId;
  readonly baselineVersion: string;
  readonly status: 'blocked';
  readonly reason: 'BLOCKED_BY_HISTORICAL_RFM_RECONSTRUCTION';
  readonly details: string;
};

export type CustomerClvFittedBaseline = {
  readonly modelId: CustomerClvBaselineId;
  readonly baselineVersion: string;
  readonly status: 'ready';
  readonly trainingCutoffs: readonly string[];
  readonly trainingCustomerRows: number;
  readonly trainingLabelWindowEndExclusive: string;
  readonly datasetVersion: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly checksum: string;
  predict(dataset: CustomerClvBacktestDataset): readonly CustomerClvBacktestPrediction[];
};

export type CustomerClvHistoryDepthBucket = '1' | '2' | '3-4' | '5+';
export type CustomerClvRecencyBucket = '0-90d' | '91-180d' | '181-365d' | '366-730d' | '>730d';

export type CustomerClvRevenueMetrics = {
  readonly customerCount: number;
  readonly predictedTotalRevenue: string;
  readonly actualTotalRevenue: string;
  readonly calibrationRatio: string | null;
  readonly meanActualRevenue: string | null;
  readonly medianActualRevenue: string | null;
  readonly meanPrediction: string | null;
  readonly medianPrediction: string | null;
  readonly mae: string | null;
  readonly medianAbsoluteError: string | null;
  readonly rmse: string | null;
  readonly spearmanRankCorrelation: string | null;
};

export type CustomerClvTopCapture = {
  readonly top1PctRevenueCapture: string | null;
  readonly top5PctRevenueCapture: string | null;
  readonly top10PctRevenueCapture: string | null;
  readonly top20PctRevenueCapture: string | null;
};

export type CustomerClvActivityMetrics = {
  readonly zeroFutureRevenueRate: string;
  readonly positiveFutureRevenueRate: string;
  readonly actualActivityRate: string;
  readonly meanRevenueAmongActiveCustomers: string | null;
  readonly medianRevenueAmongActiveCustomers: string | null;
  readonly rocAuc: string | null;
  readonly prAuc: string | null;
  readonly brierScore: string | null;
};

export type CustomerClvDecileRow = {
  readonly decile: number;
  readonly customerCount: number;
  readonly meanPredictedRevenue: string | null;
  readonly actualActivityRate: string | null;
  readonly meanActualRevenue: string | null;
  readonly medianActualRevenue: string | null;
  readonly totalActualRevenue: string;
  readonly revenueLiftVsPopulation: string | null;
  readonly cumulativeRevenueCapture: string | null;
};

export type CustomerClvSegmentMetrics = {
  readonly bucket: string;
  readonly customerCount: number;
  readonly actualTotalRevenue: string;
  readonly predictedTotalRevenue: string;
  readonly calibrationRatio: string | null;
  readonly meanActualRevenue: string | null;
  readonly meanPrediction: string | null;
  readonly mae: string | null;
  readonly spearmanRankCorrelation: string | null;
};

export type CustomerClvConditionalValueMetrics = {
  readonly activeCustomerCount: number;
  readonly predictedTotalRevenue: string;
  readonly actualTotalRevenue: string;
  readonly calibrationRatio: string | null;
  readonly mae: string | null;
  readonly medianAbsoluteError: string | null;
  readonly rmse: string | null;
  readonly spearmanRankCorrelation: string | null;
};

export type CustomerClvOutlierSensitivity = {
  readonly winsorizedAtActualP99: {
    readonly capRevenueTaxIncl: string | null;
    readonly mae: string | null;
    readonly rmse: string | null;
    readonly calibrationRatio: string | null;
  };
};

export type CustomerClvPerCutoffEvaluation = {
  readonly cutoffTime: string;
  readonly trainingCutoffs: readonly string[];
  readonly trainingCustomerRows: number;
  readonly trainingLabelWindowEndExclusive: string;
  readonly datasetChecksum: string;
  readonly fitChecksum: string;
  readonly revenueMetrics: CustomerClvRevenueMetrics;
  readonly activityMetrics: CustomerClvActivityMetrics;
  readonly conditionalValueMetrics: CustomerClvConditionalValueMetrics;
  readonly topCapture: CustomerClvTopCapture;
  readonly deciles: readonly CustomerClvDecileRow[];
  readonly historyDepth: readonly CustomerClvSegmentMetrics[];
  readonly recency: readonly CustomerClvSegmentMetrics[];
};

export type CustomerClvModelEvaluation = {
  readonly modelId: CustomerClvBaselineId;
  readonly baselineVersion: string;
  readonly cutoffResults: readonly CustomerClvPerCutoffEvaluation[];
  readonly overallRevenueMetrics: CustomerClvRevenueMetrics;
  readonly overallActivityMetrics: CustomerClvActivityMetrics;
  readonly overallConditionalValueMetrics: CustomerClvConditionalValueMetrics;
  readonly overallTopCapture: CustomerClvTopCapture;
  readonly overallHistoryDepth: readonly CustomerClvSegmentMetrics[];
  readonly overallRecency: readonly CustomerClvSegmentMetrics[];
  readonly outlierSensitivity: CustomerClvOutlierSensitivity;
};

export type CustomerClvRollingOriginPlanRow = {
  readonly evaluationCutoff: string;
  readonly trainingCutoffs: readonly string[];
};

export type CustomerClvRollingOriginEvaluationReport = {
  readonly evaluationVersion: typeof CUSTOMER_CLV_BASELINE_EVALUATION_VERSION;
  readonly trainingProtocolVersion: typeof CUSTOMER_CLV_TRAINING_PROTOCOL_VERSION;
  readonly datasetVersion: string;
  readonly deterministicTiebreakPolicyVersion: typeof CUSTOMER_CLV_DET_TIEBREAK_POLICY_VERSION;
  readonly generatedAt: string;
  readonly rollingOriginPlan: readonly CustomerClvRollingOriginPlanRow[];
  readonly blockedBaselines: readonly CustomerClvBlockedBaseline[];
  readonly models: readonly CustomerClvModelEvaluation[];
  readonly metadata: {
    readonly randomSplit: false;
    readonly equalHistoricalCutoffWeighting: true;
    readonly evaluationCutoff?: string;
  };
};

type CustomerClvTrainingRow = {
  readonly cutoffTime: string;
  readonly row: CustomerClvBacktestExample;
};

type BaselineFactory = (trainingDatasets: readonly CustomerClvBacktestDataset[]) => CustomerClvFittedBaseline | CustomerClvBlockedBaseline;
type BaselineDefinition = {
  readonly modelId: CustomerClvBaselineId;
  readonly fit: BaselineFactory;
};

type PreparedPrediction = {
  readonly example: CustomerClvBacktestExample;
  readonly prediction: CustomerClvBacktestPrediction;
};

type CellStats = {
  readonly support: number;
  readonly medianRevenue: string;
  readonly meanRevenue: string;
  readonly activityRate: string;
};

const BASELINE_DEFINITIONS: readonly BaselineDefinition[] = [
  { modelId: 'global-mean-v1', fit: fitGlobalMeanBaseline },
  { modelId: 'global-activity-x-conditional-mean-v1', fit: fitGlobalActivityConditionalMeanBaseline },
  { modelId: 'historical-12m-revenue-v1', fit: fitHistoricalTwelveMonthRevenueBaseline },
  { modelId: 'lifetime-monthly-rate-shrunk-v1', fit: fitLifetimeMonthlyRateBaseline },
  { modelId: 'aov-x-order-rate-v1', fit: fitAovOrderRateBaseline },
  { modelId: 'recency-adjusted-projection-v1', fit: fitRecencyAdjustedProjectionBaseline },
  { modelId: 'rfm-segment-median-v1', fit: fitBlockedExactRfmSegmentBaseline },
  { modelId: 'cutoff-safe-rfm-bucket-median-v1', fit: fitCutoffSafeRfmBucketMedianBaseline },
  { modelId: 'simple-cohort-prior-v1', fit: fitSimpleCohortPriorBaseline },
];

export function buildCustomerClvRollingOriginPlan(
  datasets: readonly CustomerClvBacktestDataset[],
  evaluationCutoff?: string,
): readonly CustomerClvRollingOriginPlanRow[] {
  const ordered = sortDatasetsByCutoff(datasets);
  const plan: CustomerClvRollingOriginPlanRow[] = [];
  for (const dataset of ordered) {
    if (evaluationCutoff !== undefined && dataset.manifest.cutoffTime !== evaluationCutoff) {
      continue;
    }
    const training = selectTrainingDatasetsForEvaluation(ordered, dataset.manifest.cutoffTime);
    if (training.length === 0) continue;
    plan.push({
      evaluationCutoff: dataset.manifest.cutoffTime,
      trainingCutoffs: training.map((entry) => entry.manifest.cutoffTime),
    });
  }
  return plan;
}

export function assertTrainingDatasetsMatureForEvaluation(
  trainingDatasets: readonly CustomerClvBacktestDataset[],
  evaluationCutoff: string,
): void {
  for (const dataset of trainingDatasets) {
    if (Date.parse(dataset.manifest.labelWindowEndExclusive) > Date.parse(evaluationCutoff)) {
      throw new Error(
        `Training cutoff ${dataset.manifest.cutoffTime} has label end ${dataset.manifest.labelWindowEndExclusive} after evaluation cutoff ${evaluationCutoff}`,
      );
    }
  }
}

export function evaluateCustomerClvRollingOrigin(input: {
  readonly datasets: readonly CustomerClvBacktestDataset[];
  readonly generatedAt: string;
  readonly evaluationCutoff?: string;
  readonly modelIds?: readonly CustomerClvBaselineId[];
}): CustomerClvRollingOriginEvaluationReport {
  const datasets = sortDatasetsByCutoff(input.datasets);
  if (datasets.length === 0) {
    throw new Error('CLV rolling-origin evaluation requires at least one dataset');
  }
  const modelIds = input.modelIds;
  const selectedFactories =
    modelIds === undefined
      ? BASELINE_DEFINITIONS
      : BASELINE_DEFINITIONS.filter((definition) => modelIds.includes(definition.modelId));
  const plan = buildCustomerClvRollingOriginPlan(datasets, input.evaluationCutoff);
  if (plan.length === 0) {
    throw new Error('CLV rolling-origin evaluation found no evaluation cutoffs with mature prior training history');
  }

  const blockedBaselines = new Map<CustomerClvBaselineId, CustomerClvBlockedBaseline>();
  const cutoffResultsByModel = new Map<CustomerClvBaselineId, CustomerClvPerCutoffEvaluation[]>();
  const preparedByModel = new Map<CustomerClvBaselineId, PreparedPrediction[]>();
  const readyVersions = new Map<CustomerClvBaselineId, string>();

  for (const planRow of plan) {
    const evaluationDataset = datasets.find((dataset) => dataset.manifest.cutoffTime === planRow.evaluationCutoff);
    if (!evaluationDataset) {
      throw new Error(`Missing evaluation dataset for cutoff ${planRow.evaluationCutoff}`);
    }
    const trainingDatasets = selectTrainingDatasetsForEvaluation(datasets, planRow.evaluationCutoff);
    assertTrainingDatasetsMatureForEvaluation(trainingDatasets, planRow.evaluationCutoff);

    for (const definition of selectedFactories) {
      const baseline = definition.fit(trainingDatasets);
      if (baseline.status === 'blocked') {
        blockedBaselines.set(baseline.modelId, baseline);
        continue;
      }
      readyVersions.set(baseline.modelId, baseline.baselineVersion);
      const predictions = baseline.predict(evaluationDataset);
      const prepared = pairDatasetWithPredictions(evaluationDataset, predictions, baseline.modelId);
      const result = evaluatePreparedCutoff({
        evaluationDataset,
        prepared,
        trainingCutoffs: baseline.trainingCutoffs,
        trainingCustomerRows: baseline.trainingCustomerRows,
        trainingLabelWindowEndExclusive: baseline.trainingLabelWindowEndExclusive,
        fitChecksum: baseline.checksum,
      });
      const cutoffResults = cutoffResultsByModel.get(baseline.modelId) ?? [];
      cutoffResults.push(result);
      cutoffResultsByModel.set(baseline.modelId, cutoffResults);
      const preparedRows = preparedByModel.get(baseline.modelId) ?? [];
      preparedRows.push(...prepared);
      preparedByModel.set(baseline.modelId, preparedRows);
    }
  }

  const models: CustomerClvModelEvaluation[] = [];
  for (const [modelId, cutoffResults] of cutoffResultsByModel.entries()) {
    const prepared = preparedByModel.get(modelId) ?? [];
    const merged = mergeCutoffResults(cutoffResults, prepared);
    models.push({
      modelId,
      baselineVersion: readyVersions.get(modelId) ?? 'unknown',
      ...merged,
    });
  }

  return {
    evaluationVersion: CUSTOMER_CLV_BASELINE_EVALUATION_VERSION,
    trainingProtocolVersion: CUSTOMER_CLV_TRAINING_PROTOCOL_VERSION,
    datasetVersion: datasets[0]!.manifest.datasetVersion,
    deterministicTiebreakPolicyVersion: CUSTOMER_CLV_DET_TIEBREAK_POLICY_VERSION,
    generatedAt: input.generatedAt,
    rollingOriginPlan: plan,
    blockedBaselines: Array.from(blockedBaselines.values()).sort((left, right) => left.modelId.localeCompare(right.modelId)),
    models: models.sort((left, right) => left.modelId.localeCompare(right.modelId)),
    metadata: {
      randomSplit: false,
      equalHistoricalCutoffWeighting: true,
      ...(input.evaluationCutoff === undefined ? {} : { evaluationCutoff: input.evaluationCutoff }),
    },
  };
}

function fitGlobalMeanBaseline(trainingDatasets: readonly CustomerClvBacktestDataset[]): CustomerClvFittedBaseline {
  const context = summarizeTrainingContext(trainingDatasets);
  const predictedRevenueTaxIncl = context.globalMeanRevenue;
  return createFittedBaseline({
    modelId: 'global-mean-v1',
    baselineVersion: 'global-mean-v1',
    trainingDatasets,
    parameters: {
      equalCutoffMeanFutureRevenueTaxIncl: predictedRevenueTaxIncl,
    },
    predictRow: (row) => ({
      customerId: row.customerId,
      cutoffTime: row.cutoffTime,
      predictedRevenueTaxIncl,
      modelId: 'global-mean-v1',
    }),
  });
}

function fitGlobalActivityConditionalMeanBaseline(trainingDatasets: readonly CustomerClvBacktestDataset[]): CustomerClvFittedBaseline {
  const context = summarizeTrainingContext(trainingDatasets);
  const predictedRevenueTaxIncl = multiplyMoney(context.globalConditionalMeanRevenue, context.globalActivityRate);
  return createFittedBaseline({
    modelId: 'global-activity-x-conditional-mean-v1',
    baselineVersion: 'global-activity-x-conditional-mean-v1',
    trainingDatasets,
    parameters: {
      equalCutoffActivityRate: context.globalActivityRate,
      equalCutoffConditionalMeanRevenueTaxIncl: context.globalConditionalMeanRevenue,
      impliedMeanRevenueTaxIncl: predictedRevenueTaxIncl,
    },
    predictRow: (row) => ({
      customerId: row.customerId,
      cutoffTime: row.cutoffTime,
      predictedRevenueTaxIncl,
      predictedActiveProbability: context.globalActivityRate,
      modelId: 'global-activity-x-conditional-mean-v1',
    }),
  });
}

function fitHistoricalTwelveMonthRevenueBaseline(trainingDatasets: readonly CustomerClvBacktestDataset[]): CustomerClvFittedBaseline {
  summarizeTrainingContext(trainingDatasets);
  return createFittedBaseline({
    modelId: 'historical-12m-revenue-v1',
    baselineVersion: 'historical-12m-revenue-v1',
    trainingDatasets,
    parameters: {
      sourceFeature: 'revenue365d',
    },
    predictRow: (row) => ({
      customerId: row.customerId,
      cutoffTime: row.cutoffTime,
      predictedRevenueTaxIncl: row.features.revenue365d,
      modelId: 'historical-12m-revenue-v1',
    }),
  });
}

function fitLifetimeMonthlyRateBaseline(trainingDatasets: readonly CustomerClvBacktestDataset[]): CustomerClvFittedBaseline {
  const context = summarizeTrainingContext(trainingDatasets);
  return createFittedBaseline({
    modelId: 'lifetime-monthly-rate-shrunk-v1',
    baselineVersion: 'lifetime-monthly-rate-shrunk-v1',
    trainingDatasets,
    parameters: {
      priorMonthlyRevenueTaxIncl: context.globalHistoricalMonthlyRevenue,
      shrinkageMonths: CUSTOMER_CLV_LIFETIME_RATE_SHRINKAGE_MONTHS,
    },
    predictRow: (row) => ({
      customerId: row.customerId,
      cutoffTime: row.cutoffTime,
      predictedRevenueTaxIncl: annualizedLifetimeRatePrediction(row, context.globalHistoricalMonthlyRevenue),
      modelId: 'lifetime-monthly-rate-shrunk-v1',
    }),
  });
}

function fitAovOrderRateBaseline(trainingDatasets: readonly CustomerClvBacktestDataset[]): CustomerClvFittedBaseline {
  const context = summarizeTrainingContext(trainingDatasets);
  return createFittedBaseline({
    modelId: 'aov-x-order-rate-v1',
    baselineVersion: 'aov-x-order-rate-v1',
    trainingDatasets,
    parameters: {
      priorAnnualOrderRate: context.globalAnnualOrderRate,
      shrinkageYears: CUSTOMER_CLV_ORDER_RATE_SHRINKAGE_YEARS,
    },
    predictRow: (row) => ({
      customerId: row.customerId,
      cutoffTime: row.cutoffTime,
      predictedRevenueTaxIncl: aovOrderRatePrediction(row, context.globalAnnualOrderRate),
      modelId: 'aov-x-order-rate-v1',
    }),
  });
}

function fitRecencyAdjustedProjectionBaseline(trainingDatasets: readonly CustomerClvBacktestDataset[]): CustomerClvFittedBaseline {
  const context = summarizeTrainingContext(trainingDatasets);
  return createFittedBaseline({
    modelId: 'recency-adjusted-projection-v1',
    baselineVersion: 'recency-adjusted-projection-v1',
    trainingDatasets,
    parameters: {
      priorMonthlyRevenueTaxIncl: context.globalHistoricalMonthlyRevenue,
      recencyDecayPolicy: 'piecewise-durable-goods-v1',
      shrinkageMonths: CUSTOMER_CLV_LIFETIME_RATE_SHRINKAGE_MONTHS,
    },
    predictRow: (row) => ({
      customerId: row.customerId,
      cutoffTime: row.cutoffTime,
      predictedRevenueTaxIncl: multiplyMoney(
        annualizedLifetimeRatePrediction(row, context.globalHistoricalMonthlyRevenue),
        recencyDecayMultiplier(row.features.daysSinceLastOrder),
      ),
      modelId: 'recency-adjusted-projection-v1',
    }),
  });
}

function fitBlockedExactRfmSegmentBaseline(trainingDatasets: readonly CustomerClvBacktestDataset[]): CustomerClvBlockedBaseline {
  summarizeTrainingContext(trainingDatasets);
  return {
    modelId: 'rfm-segment-median-v1',
    baselineVersion: 'rfm-segment-median-v1',
    status: 'blocked',
    reason: 'BLOCKED_BY_HISTORICAL_RFM_RECONSTRUCTION',
    details:
      'Current repository evidence supports cutoff-safe CLV features but not exact historical RFM snapshot reconstruction with the same semantics and no disproportionate scope; replaced by cutoff-safe R/F/M bucket median baseline.',
  };
}

function fitCutoffSafeRfmBucketMedianBaseline(trainingDatasets: readonly CustomerClvBacktestDataset[]): CustomerClvFittedBaseline {
  const context = summarizeTrainingContext(trainingDatasets);
  const moneyThresholds = buildQuantileThresholds(flattenTrainingRows(trainingDatasets).map((entry) => entry.row.features.historicalRevenueTaxIncl));
  const exact = buildCellStats(
    trainingDatasets,
    (entry) => exactRfmBucket(entry.row, moneyThresholds),
    CUSTOMER_CLV_RFM_BUCKET_MIN_SUPPORT,
  );
  const rf = buildCellStats(trainingDatasets, (entry) => rfFallbackBucket(entry.row), CUSTOMER_CLV_RFM_BUCKET_MIN_SUPPORT);
  return createFittedBaseline({
    modelId: 'cutoff-safe-rfm-bucket-median-v1',
    baselineVersion: 'cutoff-safe-rfm-bucket-median-v1',
    trainingDatasets,
    parameters: {
      minimumSupport: CUSTOMER_CLV_RFM_BUCKET_MIN_SUPPORT,
      monetaryThresholds: moneyThresholds,
      fallbackPolicy: 'exact_rfm_bucket_to_rf_to_global_median',
      globalMedianRevenueTaxIncl: context.globalMedianRevenue,
      globalActivityRate: context.globalActivityRate,
    },
    predictRow: (row) => {
      const exactKey = exactRfmBucket(row, moneyThresholds);
      const exactCell = exact.get(exactKey);
      const fallbackCell = rf.get(rfFallbackBucket(row));
      const selected = exactCell ?? fallbackCell;
      return {
        customerId: row.customerId,
        cutoffTime: row.cutoffTime,
        predictedRevenueTaxIncl: selected?.medianRevenue ?? context.globalMedianRevenue,
        predictedActiveProbability: selected?.activityRate ?? context.globalActivityRate,
        modelId: 'cutoff-safe-rfm-bucket-median-v1',
      };
    },
  });
}

function fitSimpleCohortPriorBaseline(trainingDatasets: readonly CustomerClvBacktestDataset[]): CustomerClvFittedBaseline {
  const context = summarizeTrainingContext(trainingDatasets);
  const exact = buildCellStats(trainingDatasets, (entry) => exactCohortKey(entry.row), CUSTOMER_CLV_COHORT_MIN_SUPPORT);
  const orderRecency = buildCellStats(trainingDatasets, (entry) => orderRecencyFallbackKey(entry.row), CUSTOMER_CLV_COHORT_MIN_SUPPORT);
  const recencyOnly = buildCellStats(trainingDatasets, (entry) => recencyOnlyKey(entry.row), CUSTOMER_CLV_COHORT_MIN_SUPPORT);
  return createFittedBaseline({
    modelId: 'simple-cohort-prior-v1',
    baselineVersion: 'simple-cohort-prior-v1',
    trainingDatasets,
    parameters: {
      minimumSupport: CUSTOMER_CLV_COHORT_MIN_SUPPORT,
      fallbackPolicyVersion: CUSTOMER_CLV_COHORT_FALLBACK_POLICY_VERSION,
      globalMeanRevenueTaxIncl: context.globalMeanRevenue,
      globalActivityRate: context.globalActivityRate,
    },
    predictRow: (row) => {
      const selected =
        exact.get(exactCohortKey(row)) ??
        orderRecency.get(orderRecencyFallbackKey(row)) ??
        recencyOnly.get(recencyOnlyKey(row));
      return {
        customerId: row.customerId,
        cutoffTime: row.cutoffTime,
        predictedRevenueTaxIncl: selected?.meanRevenue ?? context.globalMeanRevenue,
        predictedActiveProbability: selected?.activityRate ?? context.globalActivityRate,
        modelId: 'simple-cohort-prior-v1',
      };
    },
  });
}

function createFittedBaseline(input: {
  readonly modelId: CustomerClvBaselineId;
  readonly baselineVersion: string;
  readonly trainingDatasets: readonly CustomerClvBacktestDataset[];
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly predictRow: (row: CustomerClvBacktestExample) => CustomerClvBacktestPrediction;
}): CustomerClvFittedBaseline {
  const trainingDatasets = sortDatasetsByCutoff(input.trainingDatasets);
  const trainingCutoffs = trainingDatasets.map((dataset) => dataset.manifest.cutoffTime);
  const trainingCustomerRows = trainingDatasets.reduce((total, dataset) => total + dataset.rows.length, 0);
  if (trainingCustomerRows === 0) {
    throw new Error(`Baseline ${input.modelId} requires non-empty training datasets`);
  }
  const trainingLabelWindowEndExclusive = trainingDatasets.at(-1)!.manifest.labelWindowEndExclusive;
  const checksum = sha256Stable({
    modelId: input.modelId,
    baselineVersion: input.baselineVersion,
    trainingCutoffs,
    trainingCustomerRows,
    trainingLabelWindowEndExclusive,
    parameters: input.parameters,
  });
  return {
    modelId: input.modelId,
    baselineVersion: input.baselineVersion,
    status: 'ready',
    trainingCutoffs,
    trainingCustomerRows,
    trainingLabelWindowEndExclusive,
    datasetVersion: trainingDatasets[0]!.manifest.datasetVersion,
    parameters: input.parameters,
    checksum,
    predict(dataset) {
      if (dataset.rows.length === 0) {
        throw new Error(`Evaluation dataset for ${input.modelId} must not be empty`);
      }
      return dataset.rows
        .map(input.predictRow)
        .sort((left, right) => left.customerId - right.customerId);
    },
  };
}

function summarizeTrainingContext(trainingDatasets: readonly CustomerClvBacktestDataset[]) {
  const ordered = sortDatasetsByCutoff(trainingDatasets);
  if (ordered.length === 0) {
    throw new Error('Training datasets must not be empty');
  }
  if (ordered.some((dataset) => dataset.rows.length === 0)) {
    throw new Error('Training datasets must not contain empty cutoff populations');
  }
  const globalMeanRevenue = equalCutoffAverageMoney(ordered, (dataset) =>
    averageMoney(dataset.rows.map((row) => row.labels.futureRevenueTaxIncl)),
  );
  const globalMedianRevenue = medianDecimal(
    ordered.map((dataset) => medianDecimal(dataset.rows.map((row) => row.labels.futureRevenueTaxIncl)) ?? '0.000000'),
  ) ?? '0.000000';
  const globalActivityRate = equalCutoffAverageRatio(ordered, (dataset) =>
    ratioString(
      dataset.rows.filter((row) => row.labels.futureValidOrderCount > 0).length,
      dataset.rows.length,
    ),
  );
  const globalConditionalMeanRevenue = equalCutoffAverageMoney(ordered, (dataset) => {
    const active = dataset.rows.filter((row) => row.labels.futureValidOrderCount > 0);
    return active.length === 0 ? '0.000000' : averageMoney(active.map((row) => row.labels.futureRevenueTaxIncl));
  });
  const globalHistoricalMonthlyRevenue = equalCutoffAverageMoney(ordered, (dataset) =>
    averageMoney(
      dataset.rows.map((row) => {
        const observedMonths = observedHistoryMonths(row);
        return safeDivisionMoney(row.features.historicalRevenueTaxIncl, observedMonths);
      }),
    ),
  );
  const globalAnnualOrderRate = equalCutoffAverageNumber(ordered, (dataset) =>
    dataset.rows.reduce((total, row) => total + annualOrderRate(row), 0) / dataset.rows.length,
  );
  return {
    globalMeanRevenue,
    globalMedianRevenue,
    globalActivityRate,
    globalConditionalMeanRevenue,
    globalHistoricalMonthlyRevenue,
    globalAnnualOrderRate: roundNumber(globalAnnualOrderRate),
  };
}

function annualizedLifetimeRatePrediction(row: CustomerClvBacktestExample, priorMonthlyRevenue: string): string {
  const observedMonths = observedHistoryMonths(row);
  const numerator = parseMoney(row.features.historicalRevenueTaxIncl) + parseMoney(priorMonthlyRevenue) * CUSTOMER_CLV_LIFETIME_RATE_SHRINKAGE_MONTHS;
  const denominator = observedMonths + CUSTOMER_CLV_LIFETIME_RATE_SHRINKAGE_MONTHS;
  return moneyFromNumber((numerator / denominator) * 12);
}

function aovOrderRatePrediction(row: CustomerClvBacktestExample, priorAnnualOrderRate: number): string {
  const annualOrders = annualOrderRateWithShrinkage(row, priorAnnualOrderRate);
  return moneyFromNumber(parseMoney(row.features.historicalAovTaxIncl) * annualOrders);
}

function annualOrderRateWithShrinkage(row: CustomerClvBacktestExample, priorAnnualOrderRate: number): number {
  const observedYears = Math.max(row.observationMetadata.historyDays / 365.25, 1 / 12);
  const rawAnnualOrders = row.features.historicalValidOrderCount / observedYears;
  return roundNumber(
    (rawAnnualOrders * observedYears + priorAnnualOrderRate * CUSTOMER_CLV_ORDER_RATE_SHRINKAGE_YEARS) /
      (observedYears + CUSTOMER_CLV_ORDER_RATE_SHRINKAGE_YEARS),
  );
}

function annualOrderRate(row: CustomerClvBacktestExample): number {
  const observedYears = Math.max(row.observationMetadata.historyDays / 365.25, 1 / 12);
  return row.features.historicalValidOrderCount / observedYears;
}

function observedHistoryMonths(row: CustomerClvBacktestExample): number {
  return Math.max(row.observationMetadata.historyDays / 30.4375, 1 / 30.4375);
}

function recencyDecayMultiplier(daysSinceLastOrder: number): string {
  if (daysSinceLastOrder <= 90) return '1.000000';
  if (daysSinceLastOrder <= 180) return '0.750000';
  if (daysSinceLastOrder <= 365) return '0.500000';
  if (daysSinceLastOrder <= 730) return '0.250000';
  return '0.100000';
}

function exactRfmBucket(row: CustomerClvBacktestExample, monetaryThresholds: readonly string[]): string {
  return `r:${recencyBucket(row.features.daysSinceLastOrder)}|f:${frequencyBucket(row.features.historicalValidOrderCount)}|m:${moneyQuantileBucket(
    row.features.historicalRevenueTaxIncl,
    monetaryThresholds,
  )}`;
}

function rfFallbackBucket(row: CustomerClvBacktestExample): string {
  return `r:${recencyBucket(row.features.daysSinceLastOrder)}|f:${frequencyBucket(row.features.historicalValidOrderCount)}`;
}

function exactCohortKey(row: CustomerClvBacktestExample): string {
  return `orders:${historyDepthBucket(row.features.historicalValidOrderCount)}|recency:${recencyBucket(row.features.daysSinceLastOrder)}|tenure:${tenureBucket(
    row.features.customerTenureDays,
  )}`;
}

function orderRecencyFallbackKey(row: CustomerClvBacktestExample): string {
  return `orders:${historyDepthBucket(row.features.historicalValidOrderCount)}|recency:${recencyBucket(row.features.daysSinceLastOrder)}`;
}

function recencyOnlyKey(row: CustomerClvBacktestExample): string {
  return `recency:${recencyBucket(row.features.daysSinceLastOrder)}`;
}

function buildCellStats(
  trainingDatasets: readonly CustomerClvBacktestDataset[],
  keyOf: (entry: CustomerClvTrainingRow) => string,
  minSupport: number,
): ReadonlyMap<string, CellStats> {
  const grouped = new Map<string, Map<string, CustomerClvBacktestExample[]>>();
  for (const dataset of trainingDatasets) {
    for (const row of dataset.rows) {
      const key = keyOf({ cutoffTime: dataset.manifest.cutoffTime, row });
      const byCutoff = grouped.get(key) ?? new Map<string, CustomerClvBacktestExample[]>();
      const rows = byCutoff.get(dataset.manifest.cutoffTime) ?? [];
      rows.push(row);
      byCutoff.set(dataset.manifest.cutoffTime, rows);
      grouped.set(key, byCutoff);
    }
  }
  const result = new Map<string, CellStats>();
  for (const [key, byCutoff] of grouped.entries()) {
    const cutoffRowGroups = Array.from(byCutoff.values());
    const support = cutoffRowGroups.reduce((total, rows) => total + rows.length, 0);
    if (support < minSupport) {
      continue;
    }
    const cutoffMedians = cutoffRowGroups.map((rows) => medianDecimal(rows.map((row) => row.labels.futureRevenueTaxIncl)) ?? '0.000000');
    const cutoffMeans = cutoffRowGroups.map((rows) => averageMoney(rows.map((row) => row.labels.futureRevenueTaxIncl)));
    const cutoffActivity = cutoffRowGroups.map((rows) =>
      ratioString(
        rows.filter((row) => row.labels.futureValidOrderCount > 0).length,
        rows.length,
      ),
    );
    result.set(key, {
      support,
      medianRevenue: medianDecimal(cutoffMedians) ?? '0.000000',
      meanRevenue: averageMoney(cutoffMeans),
      activityRate: averageRatio(cutoffActivity),
    });
  }
  return result;
}

function evaluatePreparedCutoff(input: {
  readonly evaluationDataset: CustomerClvBacktestDataset;
  readonly prepared: readonly PreparedPrediction[];
  readonly trainingCutoffs: readonly string[];
  readonly trainingCustomerRows: number;
  readonly trainingLabelWindowEndExclusive: string;
  readonly fitChecksum: string;
}): CustomerClvPerCutoffEvaluation {
  const revenueMetrics = buildRevenueMetrics(input.prepared);
  const activityMetrics = buildActivityMetrics(input.prepared);
  const conditionalValueMetrics = buildConditionalValueMetrics(input.prepared);
  return {
    cutoffTime: input.evaluationDataset.manifest.cutoffTime,
    trainingCutoffs: input.trainingCutoffs,
    trainingCustomerRows: input.trainingCustomerRows,
    trainingLabelWindowEndExclusive: input.trainingLabelWindowEndExclusive,
    datasetChecksum: input.evaluationDataset.manifest.datasetChecksum,
    fitChecksum: input.fitChecksum,
    revenueMetrics,
    activityMetrics,
    conditionalValueMetrics,
    topCapture: buildTopCapture(input.prepared),
    deciles: buildDecileTable(input.prepared),
    historyDepth: buildBucketMetrics(input.prepared, (entry) => historyDepthBucket(entry.example.features.historicalValidOrderCount)),
    recency: buildBucketMetrics(input.prepared, (entry) => recencyBucket(entry.example.features.daysSinceLastOrder)),
  };
}

function mergeCutoffResults(
  cutoffResults: readonly CustomerClvPerCutoffEvaluation[],
  prepared: readonly PreparedPrediction[],
): Omit<CustomerClvModelEvaluation, 'modelId' | 'baselineVersion'> {
  return {
    cutoffResults,
    overallRevenueMetrics: buildRevenueMetrics(prepared),
    overallActivityMetrics: buildActivityMetrics(prepared),
    overallConditionalValueMetrics: buildConditionalValueMetrics(prepared),
    overallTopCapture: buildTopCapture(prepared),
    overallHistoryDepth: buildBucketMetrics(prepared, (entry) => historyDepthBucket(entry.example.features.historicalValidOrderCount)),
    overallRecency: buildBucketMetrics(prepared, (entry) => recencyBucket(entry.example.features.daysSinceLastOrder)),
    outlierSensitivity: buildOutlierSensitivity(prepared),
  };
}

function pairDatasetWithPredictions(
  dataset: CustomerClvBacktestDataset,
  predictions: readonly CustomerClvBacktestPrediction[],
  modelId: CustomerClvBaselineId,
): readonly PreparedPrediction[] {
  if (dataset.rows.length === 0) {
    throw new Error(`Evaluation dataset for ${modelId} must not be empty`);
  }
  if (predictions.length !== dataset.rows.length) {
    throw new Error(`Prediction count mismatch for ${modelId}`);
  }
  const predictionByCustomer = new Map<number, CustomerClvBacktestPrediction>();
  for (const prediction of predictions) {
    if (prediction.cutoffTime !== dataset.manifest.cutoffTime) {
      throw new Error(`Prediction cutoff mismatch for ${modelId}`);
    }
    if (predictionByCustomer.has(prediction.customerId)) {
      throw new Error(`Duplicate prediction for customerId ${prediction.customerId}`);
    }
    predictionByCustomer.set(prediction.customerId, {
      ...prediction,
      predictedRevenueTaxIncl: moneyFromNumber(parseMoney(prediction.predictedRevenueTaxIncl)),
      ...(prediction.predictedActiveProbability === undefined
        ? {}
        : { predictedActiveProbability: ratioFromNumber(parseProbability(prediction.predictedActiveProbability)) }),
    });
  }
  return dataset.rows.map((row) => {
    const prediction = predictionByCustomer.get(row.customerId);
    if (!prediction) {
      throw new Error(`Missing prediction for customerId ${row.customerId}`);
    }
    return { example: row, prediction };
  });
}

function buildRevenueMetrics(prepared: readonly PreparedPrediction[]): CustomerClvRevenueMetrics {
  const actuals = prepared.map((entry) => entry.example.labels.futureRevenueTaxIncl);
  const predictions = prepared.map((entry) => entry.prediction.predictedRevenueTaxIncl);
  const actualNumbers = actuals.map(parseMoney);
  const predictionNumbers = predictions.map(parseMoney);
  const absErrors = actualNumbers.map((actual, index) => Math.abs(actual - predictionNumbers[index]!));
  return {
    customerCount: prepared.length,
    predictedTotalRevenue: addDecimals(predictions),
    actualTotalRevenue: addDecimals(actuals),
    calibrationRatio: ratioMoney(addDecimals(predictions), addDecimals(actuals)),
    meanActualRevenue: averageMoney(actuals),
    medianActualRevenue: medianDecimal(actuals),
    meanPrediction: averageMoney(predictions),
    medianPrediction: medianDecimal(predictions),
    mae: moneyFromNumber(meanNumber(absErrors)),
    medianAbsoluteError: moneyFromNumber(medianNumber(absErrors) ?? 0),
    rmse: moneyFromNumber(Math.sqrt(meanNumber(absErrors.map((value) => value ** 2)))),
    spearmanRankCorrelation: signedDecimalMetric(spearmanRankCorrelation(predictionNumbers, actualNumbers)),
  };
}

function buildActivityMetrics(prepared: readonly PreparedPrediction[]): CustomerClvActivityMetrics {
  const active = prepared.filter((entry) => entry.example.labels.futureValidOrderCount > 0);
  const activityFlags = prepared.map((entry) => (entry.example.labels.futureValidOrderCount > 0 ? 1 : 0));
  const probabilities = prepared.every((entry) => entry.prediction.predictedActiveProbability !== undefined)
    ? prepared.map((entry) => parseProbability(entry.prediction.predictedActiveProbability!))
    : null;
  return {
    zeroFutureRevenueRate: ratioString(prepared.filter((entry) => compareDecimalAsc(entry.example.labels.futureRevenueTaxIncl, '0.000000') === 0).length, prepared.length),
    positiveFutureRevenueRate: ratioString(active.length, prepared.length),
    actualActivityRate: ratioString(active.length, prepared.length),
    meanRevenueAmongActiveCustomers: active.length === 0 ? null : averageMoney(active.map((entry) => entry.example.labels.futureRevenueTaxIncl)),
    medianRevenueAmongActiveCustomers: active.length === 0 ? null : medianDecimal(active.map((entry) => entry.example.labels.futureRevenueTaxIncl)),
    rocAuc: probabilities === null ? null : decimalMetric(rocAuc(probabilities, activityFlags)),
    prAuc: probabilities === null ? null : decimalMetric(prAuc(probabilities, activityFlags)),
    brierScore: probabilities === null ? null : decimalMetric(meanNumber(probabilities.map((p, index) => (p - activityFlags[index]!) ** 2))),
  };
}

function buildConditionalValueMetrics(prepared: readonly PreparedPrediction[]): CustomerClvConditionalValueMetrics {
  const active = prepared.filter((entry) => entry.example.labels.futureValidOrderCount > 0);
  if (active.length === 0) {
    return {
      activeCustomerCount: 0,
      predictedTotalRevenue: '0.000000',
      actualTotalRevenue: '0.000000',
      calibrationRatio: null,
      mae: null,
      medianAbsoluteError: null,
      rmse: null,
      spearmanRankCorrelation: null,
    };
  }
  const metrics = buildRevenueMetrics(active);
  return {
    activeCustomerCount: active.length,
    predictedTotalRevenue: metrics.predictedTotalRevenue,
    actualTotalRevenue: metrics.actualTotalRevenue,
    calibrationRatio: metrics.calibrationRatio,
    mae: metrics.mae,
    medianAbsoluteError: metrics.medianAbsoluteError,
    rmse: metrics.rmse,
    spearmanRankCorrelation: metrics.spearmanRankCorrelation,
  };
}

function buildTopCapture(prepared: readonly PreparedPrediction[]): CustomerClvTopCapture {
  const sorted = buildDecileStableRows(prepared);
  const totalActual = addDecimals(sorted.map((entry) => entry.example.labels.futureRevenueTaxIncl));
  return {
    top1PctRevenueCapture: captureShare(sorted, totalActual, 0.01),
    top5PctRevenueCapture: captureShare(sorted, totalActual, 0.05),
    top10PctRevenueCapture: captureShare(sorted, totalActual, 0.1),
    top20PctRevenueCapture: captureShare(sorted, totalActual, 0.2),
  };
}

function buildDecileTable(prepared: readonly PreparedPrediction[]): readonly CustomerClvDecileRow[] {
  const sorted = buildDecileStableRows(prepared);
  const totalActual = addDecimals(sorted.map((entry) => entry.example.labels.futureRevenueTaxIncl));
  const populationMean = averageMoney(sorted.map((entry) => entry.example.labels.futureRevenueTaxIncl));
  const rows: CustomerClvDecileRow[] = [];
  let cumulative = '0.000000';
  for (let decile = 1; decile <= 10; decile += 1) {
    const members = sorted.filter((_, index) => Math.floor(index * 10 / sorted.length) + 1 === decile);
    if (members.length === 0) continue;
    const totalActualRevenue = addDecimals(members.map((entry) => entry.example.labels.futureRevenueTaxIncl));
    cumulative = addDecimals([cumulative, totalActualRevenue]);
    const meanActualRevenue = averageMoney(members.map((entry) => entry.example.labels.futureRevenueTaxIncl));
    rows.push({
      decile,
      customerCount: members.length,
      meanPredictedRevenue: averageMoney(members.map((entry) => entry.prediction.predictedRevenueTaxIncl)),
      actualActivityRate: ratioString(members.filter((entry) => entry.example.labels.futureValidOrderCount > 0).length, members.length),
      meanActualRevenue,
      medianActualRevenue: medianDecimal(members.map((entry) => entry.example.labels.futureRevenueTaxIncl)),
      totalActualRevenue,
      revenueLiftVsPopulation:
        populationMean === null || compareDecimalAsc(populationMean, '0.000000') === 0 || meanActualRevenue === null
          ? null
          : ratioFromNumber(parseMoney(meanActualRevenue) / parseMoney(populationMean)),
      cumulativeRevenueCapture: ratioMoney(cumulative, totalActual),
    });
  }
  return rows;
}

function buildBucketMetrics(
  prepared: readonly PreparedPrediction[],
  bucketOf: (entry: PreparedPrediction) => string,
): readonly CustomerClvSegmentMetrics[] {
  const grouped = new Map<string, PreparedPrediction[]>();
  for (const entry of prepared) {
    const key = bucketOf(entry);
    const bucket = grouped.get(key) ?? [];
    bucket.push(entry);
    grouped.set(key, bucket);
  }
  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucket, entries]) => {
      const metrics = buildRevenueMetrics(entries);
      return {
        bucket,
        customerCount: entries.length,
        actualTotalRevenue: metrics.actualTotalRevenue,
        predictedTotalRevenue: metrics.predictedTotalRevenue,
        calibrationRatio: metrics.calibrationRatio,
        meanActualRevenue: metrics.meanActualRevenue,
        meanPrediction: metrics.meanPrediction,
        mae: metrics.mae,
        spearmanRankCorrelation: metrics.spearmanRankCorrelation,
      };
    });
}

function buildOutlierSensitivity(prepared: readonly PreparedPrediction[]): CustomerClvOutlierSensitivity {
  const p99 = percentileDecimal(prepared.map((entry) => entry.example.labels.futureRevenueTaxIncl).sort(compareDecimalAsc), 0.99);
  if (p99 === null) {
    return {
      winsorizedAtActualP99: {
        capRevenueTaxIncl: null,
        mae: null,
        rmse: null,
        calibrationRatio: null,
      },
    };
  }
  const capped = prepared.map((entry) => ({
    actual: compareDecimalAsc(entry.example.labels.futureRevenueTaxIncl, p99) > 0 ? p99 : entry.example.labels.futureRevenueTaxIncl,
    predicted: compareDecimalAsc(entry.prediction.predictedRevenueTaxIncl, p99) > 0 ? p99 : entry.prediction.predictedRevenueTaxIncl,
  }));
  const absErrors = capped.map((entry) => Math.abs(parseMoney(entry.actual) - parseMoney(entry.predicted)));
  return {
    winsorizedAtActualP99: {
      capRevenueTaxIncl: p99,
      mae: moneyFromNumber(meanNumber(absErrors)),
      rmse: moneyFromNumber(Math.sqrt(meanNumber(absErrors.map((value) => value ** 2)))),
      calibrationRatio: ratioMoney(addDecimals(capped.map((entry) => entry.predicted)), addDecimals(capped.map((entry) => entry.actual))),
    },
  };
}

function selectTrainingDatasetsForEvaluation(
  datasets: readonly CustomerClvBacktestDataset[],
  evaluationCutoff: string,
): readonly CustomerClvBacktestDataset[] {
  return sortDatasetsByCutoff(datasets).filter(
    (dataset) =>
      Date.parse(dataset.manifest.cutoffTime) < Date.parse(evaluationCutoff) &&
      Date.parse(dataset.manifest.labelWindowEndExclusive) <= Date.parse(evaluationCutoff),
  );
}

function sortDatasetsByCutoff(datasets: readonly CustomerClvBacktestDataset[]): readonly CustomerClvBacktestDataset[] {
  return [...datasets].sort((left, right) => left.manifest.cutoffTime.localeCompare(right.manifest.cutoffTime));
}

function flattenTrainingRows(datasets: readonly CustomerClvBacktestDataset[]): readonly CustomerClvTrainingRow[] {
  return datasets.flatMap((dataset) => dataset.rows.map((row) => ({ cutoffTime: dataset.manifest.cutoffTime, row })));
}

function buildQuantileThresholds(values: readonly string[]): readonly string[] {
  const sorted = [...values].sort(compareDecimalAsc);
  return [0.2, 0.4, 0.6, 0.8].map((fraction) => percentileDecimal(sorted, fraction) ?? '0.000000');
}

function moneyQuantileBucket(value: string, thresholds: readonly string[]): string {
  if (compareDecimalAsc(value, thresholds[0] ?? '0.000000') <= 0) return 'Q1';
  if (compareDecimalAsc(value, thresholds[1] ?? '0.000000') <= 0) return 'Q2';
  if (compareDecimalAsc(value, thresholds[2] ?? '0.000000') <= 0) return 'Q3';
  if (compareDecimalAsc(value, thresholds[3] ?? '0.000000') <= 0) return 'Q4';
  return 'Q5';
}

function frequencyBucket(count: number): string {
  if (count <= 1) return '1';
  if (count === 2) return '2';
  if (count <= 4) return '3-4';
  if (count <= 7) return '5-7';
  return '8+';
}

function historyDepthBucket(count: number): CustomerClvHistoryDepthBucket {
  if (count <= 1) return '1';
  if (count === 2) return '2';
  if (count <= 4) return '3-4';
  return '5+';
}

function recencyBucket(daysSinceLastOrder: number): CustomerClvRecencyBucket {
  if (daysSinceLastOrder <= 90) return '0-90d';
  if (daysSinceLastOrder <= 180) return '91-180d';
  if (daysSinceLastOrder <= 365) return '181-365d';
  if (daysSinceLastOrder <= 730) return '366-730d';
  return '>730d';
}

function tenureBucket(days: number): string {
  if (days <= 180) return '0-180d';
  if (days <= 365) return '181-365d';
  if (days <= 730) return '366-730d';
  return '>730d';
}

function buildDecileStableRows(prepared: readonly PreparedPrediction[]): readonly PreparedPrediction[] {
  return [...prepared].sort((left, right) => {
    const byPrediction = compareDecimalAsc(right.prediction.predictedRevenueTaxIncl, left.prediction.predictedRevenueTaxIncl);
    if (byPrediction !== 0) return byPrediction;
    return left.example.customerId - right.example.customerId;
  });
}

function captureShare(sorted: readonly PreparedPrediction[], totalActual: string, fraction: number): string | null {
  if (compareDecimalAsc(totalActual, '0.000000') === 0) return null;
  const take = Math.max(1, Math.ceil(sorted.length * fraction));
  return ratioMoney(addDecimals(sorted.slice(0, take).map((entry) => entry.example.labels.futureRevenueTaxIncl)), totalActual);
}

function equalCutoffAverageMoney(
  datasets: readonly CustomerClvBacktestDataset[],
  perCutoffValue: (dataset: CustomerClvBacktestDataset) => string,
): string {
  return averageMoney(datasets.map(perCutoffValue));
}

function equalCutoffAverageRatio(
  datasets: readonly CustomerClvBacktestDataset[],
  perCutoffValue: (dataset: CustomerClvBacktestDataset) => string,
): string {
  return averageRatio(datasets.map(perCutoffValue));
}

function equalCutoffAverageNumber(
  datasets: readonly CustomerClvBacktestDataset[],
  perCutoffValue: (dataset: CustomerClvBacktestDataset) => number,
): number {
  return datasets.reduce((total, dataset) => total + perCutoffValue(dataset), 0) / datasets.length;
}

function averageMoney(values: readonly string[]): string {
  if (values.length === 0) return '0.000000';
  return divideDecimal(addDecimals(values), values.length);
}

function averageRatio(values: readonly string[]): string {
  if (values.length === 0) return '0.000000';
  return ratioFromNumber(values.map(parseProbability).reduce((sum, value) => sum + value, 0) / values.length);
}

function averageNumber(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function meanNumber(values: readonly number[]): number {
  return averageNumber(values);
}

function ratioString(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0.000000';
  return ratioFromNumber(numerator / denominator);
}

function ratioMoney(numerator: string, denominator: string): string | null {
  if (compareDecimalAsc(denominator, '0.000000') === 0) return null;
  return ratioFromNumber(parseMoney(numerator) / parseMoney(denominator));
}

function safeDivisionMoney(numerator: string, denominator: number): string {
  if (!Number.isFinite(denominator) || denominator <= 0) return '0.000000';
  return moneyFromNumber(parseMoney(numerator) / denominator);
}

function multiplyMoney(left: string, right: string): string {
  return moneyFromNumber(parseMoney(left) * parseProbability(right));
}

function medianDecimal(values: readonly string[]): string | null {
  return percentileDecimal([...values].sort(compareDecimalAsc), 0.5);
}

function percentileDecimal(sortedAscending: readonly string[], fraction: number): string | null {
  if (sortedAscending.length === 0) return null;
  const bounded = Math.min(Math.max(fraction, 0), 1);
  const index = Math.ceil(bounded * sortedAscending.length) - 1;
  return sortedAscending[Math.max(index, 0)]!;
}

function medianNumber(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(sorted.length * 0.5) - 1;
  return sorted[Math.max(index, 0)]!;
}

function spearmanRankCorrelation(predictions: readonly number[], actuals: readonly number[]): number | null {
  if (predictions.length !== actuals.length || predictions.length < 2) return null;
  const predictionRanks = averageRanks(predictions);
  const actualRanks = averageRanks(actuals);
  const predictionMean = meanNumber(predictionRanks);
  const actualMean = meanNumber(actualRanks);
  let numerator = 0;
  let predictionVariance = 0;
  let actualVariance = 0;
  for (let index = 0; index < predictions.length; index += 1) {
    const predictionCentered = predictionRanks[index]! - predictionMean;
    const actualCentered = actualRanks[index]! - actualMean;
    numerator += predictionCentered * actualCentered;
    predictionVariance += predictionCentered ** 2;
    actualVariance += actualCentered ** 2;
  }
  if (predictionVariance === 0 || actualVariance === 0) return 0;
  return numerator / Math.sqrt(predictionVariance * actualVariance);
}

function averageRanks(values: readonly number[]): readonly number[] {
  const entries = values.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value || left.index - right.index);
  const ranks = new Array<number>(values.length);
  let cursor = 0;
  while (cursor < entries.length) {
    let end = cursor + 1;
    while (end < entries.length && entries[end]!.value === entries[cursor]!.value) {
      end += 1;
    }
    const averageRank = (cursor + 1 + end) / 2;
    for (let index = cursor; index < end; index += 1) {
      ranks[entries[index]!.index] = averageRank;
    }
    cursor = end;
  }
  return ranks;
}

function rocAuc(probabilities: readonly number[], actuals: readonly number[]): number | null {
  const positives = actuals.filter((value) => value === 1).length;
  const negatives = actuals.length - positives;
  if (positives === 0 || negatives === 0) return null;
  const ranks = averageRanks(probabilities);
  let positiveRankSum = 0;
  for (let index = 0; index < actuals.length; index += 1) {
    if (actuals[index] === 1) positiveRankSum += ranks[index]!;
  }
  return (positiveRankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

function prAuc(probabilities: readonly number[], actuals: readonly number[]): number | null {
  const positives = actuals.filter((value) => value === 1).length;
  if (positives === 0) return null;
  const rows = probabilities
    .map((probability, index) => ({ probability, actual: actuals[index]! }))
    .sort((left, right) => right.probability - left.probability);
  let tp = 0;
  let fp = 0;
  let prevRecall = 0;
  let area = 0;
  let cursor = 0;
  while (cursor < rows.length) {
    let end = cursor;
    let positivesInGroup = 0;
    let negativesInGroup = 0;
    while (end < rows.length && rows[end]!.probability === rows[cursor]!.probability) {
      if (rows[end]!.actual === 1) {
        positivesInGroup += 1;
      } else {
        negativesInGroup += 1;
      }
      end += 1;
    }
    tp += positivesInGroup;
    fp += negativesInGroup;
    const recall = tp / positives;
    const precision = tp / (tp + fp);
    area += precision * (recall - prevRecall);
    prevRecall = recall;
    cursor = end;
  }
  return area;
}

function parseMoney(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid CLV money value: ${value}`);
  }
  return parsed;
}

function parseProbability(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Invalid CLV probability value: ${value}`);
  }
  return parsed;
}

function moneyFromNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric prediction value: ${String(value)}`);
  }
  return formatDecimal(Math.max(0, value).toFixed(6));
}

function ratioFromNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid ratio value: ${String(value)}`);
  }
  const bounded = Math.min(Math.max(value, 0), Number.MAX_SAFE_INTEGER);
  return formatDecimal(bounded.toFixed(6));
}

function decimalMetric(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return formatDecimal(Math.max(0, value).toFixed(6));
}

function signedDecimalMetric(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = value.toFixed(6);
  return rounded.startsWith('-') ? rounded : formatDecimal(rounded);
}

function roundNumber(value: number): number {
  return Number(value.toFixed(6));
}
