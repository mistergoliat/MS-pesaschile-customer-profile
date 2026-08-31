import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { addDecimals, compareDecimalAsc, divideDecimal, formatDecimal } from '../../src/shared/decimal.js';
import {
  buildCustomerClvBacktestDataset,
  buildCustomerClvCandidateBacktestCutoffs,
  CUSTOMER_CLV_CURRENCY_ISO_CODE,
  CUSTOMER_CLV_EXCLUDED_OPERATIONAL_CUSTOMER_IDS,
  serializeCustomerClvBacktestDataset,
} from '../../src/domain/customer-clv/index.js';
import { createMysqlCustomerClvHistoricalReader } from '../../src/infrastructure/prestashop/mysql-customer-clv-historical-reader.js';
import { assertPrestashopPoolIsReadOnly, createPrestashopPool, loadPrestashopConnectionConfig } from '../clustering/lib/db.js';

type CliOptions = {
  readonly cutoffTime: string | null;
  readonly maxCutoffs: number;
  readonly outPath: string | null;
};

type DecimalDistribution = {
  readonly min: string | null;
  readonly median: string | null;
  readonly p75: string | null;
  readonly p90: string | null;
  readonly p95: string | null;
  readonly p99: string | null;
  readonly max: string | null;
  readonly mean: string | null;
};

const options = parseCliOptions(process.argv.slice(2));
const connection = loadPrestashopConnectionConfig(process.env);
const pool = createPrestashopPool(connection);
const startedAtMs = Date.now();
const startHeapUsed = process.memoryUsage().heapUsed;

try {
  const readOnlyGrantCheck = await assertPrestashopPoolIsReadOnly(pool);
  const reader = createMysqlCustomerClvHistoricalReader(pool, connection.prefix);
  await reader.verifySchema();
  const source = await reader.readSource();
  const candidateCutoffs = buildCustomerClvCandidateBacktestCutoffs({
    firstObservedOrderAt: firstObservedEligibleOrderAt(source.orders),
    availableDataThrough: source.availableDataThrough,
    maxCutoffs: options.maxCutoffs,
  });
  const cutoffTime = options.cutoffTime ?? candidateCutoffs.at(-1) ?? null;
  if (cutoffTime === null) {
    throw new Error('No mature CLV backtest cutoff is available from the extracted source');
  }

  const dataset = buildCustomerClvBacktestDataset({
    cutoffTime,
    availableDataThrough: source.availableDataThrough,
    sourceOrders: source.orders,
  });
  const artifact = serializeCustomerClvBacktestDataset(dataset);
  if (options.outPath !== null) {
    const absoluteOutPath = resolve(options.outPath);
    await mkdir(dirname(absoluteOutPath), { recursive: true });
    await writeFile(absoluteOutPath, artifact, 'utf8');
  }

  const durationMs = Date.now() - startedAtMs;
  const heapUsedDeltaMb = roundNumber((process.memoryUsage().heapUsed - startHeapUsed) / (1024 * 1024));
  const labelRevenues = dataset.rows.map((row) => row.labels.futureRevenueTaxIncl);
  const futureOrderCounts = dataset.rows.map((row) => row.labels.futureValidOrderCount);
  const historicalOrderCounts = dataset.rows.map((row) => row.features.historicalValidOrderCount);
  const historicalCancelledOrders = source.orders.filter(
    (order) => Date.parse(order.createdAt) < Date.parse(cutoffTime) && order.currentStateId === 6,
  ).length;
  const validPositiveOrders = source.orders.filter(
    (order) => order.currentValid && compareDecimalAsc(order.totalPaidTaxIncl, '0.000000') > 0,
  );
  const eligibleNonClpOrders = validPositiveOrders.filter((order) => order.currencyIsoCode !== CUSTOMER_CLV_CURRENCY_ISO_CODE).length;
  const missingCurrencyOnEligibleOrders = validPositiveOrders.filter((order) => order.currencyIsoCode === null).length;
  const duplicateOrderIds = source.orders.length - new Set(source.orders.map((order) => order.orderId)).size;
  const negativeTotalOrders = source.orders.filter(
    (order) =>
      compareDecimalAsc(order.totalPaidTaxIncl, '0.000000') < 0 ||
      compareDecimalAsc(order.totalDiscountsTaxIncl, '0.000000') < 0 ||
      compareDecimalAsc(order.totalShippingTaxIncl, '0.000000') < 0 ||
      compareDecimalAsc(order.sellerServiceRevenueTaxIncl, '0.000000') < 0,
  ).length;
  const operationalExclusion = await readOperationalExclusionStats(pool, connection.prefix);
  const report = {
    cutoffTime,
    availableDataThrough: source.availableDataThrough,
    readOnlyGrantCheck,
    candidateBacktestCutoffs: candidateCutoffs,
    datasetVersion: dataset.manifest.datasetVersion,
    population: dataset.manifest.customerCount,
    historyOrderCount: dataset.manifest.historyOrderCount,
    labelOrderCount: dataset.manifest.labelOrderCount,
    zeroFutureOrderRate: ratio(dataset.manifest.zeroFutureOrderCustomerCount, dataset.manifest.customerCount),
    singleHistoricalOrderCoverage: ratio(dataset.manifest.singleHistoricalOrderCustomerCount, dataset.manifest.customerCount),
    futureRevenueDistribution: describeDecimalDistribution(labelRevenues),
    futureOrderDistribution: describeIntegerDistribution(futureOrderCounts),
    historicalOrderDistribution: describeIntegerDistribution(historicalOrderCounts),
    currencyFindings: {
      distinctObservedCurrencies: Array.from(new Set(validPositiveOrders.map((order) => order.currencyIsoCode ?? 'NULL'))).sort(),
      eligibleNonClpOrders,
      missingCurrencyOnEligibleOrders,
    },
    dataQuality: {
      totalOrdersRead: source.orders.length,
      totalProductRowsRead: source.orders.reduce((total, order) => total + order.products.length, 0),
      duplicateOrderIds,
      missingCustomerCreatedAtOrders: 0,
      missingCreatedAtOrders: 0,
      negativeTotalOrders,
      excludedInconsistentCustomerCreatedAtCustomerCount: dataset.manifest.excludedInconsistentCustomerCreatedAtCustomerCount,
      excludedOrderBeforeCustomerCreatedAtCustomerCount: dataset.manifest.excludedOrderBeforeCustomerCreatedAtCustomerCount,
      ordersWithRefundEvidence: source.orders.filter((order) => order.refundEvidence).length,
      historicalCancelledOrdersObservedByCurrentState: historicalCancelledOrders,
      excludedOperationalCustomerCount: operationalExclusion.customerCount,
      excludedOperationalOrderCount: operationalExclusion.orderCount,
      extremeFutureRevenueMax: describeDecimalDistribution(labelRevenues).max,
    },
    artifact: {
      bytes: Buffer.byteLength(artifact, 'utf8'),
      outPath: options.outPath === null ? null : resolve(options.outPath),
      datasetChecksum: dataset.manifest.datasetChecksum,
    },
    performance: {
      durationMs,
      heapUsedDeltaMb,
      sourceRowsRead: source.orders.length + source.orders.reduce((total, order) => total + order.products.length, 0),
    },
  };

  console.log(JSON.stringify(report, null, 2));
} finally {
  await pool.end();
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let cutoffTime: string | null = null;
  let maxCutoffs = 8;
  let outPath: string | null = null;

  for (const arg of argv) {
    if (arg.startsWith('--cutoff=')) {
      cutoffTime = arg.slice('--cutoff='.length);
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
    if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { cutoffTime, maxCutoffs, outPath };
}

function firstObservedEligibleOrderAt(
  orders: readonly {
    readonly createdAt: string;
    readonly currentValid: boolean;
    readonly currencyIsoCode: string | null;
    readonly totalPaidTaxIncl: string;
  }[],
): string | null {
  const eligible = orders
    .filter((order) => order.currentValid && order.currencyIsoCode === CUSTOMER_CLV_CURRENCY_ISO_CODE && compareDecimalAsc(order.totalPaidTaxIncl, '0.000000') > 0)
    .map((order) => order.createdAt)
    .sort();
  return eligible[0] ?? null;
}

async function readOperationalExclusionStats(pool: Pool, tablePrefix: string) {
  const placeholders = CUSTOMER_CLV_EXCLUDED_OPERATIONAL_CUSTOMER_IDS.map(() => '?').join(', ');
  const [rows] = await pool.execute<RowDataPacket[]>(
    `
      SELECT
        COUNT(DISTINCT o.id_customer) AS customerCount,
        COUNT(*) AS orderCount
      FROM ${tablePrefix}orders o
      WHERE o.id_customer IN (${placeholders})
    `,
    [...CUSTOMER_CLV_EXCLUDED_OPERATIONAL_CUSTOMER_IDS],
  );
  const row = (rows[0] ?? { customerCount: 0, orderCount: 0 }) as { customerCount?: string | number; orderCount?: string | number };
  return {
    customerCount: Number(row.customerCount ?? 0),
    orderCount: Number(row.orderCount ?? 0),
  };
}

function describeDecimalDistribution(values: readonly string[]): DecimalDistribution {
  const sorted = [...values].sort(compareDecimalAsc);
  return {
    min: percentileDecimal(sorted, 0),
    median: percentileDecimal(sorted, 0.5),
    p75: percentileDecimal(sorted, 0.75),
    p90: percentileDecimal(sorted, 0.9),
    p95: percentileDecimal(sorted, 0.95),
    p99: percentileDecimal(sorted, 0.99),
    max: percentileDecimal(sorted, 1),
    mean: sorted.length === 0 ? null : divideDecimal(addDecimals(sorted), sorted.length),
  };
}

function percentileDecimal(sortedAscending: readonly string[], fraction: number): string | null {
  if (sortedAscending.length === 0) return null;
  const bounded = Math.min(Math.max(fraction, 0), 1);
  const index = Math.ceil(bounded * sortedAscending.length) - 1;
  return sortedAscending[Math.max(index, 0)]!;
}

function describeIntegerDistribution(values: readonly number[]) {
  if (values.length === 0) {
    return {
      count: 0,
      min: null,
      median: null,
      p75: null,
      p90: null,
      p95: null,
      p99: null,
      max: null,
      mean: null,
    };
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    min: percentileInteger(sorted, 0),
    median: percentileInteger(sorted, 0.5),
    p75: percentileInteger(sorted, 0.75),
    p90: percentileInteger(sorted, 0.9),
    p95: percentileInteger(sorted, 0.95),
    p99: percentileInteger(sorted, 0.99),
    max: percentileInteger(sorted, 1),
    mean: roundNumber(sorted.reduce((total, value) => total + value, 0) / sorted.length),
  };
}

function percentileInteger(sortedAscending: readonly number[], fraction: number): number | null {
  if (sortedAscending.length === 0) return null;
  const bounded = Math.min(Math.max(fraction, 0), 1);
  const index = Math.ceil(bounded * sortedAscending.length) - 1;
  return sortedAscending[Math.max(index, 0)]!;
}

function ratio(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0.000000';
  return divideDecimal(formatDecimal(String(numerator)), denominator);
}

function roundNumber(value: number): number {
  return Number(value.toFixed(3));
}
