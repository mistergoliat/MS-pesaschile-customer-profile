import { addDecimals, compareDecimalAsc, formatDecimal } from '../../shared/decimal.js';
import {
  CUSTOMER_CLV_CURRENCY_ISO_CODE,
  CUSTOMER_CLV_HORIZON_MONTHS,
  CUSTOMER_CLV_MONETARY_POLICY_VERSION,
  CUSTOMER_CLV_POPULATION_POLICY_VERSION,
} from './contracts.js';
import { assertClpCurrency, assertIsoTimestamp, assertNonEmptyString, assertPositiveInteger } from './validation.js';
import { sha256Stable } from '../customer-rfm/checksum.js';

const DAY_MS = 86_400_000;
const DECIMAL_SCALE = 6;
const ISO_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export const CUSTOMER_CLV_BACKTEST_DATASET_VERSION = 'customer-clv-backtest-dataset-v1';
export const CUSTOMER_CLV_ORDER_ELIGIBILITY_POLICY_VERSION = 'customer-clv-order-eligibility-current-valid-positive-clp-v1';
export const CUSTOMER_CLV_PRODUCT_FEATURE_POLICY_VERSION = 'customer-clv-product-features-non-product-excluded-v1';
export const CUSTOMER_CLV_ORDER_STATUS_TEMPORAL_POLICY_VERSION = 'customer-clv-current-valid-observed-with-documented-drift-v1';
export const CUSTOMER_CLV_SOURCE_DATE_TIME_STORAGE = 'mysql_datetime';
export const CUSTOMER_CLV_TIMEZONE_STATUS = 'UNVERIFIED';
export const CUSTOMER_CLV_SOURCE_TIMEZONE = 'UNVERIFIED';
export const CUSTOMER_CLV_CALCULATION_TIMEZONE = 'UTC';
export const CUSTOMER_CLV_REFERENCE_TIME_TIMEZONE = 'UTC';

export const CUSTOMER_CLV_CONFIRMED_SELLER_SERVICE_PRODUCT_IDS: readonly number[] = [444];
export const CUSTOMER_CLV_CONFIRMED_NON_PRODUCT_PRODUCT_IDS: readonly number[] = [444, 505, 554, 555, 556, 557, 558, 902, 903];
export const CUSTOMER_CLV_EXCLUDED_OPERATIONAL_CUSTOMER_IDS: readonly number[] = [39617, 85980, 86421, 90890];
const EXCLUDED_OPERATIONAL_CUSTOMER_ID_SET = new Set(CUSTOMER_CLV_EXCLUDED_OPERATIONAL_CUSTOMER_IDS);

export type CustomerClvBacktestSourceOrderProduct = {
  readonly productId: number;
  readonly quantity: number;
  readonly revenueTaxIncl: string;
};

export type CustomerClvBacktestSourceOrder = {
  readonly orderId: number;
  readonly customerId: number;
  readonly customerCreatedAt: string;
  readonly createdAt: string;
  readonly currentValid: boolean;
  readonly currentStateId: number | null;
  readonly currencyIsoCode: string | null;
  readonly totalPaidTaxIncl: string;
  readonly totalDiscountsTaxIncl: string;
  readonly totalShippingTaxIncl: string;
  readonly sellerServiceRevenueTaxIncl: string;
  readonly refundEvidence: boolean;
  readonly products: readonly CustomerClvBacktestSourceOrderProduct[];
};

export type CustomerClvBacktestSource = {
  readonly availableDataThrough: string;
  readonly orders: readonly CustomerClvBacktestSourceOrder[];
};

export type CustomerClvBacktestFeatures = {
  readonly historicalValidOrderCount: number;
  readonly historicalRevenueTaxIncl: string;
  readonly historicalAovTaxIncl: string;
  readonly firstValidOrderAt: string;
  readonly lastValidOrderAt: string;
  readonly customerTenureDays: number;
  readonly daysSinceLastOrder: number;
  readonly purchaseFrequencyDays: string | null;
  readonly orders90d: number;
  readonly orders180d: number;
  readonly orders365d: number;
  readonly revenue90d: string;
  readonly revenue180d: string;
  readonly revenue365d: string;
  readonly distinctPurchaseMonths: number;
  readonly cancellationRatio: string;
  readonly discountShare: string;
  readonly shippingShare: string;
  readonly distinctProductCount: number;
  readonly repeatProductRate: string | null;
  readonly productConcentration: string | null;
};

export type CustomerClvBacktestLabels = {
  readonly futureRevenueTaxIncl: string;
  readonly futureValidOrderCount: number;
};

export type CustomerClvBacktestObservationMetadata = {
  readonly historyStart: string;
  readonly firstValidOrderAt: string;
  readonly lastValidOrderAt: string;
  readonly historicalValidOrderCount: number;
  readonly historyDays: number;
};

export type CustomerClvBacktestExample = {
  readonly customerId: number;
  readonly cutoffTime: string;
  readonly features: CustomerClvBacktestFeatures;
  readonly labels: CustomerClvBacktestLabels;
  readonly observationMetadata: CustomerClvBacktestObservationMetadata;
};

export type CustomerClvBacktestDatasetManifest = {
  readonly datasetVersion: typeof CUSTOMER_CLV_BACKTEST_DATASET_VERSION;
  readonly populationPolicyVersion: string;
  readonly monetaryPolicyVersion: string;
  readonly orderEligibilityPolicyVersion: typeof CUSTOMER_CLV_ORDER_ELIGIBILITY_POLICY_VERSION;
  readonly productFeaturePolicyVersion: typeof CUSTOMER_CLV_PRODUCT_FEATURE_POLICY_VERSION;
  readonly orderStatusTemporalPolicyVersion: typeof CUSTOMER_CLV_ORDER_STATUS_TEMPORAL_POLICY_VERSION;
  readonly cutoffTime: string;
  readonly labelWindowStartInclusive: string;
  readonly labelWindowEndExclusive: string;
  readonly availableDataThrough: string;
  readonly horizonMonths: typeof CUSTOMER_CLV_HORIZON_MONTHS;
  readonly customerCount: number;
  readonly historyOrderCount: number;
  readonly labelOrderCount: number;
  readonly zeroFutureOrderCustomerCount: number;
  readonly singleHistoricalOrderCustomerCount: number;
  readonly excludedInconsistentCustomerCreatedAtCustomerCount: number;
  readonly excludedOrderBeforeCustomerCreatedAtCustomerCount: number;
  readonly currencyIsoCode: typeof CUSTOMER_CLV_CURRENCY_ISO_CODE;
  readonly sourceDateTimeStorage: typeof CUSTOMER_CLV_SOURCE_DATE_TIME_STORAGE;
  readonly timezoneStatus: typeof CUSTOMER_CLV_TIMEZONE_STATUS;
  readonly sourceTimezone: typeof CUSTOMER_CLV_SOURCE_TIMEZONE;
  readonly calculationTimezone: typeof CUSTOMER_CLV_CALCULATION_TIMEZONE;
  readonly referenceTimeTimezone: typeof CUSTOMER_CLV_REFERENCE_TIME_TIMEZONE;
  readonly temporalStateKnownLimitations: readonly string[];
  readonly inputChecksum: string;
  readonly featureChecksum: string;
  readonly labelChecksum: string;
  readonly datasetChecksum: string;
};

export type CustomerClvBacktestDataset = {
  readonly manifest: CustomerClvBacktestDatasetManifest;
  readonly rows: readonly CustomerClvBacktestExample[];
};

export type BuildCustomerClvBacktestDatasetInput = {
  readonly cutoffTime: string;
  readonly availableDataThrough: string;
  readonly generatedAt?: string;
  readonly sourceOrders: readonly CustomerClvBacktestSourceOrder[];
  readonly allowUnmaturedLabels?: boolean;
};

export function buildCustomerClvBacktestDataset(input: BuildCustomerClvBacktestDatasetInput): CustomerClvBacktestDataset {
  assertIsoTimestamp(input.cutoffTime, 'cutoffTime');
  assertIsoTimestamp(input.availableDataThrough, 'availableDataThrough');
  const cutoffTime = normalizeIsoTimestamp(input.cutoffTime, 'cutoffTime');
  const availableDataThrough = normalizeIsoTimestamp(input.availableDataThrough, 'availableDataThrough');
  const labelWindowEndExclusive = addUtcMonths(cutoffTime, CUSTOMER_CLV_HORIZON_MONTHS);
  if (!input.allowUnmaturedLabels && Date.parse(labelWindowEndExclusive) > Date.parse(availableDataThrough)) {
    throw new Error('CLV backtest dataset requires a mature 12-month label window');
  }

  const relevantOrders = input.sourceOrders
    .map(normalizeSourceOrder)
    .filter((order) => Date.parse(order.createdAt) < Date.parse(labelWindowEndExclusive))
    .sort((left, right) => {
      const byCustomer = left.customerId - right.customerId;
      if (byCustomer !== 0) return byCustomer;
      const byCreatedAt = left.createdAt.localeCompare(right.createdAt);
      return byCreatedAt !== 0 ? byCreatedAt : left.orderId - right.orderId;
    });

  assertNoDuplicateOrders(relevantOrders);
  assertRelevantCurrencies(relevantOrders);

  const grouped = groupOrdersByCustomer(relevantOrders);
  const rows: CustomerClvBacktestExample[] = [];
  let historyOrderCount = 0;
  let labelOrderCount = 0;
  let zeroFutureOrderCustomerCount = 0;
  let singleHistoricalOrderCustomerCount = 0;
  let excludedInconsistentCustomerCreatedAtCustomerCount = 0;
  let excludedOrderBeforeCustomerCreatedAtCustomerCount = 0;

  for (const [customerId, customerOrders] of grouped.entries()) {
    const registrationIntegrity = assessCustomerRegistrationIntegrity(customerOrders);
    if (registrationIntegrity === 'inconsistent_customer_created_at') {
      excludedInconsistentCustomerCreatedAtCustomerCount += 1;
      continue;
    }
    if (registrationIntegrity === 'order_before_customer_created_at') {
      excludedOrderBeforeCustomerCreatedAtCustomerCount += 1;
      continue;
    }
    const row = buildCustomerExample(customerId, customerOrders, cutoffTime, labelWindowEndExclusive);
    if (!row) continue;
    const outputRow = input.allowUnmaturedLabels
      ? { ...row, labels: { futureRevenueTaxIncl: '0.000000', futureValidOrderCount: 0 } }
      : row;
    rows.push(outputRow);
    historyOrderCount += outputRow.features.historicalValidOrderCount;
    labelOrderCount += outputRow.labels.futureValidOrderCount;
    if (outputRow.labels.futureValidOrderCount === 0) zeroFutureOrderCustomerCount += 1;
    if (outputRow.features.historicalValidOrderCount === 1) singleHistoricalOrderCustomerCount += 1;
  }

  const sortedRows = [...rows].sort((left, right) => left.customerId - right.customerId);
  assertUniqueDatasetRows(sortedRows, cutoffTime);

  const inputChecksum = sha256Stable({
    datasetVersion: CUSTOMER_CLV_BACKTEST_DATASET_VERSION,
    cutoffTime,
    availableDataThrough,
    horizonMonths: CUSTOMER_CLV_HORIZON_MONTHS,
    sourceOrders: relevantOrders.map(sourceOrderChecksumShape),
  });
  const featureChecksum = sha256Stable(sortedRows.map((row) => ({
    customerId: row.customerId,
    cutoffTime: row.cutoffTime,
    features: row.features,
    observationMetadata: row.observationMetadata,
  })));
  const labelChecksum = sha256Stable(sortedRows.map((row) => ({
    customerId: row.customerId,
    cutoffTime: row.cutoffTime,
    labels: row.labels,
  })));

  const manifestWithoutDatasetChecksum = {
    datasetVersion: CUSTOMER_CLV_BACKTEST_DATASET_VERSION,
    populationPolicyVersion: CUSTOMER_CLV_POPULATION_POLICY_VERSION,
    monetaryPolicyVersion: CUSTOMER_CLV_MONETARY_POLICY_VERSION,
    orderEligibilityPolicyVersion: CUSTOMER_CLV_ORDER_ELIGIBILITY_POLICY_VERSION,
    productFeaturePolicyVersion: CUSTOMER_CLV_PRODUCT_FEATURE_POLICY_VERSION,
    orderStatusTemporalPolicyVersion: CUSTOMER_CLV_ORDER_STATUS_TEMPORAL_POLICY_VERSION,
    cutoffTime,
    labelWindowStartInclusive: cutoffTime,
    labelWindowEndExclusive,
    availableDataThrough,
    horizonMonths: CUSTOMER_CLV_HORIZON_MONTHS,
    customerCount: sortedRows.length,
    historyOrderCount,
    labelOrderCount,
    zeroFutureOrderCustomerCount,
    singleHistoricalOrderCustomerCount,
    excludedInconsistentCustomerCreatedAtCustomerCount,
    excludedOrderBeforeCustomerCreatedAtCustomerCount,
    currencyIsoCode: CUSTOMER_CLV_CURRENCY_ISO_CODE,
    sourceDateTimeStorage: CUSTOMER_CLV_SOURCE_DATE_TIME_STORAGE,
    timezoneStatus: CUSTOMER_CLV_TIMEZONE_STATUS,
    sourceTimezone: CUSTOMER_CLV_SOURCE_TIMEZONE,
    calculationTimezone: CUSTOMER_CLV_CALCULATION_TIMEZONE,
    referenceTimeTimezone: CUSTOMER_CLV_REFERENCE_TIME_TIMEZONE,
    temporalStateKnownLimitations: [
      'ps_orders.valid is observed at extraction time, not reconstructed as-of cutoff',
      'ps_orders.current_state can diverge from the latest ps_order_history event',
      'cancellationRatio is therefore deterministic but not fully point-in-time reconstructible from current repository evidence',
    ],
    inputChecksum,
    featureChecksum,
    labelChecksum,
  } as const;

  const datasetChecksum = sha256Stable({
    manifest: manifestWithoutDatasetChecksum,
    rows: sortedRows,
  });

  return {
    manifest: {
      ...manifestWithoutDatasetChecksum,
      datasetChecksum,
    },
    rows: sortedRows,
  };
}

export function buildCustomerClvProductionDataset(input: {
  readonly referenceTime: string;
  readonly availableDataThrough: string;
  readonly sourceOrders: readonly CustomerClvBacktestSourceOrder[];
}): CustomerClvBacktestDataset {
  return buildCustomerClvBacktestDataset({
    cutoffTime: input.referenceTime,
    availableDataThrough: input.availableDataThrough,
    sourceOrders: input.sourceOrders,
    allowUnmaturedLabels: true,
  });
}

export function serializeCustomerClvBacktestDataset(dataset: CustomerClvBacktestDataset): string {
  return `${JSON.stringify(dataset)}\n`;
}

export function buildCustomerClvCandidateBacktestCutoffs(input: {
  readonly firstObservedOrderAt: string | null;
  readonly availableDataThrough: string;
  readonly maxCutoffs?: number;
}): readonly string[] {
  assertIsoTimestamp(input.availableDataThrough, 'availableDataThrough');
  const availableDataThrough = normalizeIsoTimestamp(input.availableDataThrough, 'availableDataThrough');
  if (input.firstObservedOrderAt === null) {
    return [];
  }
  assertIsoTimestamp(input.firstObservedOrderAt, 'firstObservedOrderAt');
  const firstObservedOrderAt = normalizeIsoTimestamp(input.firstObservedOrderAt, 'firstObservedOrderAt');
  const latestMatureCutoff = addUtcMonths(availableDataThrough, -CUSTOMER_CLV_HORIZON_MONTHS);
  const candidates: string[] = [];
  const start = new Date(Date.parse(firstObservedOrderAt));
  const latest = new Date(Date.parse(latestMatureCutoff));
  const firstSemiAnnual = start.getUTCMonth() < 6
    ? new Date(Date.UTC(start.getUTCFullYear(), 6, 1, 0, 0, 0, 0))
    : new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0));
  for (let cursor = firstSemiAnnual; cursor.getTime() <= latest.getTime(); cursor = addUtcMonthsDate(cursor, 6)) {
    candidates.push(cursor.toISOString());
  }
  const maxCutoffs = input.maxCutoffs ?? 6;
  assertPositiveInteger(maxCutoffs, 'maxCutoffs');
  return candidates.slice(-maxCutoffs);
}

function buildCustomerExample(
  customerId: number,
  customerOrders: readonly CustomerClvBacktestSourceOrder[],
  cutoffTime: string,
  labelWindowEndExclusive: string,
): CustomerClvBacktestExample | null {
  if (EXCLUDED_OPERATIONAL_CUSTOMER_ID_SET.has(customerId)) {
    return null;
  }
  const cutoffMs = Date.parse(cutoffTime);
  const labelWindowEndMs = Date.parse(labelWindowEndExclusive);
  const historyOrders = customerOrders.filter((order) => isHistoricalOrder(order, cutoffMs));
  const historicalValidOrders = historyOrders.filter(isEligibleValidOrder);
  if (historicalValidOrders.length === 0) {
    return null;
  }
  const registrationTime = Date.parse(customerOrders[0]!.customerCreatedAt);
  if (registrationTime >= cutoffMs) {
    return null;
  }

  const labelOrders = customerOrders.filter((order) => isLabelOrder(order, cutoffMs, labelWindowEndMs) && isEligibleValidOrder(order));
  const historicalRevenueTaxIncl = addDecimals(historicalValidOrders.map(orderCommercialRevenueTaxIncl));
  const historicalGrossPaidTaxIncl = addDecimals(historicalValidOrders.map((order) => order.totalPaidTaxIncl));
  const firstValidOrderAt = historicalValidOrders[0]!.createdAt;
  const lastValidOrderAt = historicalValidOrders.at(-1)!.createdAt;
  const productSummary = summarizeHistoricalProducts(historicalValidOrders);

  const features: CustomerClvBacktestFeatures = {
    historicalValidOrderCount: historicalValidOrders.length,
    historicalRevenueTaxIncl,
    historicalAovTaxIncl: divideDecimalByInteger(historicalRevenueTaxIncl, historicalValidOrders.length),
    firstValidOrderAt,
    lastValidOrderAt,
    customerTenureDays: elapsedWholeDays(customerOrders[0]!.customerCreatedAt, cutoffTime),
    daysSinceLastOrder: elapsedWholeDays(lastValidOrderAt, cutoffTime),
    purchaseFrequencyDays:
      historicalValidOrders.length < 2
        ? null
        : averageDaysBetweenOrders(firstValidOrderAt, lastValidOrderAt, historicalValidOrders.length),
    orders90d: countOrdersSince(historicalValidOrders, cutoffMs, 90),
    orders180d: countOrdersSince(historicalValidOrders, cutoffMs, 180),
    orders365d: countOrdersSince(historicalValidOrders, cutoffMs, 365),
    revenue90d: sumRevenueSince(historicalValidOrders, cutoffMs, 90),
    revenue180d: sumRevenueSince(historicalValidOrders, cutoffMs, 180),
    revenue365d: sumRevenueSince(historicalValidOrders, cutoffMs, 365),
    distinctPurchaseMonths: countDistinctPurchaseMonths(historicalValidOrders),
    cancellationRatio: divideDecimalStrings(
      String(historyOrders.filter((order) => order.currentStateId === 6).length),
      String(historyOrders.length),
    ),
    discountShare: divideDecimalStrings(
      addDecimals(historicalValidOrders.map((order) => order.totalDiscountsTaxIncl)),
      historicalGrossPaidTaxIncl,
    ),
    shippingShare: divideDecimalStrings(
      addDecimals(historicalValidOrders.map((order) => order.totalShippingTaxIncl)),
      historicalGrossPaidTaxIncl,
    ),
    distinctProductCount: productSummary.distinctProductCount,
    repeatProductRate:
      productSummary.distinctProductCount === 0
        ? null
        : divideDecimalStrings(String(productSummary.repeatedProductCount), String(productSummary.distinctProductCount)),
    productConcentration:
      compareDecimalAsc(productSummary.totalProductRevenueTaxIncl, '0.000000') === 0
        ? null
        : divideDecimalStrings(productSummary.topProductRevenueTaxIncl, productSummary.totalProductRevenueTaxIncl),
  };

  const labels: CustomerClvBacktestLabels = {
    futureRevenueTaxIncl: addDecimals(labelOrders.map(orderCommercialRevenueTaxIncl)),
    futureValidOrderCount: labelOrders.length,
  };

  const observationMetadata: CustomerClvBacktestObservationMetadata = {
    historyStart: customerOrders[0]!.customerCreatedAt,
    firstValidOrderAt,
    lastValidOrderAt,
    historicalValidOrderCount: historicalValidOrders.length,
    historyDays: elapsedWholeDays(customerOrders[0]!.customerCreatedAt, cutoffTime),
  };

  return {
    customerId,
    cutoffTime,
    features,
    labels,
    observationMetadata,
  };
}

function normalizeSourceOrder(order: CustomerClvBacktestSourceOrder): CustomerClvBacktestSourceOrder {
  assertPositiveInteger(order.orderId, 'orderId');
  assertPositiveInteger(order.customerId, 'customerId');
  const customerCreatedAt = normalizeIsoTimestamp(order.customerCreatedAt, 'customerCreatedAt');
  const createdAt = normalizeIsoTimestamp(order.createdAt, 'createdAt');
  if (order.currencyIsoCode !== null) {
    assertNonEmptyString(order.currencyIsoCode, 'currencyIsoCode');
  }
  const totalPaidTaxIncl = formatDecimal(order.totalPaidTaxIncl);
  const totalDiscountsTaxIncl = formatDecimal(order.totalDiscountsTaxIncl);
  const totalShippingTaxIncl = formatDecimal(order.totalShippingTaxIncl);
  const sellerServiceRevenueTaxIncl = formatDecimal(order.sellerServiceRevenueTaxIncl);
  if (compareDecimalAsc(totalPaidTaxIncl, '0.000000') < 0) {
    throw new Error(`Invalid orderId ${order.orderId}: totalPaidTaxIncl must be non-negative`);
  }
  if (compareDecimalAsc(totalDiscountsTaxIncl, '0.000000') < 0) {
    throw new Error(`Invalid orderId ${order.orderId}: totalDiscountsTaxIncl must be non-negative`);
  }
  if (compareDecimalAsc(totalShippingTaxIncl, '0.000000') < 0) {
    throw new Error(`Invalid orderId ${order.orderId}: totalShippingTaxIncl must be non-negative`);
  }
  if (compareDecimalAsc(sellerServiceRevenueTaxIncl, '0.000000') < 0) {
    throw new Error(`Invalid orderId ${order.orderId}: sellerServiceRevenueTaxIncl must be non-negative`);
  }

  const products = [...order.products]
    .map((product) => {
      assertPositiveInteger(product.productId, 'productId');
      if (!Number.isSafeInteger(product.quantity) || product.quantity < 0) {
        throw new Error(`Invalid product quantity for orderId ${order.orderId}`);
      }
      const revenueTaxIncl = formatDecimal(product.revenueTaxIncl);
      if (compareDecimalAsc(revenueTaxIncl, '0.000000') < 0) {
        throw new Error(`Invalid product revenueTaxIncl for orderId ${order.orderId}`);
      }
      return {
        productId: product.productId,
        quantity: product.quantity,
        revenueTaxIncl,
      } satisfies CustomerClvBacktestSourceOrderProduct;
    })
    .sort((left, right) => left.productId - right.productId);
  for (let index = 1; index < products.length; index += 1) {
    if (products[index - 1]!.productId === products[index]!.productId) {
      throw new Error(`Duplicate productId ${products[index]!.productId} in orderId ${order.orderId}`);
    }
  }

  return {
    ...order,
    customerCreatedAt,
    createdAt,
    totalPaidTaxIncl,
    totalDiscountsTaxIncl,
    totalShippingTaxIncl,
    sellerServiceRevenueTaxIncl,
    products,
  };
}

function normalizeIsoTimestamp(value: string, name: string): string {
  if (!ISO_UTC_TIMESTAMP_PATTERN.test(value)) {
    throw new Error(`Invalid ${name}: must be a UTC ISO timestamp`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${name}: must be a UTC ISO timestamp`);
  }
  return parsed.toISOString();
}

function isHistoricalOrder(order: CustomerClvBacktestSourceOrder, cutoffMs: number): boolean {
  return Date.parse(order.createdAt) < cutoffMs;
}

function isLabelOrder(order: CustomerClvBacktestSourceOrder, cutoffMs: number, labelWindowEndMs: number): boolean {
  const createdAtMs = Date.parse(order.createdAt);
  return createdAtMs >= cutoffMs && createdAtMs < labelWindowEndMs;
}

function isEligibleValidOrder(order: CustomerClvBacktestSourceOrder): boolean {
  if (!order.currentValid) return false;
  if (compareDecimalAsc(order.totalPaidTaxIncl, '0.000000') <= 0) return false;
  if (order.currencyIsoCode === null) return false;
  return order.currencyIsoCode === CUSTOMER_CLV_CURRENCY_ISO_CODE;
}

function orderCommercialRevenueTaxIncl(order: CustomerClvBacktestSourceOrder): string {
  return subtractFloorZero(order.totalPaidTaxIncl, order.sellerServiceRevenueTaxIncl);
}

function countOrdersSince(orders: readonly CustomerClvBacktestSourceOrder[], cutoffMs: number, days: number): number {
  const boundary = cutoffMs - days * DAY_MS;
  return orders.filter((order) => Date.parse(order.createdAt) >= boundary).length;
}

function sumRevenueSince(orders: readonly CustomerClvBacktestSourceOrder[], cutoffMs: number, days: number): string {
  const boundary = cutoffMs - days * DAY_MS;
  return addDecimals(
    orders
      .filter((order) => Date.parse(order.createdAt) >= boundary)
      .map(orderCommercialRevenueTaxIncl),
  );
}

function countDistinctPurchaseMonths(orders: readonly CustomerClvBacktestSourceOrder[]): number {
  return new Set(
    orders.map((order) => {
      const date = new Date(order.createdAt);
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    }),
  ).size;
}

function summarizeHistoricalProducts(orders: readonly CustomerClvBacktestSourceOrder[]): {
  readonly distinctProductCount: number;
  readonly repeatedProductCount: number;
  readonly totalProductRevenueTaxIncl: string;
  readonly topProductRevenueTaxIncl: string;
} {
  const revenueByProduct = new Map<number, string>();
  const orderCountByProduct = new Map<number, number>();
  for (const order of orders) {
    const productIdsSeenInOrder = new Set<number>();
    for (const product of order.products) {
      revenueByProduct.set(
        product.productId,
        addDecimals([revenueByProduct.get(product.productId) ?? '0.000000', product.revenueTaxIncl]),
      );
      if (!productIdsSeenInOrder.has(product.productId)) {
        orderCountByProduct.set(product.productId, (orderCountByProduct.get(product.productId) ?? 0) + 1);
        productIdsSeenInOrder.add(product.productId);
      }
    }
  }
  const revenueValues = Array.from(revenueByProduct.values()).sort(compareDecimalDesc);
  return {
    distinctProductCount: revenueByProduct.size,
    repeatedProductCount: Array.from(orderCountByProduct.values()).filter((count) => count >= 2).length,
    totalProductRevenueTaxIncl: addDecimals(Array.from(revenueByProduct.values())),
    topProductRevenueTaxIncl: revenueValues[0] ?? '0.000000',
  };
}

function averageDaysBetweenOrders(firstValidOrderAt: string, lastValidOrderAt: string, orderCount: number): string {
  const elapsedDays = (Date.parse(lastValidOrderAt) - Date.parse(firstValidOrderAt)) / DAY_MS;
  return formatDecimalString((elapsedDays / (orderCount - 1)).toFixed(DECIMAL_SCALE));
}

function elapsedWholeDays(startInclusive: string, endExclusive: string): number {
  const elapsed = Math.floor((Date.parse(endExclusive) - Date.parse(startInclusive)) / DAY_MS);
  if (elapsed < 0) {
    throw new Error('Negative elapsed days are not allowed');
  }
  return elapsed;
}

function addUtcMonths(iso: string, months: number): string {
  return addUtcMonthsDate(new Date(Date.parse(iso)), months).toISOString();
}

function addUtcMonthsDate(date: Date, months: number): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + months,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ));
}

function divideDecimalByInteger(value: string, denominator: number): string {
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    return '0.000000';
  }
  return fromScaled(divideScaled(toScaled(value), BigInt(denominator)));
}

function divideDecimalStrings(numerator: string, denominator: string): string {
  if (compareDecimalAsc(formatDecimal(denominator), '0.000000') === 0) {
    return '0.000000';
  }
  return fromScaled(divideScaled(toScaled(numerator) * 10n ** BigInt(DECIMAL_SCALE), toScaled(denominator)));
}

function subtractFloorZero(left: string, right: string): string {
  const diff = toScaled(left) - toScaled(right);
  return diff <= 0n ? '0.000000' : fromScaled(diff);
}

function toScaled(value: string): bigint {
  const trimmed = String(value).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal value: ${value}`);
  }
  const sign = trimmed.startsWith('-') ? -1n : 1n;
  const unsigned = trimmed.replace(/^-/, '');
  const [whole, fractional = ''] = unsigned.split('.');
  const raw = BigInt(`${whole}${fractional}`);
  if (fractional.length === DECIMAL_SCALE) {
    return sign * raw;
  }
  if (fractional.length < DECIMAL_SCALE) {
    return sign * raw * 10n ** BigInt(DECIMAL_SCALE - fractional.length);
  }
  const divisor = 10n ** BigInt(fractional.length - DECIMAL_SCALE);
  const quotient = raw / divisor;
  const remainder = raw % divisor;
  return sign * (remainder * 2n >= divisor ? quotient + 1n : quotient);
}

function fromScaled(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const raw = absolute.toString().padStart(DECIMAL_SCALE + 1, '0');
  return `${sign}${raw.slice(0, -DECIMAL_SCALE)}.${raw.slice(-DECIMAL_SCALE)}`;
}

function divideScaled(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    return 0n;
  }
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  if (absoluteRemainder * 2n < absoluteDenominator) {
    return quotient;
  }
  return quotient + (numerator >= 0n === denominator >= 0n ? 1n : -1n);
}

function formatDecimalString(value: string): string {
  return fromScaled(toScaled(value));
}

function compareDecimalDesc(left: string, right: string): number {
  return compareDecimalAsc(right, left);
}

function groupOrdersByCustomer(orders: readonly CustomerClvBacktestSourceOrder[]): Map<number, readonly CustomerClvBacktestSourceOrder[]> {
  const grouped = new Map<number, CustomerClvBacktestSourceOrder[]>();
  for (const order of orders) {
    const customerOrders = grouped.get(order.customerId) ?? [];
    customerOrders.push(order);
    grouped.set(order.customerId, customerOrders);
  }
  return grouped;
}

function assessCustomerRegistrationIntegrity(
  orders: readonly CustomerClvBacktestSourceOrder[],
): 'ok' | 'inconsistent_customer_created_at' | 'order_before_customer_created_at' {
  const observed = new Set(orders.map((order) => order.customerCreatedAt));
  if (observed.size !== 1) {
    return 'inconsistent_customer_created_at';
  }
  const customerCreatedAt = orders[0]!.customerCreatedAt;
  if (orders.some((order) => Date.parse(order.createdAt) < Date.parse(customerCreatedAt))) {
    return 'order_before_customer_created_at';
  }
  return 'ok';
}

function assertNoDuplicateOrders(orders: readonly CustomerClvBacktestSourceOrder[]): void {
  const seen = new Set<number>();
  for (const order of orders) {
    if (seen.has(order.orderId)) {
      throw new Error(`Duplicate orderId in CLV backtest source: ${order.orderId}`);
    }
    seen.add(order.orderId);
  }
}

function assertRelevantCurrencies(orders: readonly CustomerClvBacktestSourceOrder[]): void {
  for (const order of orders) {
    if (!order.currentValid || compareDecimalAsc(order.totalPaidTaxIncl, '0.000000') <= 0) {
      continue;
    }
    if (order.currencyIsoCode === null) {
      throw new Error(`Eligible order ${order.orderId} is missing currencyIsoCode`);
    }
    assertNonEmptyString(order.currencyIsoCode, 'currencyIsoCode');
    assertClpCurrency(order.currencyIsoCode);
  }
}

function assertUniqueDatasetRows(rows: readonly CustomerClvBacktestExample[], cutoffTime: string): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.customerId}__${cutoffTime}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate customerId x cutoffTime in CLV dataset: ${key}`);
    }
    seen.add(key);
  }
}

function sourceOrderChecksumShape(order: CustomerClvBacktestSourceOrder): Record<string, unknown> {
  return {
    orderId: order.orderId,
    customerId: order.customerId,
    customerCreatedAt: order.customerCreatedAt,
    createdAt: order.createdAt,
    currentValid: order.currentValid,
    currentStateId: order.currentStateId,
    currencyIsoCode: order.currencyIsoCode,
    totalPaidTaxIncl: order.totalPaidTaxIncl,
    totalDiscountsTaxIncl: order.totalDiscountsTaxIncl,
    totalShippingTaxIncl: order.totalShippingTaxIncl,
    sellerServiceRevenueTaxIncl: order.sellerServiceRevenueTaxIncl,
    refundEvidence: order.refundEvidence,
    products: order.products,
  };
}
