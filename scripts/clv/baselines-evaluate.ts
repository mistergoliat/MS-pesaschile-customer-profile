import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { addDecimals, compareDecimalAsc, divideDecimal, formatDecimal } from '../../src/shared/decimal.js';
import {
  buildCustomerClvBacktestDataset,
  buildCustomerClvCandidateBacktestCutoffs,
  evaluateCustomerClvRollingOrigin,
  type CustomerClvBacktestDataset,
  type CustomerClvBaselineId,
} from '../../src/domain/customer-clv/index.js';
import type { CustomerClvBacktestExample, CustomerClvBacktestSourceOrder } from '../../src/domain/customer-clv/index.js';
import { createMysqlCustomerClvHistoricalReader } from '../../src/infrastructure/prestashop/mysql-customer-clv-historical-reader.js';
import { assertPrestashopPoolIsReadOnly, createPrestashopPool, loadPrestashopConnectionConfig } from '../clustering/lib/db.js';

const KNOWN_MODEL_IDS: readonly CustomerClvBaselineId[] = [
  'global-mean-v1',
  'global-activity-x-conditional-mean-v1',
  'historical-12m-revenue-v1',
  'lifetime-monthly-rate-shrunk-v1',
  'aov-x-order-rate-v1',
  'recency-adjusted-projection-v1',
  'rfm-segment-median-v1',
  'cutoff-safe-rfm-bucket-median-v1',
  'simple-cohort-prior-v1',
];

type CliOptions = {
  readonly evaluationCutoff?: string;
  readonly modelIds?: readonly CustomerClvBaselineId[];
  readonly outPath?: string;
  readonly maxCutoffs: number;
};

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
  const requestedCutoff = options.evaluationCutoff;
  const datasets = candidateCutoffs.map((cutoffTime) =>
    buildCustomerClvBacktestDataset({
      cutoffTime,
      availableDataThrough: source.availableDataThrough,
      sourceOrders: source.orders,
    }),
  );
  const report = evaluateCustomerClvRollingOrigin({
    datasets,
    generatedAt,
    ...(requestedCutoff === undefined ? {} : { evaluationCutoff: requestedCutoff }),
    ...(options.modelIds === undefined ? {} : { modelIds: options.modelIds }),
  });

  const augmentedReport = {
    ...report,
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
    blockedBaselinesById: Object.fromEntries(report.blockedBaselines.map((baseline) => [baseline.modelId, baseline])),
    baselineResults: Object.fromEntries(
      report.models.map((model) => [
        model.modelId,
        {
          baselineVersion: model.baselineVersion,
          overallRevenueMetrics: model.overallRevenueMetrics,
          overallActivityMetrics: model.overallActivityMetrics,
          overallConditionalValueMetrics: model.overallConditionalValueMetrics,
          overallTopCapture: model.overallTopCapture,
          outlierSensitivity: model.outlierSensitivity,
          perCutoff: model.cutoffResults,
        },
      ]),
    ),
    bestCalibratedBaseline: chooseBestCalibratedBaseline(report.models),
    bestRankingBaseline: chooseBestRankingBaseline(report.models),
    hardestBaselineToBeat: chooseHardestBaselineToBeat(report.models),
    activityDiagnostics: Object.fromEntries(
      report.models.map((model) => [
        model.modelId,
        {
          ...model.overallActivityMetrics,
          topDecileActivityRate: model.cutoffResults.at(-1)?.deciles[0]?.actualActivityRate ?? null,
        },
      ]),
    ),
    conditionalValueDiagnostics: Object.fromEntries(report.models.map((model) => [model.modelId, model.overallConditionalValueMetrics])),
    decileLift: Object.fromEntries(
      report.models.map((model) => [
        model.modelId,
        {
          overallTopDecileLift: model.cutoffResults.at(-1)?.deciles[0]?.revenueLiftVsPopulation ?? null,
          perCutoffDeciles: Object.fromEntries(model.cutoffResults.map((cutoff) => [cutoff.cutoffTime, cutoff.deciles])),
        },
      ]),
    ),
    historyDepthResults: Object.fromEntries(report.models.map((model) => [model.modelId, model.overallHistoryDepth])),
    recencyResults: Object.fromEntries(report.models.map((model) => [model.modelId, model.overallRecency])),
    outlierSensitivity: Object.fromEntries(report.models.map((model) => [model.modelId, model.outlierSensitivity])),
    modelSelectionFindings: buildModelSelectionFindings(report.models),
    consoleSummary: renderConsoleSummary(report.models, report.rollingOriginPlan, requestedCutoff ?? null),
  };

  if (options.outPath !== undefined) {
    const absoluteOutPath = resolve(options.outPath);
    await mkdir(dirname(absoluteOutPath), { recursive: true });
    await writeFile(`${absoluteOutPath}`, `${JSON.stringify(augmentedReport, null, 2)}\n`, 'utf8');
    console.log(augmentedReport.consoleSummary);
    console.log(`Report written to ${absoluteOutPath}`);
  } else {
    console.log(augmentedReport.consoleSummary);
    console.log(JSON.stringify(augmentedReport, null, 2));
  }
} finally {
  await pool.end();
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let evaluationCutoff: string | undefined;
  let outPath: string | undefined;
  let maxCutoffs = 8;
  let modelIds: CustomerClvBaselineId[] | undefined;

  for (const arg of argv) {
    if (arg.startsWith('--evaluation-cutoff=')) {
      evaluationCutoff = arg.slice('--evaluation-cutoff='.length);
      continue;
    }
    if (arg.startsWith('--model=')) {
      const parsed = arg
        .slice('--model='.length)
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      const unknown = parsed.filter((value) => !KNOWN_MODEL_IDS.includes(value as CustomerClvBaselineId));
      if (unknown.length > 0) {
        throw new Error(`Unknown --model values: ${unknown.join(', ')}`);
      }
      modelIds = parsed as CustomerClvBaselineId[];
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
    ...(modelIds === undefined ? {} : { modelIds }),
    ...(outPath === undefined ? {} : { outPath }),
    maxCutoffs,
  };
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

function chooseBestCalibratedBaseline(models: readonly {
  readonly modelId: string;
  readonly overallRevenueMetrics: { readonly calibrationRatio: string | null };
}[]) {
  const scored = models
    .filter((model) => model.overallRevenueMetrics.calibrationRatio !== null)
    .map((model) => ({
      modelId: model.modelId,
      calibrationRatio: model.overallRevenueMetrics.calibrationRatio!,
      distanceFromPerfect: Math.abs(Number(model.overallRevenueMetrics.calibrationRatio) - 1),
    }))
    .sort((left, right) => left.distanceFromPerfect - right.distanceFromPerfect || left.modelId.localeCompare(right.modelId));
  return scored[0] ?? null;
}

function chooseBestRankingBaseline(models: readonly {
  readonly modelId: string;
  readonly overallTopCapture: { readonly top10PctRevenueCapture: string | null; readonly top20PctRevenueCapture?: string | null };
  readonly overallRevenueMetrics: { readonly spearmanRankCorrelation?: string | null };
}[]) {
  const scored = [...models].sort((left, right) => {
    const byTop10 = descendingNullableNumber(left.overallTopCapture.top10PctRevenueCapture, right.overallTopCapture.top10PctRevenueCapture);
    if (byTop10 !== 0) return byTop10;
    const byTop20 = descendingNullableNumber(left.overallTopCapture.top20PctRevenueCapture ?? null, right.overallTopCapture.top20PctRevenueCapture ?? null);
    if (byTop20 !== 0) return byTop20;
    const bySpearman = descendingNullableNumber(left.overallRevenueMetrics.spearmanRankCorrelation ?? null, right.overallRevenueMetrics.spearmanRankCorrelation ?? null);
    if (bySpearman !== 0) return bySpearman;
    return left.modelId.localeCompare(right.modelId);
  });
  return scored[0]
    ? {
        modelId: scored[0].modelId,
        top10PctRevenueCapture: scored[0].overallTopCapture.top10PctRevenueCapture,
        spearmanRankCorrelation: scored[0].overallRevenueMetrics.spearmanRankCorrelation ?? null,
      }
    : null;
}

function chooseHardestBaselineToBeat(models: readonly {
  readonly modelId: string;
  readonly overallTopCapture: { readonly top10PctRevenueCapture: string | null };
  readonly overallRevenueMetrics: { readonly calibrationRatio: string | null; readonly mae: string | null };
}[]) {
  const scored = [...models].sort((left, right) => {
    const byTop10 = descendingNullableNumber(left.overallTopCapture.top10PctRevenueCapture, right.overallTopCapture.top10PctRevenueCapture);
    if (byTop10 !== 0) return byTop10;
    const byMae = ascendingNullableNumber(left.overallRevenueMetrics.mae, right.overallRevenueMetrics.mae);
    if (byMae !== 0) return byMae;
    const byCalibration = ascendingNumber(
      left.overallRevenueMetrics.calibrationRatio === null ? Number.POSITIVE_INFINITY : Math.abs(Number(left.overallRevenueMetrics.calibrationRatio) - 1),
      right.overallRevenueMetrics.calibrationRatio === null ? Number.POSITIVE_INFINITY : Math.abs(Number(right.overallRevenueMetrics.calibrationRatio) - 1),
    );
    if (byCalibration !== 0) return byCalibration;
    return left.modelId.localeCompare(right.modelId);
  });
  return scored[0]
    ? {
        modelId: scored[0].modelId,
        top10PctRevenueCapture: scored[0].overallTopCapture.top10PctRevenueCapture,
        mae: scored[0].overallRevenueMetrics.mae,
        calibrationRatio: scored[0].overallRevenueMetrics.calibrationRatio,
      }
    : null;
}

function buildModelSelectionFindings(models: readonly {
  readonly modelId: string;
  readonly overallRevenueMetrics: { readonly calibrationRatio: string | null; readonly mae: string | null; readonly spearmanRankCorrelation: string | null };
  readonly overallActivityMetrics: { readonly prAuc: string | null; readonly actualActivityRate: string };
  readonly overallConditionalValueMetrics: { readonly mae: string | null; readonly activeCustomerCount: number };
  readonly overallTopCapture: { readonly top10PctRevenueCapture: string | null; readonly top20PctRevenueCapture: string | null };
}[]) {
  const bestRanking = chooseBestRankingBaseline(models);
  const bestCalibration = chooseBestCalibratedBaseline(models);
  const activityStageLooksUseful = models.some((model) => model.overallActivityMetrics.prAuc !== null);
  return {
    bestRanking,
    bestCalibration,
    activityStageLooksUseful,
    twoStageStructureSupported: activityStageLooksUseful,
    directExpectedRevenueStillDefensible: bestRanking?.modelId === 'simple-cohort-prior-v1' || bestRanking?.modelId === 'historical-12m-revenue-v1',
    notes: [
      'A03 keeps raw nominal CLP revenue labels and reports zero-inflation directly.',
      'The blocked exact historical RFM-segment baseline is replaced by a cutoff-safe R/F/M bucket median baseline.',
      'PR-AUC is reported only for baselines that emit an activity probability.',
    ],
  };
}

function renderConsoleSummary(
  models: readonly {
    readonly modelId: string;
    readonly overallRevenueMetrics: { readonly mae: string | null; readonly calibrationRatio: string | null; readonly spearmanRankCorrelation: string | null };
    readonly overallTopCapture: { readonly top10PctRevenueCapture: string | null; readonly top20PctRevenueCapture: string | null };
  }[],
  plan: readonly { readonly evaluationCutoff: string; readonly trainingCutoffs: readonly string[] }[],
  evaluationCutoff: string | null,
): string {
  const bestCalibration = chooseBestCalibratedBaseline(models);
  const bestRanking = chooseBestRankingBaseline(models);
  const hardest = chooseHardestBaselineToBeat(models);
  return [
    `CLV A03 rolling-origin evaluation complete${evaluationCutoff === null ? '' : ` for cutoff ${evaluationCutoff}`}.`,
    `Evaluation cutoffs: ${plan.map((row) => row.evaluationCutoff).join(', ')}`,
    `Best calibrated baseline: ${bestCalibration?.modelId ?? 'n/a'}${bestCalibration?.calibrationRatio ? ` (ratio=${bestCalibration.calibrationRatio})` : ''}`,
    `Best ranking baseline: ${bestRanking?.modelId ?? 'n/a'}${bestRanking?.top10PctRevenueCapture ? ` (top10=${bestRanking.top10PctRevenueCapture})` : ''}`,
    `Hardest baseline to beat: ${hardest?.modelId ?? 'n/a'}${hardest?.mae ? ` (mae=${hardest.mae})` : ''}`,
  ].join('\n');
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

function descendingNullableNumber(left: string | null, right: string | null): number {
  return ascendingNumber(right === null ? Number.NEGATIVE_INFINITY : Number(right), left === null ? Number.NEGATIVE_INFINITY : Number(left));
}

function ascendingNullableNumber(left: string | null, right: string | null): number {
  return ascendingNumber(left === null ? Number.POSITIVE_INFINITY : Number(left), right === null ? Number.POSITIVE_INFINITY : Number(right));
}

function ascendingNumber(left: number, right: number): number {
  return left - right;
}
