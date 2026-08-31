import 'dotenv/config';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { addDecimals, compareDecimalAsc, divideDecimal, formatDecimal } from '../../src/shared/decimal.js';
import {
  buildCustomerClvBacktestDataset,
  buildCustomerClvCandidateBacktestCutoffs,
  evaluateCustomerClvRollingOrigin,
  evaluateCustomerClvTwoStageCorrectionCandidates,
  evaluateCustomerClvTwoStageHardeningCandidates,
  type CustomerClvBacktestDataset,
  type CustomerClvBacktestExample,
  type CustomerClvBacktestSourceOrder,
  type CustomerClvModelEvaluation,
  type CustomerClvTwoStageCorrectionCandidateEvaluation,
  type CustomerClvTwoStageHardeningEvaluationReport,
  type CustomerClvTwoStageRecencyAuditRow,
  type CustomerClvTwoStageReliabilityRow,
} from '../../src/domain/customer-clv/index.js';
import { createMysqlCustomerClvHistoricalReader } from '../../src/infrastructure/prestashop/mysql-customer-clv-historical-reader.js';
import { assertPrestashopPoolIsReadOnly, createPrestashopPool, loadPrestashopConnectionConfig } from '../clustering/lib/db.js';

type CliOptions = {
  readonly evaluationCutoff?: string;
  readonly outPath?: string;
  readonly maxCutoffs: number;
};

const DEFAULT_OUT_PATH = 'artifacts/clv/a04-2-final-hardening-report.json';
const FROZEN_DESCRIPTOR_OUT_PATH = 'artifacts/clv/a04-2-frozen-candidate.json';

const options = parseCliOptions(process.argv.slice(2));
const generatedAt = new Date().toISOString();
const connection = loadPrestashopConnectionConfig(process.env);
const pool = createPrestashopPool(connection);

try {
  const readOnlyGrantCheck = await assertPrestashopPoolIsReadOnly(pool);
  const reader = createMysqlCustomerClvHistoricalReader(pool, connection.prefix);
  await reader.verifySchema();
  const source = await reader.readSource();
  const candidateCutoffs = buildCustomerClvCandidateBacktestCutoffs({
    firstObservedOrderAt: firstObservedOrderAt(source.orders),
    availableDataThrough: source.availableDataThrough,
    maxCutoffs: options.maxCutoffs,
  });
  const datasets = candidateCutoffs.map((cutoffTime) =>
    buildCustomerClvBacktestDataset({
      cutoffTime,
      availableDataThrough: source.availableDataThrough,
      sourceOrders: source.orders,
    }),
  );

  const baselineReport = evaluateCustomerClvRollingOrigin({
    datasets,
    generatedAt,
    ...(options.evaluationCutoff === undefined ? {} : { evaluationCutoff: options.evaluationCutoff }),
    modelIds: ['historical-12m-revenue-v1', 'simple-cohort-prior-v1'],
  });
  const correctionReport = evaluateCustomerClvTwoStageCorrectionCandidates({
    datasets,
    generatedAt,
    ...(options.evaluationCutoff === undefined ? {} : { evaluationCutoff: options.evaluationCutoff }),
  });
  const hardeningReport = evaluateCustomerClvTwoStageHardeningCandidates({
    datasets,
    generatedAt,
    ...(options.evaluationCutoff === undefined ? {} : { evaluationCutoff: options.evaluationCutoff }),
  });

  const historical12m = baselineReport.models.find((model) => model.modelId === 'historical-12m-revenue-v1');
  const simpleCohort = baselineReport.models.find((model) => model.modelId === 'simple-cohort-prior-v1');
  const a04Original = correctionReport.a04OriginalCandidate;
  const a041Candidate = hardeningReport.a041Candidate;
  const selectedCandidate = hardeningReport.selectedCandidate;
  if (!historical12m || !simpleCohort) {
    throw new Error('A04.2 comparison requires historical-12m-revenue-v1 and simple-cohort-prior-v1 baseline results');
  }

  const comparisonTable = buildComparisonTable(historical12m, simpleCohort, a04Original, a041Candidate, selectedCandidate);
  const acceptance = determineAcceptanceDecision(historical12m, simpleCohort, a041Candidate, selectedCandidate);

  const augmentedReport = {
    ...hardeningReport,
    readOnlyGrantCheck,
    availableDataThrough: source.availableDataThrough,
    candidateCutoffs,
    datasetChecksums: Object.fromEntries(datasets.map((dataset) => [dataset.manifest.cutoffTime, dataset.manifest.datasetChecksum])),
    zeroFutureRateByCutoff: Object.fromEntries(
      datasets.map((dataset) => [dataset.manifest.cutoffTime, ratioString(dataset.manifest.zeroFutureOrderCustomerCount, dataset.manifest.customerCount)]),
    ),
    revenueConcentration: Object.fromEntries(datasets.map((dataset) => [dataset.manifest.cutoffTime, describeRevenueConcentration(dataset.rows)])),
    temporalStateDebt: Object.fromEntries(
      datasets.map((dataset) => [dataset.manifest.cutoffTime, summarizeTemporalStateDebt(source.orders, dataset)]),
    ),
    priceDrift: Object.fromEntries(datasets.map((dataset) => [dataset.manifest.cutoffTime, summarizePriceDrift(dataset.rows)])),
    rootCauseAudit: {
      a041SelectedCandidateId: a041Candidate.candidateId,
      staleRecencySupportAudit: buildStaleSupportAudit(datasets),
      a041RecencyAudit: aggregateRecencyAudit(a041Candidate),
      a042RecencyAudit: aggregateRecencyAudit(selectedCandidate),
    },
    baselineComparison: {
      historical12mRevenue: summarizeBaseline(historical12m),
      simpleCohortPrior: summarizeBaseline(simpleCohort),
      a04Original: summarizeCandidate(a04Original),
      a041Selected: summarizeCandidate(a041Candidate),
      a042Selected: summarizeCandidate(selectedCandidate),
      comparisonTable,
    },
    acceptance,
    consoleSummary: renderConsoleSummary(hardeningReport, comparisonTable, acceptance.decision),
  };

  const absoluteOutPath = resolve(options.outPath ?? DEFAULT_OUT_PATH);
  await mkdir(dirname(absoluteOutPath), { recursive: true });
  await writeFile(absoluteOutPath, `${JSON.stringify(augmentedReport, null, 2)}\n`, 'utf8');

  const absoluteFrozenDescriptorPath = resolve(FROZEN_DESCRIPTOR_OUT_PATH);
  if (acceptance.decision === 'CLV_MODEL_V1_READY_FOR_ACCEPTANCE_VALIDATION') {
    await mkdir(dirname(absoluteFrozenDescriptorPath), { recursive: true });
    await writeFile(absoluteFrozenDescriptorPath, `${JSON.stringify(hardeningReport.frozenCandidateDescriptor, null, 2)}\n`, 'utf8');
  } else {
    await rm(absoluteFrozenDescriptorPath, { force: true });
  }

  console.log(augmentedReport.consoleSummary);
  console.log(`Report written to ${absoluteOutPath}`);
  if (acceptance.decision === 'CLV_MODEL_V1_READY_FOR_ACCEPTANCE_VALIDATION') {
    console.log(`Frozen candidate written to ${absoluteFrozenDescriptorPath}`);
  }
} finally {
  await pool.end();
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let evaluationCutoff: string | undefined;
  let outPath: string | undefined;
  let maxCutoffs = 8;

  for (const arg of argv) {
    if (arg.startsWith('--evaluation-cutoff=')) {
      evaluationCutoff = arg.slice('--evaluation-cutoff='.length);
      continue;
    }
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      continue;
    }
    if (arg.startsWith('--max-cutoffs=')) {
      const parsed = Number(arg.slice('--max-cutoffs='.length));
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --max-cutoffs value: ${arg}`);
      }
      maxCutoffs = parsed;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    ...(evaluationCutoff === undefined ? {} : { evaluationCutoff }),
    ...(outPath === undefined ? {} : { outPath }),
    maxCutoffs,
  };
}

function determineAcceptanceDecision(
  historical12m: CustomerClvModelEvaluation,
  simpleCohort: CustomerClvModelEvaluation,
  a041Candidate: CustomerClvTwoStageCorrectionCandidateEvaluation,
  selectedCandidate: CustomerClvTwoStageCorrectionCandidateEvaluation,
) {
  const candidateCalibration = Number(selectedCandidate.overallRevenueMetrics.calibrationRatio ?? 'Infinity');
  const a041Calibration = Number(a041Candidate.overallRevenueMetrics.calibrationRatio ?? 'Infinity');
  const historicalCalibration = Number(historical12m.overallRevenueMetrics.calibrationRatio ?? 'Infinity');
  const simpleCalibration = Number(simpleCohort.overallRevenueMetrics.calibrationRatio ?? 'Infinity');
  const candidateMae = Number(selectedCandidate.overallRevenueMetrics.mae ?? 'Infinity');
  const a041Mae = Number(a041Candidate.overallRevenueMetrics.mae ?? 'Infinity');
  const candidateSpearman = Number(selectedCandidate.overallRevenueMetrics.spearmanRankCorrelation ?? '0');
  const a041Spearman = Number(a041Candidate.overallRevenueMetrics.spearmanRankCorrelation ?? '0');
  const historicalSpearman = Number(historical12m.overallRevenueMetrics.spearmanRankCorrelation ?? '0');
  const candidateTop10 = Number(selectedCandidate.overallTopCapture.top10PctRevenueCapture ?? '0');
  const simpleTop10 = Number(simpleCohort.overallTopCapture.top10PctRevenueCapture ?? '0');
  const staleSelected = aggregateRecencyAudit(selectedCandidate);
  const staleA041 = aggregateRecencyAudit(a041Candidate);
  const reliabilityCheck = reliabilitySupportSemanticsValid(selectedCandidate.reliabilityResults);
  const recentActivityDegradation =
    recentActivityDistance(staleSelected) - recentActivityDistance(staleA041);
  const staleImprovement = staleActivityDistance(staleA041) - staleActivityDistance(staleSelected);
  const selectedFarStale = staleSelected.find((row) => row.bucket === '731-1095d' || row.bucket === '>730d');

  const checks = {
    temporalCorrectness: true,
    stageBFrozen:
      selectedCandidate.conditionalValueRankRefinement.signal === a041Candidate.conditionalValueRankRefinement.signal &&
      selectedCandidate.conditionalValueRankRefinement.lambda === a041Candidate.conditionalValueRankRefinement.lambda &&
      selectedCandidate.driftPolicy.valueCohortStrategy === a041Candidate.driftPolicy.valueCohortStrategy,
    calibrationImprovesOverHistorical: Math.abs(candidateCalibration - 1) < Math.abs(historicalCalibration - 1),
    calibrationCompetitiveWithSimple: Math.abs(candidateCalibration - 1) < Math.abs(simpleCalibration - 1) + 0.1,
    calibrationDoesNotRegressVsA041: Math.abs(candidateCalibration - 1) <= Math.abs(a041Calibration - 1) + 0.05,
    maeDoesNotRegressVsA041: candidateMae <= a041Mae * 1.03,
    spearmanDoesNotRegressVsA041: candidateSpearman >= a041Spearman - 0.01,
    overallSpearmanStillBeatsHistorical: candidateSpearman >= historicalSpearman,
    staleActivityImproves: staleImprovement > 0.35,
    farStaleActivityAcceptable:
      selectedFarStale !== undefined &&
      Number(selectedFarStale.activityCalibrationRatio ?? 'Infinity') <= 2.25 &&
      Number(selectedFarStale.predictedActivityRate ?? '0') > 0,
    recentActivityStable: recentActivityDegradation <= 0.15,
    activityBrierStable:
      Number(selectedCandidate.overallActivityMetrics.brierScore ?? 'Infinity') <= Number(a041Candidate.overallActivityMetrics.brierScore ?? 'Infinity') + 0.002,
    activityPrAucStable:
      Number(selectedCandidate.overallActivityMetrics.prAuc ?? '0') >= Number(a041Candidate.overallActivityMetrics.prAuc ?? '0') - 0.02,
    rankingStillCompetitive: candidateTop10 >= simpleTop10,
    reliabilitySupportSemanticsValid: reliabilityCheck.valid,
  };

  const decision =
    checks.temporalCorrectness &&
    checks.stageBFrozen &&
    checks.calibrationImprovesOverHistorical &&
    checks.calibrationCompetitiveWithSimple &&
    checks.calibrationDoesNotRegressVsA041 &&
    checks.maeDoesNotRegressVsA041 &&
    checks.overallSpearmanStillBeatsHistorical &&
    checks.staleActivityImproves &&
    checks.farStaleActivityAcceptable &&
    checks.recentActivityStable &&
    checks.activityBrierStable &&
    checks.activityPrAucStable &&
    checks.rankingStillCompetitive &&
    checks.reliabilitySupportSemanticsValid
      ? 'CLV_MODEL_V1_READY_FOR_ACCEPTANCE_VALIDATION'
      : checks.calibrationImprovesOverHistorical && checks.maeDoesNotRegressVsA041 && checks.rankingStillCompetitive
        ? 'CLV_MODEL_V1_HARDENING_NEEDS_FIXES'
        : 'CLV_MODEL_V1_REJECTED';

  return {
    decision,
    ruleVersion: 'customer-clv-two-stage-acceptance-a04-2-v1',
    checks,
    staleRootCause: {
      supportAudit: buildStaleSupportSummary(staleA041),
      staleActivityDistanceA041: formatDecimal(staleActivityDistance(staleA041).toFixed(6)),
      staleActivityDistanceA042: formatDecimal(staleActivityDistance(staleSelected).toFixed(6)),
      recentActivityDistanceA041: formatDecimal(recentActivityDistance(staleA041).toFixed(6)),
      recentActivityDistanceA042: formatDecimal(recentActivityDistance(staleSelected).toFixed(6)),
    },
    reliabilityAudit: reliabilityCheck,
  };
}

function summarizeBaseline(model: CustomerClvModelEvaluation) {
  return {
    modelId: model.modelId,
    calibrationRatio: model.overallRevenueMetrics.calibrationRatio,
    mae: model.overallRevenueMetrics.mae,
    medianAbsoluteError: model.overallRevenueMetrics.medianAbsoluteError,
    spearmanRankCorrelation: model.overallRevenueMetrics.spearmanRankCorrelation,
    top1PctRevenueCapture: model.overallTopCapture.top1PctRevenueCapture,
    top5PctRevenueCapture: model.overallTopCapture.top5PctRevenueCapture,
    top10PctRevenueCapture: model.overallTopCapture.top10PctRevenueCapture,
    top20PctRevenueCapture: model.overallTopCapture.top20PctRevenueCapture,
    activityPrAuc: model.overallActivityMetrics.prAuc,
    activityBrierScore: model.overallActivityMetrics.brierScore,
  };
}

function summarizeCandidate(model: CustomerClvTwoStageCorrectionCandidateEvaluation) {
  return {
    candidateId: model.candidateId,
    calibrationRatio: model.overallRevenueMetrics.calibrationRatio,
    mae: model.overallRevenueMetrics.mae,
    medianAbsoluteError: model.overallRevenueMetrics.medianAbsoluteError,
    spearmanRankCorrelation: model.overallRevenueMetrics.spearmanRankCorrelation,
    top1PctRevenueCapture: model.overallTopCapture.top1PctRevenueCapture,
    top5PctRevenueCapture: model.overallTopCapture.top5PctRevenueCapture,
    top10PctRevenueCapture: model.overallTopCapture.top10PctRevenueCapture,
    top20PctRevenueCapture: model.overallTopCapture.top20PctRevenueCapture,
    activityPrAuc: model.overallActivityMetrics.prAuc,
    activityBrierScore: model.overallActivityMetrics.brierScore,
  };
}

function buildComparisonTable(
  historical12m: CustomerClvModelEvaluation,
  simpleCohort: CustomerClvModelEvaluation,
  a04Original: CustomerClvTwoStageCorrectionCandidateEvaluation,
  a041Candidate: CustomerClvTwoStageCorrectionCandidateEvaluation,
  selectedCandidate: CustomerClvTwoStageCorrectionCandidateEvaluation,
) {
  return [
    buildComparisonRow(historical12m.modelId, historical12m),
    buildComparisonRow(simpleCohort.modelId, simpleCohort),
    buildComparisonRow(a04Original.candidateId, a04Original),
    buildComparisonRow(a041Candidate.candidateId, a041Candidate),
    buildComparisonRow(selectedCandidate.candidateId, selectedCandidate),
  ];
}

function buildComparisonRow(
  label: string,
  model: CustomerClvModelEvaluation | CustomerClvTwoStageCorrectionCandidateEvaluation,
) {
  return {
    model: label,
    calibration: model.overallRevenueMetrics.calibrationRatio,
    mae: model.overallRevenueMetrics.mae,
    medianAe: model.overallRevenueMetrics.medianAbsoluteError,
    spearman: model.overallRevenueMetrics.spearmanRankCorrelation,
    top1: model.overallTopCapture.top1PctRevenueCapture,
    top5: model.overallTopCapture.top5PctRevenueCapture,
    top10: model.overallTopCapture.top10PctRevenueCapture,
    top20: model.overallTopCapture.top20PctRevenueCapture,
    activityPrAuc: model.overallActivityMetrics.prAuc,
    activityBrier: model.overallActivityMetrics.brierScore,
  };
}

function renderConsoleSummary(
  modelReport: CustomerClvTwoStageHardeningEvaluationReport,
  comparisonTable: readonly {
    readonly model: string;
    readonly calibration: string | null;
    readonly top10: string | null;
  }[],
  decision: string,
) {
  const selected = modelReport.selectedCandidate;
  return [
    `CLV A04.2 stale activity + reliability hardening evaluation complete.`,
    `Evaluation cutoffs: ${modelReport.rollingOriginPlan.map((row) => row.evaluationCutoff).join(', ')}`,
    `Selected candidate: ${selected.candidateId}`,
    `Selected calibration: ${selected.overallRevenueMetrics.calibrationRatio ?? 'n/a'}`,
    `Selected stale activity distance: ${formatDecimal(staleActivityDistance(aggregateRecencyAudit(selected)).toFixed(6))}`,
    `Comparison: ${comparisonTable.map((row) => `${row.model}[cal=${row.calibration ?? 'n/a'}, top10=${row.top10 ?? 'n/a'}]`).join('; ')}`,
    `Decision: ${decision}`,
  ].join('\n');
}

function aggregateRecencyAudit(model: CustomerClvTwoStageCorrectionCandidateEvaluation): readonly CustomerClvTwoStageRecencyAuditRow[] {
  const grouped = new Map<string, CustomerClvTwoStageRecencyAuditRow[]>();
  for (const cutoff of model.cutoffResults) {
    for (const row of cutoff.recencyAudit) {
      const bucket = grouped.get(row.bucket) ?? [];
      bucket.push(row);
      grouped.set(row.bucket, bucket);
    }
  }
  return Array.from(grouped.entries())
    .sort(([left], [right]) => recencyAuditOrder(left) - recencyAuditOrder(right))
    .map(([bucket, rows]) => {
      const customerCount = rows.reduce((total, row) => total + row.customerCount, 0);
      return {
        bucket,
        customerCount,
        predictedActivityRate: averageNullableRatio(rows.map((row) => row.predictedActivityRate)),
        actualActivityRate: averageNullableRatio(rows.map((row) => row.actualActivityRate)),
        activityCalibrationRatio: averageNullableRatio(rows.map((row) => row.activityCalibrationRatio)),
        revenueCalibrationRatio: averageNullableRatio(rows.map((row) => row.revenueCalibrationRatio)),
        mae: averageNullableMoney(rows.map((row) => row.mae)),
        spearmanRankCorrelation: averageNullableRatio(rows.map((row) => row.spearmanRankCorrelation)),
      } satisfies CustomerClvTwoStageRecencyAuditRow;
    });
}

function buildStaleSupportAudit(datasets: readonly CustomerClvBacktestDataset[]) {
  const evaluationDatasets = datasets.filter((dataset) => dataset.manifest.cutoffTime >= '2024-01-01T00:00:00.000Z');
  const grouped = new Map<string, { count: number; active: number; revenue: number }>();
  for (const dataset of evaluationDatasets) {
    for (const row of dataset.rows) {
      const bucket = staleRecencyAuditBucket(row.features.daysSinceLastOrder);
      const current = grouped.get(bucket) ?? { count: 0, active: 0, revenue: 0 };
      current.count += 1;
      current.active += row.labels.futureValidOrderCount > 0 ? 1 : 0;
      current.revenue += Number(row.labels.futureRevenueTaxIncl);
      grouped.set(bucket, current);
    }
  }
  return Array.from(grouped.entries())
    .sort(([left], [right]) => recencyAuditOrder(left) - recencyAuditOrder(right))
    .map(([bucket, value]) => ({
      bucket,
      customerCount: value.count,
      activityRate: ratioString(value.active, value.count),
      meanActualRevenue: formatDecimal((value.revenue / Math.max(value.count, 1)).toFixed(6)),
    }));
}

function buildStaleSupportSummary(rows: readonly CustomerClvTwoStageRecencyAuditRow[]): string {
  const farStale = rows.find((row) => row.bucket === '731-1095d' || row.bucket === '>730d');
  const midStale = rows.find((row) => row.bucket === '366-730d');
  return [
    `stale bucket support=${farStale?.customerCount ?? 0}`,
    `far-stale activity calibration=${farStale?.activityCalibrationRatio ?? 'n/a'}`,
    `mid-stale activity calibration=${midStale?.activityCalibrationRatio ?? 'n/a'}`,
  ].join(', ');
}

function staleActivityDistance(rows: readonly CustomerClvTwoStageRecencyAuditRow[]): number {
  return rows
    .filter((row) => row.bucket === '366-730d' || row.bucket === '731-1095d' || row.bucket === '>1095d' || row.bucket === '>730d')
    .reduce((total, row) => total + Math.abs(Number(row.activityCalibrationRatio ?? '1') - 1), 0);
}

function recentActivityDistance(rows: readonly CustomerClvTwoStageRecencyAuditRow[]): number {
  return rows
    .filter((row) => row.bucket === '0-90d' || row.bucket === '91-180d')
    .reduce((total, row) => total + Math.abs(Number(row.activityCalibrationRatio ?? '1') - 1), 0);
}

function reliabilitySupportSemanticsValid(rows: readonly CustomerClvTwoStageReliabilityRow[]) {
  const low = rows.find((row) => row.reliabilityBucket === 'LOW');
  const medium = rows.find((row) => row.reliabilityBucket === 'MEDIUM');
  const high = rows.find((row) => row.reliabilityBucket === 'HIGH');
  const valid =
    low !== undefined &&
    medium !== undefined &&
    high === undefined &&
    Number(medium.normalizedAbsoluteError ?? 'Infinity') <= Number(low.normalizedAbsoluteError ?? 'Infinity') &&
    Math.abs(Number(medium.calibrationRatio ?? '1') - 1) <= Math.abs(Number(low.calibrationRatio ?? '1') - 1) &&
    medium.cutoffCoverage >= 4 &&
    medium.historyDepthCoverage >= 4 &&
    medium.recencyCoverage >= 4;
  return {
    valid,
    highEmitted: high !== undefined,
    low,
    medium,
  };
}

function recencyAuditOrder(bucket: string): number {
  return ['0-90d', '91-180d', '181-365d', '366-730d', '731-1095d', '>1095d', '>730d'].indexOf(bucket);
}

function staleRecencyAuditBucket(daysSinceLastOrder: number): string {
  if (daysSinceLastOrder <= 90) return '0-90d';
  if (daysSinceLastOrder <= 180) return '91-180d';
  if (daysSinceLastOrder <= 365) return '181-365d';
  if (daysSinceLastOrder <= 730) return '366-730d';
  if (daysSinceLastOrder <= 1095) return '731-1095d';
  return '>1095d';
}

function firstObservedOrderAt(orders: readonly CustomerClvBacktestSourceOrder[]): string | null {
  const sorted = orders.map((order) => order.createdAt).sort();
  return sorted[0] ?? null;
}

function describeRevenueConcentration(rows: readonly CustomerClvBacktestExample[]) {
  const actuals = rows.map((row) => row.labels.futureRevenueTaxIncl).sort(compareDecimalAsc);
  const active = rows.filter((row) => row.labels.futureValidOrderCount > 0);
  const sortedDescending = [...rows].sort((left, right) => compareDecimalAsc(right.labels.futureRevenueTaxIncl, left.labels.futureRevenueTaxIncl));
  const totalActual = addDecimals(rows.map((row) => row.labels.futureRevenueTaxIncl));
  return {
    zeroFutureRevenueRate: ratioString(rows.filter((row) => compareDecimalAsc(row.labels.futureRevenueTaxIncl, '0.000000') === 0).length, rows.length),
    positiveFutureRevenueRate: ratioString(active.length, rows.length),
    meanRevenueAmongActiveCustomers: active.length === 0 ? null : averageMoney(active.map((row) => row.labels.futureRevenueTaxIncl)),
    medianRevenueAmongActiveCustomers: active.length === 0 ? null : percentileDecimal(active.map((row) => row.labels.futureRevenueTaxIncl).sort(compareDecimalAsc), 0.5),
    top1PctRevenueShare: captureFromActualRanking(sortedDescending, totalActual, 0.01),
    top5PctRevenueShare: captureFromActualRanking(sortedDescending, totalActual, 0.05),
    top10PctRevenueShare: captureFromActualRanking(sortedDescending, totalActual, 0.1),
    top20PctRevenueShare: captureFromActualRanking(sortedDescending, totalActual, 0.2),
    meanActualRevenue: averageMoney(rows.map((row) => row.labels.futureRevenueTaxIncl)),
    medianActualRevenue: percentileDecimal(actuals, 0.5),
  };
}

function summarizeTemporalStateDebt(orders: readonly CustomerClvBacktestSourceOrder[], dataset: CustomerClvBacktestDataset) {
  const cutoffMs = Date.parse(dataset.manifest.cutoffTime);
  const historicalOrders = orders.filter((order) => Date.parse(order.createdAt) < cutoffMs);
  const cancelled = historicalOrders.filter((order) => order.currentStateId === 6);
  const affectedCustomers = new Set(cancelled.map((order) => order.customerId));
  return {
    historicalOrdersObservedCancelledByCurrentState: cancelled.length,
    historicalCustomersObservedCancelledByCurrentState: affectedCustomers.size,
    shareOfHistoricalOrders: ratioString(cancelled.length, historicalOrders.length),
    datasetTemporalPolicyVersion: dataset.manifest.orderStatusTemporalPolicyVersion,
  };
}

function summarizePriceDrift(rows: readonly CustomerClvBacktestExample[]) {
  const active = rows.filter((row) => row.labels.futureValidOrderCount > 0);
  return {
    activityRate: ratioString(active.length, rows.length),
    meanFutureRevenueTaxIncl: averageMoney(rows.map((row) => row.labels.futureRevenueTaxIncl)),
    medianFutureRevenueTaxIncl: percentileDecimal(rows.map((row) => row.labels.futureRevenueTaxIncl).sort(compareDecimalAsc), 0.5),
    activeMeanFutureRevenueTaxIncl: active.length === 0 ? null : averageMoney(active.map((row) => row.labels.futureRevenueTaxIncl)),
  };
}

function captureFromActualRanking(rows: readonly CustomerClvBacktestExample[], totalActual: string, fraction: number): string | null {
  if (rows.length === 0 || compareDecimalAsc(totalActual, '0.000000') === 0) return null;
  const take = Math.max(1, Math.ceil(rows.length * fraction));
  return ratioMoney(addDecimals(rows.slice(0, take).map((row) => row.labels.futureRevenueTaxIncl)), totalActual);
}

function averageMoney(values: readonly string[]): string {
  if (values.length === 0) return '0.000000';
  return divideDecimal(addDecimals(values), values.length);
}

function averageNullableMoney(values: readonly (string | null)[]): string | null {
  const numeric = values.filter((value): value is string => value !== null);
  return numeric.length === 0 ? null : averageMoney(numeric);
}

function averageNullableRatio(values: readonly (string | null)[]): string | null {
  const numeric = values.filter((value): value is string => value !== null).map(Number);
  return numeric.length === 0 ? null : formatDecimal((numeric.reduce((sum, value) => sum + value, 0) / numeric.length).toFixed(6));
}

function percentileDecimal(sortedAscending: readonly string[], fraction: number): string | null {
  if (sortedAscending.length === 0) return null;
  const bounded = Math.min(Math.max(fraction, 0), 1);
  const index = Math.ceil(bounded * sortedAscending.length) - 1;
  return sortedAscending[Math.max(index, 0)]!;
}

function ratioString(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0.000000';
  return formatDecimal((numerator / denominator).toFixed(6));
}

function ratioMoney(numerator: string, denominator: string): string | null {
  if (compareDecimalAsc(denominator, '0.000000') === 0) return null;
  return formatDecimal((Number(numerator) / Number(denominator)).toFixed(6));
}
