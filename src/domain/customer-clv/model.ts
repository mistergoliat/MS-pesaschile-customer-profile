import { addDecimals, compareDecimalAsc, divideDecimal, formatDecimal } from '../../shared/decimal.js';
import { sha256Stable } from '../customer-rfm/checksum.js';
import {
  CUSTOMER_CLV_MODEL_VERSION,
  type CustomerClvReliabilityBucket,
} from './contracts.js';
import {
  CUSTOMER_CLV_DET_TIEBREAK_POLICY_VERSION,
  CUSTOMER_CLV_TRAINING_PROTOCOL_VERSION,
  assertTrainingDatasetsMatureForEvaluation,
  buildCustomerClvRollingOriginPlan,
  type CustomerClvActivityMetrics,
  type CustomerClvConditionalValueMetrics,
  type CustomerClvDecileRow,
  type CustomerClvOutlierSensitivity,
  type CustomerClvRevenueMetrics,
  type CustomerClvSegmentMetrics,
  type CustomerClvTopCapture,
} from './baselines.js';
import type { CustomerClvBacktestDataset, CustomerClvBacktestExample } from './dataset.js';

export const CUSTOMER_CLV_TWO_STAGE_MODEL_FIT_VERSION = 'customer-clv-two-stage-cohort-fit-v1';
export const CUSTOMER_CLV_TWO_STAGE_ACTIVITY_PRIOR_STRENGTH_EXACT = 30;
export const CUSTOMER_CLV_TWO_STAGE_ACTIVITY_PRIOR_STRENGTH_ORDER_RECENCY = 45;
export const CUSTOMER_CLV_TWO_STAGE_ACTIVITY_PRIOR_STRENGTH_RECENCY = 60;
export const CUSTOMER_CLV_TWO_STAGE_VALUE_PRIOR_STRENGTH_EXACT = 20;
export const CUSTOMER_CLV_TWO_STAGE_VALUE_PRIOR_STRENGTH_ORDER_RECENCY = 30;
export const CUSTOMER_CLV_TWO_STAGE_VALUE_PRIOR_STRENGTH_RECENCY = 45;
export const CUSTOMER_CLV_TWO_STAGE_RECENT_ACTIVITY_CUTOFF_WINDOW = 2;
export const CUSTOMER_CLV_TWO_STAGE_RELIABILITY_POLICY_VERSION = 'customer-clv-two-stage-reliability-history-support-fallback-v1';
export const CUSTOMER_CLV_TWO_STAGE_SUPPORT_POLICY_VERSION = 'customer-clv-two-stage-estimate-support-v1';
export const CUSTOMER_CLV_TWO_STAGE_SELECTION_POLICY_VERSION = 'customer-clv-two-stage-selection-calibration-then-ranking-v1';
export const CUSTOMER_CLV_TWO_STAGE_ACTIVITY_BAND_POLICY_VERSION = 'customer-clv-two-stage-activity-probability-bands-v1';
export const CUSTOMER_CLV_TWO_STAGE_ACTIVITY_RECALIBRATION_POLICY_VERSION =
  'customer-clv-two-stage-activity-recalibration-band-recency-v1';
export const CUSTOMER_CLV_TWO_STAGE_STALE_ACTIVITY_POLICY_VERSION =
  'customer-clv-two-stage-activity-recalibration-stale-parent-v1';
export const CUSTOMER_CLV_TWO_STAGE_VALUE_RANK_REFINEMENT_POLICY_VERSION =
  'customer-clv-two-stage-value-rank-refinement-log1p-revenue365d-v1';
export const CUSTOMER_CLV_TWO_STAGE_CORRECTION_SELECTION_POLICY_VERSION =
  'customer-clv-two-stage-selection-temporal-calibration-ranking-stale-ties-v1';
export const CUSTOMER_CLV_TWO_STAGE_HARDENING_SELECTION_POLICY_VERSION =
  'customer-clv-two-stage-selection-stale-support-hardening-v1';
export const CUSTOMER_CLV_TWO_STAGE_RELIABILITY_SCALE_POLICY_VERSION =
  'customer-clv-two-stage-reliability-scale-aware-v1';
export const CUSTOMER_CLV_TWO_STAGE_TIE_DIAGNOSTICS_POLICY_VERSION = 'customer-clv-two-stage-tie-diagnostics-v1';
export const CUSTOMER_CLV_TWO_STAGE_ACTIVITY_RECALIBRATION_BAND_PRIOR_STRENGTH = 80;
export const CUSTOMER_CLV_TWO_STAGE_ACTIVITY_RECALIBRATION_BAND_RECENCY_PRIOR_STRENGTH = 40;
export const CUSTOMER_CLV_TWO_STAGE_VALUE_SIGNAL_PRIOR_STRENGTH_RECENCY = 30;
export const CUSTOMER_CLV_TWO_STAGE_VALUE_SIGNAL_PRIOR_STRENGTH_ORDER_RECENCY = 20;
export const CUSTOMER_CLV_TWO_STAGE_VALUE_SIGNAL_PRIOR_STRENGTH_EXACT = 10;
export const CUSTOMER_CLV_TWO_STAGE_VALUE_RANK_MIN_FACTOR = 0.5;
export const CUSTOMER_CLV_TWO_STAGE_VALUE_RANK_MAX_FACTOR = 2;
export const CUSTOMER_CLV_TWO_STAGE_SUPPORT_LOW_MIN_ACTIVITY_SUPPORT = 80;
export const CUSTOMER_CLV_TWO_STAGE_SUPPORT_LOW_MIN_VALUE_SUPPORT = 40;
export const CUSTOMER_CLV_TWO_STAGE_SUPPORT_LOW_MIN_CUTOFF_COVERAGE = 2;

export type CustomerClvTwoStageCandidateId =
  | 'two-stage-cohort-all-cutoffs-order-recency-value-v1'
  | 'two-stage-cohort-recent-activity-order-recency-value-v1'
  | 'two-stage-cohort-recent-activity-monetary-value-v1'
  | 'two-stage-cohort-a04-original-v1'
  | 'two-stage-cohort-a04-band-calibrated-v1'
  | 'two-stage-cohort-a04-band-recency-rank25-v1'
  | 'two-stage-cohort-a04-band-recency-rank50-refined-v1'
  | 'two-stage-cohort-a04-2-stale-support-recent2-v1'
  | 'two-stage-cohort-a04-2-stale-support-recent1-v1';

export type CustomerClvTwoStageFallbackLevel = 'exact' | 'order_recency' | 'recency' | 'global';

export type CustomerClvTwoStagePrediction = {
  readonly customerId: number;
  readonly cutoffTime: string;
  readonly modelVersion: typeof CUSTOMER_CLV_MODEL_VERSION;
  readonly candidateId: CustomerClvTwoStageCandidateId;
  readonly predictedRevenueTaxIncl: string;
  readonly predictedActiveProbability: string;
  readonly expectedRevenueGivenActiveTaxIncl: string;
  readonly expectedOrders?: string;
  readonly activityCohortKey: string;
  readonly valueCohortKey: string;
  readonly activitySupport: number;
  readonly valueSupport: number;
  readonly activityTrainingCutoffCoverage: number;
  readonly valueTrainingCutoffCoverage: number;
  readonly activityFallbackLevel: CustomerClvTwoStageFallbackLevel;
  readonly valueFallbackLevel: CustomerClvTwoStageFallbackLevel;
  readonly reliabilityBucket: CustomerClvReliabilityBucket;
};

export type CustomerClvTwoStageProbabilityBandRow = {
  readonly band: string;
  readonly customerCount: number;
  readonly meanPredictedActivityProbability: string | null;
  readonly actualActivityRate: string | null;
  readonly calibrationRatio: string | null;
};

export type CustomerClvTwoStageReliabilityRow = {
  readonly reliabilityBucket: CustomerClvReliabilityBucket;
  readonly customerCount: number;
  readonly populationShare: string;
  readonly predictedActivityRate: string | null;
  readonly actualActivityRate: string | null;
  readonly activityCalibrationRatio: string | null;
  readonly calibrationRatio: string | null;
  readonly mae: string | null;
  readonly normalizedAbsoluteError: string | null;
  readonly medianNormalizedAbsoluteError: string | null;
  readonly spearmanRankCorrelation: string | null;
  readonly cutoffCoverage: number;
  readonly historyDepthCoverage: number;
  readonly recencyCoverage: number;
};

export type CustomerClvTwoStageActivitySummary = CustomerClvActivityMetrics & {
  readonly predictedActivityRate: string | null;
};

export type CustomerClvTwoStageConditionalValueSummary = CustomerClvConditionalValueMetrics & {
  readonly predictedMeanRevenueGivenActiveTaxIncl: string | null;
  readonly actualMeanRevenueGivenActiveTaxIncl: string | null;
};

export type CustomerClvTwoStageCohortCalibrationRow = {
  readonly cohortKey: string;
  readonly parentKey: string | null;
  readonly level: CustomerClvTwoStageFallbackLevel;
  readonly support: number;
  readonly rawValue: string;
  readonly shrunkValue: string;
};

export type CustomerClvTwoStageTopCustomerRow = {
  readonly customerId: number;
  readonly cutoffTime: string;
  readonly historicalValidOrderCount: number;
  readonly daysSinceLastOrder: number;
  readonly customerTenureDays: number;
  readonly revenue365d: string;
  readonly activityProbability: string;
  readonly expectedRevenueGivenActiveTaxIncl: string;
  readonly expectedRevenueTaxIncl: string;
  readonly expectedOrders: string | null;
  readonly actualFutureRevenueTaxIncl: string;
  readonly actualFutureValidOrderCount: number;
  readonly activityCohortKey: string;
  readonly valueCohortKey: string;
  readonly activitySupport: number;
  readonly valueSupport: number;
  readonly reliabilityBucket: CustomerClvReliabilityBucket;
};

export type CustomerClvTwoStagePerCutoffEvaluation = {
  readonly cutoffTime: string;
  readonly activityTrainingCutoffs: readonly string[];
  readonly valueTrainingCutoffs: readonly string[];
  readonly trainingLabelWindowEndExclusive: string;
  readonly modelChecksum: string;
  readonly predictionChecksum: string;
  readonly revenueMetrics: CustomerClvRevenueMetrics;
  readonly activityMetrics: CustomerClvTwoStageActivitySummary;
  readonly conditionalValueMetrics: CustomerClvTwoStageConditionalValueSummary;
  readonly topCapture: CustomerClvTopCapture;
  readonly deciles: readonly CustomerClvDecileRow[];
  readonly historyDepth: readonly CustomerClvSegmentMetrics[];
  readonly recency: readonly CustomerClvSegmentMetrics[];
  readonly activityProbabilityBands: readonly CustomerClvTwoStageProbabilityBandRow[];
  readonly reliability: readonly CustomerClvTwoStageReliabilityRow[];
  readonly recencyAudit: readonly CustomerClvTwoStageRecencyAuditRow[];
};

export type CustomerClvTwoStageCandidateEvaluation = {
  readonly candidateId: CustomerClvTwoStageCandidateId;
  readonly modelVersion: typeof CUSTOMER_CLV_MODEL_VERSION;
  readonly modelFitVersion: typeof CUSTOMER_CLV_TWO_STAGE_MODEL_FIT_VERSION;
  readonly trainingProtocolVersion: typeof CUSTOMER_CLV_TRAINING_PROTOCOL_VERSION;
  readonly deterministicTiebreakPolicyVersion: typeof CUSTOMER_CLV_DET_TIEBREAK_POLICY_VERSION;
  readonly reliabilityPolicyVersion: typeof CUSTOMER_CLV_TWO_STAGE_RELIABILITY_POLICY_VERSION;
  readonly driftPolicy: {
    readonly activityTrainingWindow: 'all_eligible_cutoffs' | 'recent_2_eligible_cutoffs' | 'recent_1_eligible_cutoffs';
    readonly valueTrainingWindow: 'all_eligible_cutoffs';
    readonly valueCohortStrategy:
      | 'order_depth_recency'
      | 'order_depth_recency_revenue365d'
      | 'order_depth_recency_revenue365d_refined';
  };
  readonly activityModel: {
    readonly exactDimensions: readonly ['orderDepth', 'recency', 'tenure'];
    readonly fallbackHierarchy: readonly ['exact', 'order_recency', 'recency', 'global'];
    readonly shrinkageStrength: {
      readonly exact: number;
      readonly orderRecency: number;
      readonly recency: number;
    };
  };
  readonly conditionalValueModel: {
    readonly exactDimensions: readonly string[];
    readonly fallbackHierarchy: readonly ['exact', 'order_recency', 'recency', 'global'];
    readonly estimator: 'shrunk_arithmetic_mean';
    readonly shrinkageStrength: {
      readonly exact: number;
      readonly orderRecency: number;
      readonly recency: number;
    };
  };
  readonly modelChecksum: string;
  readonly evaluationChecksum: string;
  readonly cutoffResults: readonly CustomerClvTwoStagePerCutoffEvaluation[];
  readonly overallRevenueMetrics: CustomerClvRevenueMetrics;
  readonly overallActivityMetrics: CustomerClvTwoStageActivitySummary;
  readonly overallConditionalValueMetrics: CustomerClvTwoStageConditionalValueSummary;
  readonly overallTopCapture: CustomerClvTopCapture;
  readonly overallHistoryDepth: readonly CustomerClvSegmentMetrics[];
  readonly overallRecency: readonly CustomerClvSegmentMetrics[];
  readonly outlierSensitivity: CustomerClvOutlierSensitivity;
  readonly activityProbabilityBands: readonly CustomerClvTwoStageProbabilityBandRow[];
  readonly reliabilityResults: readonly CustomerClvTwoStageReliabilityRow[];
  readonly majorActivityCohorts: readonly CustomerClvTwoStageCohortCalibrationRow[];
  readonly majorValueCohorts: readonly CustomerClvTwoStageCohortCalibrationRow[];
  readonly fallbackUsage: {
    readonly activity: Readonly<Record<CustomerClvTwoStageFallbackLevel, number>>;
    readonly value: Readonly<Record<CustomerClvTwoStageFallbackLevel, number>>;
  };
  readonly topCustomerSanityCheck: readonly CustomerClvTwoStageTopCustomerRow[];
  readonly selectionDiagnostics: {
    readonly calibrationDistance: number;
    readonly withinReasonableCalibrationBand: boolean;
    readonly oneOrderMae: string | null;
    readonly calibrationStdDev: number;
  };
};

export type CustomerClvTwoStageEvaluationReport = {
  readonly generatedAt: string;
  readonly datasetVersion: string;
  readonly modelVersion: typeof CUSTOMER_CLV_MODEL_VERSION;
  readonly trainingProtocolVersion: typeof CUSTOMER_CLV_TRAINING_PROTOCOL_VERSION;
  readonly selectionPolicyVersion: typeof CUSTOMER_CLV_TWO_STAGE_SELECTION_POLICY_VERSION;
  readonly rollingOriginPlan: readonly {
    readonly evaluationCutoff: string;
    readonly eligibleTrainingCutoffs: readonly string[];
  }[];
  readonly candidateEvaluations: readonly CustomerClvTwoStageCandidateEvaluation[];
  readonly selectedCandidateId: CustomerClvTwoStageCandidateId;
  readonly selectedCandidate: CustomerClvTwoStageCandidateEvaluation;
};

export type CustomerClvTwoStageTieDiagnostics = {
  readonly uniquePredictionCount: number;
  readonly sharedPredictionCustomerCount: number;
  readonly sharedPredictionRate: string;
  readonly topDecileCustomerCount: number;
  readonly topDecileSharedPredictionCustomerCount: number;
  readonly topDecileTieRate: string;
  readonly top1PctCustomerCount: number;
  readonly top1PctSharedPredictionCustomerCount: number;
  readonly top1PctTieRate: string;
};

export type CustomerClvTwoStageRankingDiagnostics = {
  readonly activityProbabilitySpearmanToActualRevenue: string | null;
  readonly conditionalValueSpearmanToActualRevenue: string | null;
  readonly conditionalValueSpearmanAmongActive: string | null;
  readonly finalExpectedRevenueSpearmanToActualRevenue: string | null;
  readonly historical12mRevenueSpearmanToActualRevenue: string | null;
  readonly activityProbabilitySpearmanToHistorical12m: string | null;
  readonly conditionalValueSpearmanToHistorical12m: string | null;
  readonly finalExpectedRevenueSpearmanToHistorical12m: string | null;
};

export type CustomerClvTwoStageCohortObservedCalibrationRow = {
  readonly cohortKey: string;
  readonly level: CustomerClvTwoStageFallbackLevel;
  readonly support: number;
  readonly meanPredictedValue: string | null;
  readonly actualValue: string | null;
  readonly calibrationRatio: string | null;
  readonly spearmanRankCorrelation: string | null;
};

export type CustomerClvTwoStageCorrectionCandidateEvaluation = CustomerClvTwoStageCandidateEvaluation & {
  readonly correctionPolicyVersion: typeof CUSTOMER_CLV_TWO_STAGE_CORRECTION_SELECTION_POLICY_VERSION;
  readonly activityRecalibration: {
    readonly strategy: 'none' | 'probability_band' | 'probability_band_broad_recency' | 'probability_band_stale_parent';
    readonly policyVersion:
      | typeof CUSTOMER_CLV_TWO_STAGE_ACTIVITY_RECALIBRATION_POLICY_VERSION
      | typeof CUSTOMER_CLV_TWO_STAGE_STALE_ACTIVITY_POLICY_VERSION
      | null;
    readonly bandPolicyVersion: typeof CUSTOMER_CLV_TWO_STAGE_ACTIVITY_BAND_POLICY_VERSION | null;
  };
  readonly conditionalValueRankRefinement: {
    readonly signal: 'none' | 'log1p_revenue365d';
    readonly lambda: string;
    readonly factorBounds: {
      readonly min: string;
      readonly max: string;
    } | null;
    readonly policyVersion: typeof CUSTOMER_CLV_TWO_STAGE_VALUE_RANK_REFINEMENT_POLICY_VERSION | null;
  };
  readonly tieDiagnosticsPolicyVersion: typeof CUSTOMER_CLV_TWO_STAGE_TIE_DIAGNOSTICS_POLICY_VERSION;
  readonly reliabilityScalePolicyVersion: typeof CUSTOMER_CLV_TWO_STAGE_RELIABILITY_SCALE_POLICY_VERSION;
  readonly rankingDiagnostics: CustomerClvTwoStageRankingDiagnostics;
  readonly tieDiagnostics: CustomerClvTwoStageTieDiagnostics;
  readonly observedActivityCohorts: readonly CustomerClvTwoStageCohortObservedCalibrationRow[];
  readonly observedValueCohorts: readonly CustomerClvTwoStageCohortObservedCalibrationRow[];
};

export type CustomerClvTwoStageCorrectionEvaluationReport = {
  readonly generatedAt: string;
  readonly datasetVersion: string;
  readonly modelVersion: typeof CUSTOMER_CLV_MODEL_VERSION;
  readonly trainingProtocolVersion: typeof CUSTOMER_CLV_TRAINING_PROTOCOL_VERSION;
  readonly selectionPolicyVersion: typeof CUSTOMER_CLV_TWO_STAGE_CORRECTION_SELECTION_POLICY_VERSION;
  readonly rollingOriginPlan: readonly {
    readonly evaluationCutoff: string;
    readonly eligibleTrainingCutoffs: readonly string[];
  }[];
  readonly candidateEvaluations: readonly CustomerClvTwoStageCorrectionCandidateEvaluation[];
  readonly selectedCandidateId: CustomerClvTwoStageCandidateId;
  readonly selectedCandidate: CustomerClvTwoStageCorrectionCandidateEvaluation;
  readonly a04OriginalCandidateId: CustomerClvTwoStageCandidateId;
  readonly a04OriginalCandidate: CustomerClvTwoStageCorrectionCandidateEvaluation;
};

export type CustomerClvTwoStageRecencyAuditRow = {
  readonly bucket: string;
  readonly customerCount: number;
  readonly predictedActivityRate: string | null;
  readonly actualActivityRate: string | null;
  readonly activityCalibrationRatio: string | null;
  readonly revenueCalibrationRatio: string | null;
  readonly mae: string | null;
  readonly spearmanRankCorrelation: string | null;
};

export type CustomerClvTwoStageFrozenCandidateDescriptor = {
  readonly modelVersion: typeof CUSTOMER_CLV_MODEL_VERSION;
  readonly estimatorPolicyVersion: string;
  readonly activityModelVersion: typeof CUSTOMER_CLV_TWO_STAGE_MODEL_FIT_VERSION;
  readonly activityRecalibrationVersion: string;
  readonly conditionalValuePolicyVersion: string;
  readonly rankRefinementVersion: string;
  readonly reliabilitySupportPolicyVersion: string;
  readonly trainingTimePolicyVersion: typeof CUSTOMER_CLV_TRAINING_PROTOCOL_VERSION;
  readonly modelChecksum: string;
};

export type CustomerClvTwoStageHardeningEvaluationReport = {
  readonly generatedAt: string;
  readonly datasetVersion: string;
  readonly modelVersion: typeof CUSTOMER_CLV_MODEL_VERSION;
  readonly trainingProtocolVersion: typeof CUSTOMER_CLV_TRAINING_PROTOCOL_VERSION;
  readonly selectionPolicyVersion: typeof CUSTOMER_CLV_TWO_STAGE_HARDENING_SELECTION_POLICY_VERSION;
  readonly rollingOriginPlan: readonly {
    readonly evaluationCutoff: string;
    readonly eligibleTrainingCutoffs: readonly string[];
  }[];
  readonly candidateEvaluations: readonly CustomerClvTwoStageCorrectionCandidateEvaluation[];
  readonly selectedCandidateId: CustomerClvTwoStageCandidateId;
  readonly selectedCandidate: CustomerClvTwoStageCorrectionCandidateEvaluation;
  readonly a041CandidateId: CustomerClvTwoStageCandidateId;
  readonly a041Candidate: CustomerClvTwoStageCorrectionCandidateEvaluation;
  readonly frozenCandidateDescriptor: CustomerClvTwoStageFrozenCandidateDescriptor;
};

type CandidateConfig = {
  readonly candidateId: CustomerClvTwoStageCandidateId;
  readonly activityTrainingWindow: 'all_eligible_cutoffs' | 'recent_2_eligible_cutoffs' | 'recent_1_eligible_cutoffs';
  readonly valueTrainingWindow: 'all_eligible_cutoffs';
  readonly valueCohortStrategy:
    | 'order_depth_recency'
    | 'order_depth_recency_revenue365d'
    | 'order_depth_recency_revenue365d_refined';
};

type ActivityCellEstimate = {
  readonly key: string;
  readonly parentKey: string | null;
  readonly level: CustomerClvTwoStageFallbackLevel;
  readonly support: number;
  readonly cutoffCoverage: number;
  readonly rawRate: string;
  readonly shrunkRate: string;
};

type ValueCellEstimate = {
  readonly key: string;
  readonly parentKey: string | null;
  readonly level: CustomerClvTwoStageFallbackLevel;
  readonly support: number;
  readonly cutoffCoverage: number;
  readonly rawMeanRevenue: string;
  readonly shrunkMeanRevenue: string;
  readonly rawMeanOrdersGivenActive: string;
  readonly shrunkMeanOrdersGivenActive: string;
};

type PreparedPrediction = {
  readonly example: CustomerClvBacktestExample;
  readonly prediction: CustomerClvTwoStagePrediction;
};

type FittedCandidateModel = {
  readonly candidateId: CustomerClvTwoStageCandidateId;
  readonly modelVersion: typeof CUSTOMER_CLV_MODEL_VERSION;
  readonly activityTrainingCutoffs: readonly string[];
  readonly valueTrainingCutoffs: readonly string[];
  readonly trainingLabelWindowEndExclusive: string;
  readonly modelChecksum: string;
  readonly driftPolicy: CustomerClvTwoStageCandidateEvaluation['driftPolicy'];
  readonly majorActivityCohorts: readonly CustomerClvTwoStageCohortCalibrationRow[];
  readonly majorValueCohorts: readonly CustomerClvTwoStageCohortCalibrationRow[];
  predict(dataset: CustomerClvBacktestDataset): readonly CustomerClvTwoStagePrediction[];
};

type ActivityCalibrationCellEstimate = {
  readonly key: string;
  readonly parentKey: string | null;
  readonly support: number;
  readonly cutoffCoverage: number;
  readonly rawObservedRate: string;
  readonly shrunkObservedRate: string;
};

type ActivityCalibrationModel = {
  readonly strategy: CorrectionCandidateConfig['activityRecalibration'];
  readonly globalActivityRate: string;
  readonly checksumShape: Readonly<Record<string, unknown>>;
  calibrate(row: CustomerClvBacktestExample, baseProbability: string): string;
};

type ValueSignalCellEstimate = {
  readonly key: string;
  readonly level: CustomerClvTwoStageFallbackLevel;
  readonly support: number;
  readonly shrunkMeanSignal: number;
};

type ValueRankRefinementModel = {
  readonly signal: CorrectionCandidateConfig['valueRankSignal'];
  readonly lambda: number;
  readonly checksumShape: Readonly<Record<string, unknown>>;
  multiplier(row: CustomerClvBacktestExample, prediction: CustomerClvTwoStagePrediction): string;
};

const CANDIDATE_CONFIGS: readonly CandidateConfig[] = [
  {
    candidateId: 'two-stage-cohort-all-cutoffs-order-recency-value-v1',
    activityTrainingWindow: 'all_eligible_cutoffs',
    valueTrainingWindow: 'all_eligible_cutoffs',
    valueCohortStrategy: 'order_depth_recency',
  },
  {
    candidateId: 'two-stage-cohort-recent-activity-order-recency-value-v1',
    activityTrainingWindow: 'recent_2_eligible_cutoffs',
    valueTrainingWindow: 'all_eligible_cutoffs',
    valueCohortStrategy: 'order_depth_recency',
  },
  {
    candidateId: 'two-stage-cohort-recent-activity-monetary-value-v1',
    activityTrainingWindow: 'recent_2_eligible_cutoffs',
    valueTrainingWindow: 'all_eligible_cutoffs',
    valueCohortStrategy: 'order_depth_recency_revenue365d',
  },
] as const;

type CorrectionCandidateConfig = {
  readonly candidateId: CustomerClvTwoStageCandidateId;
  readonly activityTrainingWindow: 'recent_2_eligible_cutoffs' | 'recent_1_eligible_cutoffs';
  readonly valueTrainingWindow: 'all_eligible_cutoffs';
  readonly valueCohortStrategy: 'order_depth_recency_revenue365d' | 'order_depth_recency_revenue365d_refined';
  readonly activityRecalibration:
    | 'none'
    | 'probability_band'
    | 'probability_band_broad_recency'
    | 'probability_band_stale_parent';
  readonly valueRankSignal: 'none' | 'log1p_revenue365d';
  readonly valueRankLambda: 0 | 0.25 | 0.5;
};

const CORRECTION_CANDIDATE_CONFIGS: readonly CorrectionCandidateConfig[] = [
  {
    candidateId: 'two-stage-cohort-a04-original-v1',
    activityTrainingWindow: 'recent_2_eligible_cutoffs',
    valueTrainingWindow: 'all_eligible_cutoffs',
    valueCohortStrategy: 'order_depth_recency_revenue365d',
    activityRecalibration: 'none',
    valueRankSignal: 'none',
    valueRankLambda: 0,
  },
  {
    candidateId: 'two-stage-cohort-a04-band-calibrated-v1',
    activityTrainingWindow: 'recent_2_eligible_cutoffs',
    valueTrainingWindow: 'all_eligible_cutoffs',
    valueCohortStrategy: 'order_depth_recency_revenue365d',
    activityRecalibration: 'probability_band',
    valueRankSignal: 'none',
    valueRankLambda: 0,
  },
  {
    candidateId: 'two-stage-cohort-a04-band-recency-rank25-v1',
    activityTrainingWindow: 'recent_2_eligible_cutoffs',
    valueTrainingWindow: 'all_eligible_cutoffs',
    valueCohortStrategy: 'order_depth_recency_revenue365d',
    activityRecalibration: 'probability_band_broad_recency',
    valueRankSignal: 'log1p_revenue365d',
    valueRankLambda: 0.25,
  },
  {
    candidateId: 'two-stage-cohort-a04-band-recency-rank50-refined-v1',
    activityTrainingWindow: 'recent_2_eligible_cutoffs',
    valueTrainingWindow: 'all_eligible_cutoffs',
    valueCohortStrategy: 'order_depth_recency_revenue365d_refined',
    activityRecalibration: 'probability_band_broad_recency',
    valueRankSignal: 'log1p_revenue365d',
    valueRankLambda: 0.5,
  },
] as const;

const HARDENING_CANDIDATE_CONFIGS: readonly CorrectionCandidateConfig[] = [
  {
    candidateId: 'two-stage-cohort-a04-band-recency-rank50-refined-v1',
    activityTrainingWindow: 'recent_2_eligible_cutoffs',
    valueTrainingWindow: 'all_eligible_cutoffs',
    valueCohortStrategy: 'order_depth_recency_revenue365d_refined',
    activityRecalibration: 'probability_band_broad_recency',
    valueRankSignal: 'log1p_revenue365d',
    valueRankLambda: 0.5,
  },
  {
    candidateId: 'two-stage-cohort-a04-2-stale-support-recent2-v1',
    activityTrainingWindow: 'recent_2_eligible_cutoffs',
    valueTrainingWindow: 'all_eligible_cutoffs',
    valueCohortStrategy: 'order_depth_recency_revenue365d_refined',
    activityRecalibration: 'probability_band_stale_parent',
    valueRankSignal: 'log1p_revenue365d',
    valueRankLambda: 0.5,
  },
  {
    candidateId: 'two-stage-cohort-a04-2-stale-support-recent1-v1',
    activityTrainingWindow: 'recent_1_eligible_cutoffs',
    valueTrainingWindow: 'all_eligible_cutoffs',
    valueCohortStrategy: 'order_depth_recency_revenue365d_refined',
    activityRecalibration: 'probability_band_stale_parent',
    valueRankSignal: 'log1p_revenue365d',
    valueRankLambda: 0.5,
  },
] as const;

export function evaluateCustomerClvTwoStageCandidates(input: {
  readonly datasets: readonly CustomerClvBacktestDataset[];
  readonly generatedAt: string;
  readonly evaluationCutoff?: string;
}): CustomerClvTwoStageEvaluationReport {
  const datasets = sortDatasetsByCutoff(input.datasets);
  if (datasets.length === 0) {
    throw new Error('CLV two-stage evaluation requires at least one dataset');
  }
  const plan = buildCustomerClvRollingOriginPlan(datasets, input.evaluationCutoff);
  if (plan.length === 0) {
    throw new Error('CLV two-stage evaluation found no evaluation cutoffs with mature prior training history');
  }

  const candidateEvaluations = CANDIDATE_CONFIGS.map((config) =>
    evaluateCandidateAcrossRollingOrigin(datasets, plan, config),
  ).sort((left, right) => left.candidateId.localeCompare(right.candidateId));

  const selectedCandidate = [...candidateEvaluations].sort(compareCandidateEvaluations)[0];
  if (!selectedCandidate) {
    throw new Error('CLV two-stage evaluation did not produce any candidate models');
  }

  return {
    generatedAt: input.generatedAt,
    datasetVersion: datasets[0]!.manifest.datasetVersion,
    modelVersion: CUSTOMER_CLV_MODEL_VERSION,
    trainingProtocolVersion: CUSTOMER_CLV_TRAINING_PROTOCOL_VERSION,
    selectionPolicyVersion: CUSTOMER_CLV_TWO_STAGE_SELECTION_POLICY_VERSION,
    rollingOriginPlan: plan.map((row) => ({
      evaluationCutoff: row.evaluationCutoff,
      eligibleTrainingCutoffs: row.trainingCutoffs,
    })),
    candidateEvaluations,
    selectedCandidateId: selectedCandidate.candidateId,
    selectedCandidate,
  };
}

export function evaluateCustomerClvTwoStageCorrectionCandidates(input: {
  readonly datasets: readonly CustomerClvBacktestDataset[];
  readonly generatedAt: string;
  readonly evaluationCutoff?: string;
}): CustomerClvTwoStageCorrectionEvaluationReport {
  const datasets = sortDatasetsByCutoff(input.datasets);
  if (datasets.length === 0) {
    throw new Error('CLV two-stage correction evaluation requires at least one dataset');
  }
  const plan = buildCustomerClvRollingOriginPlan(datasets, input.evaluationCutoff);
  if (plan.length === 0) {
    throw new Error('CLV two-stage correction evaluation found no evaluation cutoffs with mature prior training history');
  }

  const candidateEvaluations = CORRECTION_CANDIDATE_CONFIGS.map((config) =>
    evaluateCorrectionCandidateAcrossRollingOrigin(datasets, plan, config),
  ).sort((left, right) => left.candidateId.localeCompare(right.candidateId));

  const selectedCandidate = [...candidateEvaluations].sort(compareCorrectionCandidateEvaluations)[0];
  const a04OriginalCandidate = candidateEvaluations.find((candidate) => candidate.candidateId === 'two-stage-cohort-a04-original-v1');
  if (!selectedCandidate || !a04OriginalCandidate) {
    throw new Error('CLV two-stage correction evaluation did not produce the required candidate models');
  }

  return {
    generatedAt: input.generatedAt,
    datasetVersion: datasets[0]!.manifest.datasetVersion,
    modelVersion: CUSTOMER_CLV_MODEL_VERSION,
    trainingProtocolVersion: CUSTOMER_CLV_TRAINING_PROTOCOL_VERSION,
    selectionPolicyVersion: CUSTOMER_CLV_TWO_STAGE_CORRECTION_SELECTION_POLICY_VERSION,
    rollingOriginPlan: plan.map((row) => ({
      evaluationCutoff: row.evaluationCutoff,
      eligibleTrainingCutoffs: row.trainingCutoffs,
    })),
    candidateEvaluations,
    selectedCandidateId: selectedCandidate.candidateId,
    selectedCandidate,
    a04OriginalCandidateId: a04OriginalCandidate.candidateId,
    a04OriginalCandidate,
  };
}

export function evaluateCustomerClvTwoStageHardeningCandidates(input: {
  readonly datasets: readonly CustomerClvBacktestDataset[];
  readonly generatedAt: string;
  readonly evaluationCutoff?: string;
}): CustomerClvTwoStageHardeningEvaluationReport {
  const datasets = sortDatasetsByCutoff(input.datasets);
  if (datasets.length === 0) {
    throw new Error('CLV two-stage hardening evaluation requires at least one dataset');
  }
  const plan = buildCustomerClvRollingOriginPlan(datasets, input.evaluationCutoff);
  if (plan.length === 0) {
    throw new Error('CLV two-stage hardening evaluation found no evaluation cutoffs with mature prior training history');
  }

  const candidateEvaluations = HARDENING_CANDIDATE_CONFIGS.map((config) =>
    evaluateCorrectionCandidateAcrossRollingOrigin(datasets, plan, config),
  ).sort((left, right) => left.candidateId.localeCompare(right.candidateId));

  const selectedCandidate = [...candidateEvaluations].sort(compareHardeningCandidateEvaluations)[0];
  const a041Candidate = candidateEvaluations.find((candidate) => candidate.candidateId === 'two-stage-cohort-a04-band-recency-rank50-refined-v1');
  if (!selectedCandidate || !a041Candidate) {
    throw new Error('CLV two-stage hardening evaluation did not produce the required candidate models');
  }

  return {
    generatedAt: input.generatedAt,
    datasetVersion: datasets[0]!.manifest.datasetVersion,
    modelVersion: CUSTOMER_CLV_MODEL_VERSION,
    trainingProtocolVersion: CUSTOMER_CLV_TRAINING_PROTOCOL_VERSION,
    selectionPolicyVersion: CUSTOMER_CLV_TWO_STAGE_HARDENING_SELECTION_POLICY_VERSION,
    rollingOriginPlan: plan.map((row) => ({
      evaluationCutoff: row.evaluationCutoff,
      eligibleTrainingCutoffs: row.trainingCutoffs,
    })),
    candidateEvaluations,
    selectedCandidateId: selectedCandidate.candidateId,
    selectedCandidate,
    a041CandidateId: a041Candidate.candidateId,
    a041Candidate,
    frozenCandidateDescriptor: {
      modelVersion: CUSTOMER_CLV_MODEL_VERSION,
      estimatorPolicyVersion: selectedCandidate.candidateId,
      activityModelVersion: CUSTOMER_CLV_TWO_STAGE_MODEL_FIT_VERSION,
      activityRecalibrationVersion:
        selectedCandidate.activityRecalibration.policyVersion ?? CUSTOMER_CLV_TWO_STAGE_STALE_ACTIVITY_POLICY_VERSION,
      conditionalValuePolicyVersion: `value-cohort-${selectedCandidate.driftPolicy.valueCohortStrategy}`,
      rankRefinementVersion:
        selectedCandidate.conditionalValueRankRefinement.policyVersion ?? 'none',
      reliabilitySupportPolicyVersion: CUSTOMER_CLV_TWO_STAGE_SUPPORT_POLICY_VERSION,
      trainingTimePolicyVersion: CUSTOMER_CLV_TRAINING_PROTOCOL_VERSION,
      modelChecksum: selectedCandidate.modelChecksum,
    },
  };
}

function evaluateCandidateAcrossRollingOrigin(
  datasets: readonly CustomerClvBacktestDataset[],
  plan: readonly { readonly evaluationCutoff: string; readonly trainingCutoffs: readonly string[] }[],
  config: CandidateConfig,
): CustomerClvTwoStageCandidateEvaluation {
  const cutoffResults: CustomerClvTwoStagePerCutoffEvaluation[] = [];
  const prepared: PreparedPrediction[] = [];
  let latestFit: FittedCandidateModel | null = null;

  for (const planRow of plan) {
    const evaluationDataset = datasets.find((dataset) => dataset.manifest.cutoffTime === planRow.evaluationCutoff);
    if (!evaluationDataset) {
      throw new Error(`Missing evaluation dataset for cutoff ${planRow.evaluationCutoff}`);
    }
    const eligibleTraining = sortDatasetsByCutoff(datasets).filter(
      (dataset) =>
        Date.parse(dataset.manifest.cutoffTime) < Date.parse(planRow.evaluationCutoff) &&
        Date.parse(dataset.manifest.labelWindowEndExclusive) <= Date.parse(planRow.evaluationCutoff),
    );
    assertTrainingDatasetsMatureForEvaluation(eligibleTraining, planRow.evaluationCutoff);
    const activityTraining = selectTrainingWindow(eligibleTraining, config.activityTrainingWindow);
    const valueTraining = selectTrainingWindow(eligibleTraining, config.valueTrainingWindow);
    const fitted = fitCandidateModel({
      config,
      activityTrainingDatasets: activityTraining,
      valueTrainingDatasets: valueTraining,
    });
    latestFit = fitted;
    const predictions = fitted.predict(evaluationDataset);
    const preparedCutoff = pairDatasetWithPredictions(evaluationDataset, predictions);
    prepared.push(...preparedCutoff);
    cutoffResults.push(
      evaluatePreparedCutoff({
        evaluationDataset,
        prepared: preparedCutoff,
        activityTrainingCutoffs: fitted.activityTrainingCutoffs,
        valueTrainingCutoffs: fitted.valueTrainingCutoffs,
        trainingLabelWindowEndExclusive: fitted.trainingLabelWindowEndExclusive,
        modelChecksum: fitted.modelChecksum,
      }),
    );
  }

  if (!latestFit) {
    throw new Error(`Candidate ${config.candidateId} never fit any rolling-origin cutoff`);
  }

  const overallRevenueMetrics = buildRevenueMetrics(prepared);
  const overallActivityMetrics = buildActivityMetrics(prepared);
  const overallConditionalValueMetrics = buildConditionalValueMetrics(prepared);
  const modelChecksum = sha256Stable({
    candidateId: config.candidateId,
    modelVersion: CUSTOMER_CLV_MODEL_VERSION,
    perCutoffModelChecksums: cutoffResults.map((row) => ({ cutoffTime: row.cutoffTime, modelChecksum: row.modelChecksum })),
  });
  const evaluationChecksum = sha256Stable({
    candidateId: config.candidateId,
    revenueMetrics: overallRevenueMetrics,
    activityMetrics: overallActivityMetrics,
    conditionalValueMetrics: overallConditionalValueMetrics,
    topCapture: buildTopCapture(prepared),
  });

  return {
    candidateId: config.candidateId,
    modelVersion: CUSTOMER_CLV_MODEL_VERSION,
    modelFitVersion: CUSTOMER_CLV_TWO_STAGE_MODEL_FIT_VERSION,
    trainingProtocolVersion: CUSTOMER_CLV_TRAINING_PROTOCOL_VERSION,
    deterministicTiebreakPolicyVersion: CUSTOMER_CLV_DET_TIEBREAK_POLICY_VERSION,
    reliabilityPolicyVersion: CUSTOMER_CLV_TWO_STAGE_RELIABILITY_POLICY_VERSION,
    driftPolicy: latestFit.driftPolicy,
    activityModel: {
      exactDimensions: ['orderDepth', 'recency', 'tenure'],
      fallbackHierarchy: ['exact', 'order_recency', 'recency', 'global'],
      shrinkageStrength: {
        exact: CUSTOMER_CLV_TWO_STAGE_ACTIVITY_PRIOR_STRENGTH_EXACT,
        orderRecency: CUSTOMER_CLV_TWO_STAGE_ACTIVITY_PRIOR_STRENGTH_ORDER_RECENCY,
        recency: CUSTOMER_CLV_TWO_STAGE_ACTIVITY_PRIOR_STRENGTH_RECENCY,
      },
    },
    conditionalValueModel: {
      exactDimensions:
        config.valueCohortStrategy === 'order_depth_recency'
          ? ['orderDepth', 'recency']
          : ['orderDepth', 'recency', 'revenue365dBucket'],
      fallbackHierarchy: ['exact', 'order_recency', 'recency', 'global'],
      estimator: 'shrunk_arithmetic_mean',
      shrinkageStrength: {
        exact: CUSTOMER_CLV_TWO_STAGE_VALUE_PRIOR_STRENGTH_EXACT,
        orderRecency: CUSTOMER_CLV_TWO_STAGE_VALUE_PRIOR_STRENGTH_ORDER_RECENCY,
        recency: CUSTOMER_CLV_TWO_STAGE_VALUE_PRIOR_STRENGTH_RECENCY,
      },
    },
    modelChecksum,
    evaluationChecksum,
    cutoffResults,
    overallRevenueMetrics,
    overallActivityMetrics,
    overallConditionalValueMetrics,
    overallTopCapture: buildTopCapture(prepared),
    overallHistoryDepth: buildBucketMetrics(prepared, (entry) => historyDepthBucket(entry.example.features.historicalValidOrderCount)),
    overallRecency: buildBucketMetrics(prepared, (entry) => recencyBucket(entry.example.features.daysSinceLastOrder)),
    outlierSensitivity: buildOutlierSensitivity(prepared),
    activityProbabilityBands: buildActivityProbabilityBands(prepared),
    reliabilityResults: buildReliabilityRows(prepared),
    majorActivityCohorts: latestFit.majorActivityCohorts,
    majorValueCohorts: latestFit.majorValueCohorts,
    fallbackUsage: buildFallbackUsage(prepared),
    topCustomerSanityCheck: buildTopCustomerSanityCheck(prepared),
    selectionDiagnostics: {
      calibrationDistance:
        overallRevenueMetrics.calibrationRatio === null ? Number.POSITIVE_INFINITY : Math.abs(Number(overallRevenueMetrics.calibrationRatio) - 1),
      withinReasonableCalibrationBand:
        overallRevenueMetrics.calibrationRatio !== null &&
        Number(overallRevenueMetrics.calibrationRatio) >= 0.75 &&
        Number(overallRevenueMetrics.calibrationRatio) <= 2.25,
      oneOrderMae: buildBucketMetrics(prepared, (entry) => historyDepthBucket(entry.example.features.historicalValidOrderCount)).find(
        (row) => row.bucket === '1',
      )?.mae ?? null,
      calibrationStdDev: calibrationStdDev(cutoffResults.map((row) => row.revenueMetrics.calibrationRatio)),
    },
  };
}

function evaluateCorrectionCandidateAcrossRollingOrigin(
  datasets: readonly CustomerClvBacktestDataset[],
  plan: readonly { readonly evaluationCutoff: string; readonly trainingCutoffs: readonly string[] }[],
  config: CorrectionCandidateConfig,
): CustomerClvTwoStageCorrectionCandidateEvaluation {
  const cutoffResults: CustomerClvTwoStagePerCutoffEvaluation[] = [];
  const prepared: PreparedPrediction[] = [];
  let latestFit: FittedCandidateModel | null = null;

  for (const planRow of plan) {
    const evaluationDataset = datasets.find((dataset) => dataset.manifest.cutoffTime === planRow.evaluationCutoff);
    if (!evaluationDataset) {
      throw new Error(`Missing evaluation dataset for cutoff ${planRow.evaluationCutoff}`);
    }
    const eligibleTraining = sortDatasetsByCutoff(datasets).filter(
      (dataset) =>
        Date.parse(dataset.manifest.cutoffTime) < Date.parse(planRow.evaluationCutoff) &&
        Date.parse(dataset.manifest.labelWindowEndExclusive) <= Date.parse(planRow.evaluationCutoff),
    );
    assertTrainingDatasetsMatureForEvaluation(eligibleTraining, planRow.evaluationCutoff);
    const activityTraining = selectTrainingWindow(eligibleTraining, config.activityTrainingWindow);
    const valueTraining = selectTrainingWindow(eligibleTraining, config.valueTrainingWindow);
    const fitted = fitCandidateModel({
      config: {
        candidateId: config.candidateId,
        activityTrainingWindow: config.activityTrainingWindow,
        valueTrainingWindow: config.valueTrainingWindow,
        valueCohortStrategy: config.valueCohortStrategy,
      },
      activityTrainingDatasets: activityTraining,
      valueTrainingDatasets: valueTraining,
    });
    latestFit = fitted;
    const activityCalibration = buildActivityRecalibrationModel(activityTraining, fitted, config.activityRecalibration);
    const valueRankRefinement = buildValueRankRefinementModel(valueTraining, fitted, config);
    const modelChecksum = sha256Stable({
      candidateId: config.candidateId,
      baseModelChecksum: fitted.modelChecksum,
      activityRecalibration: activityCalibration.checksumShape,
      valueRankRefinement: valueRankRefinement.checksumShape,
    });
    const predictions = predictCorrectionDataset(evaluationDataset, fitted, activityCalibration, valueRankRefinement, config.candidateId);
    const preparedCutoff = pairDatasetWithPredictions(evaluationDataset, predictions);
    prepared.push(...preparedCutoff);
    cutoffResults.push(
      evaluatePreparedCutoff({
        evaluationDataset,
        prepared: preparedCutoff,
        activityTrainingCutoffs: fitted.activityTrainingCutoffs,
        valueTrainingCutoffs: fitted.valueTrainingCutoffs,
        trainingLabelWindowEndExclusive: fitted.trainingLabelWindowEndExclusive,
        modelChecksum,
      }),
    );
  }

  if (!latestFit) {
    throw new Error(`Correction candidate ${config.candidateId} never fit any rolling-origin cutoff`);
  }

  const overallRevenueMetrics = buildRevenueMetrics(prepared);
  const overallActivityMetrics = buildActivityMetrics(prepared);
  const overallConditionalValueMetrics = buildConditionalValueMetrics(prepared);
  const modelChecksum = sha256Stable({
    candidateId: config.candidateId,
    modelVersion: CUSTOMER_CLV_MODEL_VERSION,
    perCutoffModelChecksums: cutoffResults.map((row) => ({ cutoffTime: row.cutoffTime, modelChecksum: row.modelChecksum })),
  });
  const evaluationChecksum = sha256Stable({
    candidateId: config.candidateId,
    revenueMetrics: overallRevenueMetrics,
    activityMetrics: overallActivityMetrics,
    conditionalValueMetrics: overallConditionalValueMetrics,
    topCapture: buildTopCapture(prepared),
    tieDiagnostics: buildTieDiagnostics(prepared),
  });

  return {
    candidateId: config.candidateId,
    modelVersion: CUSTOMER_CLV_MODEL_VERSION,
    modelFitVersion: CUSTOMER_CLV_TWO_STAGE_MODEL_FIT_VERSION,
    trainingProtocolVersion: CUSTOMER_CLV_TRAINING_PROTOCOL_VERSION,
    deterministicTiebreakPolicyVersion: CUSTOMER_CLV_DET_TIEBREAK_POLICY_VERSION,
    reliabilityPolicyVersion: CUSTOMER_CLV_TWO_STAGE_RELIABILITY_POLICY_VERSION,
    driftPolicy: latestFit.driftPolicy,
    activityModel: {
      exactDimensions: ['orderDepth', 'recency', 'tenure'],
      fallbackHierarchy: ['exact', 'order_recency', 'recency', 'global'],
      shrinkageStrength: {
        exact: CUSTOMER_CLV_TWO_STAGE_ACTIVITY_PRIOR_STRENGTH_EXACT,
        orderRecency: CUSTOMER_CLV_TWO_STAGE_ACTIVITY_PRIOR_STRENGTH_ORDER_RECENCY,
        recency: CUSTOMER_CLV_TWO_STAGE_ACTIVITY_PRIOR_STRENGTH_RECENCY,
      },
    },
    conditionalValueModel: {
      exactDimensions: ['orderDepth', 'recency', 'revenue365dBucket'],
      fallbackHierarchy: ['exact', 'order_recency', 'recency', 'global'],
      estimator: 'shrunk_arithmetic_mean',
      shrinkageStrength: {
        exact: CUSTOMER_CLV_TWO_STAGE_VALUE_PRIOR_STRENGTH_EXACT,
        orderRecency: CUSTOMER_CLV_TWO_STAGE_VALUE_PRIOR_STRENGTH_ORDER_RECENCY,
        recency: CUSTOMER_CLV_TWO_STAGE_VALUE_PRIOR_STRENGTH_RECENCY,
      },
    },
    modelChecksum,
    evaluationChecksum,
    cutoffResults,
    overallRevenueMetrics,
    overallActivityMetrics,
    overallConditionalValueMetrics,
    overallTopCapture: buildTopCapture(prepared),
    overallHistoryDepth: buildBucketMetrics(prepared, (entry) => historyDepthBucket(entry.example.features.historicalValidOrderCount)),
    overallRecency: buildBucketMetrics(prepared, (entry) => recencyBucket(entry.example.features.daysSinceLastOrder)),
    outlierSensitivity: buildOutlierSensitivity(prepared),
    activityProbabilityBands: buildActivityProbabilityBands(prepared),
    reliabilityResults: buildReliabilityRows(prepared),
    majorActivityCohorts: latestFit.majorActivityCohorts,
    majorValueCohorts: latestFit.majorValueCohorts,
    fallbackUsage: buildFallbackUsage(prepared),
    topCustomerSanityCheck: buildTopCustomerSanityCheck(prepared),
    selectionDiagnostics: {
      calibrationDistance:
        overallRevenueMetrics.calibrationRatio === null ? Number.POSITIVE_INFINITY : Math.abs(Number(overallRevenueMetrics.calibrationRatio) - 1),
      withinReasonableCalibrationBand:
        overallRevenueMetrics.calibrationRatio !== null &&
        Number(overallRevenueMetrics.calibrationRatio) >= 0.75 &&
        Number(overallRevenueMetrics.calibrationRatio) <= 1.5,
      oneOrderMae: buildBucketMetrics(prepared, (entry) => historyDepthBucket(entry.example.features.historicalValidOrderCount)).find(
        (row) => row.bucket === '1',
      )?.mae ?? null,
      calibrationStdDev: calibrationStdDev(cutoffResults.map((row) => row.revenueMetrics.calibrationRatio)),
    },
    correctionPolicyVersion: CUSTOMER_CLV_TWO_STAGE_CORRECTION_SELECTION_POLICY_VERSION,
    activityRecalibration: {
      strategy: config.activityRecalibration,
      policyVersion:
        config.activityRecalibration === 'none'
          ? null
          : config.activityRecalibration === 'probability_band_stale_parent'
            ? CUSTOMER_CLV_TWO_STAGE_STALE_ACTIVITY_POLICY_VERSION
            : CUSTOMER_CLV_TWO_STAGE_ACTIVITY_RECALIBRATION_POLICY_VERSION,
      bandPolicyVersion: config.activityRecalibration === 'none' ? null : CUSTOMER_CLV_TWO_STAGE_ACTIVITY_BAND_POLICY_VERSION,
    },
    conditionalValueRankRefinement: {
      signal: config.valueRankSignal,
      lambda: formatDecimal(config.valueRankLambda.toFixed(2)),
      factorBounds:
        config.valueRankSignal === 'none'
          ? null
          : {
              min: formatDecimal(CUSTOMER_CLV_TWO_STAGE_VALUE_RANK_MIN_FACTOR.toFixed(6)),
              max: formatDecimal(CUSTOMER_CLV_TWO_STAGE_VALUE_RANK_MAX_FACTOR.toFixed(6)),
            },
      policyVersion:
        config.valueRankSignal === 'none' ? null : CUSTOMER_CLV_TWO_STAGE_VALUE_RANK_REFINEMENT_POLICY_VERSION,
    },
    tieDiagnosticsPolicyVersion: CUSTOMER_CLV_TWO_STAGE_TIE_DIAGNOSTICS_POLICY_VERSION,
    reliabilityScalePolicyVersion: CUSTOMER_CLV_TWO_STAGE_RELIABILITY_SCALE_POLICY_VERSION,
    rankingDiagnostics: buildRankingDiagnostics(prepared),
    tieDiagnostics: buildTieDiagnostics(prepared),
    observedActivityCohorts: buildObservedActivityCohorts(prepared),
    observedValueCohorts: buildObservedValueCohorts(prepared),
  };
}

function predictCorrectionDataset(
  dataset: CustomerClvBacktestDataset,
  fitted: FittedCandidateModel,
  activityCalibration: ActivityCalibrationModel,
  valueRankRefinement: ValueRankRefinementModel,
  candidateId: CustomerClvTwoStageCandidateId,
): readonly CustomerClvTwoStagePrediction[] {
  const basePredictions = fitted.predict(dataset);
  const baseByCustomer = new Map(basePredictions.map((prediction) => [prediction.customerId, prediction] as const));
  return [...dataset.rows]
    .sort((left, right) => left.customerId - right.customerId)
    .map((row) => {
      const base = baseByCustomer.get(row.customerId);
      if (!base) {
        throw new Error(`Missing base correction prediction for customerId ${row.customerId}`);
      }
      const calibratedActivity = activityCalibration.calibrate(row, base.predictedActiveProbability);
      const valueMultiplier = valueRankRefinement.multiplier(row, base);
      const expectedRevenueGivenActiveTaxIncl = moneyFromNumber(parseMoney(base.expectedRevenueGivenActiveTaxIncl) * parseMoney(valueMultiplier));
      const predictedRevenueTaxIncl = multiplyMoney(expectedRevenueGivenActiveTaxIncl, calibratedActivity);
      const expectedOrders =
        base.expectedOrders === undefined
          ? undefined
          : moneyFromNumber(
              parseProbability(base.predictedActiveProbability) === 0
                ? parseMoney(base.expectedOrders)
                : (parseMoney(base.expectedOrders) / parseProbability(base.predictedActiveProbability)) *
                    parseProbability(calibratedActivity),
            );
      return {
        ...base,
        candidateId,
        predictedRevenueTaxIncl,
        predictedActiveProbability: calibratedActivity,
        expectedRevenueGivenActiveTaxIncl,
        ...(expectedOrders === undefined ? {} : { expectedOrders }),
      } satisfies CustomerClvTwoStagePrediction;
    });
}

function fitCandidateModel(input: {
  readonly config: CandidateConfig;
  readonly activityTrainingDatasets: readonly CustomerClvBacktestDataset[];
  readonly valueTrainingDatasets: readonly CustomerClvBacktestDataset[];
}): FittedCandidateModel {
  const activityTrainingDatasets = sortDatasetsByCutoff(input.activityTrainingDatasets);
  const valueTrainingDatasets = sortDatasetsByCutoff(input.valueTrainingDatasets);
  if (activityTrainingDatasets.length === 0) {
    throw new Error(`Candidate ${input.config.candidateId} requires non-empty activity training datasets`);
  }
  if (valueTrainingDatasets.length === 0) {
    throw new Error(`Candidate ${input.config.candidateId} requires non-empty value training datasets`);
  }

  const globalActivityRate = averageRatio(activityTrainingDatasets.map((dataset) => activityRate(dataset.rows)));
  const activityRecencyCells = buildActivityCellMap(activityTrainingDatasets, recencyOnlyActivityKey);
  const activityOrderRecencyCells = buildActivityCellMap(activityTrainingDatasets, orderRecencyActivityKey);
  const activityExactCells = buildActivityCellMap(activityTrainingDatasets, exactActivityKey);
  const activityRecencyEstimates = shrinkActivityCells(
    activityRecencyCells,
    (key) => ({
      parentKey: null,
      priorRate: globalActivityRate,
      priorStrength: CUSTOMER_CLV_TWO_STAGE_ACTIVITY_PRIOR_STRENGTH_RECENCY,
      level: 'recency',
      key,
    }),
  );
  const activityOrderRecencyEstimates = shrinkActivityCells(
    activityOrderRecencyCells,
    (key) => ({
      parentKey: recencyOnlyActivityKeyFromOrderRecencyKey(key),
      priorRate: activityRecencyEstimates.get(recencyOnlyActivityKeyFromOrderRecencyKey(key))?.shrunkRate ?? globalActivityRate,
      priorStrength: CUSTOMER_CLV_TWO_STAGE_ACTIVITY_PRIOR_STRENGTH_ORDER_RECENCY,
      level: 'order_recency',
      key,
    }),
  );
  const activityExactEstimates = shrinkActivityCells(
    activityExactCells,
    (key) => ({
      parentKey: orderRecencyActivityKeyFromExactKey(key),
      priorRate: activityOrderRecencyEstimates.get(orderRecencyActivityKeyFromExactKey(key))?.shrunkRate ?? globalActivityRate,
      priorStrength: CUSTOMER_CLV_TWO_STAGE_ACTIVITY_PRIOR_STRENGTH_EXACT,
      level: 'exact',
      key,
    }),
  );

  const activeValueRows = valueTrainingDatasets.map((dataset) => ({
    cutoffTime: dataset.manifest.cutoffTime,
    rows: dataset.rows.filter((row) => compareDecimalAsc(row.labels.futureRevenueTaxIncl, '0.000000') > 0),
  }));
  const activeTrainingCustomerRows = activeValueRows.reduce((total, entry) => total + entry.rows.length, 0);
  if (activeTrainingCustomerRows === 0) {
    throw new Error(`Candidate ${input.config.candidateId} requires at least one active training customer`);
  }
  const globalValueMean = averageMoney(activeValueRows.map((entry) => averageMoney(entry.rows.map((row) => row.labels.futureRevenueTaxIncl))));
  const globalActiveOrdersMean = averageMoney(
    activeValueRows.map((entry) => averageNumberAsMoney(entry.rows.map((row) => row.labels.futureValidOrderCount))),
  );
  const valueRecencyCells = buildValueCellMap(valueTrainingDatasets, recencyOnlyValueKey);
  const valueOrderRecencyCells = buildValueCellMap(valueTrainingDatasets, orderRecencyValueKey);
  const valueExactKeyOf =
    input.config.valueCohortStrategy === 'order_depth_recency'
      ? exactValueKeyOrderRecencyOnly
      : input.config.valueCohortStrategy === 'order_depth_recency_revenue365d'
        ? exactValueKeyWithRevenueBucket
        : exactValueKeyWithRefinedRevenueBucket;
  const valueExactCells = buildValueCellMap(valueTrainingDatasets, valueExactKeyOf);
  const valueRecencyEstimates = shrinkValueCells(
    valueRecencyCells,
    (key) => ({
      parentKey: null,
      priorMeanRevenue: globalValueMean,
      priorMeanOrdersGivenActive: globalActiveOrdersMean,
      priorStrength: CUSTOMER_CLV_TWO_STAGE_VALUE_PRIOR_STRENGTH_RECENCY,
      level: 'recency',
      key,
    }),
  );
  const valueOrderRecencyEstimates = shrinkValueCells(
    valueOrderRecencyCells,
    (key) => {
      const parentKey = recencyOnlyValueKeyFromOrderRecencyKey(key);
      return {
        parentKey,
        priorMeanRevenue: valueRecencyEstimates.get(parentKey)?.shrunkMeanRevenue ?? globalValueMean,
        priorMeanOrdersGivenActive: valueRecencyEstimates.get(parentKey)?.shrunkMeanOrdersGivenActive ?? globalActiveOrdersMean,
        priorStrength: CUSTOMER_CLV_TWO_STAGE_VALUE_PRIOR_STRENGTH_ORDER_RECENCY,
        level: 'order_recency',
        key,
      };
    },
  );
  const valueExactEstimates = shrinkValueCells(
    valueExactCells,
    (key) => {
      const parentKey = orderRecencyValueKeyFromExactKey(key);
      return {
        parentKey,
        priorMeanRevenue: valueOrderRecencyEstimates.get(parentKey)?.shrunkMeanRevenue ?? globalValueMean,
        priorMeanOrdersGivenActive:
          valueOrderRecencyEstimates.get(parentKey)?.shrunkMeanOrdersGivenActive ?? globalActiveOrdersMean,
        priorStrength: CUSTOMER_CLV_TWO_STAGE_VALUE_PRIOR_STRENGTH_EXACT,
        level: 'exact',
        key,
      };
    },
  );

  const modelChecksum = sha256Stable({
    candidateId: input.config.candidateId,
    modelVersion: CUSTOMER_CLV_MODEL_VERSION,
    fitVersion: CUSTOMER_CLV_TWO_STAGE_MODEL_FIT_VERSION,
    activityTrainingCutoffs: activityTrainingDatasets.map((dataset) => dataset.manifest.cutoffTime),
    valueTrainingCutoffs: valueTrainingDatasets.map((dataset) => dataset.manifest.cutoffTime),
    activityGlobalRate: globalActivityRate,
    valueGlobalMean: globalValueMean,
    valueGlobalActiveOrdersMean: globalActiveOrdersMean,
    activityCells: {
      recency: Array.from(activityRecencyEstimates.values()).sort((left, right) => left.key.localeCompare(right.key)),
      orderRecency: Array.from(activityOrderRecencyEstimates.values()).sort((left, right) => left.key.localeCompare(right.key)),
      exact: Array.from(activityExactEstimates.values()).sort((left, right) => left.key.localeCompare(right.key)),
    },
    valueCells: {
      recency: Array.from(valueRecencyEstimates.values()).sort((left, right) => left.key.localeCompare(right.key)),
      orderRecency: Array.from(valueOrderRecencyEstimates.values()).sort((left, right) => left.key.localeCompare(right.key)),
      exact: Array.from(valueExactEstimates.values()).sort((left, right) => left.key.localeCompare(right.key)),
    },
  });

  return {
    candidateId: input.config.candidateId,
    modelVersion: CUSTOMER_CLV_MODEL_VERSION,
    activityTrainingCutoffs: activityTrainingDatasets.map((dataset) => dataset.manifest.cutoffTime),
    valueTrainingCutoffs: valueTrainingDatasets.map((dataset) => dataset.manifest.cutoffTime),
    trainingLabelWindowEndExclusive:
      valueTrainingDatasets.at(-1)?.manifest.labelWindowEndExclusive ?? activityTrainingDatasets.at(-1)!.manifest.labelWindowEndExclusive,
    modelChecksum,
    driftPolicy: {
      activityTrainingWindow: input.config.activityTrainingWindow,
      valueTrainingWindow: input.config.valueTrainingWindow,
      valueCohortStrategy: input.config.valueCohortStrategy,
    },
    majorActivityCohorts: summarizeTopActivityCohorts(activityExactEstimates),
    majorValueCohorts: summarizeTopValueCohorts(valueExactEstimates),
    predict(dataset) {
      if (dataset.rows.length === 0) {
        throw new Error(`Evaluation dataset for ${input.config.candidateId} must not be empty`);
      }
      return dataset.rows
        .map((row) => {
          const activity = resolveActivityEstimate(row, {
            globalActivityRate,
            exact: activityExactEstimates,
            orderRecency: activityOrderRecencyEstimates,
            recency: activityRecencyEstimates,
          });
          const value = resolveValueEstimate(row, {
            globalValueMean,
            globalActiveOrdersMean,
            exact: valueExactEstimates,
            orderRecency: valueOrderRecencyEstimates,
            recency: valueRecencyEstimates,
            strategy: input.config.valueCohortStrategy,
          });
          const predictedRevenueTaxIncl = multiplyMoney(value.shrunkMeanRevenue, activity.shrunkRate);
          const expectedOrders = multiplyMoney(value.shrunkMeanOrdersGivenActive, activity.shrunkRate);
          return {
            customerId: row.customerId,
            cutoffTime: row.cutoffTime,
            modelVersion: CUSTOMER_CLV_MODEL_VERSION,
            candidateId: input.config.candidateId,
            predictedRevenueTaxIncl,
            predictedActiveProbability: activity.shrunkRate,
            expectedRevenueGivenActiveTaxIncl: value.shrunkMeanRevenue,
            expectedOrders,
            activityCohortKey: activity.key,
            valueCohortKey: value.key,
            activitySupport: activity.support,
            valueSupport: value.support,
            activityTrainingCutoffCoverage: activity.cutoffCoverage,
            valueTrainingCutoffCoverage: value.cutoffCoverage,
            activityFallbackLevel: activity.level,
            valueFallbackLevel: value.level,
            reliabilityBucket: deriveReliabilityBucket(row, activity, value),
          } satisfies CustomerClvTwoStagePrediction;
        })
        .sort((left, right) => left.customerId - right.customerId);
    },
  };
}

function selectTrainingWindow(
  datasets: readonly CustomerClvBacktestDataset[],
  policy: CandidateConfig['activityTrainingWindow'] | CandidateConfig['valueTrainingWindow'],
): readonly CustomerClvBacktestDataset[] {
  if (policy === 'all_eligible_cutoffs') {
    return sortDatasetsByCutoff(datasets);
  }
  if (policy === 'recent_1_eligible_cutoffs') {
    return sortDatasetsByCutoff(datasets).slice(-1);
  }
  return sortDatasetsByCutoff(datasets).slice(-CUSTOMER_CLV_TWO_STAGE_RECENT_ACTIVITY_CUTOFF_WINDOW);
}

function buildActivityCellMap(
  datasets: readonly CustomerClvBacktestDataset[],
  keyOf: (row: CustomerClvBacktestExample) => string,
): ReadonlyMap<string, readonly { readonly rows: readonly CustomerClvBacktestExample[]; readonly cutoffTime: string }[]> {
  const grouped = new Map<string, { rows: CustomerClvBacktestExample[]; cutoffTime: string }[]>();
  for (const dataset of datasets) {
    const rowsByKey = new Map<string, CustomerClvBacktestExample[]>();
    for (const row of dataset.rows) {
      const key = keyOf(row);
      const rows = rowsByKey.get(key) ?? [];
      rows.push(row);
      rowsByKey.set(key, rows);
    }
    for (const [key, rows] of rowsByKey.entries()) {
      const entries = grouped.get(key) ?? [];
      entries.push({ cutoffTime: dataset.manifest.cutoffTime, rows });
      grouped.set(key, entries);
    }
  }
  return grouped;
}

function shrinkActivityCells(
  rawCells: ReadonlyMap<string, readonly { readonly rows: readonly CustomerClvBacktestExample[]; readonly cutoffTime: string }[]>,
  parentOf: (key: string) => {
    readonly parentKey: string | null;
    readonly priorRate: string;
    readonly priorStrength: number;
    readonly level: CustomerClvTwoStageFallbackLevel;
    readonly key: string;
  },
): ReadonlyMap<string, ActivityCellEstimate> {
  const result = new Map<string, ActivityCellEstimate>();
  for (const [key, byCutoff] of rawCells.entries()) {
    const support = byCutoff.reduce((total, entry) => total + entry.rows.length, 0);
    const rawRate = averageRatio(byCutoff.map((entry) => activityRate(entry.rows)));
    const parent = parentOf(key);
    result.set(key, {
      key,
      parentKey: parent.parentKey,
      level: parent.level,
      support,
      cutoffCoverage: byCutoff.length,
      rawRate,
      shrunkRate: ratioFromNumber(
        ((support * parseProbability(rawRate)) + parent.priorStrength * parseProbability(parent.priorRate)) /
          (support + parent.priorStrength),
      ),
    });
  }
  return result;
}

function buildValueCellMap(
  datasets: readonly CustomerClvBacktestDataset[],
  keyOf: (row: CustomerClvBacktestExample) => string,
): ReadonlyMap<string, readonly { readonly rows: readonly CustomerClvBacktestExample[]; readonly cutoffTime: string }[]> {
  const grouped = new Map<string, { rows: CustomerClvBacktestExample[]; cutoffTime: string }[]>();
  for (const dataset of datasets) {
    const activeRows = dataset.rows.filter((row) => compareDecimalAsc(row.labels.futureRevenueTaxIncl, '0.000000') > 0);
    const rowsByKey = new Map<string, CustomerClvBacktestExample[]>();
    for (const row of activeRows) {
      const key = keyOf(row);
      const rows = rowsByKey.get(key) ?? [];
      rows.push(row);
      rowsByKey.set(key, rows);
    }
    for (const [key, rows] of rowsByKey.entries()) {
      const entries = grouped.get(key) ?? [];
      entries.push({ cutoffTime: dataset.manifest.cutoffTime, rows });
      grouped.set(key, entries);
    }
  }
  return grouped;
}

function shrinkValueCells(
  rawCells: ReadonlyMap<string, readonly { readonly rows: readonly CustomerClvBacktestExample[]; readonly cutoffTime: string }[]>,
  parentOf: (key: string) => {
    readonly parentKey: string | null;
    readonly priorMeanRevenue: string;
    readonly priorMeanOrdersGivenActive: string;
    readonly priorStrength: number;
    readonly level: CustomerClvTwoStageFallbackLevel;
    readonly key: string;
  },
): ReadonlyMap<string, ValueCellEstimate> {
  const result = new Map<string, ValueCellEstimate>();
  for (const [key, byCutoff] of rawCells.entries()) {
    const support = byCutoff.reduce((total, entry) => total + entry.rows.length, 0);
    const rawMeanRevenue = averageMoney(
      byCutoff.map((entry) => averageMoney(entry.rows.map((row) => row.labels.futureRevenueTaxIncl))),
    );
    const rawMeanOrdersGivenActive = averageMoney(
      byCutoff.map((entry) => averageNumberAsMoney(entry.rows.map((row) => row.labels.futureValidOrderCount))),
    );
    const parent = parentOf(key);
    result.set(key, {
      key,
      parentKey: parent.parentKey,
      level: parent.level,
      support,
      cutoffCoverage: byCutoff.length,
      rawMeanRevenue,
      shrunkMeanRevenue: moneyFromNumber(
        ((support * parseMoney(rawMeanRevenue)) + parent.priorStrength * parseMoney(parent.priorMeanRevenue)) /
          (support + parent.priorStrength),
      ),
      rawMeanOrdersGivenActive,
      shrunkMeanOrdersGivenActive: moneyFromNumber(
        ((support * parseMoney(rawMeanOrdersGivenActive)) +
          parent.priorStrength * parseMoney(parent.priorMeanOrdersGivenActive)) /
          (support + parent.priorStrength),
      ),
    });
  }
  return result;
}

function resolveActivityEstimate(
  row: CustomerClvBacktestExample,
  estimates: {
    readonly globalActivityRate: string;
    readonly exact: ReadonlyMap<string, ActivityCellEstimate>;
    readonly orderRecency: ReadonlyMap<string, ActivityCellEstimate>;
    readonly recency: ReadonlyMap<string, ActivityCellEstimate>;
  },
): ActivityCellEstimate {
  const exactKey = exactActivityKey(row);
  const exact = estimates.exact.get(exactKey);
  if (exact) return exact;
  const orderRecencyKey = orderRecencyActivityKey(row);
  const orderRecency = estimates.orderRecency.get(orderRecencyKey);
  if (orderRecency) return orderRecency;
  const recencyKey = recencyOnlyActivityKey(row);
  const recency = estimates.recency.get(recencyKey);
  if (recency) return recency;
  return {
    key: 'global',
    parentKey: null,
    level: 'global',
    support: 0,
    cutoffCoverage: 0,
    rawRate: estimates.globalActivityRate,
    shrunkRate: estimates.globalActivityRate,
  };
}

function resolveValueEstimate(
  row: CustomerClvBacktestExample,
  estimates: {
    readonly globalValueMean: string;
    readonly globalActiveOrdersMean: string;
    readonly exact: ReadonlyMap<string, ValueCellEstimate>;
    readonly orderRecency: ReadonlyMap<string, ValueCellEstimate>;
    readonly recency: ReadonlyMap<string, ValueCellEstimate>;
    readonly strategy: CandidateConfig['valueCohortStrategy'];
  },
): ValueCellEstimate {
  const exactKey =
    estimates.strategy === 'order_depth_recency'
      ? exactValueKeyOrderRecencyOnly(row)
      : estimates.strategy === 'order_depth_recency_revenue365d'
        ? exactValueKeyWithRevenueBucket(row)
        : exactValueKeyWithRefinedRevenueBucket(row);
  const exact = estimates.exact.get(exactKey);
  if (exact) return exact;
  const orderRecencyKey = orderRecencyValueKey(row);
  const orderRecency = estimates.orderRecency.get(orderRecencyKey);
  if (orderRecency) return orderRecency;
  const recencyKey = recencyOnlyValueKey(row);
  const recency = estimates.recency.get(recencyKey);
  if (recency) return recency;
  return {
    key: 'global',
    parentKey: null,
    level: 'global',
    support: 0,
    cutoffCoverage: 0,
    rawMeanRevenue: estimates.globalValueMean,
    shrunkMeanRevenue: estimates.globalValueMean,
    rawMeanOrdersGivenActive: estimates.globalActiveOrdersMean,
    shrunkMeanOrdersGivenActive: estimates.globalActiveOrdersMean,
  };
}

function buildActivityRecalibrationModel(
  trainingDatasets: readonly CustomerClvBacktestDataset[],
  fitted: FittedCandidateModel,
  strategy: CorrectionCandidateConfig['activityRecalibration'],
): ActivityCalibrationModel {
  const globalActivityRate = averageRatio(trainingDatasets.map((dataset) => activityRate(dataset.rows)));
  if (strategy === 'none') {
    return {
      strategy,
      globalActivityRate,
      checksumShape: { strategy, globalActivityRate },
      calibrate: (_row, baseProbability) => baseProbability,
    };
  }

  const trainingPrepared = trainingDatasets.flatMap((dataset) => pairDatasetWithPredictions(dataset, fitted.predict(dataset)));
  const bandCells = buildPreparedRateMap(trainingPrepared, (entry) => probabilityBand(parseProbability(entry.prediction.predictedActiveProbability)));
  const bandEstimates = monotonicizeActivityCalibrationEstimates(
    shrinkActivityCalibrationCells(
      bandCells,
      (key) => ({
        parentKey: null,
        priorRate: globalActivityRate,
        priorStrength: CUSTOMER_CLV_TWO_STAGE_ACTIVITY_RECALIBRATION_BAND_PRIOR_STRENGTH,
        key,
      }),
    ),
    (_key) => 'all',
    (key) => key,
  );

  if (strategy === 'probability_band') {
    return {
      strategy,
      globalActivityRate,
      checksumShape: {
        strategy,
        globalActivityRate,
        bandEstimates: Array.from(bandEstimates.values()).sort((left, right) => left.key.localeCompare(right.key)),
      },
      calibrate: (_row, baseProbability) =>
        bandEstimates.get(probabilityBand(parseProbability(baseProbability)))?.shrunkObservedRate ?? globalActivityRate,
    };
  }

  const recencyBucketOf =
    strategy === 'probability_band_stale_parent' ? staleCalibrationRecencyBucket : broadRecencyCalibrationBucket;
  const recencyCells = buildPreparedRateMap(trainingPrepared, (entry) => recencyBucketOf(entry.example.features.daysSinceLastOrder));
  const recencyEstimates = shrinkActivityCalibrationCells(
    recencyCells,
    (key) => ({
      parentKey: null,
      priorRate: globalActivityRate,
      priorStrength: CUSTOMER_CLV_TWO_STAGE_ACTIVITY_RECALIBRATION_BAND_PRIOR_STRENGTH,
      key,
    }),
  );
  const bandRecencyCells = buildPreparedRateMap(
    trainingPrepared,
    (entry) => `${recencyBucketOf(entry.example.features.daysSinceLastOrder)}|band:${probabilityBand(parseProbability(entry.prediction.predictedActiveProbability))}`,
  );
  const bandRecencyEstimates = monotonicizeActivityCalibrationEstimates(
    shrinkActivityCalibrationCells(
      bandRecencyCells,
      (key) => {
        const bandKey = key.split('|band:')[1];
        const recencyKey = key.split('|band:')[0];
        if (bandKey === undefined) {
          throw new Error(`Invalid activity recalibration key: ${key}`);
        }
        return {
          parentKey: recencyKey ?? bandKey,
          priorRate:
            strategy === 'probability_band_stale_parent'
              ? recencyEstimates.get(recencyKey ?? '')?.shrunkObservedRate ?? globalActivityRate
              : bandEstimates.get(bandKey)?.shrunkObservedRate ?? globalActivityRate,
          priorStrength: CUSTOMER_CLV_TWO_STAGE_ACTIVITY_RECALIBRATION_BAND_RECENCY_PRIOR_STRENGTH,
          key,
        };
      },
    ),
    (key) => key.split('|band:')[0] ?? 'all',
    (key) => key.split('|band:')[1] ?? key,
  );

  return {
    strategy,
    globalActivityRate,
    checksumShape: {
      strategy,
      globalActivityRate,
      bandEstimates: Array.from(bandEstimates.values()).sort((left, right) => left.key.localeCompare(right.key)),
      recencyEstimates: Array.from(recencyEstimates.values()).sort((left, right) => left.key.localeCompare(right.key)),
      bandRecencyEstimates: Array.from(bandRecencyEstimates.values()).sort((left, right) => left.key.localeCompare(right.key)),
    },
    calibrate: (row, baseProbability) => {
      const bandKey = probabilityBand(parseProbability(baseProbability));
      const recencyKey = recencyBucketOf(row.features.daysSinceLastOrder);
      const bandRecencyKey = `${recencyKey}|band:${bandKey}`;
      return (
        bandRecencyEstimates.get(bandRecencyKey)?.shrunkObservedRate ??
        recencyEstimates.get(recencyKey)?.shrunkObservedRate ??
        bandEstimates.get(bandKey)?.shrunkObservedRate ??
        globalActivityRate
      );
    },
  };
}

function buildValueRankRefinementModel(
  trainingDatasets: readonly CustomerClvBacktestDataset[],
  fitted: FittedCandidateModel,
  config: CorrectionCandidateConfig,
): ValueRankRefinementModel {
  if (config.valueRankSignal === 'none' || config.valueRankLambda === 0) {
    return {
      signal: 'none',
      lambda: 0,
      checksumShape: { signal: 'none', lambda: 0 },
      multiplier: () => '1.000000',
    };
  }

  const activeTrainingRows = trainingDatasets.flatMap((dataset) =>
    dataset.rows.filter((row) => compareDecimalAsc(row.labels.futureRevenueTaxIncl, '0.000000') > 0),
  );
  const globalMeanSignal = meanNumber(activeTrainingRows.map((row) => historicalRevenueSignal(row.features.revenue365d)));
  const recencySignalEstimates = shrinkValueSignalCells(
    buildSignalCellMap(activeTrainingRows, recencyOnlyValueKey),
    (key) => ({
      key,
      level: 'recency',
      priorMeanSignal: globalMeanSignal,
      priorStrength: CUSTOMER_CLV_TWO_STAGE_VALUE_SIGNAL_PRIOR_STRENGTH_RECENCY,
    }),
  );
  const orderRecencySignalEstimates = shrinkValueSignalCells(
    buildSignalCellMap(activeTrainingRows, orderRecencyValueKey),
    (key) => {
      const parentKey = recencyOnlyValueKeyFromOrderRecencyKey(key);
      return {
        key,
        level: 'order_recency',
        priorMeanSignal: recencySignalEstimates.get(parentKey)?.shrunkMeanSignal ?? globalMeanSignal,
        priorStrength: CUSTOMER_CLV_TWO_STAGE_VALUE_SIGNAL_PRIOR_STRENGTH_ORDER_RECENCY,
      };
    },
  );
  const exactKeyOf =
    config.valueCohortStrategy === 'order_depth_recency_revenue365d'
      ? exactValueKeyWithRevenueBucket
      : exactValueKeyWithRefinedRevenueBucket;
  const exactSignalEstimates = shrinkValueSignalCells(
    buildSignalCellMap(activeTrainingRows, exactKeyOf),
    (key) => {
      const parentKey = orderRecencyValueKeyFromExactKey(key);
      return {
        key,
        level: 'exact',
        priorMeanSignal: orderRecencySignalEstimates.get(parentKey)?.shrunkMeanSignal ?? globalMeanSignal,
        priorStrength: CUSTOMER_CLV_TWO_STAGE_VALUE_SIGNAL_PRIOR_STRENGTH_EXACT,
      };
    },
  );

  const activePrepared = trainingDatasets
    .flatMap((dataset) => pairDatasetWithPredictions(dataset, fitted.predict(dataset)))
    .filter((entry) => compareDecimalAsc(entry.example.labels.futureRevenueTaxIncl, '0.000000') > 0);
  const normalizationMeans = new Map<string, string>();
  const grouped = new Map<string, number[]>();
  for (const entry of activePrepared) {
    const groupKey = valueRankGroupKey(entry.prediction);
    const rows = grouped.get(groupKey) ?? [];
    rows.push(
      preNormalizedValueRankFactor(entry.example, entry.prediction, {
        lambda: config.valueRankLambda,
        globalMeanSignal,
        exact: exactSignalEstimates,
        orderRecency: orderRecencySignalEstimates,
        recency: recencySignalEstimates,
      }),
    );
    grouped.set(groupKey, rows);
  }
  for (const [groupKey, values] of grouped.entries()) {
    normalizationMeans.set(groupKey, moneyFromNumber(meanNumber(values)));
  }

  return {
    signal: config.valueRankSignal,
    lambda: config.valueRankLambda,
    checksumShape: {
      signal: config.valueRankSignal,
      lambda: config.valueRankLambda,
      globalMeanSignal: roundNumber(globalMeanSignal),
      recencySignalEstimates: Array.from(recencySignalEstimates.values())
        .sort((left, right) => left.key.localeCompare(right.key))
        .map(signalEstimateChecksumShape),
      orderRecencySignalEstimates: Array.from(orderRecencySignalEstimates.values())
        .sort((left, right) => left.key.localeCompare(right.key))
        .map(signalEstimateChecksumShape),
      exactSignalEstimates: Array.from(exactSignalEstimates.values())
        .sort((left, right) => left.key.localeCompare(right.key))
        .map(signalEstimateChecksumShape),
      normalizationMeans: Array.from(normalizationMeans.entries()).sort(([left], [right]) => left.localeCompare(right)),
    },
    multiplier: (row, prediction) => {
      const groupKey = valueRankGroupKey(prediction);
      const preNormalized = preNormalizedValueRankFactor(row, prediction, {
        lambda: config.valueRankLambda,
        globalMeanSignal,
        exact: exactSignalEstimates,
        orderRecency: orderRecencySignalEstimates,
        recency: recencySignalEstimates,
      });
      const normalizationMean = parseMoney(normalizationMeans.get(groupKey) ?? '1.000000');
      if (normalizationMean === 0) return '1.000000';
      return moneyFromNumber(preNormalized / normalizationMean);
    },
  };
}

function signalEstimateChecksumShape(cell: ValueSignalCellEstimate) {
  return {
    key: cell.key,
    level: cell.level,
    support: cell.support,
    shrunkMeanSignal: roundNumber(cell.shrunkMeanSignal),
  };
}

function preNormalizedValueRankFactor(
  row: CustomerClvBacktestExample,
  prediction: CustomerClvTwoStagePrediction,
  estimates: {
    readonly lambda: number;
    readonly globalMeanSignal: number;
    readonly exact: ReadonlyMap<string, ValueSignalCellEstimate>;
    readonly orderRecency: ReadonlyMap<string, ValueSignalCellEstimate>;
    readonly recency: ReadonlyMap<string, ValueSignalCellEstimate>;
  },
): number {
  const signal = historicalRevenueSignal(row.features.revenue365d);
  const meanSignal = resolveValueSignalMean(prediction, estimates);
  if (meanSignal <= 0) {
    return 1;
  }
  const rawFactor = signal / meanSignal;
  return clampNumber(
    1 + estimates.lambda * (rawFactor - 1),
    CUSTOMER_CLV_TWO_STAGE_VALUE_RANK_MIN_FACTOR,
    CUSTOMER_CLV_TWO_STAGE_VALUE_RANK_MAX_FACTOR,
  );
}

function resolveValueSignalMean(
  prediction: CustomerClvTwoStagePrediction,
  estimates: {
    readonly globalMeanSignal: number;
    readonly exact: ReadonlyMap<string, ValueSignalCellEstimate>;
    readonly orderRecency: ReadonlyMap<string, ValueSignalCellEstimate>;
    readonly recency: ReadonlyMap<string, ValueSignalCellEstimate>;
  },
): number {
  if (prediction.valueFallbackLevel === 'exact') {
    return estimates.exact.get(prediction.valueCohortKey)?.shrunkMeanSignal ?? estimates.globalMeanSignal;
  }
  if (prediction.valueFallbackLevel === 'order_recency') {
    return estimates.orderRecency.get(prediction.valueCohortKey)?.shrunkMeanSignal ?? estimates.globalMeanSignal;
  }
  if (prediction.valueFallbackLevel === 'recency') {
    return estimates.recency.get(prediction.valueCohortKey)?.shrunkMeanSignal ?? estimates.globalMeanSignal;
  }
  return estimates.globalMeanSignal;
}

function valueRankGroupKey(prediction: CustomerClvTwoStagePrediction): string {
  return `${prediction.valueFallbackLevel}|${prediction.valueCohortKey}`;
}

function historicalRevenueSignal(revenue365d: string): number {
  return Math.log1p(parseMoney(revenue365d));
}

function buildPreparedRateMap(
  prepared: readonly PreparedPrediction[],
  keyOf: (entry: PreparedPrediction) => string,
): ReadonlyMap<string, readonly PreparedPrediction[]> {
  const grouped = new Map<string, PreparedPrediction[]>();
  for (const entry of prepared) {
    const key = keyOf(entry);
    const rows = grouped.get(key) ?? [];
    rows.push(entry);
    grouped.set(key, rows);
  }
  return grouped;
}

function shrinkActivityCalibrationCells(
  rawCells: ReadonlyMap<string, readonly PreparedPrediction[]>,
  parentOf: (key: string) => {
    readonly parentKey: string | null;
    readonly priorRate: string;
    readonly priorStrength: number;
    readonly key: string;
  },
): ReadonlyMap<string, ActivityCalibrationCellEstimate> {
  const result = new Map<string, ActivityCalibrationCellEstimate>();
  for (const [key, rows] of rawCells.entries()) {
    const support = rows.length;
    const rawObservedRate = ratioString(
      rows.filter((entry) => entry.example.labels.futureValidOrderCount > 0).length,
      support,
    );
    const parent = parentOf(key);
    result.set(key, {
      key,
      parentKey: parent.parentKey,
      support,
      cutoffCoverage: new Set(rows.map((entry) => entry.example.cutoffTime)).size,
      rawObservedRate,
      shrunkObservedRate: ratioFromNumber(
        ((support * parseProbability(rawObservedRate)) + parent.priorStrength * parseProbability(parent.priorRate)) /
          (support + parent.priorStrength),
      ),
    });
  }
  return result;
}

function monotonicizeActivityCalibrationEstimates(
  estimates: ReadonlyMap<string, ActivityCalibrationCellEstimate>,
  groupKeyOf: (key: string) => string,
  bandKeyOf: (key: string) => string,
): ReadonlyMap<string, ActivityCalibrationCellEstimate> {
  const result = new Map(estimates);
  const keysByGroup = new Map<string, string[]>();
  for (const key of estimates.keys()) {
    const group = groupKeyOf(key);
    const keys = keysByGroup.get(group) ?? [];
    keys.push(key);
    keysByGroup.set(group, keys);
  }
  for (const keys of keysByGroup.values()) {
    let floor = 0;
    for (const key of [...keys].sort((left, right) => probabilityBandOrder(bandKeyOf(left)) - probabilityBandOrder(bandKeyOf(right)))) {
      const current = result.get(key);
      if (!current) continue;
      floor = Math.max(floor, parseProbability(current.shrunkObservedRate));
      result.set(key, {
        ...current,
        shrunkObservedRate: ratioFromNumber(floor),
      });
    }
  }
  return result;
}

function buildSignalCellMap(
  rows: readonly CustomerClvBacktestExample[],
  keyOf: (row: CustomerClvBacktestExample) => string,
): ReadonlyMap<string, readonly CustomerClvBacktestExample[]> {
  const grouped = new Map<string, CustomerClvBacktestExample[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }
  return grouped;
}

function shrinkValueSignalCells(
  rawCells: ReadonlyMap<string, readonly CustomerClvBacktestExample[]>,
  parentOf: (key: string) => {
    readonly key: string;
    readonly level: CustomerClvTwoStageFallbackLevel;
    readonly priorMeanSignal: number;
    readonly priorStrength: number;
  },
): ReadonlyMap<string, ValueSignalCellEstimate> {
  const result = new Map<string, ValueSignalCellEstimate>();
  for (const [key, rows] of rawCells.entries()) {
    const support = rows.length;
    const rawMeanSignal = meanNumber(rows.map((row) => historicalRevenueSignal(row.features.revenue365d)));
    const parent = parentOf(key);
    result.set(key, {
      key,
      level: parent.level,
      support,
      shrunkMeanSignal:
        ((support * rawMeanSignal) + parent.priorStrength * parent.priorMeanSignal) / (support + parent.priorStrength),
    });
  }
  return result;
}

function broadRecencyCalibrationBucket(daysSinceLastOrder: number): '0-180d' | '181-730d' | '>730d' {
  if (daysSinceLastOrder <= 180) return '0-180d';
  if (daysSinceLastOrder <= 730) return '181-730d';
  return '>730d';
}

function staleCalibrationRecencyBucket(daysSinceLastOrder: number): '0-180d' | '181-365d' | '366-730d' | '731-1095d' | '>1095d' {
  if (daysSinceLastOrder <= 180) return '0-180d';
  if (daysSinceLastOrder <= 365) return '181-365d';
  if (daysSinceLastOrder <= 730) return '366-730d';
  if (daysSinceLastOrder <= 1095) return '731-1095d';
  return '>1095d';
}

function probabilityBandOrder(band: string): number {
  return ['[0.00,0.05]', '(0.05,0.10]', '(0.10,0.20]', '(0.20,0.35]', '(0.35,1.00]'].indexOf(band);
}

function deriveReliabilityBucket(
  row: CustomerClvBacktestExample,
  activity: ActivityCellEstimate,
  value: ValueCellEstimate,
): CustomerClvReliabilityBucket {
  const maxFallbackDepth = Math.max(fallbackDepth(activity.level), fallbackDepth(value.level));
  const minCutoffCoverage = Math.min(activity.cutoffCoverage, value.cutoffCoverage);
  if (
    maxFallbackDepth >= 2 ||
    activity.support < CUSTOMER_CLV_TWO_STAGE_SUPPORT_LOW_MIN_ACTIVITY_SUPPORT ||
    value.support < CUSTOMER_CLV_TWO_STAGE_SUPPORT_LOW_MIN_VALUE_SUPPORT ||
    minCutoffCoverage < CUSTOMER_CLV_TWO_STAGE_SUPPORT_LOW_MIN_CUTOFF_COVERAGE ||
    row.features.daysSinceLastOrder > 730
  ) {
    return 'LOW';
  }
  return 'MEDIUM';
}

function fallbackDepth(level: CustomerClvTwoStageFallbackLevel): number {
  if (level === 'exact') return 0;
  if (level === 'order_recency') return 1;
  if (level === 'recency') return 2;
  return 3;
}

function evaluatePreparedCutoff(input: {
  readonly evaluationDataset: CustomerClvBacktestDataset;
  readonly prepared: readonly PreparedPrediction[];
  readonly activityTrainingCutoffs: readonly string[];
  readonly valueTrainingCutoffs: readonly string[];
  readonly trainingLabelWindowEndExclusive: string;
  readonly modelChecksum: string;
}): CustomerClvTwoStagePerCutoffEvaluation {
  return {
    cutoffTime: input.evaluationDataset.manifest.cutoffTime,
    activityTrainingCutoffs: input.activityTrainingCutoffs,
    valueTrainingCutoffs: input.valueTrainingCutoffs,
    trainingLabelWindowEndExclusive: input.trainingLabelWindowEndExclusive,
    modelChecksum: input.modelChecksum,
    predictionChecksum: sha256Stable(
      input.prepared.map((entry) => ({
        customerId: entry.example.customerId,
        predictedRevenueTaxIncl: entry.prediction.predictedRevenueTaxIncl,
        predictedActiveProbability: entry.prediction.predictedActiveProbability,
        expectedRevenueGivenActiveTaxIncl: entry.prediction.expectedRevenueGivenActiveTaxIncl,
        reliabilityBucket: entry.prediction.reliabilityBucket,
      })),
    ),
    revenueMetrics: buildRevenueMetrics(input.prepared),
    activityMetrics: buildActivityMetrics(input.prepared),
    conditionalValueMetrics: buildConditionalValueMetrics(input.prepared),
    topCapture: buildTopCapture(input.prepared),
    deciles: buildDecileTable(input.prepared),
    historyDepth: buildBucketMetrics(input.prepared, (entry) => historyDepthBucket(entry.example.features.historicalValidOrderCount)),
    recency: buildBucketMetrics(input.prepared, (entry) => recencyBucket(entry.example.features.daysSinceLastOrder)),
    activityProbabilityBands: buildActivityProbabilityBands(input.prepared),
    reliability: buildReliabilityRows(input.prepared),
    recencyAudit: buildRecencyAuditRows(input.prepared),
  };
}

function pairDatasetWithPredictions(
  dataset: CustomerClvBacktestDataset,
  predictions: readonly CustomerClvTwoStagePrediction[],
): readonly PreparedPrediction[] {
  if (dataset.rows.length === 0) {
    throw new Error('CLV two-stage evaluation dataset must not be empty');
  }
  if (predictions.length !== dataset.rows.length) {
    throw new Error('CLV two-stage prediction count mismatch');
  }
  const predictionByCustomer = new Map<number, CustomerClvTwoStagePrediction>();
  for (const prediction of predictions) {
    if (prediction.cutoffTime !== dataset.manifest.cutoffTime) {
      throw new Error(`CLV two-stage prediction cutoff mismatch for customerId ${prediction.customerId}`);
    }
    if (predictionByCustomer.has(prediction.customerId)) {
      throw new Error(`CLV two-stage duplicate prediction for customerId ${prediction.customerId}`);
    }
    predictionByCustomer.set(prediction.customerId, {
      ...prediction,
      predictedRevenueTaxIncl: moneyFromNumber(parseMoney(prediction.predictedRevenueTaxIncl)),
      predictedActiveProbability: ratioFromNumber(parseProbability(prediction.predictedActiveProbability)),
      expectedRevenueGivenActiveTaxIncl: moneyFromNumber(parseMoney(prediction.expectedRevenueGivenActiveTaxIncl)),
      ...(prediction.expectedOrders === undefined ? {} : { expectedOrders: moneyFromNumber(parseMoney(prediction.expectedOrders)) }),
    });
  }
  return [...dataset.rows]
    .sort((left, right) => left.customerId - right.customerId)
    .map((row) => {
      const prediction = predictionByCustomer.get(row.customerId);
      if (!prediction) {
        throw new Error(`CLV two-stage missing prediction for customerId ${row.customerId}`);
      }
      return { example: row, prediction };
    });
}

function buildRevenueMetrics(prepared: readonly PreparedPrediction[]): CustomerClvRevenueMetrics {
  return buildRevenueMetricsWithPrepared(prepared, (entry) => entry.prediction.predictedRevenueTaxIncl);
}

function buildConditionalValueMetrics(prepared: readonly PreparedPrediction[]): CustomerClvTwoStageConditionalValueSummary {
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
      predictedMeanRevenueGivenActiveTaxIncl: null,
      actualMeanRevenueGivenActiveTaxIncl: null,
    };
  }
  const metrics = buildRevenueMetricsWithPrepared(active, (entry) => entry.prediction.expectedRevenueGivenActiveTaxIncl);
  return {
    activeCustomerCount: active.length,
    predictedTotalRevenue: metrics.predictedTotalRevenue,
    actualTotalRevenue: metrics.actualTotalRevenue,
    calibrationRatio: metrics.calibrationRatio,
    mae: metrics.mae,
    medianAbsoluteError: metrics.medianAbsoluteError,
    rmse: metrics.rmse,
    spearmanRankCorrelation: metrics.spearmanRankCorrelation,
    predictedMeanRevenueGivenActiveTaxIncl: metrics.meanPrediction,
    actualMeanRevenueGivenActiveTaxIncl: metrics.meanActualRevenue,
  };
}

function buildRevenueMetricsWithPrepared(
  prepared: readonly PreparedPrediction[],
  predictedValueOf: (entry: PreparedPrediction) => string,
): CustomerClvRevenueMetrics {
  const actuals = prepared.map((entry) => entry.example.labels.futureRevenueTaxIncl);
  const predictions = prepared.map(predictedValueOf);
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

function buildActivityMetrics(prepared: readonly PreparedPrediction[]): CustomerClvTwoStageActivitySummary {
  const active = prepared.filter((entry) => entry.example.labels.futureValidOrderCount > 0);
  const probabilities = prepared.map((entry) => parseProbability(entry.prediction.predictedActiveProbability));
  const activityFlags = prepared.map((entry) => (entry.example.labels.futureValidOrderCount > 0 ? 1 : 0));
  return {
    zeroFutureRevenueRate: ratioString(
      prepared.filter((entry) => compareDecimalAsc(entry.example.labels.futureRevenueTaxIncl, '0.000000') === 0).length,
      prepared.length,
    ),
    positiveFutureRevenueRate: ratioString(active.length, prepared.length),
    actualActivityRate: ratioString(active.length, prepared.length),
    meanRevenueAmongActiveCustomers: active.length === 0 ? null : averageMoney(active.map((entry) => entry.example.labels.futureRevenueTaxIncl)),
    medianRevenueAmongActiveCustomers: active.length === 0 ? null : medianDecimal(active.map((entry) => entry.example.labels.futureRevenueTaxIncl)),
    rocAuc: decimalMetric(rocAuc(probabilities, activityFlags)),
    prAuc: decimalMetric(prAuc(probabilities, activityFlags)),
    brierScore: decimalMetric(meanNumber(probabilities.map((value, index) => (value - activityFlags[index]!) ** 2))),
    predictedActivityRate: ratioFromNumber(meanNumber(probabilities)),
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

function buildActivityProbabilityBands(prepared: readonly PreparedPrediction[]): readonly CustomerClvTwoStageProbabilityBandRow[] {
  const grouped = new Map<string, PreparedPrediction[]>();
  for (const entry of prepared) {
    const band = probabilityBand(parseProbability(entry.prediction.predictedActiveProbability));
    const rows = grouped.get(band) ?? [];
    rows.push(entry);
    grouped.set(band, rows);
  }
  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([band, entries]) => {
      const predicted = meanNumber(entries.map((entry) => parseProbability(entry.prediction.predictedActiveProbability)));
      const actual = meanNumber(entries.map((entry) => (entry.example.labels.futureValidOrderCount > 0 ? 1 : 0)));
      return {
        band,
        customerCount: entries.length,
        meanPredictedActivityProbability: ratioFromNumber(predicted),
        actualActivityRate: ratioFromNumber(actual),
        calibrationRatio: actual === 0 ? null : ratioFromNumber(predicted / actual),
      };
    });
}

function probabilityBand(probability: number): string {
  if (probability <= 0.05) return '[0.00,0.05]';
  if (probability <= 0.10) return '(0.05,0.10]';
  if (probability <= 0.20) return '(0.10,0.20]';
  if (probability <= 0.35) return '(0.20,0.35]';
  return '(0.35,1.00]';
}

function buildReliabilityRows(prepared: readonly PreparedPrediction[]): readonly CustomerClvTwoStageReliabilityRow[] {
  const grouped = new Map<CustomerClvReliabilityBucket, PreparedPrediction[]>();
  for (const entry of prepared) {
    const rows = grouped.get(entry.prediction.reliabilityBucket) ?? [];
    rows.push(entry);
    grouped.set(entry.prediction.reliabilityBucket, rows);
  }
  return (['LOW', 'MEDIUM', 'HIGH'] as const)
    .filter((bucket) => grouped.has(bucket))
    .map((bucket) => {
      const entries = grouped.get(bucket)!;
      const revenue = buildRevenueMetrics(entries);
      const predictedActivityRate = meanNumber(entries.map((entry) => parseProbability(entry.prediction.predictedActiveProbability)));
      const actualActivityRate = meanNumber(entries.map((entry) => (entry.example.labels.futureValidOrderCount > 0 ? 1 : 0)));
      const normalizedErrors = entries.map((entry) =>
        normalizedAbsoluteError(
          parseMoney(entry.prediction.predictedRevenueTaxIncl),
          parseMoney(entry.example.labels.futureRevenueTaxIncl),
        ),
      );
      return {
        reliabilityBucket: bucket,
        customerCount: entries.length,
        populationShare: ratioString(entries.length, prepared.length),
        predictedActivityRate: ratioFromNumber(predictedActivityRate),
        actualActivityRate: ratioFromNumber(actualActivityRate),
        activityCalibrationRatio: actualActivityRate === 0 ? null : ratioFromNumber(predictedActivityRate / actualActivityRate),
        calibrationRatio: revenue.calibrationRatio,
        mae: revenue.mae,
        normalizedAbsoluteError: ratioFromNumber(meanNumber(normalizedErrors)),
        medianNormalizedAbsoluteError: decimalMetric(medianNumber(normalizedErrors)),
        spearmanRankCorrelation: revenue.spearmanRankCorrelation,
        cutoffCoverage: new Set(entries.map((entry) => entry.example.cutoffTime)).size,
        historyDepthCoverage: new Set(entries.map((entry) => historyDepthBucket(entry.example.features.historicalValidOrderCount))).size,
        recencyCoverage: new Set(entries.map((entry) => recencyBucket(entry.example.features.daysSinceLastOrder))).size,
      };
    });
}

function buildRecencyAuditRows(prepared: readonly PreparedPrediction[]): readonly CustomerClvTwoStageRecencyAuditRow[] {
  return recencyAuditBuckets(prepared)
    .map(([bucket, entries]) => {
      const revenue = buildRevenueMetrics(entries);
      const predictedActivityRate = meanNumber(entries.map((entry) => parseProbability(entry.prediction.predictedActiveProbability)));
      const actualActivityRate = meanNumber(entries.map((entry) => (entry.example.labels.futureValidOrderCount > 0 ? 1 : 0)));
      return {
        bucket,
        customerCount: entries.length,
        predictedActivityRate: ratioFromNumber(predictedActivityRate),
        actualActivityRate: ratioFromNumber(actualActivityRate),
        activityCalibrationRatio: actualActivityRate === 0 ? null : ratioFromNumber(predictedActivityRate / actualActivityRate),
        revenueCalibrationRatio: revenue.calibrationRatio,
        mae: revenue.mae,
        spearmanRankCorrelation: revenue.spearmanRankCorrelation,
      } satisfies CustomerClvTwoStageRecencyAuditRow;
    });
}

function buildFallbackUsage(prepared: readonly PreparedPrediction[]) {
  const activity = { exact: 0, order_recency: 0, recency: 0, global: 0 } as Record<CustomerClvTwoStageFallbackLevel, number>;
  const value = { exact: 0, order_recency: 0, recency: 0, global: 0 } as Record<CustomerClvTwoStageFallbackLevel, number>;
  for (const entry of prepared) {
    activity[entry.prediction.activityFallbackLevel] += 1;
    value[entry.prediction.valueFallbackLevel] += 1;
  }
  return { activity, value };
}

function buildTopCustomerSanityCheck(prepared: readonly PreparedPrediction[]): readonly CustomerClvTwoStageTopCustomerRow[] {
  return buildDecileStableRows(prepared)
    .slice(0, 10)
    .map((entry) => ({
      customerId: entry.example.customerId,
      cutoffTime: entry.example.cutoffTime,
      historicalValidOrderCount: entry.example.features.historicalValidOrderCount,
      daysSinceLastOrder: entry.example.features.daysSinceLastOrder,
      customerTenureDays: entry.example.features.customerTenureDays,
      revenue365d: entry.example.features.revenue365d,
      activityProbability: entry.prediction.predictedActiveProbability,
      expectedRevenueGivenActiveTaxIncl: entry.prediction.expectedRevenueGivenActiveTaxIncl,
      expectedRevenueTaxIncl: entry.prediction.predictedRevenueTaxIncl,
      expectedOrders: entry.prediction.expectedOrders ?? null,
      actualFutureRevenueTaxIncl: entry.example.labels.futureRevenueTaxIncl,
      actualFutureValidOrderCount: entry.example.labels.futureValidOrderCount,
      activityCohortKey: entry.prediction.activityCohortKey,
      valueCohortKey: entry.prediction.valueCohortKey,
      activitySupport: entry.prediction.activitySupport,
      valueSupport: entry.prediction.valueSupport,
      reliabilityBucket: entry.prediction.reliabilityBucket,
    }));
}

function buildRankingDiagnostics(prepared: readonly PreparedPrediction[]): CustomerClvTwoStageRankingDiagnostics {
  const actualRevenue = prepared.map((entry) => parseMoney(entry.example.labels.futureRevenueTaxIncl));
  const activityProbability = prepared.map((entry) => parseProbability(entry.prediction.predictedActiveProbability));
  const conditionalValue = prepared.map((entry) => parseMoney(entry.prediction.expectedRevenueGivenActiveTaxIncl));
  const finalExpectedRevenue = prepared.map((entry) => parseMoney(entry.prediction.predictedRevenueTaxIncl));
  const historical12mRevenue = prepared.map((entry) => parseMoney(entry.example.features.revenue365d));
  const activePrepared = prepared.filter((entry) => entry.example.labels.futureValidOrderCount > 0);
  return {
    activityProbabilitySpearmanToActualRevenue: signedDecimalMetric(spearmanRankCorrelation(activityProbability, actualRevenue)),
    conditionalValueSpearmanToActualRevenue: signedDecimalMetric(spearmanRankCorrelation(conditionalValue, actualRevenue)),
    conditionalValueSpearmanAmongActive: signedDecimalMetric(
      spearmanRankCorrelation(
        activePrepared.map((entry) => parseMoney(entry.prediction.expectedRevenueGivenActiveTaxIncl)),
        activePrepared.map((entry) => parseMoney(entry.example.labels.futureRevenueTaxIncl)),
      ),
    ),
    finalExpectedRevenueSpearmanToActualRevenue: signedDecimalMetric(spearmanRankCorrelation(finalExpectedRevenue, actualRevenue)),
    historical12mRevenueSpearmanToActualRevenue: signedDecimalMetric(spearmanRankCorrelation(historical12mRevenue, actualRevenue)),
    activityProbabilitySpearmanToHistorical12m: signedDecimalMetric(spearmanRankCorrelation(activityProbability, historical12mRevenue)),
    conditionalValueSpearmanToHistorical12m: signedDecimalMetric(spearmanRankCorrelation(conditionalValue, historical12mRevenue)),
    finalExpectedRevenueSpearmanToHistorical12m: signedDecimalMetric(spearmanRankCorrelation(finalExpectedRevenue, historical12mRevenue)),
  };
}

function buildTieDiagnostics(prepared: readonly PreparedPrediction[]): CustomerClvTwoStageTieDiagnostics {
  const predictionGroups = groupPreparedByPrediction(prepared);
  const sharedPredictionCustomerCount = Array.from(predictionGroups.values())
    .filter((entries) => entries.length > 1)
    .reduce((total, entries) => total + entries.length, 0);
  const topDecile = sliceTopFraction(prepared, 0.1);
  const top1Pct = sliceTopFraction(prepared, 0.01);
  return {
    uniquePredictionCount: predictionGroups.size,
    sharedPredictionCustomerCount,
    sharedPredictionRate: ratioString(sharedPredictionCustomerCount, prepared.length),
    topDecileCustomerCount: topDecile.length,
    topDecileSharedPredictionCustomerCount: sharedPredictionCustomerCountForSlice(topDecile),
    topDecileTieRate: ratioString(sharedPredictionCustomerCountForSlice(topDecile), topDecile.length),
    top1PctCustomerCount: top1Pct.length,
    top1PctSharedPredictionCustomerCount: sharedPredictionCustomerCountForSlice(top1Pct),
    top1PctTieRate: ratioString(sharedPredictionCustomerCountForSlice(top1Pct), top1Pct.length),
  };
}

function recencyAuditBuckets(prepared: readonly PreparedPrediction[]): readonly [string, readonly PreparedPrediction[]][] {
  const grouped = new Map<string, PreparedPrediction[]>();
  for (const entry of prepared) {
    const key = staleCalibrationRecencyBucket(entry.example.features.daysSinceLastOrder);
    const rows = grouped.get(key) ?? [];
    rows.push(entry);
    grouped.set(key, rows);
  }
  return Array.from(grouped.entries()).sort(
    ([left], [right]) => staleRecencyAuditOrder(left) - staleRecencyAuditOrder(right) || left.localeCompare(right),
  );
}

function buildObservedActivityCohorts(prepared: readonly PreparedPrediction[]): readonly CustomerClvTwoStageCohortObservedCalibrationRow[] {
  return Array.from(groupPreparedByKey(prepared, (entry) => `${entry.prediction.activityFallbackLevel}|${entry.prediction.activityCohortKey}`))
    .map(([groupKey, entries]) => {
      const [level, ...keyParts] = groupKey.split('|');
      const predicted = meanNumber(entries.map((entry) => parseProbability(entry.prediction.predictedActiveProbability)));
      const actual = meanNumber(entries.map((entry) => (entry.example.labels.futureValidOrderCount > 0 ? 1 : 0)));
      return {
        cohortKey: keyParts.join('|'),
        level: level as CustomerClvTwoStageFallbackLevel,
        support: entries.length,
        meanPredictedValue: ratioFromNumber(predicted),
        actualValue: ratioFromNumber(actual),
        calibrationRatio: actual === 0 ? null : ratioFromNumber(predicted / actual),
        spearmanRankCorrelation: null,
      } satisfies CustomerClvTwoStageCohortObservedCalibrationRow;
    })
    .sort((left, right) => right.support - left.support || left.cohortKey.localeCompare(right.cohortKey))
    .slice(0, 15);
}

function buildObservedValueCohorts(prepared: readonly PreparedPrediction[]): readonly CustomerClvTwoStageCohortObservedCalibrationRow[] {
  return Array.from(groupPreparedByKey(prepared, (entry) => `${entry.prediction.valueFallbackLevel}|${entry.prediction.valueCohortKey}`))
    .map(([groupKey, entries]) => {
      const [level, ...keyParts] = groupKey.split('|');
      const activeEntries = entries.filter((entry) => entry.example.labels.futureValidOrderCount > 0);
      const predicted = meanNumber(entries.map((entry) => parseMoney(entry.prediction.expectedRevenueGivenActiveTaxIncl)));
      const actual = activeEntries.length === 0 ? null : averageMoney(activeEntries.map((entry) => entry.example.labels.futureRevenueTaxIncl));
      return {
        cohortKey: keyParts.join('|'),
        level: level as CustomerClvTwoStageFallbackLevel,
        support: entries.length,
        meanPredictedValue: moneyFromNumber(predicted),
        actualValue: actual,
        calibrationRatio:
          actual === null || compareDecimalAsc(actual, '0.000000') === 0 ? null : ratioFromNumber(predicted / parseMoney(actual)),
        spearmanRankCorrelation:
          activeEntries.length < 2
            ? null
            : signedDecimalMetric(
                spearmanRankCorrelation(
                  activeEntries.map((entry) => parseMoney(entry.prediction.expectedRevenueGivenActiveTaxIncl)),
                  activeEntries.map((entry) => parseMoney(entry.example.labels.futureRevenueTaxIncl)),
                ),
              ),
      } satisfies CustomerClvTwoStageCohortObservedCalibrationRow;
    })
    .sort((left, right) => right.support - left.support || left.cohortKey.localeCompare(right.cohortKey))
    .slice(0, 15);
}

function groupPreparedByKey(
  prepared: readonly PreparedPrediction[],
  keyOf: (entry: PreparedPrediction) => string,
): ReadonlyMap<string, readonly PreparedPrediction[]> {
  const grouped = new Map<string, PreparedPrediction[]>();
  for (const entry of prepared) {
    const key = keyOf(entry);
    const rows = grouped.get(key) ?? [];
    rows.push(entry);
    grouped.set(key, rows);
  }
  return grouped;
}

function groupPreparedByPrediction(prepared: readonly PreparedPrediction[]): ReadonlyMap<string, readonly PreparedPrediction[]> {
  return groupPreparedByKey(prepared, (entry) => entry.prediction.predictedRevenueTaxIncl);
}

function sliceTopFraction(prepared: readonly PreparedPrediction[], fraction: number): readonly PreparedPrediction[] {
  if (prepared.length === 0) return [];
  return buildDecileStableRows(prepared).slice(0, Math.max(1, Math.ceil(prepared.length * fraction)));
}

function sharedPredictionCustomerCountForSlice(prepared: readonly PreparedPrediction[]): number {
  return Array.from(groupPreparedByPrediction(prepared).values())
    .filter((entries) => entries.length > 1)
    .reduce((total, entries) => total + entries.length, 0);
}

function summarizeTopActivityCohorts(cells: ReadonlyMap<string, ActivityCellEstimate>): readonly CustomerClvTwoStageCohortCalibrationRow[] {
  return Array.from(cells.values())
    .sort((left, right) => right.support - left.support || left.key.localeCompare(right.key))
    .slice(0, 15)
    .map((cell) => ({
      cohortKey: cell.key,
      parentKey: cell.parentKey,
      level: cell.level,
      support: cell.support,
      rawValue: cell.rawRate,
      shrunkValue: cell.shrunkRate,
    }));
}

function summarizeTopValueCohorts(cells: ReadonlyMap<string, ValueCellEstimate>): readonly CustomerClvTwoStageCohortCalibrationRow[] {
  return Array.from(cells.values())
    .sort((left, right) => right.support - left.support || left.key.localeCompare(right.key))
    .slice(0, 15)
    .map((cell) => ({
      cohortKey: cell.key,
      parentKey: cell.parentKey,
      level: cell.level,
      support: cell.support,
      rawValue: cell.rawMeanRevenue,
      shrunkValue: cell.shrunkMeanRevenue,
    }));
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

function compareCandidateEvaluations(
  left: CustomerClvTwoStageCandidateEvaluation,
  right: CustomerClvTwoStageCandidateEvaluation,
): number {
  const leftReasonable = left.selectionDiagnostics.withinReasonableCalibrationBand ? 0 : 1;
  const rightReasonable = right.selectionDiagnostics.withinReasonableCalibrationBand ? 0 : 1;
  if (leftReasonable !== rightReasonable) return leftReasonable - rightReasonable;
  if (left.selectionDiagnostics.calibrationDistance !== right.selectionDiagnostics.calibrationDistance) {
    return left.selectionDiagnostics.calibrationDistance - right.selectionDiagnostics.calibrationDistance;
  }
  const byTop10 = descendingNullableNumber(left.overallTopCapture.top10PctRevenueCapture, right.overallTopCapture.top10PctRevenueCapture);
  if (byTop10 !== 0) return byTop10;
  const byOneOrderMae = ascendingNullableNumber(left.selectionDiagnostics.oneOrderMae, right.selectionDiagnostics.oneOrderMae);
  if (byOneOrderMae !== 0) return byOneOrderMae;
  if (left.selectionDiagnostics.calibrationStdDev !== right.selectionDiagnostics.calibrationStdDev) {
    return left.selectionDiagnostics.calibrationStdDev - right.selectionDiagnostics.calibrationStdDev;
  }
  return left.candidateId.localeCompare(right.candidateId);
}

function compareCorrectionCandidateEvaluations(
  left: CustomerClvTwoStageCorrectionCandidateEvaluation,
  right: CustomerClvTwoStageCorrectionCandidateEvaluation,
): number {
  const leftReasonable = left.selectionDiagnostics.withinReasonableCalibrationBand ? 0 : 1;
  const rightReasonable = right.selectionDiagnostics.withinReasonableCalibrationBand ? 0 : 1;
  if (leftReasonable !== rightReasonable) return leftReasonable - rightReasonable;
  if (left.selectionDiagnostics.calibrationDistance !== right.selectionDiagnostics.calibrationDistance) {
    return left.selectionDiagnostics.calibrationDistance - right.selectionDiagnostics.calibrationDistance;
  }
  const byTop10 = descendingNullableNumber(left.overallTopCapture.top10PctRevenueCapture, right.overallTopCapture.top10PctRevenueCapture);
  if (byTop10 !== 0) return byTop10;
  const bySpearman = descendingNullableNumber(
    left.overallRevenueMetrics.spearmanRankCorrelation,
    right.overallRevenueMetrics.spearmanRankCorrelation,
  );
  if (bySpearman !== 0) return bySpearman;
  const byStaleCalibration = ascendingNumber(
    staleCalibrationDistance(left.overallRecency),
    staleCalibrationDistance(right.overallRecency),
  );
  if (byStaleCalibration !== 0) return byStaleCalibration;
  const byTopTieRate = ascendingNumber(Number(left.tieDiagnostics.top1PctTieRate), Number(right.tieDiagnostics.top1PctTieRate));
  if (byTopTieRate !== 0) return byTopTieRate;
  const byOneOrderMae = ascendingNullableNumber(left.selectionDiagnostics.oneOrderMae, right.selectionDiagnostics.oneOrderMae);
  if (byOneOrderMae !== 0) return byOneOrderMae;
  return left.candidateId.localeCompare(right.candidateId);
}

function compareHardeningCandidateEvaluations(
  left: CustomerClvTwoStageCorrectionCandidateEvaluation,
  right: CustomerClvTwoStageCorrectionCandidateEvaluation,
): number {
  const byOverallCalibration = ascendingNumber(
    Math.abs(Number(left.overallRevenueMetrics.calibrationRatio ?? '1') - 1),
    Math.abs(Number(right.overallRevenueMetrics.calibrationRatio ?? '1') - 1),
  );
  const byStale = ascendingNumber(staleCalibrationDistance(left.cutoffResults.flatMap((row) => row.recencyAudit)), staleCalibrationDistance(right.cutoffResults.flatMap((row) => row.recencyAudit)));
  if (byStale !== 0) return byStale;
  if (byOverallCalibration !== 0) return byOverallCalibration;
  const byRecentStability = ascendingNumber(recentCalibrationDistance(left.cutoffResults.flatMap((row) => row.recencyAudit)), recentCalibrationDistance(right.cutoffResults.flatMap((row) => row.recencyAudit)));
  if (byRecentStability !== 0) return byRecentStability;
  const byBrier = ascendingNullableNumber(left.overallActivityMetrics.brierScore, right.overallActivityMetrics.brierScore);
  if (byBrier !== 0) return byBrier;
  const byMae = ascendingNullableNumber(left.overallRevenueMetrics.mae, right.overallRevenueMetrics.mae);
  if (byMae !== 0) return byMae;
  return left.candidateId.localeCompare(right.candidateId);
}

function staleCalibrationDistance(
  recencyRows: readonly { readonly bucket: string; readonly calibrationRatio?: string | null; readonly revenueCalibrationRatio?: string | null }[],
): number {
  return recencyRows
    .filter((row) => row.bucket === '366-730d' || row.bucket === '731-1095d' || row.bucket === '>1095d' || row.bucket === '>730d')
    .map((row) => Math.abs(Number((row.calibrationRatio ?? row.revenueCalibrationRatio ?? '1')) - 1))
    .reduce((sum, value) => sum + value, 0);
}

function recentCalibrationDistance(
  recencyRows: readonly { readonly bucket: string; readonly calibrationRatio?: string | null; readonly revenueCalibrationRatio?: string | null }[],
): number {
  return recencyRows
    .filter((row) => row.bucket === '0-90d' || row.bucket === '91-180d')
    .map((row) => Math.abs(Number((row.calibrationRatio ?? row.revenueCalibrationRatio ?? '1')) - 1))
    .reduce((sum, value) => sum + value, 0);
}

function calibrationStdDev(values: readonly (string | null)[]): number {
  const numeric = values.filter((value): value is string => value !== null).map(Number);
  if (numeric.length === 0) return Number.POSITIVE_INFINITY;
  const mean = meanNumber(numeric);
  return Math.sqrt(meanNumber(numeric.map((value) => (value - mean) ** 2)));
}

function activityRate(rows: readonly CustomerClvBacktestExample[]): string {
  return ratioString(rows.filter((row) => row.labels.futureValidOrderCount > 0).length, rows.length);
}

function exactActivityKey(row: CustomerClvBacktestExample): string {
  return `orders:${historyDepthBucket(row.features.historicalValidOrderCount)}|recency:${recencyBucket(row.features.daysSinceLastOrder)}|tenure:${tenureBucket(row.features.customerTenureDays)}`;
}

function orderRecencyActivityKey(row: CustomerClvBacktestExample): string {
  return `orders:${historyDepthBucket(row.features.historicalValidOrderCount)}|recency:${recencyBucket(row.features.daysSinceLastOrder)}`;
}

function recencyOnlyActivityKey(row: CustomerClvBacktestExample): string {
  return `recency:${recencyBucket(row.features.daysSinceLastOrder)}`;
}

function orderRecencyActivityKeyFromExactKey(key: string): string {
  return key.split('|').slice(0, 2).join('|');
}

function recencyOnlyActivityKeyFromOrderRecencyKey(key: string): string {
  return key.split('|').slice(1).join('|');
}

function exactValueKeyOrderRecencyOnly(row: CustomerClvBacktestExample): string {
  return orderRecencyValueKey(row);
}

function exactValueKeyWithRevenueBucket(row: CustomerClvBacktestExample): string {
  return `${orderRecencyValueKey(row)}|revenue365d:${revenue365dBucket(row.features.revenue365d)}`;
}

function exactValueKeyWithRefinedRevenueBucket(row: CustomerClvBacktestExample): string {
  return `${orderRecencyValueKey(row)}|revenue365d:${refinedRevenue365dBucket(row.features.revenue365d)}`;
}

function orderRecencyValueKey(row: CustomerClvBacktestExample): string {
  return `orders:${historyDepthBucket(row.features.historicalValidOrderCount)}|recency:${recencyBucket(row.features.daysSinceLastOrder)}`;
}

function recencyOnlyValueKey(row: CustomerClvBacktestExample): string {
  return `recency:${recencyBucket(row.features.daysSinceLastOrder)}`;
}

function orderRecencyValueKeyFromExactKey(key: string): string {
  return key.split('|').slice(0, 2).join('|');
}

function recencyOnlyValueKeyFromOrderRecencyKey(key: string): string {
  return key.split('|').slice(1).join('|');
}

function revenue365dBucket(value: string): string {
  if (compareDecimalAsc(value, '0.000000') === 0) return '0';
  if (compareDecimalAsc(value, '50000.000000') <= 0) return '(0,50k]';
  if (compareDecimalAsc(value, '150000.000000') <= 0) return '(50k,150k]';
  if (compareDecimalAsc(value, '400000.000000') <= 0) return '(150k,400k]';
  return '>400k';
}

function refinedRevenue365dBucket(value: string): string {
  if (compareDecimalAsc(value, '0.000000') === 0) return '0';
  if (compareDecimalAsc(value, '50000.000000') <= 0) return '(0,50k]';
  if (compareDecimalAsc(value, '150000.000000') <= 0) return '(50k,150k]';
  if (compareDecimalAsc(value, '400000.000000') <= 0) return '(150k,400k]';
  if (compareDecimalAsc(value, '800000.000000') <= 0) return '(400k,800k]';
  if (compareDecimalAsc(value, '1500000.000000') <= 0) return '(800k,1.5m]';
  return '>1.5m';
}

function historyDepthBucket(count: number): '1' | '2' | '3-4' | '5+' {
  if (count <= 1) return '1';
  if (count === 2) return '2';
  if (count <= 4) return '3-4';
  return '5+';
}

function recencyBucket(daysSinceLastOrder: number): '0-90d' | '91-180d' | '181-365d' | '366-730d' | '>730d' {
  if (daysSinceLastOrder <= 90) return '0-90d';
  if (daysSinceLastOrder <= 180) return '91-180d';
  if (daysSinceLastOrder <= 365) return '181-365d';
  if (daysSinceLastOrder <= 730) return '366-730d';
  return '>730d';
}

function staleRecencyAuditOrder(bucket: string): number {
  return ['0-90d', '91-180d', '181-365d', '366-730d', '731-1095d', '>1095d', '>730d'].indexOf(bucket);
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

function sortDatasetsByCutoff(datasets: readonly CustomerClvBacktestDataset[]): readonly CustomerClvBacktestDataset[] {
  return [...datasets].sort((left, right) => left.manifest.cutoffTime.localeCompare(right.manifest.cutoffTime));
}

function averageMoney(values: readonly string[]): string {
  if (values.length === 0) return '0.000000';
  return divideDecimal(addDecimals(values), values.length);
}

function averageRatio(values: readonly string[]): string {
  if (values.length === 0) return '0.000000';
  return ratioFromNumber(values.map(parseProbability).reduce((sum, value) => sum + value, 0) / values.length);
}

function averageNumberAsMoney(values: readonly number[]): string {
  return moneyFromNumber(meanNumber(values));
}

function meanNumber(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundNumber(value: number): number {
  return Number(value.toFixed(6));
}

function ratioString(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0.000000';
  return ratioFromNumber(numerator / denominator);
}

function ratioMoney(numerator: string, denominator: string): string | null {
  if (compareDecimalAsc(denominator, '0.000000') === 0) return null;
  return ratioFromNumber(parseMoney(numerator) / parseMoney(denominator));
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

function normalizedAbsoluteError(predicted: number, actual: number): number {
  return Math.abs(predicted - actual) / Math.max(predicted, actual, 1);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function descendingNullableNumber(left: string | null, right: string | null): number {
  return ascendingNumber(right === null ? Number.NEGATIVE_INFINITY : Number(right), left === null ? Number.NEGATIVE_INFINITY : Number(left));
}

function ascendingNullableNumber(left: string | null, right: string | null): number {
  return ascendingNumber(left === null ? Number.POSITIVE_INFINITY : Number(left), right === null ? Number.POSITIVE_INFINITY : Number(right));
}

function ascendingNumber(left: number, right: number): number {
  return left - right;
}
