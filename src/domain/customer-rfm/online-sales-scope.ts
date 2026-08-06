import {
  addRfmDecimals,
  formatRfmDecimal,
} from './decimal.js';
import { parseReferenceTime } from './date-window.js';
import { sha256Stable } from './checksum.js';
import type { RfmPopulationSourceRow, RfmSnapshotDiagnostics } from './contracts.js';

export const onlineSalesScopePolicyVersion = 'prestashop-online-orders-candidate-v1';

export type SalesChannelClassification =
  | 'ONLINE_CONFIRMED'
  | 'STORE_CONFIRMED_BY_SHOP'
  | 'STORE_CONFIRMED_BY_MODULE'
  | 'STORE_CONFIRMED_BY_SELLER_SERVICE'
  | 'STORE_CONFIRMED_BY_GENERIC_CUSTOMER'
  | 'AMBIGUOUS'
  | 'EXCLUDED_TECHNICAL';

export type SalesChannelPolicy = {
  readonly policyVersion: string;
  readonly confirmedOnlineShopIds: readonly number[];
  readonly confirmedOnlineModules: readonly string[];
  readonly confirmedStoreShopIds: readonly number[];
  readonly confirmedStoreModules: readonly string[];
  readonly confirmedSellerServiceProductIds: readonly number[];
  readonly confirmedGenericCustomerIds: readonly number[];
  readonly ambiguousOrderPolicy: 'fail_open' | 'fail_closed' | 'quarantine';
};

export type SalesChannelOrderLine = {
  readonly productId: number;
  readonly productAttributeId: number;
  readonly productReference: string | null;
  readonly quantity: number;
  readonly unitPriceTaxIncl: string;
  readonly totalPriceTaxIncl: string;
};

export type SalesChannelOrder = {
  readonly orderId: number;
  readonly prestashopCustomerId: number;
  readonly shopId: number;
  readonly shopGroupId: number | null;
  readonly module: string | null;
  readonly payment: string | null;
  readonly carrierId: number | null;
  readonly validOrderAt: string;
  readonly grossOrderValueTaxIncl: string;
  readonly lines: readonly SalesChannelOrderLine[];
};

export type ClassifiedSalesChannelOrder = SalesChannelOrder & {
  readonly classifiedSalesChannel: 'online' | 'store' | 'ambiguous' | 'technical';
  readonly classificationReason: SalesChannelClassification;
};

export type ClassificationSummary = {
  readonly orderCount: number;
  readonly customerCount: number;
  readonly grossOrderValueTaxIncl: string;
  readonly byReason: Record<SalesChannelClassification, ClassificationReasonSummary>;
  readonly checksum: string;
};

export type ClassificationReasonSummary = {
  readonly orderCount: number;
  readonly customerCount: number;
  readonly grossOrderValueTaxIncl: string;
};

export type ScopeComparison = {
  readonly includedOrderCount: number;
  readonly excludedOrderCount: number;
  readonly includedCustomerCount: number;
  readonly excludedCustomerCount: number;
  readonly includedGrossAmount: string;
  readonly excludedGrossAmount: string;
  readonly ordersClassifiedOnline: number;
  readonly ordersClassifiedStore: number;
  readonly ordersAmbiguous: number;
  readonly falsePositiveRisk: QualitativeRisk;
  readonly falseNegativeRisk: QualitativeRisk;
};

export type QualitativeRisk = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export type SignalEvaluation = {
  readonly signal: string;
  readonly coverage: QualitativeRisk;
  readonly exclusivity: QualitativeRisk;
  readonly stability: QualitativeRisk;
  readonly falsePositiveRisk: QualitativeRisk;
  readonly falseNegativeRisk: QualitativeRisk;
  readonly recommendation: string;
};

export type SignalCrossMatrix = Record<
  'sellerServiceAndGenericCustomer' | 'sellerServiceAndNonGenericCustomer' | 'noSellerServiceAndGenericCustomer' | 'noSellerServiceAndNonGenericCustomer',
  ScopeSignalGroupSummary
>;

export type ScopeSignalGroupSummary = {
  readonly orderCount: number;
  readonly customerCount: number;
  readonly grossOrderValueTaxIncl: string;
  readonly shopDistribution: readonly DistributionEntry[];
  readonly moduleDistribution: readonly DistributionEntry[];
  readonly paymentDistribution: readonly DistributionEntry[];
  readonly carrierDistribution: readonly DistributionEntry[];
};

export type DistributionEntry = {
  readonly key: string;
  readonly orderCount: number;
  readonly customerCount: number;
  readonly grossOrderValueTaxIncl: string;
};

export type AmbiguousOrdersSummary = {
  readonly ambiguousOrderCount: number;
  readonly ambiguousGrossAmount: string;
  readonly ambiguousCustomerCount: number;
  readonly ambiguousShare: string;
  readonly ambiguousOrderPolicy: SalesChannelPolicy['ambiguousOrderPolicy'];
};

export type RfmScopeMetricComparison = {
  readonly before: string | number | null;
  readonly after: string | number | null;
  readonly absoluteDelta: string | number | null;
  readonly percentageDelta: string;
};

export type RfmScopeBeforeAfter = Record<string, RfmScopeMetricComparison>;

export type T08ScopeImpactSummary = {
  readonly customersWithPurchasedProductsBefore: number;
  readonly customersWithPurchasedProductsAfter: number;
  readonly orderLinesBefore: number;
  readonly orderLinesAfter: number;
  readonly distinctProductsBefore: number;
  readonly distinctProductsAfter: number;
  readonly sellerServiceLineCount: number;
  readonly sellerServiceGrossAmount: string;
};

export type T09ScopeImpactSummary = {
  readonly status: 'SIMULATED_AGGREGATE' | 'T09_SCOPE_IMPACT_NOT_EXECUTABLE';
  readonly reason: string;
  readonly customersAnalyzedBefore: number;
  readonly customersAnalyzedAfter: number;
  readonly averageDistinctProductCountBefore: string;
  readonly averageDistinctProductCountAfter: string;
  readonly averageVariantCountBefore: string;
  readonly averageVariantCountAfter: string;
  readonly sellerServiceDominatedCustomerCount: number;
};

export type OnlineScopeVerdict =
  | 'ONLINE_SCOPE_IDENTIFIED'
  | 'ONLINE_SCOPE_IDENTIFIED_WITH_AMBIGUITY'
  | 'SELLER_SERVICE_IS_RELIABLE_STORE_MARKER'
  | 'GENERIC_CUSTOMER_IS_PRIMARY_CONTAMINATION'
  | 'COMBINED_POLICY_REQUIRED'
  | 'ONLINE_SCOPE_NOT_IDENTIFIABLE'
  | 'BLOCKED_BY_INSUFFICIENT_OPERATIONAL_EVIDENCE'
  | 'BLOCKED_BY_DATA_CONTRACT'
  | 'BLOCKED_BY_NEW_TEST_REGRESSION';

export type OnlineScopeCondition =
  | 'EXCLUDE_CONFIRMED_GENERIC_CUSTOMER'
  | 'EXCLUDE_ORDERS_WITH_SELLER_SERVICE'
  | 'EXCLUDE_CONFIRMED_STORE_SHOP'
  | 'EXCLUDE_CONFIRMED_STORE_MODULE'
  | 'QUARANTINE_AMBIGUOUS_ORDERS'
  | 'T08_REQUIRES_SCOPE_UPDATE'
  | 'T09_REQUIRES_SCOPE_UPDATE'
  | 'RFM_REQUIRES_RECALCULATION';

export type OnlineScopeVerdictSummary = {
  readonly primaryVerdict: OnlineScopeVerdict;
  readonly conditions: readonly OnlineScopeCondition[];
  readonly policyVersion: string;
  readonly rationale: readonly string[];
};

export function normalizeSalesChannelPolicy(policy: SalesChannelPolicy): SalesChannelPolicy {
  if (!policy.policyVersion || policy.policyVersion.trim() === '') {
    throw new Error('sales channel policyVersion is required');
  }
  return {
    policyVersion: policy.policyVersion,
    confirmedOnlineShopIds: uniquePositiveIntegers(policy.confirmedOnlineShopIds, 'confirmedOnlineShopIds'),
    confirmedOnlineModules: uniqueModules(policy.confirmedOnlineModules),
    confirmedStoreShopIds: uniquePositiveIntegers(policy.confirmedStoreShopIds, 'confirmedStoreShopIds'),
    confirmedStoreModules: uniqueModules(policy.confirmedStoreModules),
    confirmedSellerServiceProductIds: uniquePositiveIntegers(policy.confirmedSellerServiceProductIds, 'confirmedSellerServiceProductIds'),
    confirmedGenericCustomerIds: uniquePositiveIntegers(policy.confirmedGenericCustomerIds, 'confirmedGenericCustomerIds'),
    ambiguousOrderPolicy: policy.ambiguousOrderPolicy,
  };
}

export function classifySalesChannelOrder(
  order: SalesChannelOrder,
  rawPolicy: SalesChannelPolicy,
): ClassifiedSalesChannelOrder {
  assertOrder(order);
  const policy = normalizeSalesChannelPolicy(rawPolicy);
  const module = normalizeModule(order.module);
  const hasSellerService = order.lines.some((line) => policy.confirmedSellerServiceProductIds.includes(line.productId));

  if (!Number.isSafeInteger(order.prestashopCustomerId) || order.prestashopCustomerId <= 0) {
    return { ...order, classifiedSalesChannel: 'technical', classificationReason: 'EXCLUDED_TECHNICAL' };
  }
  if (policy.confirmedStoreShopIds.includes(order.shopId)) {
    return { ...order, classifiedSalesChannel: 'store', classificationReason: 'STORE_CONFIRMED_BY_SHOP' };
  }
  if (module && policy.confirmedStoreModules.includes(module)) {
    return { ...order, classifiedSalesChannel: 'store', classificationReason: 'STORE_CONFIRMED_BY_MODULE' };
  }
  if (hasSellerService) {
    return { ...order, classifiedSalesChannel: 'store', classificationReason: 'STORE_CONFIRMED_BY_SELLER_SERVICE' };
  }
  if (policy.confirmedGenericCustomerIds.includes(order.prestashopCustomerId)) {
    return { ...order, classifiedSalesChannel: 'store', classificationReason: 'STORE_CONFIRMED_BY_GENERIC_CUSTOMER' };
  }
  if (
    (policy.confirmedOnlineShopIds.length === 0 || policy.confirmedOnlineShopIds.includes(order.shopId)) &&
    (policy.confirmedOnlineModules.length === 0 || (module !== null && policy.confirmedOnlineModules.includes(module)))
  ) {
    return { ...order, classifiedSalesChannel: 'online', classificationReason: 'ONLINE_CONFIRMED' };
  }
  return { ...order, classifiedSalesChannel: 'ambiguous', classificationReason: 'AMBIGUOUS' };
}

export function classifySalesChannelOrders(
  orders: readonly SalesChannelOrder[],
  policy: SalesChannelPolicy,
): readonly ClassifiedSalesChannelOrder[] {
  return [...orders]
    .sort((a, b) => a.orderId - b.orderId)
    .map((order) => classifySalesChannelOrder(order, policy));
}

export function summarizeClassifications(classified: readonly ClassifiedSalesChannelOrder[]): ClassificationSummary {
  const byReason = Object.fromEntries(
    ([
      'ONLINE_CONFIRMED',
      'STORE_CONFIRMED_BY_SHOP',
      'STORE_CONFIRMED_BY_MODULE',
      'STORE_CONFIRMED_BY_SELLER_SERVICE',
      'STORE_CONFIRMED_BY_GENERIC_CUSTOMER',
      'AMBIGUOUS',
      'EXCLUDED_TECHNICAL',
    ] as const).map((reason) => [reason, summarizeOrders(classified.filter((order) => order.classificationReason === reason))]),
  ) as Record<SalesChannelClassification, ClassificationReasonSummary>;
  const summary = {
    orderCount: classified.length,
    customerCount: new Set(classified.map((order) => order.prestashopCustomerId)).size,
    grossOrderValueTaxIncl: addRfmDecimals(classified.map((order) => order.grossOrderValueTaxIncl)),
    byReason,
  };
  return { ...summary, checksum: sha256Stable(summary) };
}

export function compareScope(classified: readonly ClassifiedSalesChannelOrder[]): ScopeComparison {
  const included = classified.filter((order) => order.classifiedSalesChannel === 'online');
  const excluded = classified.filter((order) => order.classifiedSalesChannel !== 'online');
  const ambiguous = classified.filter((order) => order.classifiedSalesChannel === 'ambiguous');
  return {
    includedOrderCount: included.length,
    excludedOrderCount: excluded.length,
    includedCustomerCount: new Set(included.map((order) => order.prestashopCustomerId)).size,
    excludedCustomerCount: new Set(excluded.map((order) => order.prestashopCustomerId)).size,
    includedGrossAmount: addRfmDecimals(included.map((order) => order.grossOrderValueTaxIncl)),
    excludedGrossAmount: addRfmDecimals(excluded.map((order) => order.grossOrderValueTaxIncl)),
    ordersClassifiedOnline: included.length,
    ordersClassifiedStore: classified.filter((order) => order.classifiedSalesChannel === 'store').length,
    ordersAmbiguous: ambiguous.length,
    falsePositiveRisk: ambiguous.length > 0 ? 'MEDIUM' : 'LOW',
    falseNegativeRisk: excluded.length === 0 ? 'UNKNOWN' : 'MEDIUM',
  };
}

export function buildSignalCrossMatrix(
  orders: readonly SalesChannelOrder[],
  policy: SalesChannelPolicy,
): SignalCrossMatrix {
  const normalized = normalizeSalesChannelPolicy(policy);
  const groups = {
    sellerServiceAndGenericCustomer: orders.filter(
      (order) => hasSellerService(order, normalized) && normalized.confirmedGenericCustomerIds.includes(order.prestashopCustomerId),
    ),
    sellerServiceAndNonGenericCustomer: orders.filter(
      (order) => hasSellerService(order, normalized) && !normalized.confirmedGenericCustomerIds.includes(order.prestashopCustomerId),
    ),
    noSellerServiceAndGenericCustomer: orders.filter(
      (order) => !hasSellerService(order, normalized) && normalized.confirmedGenericCustomerIds.includes(order.prestashopCustomerId),
    ),
    noSellerServiceAndNonGenericCustomer: orders.filter(
      (order) => !hasSellerService(order, normalized) && !normalized.confirmedGenericCustomerIds.includes(order.prestashopCustomerId),
    ),
  };
  return Object.fromEntries(
    Object.entries(groups).map(([name, groupedOrders]) => [name, summarizeSignalGroup(groupedOrders)]),
  ) as SignalCrossMatrix;
}

export function summarizeAmbiguousOrders(
  classified: readonly ClassifiedSalesChannelOrder[],
  policy: SalesChannelPolicy,
): AmbiguousOrdersSummary {
  const ambiguous = classified.filter((order) => order.classifiedSalesChannel === 'ambiguous');
  return {
    ambiguousOrderCount: ambiguous.length,
    ambiguousGrossAmount: addRfmDecimals(ambiguous.map((order) => order.grossOrderValueTaxIncl)),
    ambiguousCustomerCount: new Set(ambiguous.map((order) => order.prestashopCustomerId)).size,
    ambiguousShare: ratio(ambiguous.length, classified.length),
    ambiguousOrderPolicy: policy.ambiguousOrderPolicy,
  };
}

export function buildSignalEvaluation(
  classified: readonly ClassifiedSalesChannelOrder[],
  policy: SalesChannelPolicy,
): readonly SignalEvaluation[] {
  const summary = summarizeClassifications(classified);
  const storeOrders = classified.filter((order) => order.classifiedSalesChannel === 'store').length;
  const total = classified.length;
  const sellerOrders = summary.byReason.STORE_CONFIRMED_BY_SELLER_SERVICE.orderCount;
  const genericOrders = summary.byReason.STORE_CONFIRMED_BY_GENERIC_CUSTOMER.orderCount;
  const shopOrders = summary.byReason.STORE_CONFIRMED_BY_SHOP.orderCount;
  const moduleOrders = summary.byReason.STORE_CONFIRMED_BY_MODULE.orderCount;
  return [
    signal('id_shop', shopOrders, storeOrders, total, policy.confirmedStoreShopIds.length > 0, 'Prefer when shop is operationally confirmed exclusive.'),
    signal('module', moduleOrders, storeOrders, total, policy.confirmedStoreModules.length > 0, 'Use only for modules operationally confirmed as store-exclusive.'),
    signal('seller_service_product_id', sellerOrders, storeOrders, total, policy.confirmedSellerServiceProductIds.length > 0, 'Strong explicit marker when product id is stable and absent from online orders.'),
    signal('generic_customer_id', genericOrders, storeOrders, total, policy.confirmedGenericCustomerIds.length > 0, 'Useful contamination marker, but does not catch store sales with real customers.'),
    signal('combined_policy', storeOrders, storeOrders, total, storeOrders > 0, 'Recommended when no single signal has full coverage.'),
  ];
}

function signal(
  name: string,
  matchedOrders: number,
  storeOrders: number,
  totalOrders: number,
  configured: boolean,
  recommendation: string,
): SignalEvaluation {
  return {
    signal: name,
    coverage: configured ? qualitativeRatio(matchedOrders, Math.max(storeOrders, 1)) : 'UNKNOWN',
    exclusivity: configured ? 'MEDIUM' : 'UNKNOWN',
    stability: configured ? 'MEDIUM' : 'UNKNOWN',
    falsePositiveRisk: configured ? (matchedOrders > totalOrders * 0.5 ? 'MEDIUM' : 'LOW') : 'UNKNOWN',
    falseNegativeRisk: configured ? (matchedOrders < storeOrders ? 'MEDIUM' : 'LOW') : 'UNKNOWN',
    recommendation,
  };
}

export function buildRfmSourceRowsFromOrders(
  referenceTime: string,
  orders: readonly SalesChannelOrder[],
): readonly RfmPopulationSourceRow[] {
  const reference = parseReferenceTime(referenceTime);
  const windowStart = new Date(reference.getTime() - 365 * 86_400_000);
  const rows = orders.filter((order) => {
    const date = parseSourceDate(order.validOrderAt);
    return date.getTime() >= windowStart.getTime() && date.getTime() < reference.getTime();
  });
  const grouped = groupByCustomer(rows);
  return Array.from(grouped.entries())
    .map(([prestashopCustomerId, customerOrders]) => {
      const sorted = sortOrders(customerOrders);
      return {
        prestashopCustomerId,
        firstValidOrderAt: sorted[0]!.validOrderAt,
        lastValidOrderAt: sorted.at(-1)!.validOrderAt,
        frequencyOrders: sorted.length,
        grossOrderValueTaxIncl: addRfmDecimals(sorted.map((order) => order.grossOrderValueTaxIncl)),
        distinctShopCount: new Set(sorted.map((order) => order.shopId)).size,
      };
    })
    .sort((a, b) => a.prestashopCustomerId - b.prestashopCustomerId);
}

export function buildRfmDiagnosticsFromOrders(
  referenceTime: string,
  orders: readonly SalesChannelOrder[],
): RfmSnapshotDiagnostics {
  const reference = parseReferenceTime(referenceTime);
  const windowStart = new Date(reference.getTime() - 365 * 86_400_000);
  const historicalOrders = orders.filter((order) => parseSourceDate(order.validOrderAt).getTime() < reference.getTime());
  const operationalOrders = historicalOrders.filter((order) => parseSourceDate(order.validOrderAt).getTime() >= windowStart.getTime());
  const perShop = Array.from(groupBy(operationalOrders, (order) => String(order.shopId)).entries())
    .map(([shopId, shopOrders]) => ({
      shopId: Number(shopId),
      customers: new Set(shopOrders.map((order) => order.prestashopCustomerId)).size,
      orders: shopOrders.length,
      grossOrderValueTaxIncl: addRfmDecimals(shopOrders.map((order) => order.grossOrderValueTaxIncl)),
    }))
    .sort((a, b) => a.shopId - b.shopId);
  return {
    historicalCustomerCount: new Set(historicalOrders.map((order) => order.prestashopCustomerId)).size,
    validOrderCount: operationalOrders.length,
    grossOrderValueTaxIncl: addRfmDecimals(operationalOrders.map((order) => order.grossOrderValueTaxIncl)),
    currency: {
      distinctCurrencyCount: 1,
      currencyCode: 'CLP',
      distinctConversionRateCount: 1,
    },
    refunds: {
      refundedLineCount: 0,
      partiallyRefundedOrderCount: 0,
      partiallyRefundedAmountObserved: '0.000000',
    },
    shops: {
      distinctShopCount: perShop.length,
      perShop,
      crossShopCustomers: countCrossShopCustomers(operationalOrders),
    },
    exclusions: {
      invalidOrderExcludedCount: 0,
      futureOrderExcludedCount: orders.filter((order) => parseSourceDate(order.validOrderAt).getTime() >= reference.getTime()).length,
      excludedZeroValueOrderCount: operationalOrders.filter((order) => formatRfmDecimal(order.grossOrderValueTaxIncl) === '0.000000').length,
      excludedOperationalAccountCount: 0,
      excludedOperationalAccountOrderCount: 0,
      excludedOperationalAccountValueTaxIncl: '0.000000',
      unusableCustomerOrderCount: 0,
      missingPrestashopCustomerOrderCount: 0,
    },
    // Sales-channel scope audit tool: does not compute seller-service exclusion itself (that
    // policy is owned by mysql-rfm-population-reader.ts / seller-service-policy.ts).
    sellerService: {
      policyVersion: 'not_applicable_to_this_audit_tool',
      confirmedProductIds: [],
      ordersWithSellerServiceCount: 0,
      sellerServiceLineCount: 0,
      excludedSellerServiceValueTaxIncl: '0.000000',
      grossOrderValueBeforeSellerServiceExclusion: addRfmDecimals(operationalOrders.map((order) => order.grossOrderValueTaxIncl)),
      monetaryAfterSellerServiceExclusion: addRfmDecimals(operationalOrders.map((order) => order.grossOrderValueTaxIncl)),
      productTargetedDiscountOrderCount: 0,
    },
  };
}

export function compareMetric(before: string | number | null, after: string | number | null): RfmScopeMetricComparison {
  if (typeof before === 'number' && typeof after === 'number') {
    return {
      before,
      after,
      absoluteDelta: after - before,
      percentageDelta: ratio(after - before, before),
    };
  }
  if (typeof before === 'string' && typeof after === 'string') {
    const delta = subtractDecimal(after, before);
    return {
      before,
      after,
      absoluteDelta: delta,
      percentageDelta: decimalSignedRatio(delta, before),
    };
  }
  return { before, after, absoluteDelta: null, percentageDelta: '0.000000' };
}

export function buildT08ScopeImpactSummary(
  beforeOrders: readonly SalesChannelOrder[],
  afterOrders: readonly SalesChannelOrder[],
  policy: SalesChannelPolicy,
): T08ScopeImpactSummary {
  const sellerIds = new Set(normalizeSalesChannelPolicy(policy).confirmedSellerServiceProductIds);
  const beforeLines = beforeOrders.flatMap((order) => order.lines.map((line) => ({ order, line })));
  const afterLines = afterOrders.flatMap((order) => order.lines.map((line) => ({ order, line })));
  const sellerLines = beforeLines.filter(({ line }) => sellerIds.has(line.productId));
  return {
    customersWithPurchasedProductsBefore: new Set(beforeLines.map(({ order }) => order.prestashopCustomerId)).size,
    customersWithPurchasedProductsAfter: new Set(afterLines.map(({ order }) => order.prestashopCustomerId)).size,
    orderLinesBefore: beforeLines.length,
    orderLinesAfter: afterLines.length,
    distinctProductsBefore: new Set(beforeLines.map(({ line }) => line.productId)).size,
    distinctProductsAfter: new Set(afterLines.map(({ line }) => line.productId)).size,
    sellerServiceLineCount: sellerLines.length,
    sellerServiceGrossAmount: addRfmDecimals(sellerLines.map(({ line }) => line.totalPriceTaxIncl)),
  };
}

export function buildT09ScopeImpactSummary(
  beforeOrders: readonly SalesChannelOrder[],
  afterOrders: readonly SalesChannelOrder[],
  policy: SalesChannelPolicy,
): T09ScopeImpactSummary {
  const before = productBehaviorAggregate(beforeOrders, policy);
  const after = productBehaviorAggregate(afterOrders, policy);
  return {
    status: 'SIMULATED_AGGREGATE',
    reason: 'Aggregate simulation over order lines only; full T09 per-customer contract is not duplicated.',
    customersAnalyzedBefore: before.customerCount,
    customersAnalyzedAfter: after.customerCount,
    averageDistinctProductCountBefore: before.averageDistinctProductCount,
    averageDistinctProductCountAfter: after.averageDistinctProductCount,
    averageVariantCountBefore: before.averageVariantCount,
    averageVariantCountAfter: after.averageVariantCount,
    sellerServiceDominatedCustomerCount: before.sellerServiceDominatedCustomerCount,
  };
}

export function buildOnlineScopeVerdict(
  classified: readonly ClassifiedSalesChannelOrder[],
  policy: SalesChannelPolicy,
): OnlineScopeVerdictSummary {
  const comparison = compareScope(classified);
  const hasStoreSignal = comparison.ordersClassifiedStore > 0;
  const ambiguousShare = comparison.ordersAmbiguous / Math.max(classified.length, 1);
  const normalized = normalizeSalesChannelPolicy(policy);
  const conditions: OnlineScopeCondition[] = [
    ...(normalized.confirmedGenericCustomerIds.length > 0 ? (['EXCLUDE_CONFIRMED_GENERIC_CUSTOMER'] as const) : []),
    ...(normalized.confirmedSellerServiceProductIds.length > 0 ? (['EXCLUDE_ORDERS_WITH_SELLER_SERVICE'] as const) : []),
    ...(normalized.confirmedStoreShopIds.length > 0 ? (['EXCLUDE_CONFIRMED_STORE_SHOP'] as const) : []),
    ...(normalized.confirmedStoreModules.length > 0 ? (['EXCLUDE_CONFIRMED_STORE_MODULE'] as const) : []),
    ...(comparison.ordersAmbiguous > 0 ? (['QUARANTINE_AMBIGUOUS_ORDERS'] as const) : []),
    'T08_REQUIRES_SCOPE_UPDATE',
    'T09_REQUIRES_SCOPE_UPDATE',
    'RFM_REQUIRES_RECALCULATION',
  ];
  let primaryVerdict: OnlineScopeVerdict = 'BLOCKED_BY_INSUFFICIENT_OPERATIONAL_EVIDENCE';
  if (hasStoreSignal && ambiguousShare <= 0.01) {
    primaryVerdict = 'ONLINE_SCOPE_IDENTIFIED';
  } else if (hasStoreSignal) {
    primaryVerdict = 'ONLINE_SCOPE_IDENTIFIED_WITH_AMBIGUITY';
  }
  if (
    normalized.confirmedStoreShopIds.length + normalized.confirmedStoreModules.length === 0 &&
    normalized.confirmedSellerServiceProductIds.length > 0 &&
    comparison.ordersClassifiedStore > 0
  ) {
    primaryVerdict = 'SELLER_SERVICE_IS_RELIABLE_STORE_MARKER';
  }
  if (
    normalized.confirmedGenericCustomerIds.length > 0 &&
    normalized.confirmedSellerServiceProductIds.length + normalized.confirmedStoreShopIds.length + normalized.confirmedStoreModules.length === 0
  ) {
    primaryVerdict = 'GENERIC_CUSTOMER_IS_PRIMARY_CONTAMINATION';
  }
  if (
    normalized.confirmedGenericCustomerIds.length +
      normalized.confirmedSellerServiceProductIds.length +
      normalized.confirmedStoreShopIds.length +
      normalized.confirmedStoreModules.length >
    1
  ) {
    primaryVerdict = comparison.ordersAmbiguous > 0 ? 'ONLINE_SCOPE_IDENTIFIED_WITH_AMBIGUITY' : 'COMBINED_POLICY_REQUIRED';
  }
  return {
    primaryVerdict,
    conditions,
    policyVersion: normalized.policyVersion,
    rationale: [
      'Productive T08, T09 and RFM currently use all valid PrestaShop orders.',
      'Online-only scope must be explicit, versioned and auditable before production query changes.',
      'No statistical frequency threshold is used for exclusion.',
    ],
  };
}

export function assertOnlineScopeReportHasNoPii(report: unknown): void {
  assertNoPii(report, 'report');
}

function summarizeOrders(orders: readonly SalesChannelOrder[]): ClassificationReasonSummary {
  return {
    orderCount: orders.length,
    customerCount: new Set(orders.map((order) => order.prestashopCustomerId)).size,
    grossOrderValueTaxIncl: addRfmDecimals(orders.map((order) => order.grossOrderValueTaxIncl)),
  };
}

function summarizeSignalGroup(orders: readonly SalesChannelOrder[]): ScopeSignalGroupSummary {
  return {
    orderCount: orders.length,
    customerCount: new Set(orders.map((order) => order.prestashopCustomerId)).size,
    grossOrderValueTaxIncl: addRfmDecimals(orders.map((order) => order.grossOrderValueTaxIncl)),
    shopDistribution: distribution(orders, (order) => `shop_${order.shopId}`),
    moduleDistribution: distribution(orders, (order) => normalizeModule(order.module) ?? 'unknown'),
    paymentDistribution: distribution(orders, (order) => order.payment?.trim() || 'unknown'),
    carrierDistribution: distribution(orders, (order) => order.carrierId === null ? 'unknown' : `carrier_${order.carrierId}`),
  };
}

function distribution(orders: readonly SalesChannelOrder[], keyOf: (order: SalesChannelOrder) => string): readonly DistributionEntry[] {
  return Array.from(groupBy(orders, keyOf).entries())
    .map(([key, groupedOrders]) => ({
      key,
      orderCount: groupedOrders.length,
      customerCount: new Set(groupedOrders.map((order) => order.prestashopCustomerId)).size,
      grossOrderValueTaxIncl: addRfmDecimals(groupedOrders.map((order) => order.grossOrderValueTaxIncl)),
    }))
    .sort((a, b) => b.orderCount - a.orderCount || a.key.localeCompare(b.key));
}

function productBehaviorAggregate(orders: readonly SalesChannelOrder[], policy: SalesChannelPolicy): {
  readonly customerCount: number;
  readonly averageDistinctProductCount: string;
  readonly averageVariantCount: string;
  readonly sellerServiceDominatedCustomerCount: number;
} {
  const sellerIds = new Set(normalizeSalesChannelPolicy(policy).confirmedSellerServiceProductIds);
  const byCustomer = groupBy(orders, (order) => String(order.prestashopCustomerId));
  const distinctProducts: number[] = [];
  const distinctVariants: number[] = [];
  let sellerServiceDominatedCustomerCount = 0;
  for (const customerOrders of byCustomer.values()) {
    const lines = customerOrders.flatMap((order) => order.lines);
    distinctProducts.push(new Set(lines.map((line) => line.productId)).size);
    distinctVariants.push(new Set(lines.map((line) => `${line.productId}:${line.productAttributeId}`)).size);
    const sellerLineCount = lines.filter((line) => sellerIds.has(line.productId)).length;
    if (lines.length > 0 && sellerLineCount / lines.length >= 0.5) sellerServiceDominatedCustomerCount += 1;
  }
  return {
    customerCount: byCustomer.size,
    averageDistinctProductCount: averageNumber(distinctProducts),
    averageVariantCount: averageNumber(distinctVariants),
    sellerServiceDominatedCustomerCount,
  };
}

function hasSellerService(order: SalesChannelOrder, policy: SalesChannelPolicy): boolean {
  return order.lines.some((line) => policy.confirmedSellerServiceProductIds.includes(line.productId));
}

function groupByCustomer(orders: readonly SalesChannelOrder[]): Map<number, readonly SalesChannelOrder[]> {
  const grouped = new Map<number, SalesChannelOrder[]>();
  for (const order of orders) grouped.set(order.prestashopCustomerId, [...(grouped.get(order.prestashopCustomerId) ?? []), order]);
  return grouped;
}

function sortOrders(orders: readonly SalesChannelOrder[]): readonly SalesChannelOrder[] {
  return [...orders].sort((a, b) => {
    const byDate = a.validOrderAt.localeCompare(b.validOrderAt);
    return byDate === 0 ? a.orderId - b.orderId : byDate;
  });
}

function countCrossShopCustomers(orders: readonly SalesChannelOrder[]): number {
  let count = 0;
  for (const customerOrders of groupByCustomer(orders).values()) {
    if (new Set(customerOrders.map((order) => order.shopId)).size > 1) count += 1;
  }
  return count;
}

function groupBy<T>(values: readonly T[], keyOf: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) grouped.set(keyOf(value), [...(grouped.get(keyOf(value)) ?? []), value]);
  return grouped;
}

function qualitativeRatio(numerator: number, denominator: number): QualitativeRisk {
  const value = numerator / denominator;
  if (value >= 0.9) return 'HIGH';
  if (value >= 0.5) return 'MEDIUM';
  return 'LOW';
}

function averageNumber(values: readonly number[]): string {
  if (values.length === 0) return '0.000000';
  return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6);
}

function uniquePositiveIntegers(values: readonly number[], field: string): readonly number[] {
  const unique = Array.from(new Set(values.map((value) => Number(value)))).sort((a, b) => a - b);
  for (const value of unique) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return unique;
}

function uniqueModules(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values.map((value) => normalizeModule(value)).filter((value): value is string => value !== null))).sort();
}

function normalizeModule(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized.length === 0 ? null : normalized;
}

function assertOrder(order: SalesChannelOrder): void {
  if (!Number.isSafeInteger(order.orderId) || order.orderId <= 0) throw new Error('Invalid orderId');
  if (!Number.isSafeInteger(order.shopId) || order.shopId <= 0) throw new Error('Invalid shopId');
  formatRfmDecimal(order.grossOrderValueTaxIncl);
  parseSourceDate(order.validOrderAt);
  for (const line of order.lines) {
    if (!Number.isSafeInteger(line.productId) || line.productId <= 0) throw new Error('Invalid productId');
    if (!Number.isSafeInteger(line.productAttributeId) || line.productAttributeId < 0) throw new Error('Invalid productAttributeId');
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 0) throw new Error('Invalid quantity');
    formatRfmDecimal(line.unitPriceTaxIncl);
    formatRfmDecimal(line.totalPriceTaxIncl);
  }
}

function parseSourceDate(value: string): Date {
  const parsed = new Date(`${value.replace(' ', 'T').replace(/Z$/, '')}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid source datetime: ${value}`);
  return parsed;
}

function ratio(numerator: number, denominator: number): string {
  if (denominator === 0) return '0.000000';
  return (numerator / denominator).toFixed(6);
}

function subtractDecimal(left: string, right: string): string {
  return formatSignedScaled(toScaled(left) - toScaled(right));
}

function decimalSignedRatio(numerator: string, denominator: string): string {
  const denominatorScaled = toScaled(formatRfmDecimal(denominator));
  if (denominatorScaled === 0n) return '0.000000';
  const numeratorScaled = toScaledSigned(numerator);
  return formatSignedScaled((numeratorScaled * 1_000_000n) / denominatorScaled);
}

function toScaled(value: string): bigint {
  const formatted = formatRfmDecimal(value);
  const [whole, fractional = ''] = formatted.split('.');
  return BigInt(`${whole}${fractional}`);
}

function toScaledSigned(value: string): bigint {
  const sign = value.startsWith('-') ? -1n : 1n;
  return sign * toScaled(value.replace(/^-/, ''));
}

function formatSignedScaled(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const raw = absolute.toString().padStart(7, '0');
  return `${sign}${raw.slice(0, -6)}.${raw.slice(-6)}`;
}

function assertNoPii(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPii(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (isForbiddenReportKey(key)) throw new Error(`Online scope report contains a forbidden field: ${path}.${key}`);
      assertNoPii(entry, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && isForbiddenReportString(value)) {
    throw new Error(`Online scope report contains a PII-shaped value at ${path}`);
  }
}

function isForbiddenReportKey(key: string): boolean {
  const normalized = key.replace(/[_\-\s]/g, '').toLowerCase();
  return [
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
  if (/^\d+\.\d{6}$/.test(trimmed) || /^[a-f0-9]{64}$/i.test(trimmed)) return false;
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(trimmed) || /\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/.test(trimmed);
}
